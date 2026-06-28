// === history_window.js ===
// ★ 消息按需加载核心：尾部固定窗口 + Dexie 直查
// 设计：
//   - 内存里 chat.history 只保留"最近 N 条"（N = max(1000, chat.maxMemory)）
//   - chat.msgCount（冗余字段，随 char 表读写）= Dexie messages 表真实总数
//   - 任何需要"全量历史"的场景（搜索、总结切片、撤回追溯、删除区间预览、通话 session）
//     不依赖内存数组，直接调用本模块的 Dexie 查询函数
//   - 需要把某段范围拉进内存时用 ensureRangeLoaded(chat, start, end)
//   - chat.history.length 不再代表真实总数，所有用总数的地方改读 chat.msgCount
//     或调用 getMsgCount(chat) 兜底

// ── 默认保留窗口大小 ──────────────────────────────────────
const HISTORY_KEEP_MIN = 1000;

function _keepN(chat) {
    return Math.max(HISTORY_KEEP_MIN, chat.maxMemory || 500);
}

// ── 加载最近 N 条进 chat.history（openChatRoom 入口调用） ─
async function loadRecentMessages(chat) {
    if (!chat) return;
    const n = _keepN(chat);
    try {
        // 按 timestamp 升序取最近 n 条（messages 表已建 timestamp 索引）
        const recent = await window.dexieDB.messages
            .where('chatId').equals(chat.id)
            .reverse()              // 从新到旧
            .limit(n)
            .toArray();
        recent.reverse();           // 还原成时间升序（老→新），与原 history 习惯一致
        chat.history = recent;
        chat._historyLoadedAt = Date.now();
        // 同步刷新冗余字段（首次加载或字段缺失时）
        if (typeof chat.msgCount !== 'number') {
            chat.msgCount = await window.dexieDB.messages.where('chatId').equals(chat.id).count();
        }
    } catch (e) {
        console.error('❌ loadRecentMessages 失败:', e);
        chat.history = chat.history || [];
    }
}

// ── 完整加载（兜底，谨慎用：12w 条会吃内存）──────────────
async function ensureHistoryFullyLoaded(chat) {
    if (!chat) return;
    if (chat._fullyLoaded) return;
    try {
        const all = await window.dexieDB.messages.where('chatId').equals(chat.id).toArray();
        all.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        chat.history = all;
        chat._fullyLoaded = true;
        chat.msgCount = all.length;
    } catch (e) {
        console.error('❌ ensureHistoryFullyLoaded 失败:', e);
    }
}

// ── 确保内存里包含 [start, end) 这段（0-based，左闭右开）─
// 用于：summary 切片、删除区间预览、搜索跳转定位
// 加载完后 chat.history 至少覆盖该范围；若已加载范围不足，会拉一次补齐
async function ensureRangeLoaded(chat, start, end) {
    if (!chat) return;
    start = Math.max(0, start);
    end = Math.max(start, end);
    if (end <= start) return;

    // 若尾部窗口已覆盖该范围（range 在最近 N 条内），无需加载
    const total = (typeof chat.msgCount === 'number') ? chat.msgCount : await getMsgCount(chat);
    const tailStart = Math.max(0, total - chat.history.length);
    // chat.history[0] 对应全局序号 tailStart
    if (start >= tailStart && end <= tailStart + chat.history.length) {
        return; // 已覆盖
    }

    // 范围超出当前内存窗口：从 Dexie 拉该段，合并进 chat.history
    try {
        // 按 timestamp 升序取全部，再切片（messages 表无全局序号，只能排序后切）
        // 对 12w 条会卡 1-2 秒，仅在总结/删除/跳转等低频操作触发，可接受
        const all = await window.dexieDB.messages.where('chatId').equals(chat.id).toArray();
        all.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        chat.history = all;
        chat._fullyLoaded = true;
        chat.msgCount = all.length;
    } catch (e) {
        console.error('❌ ensureRangeLoaded 失败:', e);
    }
}

// ── 获取真实总数（优先用冗余字段，缺失时查 Dexie）────────
async function getMsgCount(chat) {
    if (!chat) return 0;
    if (typeof chat.msgCount === 'number') return chat.msgCount;
    try {
        chat.msgCount = await window.dexieDB.messages.where('chatId').equals(chat.id).count();
        return chat.msgCount;
    } catch (e) {
        console.error('❌ getMsgCount 失败:', e);
        return 0;
    }
}

// ── 向上滚加载更旧的一页（prepend 到内存）────────────────
// 返回拉到的消息数组（时间升序）；无更旧消息时返回 []
async function loadOlderMessagesFromDB(chat, count) {
    if (!chat || !chat.history || chat.history.length === 0) return [];
    const oldestTs = chat.history[0].timestamp || 0;
    try {
        const older = await window.dexieDB.messages
            .where('chatId').equals(chat.id)
            .and(m => (m.timestamp || 0) < oldestTs)
            .reverse()
            .limit(count)
            .toArray();
        older.reverse(); // 升序
        if (older.length > 0) {
            // prepend（注意：若已 _fullyLoaded 则没必要）
            chat.history = older.concat(chat.history);
        }
        return older;
    } catch (e) {
        console.error('❌ loadOlderMessagesFromDB 失败:', e);
        return [];
    }
}

// ── Dexie 直查：按 id 找单条消息（撤回/编辑/引用用）─────
async function findMessageById(chatId, msgId) {
    try {
        // 内存命中优先（当前会话很快）
        const chat = (db.characters || []).find(c => c.id === chatId) || (db.groups || []).find(g => g.id === chatId);
        if (chat && chat.history) {
            const hit = chat.history.find(m => m.id === msgId);
            if (hit) return hit;
        }
        // 内存没有直接查表
        return await window.dexieDB.messages.get(msgId);
    } catch (e) {
        console.error('❌ findMessageById 失败:', e);
        return null;
    }
}

// ── Dexie 直查：从后往前找最近一条符合 predicate 的消息 ─
// 用于：撤回找最近 assistant、重生成找最近 user、礼物/转账卡片定位、proactive 找最近真实消息
async function findLastMessageMatching(chatId, predicate, limit = 50) {
    try {
        // 先扫内存尾部（最近 N 条通常够）
        const chat = (db.characters || []).find(c => c.id === chatId) || (db.groups || []).find(g => g.id === chatId);
        if (chat && chat.history && chat.history.length > 0) {
            for (let i = chat.history.length - 1; i >= 0; i--) {
                if (predicate(chat.history[i])) return chat.history[i];
            }
        }
        // 内存不够再查 Dexie（reverse + limit 避免全量）
        const recent = await window.dexieDB.messages
            .where('chatId').equals(chatId)
            .reverse()
            .limit(limit)
            .toArray();
        for (const m of recent) {
            if (predicate(m)) return m;
        }
        // limit 内没找到，扫全量（极端情况）
        const all = await window.dexieDB.messages.where('chatId').equals(chatId).reverse().toArray();
        for (const m of all) {
            if (predicate(m)) return m;
        }
        return null;
    } catch (e) {
        console.error('❌ findLastMessageMatching 失败:', e);
        return null;
    }
}

// ── Dexie 直查：通话 session 全部消息（折叠展开用）──────
async function getCallSessionMessages(chatId, sessionId) {
    try {
        return await window.dexieDB.messages
            .where('chatId').equals(chatId)
            .and(m => m.callSessionId === sessionId)
            .toArray();
    } catch (e) {
        console.error('❌ getCallSessionMessages 失败:', e);
        return [];
    }
}

// ── Dexie 直查：搜索（按 chatId 全量再 filter）──────────
// 12w 条会卡 1-2 秒，仅用户主动搜索时触发，可接受
async function searchMessagesInChat(chatId, predicate) {
    try {
        const all = await window.dexieDB.messages.where('chatId').equals(chatId).toArray();
        return all.filter(predicate);
    } catch (e) {
        console.error('❌ searchMessagesInChat 失败:', e);
        return [];
    }
}

// ── 按 timestamp 范围找消息序号（summary 按时间用）──────
// 返回 { start, end }（1-based，左闭右闭），找不到返回 { start:-1, end:-1 }
async function findRangeByTimeInDB(chatId, startTs, endTs) {
    try {
        const all = await window.dexieDB.messages.where('chatId').equals(chatId).toArray();
        all.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        let start = -1, end = -1;
        for (let i = 0; i < all.length; i++) {
            const ts = all[i].timestamp || 0;
            if (start === -1 && ts >= startTs && ts <= endTs) { start = i + 1; end = i + 1; }
            else if (start !== -1 && ts >= startTs && ts <= endTs) { end = i + 1; }
            else if (start !== -1 && ts > endTs) break;
        }
        return { start, end };
    } catch (e) {
        console.error('❌ findRangeByTimeInDB 失败:', e);
        return { start: -1, end: -1 };
    }
}

// ── 按全局序号取一段消息（summary 切片用，1-based 左闭右闭）─
async function getMessagesByRange(chatId, start1Based, end1Based) {
    try {
        const startIdx = start1Based - 1;
        const endIdx = end1Based; // slice 右开
        // 优先走内存（当前会话尾部命中）
        const chat = (db.characters || []).find(c => c.id === chatId) || (db.groups || []).find(g => g.id === chatId);
        if (chat && chat._fullyLoaded && chat.history) {
            return chat.history.slice(startIdx, endIdx);
        }
        const total = await getMsgCount(chat);
        const tailStart = total - (chat?.history?.length || 0);
        if (chat && chat.history && startIdx >= tailStart && endIdx <= tailStart + chat.history.length) {
            return chat.history.slice(startIdx - tailStart, endIdx - tailStart);
        }
        // 内存不覆盖，全量拉再切（低频操作）
        const all = await window.dexieDB.messages.where('chatId').equals(chatId).toArray();
        all.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        if (chat) { chat.history = all; chat._fullyLoaded = true; chat.msgCount = all.length; }
        return all.slice(startIdx, endIdx);
    } catch (e) {
        console.error('❌ getMessagesByRange 失败:', e);
        return [];
    }
}

// ── 最近 N 条（AI 上下文 / 记忆检索 ctx 窗口用）──────────
async function getRecentMessages(chat, n) {
    if (!chat) return [];
    if (chat.history && chat.history.length > 0) {
        return chat.history.slice(-n);
    }
    // 内存空，查 Dexie
    try {
        const recent = await window.dexieDB.messages
            .where('chatId').equals(chat.id)
            .reverse().limit(n).toArray();
        recent.reverse();
        return recent;
    } catch (e) {
        console.error('❌ getRecentMessages 失败:', e);
        return [];
    }
}

// ── 冗余字段维护：消息写入/删除后同步更新 chat.msgCount + lastMsgPreview
// 由 saveMessageToDB 等调用方在写完 Dexie 后触发
async function _refreshChatMeta(chatId, chatType, newLastMsg) {
    try {
        const chat = (chatType === 'private')
            ? (db.characters || []).find(c => c.id === chatId)
            : (db.groups || []).find(g => g.id === chatId);
        if (!chat) return;
        // msgCount
        const cnt = await window.dexieDB.messages.where('chatId').equals(chatId).count();
        chat.msgCount = cnt;
        // lastMsgPreview：优先用传入的 newLastMsg，否则查最近一条
        let last = newLastMsg;
        if (!last) {
            last = await window.dexieDB.messages.where('chatId').equals(chatId).reverse().limit(1).first();
        }
        if (last) {
            chat.lastMsgPreview = {
                content: last.content,
                timestamp: last.timestamp || 0,
                role: last.role,
                isUserStatusNotif: !!last.isUserStatusNotif,
                id: last.id
            };
        } else {
            chat.lastMsgPreview = null;
        }
    } catch (e) {
        console.warn('⚠️ _refreshChatMeta 失败:', e);
    }
}

// 暴露到 window（与项目其他模块风格一致）
window.loadRecentMessages = loadRecentMessages;
window.ensureHistoryFullyLoaded = ensureHistoryFullyLoaded;
window.ensureRangeLoaded = ensureRangeLoaded;
window.getMsgCount = getMsgCount;
window.loadOlderMessagesFromDB = loadOlderMessagesFromDB;
window.findMessageById = findMessageById;
window.findLastMessageMatching = findLastMessageMatching;
window.getCallSessionMessages = getCallSessionMessages;
window.searchMessagesInChat = searchMessagesInChat;
window.findRangeByTimeInDB = findRangeByTimeInDB;
window.getMessagesByRange = getMessagesByRange;
window.getRecentMessages = getRecentMessages;
window._refreshChatMeta = _refreshChatMeta;
