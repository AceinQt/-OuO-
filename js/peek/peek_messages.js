// ==========================================
// peek_messages.js
// 私信列表、对话详情、消息生成
// ==========================================

function renderPeekChatList(conversations =[]) {
    const container = document.getElementById('peek-chat-list-container');
    container.innerHTML = '';

    if (!conversations || conversations.length === 0) return;

    const isEdit = PeekDeleteManager.isEditMode && PeekDeleteManager.currentAppType === 'messages';

    conversations.forEach((convo) => {
        if (!convo.id) convo.id = 'msg_old_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        const isSelected = isEdit && PeekDeleteManager.selectedIds.has(convo.id);

        const history = convo.history || [];
        const lastMessage =[...history].reverse().find(m => m.type !== 'time-divider') || null;
        const lastMessageText = lastMessage ? (lastMessage.content || '').replace(/\[.*?的消息：([\s\S]+)\]/, '$1') : '...';

        // 提取最新时间：如果有更新时间戳则直接格式化，否则向后寻找最近的时间分割线
        let timeStr = '';
        if (convo.lastUpdated) {
            timeStr = typeof formatSmartTime === 'function' ? formatSmartTime(convo.lastUpdated) : new Date(convo.lastUpdated).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        } else {
            const lastDiv = [...history].reverse().find(m => m.content === '[time-divider]' && m.timestamp);
            if (lastDiv) timeStr = typeof formatSmartTime === 'function' ? formatSmartTime(lastDiv.timestamp) : '';
        }

        const li = document.createElement('li');
        li.className = `list-item chat-item ${isEdit ? 'is-selecting' : ''} ${isSelected ? 'selected' : ''}`;
        li.dataset.name = convo.partnerName;
        li.dataset.id = convo.id;

        const avatarUrl = 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg';
        
        // 屏蔽标记图标
        const hiddenIcon = convo.isHidden ? 
            `<svg class="hidden-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>` : '';

        li.innerHTML = `
            <img src="${avatarUrl}" alt="${convo.partnerName}" class="chat-avatar">
            <div class="item-details">
                <div class="item-details-row">
                    <div class="item-name">${convo.partnerName} ${convo.isNew ? '<span class="new-badge">new!</span>' : ''}</div>
                    <div class="item-time">${timeStr}</div>
                </div>
                <div class="item-preview-wrapper">
                    <div class="item-preview">${lastMessageText}</div>
                    ${hiddenIcon}
                </div>
            </div>`;
        container.appendChild(li);
    });
}

function renderPeekConversation(history, partnerName, wasNew = false) {
    const titleEl = document.getElementById('peek-conversation-title');
    const messageAreaEl = document.getElementById('peek-message-area');

    titleEl.textContent = partnerName;
    messageAreaEl.innerHTML = '';
    messageAreaEl.scrollTop = 0; 

    // ── 屏蔽/取消屏蔽 按钮逻辑 (保留你原有的功能) ─────────────────
    const convo = peekContentCache?.messages?.conversations?.find(c => c.partnerName === partnerName);
    const actionBtn = document.getElementById('peek-conversation-action-btn');
    if (actionBtn && convo) {
        actionBtn.style.visibility = 'visible';
        const renderActionBtnSVG = () => {
            if (convo.isHidden) {
                actionBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;
            } else {
                actionBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
            }
        };

        renderActionBtnSVG();
        actionBtn.onclick = async () => {
            convo.isHidden = !convo.isHidden;
            renderActionBtnSVG();
            await savePeekData(window.activePeekCharId).catch(e => console.error(e));
            if (typeof showToast === 'function') showToast(convo.isHidden ? '已屏蔽该聊天' : '已取消屏蔽');
            renderPeekChatList(peekContentCache.messages.conversations);
        };
    } else if (actionBtn) {
        actionBtn.style.visibility = 'hidden';
    }

    if (!history || history.length === 0) {
        messageAreaEl.innerHTML = '<p class="placeholder-text">这里空空如也...</p>';
        return;
    }

    const isEdit = PeekDeleteManager.isEditMode && PeekDeleteManager.currentAppType === 'conversation';
    
    // 用于记录我们需要滚动到的“未读边界”DOM节点
    let unreadBoundaryEl = null;

    history.forEach(msg => {
        if (!msg.id) msg.id = 'msg_item_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        const isSelected = isEdit && PeekDeleteManager.selectedIds.has(msg.id);
        const editClasses = `message-item-wrapper ${isEdit ? 'is-selecting' : ''} ${isSelected ? 'selected' : ''}`;

        let currentWrapper = null;

        // ── 时间分隔符 ────────────────────────────────────────────────
        if (msg.content === '[time-divider]') {
            const dividerWrapper = document.createElement('div');
            dividerWrapper.className = `message-wrapper time-divider-wrapper ${editClasses}`;
            dividerWrapper.dataset.id = msg.id;
            const label = (typeof formatSmartTime === 'function' && msg.timestamp)
                ? formatSmartTime(msg.timestamp) : (msg.label || '');
            dividerWrapper.innerHTML = `<div class="chat-time-divider">${label}</div>`;
            messageAreaEl.appendChild(dividerWrapper);
            currentWrapper = dividerWrapper;
        } else {
            // ── 普通消息气泡 ─────────────────────────────────────────────────
            const isSentByChar = msg.sender === 'char';
            const wrapper = document.createElement('div');
            wrapper.className = `message-wrapper ${isSentByChar ? 'sent' : 'received'} ${editClasses}`;
            wrapper.dataset.id = msg.id;

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
            currentWrapper = wrapper;
        }

        // 寻找第一个未读边界标记
        if (msg.isUnreadBoundary && wasNew && !unreadBoundaryEl) {
            unreadBoundaryEl = currentWrapper;
        }
    });

    // 抽离滚动逻辑，进行精准定位
    const scrollToTarget = () => {
        // 多选编辑模式下不要自动滚动，以免打断用户选择
        if (PeekDeleteManager.isEditMode) return;

        const contentContainer = messageAreaEl.closest('.content');
        if (wasNew && unreadBoundaryEl) {
            // 偏移量减去20像素作为呼吸空间，确保时间戳完全露出来
            const targetScrollTop = Math.max(0, unreadBoundaryEl.offsetTop - 20);
            if (contentContainer) contentContainer.scrollTop = targetScrollTop;
            messageAreaEl.scrollTop = targetScrollTop;
        } else {
            // 普通打开或者没有未读：常规直接滚到底部
            if (contentContainer) contentContainer.scrollTop = contentContainer.scrollHeight;
            messageAreaEl.scrollTop = messageAreaEl.scrollHeight;
        }
    };

    requestAnimationFrame(scrollToTarget);
    setTimeout(scrollToTarget, 150);

    // 渲染完毕后，清理这些已被读过的未读边界标记，防止下次打开仍卡在中间
    if (wasNew) {
        let needsSave = false;
        history.forEach(m => {
            if (m.isUnreadBoundary) {
                m.isUnreadBoundary = false;
                needsSave = true;
            }
        });
        if (needsSave) {
            savePeekData(window.activePeekCharId).catch(e => console.error(e));
        }
    }
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

    const { url, key, model, streamEnabled, temperature } = getPeekApiConfig(window.activePeekCharId);
    if (!url || !key || !model) { showToast('请先配置 API！'); return switchScreen('api-settings-screen'); }

    generatingPeekApps.add(appType);
    switchScreen('peek-messages-screen');
    const targetContainer = document.getElementById('peek-chat-list-container');
    const hideLoading = showLoadingToast('正在生成对话列表...');

    try {
        const peekSettings = char.peekScreenSettings || {};
        const limitCount = (peekSettings.contextLimit !== undefined) ? peekSettings.contextLimit : 50;
        const mainChatContext = limitCount > 0 ? historyToPlainText(char.history.slice(-limitCount)) : "";

        const senderName = char.realName || char.name;
        const baseContextPrompt = getPeekBasePromptContext(char, mainChatContext);

        // 排除已屏蔽（isHidden为true）的联系人
        const existingNames = (peekContentCache['messages']?.conversations ||[])
            .filter(c => !c.isHidden)
            .map(c => c.partnerName)
            .filter(Boolean);

        let systemPrompt = `你正在模拟角色 ${char.realName} 的手机聊天/消息应用。\n`;
        systemPrompt += baseContextPrompt;
        systemPrompt += `\n【任务1：消息记录】`;

        if (existingNames.length > 0) {
            systemPrompt += `\n请为 ${char.realName} 编造4-6个最近的对话。\n当前手机里已有以下联系人：\n${existingNames.map((n, i) => `${i + 1}. ${n}`).join('\n')}\n但联系人不仅仅局限于这些人。你应该根据聊天上下文情况，尽可能积极创造**新的联系人**进行对话。`;
        } else {
            systemPrompt += `\n请为 ${char.realName} 编造3-5个最近的对话。\n`;
        }

        systemPrompt += `对话内容需要强烈反映Ta的人设以及和最近聊天上下文。\n每段对话需要提供对话对象的称呼(#PARTNER#)以及具体的聊天记录(#HISTORY#)。\n在 #HISTORY# 中，请严格使用以下格式记录每条消息：\n如果是 ${char.realName} 发送的，以 "char: " 开头；\n如果是对方发送的，以 "partner: " 开头。\n\n【任务2：话题分享】\n在消息记录生成完毕后，请从刚刚生成的这几段对话中挑选1个值得吐槽或分享的对话，预测一下，在未来的某个时间，${senderName}会主动把这个对话内容当成话题发消息分享给${char.myName}。\n`;
        systemPrompt += getPeekProactiveFormatPrompt(char);
        systemPrompt += `\n请严格按照以下标签文本格式输出，**每段对话之间使用 ===SEP=== 分隔**。在所有对话结束后，使用 ===PROACTIVE_MESSAGES=== 分割，再输出主动消息。\n\n输出格式示例：\n#PARTNER#\n与Ta对话的人的称呼\n#HISTORY#\npartner: 对方发送的消息内容\nchar: ${char.realName}发送的消息内容\npartner: 对方发送的消息内容\n===SEP===\n#PARTNER#\n与Ta对话的人的称呼\n#HISTORY#\npartner: 对方发送的消息内容\nchar: ${char.realName}发送的消息内容\n===PROACTIVE_MESSAGES===\n#SECRET_CHAT_EVENING_85%#[19:15|${senderName}的消息:突然好想吃我妈做的排骨啊(T_T)][19:16|${senderName}的消息:你吃晚饭了吗？]\n`;

        const contentStr = await callPeekApi({ url, key, model, messages: [{ role: 'user', content: systemPrompt }], temperature, streamEnabled });

        const parts = contentStr.split(/===PROACTIVE_MESSAGES===/i);
        const messagesRawText = parts[0] || '';
        const hitchhikerRawText = parts.length > 1 ? parts[1] : '';

        const rawItems = messagesRawText.split('===SEP===');
        const parsedConversations =[];
        const now = Date.now();

        rawItems.forEach(rawText => {
            if (!rawText.trim()) return;
            const partnerMatch = rawText.match(/#PARTNER#\s*([\s\S]*?)(?=#HISTORY#|$)/);
            const historyMatch = rawText.match(/#HISTORY#\s*([\s\S]*?)(?=(?:===SEP===|$))/);

            if (partnerMatch && historyMatch) {
                const historyLines = historyMatch[1].trim().split('\n');
                const history =[];
                historyLines.forEach(line => {
                    const msgId = `msg_gen_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
                    if (line.trim().toLowerCase().startsWith('char:')) {
                        history.push({ id: msgId, sender: 'char', content: line.replace(/^char:\s*/i, '').trim() });
                    } else if (line.trim().toLowerCase().startsWith('partner:')) {
                        history.push({ id: msgId, sender: 'partner', content: line.replace(/^partner:\s*/i, '').trim() });
                    }
                });

                if (history.length > 0) {
                    parsedConversations.push({
                        id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                        partnerName: partnerMatch[1].trim(),
                        history: history,
                        isNew: true,
                        lastUpdated: now
                    });
                }
            }
        });

        if (parsedConversations.length > 0) {
            if (!peekContentCache['messages']) peekContentCache['messages'] = { conversations: [] };
            const existingConvos = peekContentCache['messages'].conversations;
            const now = Date.now();

            parsedConversations.forEach(newConvo => {
                const existingIdx = existingConvos.findIndex(c => c.partnerName === newConvo.partnerName);
                if (existingIdx !== -1) {
                    // 如果对方已经积攒了之前的未读消息没看，就保留最早的边界不覆盖
                    const hasUnread = existingConvos[existingIdx].history.some(m => m.isUnreadBoundary);
                    
                    const divider = {
                        id: `msg_div_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                        content: '[time-divider]',
                        timestamp: now,
                        isUnreadBoundary: !hasUnread // 标记本次新增的时间戳为未读边界起点
                    };
                    existingConvos[existingIdx].history = [
                        ...existingConvos[existingIdx].history,
                        divider,
                        ...newConvo.history
                    ];
                    existingConvos[existingIdx].isNew = true;
                    existingConvos[existingIdx].lastUpdated = now;
                    const [merged] = existingConvos.splice(existingIdx, 1);
                    existingConvos.unshift(merged);
                } else {
                    // 新联系人，把第一句话作为未读锚定点（如果内容很长，打开刚好看到对话第一句）
                    if (newConvo.history && newConvo.history.length > 0) {
                        newConvo.history[0].isUnreadBoundary = true;
                    }
                    existingConvos.unshift(newConvo);
                }
            });

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
        if (typeof showApiError === 'function') showApiError(error);
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

async function addPeekContact() {
    const name = await AppUI.prompt(
        '请输入新增的联系人名称。',
        '例如：c喵、g喵…',
        '新增联系人'
    );
    if (!name || !name.trim()) return;

    const trimmedName = name.trim();
    if (!peekContentCache['messages']) peekContentCache['messages'] = { conversations: [] };

    const exists = peekContentCache['messages'].conversations.some(c => c.partnerName === trimmedName);
    if (exists) { showToast(`"${trimmedName}" 已在联系人列表中`); return; }

    const newConvo = {
        id: `msg_manual_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        partnerName: trimmedName,
        history:[],   
        isNew: false,
        lastUpdated: Date.now()
    };

    peekContentCache['messages'].conversations.push(newConvo);
    savePeekData(window.activePeekCharId).catch(e => console.error('Peek保存失败:', e));
    renderPeekChatList(peekContentCache['messages'].conversations);
    showToast(`已添加"${trimmedName}"✓`);
}
