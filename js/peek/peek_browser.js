// ==========================================
// peek_browser.js
// 浏览器历史渲染、浏览器历史生成
// ==========================================

function renderPeekBrowser(historyItems) {
    const screen = document.getElementById('peek-browser-screen');
    let itemsHtml = '';
    const isEdit = PeekDeleteManager.isEditMode && PeekDeleteManager.currentAppType === 'browser';

    if (!historyItems || historyItems.length === 0) {
        itemsHtml = '<p class="placeholder-text">正在生成浏览记录...</p>';
    } else {
        historyItems.forEach(item => {
            if (!item.id) item.id = 'browser_old_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
            const isSelected = isEdit && PeekDeleteManager.selectedIds.has(item.id);
            itemsHtml += `
                <li class="browser-history-item ${isEdit ? 'is-selecting' : ''} ${isSelected ? 'selected' : ''}" data-id="${item.id}">
                    <h3 class="history-item-title">${item.isNew ? '<span class="new-badge">new!</span>' : ''}${item.title}</h3>
                    <p class="history-item-url">${item.url}</p>
                    <div class="history-item-annotation">${item.annotation}</div>
                </li>
            `;
        });
    }

    screen.innerHTML = `
        <header class="app-header">
            <button class="back-btn" data-target="peek-screen">‹</button>
            <div class="title-container"><h1 class="title">浏览器</h1></div>
            <button class="action-btn"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"></path></svg></button>
        </header>
        <main class="content"><ul class="browser-history-list">${itemsHtml}</ul></main>
    `;

    screen.querySelector('.action-btn').addEventListener('click', () => generateAndRenderPeekBrowser({ forceRefresh: true }));

    let hasNewBrowser = false;
    if (historyItems) {
        historyItems.forEach(item => {
            if (item.isNew) { item.isNew = false; hasNewBrowser = true; }
        });
        if (hasNewBrowser) savePeekData(window.activePeekCharId);
    }
}

async function generateAndRenderPeekBrowser(options = {}) {
    const appType = 'browser';
    const { forceRefresh = false } = options;

    if (generatingPeekApps.has(appType)) { showToast('浏览器内容正在生成中，请稍候...'); return; }

    if (!forceRefresh && peekContentCache[appType]) {
        renderPeekBrowser(peekContentCache[appType].history);
        switchScreen('peek-browser-screen');
        return;
    }

    const char = db.characters.find(c => c.id === window.activePeekCharId);
    if (!char) return showToast('无法找到当前角色');

    const { url, key, model } = db.apiSettings;
    if (!url || !key || !model) { showToast('请先配置 API！'); return switchScreen('api-settings-screen'); }

    generatingPeekApps.add(appType);
    switchScreen('peek-browser-screen');
    const hideLoading = showLoadingToast('正在生成浏览记录...');

    try {
        const peekSettings = char.peekScreenSettings || {};
        const limitCount = (peekSettings.contextLimit !== undefined) ? peekSettings.contextLimit : 50;
        const mainChatContext = limitCount > 0 ? char.history.slice(-limitCount).map(m => m.content).join('\n') : "";

        const senderName = char.realName || char.name;
        const baseContextPrompt = getPeekBasePromptContext(char, mainChatContext);

        let systemPrompt = `你正在模拟角色 ${char.realName} 的手机浏览器浏览记录。\n`;
        systemPrompt += baseContextPrompt;
        systemPrompt += `
【任务1：浏览器记录】
请生成3-5条浏览记录。记录本身要符合${char.realName}的人设和最近聊天上下文，'ANNOTATION' 字段则要站在角色自己的视角，记录Ta对这条浏览记录的想法或批注。

【任务2：话题分享】
在浏览记录生成完毕后，请从你刚刚生成的内容中挑选1个你认为最适合分享给${char.myName}的网页。
预测一下，在未来的某个时间，${senderName}会根据这个网页内容，发送消息给${char.myName}开启话题。
`;
        systemPrompt += getPeekProactiveFormatPrompt(char);
        systemPrompt += `
请严格按照以下标签文本格式输出，**浏览记录之间使用 ===SEP=== 分隔**。在浏览记录结束后，使用 ===PROACTIVE_MESSAGES=== 分割，再输出主动消息。

输出格式示例：
#TITLE#
超简单！10分钟搞定的快手早餐教程
#URL#
www.example.com/breakfast-tutorial
#ANNOTATION#
明早可以试试看，看起来很好吃。
===SEP===
#TITLE#
网页标题
#URL#
www.example.com/tech-review-2026
#ANNOTATION#
角色对于这条浏览记录的想法或批注
===PROACTIVE_MESSAGES===
#SECRET_CHAT_EVENING_85%#[19:15|${senderName}的消息:最近有没有什么特别想吃的？][19:16|${senderName}的消息:我刚刚看到一个不错的菜谱，周末我们一起做做看？]
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
        const browserRawText = parts[0] || '';
        const hitchhikerRawText = parts.length > 1 ? parts[1] : '';

        const rawItems = browserRawText.split('===SEP===');
        const parsedHistory = [];

        rawItems.forEach(rawText => {
            if (!rawText.trim()) return;
            const titleMatch = rawText.match(/#TITLE#\s*([\s\S]*?)(?=#URL#|$)/);
            const urlMatch = rawText.match(/#URL#\s*([\s\S]*?)(?=#ANNOTATION#|$)/);
            const annoMatch = rawText.match(/#ANNOTATION#\s*([\s\S]*?)(?=(?:===SEP===|$))/);

            if (titleMatch && urlMatch) {
                parsedHistory.push({
                    id: `browser_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                    title: titleMatch[1].trim(),
                    url: urlMatch[1].trim(),
                    annotation: annoMatch ? annoMatch[1].trim() : '',
                    isNew: true
                });
            }
        });

        if (parsedHistory.length > 0) {
            if (!peekContentCache['browser']) peekContentCache['browser'] = { history: [] };
            peekContentCache['browser'].history = [...parsedHistory, ...peekContentCache['browser'].history];
            savePeekData(char.id).catch(e => console.error("Peek自动保存失败:", e));
            renderPeekBrowser(peekContentCache['browser'].history);
        } else {
            throw new Error("解析浏览器内容失败，未找到对应标签。");
        }

        if (hitchhikerRawText.trim()) {
            parseAndSavePeekProactiveHitchhiker(char, hitchhikerRawText);
            saveSingleChat(char.id, 'private').catch(e => console.error(e));
        }

    } catch (error) {
        console.error(error);
        showApiError(error);
        if (peekContentCache['browser']?.history?.length > 0) {
            renderPeekBrowser(peekContentCache['browser'].history);
            if (typeof showToast === 'function') showToast('刷新失败: ' + error.message);
        } else {
            document.querySelector('#peek-browser-screen .browser-history-list').innerHTML = `<li class="browser-history-item"><p class="placeholder-text" style="text-align:center;">内容生成失败，请重试。<br><span style="font-size:12px;color:#999;">${error.message}</span></p></li>`;
        }
    } finally {
        generatingPeekApps.delete(appType);
        hideLoading();
    }
}
