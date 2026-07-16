// --- chat_feature.js --- 
             const voiceMessageBtn = document.getElementById('voice-message-btn'),
                sendVoiceModal = document.getElementById('send-voice-modal'),
                sendVoiceForm = document.getElementById('send-voice-form'),
                voiceTextInput = document.getElementById('voice-text-input'),
                voiceDurationPreview = document.getElementById('voice-duration-preview');
            const photoVideoBtn = document.getElementById('photo-video-btn'),
                sendPvModal = document.getElementById('send-pv-modal'),
                sendPvForm = document.getElementById('send-pv-form'),
                pvTextInput = document.getElementById('pv-text-input');
            const imageRecognitionBtn = document.getElementById('image-recognition-btn'),
                imageUploadInput = document.getElementById('image-upload-input');
            const walletBtn = document.getElementById('wallet-btn'),
                sendTransferModal = document.getElementById('send-transfer-modal'),
                sendTransferForm = document.getElementById('send-transfer-form'),
                transferAmountInput = document.getElementById('transfer-amount-input'),
                transferRemarkInput = document.getElementById('transfer-remark-input');
            const receiveTransferActionSheet = document.getElementById('receive-transfer-actionsheet'),
                acceptTransferBtn = document.getElementById('accept-transfer-btn'),
                returnTransferBtn = document.getElementById('return-transfer-btn');
            const sendGiftModal = document.getElementById('send-gift-modal'),
                sendGiftForm = document.getElementById('send-gift-form'),
                giftDescriptionInput = document.getElementById('gift-description-input');
            const timeSkipModal = document.getElementById('time-skip-modal'),
                timeSkipForm = document.getElementById('time-skip-form'),
                timeSkipInput = document.getElementById('time-skip-input');     


            function calculateVoiceDuration(text) {
                return Math.max(1, Math.min(60, Math.ceil(text.length / 3.5)));
            }  
            
             async function sendImageForRecognition(base64Data) {
                if (!base64Data || isGenerating) return;
                const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
                const myName = (currentChatType === 'private') ? chat.myName : chat.me.realName;
                await processTimePerception(chat, currentChatId, currentChatType);
                const textPrompt = `[${myName}发来了一张图片：]`;
                const message = {
                    id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
                    role: 'user',
                    content: base64Data,
                    parts: [{ type: 'text', text: textPrompt }, { type: 'image', data: base64Data }],
                    timestamp: Date.now(),
                };
                if (currentChatType === 'group') {
                    message.senderId = 'user_me';
                }
                chat.history.push(message);
                addMessageBubble(message, currentChatId, currentChatType);
                await saveMessageToDB(message, currentChatId, currentChatType);
                await saveSingleChat(currentChatId, currentChatType);
                renderChatList();
            }                            
                                                     async function sendMyVoiceMessage(text) {
                if (!text) return;
                sendVoiceModal.classList.remove('visible');
                await new Promise(resolve => setTimeout(resolve, 100));
                const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
                const myName = (currentChatType === 'private') ? chat.myName : chat.me.realName;
                await processTimePerception(chat, currentChatId, currentChatType);
                const content = `[${myName}的语音：${text}]`;
                const message = {
                    id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
                    role: 'user',
                    content: content,
                    parts: [{ type: 'text', text: content }],
                    timestamp: Date.now()
                };
                if (currentChatType === 'group') {
                    message.senderId = 'user_me';
                }
                chat.history.push(message);
                addMessageBubble(message, currentChatId, currentChatType);
                await saveMessageToDB(message, currentChatId, currentChatType);
                await saveSingleChat(currentChatId, currentChatType);
                renderChatList();
            }
            
             async function sendMyPhotoVideo(text) {
                if (!text) return;
                sendPvModal.classList.remove('visible');
                await new Promise(resolve => setTimeout(resolve, 100));
                const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
                const myName = (currentChatType === 'private') ? chat.myName : chat.me.realName;
                await processTimePerception(chat, currentChatId, currentChatType);
                const content = `[${myName}发来的照片\/视频：${text}]`;
                const message = {
                    id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
                    role: 'user',
                    content: content,
                    parts: [{ type: 'text', text: content }],
                    timestamp: Date.now()
                };
                if (currentChatType === 'group') {
                    message.senderId = 'user_me';
                }
                chat.history.push(message);
                addMessageBubble(message, currentChatId, currentChatType);
                await saveMessageToDB(message, currentChatId, currentChatType);
                await saveSingleChat(currentChatId, currentChatType);
                renderChatList();
            }                           


            async function sendMyTransfer(amount, remark) {
                sendTransferModal.classList.remove('visible');
                await new Promise(resolve => setTimeout(resolve, 100));
                const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
                await processTimePerception(chat, currentChatId, currentChatType);
                if (currentChatType === 'private') {
                    const content = `[${chat.myName}给你转账：${amount}元；备注：${remark}]`;
                    const message = {
                        id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
                        role: 'user',
                        content: content,
                        parts: [{ type: 'text', text: content }],
                        timestamp: Date.now(),
                        transferStatus: 'pending'
                    };
                    chat.history.push(message);
                    addMessageBubble(message, currentChatId, currentChatType);
  await saveMessageToDB(message, currentChatId, currentChatType);                  
                } else { // Group chat
                let msgs =[];
        currentGroupAction.recipients.forEach(recipientId => {
                        const recipient = chat.members.find(m => m.id === recipientId);
                        if (recipient) {
                            const content = `[${chat.me.realName} 向 ${recipient.realName} 转账：${amount}元；备注：${remark}]`;
                            const message = {
                                id: `msg_${Date.now()}_${recipientId}_${Math.random().toString(36).substr(2, 6)}`, 
                                role: 'user',
                                content: content,
                                parts: [{ type: 'text', text: content }],
                                timestamp: Date.now(),
                                senderId: 'user_me'
                            };
                            chat.history.push(message);
                            addMessageBubble(message, currentChatId, currentChatType);
                            msgs.push(message); 
                        }
                    });
                    await saveMessagesToDB(msgs, currentChatId, currentChatType);
                }
                await saveSingleChat(currentChatId, currentChatType);
                renderChatList();
            }

            async function sendMyGift(description) {
                if (!description) return;
                sendGiftModal.classList.remove('visible');
                await new Promise(resolve => setTimeout(resolve, 100));
                const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
                await processTimePerception(chat, currentChatId, currentChatType);

                if (currentChatType === 'private') {
                    const content = `[${chat.myName}送来的礼物：${description}]`;
                    const message = {
                        id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
                        role: 'user',
                        content: content,
                        parts: [{ type: 'text', text: content }],
                        timestamp: Date.now(),
                        giftStatus: 'sent'
                    };
                    chat.history.push(message);
                    addMessageBubble(message, currentChatId, currentChatType);
                    await saveMessageToDB(message, currentChatId, currentChatType);
                } else { // Group chat
                    let msgs =[];
        currentGroupAction.recipients.forEach(recipientId => {
                        const recipient = chat.members.find(m => m.id === recipientId);
                        if (recipient) {
                            const content = `[${chat.me.realName} 向 ${recipient.realName} 送来了礼物：${description}]`;
                            const message = {
                                id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
                                role: 'user',
                                content: content,
                                parts: [{ type: 'text', text: content }],
                                timestamp: Date.now(),
                                senderId: 'user_me'
                            };
                            chat.history.push(message);
                            addMessageBubble(message, currentChatId, currentChatType);
                            msgs.push(message); 
                        }
                    });
                    await saveMessagesToDB(msgs, currentChatId, currentChatType);
                }
                await saveSingleChat(currentChatId, currentChatType);
                renderChatList();
            }

            // --- NEW: Time Skip System ---
            function setupTimeSkipSystem() {

                timeSkipModal.addEventListener('click', (e) => {
                    if (e.target === timeSkipModal) timeSkipModal.classList.remove('visible');
                });
                timeSkipForm.addEventListener('submit', (e) => {
                    e.preventDefault();
                    sendTimeSkipMessage(timeSkipInput.value.trim());
                });
            }

            async function sendTimeSkipMessage(text) {
    if (!text) return;
    timeSkipModal.classList.remove('visible');
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
    if (!chat) return;

    await processTimePerception(chat, currentChatId, currentChatType);

    const now = Date.now();

    // 1. UI 展示消息 (保持不变，用 system-display 是为了触发你的CSS样式)
    const visualMessage = {
        id: `msg_visual_${now}_${Math.random().toString(36).substr(2, 6)}`, 
        role: 'system',
        content: `[system-display:${text}]`, // 这里保留 system-display 是为了前端渲染样式，反正是给用户看的，不给AI看
        parts: [],
        timestamp: now,
        isAiIgnore: true // AI 看不到这条
    };

    // 2. AI 上下文消息 (修改这里！)
    // 去掉 system，改为更自然的描述标签
    const contextContent = `[剧情旁白：${text}]`; 
    
    const contextMessage = {
        id: `msg_context_${now}_${Math.random().toString(36).substr(2, 6)}`, 
        role: 'user', // 既然是用户写的旁白，用 user 角色最合适
        content: contextContent,
        parts: [{ type: 'text', text: contextContent }],
        timestamp: now,
        isHidden: true // 用户界面不显示这条
    };

    if (currentChatType === 'group') {
        contextMessage.senderId = 'user_me';
        visualMessage.senderId = 'user_me';
    }

    chat.history.push(visualMessage, contextMessage);
    addMessageBubble(visualMessage, currentChatId, currentChatType);
    await saveMessagesToDB([visualMessage, contextMessage], currentChatId, currentChatType);
    await saveSingleChat(currentChatId, currentChatType);
    // renderChatList(); // 不需要调用
}

              function setupVoiceMessageSystem() {
                voiceMessageBtn.addEventListener('click', () => {
                    sendVoiceForm.reset();
                    voiceDurationPreview.textContent = '0"';
                    sendVoiceModal.classList.add('visible');
                });
                sendVoiceForm.addEventListener('submit', (e) => {
                    e.preventDefault();
                    sendMyVoiceMessage(voiceTextInput.value.trim());
                });
            }

            function setupPhotoVideoSystem() {
                photoVideoBtn.addEventListener('click', () => {
                    sendPvForm.reset();
                    sendPvModal.classList.add('visible');
                });
                sendPvForm.addEventListener('submit', (e) => {
                    e.preventDefault();
                    sendMyPhotoVideo(pvTextInput.value.trim());
                });
            }

            function setupWalletSystem() {
                walletBtn.addEventListener('click', () => {
                    if (currentChatType === 'private') {
                        sendTransferForm.reset();
                        sendTransferModal.classList.add('visible');
                    } else if (currentChatType === 'group') {
                        currentGroupAction.type = 'transfer';
                        renderGroupRecipientSelectionList('转账给');
                        groupRecipientSelectionModal.classList.add('visible');
                    }
                });
                sendTransferForm.addEventListener('submit', (e) => {
                    e.preventDefault();
                    const amount = transferAmountInput.value;
                    const remark = transferRemarkInput.value.trim();
                    if (amount > 0) {
                        sendMyTransfer(amount, remark);
                    } else {
                        showToast('请输入有效的金额');
                    }
                });
                acceptTransferBtn.addEventListener('click', () => respondToTransfer('received'));
                returnTransferBtn.addEventListener('click', () => respondToTransfer('returned'));
            }

            function handleReceivedTransferClick(messageId) {
                currentTransferMessageId = messageId;
                receiveTransferActionSheet.classList.add('visible');
            }

            async function respondToTransfer(action) {
                if (!currentTransferMessageId) return;
                const character = db.characters.find(c => c.id === currentChatId);
                const message = character.history.find(m => m.id === currentTransferMessageId);
                if (message) {
                    message.transferStatus = action;
                    const cardOnScreen = messageArea.querySelector(`.message-wrapper[data-id="${currentTransferMessageId}"] .transfer-card`);
                    if (cardOnScreen) {
                        cardOnScreen.classList.remove('received', 'returned');
                        cardOnScreen.classList.add(action);
                        cardOnScreen.querySelector('.transfer-status').textContent = action === 'received' ? '已收款' : '已退回';
                        cardOnScreen.style.cursor = 'default';
                    }
                    let contextMessageContent = (action === 'received') ? `[${character.myName}接收${character.realName}的转账]` : `[${character.myName}退回${character.realName}的转账]`;
                    const contextMessage = {
                        id: `msg_${Date.now()}`,
                        role: 'user',
                        content: contextMessageContent,
                        parts: [{ type: 'text', text: contextMessageContent }],
                        timestamp: Date.now()
                    };
                    character.history.push(contextMessage);
                    await saveMessageToDB(message, currentChatId, currentChatType); // ★ (状态更新)
        await saveMessageToDB(contextMessage, currentChatId, currentChatType); // ★ (系统通知)
                    await saveSingleChat(currentChatId, currentChatType);
                    renderChatList();
                }
                receiveTransferActionSheet.classList.remove('visible');
                currentTransferMessageId = null;
            }

            function setupGiftSystem() {

                sendGiftForm.addEventListener('submit', (e) => {
                    e.preventDefault();
                    sendMyGift(giftDescriptionInput.value.trim());
                });
            }
            
             // --- Other Sub-systems Setup (Stickers, Voice, etc.) ---
            function setupImageRecognition() {
                imageRecognitionBtn.addEventListener('click', () => {
                    imageUploadInput.click();
                });
                imageUploadInput.addEventListener('change', async (e) => {
                    const file = e.target.files[0];
                    if (file) {
                        try {
                            const compressedUrl = await compressImage(file, {
                                quality: 0.8,
                                maxWidth: 1024,
                                maxHeight: 1024
                            });
                            sendImageForRecognition(compressedUrl);
                        } catch (error) {
                            console.error('Image compression failed:', error);
                            showToast('图片处理失败，请重试');
                        } finally {
                            e.target.value = null;
                        }
                    }
                });
            }          
            
             // 🌟 缓存当前聊道的消息总数：openDeleteChunkModal 已查过并显示给用户，
             // submit（点"下一步"）时直接复用，避免重复 await DB count 造成停顿
             let cachedChunkTotal = null;

             async function openDeleteChunkModal() {
                const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
                if (!chat) {
                    showToast('当前没有聊天记录可删除');
                    return;
                }
                // 先弹窗给即时反馈，再异步计算真实总数（懒加载下 chat.history 只有内存窗口，必须走 DB count）
                const rangeInfo = document.getElementById('delete-chunk-range-info');
                document.getElementById('delete-chunk-form').reset();
                rangeInfo.textContent = '正在统计消息总数...';
                document.getElementById('delete-chunk-modal').classList.add('visible');

                let totalMessages;
                if (window.LAZY_LOAD && typeof window.getMessageCount === 'function') {
                    try { totalMessages = await window.getMessageCount(chat.id); }
                    catch (e) { totalMessages = chat.history ? chat.history.length : 0; }
                } else {
                    totalMessages = chat.history ? chat.history.length : 0;
                }

                if (!totalMessages) {
                    document.getElementById('delete-chunk-modal').classList.remove('visible');
                    showToast('当前没有聊天记录可删除');
                    return;
                }
                // 缓存供 submit 直接复用，避免点"下一步"时再查一次 DB count
                cachedChunkTotal = { chatId: chat.id, total: totalMessages };
                rangeInfo.textContent = `当前聊天总消息数: ${totalMessages}`;
            }

            function setupDeleteHistoryChunk() {
                const deleteChunkForm = document.getElementById('delete-chunk-form');
                const confirmBtn = document.getElementById('confirm-delete-chunk-btn');
                const cancelBtn = document.getElementById('cancel-delete-chunk-btn');
                const deleteChunkModal = document.getElementById('delete-chunk-modal');
                const confirmModal = document.getElementById('delete-chunk-confirm-modal');
                const previewBox = document.getElementById('delete-chunk-preview');

                // 🌟 修复1：在这里提前声明 messagesToDelete，让下面两个步骤都能共享这个变量
                let startRange, endRange, messagesToDelete;

                deleteChunkForm.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);

                    // 🌟 复用打开输入框时已查好的总数，避免点"下一步"时重复 await DB count 造成停顿
                    let totalMessages;
                    if (cachedChunkTotal && cachedChunkTotal.chatId === chat.id) {
                        totalMessages = cachedChunkTotal.total;
                    } else if (window.LAZY_LOAD && typeof window.getMessageCount === 'function') {
                        try { totalMessages = await window.getMessageCount(chat.id); }
                        catch (err) { totalMessages = chat.history.length; }
                    } else {
                        totalMessages = chat.history.length;
                    }

                    startRange = parseInt(document.getElementById('delete-range-start').value);
                    endRange = parseInt(document.getElementById('delete-range-end').value);

                    if (isNaN(startRange) || isNaN(endRange) || startRange <= 0 || endRange < startRange || endRange > totalMessages) {
                        showToast('请输入有效的起止范围');
                        return;
                    }

                    // 🌟 先立刻弹出确认框并显示加载态，避免预览查询较慢时用户以为卡住/没点到
                    messagesToDelete = null;
                    previewBox.innerHTML = `<p style="text-align: center; color: #999; margin: 5px 0;">读取预览中…</p>`;
                    confirmBtn.disabled = true;
                    confirmBtn.style.opacity = '0.5';
                    confirmBtn.style.cursor = 'not-allowed';
                    deleteChunkModal.classList.remove('visible');
                    confirmModal.classList.add('visible');

                    // 记录本次加载对应的范围，用于防止用户快速重复操作时旧结果覆盖新结果
                    const reqStart = startRange, reqEnd = endRange;

                    // 取要删除的消息：懒加载走 DB 全局序号（老范围可能不在内存窗口内），否则内存 slice
                    let loaded;
                    try {
                        if (window.LAZY_LOAD && typeof window.getMessagesByGlobalRange === 'function') {
                            try { loaded = await window.getMessagesByGlobalRange(chat.id, startRange, endRange); }
                            catch (err) { loaded = chat.history.slice(startRange - 1, endRange); }
                        } else {
                            loaded = chat.history.slice(startRange - 1, endRange);
                        }
                    } catch (err) {
                        loaded = null;
                    }

                    // 确认框已被关闭，或用户又发起了新的范围请求，则丢弃这次结果
                    if (!confirmModal.classList.contains('visible') || reqStart !== startRange || reqEnd !== endRange) {
                        return;
                    }

                    if (!loaded) {
                        previewBox.innerHTML = `<p style="text-align: center; color: #e74c3c; margin: 5px 0;">预览加载失败，请关闭后重试</p>`;
                        return;
                    }

                    messagesToDelete = loaded;

                    // --- NEW PREVIEW LOGIC ---
                    let previewHtml = '';
                    const totalToDelete = messagesToDelete.length;

                    if (totalToDelete <= 4) {
                        // If 4 or fewer messages, show all of them
                        previewHtml = messagesToDelete.map(msg => {
                            const contentMatch = msg.content.match(/\[.*?的消息：([\s\S]+)\]/);
                            const text = contentMatch ? contentMatch[1] : msg.content;
                            return `<p>${msg.role === 'user' ? '我' : chat.remarkName || '对方'}: ${text.substring(0, 50)}...</p>`;
                        }).join('');
                    } else {
                        // If more than 4, show first 2, ellipsis, and last 2
                        const firstTwo = messagesToDelete.slice(0, 2);
                        const lastTwo = messagesToDelete.slice(-2);

                        const firstTwoHtml = firstTwo.map(msg => {
                            const contentMatch = msg.content.match(/\[.*?的消息：([\s\S]+)\]/);
                            const text = contentMatch ? contentMatch[1] : msg.content;
                            return `<p>${msg.role === 'user' ? '我' : chat.remarkName || '对方'}: ${text.substring(0, 50)}...</p>`;
                        }).join('');

                        const lastTwoHtml = lastTwo.map(msg => {
                            const contentMatch = msg.content.match(/\[.*?的消息：([\s\S]+)\]/);
                            const text = contentMatch ? contentMatch[1] : msg.content;
                            return `<p>${msg.role === 'user' ? '我' : chat.remarkName || '对方'}: ${text.substring(0, 50)}...</p>`;
                        }).join('');

                        previewHtml = `${firstTwoHtml}<p style="text-align: center; color: #999; margin: 5px 0;">...</p>${lastTwoHtml}`;
                    }
                    previewBox.innerHTML = previewHtml;

                    // 预览就绪，恢复确认按钮
                    confirmBtn.disabled = false;
                    confirmBtn.style.opacity = '';
                    confirmBtn.style.cursor = '';
                });

                confirmBtn.addEventListener('click', async () => {
                    // 预览尚未加载完成（按钮理论上已置灰），保险起见直接忽略
                    if (!messagesToDelete) return;
                    const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
                    const idsToDelete = messagesToDelete.map(m => m.id);
                    const count = idsToDelete.length;

                    // 先删 DB，再按 id 从内存窗口剔除命中的
                    //（懒加载下 chat.history 只是最近窗口，按全局 index splice 会删错，必须按 id 过滤）
                    await deleteMessagesFromDB(idsToDelete);
                    const delSet = new Set(idsToDelete);
                    chat.history = chat.history.filter(m => !delSet.has(m.id));
                    await saveSingleChat(currentChatId, currentChatType);

                    confirmModal.classList.remove('visible');
                    // 删除后总数已变，作废旧缓存，下次打开重新统计
                    cachedChunkTotal = null;
                    showToast(`已成功删除 ${count} 条消息`);
                    currentPage = 1;
                    renderMessages(false, true);
                    renderChatList();
                });

                cancelBtn.addEventListener('click', () => {
                    confirmModal.classList.remove('visible');
                    // 复位按钮状态，避免下次残留置灰
                    confirmBtn.disabled = false;
                    confirmBtn.style.opacity = '';
                    confirmBtn.style.cursor = '';
                });
            }                               