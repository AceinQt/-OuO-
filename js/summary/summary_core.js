// ============================================================
//  summary_core.js
//
//  【职责】记忆/日记功能的共享状态与通用工具函数。
//  本文件是整个 summary 模块的基础，必须最先加载。
//
//  包含：
//  - 当前激活的 Tab / 子 Tab / 详情项 ID 等运行时状态变量
//  - getCurrentChatObject()：根据当前聊天类型，统一获取聊天对象
//  - normalizeDateStr()：日期字符串规范成零填充 YYYY-MM-DD（读写两端都要过）
//
//  被以下文件依赖：
//  summary_render.js / summary_list.js / summary_generate.js / summary_init.js
// ============================================================

// --- 运行时状态变量 ---
// 当前主 Tab：'summary'（剧情总结）或 'journal'（角色日记）
let currentMemoryTab = 'summary';

// 当前总结子 Tab：'short'（短期总结）或 'long'（长期总结）
let currentSummarySubTab = 'short';

// 当前正在查看的详情项 ID
let currentJournalDetailId = null;


// --- 辅助函数：获取当前聊天对象 (通用) ---
function getCurrentChatObject() {
    if (currentChatType === 'private') {
        return db.characters.find(c => c.id === currentChatId);
    } else {
        return db.groups.find(g => g.id === currentChatId);
    }
}


// --- 辅助函数：日期字符串规范成零填充的 YYYY-MM-DD ---
// 为什么非得有这么个函数：长期总结是靠**字符串大小比较**圈定日期范围的
// （`itemDate >= startDateStr && itemDate <= endDateStr`，见 summary_generate.js），
// 而字典序只在两边都零填充时才等于日期序。短期总结的「发生日期」却是个纯文本框
// （index.html 的 `#summary-occurred-at`），手动改过日期的条目完全可能存成 `2025-10-9`。
// 于是 `'2025-10-9' <= '2025-10-10'` 逐字符比到 `'9'` vs `'1'` 就成了 false ——
// 那天既进不了长期总结的素材，也走不到「取消收藏」那一步，
// 症状就是「长期总结漏了一天、而且那天的收藏标志还挂着」。`2025/10/09` 同理。
// 所以读取端（圈范围）和写入端（详情页保存）都得过一遍这里：
// 写入端保证以后不再产生脏数据，读取端保证**已经存进去的**脏数据也能被正确圈中。
// 返回 '' = 压根解析不出日期，调用方自己决定怎么处置，别当合法日期用。
function normalizeDateStr(raw) {
    if (!raw) return '';
    const head = String(raw).trim().split(/\s/)[0];   // 丢掉可能跟在后面的时间
    const m = head.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
    if (!m) return '';
    const mo = Number(m[2]);
    const d  = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
    return `${m[1]}-${pad(mo)}-${pad(d)}`;
}


// --- 辅助函数：获取短期总结的正文（唯一数据源 = 片段块） ---
// 有块的总结：从 chatObj.memoryChunks 按 blockIds 实时拼接，天然与块编辑保持同步；
// 无块的旧总结（整篇一段的 legacy 格式）：回退到 item.content。
// item.content 对有块总结而言只是生成时的一次性快照，不再被任何读取方依赖。
function getShortSummaryContent(item, chatObj) {
    if (!item) return '';
    if (item.blockIds && item.blockIds.length > 0 && chatObj) {
        const idSet = new Set(item.blockIds);
        const parts = (chatObj.memoryChunks || [])
            .filter(c => idSet.has(c.blockId) && c.detailedContent)
            .sort((a, b) => a.chunkIndex - b.chunkIndex)
            .map(b => {
                const rangeStr = (b.startMsgIndex && b.endMsgIndex)
                    ? `（消息${b.startMsgIndex}–${b.endMsgIndex}）`
                    : `（片段${b.chunkIndex + 1}）`;
                return `${rangeStr}\n${b.detailedContent}`;
            });
        if (parts.length > 0) return parts.join('\n\n');
    }
    return item.content || '';
}
