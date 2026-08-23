// ============================================================
// chat_voice_service.js — 语音消息业务层
// ============================================================
// 只做三件事：这条消息该不该出语音、用谁的声音、字节从哪来。
// 凭据和请求在 js/api/doubao_tts_api.js；仓库读写在 js/api/github_repo_api.js；
// 字节存哪、淘汰谁在 js/chat/chat_voice_store.js。
// 本文件不出现 endpoint、不碰 IndexedDB 表名、不认识 DOM。
//
// 消费方（后续接上）：
//   · chat_ai_service.js       → 回复落库后触发后台合成
//   · chat_voice_player.js     → 播放前拿字节
//   · chat_bubble_factory.js   → 判断一条消息是不是语音
//
// ── 三层存储状态机 ──────────────────────────────────────────
//   本地有字节            → 直接给（唯一的零延迟路径）
//   本地没有 + 云端有      → 下载回填，再给
//   两边都没有            → 合成，写本地，后台上传归档
//
// ★ 云端下载失败要区分原因：**真 404**（云端那份被删了）才重新合成；
//   网络问题一律抛出让上层重试 —— 否则一次断网就白花一次合成的钱。
//
// 对外符号：
//   VOICE_MESSAGE_REGEX / parseVoiceMessage
//   resolveVoicePresetForSender
//   ensureVoiceClip / peekVoiceClip
//   retryVoiceArchive / getVoiceArchiveTarget
//   prepareVoiceForMessages / isVoiceSynthPending / onVoiceClipReady
// ============================================================

// ============================================================
// 消息识别
// ============================================================
// AI 输出的语音消息长这样：[角色真名的语音：说的话]
//
// ★ 这个正则**只在这里定义一次**。原先 chat_bubble_factory.js 里另有一份，
//   两处各写一份必然漂移 —— 改了一处忘了另一处，就会出现"气泡画成语音条
//   但合成层不认"或者反过来的鬼故事。现在气泡工厂引用这里。
// ★ 不要改这个模式，存量消息全靠它解析。
const VOICE_MESSAGE_REGEX = /\[(?:.+?)的语音[:：]\s*([\s\S]+?)\]/;

// 说话人名字单独用一条正则取。
// ★ 为什么不把上面那条改成两个捕获组：气泡工厂靠 match[1] 拿台词，
//   加一个捕获组会让 [1] 变成名字，气泡里就会显示成角色名 —— 而且是静默的。
//   识别用的模式仍然只有上面那一条，这条只负责补个名字。
const VOICE_MESSAGE_SPEAKER_REGEX = /\[(.+?)的语音[:：]/;

/**
 * 把一条消息内容解析成语音消息。
 * @returns {{text: string, speaker: string}|null} null = 这不是语音消息
 */
function parseVoiceMessage(content) {
    const raw = String(content || '');
    const match = raw.match(VOICE_MESSAGE_REGEX);
    if (!match) return null;
    const text = match[1].trim();
    if (!text) return null;
    const speaker = raw.match(VOICE_MESSAGE_SPEAKER_REGEX);
    return { text, speaker: speaker ? speaker[1].trim() : '' };
}

/**
 * 一条消息该用哪个音色说话。
 *
 * 私聊：直接看角色自己的 voicePresetId。
 * 群聊：senderId → findGroupMemberById → member.originalCharId → 角色的 voicePresetId。
 *       ★ 必须绕这一圈回查角色，不能读 member 上的副本 —— 群成员是建群那一刻的快照，
 *         音色统一存在角色库里，这样同一个角色在私聊和多个群里的声音才是一致的。
 *         只有没关联角色的成员（角色被删了，或直接在群里建的）才退回读成员自己那份。
 *
 * @param {object} chat     角色对象（私聊）或群对象（群聊）
 * @param {string} chatType 'private' | 'group'
 * @param {string} [senderId] 群聊必传，就是消息的 senderId
 * @returns {object|null} 归一化后的音色预设；null = 这条消息不该出语音
 */
function resolveVoicePresetForSender(chat, chatType, senderId) {
    if (!chat || typeof resolveVoicePreset !== 'function') return null;

    if (chatType !== 'group') {
        return resolveVoicePreset(chat.voicePresetId);
    }

    const member = typeof findGroupMemberById === 'function'
        ? findGroupMemberById(chat, senderId)
        : (chat.members || []).find(m => m.id === senderId);
    if (!member) return null;

    if (member.originalCharId) {
        const linked = (db.characters || []).find(c => c.id === member.originalCharId);
        // 角色还在就以角色库为准；角色被删了则退回成员副本
        if (linked) return resolveVoicePreset(linked.voicePresetId);
    }
    return resolveVoicePreset(member.voicePresetId);
}

// ============================================================
// 并发闸门
// ============================================================

// 单飞表：同一个 voiceKey 并发进来只做一次，其余等同一个 Promise。
// ★ 没有这个的话，一次群聊回复里两条相同文本的语音会各自合成一遍 ——
//   花两份钱，而且两个写入互相覆盖。
const _voiceInflight = new Map();

/** 这段语音是不是正在合成/下载中。气泡据此显示转圈而不是假装"待播放" */
function isVoiceSynthPending(voiceKey) {
    return !!voiceKey && _voiceInflight.has(voiceKey);
}

// 片段就绪的订阅者。后台预合成完成时，界面上可能已经有这条消息的气泡了 ——
// 它得从"转圈"翻成"可播"。用订阅者模式而不是让 service 去戳 DOM：
// 这一层不认识 DOM，播放器自己来登记（同 weather_api 的 onWeatherUsageChange）。
const _voiceReadyListeners = [];

/** @param {Function} fn 收到 voiceKey，异常会被吞掉不影响合成主流程 */
function onVoiceClipReady(fn) {
    if (typeof fn === 'function') _voiceReadyListeners.push(fn);
}

function _emitVoiceClipReady(voiceKey) {
    _voiceReadyListeners.forEach(fn => {
        try { fn(voiceKey); } catch (error) { console.warn('语音就绪回调失败：', error); }
    });
}

// 合成并发闸门。一次合成 20 秒以上且并发不缩短单次耗时，开大只是一起变慢，
// 所以上限来自常量而不是设置项（见 doubao_tts_api.js 的 DOUBAO_TTS_CONCURRENCY）。
let _voiceActiveSynth = 0;
const _voiceSynthWaiters = [];

function _acquireSynthSlot() {
    const limit = typeof DOUBAO_TTS_CONCURRENCY === 'number' ? DOUBAO_TTS_CONCURRENCY : 2;
    if (_voiceActiveSynth < limit) {
        _voiceActiveSynth++;
        return Promise.resolve();
    }
    return new Promise(resolve => _voiceSynthWaiters.push(resolve));
}

function _releaseSynthSlot() {
    const next = _voiceSynthWaiters.shift();
    // 有人在等就直接把名额交给他，不要先减再加 —— 中间那一瞬会让第三个人插队进来
    if (next) next();
    else _voiceActiveSynth = Math.max(0, _voiceActiveSynth - 1);
}

// ============================================================
// 归档
// ============================================================

/**
 * 当前语音归档该往哪写。null = 没开归档，或绑的仓库已被删。
 * ★ 这只回答"新内容往哪写"。读旧内容要用 clip 自己记的 cloudRepoId。
 */
function getVoiceArchiveTarget() {
    return typeof getGithubBinding === 'function' ? getGithubBinding('voice') : null;
}

/**
 * 归档路径。按 voiceKey 前两位分片，避免所有音频堆在一个目录里 ——
 * GitHub 的目录列表在几千个文件时会明显变慢。
 */
function _voiceArchivePath(pathPrefix, voiceKey) {
    const shard = String(voiceKey).replace(/^v\d+_/, '').slice(0, 2) || '00';
    const dir = pathPrefix ? `${pathPrefix}/` : '';
    return `${dir}${shard}/${voiceKey}.mp3`;
}

/**
 * 后台上传归档。不抛异常 —— 归档失败绝不能影响播放，本地字节已经在了。
 * @returns {Promise<boolean>} 是否上传成功
 */
async function _archiveVoiceClip(voiceKey, bytes) {
    const target = getVoiceArchiveTarget();
    if (!target) return false;
    const path = _voiceArchivePath(target.pathPrefix, voiceKey);
    try {
        await uploadGithubFile(target.repo, path, bytes, { message: `voice: ${voiceKey}` });
        await markVoiceClipArchived(voiceKey, { repo: target.repo, path });
        return true;
    } catch (error) {
        console.warn('[语音] 归档上传失败：', error.message);
        await markVoiceClipCloudFailed(voiceKey);
        return false;
    }
}

/**
 * 补一次归档。给"本地有字节但还没传上去"的片段用 —— 上传失败或当时没开归档。
 * ★ 由播放行为自然驱动：每次本地命中都顺手看一眼要不要补传，
 *   这样不需要额外维护一条重试队列。不 await。
 */
async function retryVoiceArchive(voiceKey) {
    if (!getVoiceArchiveTarget()) return false;
    const meta = await getVoiceClip(voiceKey);
    if (!meta || (meta.cloudState === 'uploaded' && meta.cloudPath)) return false;
    const bytes = await getVoiceClipBytes(voiceKey);
    if (!bytes) return false;
    return await _archiveVoiceClip(voiceKey, bytes);
}

// ============================================================
// 主入口
// ============================================================

/**
 * 只查不合成：本地或云端已经有就返回，没有返回 null。
 * 给渲染气泡时判断"要不要显示成已就绪"用，绝不会花钱。
 *
 * ★ 刻意**不返回字节**。渲染一页消息会对每条语音各调一次，
 *   如果为了判断存在就把音频读出来，50 条消息就是几兆无用的 IndexedDB 读取。
 *   hasVoiceClipBytes 只在主键上 count，不碰 blob。
 */
async function peekVoiceClip(text, profile) {
    if (!profile || !profile.speakerId) return null;
    const line = String(text || '').trim();
    if (!line) return null;
    const voiceKey = computeVoiceKey(line, profile);

    const cached = await hasVoiceClipBytes(voiceKey);
    const meta = await getVoiceClip(voiceKey);
    if (cached) {
        return { voiceKey, cached: true, source: 'local',
                 duration: (meta && meta.duration) || 0 };
    }
    if (meta && meta.cloudPath && meta.cloudRepoId) {
        return { voiceKey, cached: false, source: 'cloud',
                 duration: meta.duration || 0 };
    }
    return null;
}

/**
 * 拿到一条消息的语音字节，没有就按需产出。这是整个功能的中心入口。
 *
 * @param {object}  args
 * @param {string}  args.text     要说的那句话
 * @param {object}  args.profile  音色预设（resolveVoicePresetForSender 的返回值）
 * @param {string} [args.chatId]  归属聊天，删聊天时级联清理用
 * @param {string} [args.msgId]   归属消息，删消息时清理用
 * @param {boolean}[args.allowSynthesize=true] false = 只查缓存，绝不发合成请求
 * @param {boolean}[args.quotaOncePerDay=false] 后台自动合成传 true，超额提示当天只弹一次
 * @param {AbortSignal} [args.signal]
 *
 * @returns {Promise<{voiceKey, bytes, mime, duration, source}|null>}
 *          null = 没有音色、文本为空、或不允许合成且缓存里没有
 * @throws {Error} 合成/下载真的失败时抛出，message 已是可展示文案；
 *                 附 quotaBlocked / retryable 供上层决定怎么表现
 */
async function ensureVoiceClip({ text, profile, chatId, msgId,
                                 allowSynthesize = true, quotaOncePerDay = false,
                                 signal } = {}) {
    const line = String(text || '').trim();
    if (!line || !profile || !profile.speakerId) return null;

    const voiceKey = computeVoiceKey(line, profile);

    // ★ 单飞：同一个 key 并发进来复用同一个 Promise。放在最外层，
    //   这样"查缓存"这一步也被去重，不会有两个人同时查完都发现没有然后都去合成。
    if (_voiceInflight.has(voiceKey)) return _voiceInflight.get(voiceKey);

    const task = (async () => {
        // ── 第一层：本地有字节 ────────────────────────────────
        const local = await getVoiceClipBytes(voiceKey);
        if (local) {
            const meta = await getVoiceClip(voiceKey);
            touchVoiceClip(voiceKey);                    // 刷 LRU，不 await
            retryVoiceArchive(voiceKey).catch(() => {}); // 顺手补传，不 await
            return {
                voiceKey, bytes: local,
                mime: (meta && meta.mime) || 'audio/mpeg',
                duration: (meta && meta.duration) || 0,
                source: 'local'
            };
        }

        // ── 第二层：本地没有但云端有 ──────────────────────────
        const meta = await getVoiceClip(voiceKey);
        if (meta && meta.cloudPath && meta.cloudRepoId) {
            const repo = getGithubRepo(meta.cloudRepoId);
            if (!repo) {
                // 仓库定义被删了 —— 冗余存的 owner/repo 就是为了能说清楚该怎么办
                throw Object.assign(new Error(
                    `这条语音归档在 ${meta.cloudOwner || '?'}/${meta.cloudRepo || '?'}，`
                    + '但那个仓库的配置已被删除。到「设置 > GitHub 仓库」重新添加它即可恢复访问。'
                ), { retryable: false });
            }
            const downloaded = await downloadGithubFile(repo, meta.cloudPath, { signal });
            if (downloaded && downloaded.byteLength) {
                await restoreVoiceClipBytes(voiceKey, downloaded);
                enforceVoiceCacheLimit().catch(() => {});
                return {
                    voiceKey, bytes: downloaded,
                    mime: meta.mime || 'audio/mpeg',
                    duration: meta.duration || 0,
                    source: 'cloud'
                };
            }
            // ★ 走到这儿说明是**真 404** —— downloadGithubFile 只在确实不存在时返回 null，
            //   网络问题它会抛。云端那份没了，清掉归档标记，往下重新合成。
            await markVoiceClipCloudFailed(voiceKey);
        }

        // ── 第三层：合成 ─────────────────────────────────────
        if (!allowSynthesize) return null;

        await _acquireSynthSlot();
        let result;
        try {
            result = await synthesizeVoice({
                text: line, profile, quotaOncePerDay, signal
            });
        } finally {
            _releaseSynthSlot();
        }

        await putVoiceClip({
            voiceKey, chatId, msgId, text: line,
            presetId: profile.id || '',
            duration: result.originalDuration || result.duration || 0,
            mime: result.mime
        }, result.bytes);

        // 归档和淘汰都不阻塞返回 —— 字节已经在手上了，先让它能播
        _archiveVoiceClip(voiceKey, result.bytes).catch(() => {});
        enforceVoiceCacheLimit().catch(() => {});

        return {
            voiceKey, bytes: result.bytes, mime: result.mime,
            duration: result.originalDuration || result.duration || 0,
            source: 'synth'
        };
    })();

    _voiceInflight.set(voiceKey, task);
    try {
        const result = await task;
        // 通知界面：这条可以播了。后台预合成时气泡可能已经在屏幕上转圈
        if (result && result.bytes) _emitVoiceClipReady(voiceKey);
        return result;
    } finally {
        // 无论成败都要清掉，否则失败过一次的 key 会永久返回那个被拒的 Promise
        _voiceInflight.delete(voiceKey);
    }
}

// ============================================================
// 后台预合成
// ============================================================

/** 群聊里按说话人名字找 senderId（和打字机循环里的口径一致） */
function _findVoiceSenderId(chat, chatType, speakerName) {
    if (chatType !== 'group' || !speakerName) return null;
    const hit = ((chat && chat.members) || []).find(
        m => m.realName === speakerName || m.groupNickname === speakerName);
    return hit ? hit.id : null;
}

// 等待合成的上限。超了就放行，让消息先出来 —— 合成还在后台跑，
// 完成后气泡会通过 onVoiceClipReady 自己翻成可播。
// 定这个数：单条实测 23 秒，并发 2，所以 4 条语音约两轮 ≈ 50 秒。
// 120 秒能覆盖绝大多数正常情况，又不至于在出故障时把回复永远压住。
const VOICE_PREPARE_TIMEOUT_MS = 120000;

/**
 * 把一批新回复里的语音**全部合成好**，然后才让打字机开始逐条推送。
 *
 * ★ 调用点在打字机循环之前，而且要 await。
 *   为什么整批等完再开始，而不是边演边合成：发请求前界面上就已经挂着
 *   「"某某"正在输入中…」（chat_ai_service.js 里那个 typingIndicator），
 *   合成期间它一直显示，所以多等这一会儿看起来就是"他在输入"，很自然。
 *   反过来，如果边演边等，会在气泡弹出几条之后突然卡住 —— 那才像坏了。
 *   代价是用户多等 20 秒上下，但换来"气泡一出现就能点播放"。
 *
 * ★ 只在「收到就自动合成」开着时才等。关着的话立刻返回，气泡照常秒出，
 *   用户点播放键时再合成。
 *
 * ★ 绝不抛异常、绝不无限等。TTS 挂了或者慢得离谱，最多压 120 秒就放行，
 *   回复照常展示和落库。
 *
 * @param {Array<{content: string}>} messages 打字机即将逐条播放的那个列表
 * @param {object} chat
 * @param {string} chatType 'private' | 'group'
 */
async function prepareVoiceForMessages(messages, chat, chatType) {
    try {
        if (!Array.isArray(messages) || !messages.length || !chat) return;
        const config = _normalizeVoiceSettings(db.voiceSettings);
        // 总闸关着、没开自动合成、没填 Key 都不动手
        if (!config.enabled || !config.autoSynthesize || !config.apiKey) return;

        const jobs = [];
        messages.forEach(item => {
            const parsed = parseVoiceMessage(item && item.content);
            if (!parsed) return;
            // 太长的不自动合成 —— 一条长语音能吃掉大把额度，让用户自己点
            if (parsed.text.length > config.maxTextChars) return;

            const senderId = _findVoiceSenderId(chat, chatType, parsed.speaker);
            const profile = resolveVoicePresetForSender(chat, chatType, senderId);
            if (!profile) return;

            // quotaOncePerDay：这条路每条消息都会走，超额提示当天只弹一次
            // 单条的失败在这里咽掉 —— 一条合成不出来不该把整批都卡住，
            // 那条气泡出来时会是 idle/failed，点一下能重试
            jobs.push(ensureVoiceClip({
                text: parsed.text, profile,
                chatId: chat.id || '', msgId: '',
                quotaOncePerDay: true
            }).catch(() => null));
        });

        if (!jobs.length) return;

        // 并发上限由 ensureVoiceClip 内部的闸门管，这里只负责"等齐"
        let timer;
        await Promise.race([
            Promise.all(jobs),
            new Promise(resolve => { timer = setTimeout(resolve, VOICE_PREPARE_TIMEOUT_MS); })
        ]);
        clearTimeout(timer);
    } catch (error) {
        console.warn('[语音] 合成调度失败，消息照常展示：', error);
    }
}
