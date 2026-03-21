// ==========================================
// peek_messages.js
// 私信列表、对话详情、消息生成
// ==========================================

function renderPeekChatList(conversations = []) {
    const container = document.getElementById('peek-chat-list-container');
    container.innerHTML = '';

    if (!conversations || conversations.length === 0) return;

    const isEdit = PeekDeleteManager.isEditMode && PeekDeleteManager.currentAppType === 'messages';

    conversations.forEach((convo) => {
        if (!convo.id) convo.id = 'msg_old_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        const isSelected = isEdit && PeekDeleteManager.selectedIds.has(convo.id);
        const history = convo.history || [];
        const lastMessage = history.length > 0 ? history[history.length - 1] : null;
        const lastMessageText = lastMessage ? (lastMessage.content || '').replace(/\[.*?的消息：([\s\S]+)\]/, '$1') : '...';

        const li = document.createElement('li');
        li.className = `list-item chat-item ${isEdit ? 'is-selecting' : ''} ${isSelected ? 'selected' : ''}`;
        li.dataset.name = convo.partnerName;
        li.dataset.id = convo.id;

        const avatarUrl = 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg';
        li.innerHTML = `
            <img src="${avatarUrl}" alt="${convo.partnerName}" class="chat-avatar">
            <div class="item-details">
                <div class="item-details-row"><div class="item-name">${convo.partnerName} ${convo.isNew ? '<span class="new-badge">new!</span>' : ''}</div></div>
                <div class="item-preview-wrapper">
                    <div class="item-preview">${lastMessageText}</div>
                </div>
            </div>`;
        container.appendChild(li);
    });
}

function renderPeekConversation(history, partnerName) {
    const titleEl = document.getElementById('peek-conversation-title');
    const messageAreaEl = document.getElementById('peek-message-area');

    titleEl.textContent = partnerName;
    messageAreaEl.innerHTML = '';

    if (!history || history.length === 0) {
        messageAreaEl.innerHTML = '<p class="placeholder-text">正在生成对话...</p>';
        return;
    }

    history.forEach(msg => {
        const isSentByChar = msg.sender === 'char';
        const wrapper = document.createElement('div');
        wrapper.className = `message-wrapper ${isSentByChar ? 'sent' : 'received'}`;

        const bubbleRow = document.createElement('div');
        bubbleRow.className = 'message-bubble-row';

        const bubble = document.createElement('div');
        bubble.className = `message-bubble ${isSentByChar ? 'sent' : 'received'}`;
        bubble.textContent = msg.content;

        if (isSentByChar) {
            bubbleRow.appendChild(bubble);
        } else {
            const avatar = document.createElement('img');
            avatar.className = 'message-avatar';
            avatar.src = 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg';
            bubbleRow.appendChild(avatar);
            bubbleRow.appendChild(bubble);
        }

        wrapper.appendChild(bubbleRow);
        messageAreaEl.appendChild(wrapper);
    });
    messageAreaEl.scrollTop = messageAreaEl.scrollHeight;
}

async function generateAndRenderPeekMessages(options = {}) {
    const appType = 'messages';
    const { forceRefresh = false } = options;

    if (generatingPeekApps.has(appType)) { showToast('消息内容正在生成中，请稍候...'); return; }

    if (!forceRefresh && peekContentCache[appType]) {
        renderPeekChatList(peekContentCache[appType].conversations);
        switchScreen('peek-messages-screen');
        return;
    }

    const char = db.characters.find(c => c.id === window.activePeekCharId);
    if (!char) return showToast('无法找到当前角色');

    const { url, key, model } = db.apiSettings;
    if (!url || !key || !model) { showToast('请先配置 API！'); return switchScreen('api-settings-screen'); }

    generatingPeekApps.add(appType);
    switchScreen('peek-messages-screen');
    const targetContainer = document.getElementById('peek-chat-list-container');
    const hideLoading = showLoadingToast('正在生成对话列表...');

    try {
        const peekSettings = char.peekScreenSettings || {};
        const limitCount = (peekSettings.contextLimit !== undefined) ? peekSettings.contextLimit : 50;
        const mainChatContext = limitCount > 0 ? char.history.slice(-limitCount).map(m => m.content).join('\n') : "";

        const senderName = char.realName || char.name;
        const baseContextPrompt = getPeekBasePromptContext(char, mainChatContext);

        let systemPrompt = `你正在模拟角色 ${char.realName} 的手机聊天/消息应用。\n`;
        systemPrompt += baseContextPrompt;
        systemPrompt += `
【任务1：消息记录】
请为 ${char.realName} 编造3-5个最近的对话。对话内容需要强烈反映Ta的人设以及和最近聊天上下文。
每段对话需要提供对话对象的称呼(#PARTNER#)以及具体的聊天记录(#HISTORY#)。
在 #HISTORY# 中，请严格使用以下格式记录每条消息：
如果是 ${char.realName} 发送的，以 "char: " 开头；
如果是对方发送的，以 "partner: " 开头。

【任务2：话题分享】
在消息记录生成完毕后，请从刚刚生成的这几段对话中挑选1个值得吐槽或分享的对话，预测一下，在未来的某个时间，${senderName}会主动把这个对话内容当成话题发消息分享给${char.myName}。
`;
        systemPrompt += getPeekProactiveFormatPrompt(char);
        systemPrompt += `
请严格按照以下标签文本格式输出，**每段对话之间使用 ===SEP=== 分隔**。在所有对话结束后，使用 ===PROACTIVE_MESSAGES=== 分割，再输出主动消息。

输出格式示例：
#PARTNER#
与Ta对话的人的称呼
#HISTORY#
partner: 对方发送的消息内容
char: ${char.realName}发送的消息内容
partner: 对方发送的消息内容
===SEP===
#PARTNER#
与Ta对话的人的称呼
#HISTORY#
partner: 对方发送的消息内容
char: ${char.realName}发送的消息内容
===PROACTIVE_MESSAGES===
#SECRET_CHAT_EVENING_85%#[19:15|${senderName}的消息:突然好想吃我妈做的排骨啊(T_T)][19:16|${senderName}的消息:你吃晚饭了吗？]
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
        const messagesRawText = parts[0] || '';
        const hitchhikerRawText = parts.length > 1 ? parts[1] : '';

        const rawItems = messagesRawText.split('===SEP===');
        const parsedConversations = [];

        rawItems.forEach(rawText => {
            if (!rawText.trim()) return;
            const partnerMatch = rawText.match(/#PARTNER#\s*([\s\S]*?)(?=#HISTORY#|$)/);
            const historyMatch = rawText.match(/#HISTORY#\s*([\s\S]*?)(?=(?:===SEP===|$))/);

            if (partnerMatch && historyMatch) {
                const historyLines = historyMatch[1].trim().split('\n');
                const history = [];
                historyLines.forEach(line => {
                    if (line.trim().toLowerCase().startsWith('char:')) {
                        history.push({ sender: 'char', content: line.replace(/^char:\s*/i, '').trim() });
                    } else if (line.trim().toLowerCase().startsWith('partner:')) {
                        history.push({ sender: 'partner', content: line.replace(/^partner:\s*/i, '').trim() });
                    }
                });

                if (history.length > 0) {
                    parsedConversations.push({
                        id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                        partnerName: partnerMatch[1].trim(),
                        history: history,
                        isNew: true
                    });
                }
            }
        });

        if (parsedConversations.length > 0) {
            if (!peekContentCache['messages']) peekContentCache['messages'] = { conversations: [] };
            peekContentCache['messages'].conversations = [...parsedConversations, ...peekContentCache['messages'].conversations];
            savePeekData(char.id).catch(e => console.error("Peek自动保存失败:", e));
            renderPeekChatList(peekContentCache['messages'].conversations);
        } else {
            throw new Error("解析消息内容失败，未找到对应标签。");
        }

        if (hitchhikerRawText.trim()) {
            parseAndSavePeekProactiveHitchhiker(char, hitchhikerRawText);
            saveSingleChat(char.id, 'private').catch(e => console.error(e));
        }

    } catch (error) {
        console.error(error);
        showApiError(error);
        if (peekContentCache['messages']?.conversations?.length > 0) {
            renderPeekChatList(peekContentCache['messages'].conversations);
            if (typeof showToast === 'function') showToast('刷新失败: ' + error.message);
        } else {
            if (targetContainer) {
                targetContainer.innerHTML = `<li class="list-item chat-item"><p class="placeholder-text" style="color:#ff4d4f; text-align:center; width:100%;">内容生成失败，请重试。<br><span style="font-size:12px;">${error.message}</span></p></li>`;
            }
        }
    } finally {
        generatingPeekApps.delete(appType);
        hideLoading();
    }
}
