// ==========================================
// lazy_load.js — 懒加载改造专用文件（Step 0 + 1 + 2）
// ------------------------------------------
// Step 2 起，loadData 会读取下面的开关。开关默认【关】，应用行为与改造前完全一致。
// 要启用懒加载：控制台跑 window.LAZY_LOAD = true 然后刷新；或在下面这行直接改成 true。
// 要回滚：改回 false 刷新即可，数据无损。
// ==========================================

// ★★★ 总开关 + 窗口大小。窗口必须 > maxMemory 上限（已定 maxMemory 上限 1000、窗口 1500）。
//   开关从 localStorage 读，方便控制台切换：
//     开启：localStorage.setItem('LAZY_LOAD','1')   然后刷新
//     关闭：localStorage.setItem('LAZY_LOAD','0')   然后刷新
window.LAZY_LOAD = true;
window.LAZY_LOAD_LIMIT = 1500;

// ★★★ 铁律：本文件内任何从 DB 取消息的函数，排序只能用下面这一行（原样抄自 database.js:235），
//          绝不"改进"、绝不按 role/type/id 排序。上次崩盘就是有人改了排序。
//          （a.timestamp || 0） - （b.timestamp || 0）  ← 升序，缺失 timestamp 视为 0
function _sortByTimestampExact(a, b) {
    return (a.timestamp || 0) - (b.timestamp || 0);
}

// ──────────────────────────────────────────
// Step 1：新加载路径（未接入）
//   用 chatId 索引 + timestamp 反向，取最近 limit 条；
//   返回前用铁律那一行排序，保证与 loadData 现有顺序一致。
// ──────────────────────────────────────────
window.loadRecentMessages = async function (chatId, limit = 1500) {
    if (!window.dexieDB) throw new Error('dexieDB 未就绪');
    // ★ 用复合索引 [chatId+timestamp] 直接按时间倒序取最近 limit 条
    //   between([chatId, -Inf], [chatId, +Inf]) 圈定该 chat 的全部条目，
    //   .reverse() 变降序（最新在前），.limit() 只读 limit 条（不全量读盘）。
    //   ★ 只读 limit 条进内存，这是省内存的关键。
    const rows = await window.dexieDB.messages
        .where('[chatId+timestamp]')
        .between([chatId, Number.NEGATIVE_INFINITY], [chatId, Number.POSITIVE_INFINITY], true, true)
        .reverse()
        .limit(limit)
        .toArray();
    // 结果是降序（最新在前），翻回升序；再用铁律排序兜底（与现有 loadData 完全一致）
    rows.reverse();
    rows.sort(_sortByTimestampExact);
    return rows;
};

// ──────────────────────────────────────────
// Step 3：取"比当前内存窗口更旧"的一页（供往上翻历史调用）
//   oldestTimestamp = 当前 chat.history[0].timestamp
//   inMemoryIds     = 当前内存里所有消息 id 的 Set（dedup 用，防边界缝隙/重复）
//   返回：紧邻窗口、更旧的最多 limit 条，升序，timestamp 全部 <= oldestTimestamp
// ──────────────────────────────────────────
window.fetchOlderMessages = async function (chatId, oldestTimestamp, inMemoryIds, limit) {
    if (!window.dexieDB) throw new Error('dexieDB 未就绪');
    // between([chatId,-Inf],[chatId,oldestTs], 含下, 含上) → timestamp <= oldestTs
    // .reverse().limit(limit+200) → 从最接近 oldestTs 的开始取一批（含等时间戳边界）
    const buf = await window.dexieDB.messages
        .where('[chatId+timestamp]')
        .between([chatId, Number.NEGATIVE_INFINITY], [chatId, oldestTimestamp], true, true)
        .reverse()
        .limit(limit + 200)
        .toArray();
    const fresh = buf.filter(r => !inMemoryIds.has(r.id)); // 去掉已在内存的
    fresh.sort(_sortByTimestampExact);
    return fresh.slice(-limit); // 取最接近窗口的那一页（升序）
};

// ──────────────────────────────────────────
// Step 4：DB 搜索（日期 / 关键词 / 二者兼备）
//   dateStr: 'YYYY-MM-DD' 或 空；keyword: string 或 空
//   返回按 timestamp 降序的匹配数组（与现有 UI 顺序一致：最新在前）
//   流式 each() 扫描，不把全表装入内存；命中 push 到结果里
// ──────────────────────────────────────────
window.searchMessagesInDB = async function (chatId, dateStr, keyword) {
    if (!window.dexieDB) throw new Error('dexieDB 未就绪');

    // 复用现有搜索的"不可见系统消息"规则（原样抄自 chat_search.js:85）
    const invisibleRegex = /\[.*?更新状态为[:：].*?\]|\[system:.*?\]|\[.*?(?:接收|退回).*?的转账\]|\[.*?已接收礼物\]|\[系统情景通知：.*?\]/;

    // 日期范围（当天 00:00 ~ 次日 00:00）
    let tsLo = Number.NEGATIVE_INFINITY;
    let tsHi = Number.POSITIVE_INFINITY;
    if (dateStr) {
        const [y, m, d] = dateStr.split('-').map(Number);
        tsLo = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
        tsHi = new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
    }

    const kw = (keyword || '').toLowerCase();
    const results = [];

    // 流式扫描（有日期范围时用索引精准定位，否则扫该 chat 的全部）
    await window.dexieDB.messages
        .where('[chatId+timestamp]')
        .between([chatId, tsLo], [chatId, tsHi], true, true)
        .each(msg => {
            // 复用 chat_search.js:88-95 的过滤规则
            if (msg.role === 'system' && msg.isHidden) return;
            if (typeof msg.content !== 'string') return;
            if (invisibleRegex.test(msg.content)) return;
            if (msg.isWithdrawn) return;

            if (kw) {
                let contentToCheck = msg.content;
                const textMatch = msg.content.match(/\[.*?的消息：([\s\S]+?)\]/);
                if (textMatch) contentToCheck = textMatch[1];
                if (contentToCheck.startsWith('[system-narration:')) {
                    const narMatch = contentToCheck.match(/\[system-narration:([\s\S]+?)\]/);
                    if (narMatch) contentToCheck = narMatch[1];
                }
                if (!contentToCheck.toLowerCase().includes(kw)) return;
            }
            results.push(msg);
        });

    // 铁律排序后倒序（最新在前，与现有 UI 一致）
    results.sort(_sortByTimestampExact);
    results.reverse();
    return results;
};

// ──────────────────────────────────────────
// Step 4：取"以目标 timestamp 为中心，前 before 条 + 后 after 条"
//   用于搜索跳转时把老消息 merge 进 chat.history
//   返回升序数组（未去重，由调用方按 id 去重后再 merge）
// ──────────────────────────────────────────
window.fetchAroundMessage = async function (chatId, targetTs, before = 100, after = 100) {
    if (!window.dexieDB) throw new Error('dexieDB 未就绪');
    // 前 before 条：timestamp <= targetTs，逆序取 before+50 条（含边界余量）
    const beforePart = await window.dexieDB.messages
        .where('[chatId+timestamp]')
        .between([chatId, Number.NEGATIVE_INFINITY], [chatId, targetTs], true, true)
        .reverse()
        .limit(before + 50)
        .toArray();
    // 后 after 条：timestamp > targetTs，正序取 after+50 条
    const afterPart = await window.dexieDB.messages
        .where('[chatId+timestamp]')
        .between([chatId, targetTs], [chatId, Number.POSITIVE_INFINITY], false, true)
        .limit(after + 50)
        .toArray();
    const all = [...beforePart, ...afterPart];
    all.sort(_sortByTimestampExact);
    return all;
};

// ──────────────────────────────────────────
// Step 4：顺序 verify（防止 merge 后出现"记录乱"）
//   检查 chat.history 相邻 timestamp 是否单调不递减、有无重复 id。
//   出问题：console.error 详情；alert 只弹一次（避免刷屏）。
// ──────────────────────────────────────────
window._orderAlertShown = false;
window.assertHistoryOrder = function (chat, context = '') {
    if (!chat || !chat.history) return true;
    const h = chat.history;
    const ids = new Set();
    for (let i = 0; i < h.length; i++) {
        if (i > 0 && (h[i].timestamp || 0) < (h[i - 1].timestamp || 0)) {
            console.error(`❌ [assertHistoryOrder] ${context} 逆序！位置 ${i}`, {
                prev: { id: h[i - 1].id, ts: h[i - 1].timestamp },
                curr: { id: h[i].id, ts: h[i].timestamp },
            });
            if (!window._orderAlertShown) {
                window._orderAlertShown = true;
                if (typeof AppUI !== 'undefined' && AppUI.alert) {
                    AppUI.alert(`检测到消息顺序异常（${context} 位置 ${i}）。请查看控制台并联系开发者。`, '顺序异常');
                }
            }
            return false;
        }
        if (ids.has(h[i].id)) {
            console.error(`❌ [assertHistoryOrder] ${context} 重复 id：${h[i].id} 位置 ${i}`);
            return false;
        }
        ids.add(h[i].id);
    }
    return true;
};

// ──────────────────────────────────────────
// Step 5a：备份专用——从 DB 全量读 messages，返回按 chatId 分组的 map。
//   备份时临时挂到 characters[i].history / groups[i].history 上，用完由调用方释放。
//   目的：懒加载模式下 chat.history 只有 1500 条，直接备份会丢老消息；改从 DB 全量读。
//   ★ 只保证 chatId 分组内按 timestamp 升序，跟原 loadData 的行为一致。
// ──────────────────────────────────────────
window.buildFullHistoryMap = async function () {
    if (!window.dexieDB) throw new Error('dexieDB 未就绪');
    const all = await window.dexieDB.messages.toArray();
    const byChat = {};
    for (const m of all) {
        (byChat[m.chatId] || (byChat[m.chatId] = [])).push(m);
    }
    for (const arr of Object.values(byChat)) {
        arr.sort(_sortByTimestampExact);
    }
    return byChat;
};

// ──────────────────────────────────────────
// Step 0 + Step 1 验收工具：等价对照（只读，不改任何数据）
//   对同一个 chat：
//     老路径 = 全量 toArray + 铁律排序，取最后 limit 条的 id 序列
//     新路径 = loadRecentMessages 返回的 id 序列
//   两者必须逐条 id 相同、顺序相同，否则报红。
//   现在就能跑（loadData 还没动，老路径仍是全量）。
// ──────────────────────────────────────────
window.verifyLazyLoad = async function (chatId, limit = 1500) {
    if (!window.dexieDB) throw new Error('dexieDB 未就绪');

    // 老路径：全量取，铁律排序
    const all = await window.dexieDB.messages.where('chatId').equals(chatId).toArray();
    all.sort(_sortByTimestampExact);
    const oldTail = all.slice(-limit);
    const oldIds = oldTail.map(m => m.id);

    // 新路径
    const recent = await window.loadRecentMessages(chatId, limit);
    const newIds = recent.map(m => m.id);

    // 逐条比对
    let firstDiff = -1;
    const n = Math.min(oldIds.length, newIds.length);
    for (let i = 0; i < n; i++) {
        if (oldIds[i] !== newIds[i]) { firstDiff = i; break; }
    }

    const lenMatch = oldIds.length === newIds.length;
    const orderMatch = firstDiff === -1 && lenMatch;

    const summary = {
        chatId,
        limit,
        oldCount: all.length,
        oldTailLen: oldIds.length,
        newLen: newIds.length,
        lenMatch,
        firstDiffIndex: firstDiff,
        orderMatch,
    };

    if (orderMatch) {
        console.log(`✅ [verifyLazyLoad] ${chatId} 顺序等价通过。全量 ${all.length} 条，尾部 ${newIds.length} 条逐条一致。`, summary);
    } else {
        console.error(`❌ [verifyLazyLoad] ${chatId} 顺序不一致！lenMatch=${lenMatch} firstDiff=${firstDiff}`, summary);
        if (firstDiff >= 0) {
            console.error('   老路径该位置 id:', oldIds[firstDiff], ' 新路径该位置 id:', newIds[firstDiff]);
            console.error('   老路径前后:', oldIds.slice(Math.max(0, firstDiff - 2), firstDiff + 3));
            console.error('   新路径前后:', newIds.slice(Math.max(0, firstDiff - 2), firstDiff + 3));
        }
    }
    return summary;
};

// ──────────────────────────────────────────
// Step 0：全量顺序体检（只读）
//   对每个 chat，按铁律排序后检查是否有 timestamp 缺失/为 0 的消息，
//   以及排序前后顺序是否一致（一致说明 DB 里本身就是升序，不一致也没关系——loadData 反正会排）。
//   主要用来建立基线认知：你的数据现在长什么样。
// ──────────────────────────────────────────
window.auditMessageOrder = async function () {
    if (!window.dexieDB || !window.db) throw new Error('db 未就绪');
    const chats = [...window.db.characters, ...window.db.groups];
    const report = [];
    for (const chat of chats) {
        const rows = await window.dexieDB.messages.where('chatId').equals(chat.id).toArray();
        const missingTs = rows.filter(m => m.timestamp === undefined || m.timestamp === null).length;
        const zeroTs = rows.filter(m => m.timestamp === 0).length;
        // DB 原始顺序是否已是升序
        let alreadySorted = true;
        for (let i = 1; i < rows.length; i++) {
            if (_sortByTimestampExact(rows[i - 1], rows[i]) > 0) { alreadySorted = false; break; }
        }
        report.push({
            chatId: chat.id,
            name: chat.name || chat.title || chat.myName || '?',
            total: rows.length,
            missingTimestamp: missingTs,
            zeroTimestamp: zeroTs,
            dbAlreadyAscending: alreadySorted,
        });
    }
    console.table(report);
    const total = report.reduce((s, r) => s + r.total, 0);
    const problematic = report.filter(r => r.missingTimestamp > 0 || !r.dbAlreadyAscending);
    console.log(`📊 共 ${chats.length} 个会话，${total} 条消息。`, problematic.length ? `${problematic.length} 个会话有 timestamp 缺失或非升序（不影响加载，loadData 会排序；但记录在案）。` : '全部会话 DB 内已升序且无 timestamp 缺失。');
    return report;
};

// ──────────────────────────────────────────
// Step S1：summary 模块配套 helper（只做 DB 查询，不掺内存路径判断）
//   上层调用方自己决定是否先查内存，miss 再落到这里。
// ──────────────────────────────────────────

// getMessageCount(chatId): 返回该 chat 的 DB 消息总数（int）
//   用途：summary 弹窗里"当前聊天总消息数"，懒加载后 chat.history.length 只有 1500，
//         必须走 DB 才能拿到真实总数。
//   走复合索引 [chatId+timestamp] 的 count()，不读消息体，很快。
window.getMessageCount = async function (chatId) {
    if (!window.dexieDB) throw new Error('dexieDB 未就绪');
    return await window.dexieDB.messages.where('chatId').equals(chatId).count();
};

// getMessagesByTsRange(chatId, tsLo, tsHi): 返回 [tsLo, tsHi] 闭区间内的全部消息，升序（铁律排序）
//   用途：summary 生成 / chunk retry / 向量原文重建 —— 这些原来都在 chat.history.slice()，
//         现在改成按时间戳从 DB 拉，避免"内存里没那段老消息就抓瞎"。
//   参数：
//     chatId ：会话 id
//     tsLo   ：时间戳下界（含）。传 null/undefined 视为 -Infinity。
//     tsHi   ：时间戳上界（含）。传 null/undefined 视为 +Infinity。
//   注意：闭区间两端都是 inclusive（between 的 4/5 参数都传 true），
//         同一 ts 的边界消息会被包含进来——调用方自己去重/裁切。
window.getMessagesByTsRange = async function (chatId, tsLo, tsHi) {
    if (!window.dexieDB) throw new Error('dexieDB 未就绪');
    const lo = (tsLo == null) ? Number.NEGATIVE_INFINITY : tsLo;
    const hi = (tsHi == null) ? Number.POSITIVE_INFINITY : tsHi;
    const rows = await window.dexieDB.messages
        .where('[chatId+timestamp]')
        .between([chatId, lo], [chatId, hi], true, true)
        .toArray();
    // 铁律排序兜底（between 已按索引升序返回，这里保底一次，与 loadData 一致）
    rows.sort(_sortByTimestampExact);
    return rows;
};

// getMessagesByGlobalRange(chatId, start, end): 返回全局 1-based 序号 [start, end] 闭区间内的消息，升序（铁律排序）
//   用途：summary 生成 performGeneration —— 原来 chat.history.slice(startIndex, endIndex)，
//         懒加载后老范围在内存窗口外根本取不到，改走 DB 按全局序号精准取。
//   实现：复合索引 [chatId+timestamp] 已按 timestamp 升序，.offset(start-1).limit(条数) 定位。
//   注意：.offset() 是 O(offset) 跳过，但 summary 生成是用户主动操作（非热路径），可接受。
//   start/end 语义与 chat.history.slice(start-1, end) 完全一致（end 为 1-based 闭区间上界）。
window.getMessagesByGlobalRange = async function (chatId, start, end) {
    if (!window.dexieDB) throw new Error('dexieDB 未就绪');
    const startIndex = Math.max(0, (start || 1) - 1);
    const limit = (end || 0) - (start || 1) + 1;  // 闭区间条数
    if (limit <= 0) return [];
    const rows = await window.dexieDB.messages
        .where('[chatId+timestamp]')
        .between([chatId, Number.NEGATIVE_INFINITY], [chatId, Number.POSITIVE_INFINITY], true, true)
        .offset(startIndex)
        .limit(limit)
        .toArray();
    // 铁律排序兜底（offset+limit 已按索引升序返回，这里保底一次，与 loadData 一致）
    rows.sort(_sortByTimestampExact);
    return rows;
};

console.log('lazy_load.js 已加载（Step 0+1+S1）。可用：window.auditMessageOrder() / window.loadRecentMessages(chatId,1500) / window.verifyLazyLoad(chatId,1500) / window.getMessageCount(chatId) / window.getMessagesByTsRange(chatId,tsLo,tsHi) / window.getMessagesByGlobalRange(chatId,start,end)');
