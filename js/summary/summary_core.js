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
