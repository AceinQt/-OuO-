// ============================================================
// chat_voice_call.js — 通话里的语音：气泡自动连播
// ============================================================
// 聊天室里的语音是"点一下播放键才出声"；电话里没有这个动作 —— 对面是直接说话的。
// 所以这里的模型是：一轮回复里的每句对白各自合成一份音频，
// **气泡弹出即播放，播完再弹下一句**，串成一条自动连播链。
//
// ── 三条定死的规则 ──────────────────────────────────────────
//
// 1. **通话中的对白一律存成语音气泡**（`[名字的语音：…]`），AI 和用户都是，
//    和开关无关。开关只管"要不要出声"。关着的时候气泡照样是语音条，
//    用户事后想听，点一下就能补合成 —— 这是把通话记录留成可回放资产的关键。
//
// 2. **旁白不发声**。视频通话里第三人称描写的那些行只走原来的打字机延迟。
//
// 3. **节奏换计时源**。要出声的气泡：先等它的音频合成好（这段时间界面上
//    那圈 15 根竖条的波形一直在动，看起来就是"对方在想"），弹出，然后等它播完
//    才进下一条。不出声的气泡：照旧 `calculateTypingDelay` 按字数估。
//
// ── 为什么不直接用 prepareVoiceForMessages ──────────────────
// 那个是 `Promise.all` 整批等齐才放行，而且要求全局的「收到就自动合成」开着。
// 通话要的是**逐条 await**：第一句好了就先播，它播的那几秒里后面几句还在合成，
// 越往后越可能 0 等待。整批等齐的话 3 句要等两轮 ≈ 50 秒才开口。
// 开关也该独立于聊天室那个 —— 用户完全可能只想让电话出声。
// 合成本身仍然走 `ensureVoiceClip`（单飞去重、`VOICE_CONCURRENCY` 闸门都在它里面）。
//
// ── "只抠一次"是这个文件存在的主要理由 ──────────────────────
// 合成用的文案和最终写进气泡的文案必须**一模一样**，差一个引号、多一个方括号，
// 算出来的缓存键就对不上 —— 症状是钱花了、音频也合成了，气泡却死活找不到它，
// 而且完全静默。所以这里的做法不是"两处调同一个函数"（那仍会因为调用点漂移），
// 而是**预扫描就是唯一的抠取**：它把抠好的文案连同合成任务一起交给
// chat_ai_service.js，循环里直接用那份文案拼气泡，一个字都不重新推导。
//
// 对外符号：
//   buildCallVoiceContent / extractCallSpeechFromItem / extractCallSpeechFromLine
//   planCallVoiceForItems / planCallVoiceForLines
//   isCallVoiceOn / callVoiceBlockReason
//   waitCallVoiceClip / speakCallBubble / stopCallVoice
//   toggleCallVoiceSwitch / updateCallVoiceBtn
// ============================================================

// ============================================================
// 文案抠取
// ============================================================

/**
 * 拼一条语音消息。**全项目拼这个格式只有这一处**（`sendMyVoiceMessage` 那条是
 * 用户手动发语音的老路，格式相同但不经过通话）。
 * @param {string} name   说话人真名
 * @param {string} speech 台词
 */
function buildCallVoiceContent(name, speech) {
    return `[${name}的语音：${speech}]`;
}

/**
 * 去掉台词外面那层壳：尾巴上多余的 `]`、包裹的各种引号。
 * ★ 照搬 chat_ai_service.js 视频分支原来那两行 replace，外加一次 trim ——
 *   末尾留空格不会影响缓存键（computeVoiceKey / parseVoiceMessage 两边都 trim 过），
 *   但会让存进去的 content 多一截看不见的空白，没必要。
 */
function _cleanCallSpeech(raw) {
    let speech = String(raw || '').trim();
    speech = speech.replace(/\]+$/, '');
    speech = speech.replace(/^["'「『“”‘’]+/, '').replace(/["'」』“”‘’]+$/, '');
    return speech.trim();
}

/**
 * 从一条 `getMixedContent` 切出来的消息里抠台词（语音通话走的普通分支用）。
 *
 * ★ 这里的模式必须和 chat_ai_service.js 普通分支的 `standardMsgMatch` 认同一批东西。
 *   多认一点是安全的（大不了白合成一句），少认会让"预扫描说不是对白、循环说是"，
 *   那条就没声音 —— 所以顺手把 `的语音` 也认了：模型偶尔会照着上文的格式回写。
 *
 * @returns {string|null} null = 这不是一句对白
 */
function extractCallSpeechFromItem(content) {
    const raw = String(content || '');
    const match = raw.match(/\[(?:.*?)(?:的消息|的语音)[:：]([\s\S]+?)\]/);
    if (!match) return null;
    const speech = _cleanCallSpeech(match[1]);
    return speech || null;
}

/**
 * 从一行原始文本里抠台词（视频通话走的逐行分支用）。
 *
 * ★ 这个函数必须**连跳过规则一起**复刻 chat_ai_service.js 视频分支循环的判定，
 *   否则会出现"预扫描合成了、循环却把这行跳过了"（白花一次钱）或者反过来
 *   "循环当成对白、预扫描没准备"（那条没声音，退回文字节奏）。
 *   两种都不崩，但都是静默的，所以宁可啰嗦也要在这里写全。
 *
 * ★ 特别注意「更新状态为」那一条：提示词的示例里写着
 *   `>>> ...嗯。[某某更新状态为：垂眸掩饰情绪]`，这种行会被状态分支整条吃掉、
 *   根本走不到对白分支。漏了这条判断就会稳定白合成。
 *
 * @returns {string|null} null = 这行不是对白（旁白、状态更新、噪声行）
 */
function extractCallSpeechFromLine(rawLine) {
    const line = String(rawLine || '').trim();

    // —— 循环开头那批噪声过滤，逐条对应 ——
    if (!line || line === '[' || line === ']' || line === '[]' || line === '][') return null;
    if (/^[\d]+\.\s/.test(line)) return null;
    if (line.includes('意图：') || line.includes('情绪：') || line.includes('锚点：')) return null;
    if (line.includes('问题：') || line.includes('优点：')) return null;

    // —— 状态更新优先于对白，命中就整条不是对白 ——
    if (/\[?.*?更新状态为[:：](.*?)(?:\]|$)/.test(line)) {
        const statusMatch = line.match(/\[?.*?更新状态为[:：](.*?)(?:\]|$)/);
        const newStatus = statusMatch[1].trim().replace(/[\])]+$/, '').trim();
        if (newStatus) return null;
    }

    if (line.startsWith('>>>')) {
        const speech = _cleanCallSpeech(line.substring(3));
        return speech || null;
    }
    if (/^\[.*?(?:的消息|的语音)[:：][\s\S]+?\]$/.test(line)) {
        const match = line.match(/^\[.*?(?:的消息|的语音)[:：]([\s\S]+?)\]$/);
        const speech = _cleanCallSpeech(match ? match[1] : line);
        return speech || null;
    }
    return null;   // 剩下的都是旁白
}

// ============================================================
// 开关
// ============================================================

/**
 * 这个角色现在能不能开通话语音？开不了就说清楚缺什么。
 *
 * ★ 刻意**不看** `voiceSettings.autoSynthesize`（聊天室那个「收到就自动合成」）。
 *   两个开关管的是两件事：那个决定普通聊天要不要自动烧钱，这个决定电话要不要出声。
 *   用户完全可能只想要后者。
 *
 * @returns {string} '' = 可以开；非空 = 给用户看的原因
 */
function callVoiceBlockReason(chat) {
    if (!chat) return '没有找到当前角色';
    if (typeof _normalizeVoiceSettings !== 'function') return '语音模块没加载好，刷新一下';

    const config = _normalizeVoiceSettings(typeof db !== 'undefined' ? db.voiceSettings : null);
    if (!config.enabled) return '语音总开关是关的，去「设置 > 语音」里打开';

    const profile = typeof resolveVoicePresetForSender === 'function'
        ? resolveVoicePresetForSender(chat, 'private')
        : null;
    if (!profile) return '这个角色还没选音色，在聊天设置的「语音」里选一个';

    if (typeof voicePresetReady === 'function' && !voicePresetReady(profile)) {
        return `音色「${profile.name || '未命名'}」还没填 API Key 或音色 ID`;
    }
    return '';
}

/** 通话语音此刻是不是真的在生效（开关开着 **且** 配置齐备） */
function isCallVoiceOn(chat) {
    if (!chat || !chat.callVoiceEnabled) return false;
    return !callVoiceBlockReason(chat);
}

// ============================================================
// 合成队列
// ============================================================

/**
 * 把一句台词丢进合成队列，拿一个 Promise 回来。
 *
 * ★ 不 await、不 Promise.all：整轮的句子一次性全丢进去，`ensureVoiceClip` 内部的
 *   闸门会按 `VOICE_CONCURRENCY` 排队。调用方逐条 await，所以第一句合成好就能开播，
 *   后面几句在它播放期间继续合成。
 * ★ `quotaOncePerDay: true`：额度打满时一轮 4 句会弹 4 次 toast，很吵。
 * ★ 单条失败咽掉返回 null —— 一句合不出来不该把整通电话卡住，
 *   那条气泡会退回文字节奏，用户事后点播放键能重试。
 * ★ 通话里**不看** `maxTextChars`：电话里把一句长台词砍成没声音，比多花点钱难受。
 */
function _queueCallVoiceJob(text, chat, profile) {
    if (typeof ensureVoiceClip !== 'function') return null;
    return ensureVoiceClip({
        text,
        profile,
        chatId: (chat && chat.id) || '',
        msgId: '',
        quotaOncePerDay: true
    }).catch(error => {
        console.warn('[通话语音] 这句没合成出来，退回文字：', error && error.message);
        return null;
    });
}

/** 私聊角色的音色。通话只支持单人聊天，所以这里写死 'private'。 */
function _callVoiceProfile(chat) {
    return typeof resolveVoicePresetForSender === 'function'
        ? resolveVoicePresetForSender(chat, 'private')
        : null;
}

/**
 * 预扫描一轮回复（普通分支：语音通话）。
 *
 * ★ 无论开关开没开都会抠文案 —— 规则一：通话中的对白一律存成语音气泡。
 *   开关只决定 `job` 是不是 null（要不要花钱合成）。
 *
 * @param {Array<{type:string, content:string}>} items 打字机即将逐条推的那个列表
 * @param {object} chat 角色对象
 * @returns {Map<object, {text: string, job: Promise|null}>} key 是 item 对象本身
 */
function planCallVoiceForItems(items, chat) {
    const plans = new Map();
    if (!Array.isArray(items) || !chat) return plans;

    const speak = isCallVoiceOn(chat);
    const profile = speak ? _callVoiceProfile(chat) : null;

    items.forEach(item => {
        const text = extractCallSpeechFromItem(item && item.content);
        if (!text) return;
        plans.set(item, {
            text,
            job: (speak && profile) ? _queueCallVoiceJob(text, chat, profile) : null
        });
    });
    return plans;
}

/**
 * 预扫描一轮回复（逐行分支：视频通话）。
 * 返回的数组和 `lines` **下标一一对应**，不是对白的位置是 null。
 *
 * ★ 只在 `callMode === 'video'` 时调。那个分支是和线下模式共用的，
 *   线下模式没有通话界面，误触发就会平白给线下剧情配音。
 */
function planCallVoiceForLines(lines, chat) {
    if (!Array.isArray(lines) || !chat) return [];

    const speak = isCallVoiceOn(chat);
    const profile = speak ? _callVoiceProfile(chat) : null;

    return lines.map(line => {
        const text = extractCallSpeechFromLine(line);
        if (!text) return null;
        return {
            text,
            job: (speak && profile) ? _queueCallVoiceJob(text, chat, profile) : null
        };
    });
}

// ============================================================
// 连播
// ============================================================

// 中止信号。挂断 / AI 主动挂断 / 重新生成时拉一下，正在等合成的那一条立刻放行。
//
// ★ 为什么必须能中止等待：一次合成最长能跑 180 秒（VOICE_TIMEOUT_MS），而
//   `isGenerating` 要等 handleAiReplyContent 整个返回才解锁。挂断后还傻等的话，
//   用户回到聊天室会发现三分钟内发不出消息，且毫无提示。
// ★ 中止的只是"等待"，底下的合成请求仍然跑完并写进缓存 —— 钱已经花了，
//   至少让它变成一份能回放的音频，别白扔。
let _callVoiceAbort = null;

function _callVoiceAbortSignal() {
    if (!_callVoiceAbort) {
        let resolve;
        const promise = new Promise(r => { resolve = r; });
        _callVoiceAbort = { promise, resolve };
    }
    return _callVoiceAbort.promise;
}

/** 中断连播：停掉正在响的那条，并把所有还在等合成的位置放行。 */
function stopCallVoice() {
    if (_callVoiceAbort) {
        _callVoiceAbort.resolve();
        // 置空而不是复用：下一轮 _callVoiceAbortSignal() 会造一个全新的，
        // 否则这一轮的"已中止"状态会永久粘在后面每一轮上。
        _callVoiceAbort = null;
    }
    if (typeof stopVoicePlayback === 'function') stopVoicePlayback();
}

/**
 * 等一条台词的音频合成好。**在弹气泡之前调** —— 这就是"气泡弹出即播放"的前提。
 * @param {{text:string, job:Promise|null}|null|undefined} plan planCallVoiceForXxx 的一项
 * @returns {Promise<object|null>} null = 不出声（没开开关 / 合成失败 / 被挂断打断）
 */
async function waitCallVoiceClip(plan) {
    if (!plan || !plan.job) return null;
    const clip = await Promise.race([
        plan.job,
        _callVoiceAbortSignal().then(() => null)
    ]);
    return (clip && clip.bytes) ? clip : null;
}

/**
 * 播一条已经弹出来的语音气泡，**resolve 在播完那一刻**。
 *
 * ★ `addMessageBubble` 不返回 DOM 元素，所以按气泡工厂写进去的 data 属性回查 ——
 *   和 `regenerateVoiceClip` / `downloadVoiceClip` 用的是同一个套路。
 * ★ 找不到气泡就直接返回：通话中途可能被重新生成触发了整页重渲染。
 */
async function speakCallBubble(msgId, clip) {
    if (!clip || !msgId || typeof playVoiceClipOnBubble !== 'function') return;
    const bubble = document.querySelector(
        `.voice-bubble[data-voice-msg-id="${msgId}"]`);
    if (!bubble) return;
    await playVoiceClipOnBubble(bubble, clip);
}

// ============================================================
// 工具栏那颗按钮
// ============================================================

/** 通话只支持私聊，所以固定从 db.characters 里取当前角色。 */
function _callVoiceCurrentChat() {
    if (typeof db === 'undefined' || typeof currentChatId === 'undefined') return null;
    return (db.characters || []).find(c => c.id === currentChatId) || null;
}

/** 按当前状态刷新按钮的颜色和文字。进通话界面、切开关之后都要调。 */
function updateCallVoiceBtn() {
    const btn = document.getElementById('call-voice-btn');
    if (!btn) return;

    const chat = _callVoiceCurrentChat();
    const on = isCallVoiceOn(chat);

    // ★ 用 is-on 而不是 active：CSS 里 `.call-tool-item:active` 已经是"按下去"的
    //   伪类了，再来一个 `.active` 类，源码里两条规则长得几乎一样，必然看花眼。
    btn.classList.toggle('is-on', on);

    const label = btn.querySelector('span');
    if (label) label.textContent = on ? '语音 · 开' : '语音 · 关';

    const reason = callVoiceBlockReason(chat);
    btn.title = on
        ? '关闭后对方只出文字（气泡仍是语音条，事后可手动播放）'
        : (reason || '打开后对方说的每句话都会自动合成并播放');
}

/**
 * 点了那颗按钮。
 *
 * ★ 切完**不收菜单**。另外两项（通话记录 / 重新生成）点完就该收，因为它们是
 *   一次性动作；这个是开关，收掉的话用户看不到按钮变色，只能靠 toast 猜。
 * ★ 开启时顺手解锁播放器：这次点击是真实用户手势，而连播时的 play() 没有手势，
 *   iOS 会拦。漏了这一步的症状是安卓和桌面全对、iPhone 一声不响且不报错。
 */
async function toggleCallVoiceSwitch() {
    const chat = _callVoiceCurrentChat();
    if (!chat) return;

    if (chat.callVoiceEnabled) {
        chat.callVoiceEnabled = false;
        stopCallVoice();
        showToast('已关闭，对方接下来只出文字');
    } else {
        const reason = callVoiceBlockReason(chat);
        if (reason) { showToast(reason); return; }
        chat.callVoiceEnabled = true;
        unlockVoiceAudio();          // 同步，别 await（见 unlockVoiceAudio 的注释）
        showToast('已开启，下一句开始出声（首句要等合成，约 20 秒）');
    }

    updateCallVoiceBtn();
    if (typeof saveSingleChat === 'function') {
        await saveSingleChat(currentChatId, 'private');
    }
}
