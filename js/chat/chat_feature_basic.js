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
                    id: `msg_${Date.now()}`,
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
                    id: `msg_${Date.now()}`,
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
                    id: `msg_${Date.now()}`,
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
                        id: `msg_${Date.now()}`,
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
                                id: `msg_${Date.now()}_${recipientId}`,
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
                        id: `msg_${Date.now()}`,
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
                                id: `msg_${Date.now()}_${recipientId}`,
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
        id: `msg_visual_${now}`,
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
        id: `msg_context_${now}`,
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
            
             function openDeleteChunkModal() {
                const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
                if (!chat || !chat.history || chat.history.length === 0) {
                    showToast('当前没有聊天记录可删除');
                    return;
                }
                const totalMessages = chat.history.length;
                const rangeInfo = document.getElementById('delete-chunk-range-info');
                rangeInfo.textContent = `当前聊天总消息数: ${totalMessages}`;
                document.getElementById('delete-chunk-form').reset();
                document.getElementById('delete-chunk-modal').classList.add('visible');
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

                deleteChunkForm.addEventListener('submit', (e) => {
                    e.preventDefault();
                    const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
                    const totalMessages = chat.history.length;

                    startRange = parseInt(document.getElementById('delete-range-start').value);
                    endRange = parseInt(document.getElementById('delete-range-end').value);

                    if (isNaN(startRange) || isNaN(endRange) || startRange <= 0 || endRange < startRange || endRange > totalMessages) {
                        showToast('请输入有效的起止范围');
                        return;
                    }

                    const startIndex = startRange - 1;
                    const endIndex = endRange;
                    messagesToDelete = chat.history.slice(startIndex, endIndex);

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

                    deleteChunkModal.classList.remove('visible');
                    confirmModal.classList.add('visible');
                });

                confirmBtn.addEventListener('click', async () => {
                    const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
                    const startIndex = startRange - 1;
                    const count = endRange - startIndex;

                    chat.history.splice(startIndex, count);
                    await deleteMessagesFromDB(messagesToDelete.map(m=>m.id));
                    await saveSingleChat(currentChatId, currentChatType);

                    confirmModal.classList.remove('visible');
                    showToast(`已成功删除 ${count} 条消息`);
                    currentPage = 1;
                    renderMessages(false, true);
                    renderChatList();
                });

                cancelBtn.addEventListener('click', () => {
                    confirmModal.classList.remove('visible');
                });
            }                               