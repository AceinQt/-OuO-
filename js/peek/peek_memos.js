// ==========================================
// peek_memos.js
// 备忘录列表、备忘录详情、备忘录生成
// ==========================================

function renderMemosList(memos) {
    const screen = document.getElementById('peek-memos-screen');
    let listHtml = '';
    const isEdit = PeekDeleteManager.isEditMode && PeekDeleteManager.currentAppType === 'memos';

    if (!memos || memos.length === 0) {
        listHtml = '<p class="placeholder-text">正在生成备忘录...</p>';
    } else {
        memos.forEach(memo => {
            if (!memo.id) memo.id = 'memo_old_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
            const isSelected = isEdit && PeekDeleteManager.selectedIds.has(memo.id);
            const firstLine = memo.content.split('\n')[0];
            listHtml += `
                <li class="memo-item ${isEdit ? 'is-selecting' : ''} ${isSelected ? 'selected' : ''}" data-id="${memo.id}">
                    <h3 class="memo-item-title">${memo.title} ${memo.isNew ? '<span class="new-badge">new!</span>' : ''}</h3>
                    <p class="memo-item-preview">${firstLine}</p>
                </li>
            `;
        });
    }

    screen.innerHTML = `
        <header class="app-header">
            <button class="back-btn" data-target="peek-screen">‹</button>
            <div class="title-container"><h1 class="title">备忘录</h1></div>
            <button class="action-btn"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"></path></svg></button>
        </header>
        <main class="content"><ul id="peek-memos-list">${listHtml}</ul></main>
    `;

    screen.querySelector('.action-btn').addEventListener('click', () => {
        generateAndRenderPeekMemos({ forceRefresh: true });
    });

    screen.querySelectorAll('.memo-item').forEach(item => {
        item.addEventListener('click', () => {
            if (PeekDeleteManager.isEditMode) return;
            const memo = peekContentCache.memos?.memos?.find(m => m.id === item.dataset.id);
            if (memo) {
                if (memo.isNew) {
                    memo.isNew = false;
                    savePeekData(window.activePeekCharId);
                    const badge = item.querySelector('.new-badge');
                    if (badge) badge.remove();
                }
                renderMemoDetail(memo);
                switchScreen('peek-memo-detail-screen');
            }
        });
    });
}

function renderMemoDetail(memo) {
    const screen = document.getElementById('peek-memo-detail-screen');
    if (!memo) return;
    const contentHtml = memo.content.replace(/\n/g, '<br>');
    screen.innerHTML = `
        <header class="app-header">
            <button class="back-btn" data-target="peek-memos-screen">‹</button>
            <div class="title-container"><h1 class="title">${memo.title}</h1></div>
            <button class="action-btn"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"></path></svg></button>
        </header>
        <main class="content" style="padding: 20px; line-height: 1.6;">${contentHtml}</main>
    `;
}

async function generateAndRenderPeekMemos(options = {}) {
    const appType = 'memos';
    const { forceRefresh = false } = options;

    if (generatingPeekApps.has(appType)) { showToast('备忘录内容正在生成中，请稍候...'); return; }

    if (!forceRefresh && peekContentCache[appType]) {
        renderMemosList(peekContentCache[appType].memos);
        switchScreen('peek-memos-screen');
        return;
    }

    const char = db.characters.find(c => c.id === window.activePeekCharId);
    if (!char) return showToast('无法找到当前角色');

    const { url, key, model } = db.apiSettings;
    if (!url || !key || !model) { showToast('请先配置 API！'); return switchScreen('api-settings-screen'); }

    generatingPeekApps.add(appType);
    switchScreen('peek-memos-screen');
    const hideLoading = showLoadingToast('正在生成备忘录...');

    try {
        const peekSettings = char.peekScreenSettings || {};
        const limitCount = (peekSettings.contextLimit !== undefined) ? peekSettings.contextLimit : 50;
        const mainChatContext = limitCount > 0 ? char.history.slice(-limitCount).map(m => m.content).join('\n') : "";

        const senderName = char.realName || char.name;
        const baseContextPrompt = getPeekBasePromptContext(char, mainChatContext);

        let systemPrompt = `你正在模拟角色 ${char.realName} 的手机备忘录应用。\n`;
        systemPrompt += baseContextPrompt;
        systemPrompt += `
【任务1：备忘录内容】
请为 ${char.realName} 生成3-4条备忘录。内容要与${char.realName}的人设和最近聊天上下文高度相关。备忘录可以反映${char.realName}的计划、灵感、或者是日常琐事，备忘录正文(#CONTENT#)中可以包含换行符。

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
备忘录内容，可以包含换行符
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

        const requestBody = { model: model, messages: [{ role: 'user', content: systemPrompt }], temperature: 0.85 };
        const response = await fetch(`${url}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) throw new Error(`API error: ${response.status}`);
        const result = await response.json();
        const contentStr = result.choices[0].message.content.trim();

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
            renderMemosList(peekContentCache['memos'].memos);
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
            renderMemosList(peekContentCache['memos'].memos);
            if (typeof showToast === 'function') showToast('刷新失败: ' + error.message);
        } else {
            const listEl = document.getElementById('peek-memos-list');
            if (listEl) listEl.innerHTML = `<li class="memo-item"><p class="placeholder-text" style="color:#ff4d4f; text-align:center;">内容生成失败，请重试。<br><span style="font-size:12px;">${error.message}</span></p></li>`;
        }
    } finally {
        generatingPeekApps.delete(appType);
        hideLoading();
    }
}
