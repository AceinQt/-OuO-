// ============================================================
// chat_voice_store.js — 语音片段的本地存储层
// ============================================================
// 这一层只管"字节存在哪、还剩多少空间、该淘汰谁"，不认识 DOM，不发任何网络请求，
// 也不知道语音是怎么合成或上传的。
//
// 消费方：
//   · js/chat/chat_voice_service.js → 三层存储状态机（合成 / 归档 / 播放）
//   · js/settings/github_repos.js   → 删仓库前统计"有多少条归档在这里"
//   · js/settings/data_storage.js   → 存储占用统计
//
// 两张表（见 database.js 的 v15）：
//   voiceClips     元数据，体积极小，永久保留
//   voiceClipData  音频字节，这张才是可淘汰的本地缓存
//
// ★ 不变式：「voiceClips 里有、voiceClipData 里没有」= 云端有副本，可以拉回来。
//   所有淘汰路径都必须维持这一条 —— 没归档的 clip 丢字节时元数据要一起删，
//   否则上层会以为能下载，然后拿到一个 404。
//
// 对外符号：
//   VOICE_KEY_VERSION / computeVoiceKey / migrateVoiceKeysToV2
//   getVoiceClip / getVoiceClipBytes / hasVoiceClipBytes
//   putVoiceClip / touchVoiceClip / markVoiceClipArchived / markVoiceClipCloudFailed
//   deleteVoiceClip / deleteVoiceClipsByChat / deleteVoiceClipsByMessage
//   getVoiceCacheStats / countVoiceClipsInRepo / enforceVoiceCacheLimit
// ============================================================

// ★ 改动 text_prompt 的拼法之后，把这个版本号 +1 —— 同一段文字会合成出不同的音频，
//   旧缓存必须整体失效。这是唯一的失效手段，别指望别处会自动处理。
// v1 → v2：key 从"预设内容指纹"改成"预设 id"（见 computeVoiceKey）。
const VOICE_KEY_VERSION = 'v2';

/**
 * 把一段字符串压成 64 位十六进制。
 *
 * ★ 为什么不是单个 FNV-1a 32 位：32 位在一万条 clip 的量级上碰撞概率约 1.2%，
 *   而碰撞的后果是**播放了另一条消息的语音** —— 静默的、看不出来的错。
 *   这里拼两个独立的 32 位（不同初值 + 不同乘子）成 64 位，同量级碰撞概率可忽略。
 * ★ 为什么不用 crypto.subtle.digest：它要 secure context，明文 http 局域网调试下
 *   直接是 undefined。这个函数必须在任何环境都能跑。
 */
function _voiceHash(str) {
    let h1 = 0x811c9dc5;   // FNV-1a offset basis
    let h2 = 0xc2b2ae35;   // 另取初值，配另一个乘子，得到独立的第二个哈希
    for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 0x01000193);
        h2 = Math.imul(h2 ^ c, 0x85ebca6b);
    }
    const hex = n => (n >>> 0).toString(16).padStart(8, '0');
    return hex(h1) + hex(h2);
}

/**
 * 算一段语音的缓存键 = hash(预设 id + 台词)。
 *
 * ★ 刻意**只用预设 id**，不用预设内容的指纹。
 *   `presetId` 是"哪个声音"的身份，预设里的音色 ID / 描述 / 语速音调音量是可变的配置。
 *   早先的版本把这些内容也拌进 key，好处是"改了参数缓存自动失效"，
 *   但语音是又贵又慢的资源 —— 已经付过钱的音频，因为把语速从 0 调到 -5 就作废重合成，
 *   纯属浪费。生成过的就留着；觉得不合适由用户主动删掉重生成。
 *
 *   同时它还是安全的：不同角色用不同预设 → key 不同 → 不会串音；
 *   两个角色用同一预设说同一句话 → 同一个 key → 复用，这是对的。
 *
 * ★ 会让缓存失效的只剩两件事：改台词，或者删掉预设重建（id 变了）。
 *
 * @param {string} text    要说的那句话
 * @param {object} profile 音色预设，只取它的 id
 */
function computeVoiceKey(text, profile) {
    const line = String(text || '').trim();
    const presetId = String((profile && profile.id) || '').trim();
    // 把长度也拌进去：两段不同内容凑出同一个哈希的同时还得长度相同，难度再高一档
    const payload = `${presetId}\u0001${line.length}\u0001${line}`;
    return `${VOICE_KEY_VERSION}_${_voiceHash(payload)}`;
}

/**
 * 一次性迁移：把 v1 的片段搬到 v2 的 key 下。
 *
 * v1 的 key 含预设内容指纹，v2 只含预设 id。公式变了，老片段会全部对不上号 ——
 * 但元数据里存着 text 和 presetId，足够算出它的新 key，所以能原地搬过去，
 * 不用重新花钱合成。cloudPath 原样保留（云端文件名是老 key，但路径跟 key 不需要一致）。
 *
 * 幂等：搬完就没有 v1_ 开头的行了，再跑一次是空操作。
 * @returns {Promise<number>} 搬了几条
 */
async function migrateVoiceKeysToV2() {
    try {
        if (typeof dexieDB === 'undefined' || !dexieDB.voiceClips) return 0;
        const clips = await dexieDB.voiceClips.toArray();
        const old = clips.filter(c => c && /^v1_/.test(c.voiceKey));
        if (!old.length) return 0;

        let moved = 0;
        for (const clip of old) {
            // 没记预设 id 的算不出新 key。硬编成 hash('' + text) 会让不同角色的
            // 同一句话撞成一个 key（串音），宁可留着当孤儿等淘汰。
            if (!clip.presetId || !clip.text) continue;
            const newKey = computeVoiceKey(clip.text, { id: clip.presetId });
            if (newKey === clip.voiceKey) continue;

            const bytes = await getVoiceClipBytes(clip.voiceKey);
            await dexieDB.transaction('rw', dexieDB.voiceClips, dexieDB.voiceClipData, async () => {
                // 新 key 已经有了（两条老片段映到同一个新 key）就只删旧的，别覆盖
                const exists = await dexieDB.voiceClips.get(newKey);
                if (!exists) {
                    await dexieDB.voiceClips.put({ ...clip, voiceKey: newKey });
                    if (bytes) await dexieDB.voiceClipData.put({ voiceKey: newKey, bytes });
                }
                await dexieDB.voiceClips.delete(clip.voiceKey);
                await dexieDB.voiceClipData.delete(clip.voiceKey);
            });
            moved++;
        }
        if (moved) console.log(`[语音] 已把 ${moved} 条已合成片段迁移到新的缓存键`);
        return moved;
    } catch (error) {
        console.warn('[语音] 缓存键迁移失败（老片段会被当孤儿淘汰，不影响使用）：', error);
        return 0;
    }
}

// ============================================================
// 读
// ============================================================

/** 取元数据。返回 null 表示这段语音从没合成过 */
async function getVoiceClip(voiceKey) {
    if (!voiceKey) return null;
    try {
        return (await dexieDB.voiceClips.get(voiceKey)) || null;
    } catch (error) {
        console.warn('[语音] 读取元数据失败：', error);
        return null;
    }
}

/** 本地还有没有字节。用主键查，不会把音频读进内存 */
async function hasVoiceClipBytes(voiceKey) {
    if (!voiceKey) return false;
    try {
        return (await dexieDB.voiceClipData.where(':id').equals(voiceKey).count()) > 0;
    } catch (error) {
        console.warn('[语音] 检查本地缓存失败：', error);
        return false;
    }
}

/** 取音频字节。返回 null 表示本地没有（可能已被淘汰，去看元数据里的 cloudPath） */
async function getVoiceClipBytes(voiceKey) {
    if (!voiceKey) return null;
    try {
        const row = await dexieDB.voiceClipData.get(voiceKey);
        return row && row.bytes ? row.bytes : null;
    } catch (error) {
        console.warn('[语音] 读取音频字节失败：', error);
        return null;
    }
}

// ============================================================
// 写
// ============================================================

/**
 * 存一段新合成的语音。元数据和字节一个事务里写，避免出现"有字节没元数据"的孤儿。
 *
 * @param {object} meta  { voiceKey, chatId, msgId, text, presetId, duration, mime }
 * @param {Uint8Array} bytes
 * @returns {Promise<object|null>} 落库后的元数据
 */
async function putVoiceClip(meta, bytes) {
    if (!meta || !meta.voiceKey || !bytes || !bytes.byteLength) return null;
    const now = Date.now();
    const row = {
        voiceKey: meta.voiceKey,
        chatId: meta.chatId || '',
        msgId: meta.msgId || '',
        text: meta.text || '',
        presetId: meta.presetId || '',
        duration: Number(meta.duration) || 0,
        size: bytes.byteLength,
        mime: meta.mime || 'audio/mpeg',
        createdAt: now,
        // 刚合成出来的还没播过，但 LRU 得有个值，否则它会被当成"最久未播放"第一个淘汰掉
        lastPlayedAt: now,
        cloudState: '',
        cloudRepoId: '',
        cloudOwner: '',
        cloudRepo: '',
        cloudPath: ''
    };
    try {
        await dexieDB.transaction('rw', dexieDB.voiceClips, dexieDB.voiceClipData, async () => {
            await dexieDB.voiceClips.put(row);
            await dexieDB.voiceClipData.put({ voiceKey: row.voiceKey, bytes });
        });
        return row;
    } catch (error) {
        console.warn('[语音] 写入失败：', error);
        return null;
    }
}

/**
 * 把从云端下载回来的字节重新塞进本地缓存。
 * 元数据已经在了，只补 voiceClipData —— 不要动 cloud* 字段，那些还是对的。
 */
async function restoreVoiceClipBytes(voiceKey, bytes) {
    if (!voiceKey || !bytes || !bytes.byteLength) return false;
    try {
        await dexieDB.transaction('rw', dexieDB.voiceClips, dexieDB.voiceClipData, async () => {
            await dexieDB.voiceClipData.put({ voiceKey, bytes });
            // size 以实际字节为准，顺手纠正（理论上一致，但云端文件被换过就不一定）
            await dexieDB.voiceClips.update(voiceKey,
                { size: bytes.byteLength, lastPlayedAt: Date.now() });
        });
        return true;
    } catch (error) {
        console.warn('[语音] 回填缓存失败：', error);
        return false;
    }
}

/** 播放时调一下，刷新 LRU 时间戳 */
async function touchVoiceClip(voiceKey) {
    if (!voiceKey) return;
    try {
        await dexieDB.voiceClips.update(voiceKey, { lastPlayedAt: Date.now() });
    } catch (error) {
        console.warn('[语音] 更新播放时间失败：', error);
    }
}

/**
 * 标记已归档。
 * ★ cloudRepoId 必须记下来 —— 用户之后换了归档仓库绑定，这条旧音频还得能从
 *   原来那个仓库读回去。owner/repo 是冗余的人类可读副本：万一仓库定义被删了，
 *   至少能明确告诉用户"这条音频在 me/ouo-voice 里，请重新添加该仓库"。
 */
async function markVoiceClipArchived(voiceKey, { repo, path } = {}) {
    if (!voiceKey || !repo || !path) return false;
    try {
        await dexieDB.voiceClips.update(voiceKey, {
            cloudState: 'uploaded',
            cloudRepoId: repo.id || '',
            cloudOwner: repo.username || '',
            cloudRepo: repo.repo || '',
            cloudPath: path
        });
        return true;
    } catch (error) {
        console.warn('[语音] 标记归档失败：', error);
        return false;
    }
}

/** 上传失败。只记状态，不写 cloudPath —— 没上成功就不能让别人以为云端有 */
async function markVoiceClipCloudFailed(voiceKey) {
    if (!voiceKey) return;
    try {
        await dexieDB.voiceClips.update(voiceKey, { cloudState: 'failed' });
    } catch (error) {
        console.warn('[语音] 标记上传失败状态时出错：', error);
    }
}

// ============================================================
// 删
// ============================================================

/** 彻底删掉一段语音（两张表都删）。不动 GitHub 上的文件 */
async function deleteVoiceClip(voiceKey) {
    if (!voiceKey) return;
    try {
        await dexieDB.transaction('rw', dexieDB.voiceClips, dexieDB.voiceClipData, async () => {
            await dexieDB.voiceClips.delete(voiceKey);
            await dexieDB.voiceClipData.delete(voiceKey);
        });
    } catch (error) {
        console.warn('[语音] 删除失败：', error);
    }
}

async function _deleteVoiceClipsWhere(indexName, value) {
    try {
        const keys = await dexieDB.voiceClips.where(indexName).equals(value).primaryKeys();
        if (!keys.length) return 0;
        await dexieDB.transaction('rw', dexieDB.voiceClips, dexieDB.voiceClipData, async () => {
            await dexieDB.voiceClips.bulkDelete(keys);
            await dexieDB.voiceClipData.bulkDelete(keys);
        });
        return keys.length;
    } catch (error) {
        console.warn('[语音] 批量删除失败：', error);
        return 0;
    }
}

/** 删聊天时级联清理它的所有语音 */
function deleteVoiceClipsByChat(chatId) {
    return chatId ? _deleteVoiceClipsWhere('chatId', chatId) : Promise.resolve(0);
}

/** 删单条消息时清掉它的语音 */
function deleteVoiceClipsByMessage(msgId) {
    return msgId ? _deleteVoiceClipsWhere('msgId', msgId) : Promise.resolve(0);
}

// ============================================================
// 统计与淘汰
// ============================================================

/** 某个仓库里归档了多少条。删仓库前要拿这个数字警告用户 */
async function countVoiceClipsInRepo(repoId) {
    if (!repoId) return 0;
    try {
        return await dexieDB.voiceClips.where('cloudRepoId').equals(repoId).count();
    } catch (error) {
        return 0;
    }
}

/**
 * 缓存占用情况。
 * ★ 只遍历元数据 + 查一次主键列表，不读任何音频字节 —— 这就是拆两张表的意义。
 * @returns {Promise<{clipCount, cachedCount, cachedBytes, metaBytes, archivedCount, orphanCount}>}
 *   cachedBytes —— 本机实际存着的音频字节（只算 voiceClipData 里有的）
 *   metaBytes   —— voiceClips 元数据行本身的体积。**所有** clip 都算，包括
 *                  字节已被淘汰、只剩元数据的那些。存储统计页要用它：
 *                  元数据里带 text（TTS 原文），条数多了不是可以忽略的量。
 */
async function getVoiceCacheStats() {
    const empty = { clipCount: 0, cachedCount: 0, cachedBytes: 0, metaBytes: 0,
                    archivedCount: 0, orphanCount: 0 };
    try {
        if (typeof dexieDB === 'undefined' || !dexieDB.voiceClips) return empty;
        const [clips, cachedKeys] = await Promise.all([
            dexieDB.voiceClips.toArray(),
            dexieDB.voiceClipData.toCollection().primaryKeys()
        ]);
        const cached = new Set(cachedKeys);
        const stats = { ...empty, clipCount: clips.length };
        const clipKeys = new Set();
        clips.forEach(c => {
            clipKeys.add(c.voiceKey);
            try { stats.metaBytes += JSON.stringify(c).length; } catch (e) {}
            if (cached.has(c.voiceKey)) {
                stats.cachedCount++;
                stats.cachedBytes += Number(c.size) || 0;
            }
            if (c.cloudState === 'uploaded' && c.cloudPath) stats.archivedCount++;
        });
        // 有字节但没元数据 —— 正常情况不该出现，出现了说明有孤儿要清
        // （用上面攒的 Set 判断；原先是 filter 套 some，clip 一多就是平方级）
        stats.orphanCount = cachedKeys.filter(k => !clipKeys.has(k)).length;
        return stats;
    } catch (error) {
        console.warn('[语音] 统计缓存失败：', error);
        return empty;
    }
}

/**
 * 把本地缓存压到限额以内。
 *
 * ★ 淘汰顺序按"可恢复性"排，不是单纯按时间：
 *   第一轮只淘汰**已归档**的（云端有副本，删了还能拉回来），内部按最久未播放排序；
 *   第一轮清完还超限，第二轮才动**没归档**的（删了就真没了），同样按最久未播放。
 *   单纯 LRU 会把唯一副本删掉，而旁边可能正躺着一堆云端有备份的。
 *
 * ★ 两轮的删法不同，这是不变式要求的：
 *   已归档 → 只删 voiceClipData，留元数据（下次播放能按 cloudPath 拉回来）
 *   没归档 → 两张表都删（留元数据会让上层以为能下载，然后 404）
 *
 * @param {number} [limitMB] 不传则读 db.voiceSettings.cacheLimitMB
 * @returns {Promise<{freedBytes, evictedArchived, evictedUnarchived, remainingBytes}>}
 */
async function enforceVoiceCacheLimit(limitMB) {
    const result = { freedBytes: 0, evictedArchived: 0, evictedUnarchived: 0,
                     remainingBytes: 0 };
    try {
        if (typeof dexieDB === 'undefined' || !dexieDB.voiceClips) return result;

        const mb = Number(limitMB) > 0
            ? Number(limitMB)
            : (typeof _normalizeVoiceSettings === 'function'
                ? _normalizeVoiceSettings(db.voiceSettings).cacheLimitMB : 10);
        const limitBytes = mb * 1024 * 1024;

        const [clips, cachedKeys] = await Promise.all([
            dexieDB.voiceClips.toArray(),
            dexieDB.voiceClipData.toCollection().primaryKeys()
        ]);
        const cached = new Set(cachedKeys);

        // 只有本地还有字节的才算占空间
        let total = 0;
        const live = [];
        clips.forEach(c => {
            if (!cached.has(c.voiceKey)) return;
            total += Number(c.size) || 0;
            live.push(c);
        });
        result.remainingBytes = total;
        if (total <= limitBytes) return result;

        const byLru = (a, b) => (a.lastPlayedAt || 0) - (b.lastPlayedAt || 0);
        const archived = live.filter(c => c.cloudState === 'uploaded' && c.cloudPath).sort(byLru);
        const unarchived = live.filter(c => !(c.cloudState === 'uploaded' && c.cloudPath)).sort(byLru);

        const dropDataOnly = [];
        const dropBoth = [];
        let freed = 0;
        for (const c of archived) {
            if (total <= limitBytes) break;
            dropDataOnly.push(c.voiceKey);
            const n = Number(c.size) || 0;
            total -= n;
            freed += n;
        }
        for (const c of unarchived) {
            if (total <= limitBytes) break;
            dropBoth.push(c.voiceKey);
            const n = Number(c.size) || 0;
            total -= n;
            freed += n;
        }

        if (dropDataOnly.length || dropBoth.length) {
            await dexieDB.transaction('rw', dexieDB.voiceClips, dexieDB.voiceClipData, async () => {
                if (dropDataOnly.length) await dexieDB.voiceClipData.bulkDelete(dropDataOnly);
                if (dropBoth.length) {
                    await dexieDB.voiceClipData.bulkDelete(dropBoth);
                    await dexieDB.voiceClips.bulkDelete(dropBoth);
                }
            });
        }

        result.evictedArchived = dropDataOnly.length;
        result.evictedUnarchived = dropBoth.length;
        result.remainingBytes = total;
        result.freedBytes = freed;
        return result;
    } catch (error) {
        console.warn('[语音] 缓存淘汰失败：', error);
        return result;
    }
}
