// ==========================================
// peek_transfer.js
// 中转站渲染、中转站生成
// ==========================================

function renderPeekTransferStation(entries) {
    const screen = document.getElementById('peek-transfer-station-screen');
    let messagesHtml = '';

    const isEdit = PeekDeleteManager.isEditMode && PeekDeleteManager.currentAppType === 'transfer';

    if (!entries || entries.length === 0) {
        messagesHtml = '<p class="placeholder-text">正在生成中转站内容...</p>';
    } else {
        // 旧版字符串数据格式迁移
        let needsSave = false;
        for (let i = 0; i < entries.length; i++) {
            if (typeof entries[i] === 'string') {
                entries[i] = {
                    id: 'transfer_old_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
                    content: entries[i],
                    isNew: false
                };
                needsSave = true;
            } else if (!entries[i].id) {
                entries[i].id = 'transfer_old_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
                needsSave = true;
            }
        }
        if (needsSave && window.activePeekCharId) {
            savePeekData(window.activePeekCharId).catch(e => console.error(e));
        }

        entries.forEach(entry => {
            const isSelected = isEdit && PeekDeleteManager.selectedIds.has(entry.id);
            messagesHtml += `
                <div class="message-wrapper sent transfer-item ${isEdit ? 'is-selecting' : ''} ${isSelected ? 'selected' : ''}" data-id="${entry.id}" style="position:relative;">
                    <div class="message-bubble-row" style="align-items: center;">
                        <div class="message-bubble sent" style="background-color: #98E165; color: #000;">
                            ${entry.content}
                        </div>
                        ${entry.isNew ? '<span class="new-badge" style="margin-left: 8px;">new!</span>' : ''}
                    </div>
                </div>
            `;
        });
    }

    screen.innerHTML = `
        <header class="app-header">
            <button class="back-btn" data-target="peek-screen">‹</button>
            <div class="title-container">
                <h1 class="title">文件传输助手</h1>
            </div>
            <button class="action-btn">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"></path></svg>
            </button>
        </header>
        <main class="content">
            <div class="message-area" style="padding: 10px;">
                ${messagesHtml}
            </div>
            <div class="transfer-station-input-area">
                <div class="fake-input"></div>
                <button class="plus-btn"></button>
            </div>
        </main>
    `;

    screen.querySelector('.action-btn').addEventListener('click', () => generateAndRenderPeekTransfer({ forceRefresh: true }));

    const messageArea = screen.querySelector('.message-area');
    if (messageArea) messageArea.scrollTop = messageArea.scrollHeight;

    let hasNewTransfer = false;
    if (entries) {
        entries.forEach(entry => {
            if (entry.isNew) { entry.isNew = false; hasNewTransfer = true; }
        });
        if (hasNewTransfer) savePeekData(window.activePeekCharId);
    }
}

async function generateAndRenderPeekTransfer(options = {}) {
    const appType = 'transfer';
    const { forceRefresh = false } = options;

    if (generatingPeekApps.has(appType)) { showToast('中转站内容正在生成中，请稍候...'); return; }

    if (!forceRefresh && peekContentCache[appType]) {
        renderPeekTransferStation(peekContentCache[appType].entries);
        switchScreen('peek-transfer-station-screen');
        return;
    }

    const char = db.characters.find(c => c.id === window.activePeekCharId);
    if (!char) return showToast('无法找到当前角色');

    const { url, key, model } = db.apiSettings;
    if (!url || !key || !model) { showToast('请先配置 API！'); return switchScreen('api-settings-screen'); }

    generatingPeekApps.add(appType);
    switchScreen('peek-transfer-station-screen');
    const hideLoading = showLoadingToast('正在生成中转站消息...');

    try {
        const peekSettings = char.peekScreenSettings || {};
        const limitCount = (peekSettings.contextLimit !== undefined) ? peekSettings.contextLimit : 50;
        const mainChatContext = limitCount > 0 ? char.history.slice(-limitCount).map(m => m.content).join('\n') : "";

        const senderName = char.realName || char.name;
        const baseContextPrompt = getPeekBasePromptContext(char, mainChatContext);

        let systemPrompt = `你正在模拟角色 ${char.realName} 的文件传输助手（即发送给自己的消息记录）。\n`;
        systemPrompt += baseContextPrompt;
        systemPrompt += `
【任务1：中转站记录】
请为 ${char.realName} 生成4-7条Ta发送给自己的、简短零碎的消息。
这些内容应该像是Ta的临时备忘、灵感闪现或随手保存的链接，要与Ta的人设和最近聊天上下文高度相关，但比"备忘录"应用的内容更随意、更口语化。

【任务2：话题分享】
在中转站记录生成完毕后，请从刚刚生成的内容中挑选1个灵感/链接/备忘，预测一下，在未来的某个时间，${senderName}会围绕这个灵感/链接，发送消息给${char.myName}开启话题或分享日常。
`;
        systemPrompt += getPeekProactiveFormatPrompt(char);
        systemPrompt += `
请严格按照以下标签文本格式输出，**每条中转站消息之间使用 ===SEP=== 分隔**。在所有消息结束后，使用 ===PROACTIVE_MESSAGES=== 分割，再输出主动消息。

输出格式示例：
#ENTRY#
要记得买牛奶。
===SEP===
#ENTRY#
https://example.com/interesting-article
===SEP===
#ENTRY#
刚刚那个想法不错，可以深入一下...
===PROACTIVE_MESSAGES===
#SECRET_CHAT_NOON_85%#[12:15|${senderName}的消息:我前阵子看到一篇关于心理学的文章，挺有意思的][12:16|${senderName}的消息:https://example.com/interesting-article]
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
        const transferRawText = parts[0] || '';
        const hitchhikerRawText = parts.length > 1 ? parts[1] : '';

        const rawItems = transferRawText.split('===SEP===');
        const parsedEntries = [];

        rawItems.forEach((rawText) => {
            if (!rawText.trim()) return;
            const entryMatch = rawText.match(/#ENTRY#\s*([\s\S]*)$/i);
            if (entryMatch && entryMatch[1].trim()) {
                parsedEntries.push({
                    id: `transfer_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                    content: entryMatch[1].trim(),
                    isNew: true
                });
            }
        });

        if (parsedEntries.length > 0) {
            if (!peekContentCache['transfer']) peekContentCache['transfer'] = { entries: [] };
            peekContentCache['transfer'].entries = [...parsedEntries, ...peekContentCache['transfer'].entries];
            savePeekData(char.id).catch(e => console.error("Peek自动保存失败:", e));
            renderPeekTransferStation(peekContentCache['transfer'].entries);
        } else {
            throw new Error("解析中转站内容失败，未找到对应标签。");
        }

        if (hitchhikerRawText.trim()) {
            parseAndSavePeekProactiveHitchhiker(char, hitchhikerRawText);
            saveSingleChat(char.id, 'private').catch(e => console.error(e));
        }

    } catch (error) {
        console.error(error);
        showApiError(error);
        if (peekContentCache['transfer']?.entries?.length > 0) {
            renderPeekTransferStation(peekContentCache['transfer'].entries);
            if (typeof showToast === 'function') showToast('刷新失败: ' + error.message);
        } else {
            const screen = document.getElementById('peek-transfer-station-screen');
            if (screen) {
                const messageArea = screen.querySelector('.message-area');
                if (messageArea) messageArea.innerHTML = `<p class="placeholder-text" style="color:#ff4d4f; text-align:center;">内容生成失败，请重试。<br><span style="font-size:12px;">${error.message}</span></p>`;
            }
        }
    } finally {
        generatingPeekApps.delete(appType);
        hideLoading();
    }
}
