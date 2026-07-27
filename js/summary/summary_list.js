// ============================================================
//  summary_list.js
//
//  【职责】记忆/日记的列表渲染与详情页展示。
//  负责把内存中的数据渲染成卡片列表，以及点击后分流打开对应详情屏幕。
//
//  包含：
//  - renderMemoryScreen()：根据当前 Tab / 子 Tab，重置分页并渲染第一页
//  - _appendMemoryPage()：追加当前页的卡片（滚动触底时由 init 调用）
//  - openMemoryDetail()：点击卡片后，分流进入总结详情页或日记详情页
//  - [v1.6] _renderSummaryBlocks()：总结详情页分块渲染
//    · 主体显示 detailedContent（详细总结正文）
//    · 折叠区显示情绪标签 + 摘要（摘要可编辑）
//    · 摘要修改后自动清除 embedding，标记为未向量化
//    · 原文不展示（通过指针重建，仅供二次调用使用）
//  - [v1.6] _rebuildChunkRawText()：按块自己的消息范围重建原文（二次调用用）
//  - [v1.6] _rebuildRawText()：按父总结全段重建原文（兜底）
//  - [v1.6] retryChunkBlock()：对解析失败的片段块发起二次 API 调用
//  - [v1.6] clearOrphanChunks()：清除没有对应总结记录的孤立切块
//
//  v1.6 变更：列表改为分页懒加载，滚动触底自动追加下一页。
//
//  依赖：summary_core.js、summary_render.js
// ============================================================


// --- 分页状态（模块级，供 summary_init.js 滚动监听访问） ---
const MEMORY_PAGE_SIZE = 15;
let _memoryCurrentPage  = 1;
let _memorySortedItems  = [];


// --- 列表渲染函数（重置分页，只渲染第一页） ---
function renderMemoryScreen() {
    const container       = document.getElementById('journal-list-container');
    const placeholder     = document.getElementById('no-journals-placeholder');
    const placeholderText = document.getElementById('placeholder-text-content');
    const vectorPanel     = document.getElementById('vector-memory-panel');
    container.innerHTML   = '';
    
    // vector 分支：直接显示面板，退出
    if (currentMemoryTab === 'summary' && currentSummarySubTab === 'vector') {
        container.style.display   = 'none';
        placeholder.style.display = 'none';
        if (vectorPanel) vectorPanel.style.display = '';
        renderVectorStats();
        return;
    }

    // 其他分支：恢复 list 显示
    container.style.display = '';
    if (vectorPanel) vectorPanel.style.display = 'none';

    const chat = getCurrentChatObject();
    if (!chat) return;

    let items = [];

    // 数据源选择
    if (currentMemoryTab === 'summary') {
        if (currentSummarySubTab === 'long') {
            items = chat.longTermSummaries || [];
            placeholderText.textContent = '还没有长期总结哦~';
        } else {
            items = chat.memorySummaries || [];
            placeholderText.textContent = '还没有短期总结哦~';
        }
    } else {
        items = chat.memoryJournals || [];
        placeholderText.textContent = '还没有角色日记哦~';
    }

    if (!items || items.length === 0) {
        placeholder.style.display = 'block';
        _memorySortedItems = [];
        return;
    }
    placeholder.style.display = 'none';

    // 排序（倒序），结果缓存供后续分页使用
    _memorySortedItems = [...items].sort((a, b) => {
        const timeA = new Date(a.startDate || a.occurredAt || a.createdAt).getTime();
        const timeB = new Date(b.startDate || b.occurredAt || b.createdAt).getTime();
        return timeB - timeA;
    });

    // 重置到第一页
    _memoryCurrentPage = 1;
    _appendMemoryPage();
}


// --- 追加当前页的卡片 ---
function _appendMemoryPage() {
    const container  = document.getElementById('journal-list-container');
    const isLongTerm = (currentMemoryTab === 'summary' && currentSummarySubTab === 'long');

    const startIdx  = (_memoryCurrentPage - 1) * MEMORY_PAGE_SIZE;
    const endIdx    = _memoryCurrentPage * MEMORY_PAGE_SIZE;
    const pageItems = _memorySortedItems.slice(startIdx, endIdx);

    pageItems.forEach(item => {
        const card = document.createElement('li');
        card.className  = 'journal-card';
        card.dataset.id = item.id;

        if (isLongTerm) card.classList.add('long-term');

        // --- 1. 日期/时间 ---
        let displayTime = '';
        if (item.startDate && item.endDate) {
            displayTime = `${item.startDate} ~ ${item.endDate}`;
        } else {
            let t = item.occurredAt;
            if (!t) {
                const date = new Date(item.createdAt);
                t = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
            } else {
                t = t.split(' ')[0];
            }
            displayTime = t;
        }

        // --- 2. 范围（仅短期/日记显示；空白条目显示"未知"） ---
        let rangeTextHtml = '';
        if (!isLongTerm) {
            const rs = item.range?.start;
            const re = item.range?.end;
            const rangeLabel = (rs == null || rs === '未知') ? '未知' : `${rs}-${re}`;
            rangeTextHtml = `<span class="journal-card-range">范围: ${rangeLabel}</span>`;
        }

        // --- 3. 按钮组 ---
        let favoriteBtnHtml = '';
        if (currentMemoryTab === 'summary') {
            favoriteBtnHtml = `
            <button class="action-icon-btn favorite-journal-btn ${item.isFavorited ? 'favorited' : ''}" title="收藏">
                <svg viewBox="0 0 24 24">
                    <path class="star-outline" d="M12,17.27L18.18,21L16.54,13.97L22,9.24L14.81,8.62L12,2L9.19,8.62L2,9.24L7.45,13.97L5.82,21L12,17.27Z" fill="currentColor"/>
                    <path class="star-solid"   d="M12,17.27L18.18,21L16.54,13.97L22,9.24L14.81,8.62L12,2L9.19,8.62L2,9.24L7.45,13.97L5.82,21L12,17.27Z"/>
                </svg>
            </button>`;
        }

        const deleteBtnHtml = `
            <button class="action-icon-btn delete-journal-btn" title="删除">
                <svg viewBox="0 0 24 24"><path d="M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z" /></svg>
            </button>`;

        card.innerHTML = `
            <div class="journal-card-header">
                <div class="journal-card-title">${item.title}</div>
            </div>
            <div class="journal-card-footer">
                <span class="journal-card-date">${displayTime}</span>
                ${rangeTextHtml}
                <div class="footer-actions">
                    ${favoriteBtnHtml}
                    ${deleteBtnHtml}
                </div>
            </div>
        `;
        container.appendChild(card);
    });
}


// --- 详情页分流函数 ---
function openMemoryDetail(item) {
    currentJournalDetailId = item.id;
    if (currentChatType === 'private') {
        const character = db.characters.find(c => c.id === currentChatId);
        applyJournalFont(character ? character.journalFontUrl : '');
    }
    const styleTag = document.getElementById('dynamic-journal-style');

    // 通用日期处理 (YYYY-MM-DD)
    let dateStr = '';
    if (item.occurredAt) {
        dateStr = item.occurredAt.split(' ')[0];
    } else if (item.startDate) {
        dateStr = item.startDate;
    } else {
        const date = new Date(item.createdAt);
        dateStr = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }

    if (currentMemoryTab === 'summary') {
        // ================= 1. 总结详情页 =================

        if (styleTag) styleTag.textContent = '';
        const journalScreen = document.getElementById('journal-detail-screen');
        if (journalScreen) journalScreen.style.removeProperty('--handwriting-font');

        const titleEl      = document.getElementById('summary-detail-title');
        const contentEl    = document.getElementById('summary-detail-content');
        const dateInput    = document.getElementById('summary-occurred-at');
        const rangeDisplay = document.getElementById('summary-range-display');

        titleEl.textContent = item.title;

        // [v1.6] 短期总结且有块记录时，分块渲染；否则走原来的纯文本渲染
        if (currentSummarySubTab !== 'long' && item.blockIds?.length > 0) {
            const chat = getCurrentChatObject();
            _renderSummaryBlocks(item, contentEl, chat);
        } else {
            renderSimpleText(item.content, contentEl);
        }

        const editSummaryBtn = document.getElementById('edit-summary-btn');

if (currentSummarySubTab === 'long') {
    dateInput.value          = `${item.startDate} ~ ${item.endDate}`;
    rangeDisplay.textContent = '长期精炼';
    dateInput.readOnly       = true;
    editSummaryBtn.style.display = '';

    // [v1.7] 长期总结不支持添加块，隐藏"+"按钮
    const addChunkBtn = document.getElementById('add-chunk-btn');
    if (addChunkBtn) addChunkBtn.style.display = 'none';

    // 编辑逻辑（每次打开重新绑，先克隆去旧监听）
    const freshBtn = editSummaryBtn.cloneNode(true);
    editSummaryBtn.parentNode.replaceChild(freshBtn, editSummaryBtn);
    freshBtn.style.display = '';

    let isEditing = false;
    freshBtn.addEventListener('click', async () => {
        if (!isEditing) {
            // 进入编辑
            isEditing = true;
            titleEl.setAttribute('contenteditable', 'true');
            contentEl.setAttribute('contenteditable', 'true');
            titleEl.style.border   = '1px solid var(--accent-color, #aaa)';
            contentEl.style.border = '1px solid var(--accent-color, #aaa)';
            freshBtn.title = '确认保存';
            freshBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21,7L9,19L3.5,13.5L4.91,12.09L9,16.17L19.59,5.59L21,7Z"/></svg>`;
        } else {
            // 保存
            isEditing = false;
            item.title   = titleEl.textContent.trim();
            item.content = contentEl.innerText.trim();
            const chat = getCurrentChatObject();
if (chat) {
    await saveMemoryItem(item, currentChatId, 'long');   // ✅ 存到 memories 表
}
            titleEl.setAttribute('contenteditable', 'false');
            contentEl.setAttribute('contenteditable', 'false');
            titleEl.style.border   = 'none';
            contentEl.style.border = 'none';
            freshBtn.title = '编辑';
            freshBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18,2.9 17.35,2.9 16.96,3.29L15.13,5.12L18.88,8.87M3,17.25V21H6.75L17.81,9.94L14.06,6.19L3,17.25Z" /></svg>`;
        }
    });
} else {
    dateInput.value = dateStr;
            const rs = item.range?.start;
            const re = item.range?.end;
            const rangeLabel = (rs == null || rs === '未知') ? '未知' : `${rs}-${re}`;
            rangeDisplay.textContent = `消息范围: ${rangeLabel}`;
            dateInput.readOnly       = true;
            dateInput.style.borderBottom = 'none';

    // [v1.6] 短期总结编辑按钮：编辑标题 + 发生日期
    const freshBtn = editSummaryBtn.cloneNode(true);
    editSummaryBtn.parentNode.replaceChild(freshBtn, editSummaryBtn);
    freshBtn.style.display = '';

    let isEditing = false;
    freshBtn.addEventListener('click', async () => {
        if (!isEditing) {
            isEditing = true;
            titleEl.setAttribute('contenteditable', 'true');
            titleEl.style.border = '1px solid var(--accent-color, #aaa)';
            dateInput.readOnly = false;
            dateInput.style.borderBottom = '1px solid var(--accent-color, #aaa)';
            freshBtn.title = '确认保存';
            freshBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21,7L9,19L3.5,13.5L4.91,12.09L9,16.17L19.59,5.59L21,7Z"/></svg>`;
        } else {
            isEditing = false;
            item.title = titleEl.textContent.trim();
            const newDateVal = dateInput.value.trim();
            if (newDateVal) item.occurredAt = newDateVal;
            const chat = getCurrentChatObject();
            if (chat) await saveMemoryItem(item, currentChatId, 'short');
            titleEl.setAttribute('contenteditable', 'false');
            titleEl.style.border = 'none';
            dateInput.readOnly = true;
            dateInput.style.borderBottom = 'none';
            freshBtn.title = '编辑';
            freshBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18,2.9 17.35,2.9 16.96,3.29L15.13,5.12L18.88,8.87M3,17.25V21H6.75L17.81,9.94L14.06,6.19L3,17.25Z" /></svg>`;
            showToast('已保存');
        }
    });

    // [v1.6] 短期总结：显示"+"按钮并绑定点击事件（每次打开重新绑，克隆去旧监听）
    const addChunkBtn = document.getElementById('add-chunk-btn');
    if (addChunkBtn) {
        addChunkBtn.style.display = '';
        const freshAddBtn = addChunkBtn.cloneNode(true);
        addChunkBtn.parentNode.replaceChild(freshAddBtn, addChunkBtn);
        freshAddBtn.addEventListener('click', () => _addBlankChunkToSummary(item, contentEl));
    }
        }

        // 重置 UI
        titleEl.setAttribute('contenteditable', 'false');
contentEl.setAttribute('contenteditable', 'false');
titleEl.style.border   = 'none';
contentEl.style.border = 'none';

switchScreen('summary-detail-screen');

    } else {
        // ================= 2. 日记详情页 =================

        const character = db.characters.find(c => c.id === currentChatId);

        if (character && character.customJournalCss && styleTag) {
            styleTag.textContent = character.customJournalCss;
        } else if (styleTag) {
            styleTag.textContent = '';
        }

        applyJournalFont(character ? character.journalFontUrl : '');

        const titleEl    = document.getElementById('journal-detail-title');
        const contentEl  = document.getElementById('journal-detail-content');
        const yearInput  = document.getElementById('journal-date-year');
        const monthInput = document.getElementById('journal-date-month');
        const dayInput   = document.getElementById('journal-date-day');
        const editBtn    = document.getElementById('edit-journal-btn');

        titleEl.textContent  = item.title;
        titleEl.style.border = '1px solid transparent';

        renderJournalMarkdown(item.content, contentEl);
        contentEl.className = 'journal-paper-content';

        const parts = dateStr.split('-');
        if (parts.length === 3) {
            yearInput.value  = parts[0];
            monthInput.value = parts[1];
            dayInput.value   = parts[2];
        }

        // 重置 UI
        titleEl.setAttribute('contenteditable', 'false');
        contentEl.setAttribute('contenteditable', 'false');
        contentEl.style.border = 'none';

        editBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18,2.9 17.35,2.9 16.96,3.29L15.13,5.12L18.88,8.87M3,17.25V21H6.75L17.81,9.94L14.06,6.19L3,17.25Z" /></svg>`;

        switchScreen('journal-detail-screen');
    }
}


// ============================================================
//  [v1.6] 总结详情页：分块渲染辅助函数
// ============================================================

/** 安全 HTML 转义 */
function _escHtml(str) {
    return (str || '')
        .replace(/&/g,  '&amp;')
        .replace(/</g,  '&lt;')
        .replace(/>/g,  '&gt;')
        .replace(/"/g,  '&quot;');
}

/**
 * 在总结详情页将内容渲染为可编辑卡片列表。
 *
 * 卡片格式（每段）：
 *   段落 N  ●/○  [删除] [编辑/确认]
 *   ─────────────────────────────────
 *   日期         消息 X–Y
 *   详细总结正文……
 *   展开摘要和情绪 ▸
 *
 * 编辑逻辑：日期 / 消息范围 / 正文均可改；情绪只读。
 * 消息范围验证：① 不超过父总结整体范围 ② 不与同页其他块重叠。
 * 删除：同步清除向量数据，重排 chunkIndex；
 *       全部段落删完后自动删除父总结并返回列表。
 */
/**
 * 在总结详情页将内容渲染为可编辑卡片列表。
 */
function _renderSummaryBlocks(item, container, chat) {
    const blocks = (chat.memoryChunks || [])
        .filter(c => item.blockIds.includes(c.blockId))
        .sort((a, b) => a.chunkIndex - b.chunkIndex);

    // 兜底：块记录丢失，降级到全文渲染
    if (!blocks.length) {
        renderSimpleText(item.content, container);
        return;
    }

    container.innerHTML        = '';
    container.className        = 'summary-blocks-container';
    container.style.whiteSpace = '';

    /** 从 startTime / timestamp 生成 YYYY-MM-DD */
    function _blockDateStr(block) {
        const ts = block.startTime || block.timestamp;
        if (!ts) return '';
        const d = new Date(ts);
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    blocks.forEach((block, displayIdx) => {
        const wrap = document.createElement('div');
        wrap.className       = 'chunk-block';
        wrap.dataset.blockId = block.blockId;

        const dateStr    = _blockDateStr(block);
        const hasRange   = block.startMsgIndex != null && block.endMsgIndex != null;
        const rangeLabel = hasRange
            ? `消息 ${block.startMsgIndex}–${block.endMsgIndex}`
            : `片段 ${block.chunkIndex + 1}`;

        const isExcluded   = !!block.excludeFromEmbed;
        const isVectorized = !!block.embedding;
        
        // 渲染美观的 SVG 向量化状态徽标
        const vectorBadge  = isVectorized
            ? `<span class="chunk-vector-badge vectorized" title="已向量化"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2A10 10 0 1 0 22 12A10 10 0 0 0 12 2Z"/></svg></span>`
            : isExcluded
                ? `<span class="chunk-vector-badge excluded" title="已从向量池排除"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,4A8,8 0 0,1 20,12C20,13.85 19.37,15.54 18.35,16.94L7.06,5.65C8.46,4.63 10.15,4 12,4M12,20A8,8 0 0,1 4,12C4,10.15 4.63,8.46 5.65,7.06L16.94,18.35C15.54,19.37 13.85,20 12,20Z"/></svg></span>`
                : `<span class="chunk-vector-badge unvectorized" title="未向量化"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="9"/></svg></span>`;

        // header actions 里加按钮
        const rejoinBtnHtml = isExcluded ? `
          <button class="chunk-rejoin-btn icon-btn" title="重新加入向量池">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <path d="M17.65,6.35A7.958,7.958,0,0,0,12,4C7.58,4,4,7.58,4,12s3.58,8,8,8a7.99,7.99,0,0,0,7.73-6H17.65A6,6,0,1,1,12,6a5.916,5.916,0,0,1,4.22,1.78L13,11h7V4Z"/>
            </svg>
          </button>` : '';

        const mainContent = block.parseSuccess
            ? (block.detailedContent || block.summary || '')
            : null;
        
        const hasMeta = true;

        // Meta 显示文本化预处理
        const routineStr = block.isRoutine === true ? '日常' : (block.isRoutine === false ? '非日常 ⚑' : '未分类');
        const emotionStr = block.emotion || '无';
        const scoreStr   = block.emotionScore != null ? Math.round(block.emotionScore * 100) + '%' : '未知';
        const summaryStr = block.summary || '暂无摘要';

        // 生成新的内部 HTML 结构
        wrap.innerHTML = `
          <div class="chunk-block-header">
            <div class="chunk-header-left">
                ${vectorBadge}
                <span class="chunk-block-index">段落 ${displayIdx + 1}</span>
            </div>
            <div class="chunk-header-actions">
              ${rejoinBtnHtml}
              <button class="chunk-delete-btn icon-btn" title="删除此段落">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                  <path d="M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z"/>
                </svg>
              </button>
              <button class="chunk-edit-btn icon-btn" title="编辑此段落">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                  <path d="M20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18,2.9 17.35,2.9 16.96,3.29L15.13,5.12L18.88,8.87M3,17.25V21H6.75L17.81,9.94L14.06,6.19L3,17.25Z"/>
                </svg>
              </button>
            </div>
          </div>
          
          <div class="chunk-meta-bar">
            <span class="chunk-date-display">${_escHtml(dateStr)}</span>
            <span class="chunk-range-display">${_escHtml(rangeLabel)}</span>
            <input class="chunk-date-input chunk-hide" type="text" value="${_escHtml(dateStr)}" placeholder="YYYY-MM-DD">
            <span class="chunk-range-sep chunk-hide">消息 </span>
            <input class="chunk-range-start-input chunk-hide" type="number" value="${block.startMsgIndex != null ? block.startMsgIndex : ''}" min="1">
            <span class="chunk-range-dash chunk-hide">–</span>
            <input class="chunk-range-end-input chunk-hide" type="number" value="${block.endMsgIndex != null ? block.endMsgIndex : ''}" min="1">
          </div>
          
          <div class="chunk-block-content">${mainContent != null ? _escHtml(mainContent) : '<span class="chunk-fail-label">内容未生成</span>'}</div>          
          
          ${hasMeta ? `
          <div class="chunk-meta-wrapper">
              <div class="chunk-meta-toggle">
                  <span>展开摘要详情</span>
                  <svg class="toggle-icon" viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                      <path d="M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z"/>
                  </svg>
              </div>
              <div class="chunk-block-meta chunk-hide">
                <!-- 展示态 -->
                <div class="chunk-meta-display">
                    <div class="meta-row"><span>日常性：</span><span>${_escHtml(routineStr)}</span></div>
                    <div class="meta-row"><span>情绪词：</span><span>${_escHtml(emotionStr)}</span></div>
                    <div class="meta-row"><span>情绪强度：</span><span>${_escHtml(scoreStr)}</span></div>
                    ${block.parseSuccess ? `<div class="meta-row summary-row"><span>摘要：</span><span class="summary-text">${_escHtml(summaryStr)}</span></div>` : ''}
                </div>
                <!-- 编辑态 -->
                <div class="chunk-meta-edit chunk-hide">
                    <label class="meta-edit-row">
                        <span>日常性：</span>
                        <select class="chunk-routine-select">
                            <option value="" ${block.isRoutine == null ? 'selected' : ''}>未分类</option>
                            <option value="false" ${block.isRoutine === false ? 'selected' : ''}>非日常 ⚑</option>
                            <option value="true"  ${block.isRoutine === true  ? 'selected' : ''}>日常</option>
                        </select>
                    </label>
                    <label class="meta-edit-row">
                        <span>情绪词：</span>
                        <input class="chunk-emotion-input" type="text" value="${_escHtml(block.emotion || '')}" placeholder="如warm">
                    </label>
                    <label class="meta-edit-row">
                        <span>情绪强度：</span>
                        <input class="chunk-score-input" type="number" min="0" max="100" value="${block.emotionScore != null ? Math.round(block.emotionScore * 100) : 50}">
                        <span>%</span>
                    </label>
                    ${block.parseSuccess ? `
                    <div class="edit-summary-row">
                        <span>摘要：</span>
                        <textarea class="chunk-summary-textarea" placeholder="在此输入核心摘要...">${_escHtml(block.summary || '')}</textarea>
                    </div>` : ''}
                </div>
              </div>
          </div>` : ''}
          
          ${!block.parseSuccess
            ? `<button class="chunk-retry-btn btn-secondary" data-block-id="${block.blockId}">二次调用</button>`
            : ''}
        `;

        // ── 折叠/展开 ──
        const wrapper = wrap.querySelector('.chunk-meta-wrapper');
        const toggle  = wrap.querySelector('.chunk-meta-toggle');
        const metaDiv = wrap.querySelector('.chunk-block-meta');
        const toggleText = wrap.querySelector('.chunk-meta-toggle span');
        if (toggle && metaDiv && wrapper) {
            toggle.addEventListener('click', () => {
                const isHidden = metaDiv.classList.contains('chunk-hide');
                if (isHidden) {
                    metaDiv.classList.remove('chunk-hide');
                    wrapper.classList.add('expanded');
                    if (toggleText) toggleText.textContent = '收起摘要详情';
                } else {
                    metaDiv.classList.add('chunk-hide');
                    wrapper.classList.remove('expanded');
                    if (toggleText) toggleText.textContent = '展开摘要详情';
                }
            });
        }

        // ── 二次调用 ──
        const retryBtn = wrap.querySelector('.chunk-retry-btn');
        if (retryBtn) {
            retryBtn.addEventListener('click', () => retryChunkBlock(block.blockId));
        }

        // ── 获取各项 DOM ──
        const editBtn   = wrap.querySelector('.chunk-edit-btn');
        const deleteBtn = wrap.querySelector('.chunk-delete-btn');
        const rejoinBtn = wrap.querySelector('.chunk-rejoin-btn');  
        
        const dateDsp   = wrap.querySelector('.chunk-date-display');
        const rangeDsp  = wrap.querySelector('.chunk-range-display');
        const dateInp   = wrap.querySelector('.chunk-date-input');
        const rangeSep  = wrap.querySelector('.chunk-range-sep');
        const startInp  = wrap.querySelector('.chunk-range-start-input');
        const rangeDash = wrap.querySelector('.chunk-range-dash');
        const endInp    = wrap.querySelector('.chunk-range-end-input');
        const contentDv = wrap.querySelector('.chunk-block-content');
        
        const metaDisplay = wrap.querySelector('.chunk-meta-display');
        const metaEdit    = wrap.querySelector('.chunk-meta-edit');

        let isEditing = false;

        // ── 编辑 & 保存 按钮逻辑 ──
        editBtn.addEventListener('click', async () => {
            if (!isEditing) {
                // ── 1. 进入编辑模式 ──
                isEditing = true;
                
                // 切换日期范围状态的显隐
                dateDsp.classList.add('chunk-hide');
                rangeDsp.classList.add('chunk-hide');
                dateInp.classList.remove('chunk-hide');
                rangeSep.classList.remove('chunk-hide');
                startInp.classList.remove('chunk-hide');
                rangeDash.classList.remove('chunk-hide');
                endInp.classList.remove('chunk-hide');

                // 强制展开折叠面板并切换到编辑表单
                if (metaDiv && wrapper) {
                    metaDiv.classList.remove('chunk-hide');
                    wrapper.classList.add('expanded');
                    if(toggleText) toggleText.textContent = '收起摘要详情';
                }
                if (metaDisplay) metaDisplay.classList.add('chunk-hide');
                if (metaEdit) metaEdit.classList.remove('chunk-hide');

                // 激活正文编辑
                if (block.parseSuccess) {
                    contentDv.setAttribute('contenteditable', 'true');
                    contentDv.classList.add('is-editing');
                }

                editBtn.title     = '确认保存';
                editBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                    <path d="M9,16.17L4.83,12L3.41,13.41L9,19L21,7L19.59,5.59L9,16.17Z"/>
                  </svg>`;

            } else {
                // ── 2. 保存修改 ──
                const newDate  = dateInp.value.trim();
                const newStart = parseInt(startInp.value);
                const newEnd   = parseInt(endInp.value);

                // A. 验证消息范围
                if (!isNaN(newStart) && !isNaN(newEnd)) {
                    if (newStart > newEnd) {
                        showToast('起始消息序号不能大于结束序号');
                        return;
                    }
                    const pStart = item.range?.start;
                    const pEnd   = item.range?.end;
                    if (typeof pStart === 'number' && typeof pEnd === 'number') {
                        if (newStart < pStart || newEnd > pEnd) {
                            showToast(`消息范围须在 ${pStart}–${pEnd} 以内`);
                            return;
                        }
                    }
                    // 验证与同页其他块不重叠
                    for (const ob of blocks) {
                        if (ob.blockId === block.blockId) continue;
                        if (ob.startMsgIndex == null || ob.endMsgIndex == null) continue;
                        if (newStart <= ob.endMsgIndex && newEnd >= ob.startMsgIndex) {
                            showToast(`与段落 ${ob.chunkIndex + 1}（${ob.startMsgIndex}–${ob.endMsgIndex}）范围重叠`);
                            return;
                        }
                    }
                }

                // B. 收集 Meta 数据
                let summaryChanged = false;
                const routineSelect = wrap.querySelector('.chunk-routine-select');
                const emotionInput  = wrap.querySelector('.chunk-emotion-input');
                const scoreInput    = wrap.querySelector('.chunk-score-input');
                const summaryArea   = wrap.querySelector('.chunk-summary-textarea');

                if (routineSelect) {
                    const rv = routineSelect.value;
                    block.isRoutine = rv === '' ? null : (rv === 'true');
                }
                if (emotionInput) {
                    block.emotion = emotionInput.value.trim() || null;
                }
                if (scoreInput) {
                    const sv = parseInt(scoreInput.value, 10);
                    if (!isNaN(sv)) block.emotionScore = Math.min(1, Math.max(0, sv / 100));
                }
                if (summaryArea) {
                    const newSummary = summaryArea.value.trim();
                    if (block.summary !== newSummary) {
                        block.summary = newSummary;
                        summaryChanged = true;
                    }
                }

                // C. 收集正文及时间数据
                const hadEmbedding   = !!block.embedding;
                const newContent     = block.parseSuccess ? contentDv.innerText.trim() : null;
                const contentChanged = newContent !== null && newContent !== (block.detailedContent || '');

                if (contentChanged) block.detailedContent = newContent;
                if (newDate) {
                    const ts = new Date(newDate).getTime();
                    if (!isNaN(ts)) block.startTime = ts;
                }
                if (!isNaN(newStart)) block.startMsgIndex = newStart;
                if (!isNaN(newEnd))   block.endMsgIndex   = newEnd;

                // D. 判断是否需要清除向量
                const needClearEmbedding = hadEmbedding && (summaryChanged || contentChanged);
                if (needClearEmbedding) {
                    delete block.embedding;
                    delete block.accessCount;
                    delete block.lastAccessTime;
                }

// E. 写入存储并刷新
                await saveChunksToDB([block]);

                // 有块总结的正文以 memoryChunks 为唯一数据源（getShortSummaryContent 实时拼接），
                // 无需再把拼接结果写回 item.content

                renderVectorStats();
                showToast(needClearEmbedding
                    ? '已保存，向量已清除，请重新向量化'
                    : '已保存');

                // 重新渲染以退出编辑并刷新显示
                _renderSummaryBlocks(item, container, chat);
            }
        });

        // ── 重新加入向量池 ──
        if (rejoinBtn) {
            rejoinBtn.addEventListener('click', async () => {
                delete block.excludeFromEmbed;
                await saveChunksToDB([block]);
                showToast('已重新加入向量池');
                _renderSummaryBlocks(item, container, chat);
            });
        }

        // ── 删除按钮 ──
        deleteBtn.addEventListener('click', async () => {
            const confirmed = await AppUI.confirm(
                '删除段落',
                `确定删除段落 ${displayIdx + 1}？此操作不可撤销，向量数据将同步清除。`
            );
            if (!confirmed) return;

            // 1. 从内存移除此块
            chat.memoryChunks = (chat.memoryChunks || []).filter(c => c.blockId !== block.blockId);
            item.blockIds = (item.blockIds || []).filter(id => id !== block.blockId);

            // 2. 重建 chunkIndex 连续性
            const remaining = (chat.memoryChunks || [])
                .filter(c => item.blockIds.includes(c.blockId))
                .sort((a, b) => a.chunkIndex - b.chunkIndex);
            remaining.forEach((b, i) => { b.chunkIndex = i; });

            // 3. 持久化：整体替换此 chatId 的所有 chunk
            await replaceChunksToDB(chat.memoryChunks, currentChatId);

            // 4. 全部块删完 → 删除父总结，返回列表
            if (item.blockIds.length === 0) {
                chat.memorySummaries = (chat.memorySummaries || []).filter(s => s.id !== item.id);
                await deleteMemoryItem(item.id);
                showToast('所有段落已删除，总结已移除');
                switchScreen('memory-journal-screen');
                renderMemoryScreen();
                return;
            }

            // 5. 更新父总结的 blockIds
            await saveMemoryItem(item, currentChatId, 'short');
            renderVectorStats();
            showToast('段落已删除');

            // 6. 重新渲染
            _renderSummaryBlocks(item, container, chat);
        });

        container.appendChild(wrap);
    });
}

/**
 * 按块自己的消息范围重建原始对话文本（用于二次调用）。
 * 优先用块记录的 startMsgIndex/endMsgIndex 精确重建；
 * 无范围记录时 fallback 到父总结全段。
 */
// [Step S3-S4] 异步化：懒加载后老范围不在内存窗口，走 DB。
//   block 有 startTime/endTime 时用 ts range（O(log n)），否则用全局序号 range。
//   非懒加载保留原 slice 路径，行为不变。调用方需 await。
async function _rebuildChunkRawText(block, chat) {
    if (block.startMsgIndex && block.endMsgIndex) {
        const _filterMsg = m => {
            if (m.isAiIgnore || m.isHidden) return false;
            if (m.role === 'system') return false;
            if (m.id && m.id.includes('msg_context_timesense')) return false;
            if (m.content && m.content.includes('[system-display:')) return false;
            if (m.content && m.content.trim().startsWith('[system:')) return false;
            return true;
        };
        const _getName = m => {
            if (m.role === 'user') return currentChatType === 'private' ? '我' : (chat.me?.realName || '我');
            if (currentChatType === 'private') return chat.realName;
            const sender = chat.members?.find(mem => mem.id === m.senderId);
            return sender ? sender.realName : '未知成员';
        };

        let msgs;
        if (window.LAZY_LOAD && block.startTime && block.endTime) {
            msgs = await window.getMessagesByTsRange(chat.id, block.startTime, block.endTime);
        } else if (window.LAZY_LOAD) {
            msgs = await window.getMessagesByGlobalRange(chat.id, block.startMsgIndex, block.endMsgIndex);
        } else {
            msgs = (chat.history || []).slice(block.startMsgIndex - 1, block.endMsgIndex);
        }
        return msgs.filter(_filterMsg)
            .map(m => `${_getName(m)}: ${m.content}`)
            .join('\n');
    }

    // fallback：用父总结全段重建
    const parentSummary = (chat.memorySummaries || []).find(s => s.id === block.summaryId);
    return parentSummary ? await _rebuildRawText(parentSummary, chat) : '';
}


/**
 * 通过父总结的 range 指针，实时重建该范围的对话原文（兜底用）。
 * [Step S3-S4] 异步化：懒加载后老范围不在内存窗口，走 DB 全局序号取。
 */
async function _rebuildRawText(summaryItem, chat) {
    const range = summaryItem.range;
    if (!range || range.start == null) return '';
    // '未知' 等非数字 range 直接返回空（与原 slice(NaN,NaN)=[] 行为一致）
    if (typeof range.start !== 'number' || typeof range.end !== 'number') return '';

    const _filterMsg = m => {
        if (m.isAiIgnore || m.isHidden) return false;
        if (m.role === 'system') return false;
        if (m.id && m.id.includes('msg_context_timesense')) return false;
        if (m.content && m.content.includes('[system-display:')) return false;
        if (m.content && m.content.trim().startsWith('[system:')) return false;
        return true;
    };

    const _getName = m => {
        if (m.role === 'user') return currentChatType === 'private' ? '我' : (chat.me?.realName || '我');
        if (currentChatType === 'private') return chat.realName;
        const sender = chat.members?.find(mem => mem.id === m.senderId);
        return sender ? sender.realName : '未知成员';
    };

    const msgs = window.LAZY_LOAD
        ? await window.getMessagesByGlobalRange(chat.id, range.start, range.end)
        : (chat.history || []).slice(range.start - 1, range.end);
    return msgs.filter(_filterMsg)
        .map(m => `${_getName(m)}: ${m.content}`)
        .join('\n');
}


/**
 * 对单个解析失败的片段块发起补充 API 请求（二次调用）。
 * 原文通过块自身的消息范围精确重建，无精确范围时 fallback 到父总结全段。
 */
async function retryChunkBlock(blockId) {
    const chat = getCurrentChatObject();
    if (!chat) return;

    const block = (chat.memoryChunks || []).find(c => c.blockId === blockId);
    if (!block) { showToast('找不到对应片段'); return; }

    const btn = document.querySelector(`.chunk-retry-btn[data-block-id="${blockId}"]`);
    if (btn) { btn.disabled = true; btn.textContent = '请求中…'; }

    try {
        // [v1.6+] 优先用块自己的消息范围重建原文，避免全段原文 token 过多
        // [Step S3-S4] _rebuildChunkRawText 已异步化（懒加载走 DB）
        const rawText = await _rebuildChunkRawText(block, chat);
        if (!rawText) throw new Error('原文重建失败，消息记录可能已被删除');

        const { url, key, model } = _getMemoryApiConfig('summary', chat);

const sysPrompt = `请为以下对话片段生成详细总结和摘要。严格按格式输出，不要添加任何额外文字：
#CHUNK_BLOCK_0#
内容: <对此片段的详细总结，保留关键人物/事件经过/情感变化/重要约定与伏笔>
摘要: <50字以内的核心摘要，用于向量检索>
情绪: <主要情绪词，如melancholy/warm/tense/playful/anxious/calm>
强度: <0.0到1.0的小数。极严标准：0.1-0.3平静/毫无波澜，0.4-0.6微小起伏/正常交流，0.7-0.8明显波动，0.9-1.0极端爆发或深刻浪漫。日常绝大多数应在0.5以下，切勿滥用高分>
日常: <是/否，"是"=日常闲聊或例行打招呼，"否"=有明显情节推进/冲突/重要表白或约定/新事件>`;

        const response = await fetch(`${url}/v1/chat/completions`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body:    JSON.stringify({
                model,
                messages: [
                    { role: 'system', content: sysPrompt },
                    { role: 'user',   content: `对话片段内容：\n\n${rawText}` }
                ],
                temperature: 0.3
            })
        });

        if (!response.ok) throw new Error(`API Error: ${response.status}`);
        const raw = (await response.json()).choices[0].message.content;

        const contentM = raw.match(/内容[:：]\s*([\s\S]*?)(?=\n摘要[:：]|$)/);
        const summaryM = raw.match(/摘要[:：]\s*(.+)/);
        const emotionM = raw.match(/情绪[:：]\s*(\S+)/);
        const scoreM   = raw.match(/强度[:：]\s*([\d.]+)/);
        const routineM = raw.match(/日常[:：]\s*(是|否)/);  // [v1.6+]

        if (!contentM && !summaryM) throw new Error('AI 未按格式输出，请重试');

        if (contentM) block.detailedContent = contentM[1].trim();
        if (summaryM) block.summary         = summaryM[1].trim();
        block.emotion      = emotionM ? emotionM[1].trim() : (block.emotion || null);
        block.emotionScore = scoreM
            ? Math.min(1, Math.max(0, parseFloat(scoreM[1])))
            : 0.5;
        // [v1.6+] isRoutine：null 保持原值（兼容旧块），新块按 AI 输出设置
        if (routineM) block.isRoutine = routineM[1] === '是';
        block.parseSuccess = true;

        await saveChunksToDB([block]);

        // 重新渲染详情页
        const parentSummary = (chat.memorySummaries || []).find(s => s.id === block.summaryId);
        const contentEl = document.getElementById('summary-detail-content');
        if (parentSummary && contentEl) _renderSummaryBlocks(parentSummary, contentEl, chat);
        renderVectorStats();
        showToast('片段内容已生成！');

    } catch (e) {
        showToast('二次调用失败: ' + e.message);
        if (btn) { btn.disabled = false; btn.textContent = '二次调用'; }
    }
}


// ============================================================
//  [v1.7] "+" 按钮核心逻辑：为短期总结追加空白块
//         旧总结（无 blockIds）：先把 item.content 迁移为第一个块，再追加空白块
//         新总结（有 blockIds）：直接追加空白块
// ============================================================
async function _addBlankChunkToSummary(item, container) {
    const chat = getCurrentChatObject();
    if (!chat) return;

    let needSaveFirstBlock = false;

// ── A. 旧总结迁移：把 content 转为第一个块 ──
const validBlockCount = (chat.memoryChunks || [])
    .filter(c => (item.blockIds || []).includes(c.blockId)).length;

if (!item.blockIds || item.blockIds.length === 0 || validBlockCount === 0) {
    item.blockIds = [];
    if (item.content) {

        // ★ 继承总结的时间戳
        let inheritedStartTime = null;
        if (item.occurredAt) {
            const t = new Date(item.occurredAt);
            if (!isNaN(t)) inheritedStartTime = t.getTime();
        } else if (item.startDate) {
            const t = new Date(item.startDate);
            if (!isNaN(t)) inheritedStartTime = t.getTime();
        } else if (item.createdAt) {
            const t = new Date(item.createdAt);
            if (!isNaN(t)) inheritedStartTime = t.getTime();
        }

        // ★ 继承总结的消息范围
        const inheritedStart = item.range?.start ?? null;
        const inheritedEnd   = item.range?.end   ?? null;
        const inheritedCount = (inheritedStart != null && inheritedEnd != null)
            ? inheritedEnd - inheritedStart + 1
            : 0;

        const migratedId = `blk_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
const migratedBlock = {
    id:              migratedId,      // ★ Dexie 主键，与 blockId 保持一致
    blockId:         migratedId,      // ★ 业务引用
    summaryId:       item.id,
    chatId:          currentChatId,
            chunkIndex:      0,
            detailedContent: item.content,
            summary:         item.summary || '',   // ★ 如果总结本身有摘要字段也继承
            emotion:         null,
            emotionScore:    0,
            parseSuccess:    true,
            isBlankBlock:    false,
            startTime:       inheritedStartTime,   // ★ 继承日期
            startMsgIndex:   inheritedStart,       // ★ 继承范围起
            endMsgIndex:     inheritedEnd,         // ★ 继承范围止
            messageCount:    inheritedCount        // ★ 继承消息数
        };
        item.blockIds.push(migratedBlock.blockId);
        chat.memoryChunks = chat.memoryChunks || [];
        chat.memoryChunks.push(migratedBlock);
        await saveChunksToDB([migratedBlock]);
    }
    needSaveFirstBlock = true;
}

    // ── B. 追加新空白块 ──
    await new Promise(r => setTimeout(r, 2));
    const newId = `blk_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
const newBlock = {
    id:              newId,           // ★ Dexie 主键
    blockId:         newId,           // ★ 业务引用
    summaryId:       item.id,
    chatId:          currentChatId,
        chunkIndex:      item.blockIds.length,
        detailedContent: '',
        summary:         '',
        emotion:         null,
        emotionScore:    0,
        parseSuccess:    true,
        isBlankBlock:    true,   // 标记：向量化时跳过，编辑填写后可手动解除
        messageCount:    0
    };
    item.blockIds.push(newBlock.blockId);
    chat.memoryChunks = chat.memoryChunks || [];
    chat.memoryChunks.push(newBlock);

    // ── C. 持久化 ──
    await saveChunksToDB([newBlock]);
    await saveMemoryItem(item, currentChatId, 'short');

    // ── D. 重新渲染，并自动触发新块进入编辑模式 ──
    _renderSummaryBlocks(item, container, chat);

    setTimeout(() => {
        const allEditBtns = container.querySelectorAll('.chunk-edit-btn');
        const lastEditBtn = allEditBtns[allEditBtns.length - 1];
        if (lastEditBtn) lastEditBtn.click();
    }, 50);

    if (needSaveFirstBlock) {
        renderVectorStats();
    }
}


/**
 * 清除没有对应总结记录的孤立切块。
 * 使用 replaceChunksToDB 彻底清理 IndexedDB，不会残留数据。
 */
async function clearOrphanChunks() {
    const chat = getCurrentChatObject();
    if (!chat) return;

    const validSummaryIds = new Set((chat.memorySummaries || []).map(s => s.id));
    const allChunks       = chat.memoryChunks || [];
    const orphans         = allChunks.filter(c => !validSummaryIds.has(c.summaryId));

    if (orphans.length === 0) {
        showToast('没有孤立切块 ✓');
        return;
    }

    const confirmed = await AppUI.confirm(
        '清除孤立切块',
        `发现 ${orphans.length} 个没有对应总结记录的孤立切块，确定全部清除？\n（向量数据将被删除，总结文字内容不受影响）`
    );
    if (!confirmed) return;

    const validChunks = allChunks.filter(c => validSummaryIds.has(c.summaryId));

    // 内存更新
    chat.memoryChunks = validChunks;

    // DB 彻底清理：先删此 chatId 全部块，再存有效块
    await replaceChunksToDB(validChunks, currentChatId);

    renderVectorStats();

    const hint = document.getElementById('chunk-progress-text');
    if (hint) {
        hint.textContent = `✓ 已清除 ${orphans.length} 个孤立切块`;
        setTimeout(() => { if (hint) hint.textContent = ''; }, 3000);
    }
    showToast(`已清除 ${orphans.length} 个孤立切块`);
}
