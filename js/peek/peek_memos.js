
// ==========================================
// peek_memos.js
// 备忘录列表、备忘录详情、备忘录生成
// ==========================================

let currentMemoPage = 0;
const MEMOS_PER_PAGE = 20;

function renderMemosList(memos, isAppend = false, resetPage = false) {
    if (resetPage) {
        currentMemoPage = 0;
    }

    const list = document.getElementById('peek-memos-list');
    const placeholder = document.getElementById('peek-memos-placeholder');
    if (!list) return;

    // 当不处于追加模式时（初次加载或重绘整个列表）
    if (!isAppend) {
        list.innerHTML = '';
        if (!memos || memos.length === 0) {
            placeholder.classList.add('visible');
            list.style.display = 'none';
            const tip = document.getElementById('memo-loading-tip');
            if (tip) tip.remove();
            return;
        }
        placeholder.classList.remove('visible');
        list.style.display = 'flex';
    }

    const isEdit = PeekDeleteManager.isEditMode && PeekDeleteManager.currentAppType === 'memos';

    // 如果是追加加载，只渲染当前页的数据；如果是全量重绘，渲染从第0页到当前页的数据
    const startIndex = isAppend ? currentMemoPage * MEMOS_PER_PAGE : 0;
    const endIndex = (currentMemoPage + 1) * MEMOS_PER_PAGE;
    const dataToRender = memos.slice(startIndex, endIndex);

    const iconSvg = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M19 4H5C3.89543 4 3 4.89543 3 6V20C3 21.1046 3.89543 22 5 22H19C20.1046 22 21 21.1046 21 20V6C21 4.89543 20.1046 4 19 4Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M12 11H17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M12 15H17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M7 11V11.01" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M7 15V15.01" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M8 2V6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M16 2V6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;

    dataToRender.forEach(memo => {
        if (!memo.id) memo.id = 'memo_old_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        const isSelected = isEdit && PeekDeleteManager.selectedIds.has(memo.id);
        
        const plainText = memo.content.replace(/<[^>]*>/g, '').trim();
        const firstLine = plainText.split('\n')[0].slice(0, 15);
        const previewStr = firstLine + (plainText.length > 15 ? '…' : '');

        const li = document.createElement('li');
        li.className = `memo-card-item ${isEdit ? 'is-selecting' : ''} ${isSelected ? 'selected' : ''}`;
        li.dataset.id = memo.id;

        li.innerHTML = `
            <div class="memo-card-icon-wrapper">
                <div class="memo-card-paper">${iconSvg}</div>
            </div>
            <div class="memo-card-content">
                <div class="memo-card-title">${memo.title} ${memo.isNew ? '<span class="peek-new-badge">new!</span>' : ''}</div>
                <div class="memo-card-subtitle">${previewStr}</div>
            </div>
        `;
        list.appendChild(li);
    });

    // 检查是否需要显示底部加载提示
    let loadingTip = document.getElementById('memo-loading-tip');
    if (endIndex < memos.length) {
        if (!loadingTip) {
            loadingTip = document.createElement('div');
            loadingTip.id = 'memo-loading-tip';
            loadingTip.className = 'memo-loading-tip';
            loadingTip.textContent = '上滑加载更多...';
            list.parentElement.appendChild(loadingTip);
        }
        loadingTip.style.display = 'block';
    } else {
        if (loadingTip) loadingTip.style.display = 'none';
    }
}

// ==========================================
// 点击列表项 -> 进入详情
// ==========================================
function _onMemoItemClick(e) {
    if (PeekDeleteManager.isEditMode) return;
    const li = e.target.closest('.memo-card-item');
    if (!li) return;
    const memoId = li.dataset.id;
    const memo = peekContentCache.memos?.memos?.find(m => m.id === memoId);
    
    if (memo) {
        if (memo.isNew) {
            memo.isNew = false;
            savePeekData(window.activePeekCharId);
            const badge = li.querySelector('.peek-new-badge');
            if (badge) badge.remove();
        }
        renderMemoDetail(memo);
        switchScreen('peek-memo-detail-screen');
    }
}

function renderMemoDetail(memo) {
    if (!memo) return;
    
    // 取消原有头部的title绑定，转移到纸条内部的大标题 DOM
    const paperTitleEl = document.getElementById('memo-paper-title');
    const contentEl = document.getElementById('memo-detail-content');
    
    if (paperTitleEl) paperTitleEl.textContent = memo.title;
    
    if (contentEl) {
        let htmlContent = memo.content;
        if (typeof marked !== 'undefined') {
            htmlContent = marked.parse(memo.content);
        } else {
            htmlContent = memo.content
                .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") 
                .replace(/\n/g, '<br>')
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.*?)\*/g, '<em>$1</em>');
        }
        contentEl.innerHTML = htmlContent;
    }
}

async function generateAndRenderPeekMemos(options = {}) {
    const appType = 'memos';
    const { forceRefresh = false } = options;

    if (generatingPeekApps.has(appType)) { showToast('备忘录内容正在生成中，请稍候...'); return; }

    if (!forceRefresh && peekContentCache[appType]) {
        // 非刷新进入时，重置页码并渲染第一页
        renderMemosList(peekContentCache[appType].memos, false, true);
        switchScreen('peek-memos-screen');
        return;
    }

    const char = db.characters.find(c => c.id === window.activePeekCharId);
    if (!char) return showToast('无法找到当前角色');

    const { url, key, model, streamEnabled, temperature } = getPeekApiConfig(window.activePeekCharId);
    if (!url || !key || !model) { showToast('请先配置 API！'); return switchScreen('api-settings-screen'); }

    generatingPeekApps.add(appType);
    switchScreen('peek-memos-screen');
    const hideLoading = showLoadingToast('正在生成备忘录...');

    try {
        const peekSettings = char.peekScreenSettings || {};
        const limitCount = (peekSettings.contextLimit !== undefined) ? peekSettings.contextLimit : 50;
        const mainChatContext = limitCount > 0 ? historyToPlainText(char.history.slice(-limitCount)) : "";

        const senderName = char.realName || char.name;
        const baseContextPrompt = getPeekBasePromptContext(char, mainChatContext);

        let systemPrompt = `你正在模拟角色 ${char.realName} 的手机备忘录应用。\n`;
        systemPrompt += baseContextPrompt;
        systemPrompt += `
【任务1：备忘录内容】
请为 ${char.realName} 生成3-4条备忘录。内容要与${char.realName}的人设和最近聊天上下文高度相关。备忘录可以反映${char.realName}的计划、灵感、或者是日常琐事。

【任务2：话题分享】
在备忘录内容生成完毕后，请从刚刚生成的备忘录中挑选1个最可能引发交流的，预测一下，在未来的某个时间，${senderName}会根据这个备忘录的内容，发送消息给${char.myName}开启话题。
`;
        systemPrompt += getPeekProactiveFormatPrompt(char);
        systemPrompt += `
请严格按照以下标签文本格式输出，**备忘录之间使用 ===SEP=== 分隔**。在所有备忘录结束后，使用 ===PROACTIVE_MESSAGES=== 分割，再输出主动消息。

输出格式示例：
#ID#
memo_1
#TITLE#
备忘录1标题
#CONTENT#
备忘录内容
===SEP===
#ID#
memo_2
#TITLE#
备忘录2标题
#CONTENT#
备忘录内容...
可以包含多行...
===PROACTIVE_MESSAGES===
#SECRET_CHAT_AFTERNOON_85%#[15:15|${senderName}的消息:你这周末有空吗？][15:16|${senderName}的消息:我打算去趟超市买点东西，要不要一起？]
`;

        const contentStr = await callPeekApi({ url, key, model, messages: [{ role: 'user', content: systemPrompt }], temperature, streamEnabled });

        const parts = contentStr.split(/===PROACTIVE_MESSAGES===/i);
        const memosRawText = parts[0] || '';
        const hitchhikerRawText = parts.length > 1 ? parts[1] : '';

        const rawItems = memosRawText.split('===SEP===');
        const parsedMemos = [];

        rawItems.forEach((rawText) => {
            if (!rawText.trim()) return;
            const titleMatch = rawText.match(/#TITLE#\s*([\s\S]*?)(?=#CONTENT#|$)/);
            const contentMatch = rawText.match(/#CONTENT#\s*([\s\S]*?)(?=(?:===SEP===|$))/);

            if (titleMatch && contentMatch) {
                parsedMemos.push({
                    id: `memo_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                    title: titleMatch[1].trim(),
                    content: contentMatch[1].trim(),
                    isNew: true
                });
            }
        });

        if (parsedMemos.length > 0) {
            if (!peekContentCache['memos']) peekContentCache['memos'] = { memos: [] };
            peekContentCache['memos'].memos = [...parsedMemos, ...peekContentCache['memos'].memos];
            savePeekData(char.id).catch(e => console.error("Peek自动保存失败:", e));
            
            // 重新生成完毕后，刷新并重置页码
            renderMemosList(peekContentCache['memos'].memos, false, true);
        } else {
            throw new Error("解析备忘录内容失败，未找到对应标签。");
        }

        if (hitchhikerRawText.trim()) {
            parseAndSavePeekProactiveHitchhiker(char, hitchhikerRawText);
            saveSingleChat(char.id, 'private').catch(e => console.error(e));
        }

    } catch (error) {
        console.error(error);
        showApiError(error);
        if (peekContentCache['memos']?.memos?.length > 0) {
            renderMemosList(peekContentCache['memos'].memos, false, true);
            if (typeof showToast === 'function') showToast('刷新失败: ' + error.message);
        } else {
            const listEl = document.getElementById('peek-memos-list');
            if (listEl) listEl.innerHTML = `<li class="memo-card-item" style="display:flex; justify-content:center;"><p class="placeholder-text" style="color:#ff4d4f; text-align:center;">内容生成失败，请重试。<br><span style="font-size:12px;">${error.message}</span></p></li>`;
        }
    } finally {
        generatingPeekApps.delete(appType);
        hideLoading();
    }
}

// ==========================================
// 初始化备忘录事件（供 peek_core.js 调用）
// ==========================================
function initPeekMemosEvents() {
    document.getElementById('refresh-memos-btn')
        ?.addEventListener('click', () => generateAndRenderPeekMemos({ forceRefresh: true }));

    document.getElementById('peek-memos-list')
        ?.addEventListener('click', _onMemoItemClick);

    // 绑定滚动分页加载
    const scrollContainer = document.querySelector('#peek-memos-screen .content');
    if (scrollContainer) {
        scrollContainer.addEventListener('scroll', () => {
            const memos = peekContentCache?.memos?.memos || [];
            if (memos.length === 0) return;
            const endIndex = (currentMemoPage + 1) * MEMOS_PER_PAGE;
            if (endIndex >= memos.length) return; // 已经加载完所有页

            // 判断滚动是否触底（预留 50px 的容差）
            if (scrollContainer.scrollTop + scrollContainer.clientHeight >= scrollContainer.scrollHeight - 50) {
                currentMemoPage++;
                renderMemosList(memos, true, false); // 追加渲染，不重置页码
            }
        });
    }
}
