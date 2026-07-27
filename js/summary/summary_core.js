// ============================================================
//  summary_core.js
//
//  【职责】记忆/日记功能的共享状态与通用工具函数。
//  本文件是整个 summary 模块的基础，必须最先加载。
//
//  包含：
//  - 当前激活的 Tab / 子 Tab / 详情项 ID 等运行时状态变量
//  - getCurrentChatObject()：根据当前聊天类型，统一获取聊天对象
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
