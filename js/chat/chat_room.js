// 在文件最上方
let isLoadingHistory = false; // 新增：防止重复加载标志位
let selectedLinkStickerIds = new Set(); // 关联弹窗选中的ID
let currentStickerCategory = '全部';    // 主面板当前选中的分类
let currentLinkStickerCategory = '全部';// 关联弹窗当前选中的分类
let currentActionCategory = null;// 记录长按操作的分类名

const chatRoomScreen = document.getElementById('chat-room-screen'),
                chatRoomHeaderDefault = document.getElementById('chat-room-header-default'),
                chatRoomHeaderSelect = document.getElementById('chat-room-header-select'),
                cancelMultiSelectBtn = document.getElementById('cancel-multi-select-btn'),
                multiSelectTitle = document.getElementById('multi-select-title'),
                chatRoomTitle = document.getElementById('chat-room-title'),
                chatRoomStatusText = document.getElementById('chat-room-status-text'),
                messageArea = document.getElementById('message-area'),
                messageInputDefault = document.getElementById('message-input-default'),
                messageInput = document.getElementById('message-input'),
                sendMessageBtn = document.getElementById('send-message-btn'),
                getReplyBtn = document.getElementById('get-reply-btn'),
                typingIndicator = document.getElementById('typing-indicator'),
                chatSettingsBtn = document.getElementById('chat-settings-btn'),
                settingsSidebar = document.getElementById('chat-settings-sidebar'),
                settingsForm = document.getElementById('chat-settings-form'),
                multiSelectBar = document.getElementById('multi-select-bar'),
                selectCount = document.getElementById('select-count'),
                deleteSelectedBtn = document.getElementById('delete-selected-btn');

const regenerateBtn = document.getElementById('regenerate-btn');

const stickerToggleBtn = document.getElementById('sticker-toggle-btn'),
                stickerModal = document.getElementById('sticker-modal'),
                stickerGridContainer = document.getElementById('sticker-grid-container'),
                addNewStickerBtn = document.getElementById('add-new-sticker-btn'),
                addStickerModal = document.getElementById('add-sticker-modal'),
                addStickerModalTitle = document.getElementById('add-sticker-modal-title'),
                addStickerForm = document.getElementById('add-sticker-form'),
                stickerEditIdInput = document.getElementById('sticker-edit-id'),
                stickerPreview = document.getElementById('sticker-preview'),
                stickerNameInput = document.getElementById('sticker-name'),
                stickerUrlInput = document.getElementById('sticker-url-input'),
                stickerFileUpload = document.getElementById('sticker-file-upload');
  const stickerActionSheet = document.getElementById('sticker-actionsheet'),
                editStickerBtn = document.getElementById('edit-sticker-btn'),
                deleteStickerBtn = document.getElementById('delete-sticker-btn'); 
 
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

function setupChatRoom() {
    if ('scrollRestoration' in history) {
        history.scrollRestoration = 'manual';
    }
    const placeholderPlusBtn = document.getElementById('placeholder-plus-btn');
    const chatExpansionPanel = document.getElementById('chat-expansion-panel');

    // 1. 加号按钮逻辑
    placeholderPlusBtn.addEventListener('click', () => {
        if (stickerModal.classList.contains('visible')) {
            stickerModal.classList.remove('visible');
        }

        const offlineBtn = document.querySelector('.expansion-item[data-action="offline-mode-settings"]');
        if (offlineBtn) {
            offlineBtn.classList.remove('active');
            if (currentChatType === 'private' && currentChatId) {
                const chat = db.characters.find(c => c.id === currentChatId);
                if (chat && chat.offlineModeEnabled) {
                    offlineBtn.classList.add('active');
                }
            }
        }
        chatExpansionPanel.classList.toggle('visible');
    });

    sendMessageBtn.addEventListener('click', sendMessage);
    sendMessageBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        sendMessage();
        setTimeout(() => {
            messageInput.focus();
        }, 50);
    });
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !isGenerating) sendMessage();
    });
    getReplyBtn.addEventListener('click', () => getAiReply(currentChatId, currentChatType));
    regenerateBtn.addEventListener('click', handleRegenerate);

// ==========================================
    // 【核心修复】双向滚动监听 (向上加载旧消息，向下加载新消息)
    // ==========================================
    messageArea.addEventListener('scroll', () => {
        if (isLoadingHistory) return; // 如果正在加载，直接跳过

        // 1. 向上滚动：加载历史消息 (Older)
        if (messageArea.scrollTop < 50) {
            const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
            if (!chat || !chat.history) return;
            const totalMessages = chat.history.length;
            
            // 只有当还有更旧的消息时才加载
            if (totalMessages > currentPage * MESSAGES_PER_PAGE) {
                loadMoreMessages(); // 这是原有的加载旧消息函数
            }
        }

        // 2. 向下滚动：加载后续消息 (Newer)
        // 判断是否接近底部 (容差 50px)
        const isNearBottom = messageArea.scrollHeight - messageArea.scrollTop - messageArea.clientHeight < 50;
        
        if (isNearBottom) {
            // 只有当我们不在第一页（即 currentPage > 1）时，说明下面还有更新的消息
            if (currentPage > 1) {
                loadNewerMessages(); // ===> 这是我们需要新增的函数 <===
            }
        }
    });

    // ==========================================
    // 点击监听 (处理点击气泡、面板关闭等)
    // ==========================================
    messageArea.addEventListener('click', (e) => {
        // 1. 点击空白处关闭面板
        if (stickerModal.classList.contains('visible')) {
            stickerModal.classList.remove('visible');
            return;
        }
        if (chatExpansionPanel.classList.contains('visible')) {
            chatExpansionPanel.classList.remove('visible');
            return;
        }

        // 2. 多选模式处理
        if (isInMultiSelectMode) {
            const messageWrapper = e.target.closest('.message-wrapper');
            if (messageWrapper) {
                toggleMessageSelection(messageWrapper.dataset.id);
            }
        } else {
            // 3. 普通模式下的点击事件
            const voiceBubble = e.target.closest('.voice-bubble');
            if (voiceBubble) {
                const transcript = voiceBubble.closest('.message-wrapper').querySelector('.voice-transcript');
                if (transcript) {
                    transcript.classList.toggle('active');
                }
            }
            
            const bilingualBubble = e.target.closest('.bilingual-bubble');
            if (bilingualBubble) {
                const translationText = bilingualBubble.closest('.message-wrapper').querySelector('.translation-text');
                if (translationText) {
                    translationText.classList.toggle('active');
                }
            }

            const pvCard = e.target.closest('.pv-card');
            if (pvCard) {
                const imageOverlay = pvCard.querySelector('.pv-card-image-overlay');
                const footer = pvCard.querySelector('.pv-card-footer');
                imageOverlay.classList.toggle('hidden');
                footer.classList.toggle('hidden');
            }
            const giftCard = e.target.closest('.gift-card');
            if (giftCard) {
                const description = giftCard.closest('.message-wrapper').querySelector('.gift-card-description');
                if (description) {
                    description.classList.toggle('active');
                }
            }
            const transferCard = e.target.closest('.transfer-card.received-transfer');
            if (transferCard && currentChatType === 'private') {
                const messageWrapper = transferCard.closest('.message-wrapper');
                const messageId = messageWrapper.dataset.id;
                const character = db.characters.find(c => c.id === currentChatId);
                const message = character.history.find(m => m.id === messageId);
                if (message && message.transferStatus === 'pending') {
                    handleReceivedTransferClick(messageId);
                }
            }
        }
    });

    messageArea.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        // 注意：这里移除了 id === 'load-more-btn' 的判断，因为按钮已经没了
        if (isInMultiSelectMode) return;
        const messageWrapper = e.target.closest('.message-wrapper');
        if (!messageWrapper) return;
        handleMessageLongPress(messageWrapper, e.clientX, e.clientY);
    });

    messageArea.addEventListener('touchstart', (e) => {
        // 同样移除了 load-more-btn 的判断
        const messageWrapper = e.target.closest('.message-wrapper');
        if (!messageWrapper) return;
        longPressTimer = setTimeout(() => {
            const touch = e.touches[0];
            handleMessageLongPress(messageWrapper, touch.clientX, touch.clientY);
        }, 400);
    });
    messageArea.addEventListener('touchend', () => clearTimeout(longPressTimer));
    messageArea.addEventListener('touchmove', () => clearTimeout(longPressTimer));

    const messageEditForm = document.getElementById('message-edit-form');
    if (messageEditForm) {
        messageEditForm.addEventListener('submit', (e) => {
            e.preventDefault();
            saveMessageEdit();
        });
    }

    const cancelEditModalBtn = document.getElementById('cancel-edit-modal-btn');
    if (cancelEditModalBtn) {
        cancelEditModalBtn.addEventListener('click', cancelMessageEdit);
    }

    cancelMultiSelectBtn.addEventListener('click', exitMultiSelectMode);
    deleteSelectedBtn.addEventListener('click', deleteSelectedMessages);

    document.getElementById('cancel-reply-btn').addEventListener('click', cancelQuoteReply);
}
 
            
                       
   // 长按功能 
   
                                             function createContextMenu(items, x, y) {
                removeContextMenu();
                const menu = document.createElement('div');
                menu.className = 'context-menu';

                // 先添加到 DOM 以便计算高度，但暂时隐藏
                menu.style.visibility = 'hidden';
                document.body.appendChild(menu);

                items.forEach(item => {
                    const menuItem = document.createElement('div');
                    menuItem.className = 'context-menu-item';
                    if (item.danger) menuItem.classList.add('danger');
                    menuItem.textContent = item.label;
                    menuItem.onclick = () => {
                        item.action();
                        removeContextMenu();
                    };
                    menu.appendChild(menuItem);
                });

                // 获取菜单尺寸和窗口尺寸
                const menuRect = menu.getBoundingClientRect();
                const windowHeight = window.innerHeight;
                const windowWidth = window.innerWidth;

                // --- 智能定位逻辑 ---
                // 1. 垂直方向：如果底部空间不足，且上方空间充足，则向上显示
                if (y + menuRect.height > windowHeight - 10) { // 留10px边距
                    menu.style.top = `${y - menuRect.height}px`;
                    // 稍微做一个动画优化的处理：设置 transform-origin
                    menu.style.transformOrigin = 'bottom left';
                } else {
                    menu.style.top = `${y}px`;
                    menu.style.transformOrigin = 'top left';
                }

                // 2. 水平方向：防止右侧溢出（虽然通常不会，但保险起见）
                if (x + menuRect.width > windowWidth) {
                    menu.style.left = `${windowWidth - menuRect.width - 10}px`;
                } else {
                    menu.style.left = `${x}px`;
                }

                // 恢复可见性
                menu.style.visibility = 'visible';

                // 绑定一次性点击关闭事件
                // 使用 setTimeout 0 确保当前的点击事件冒泡不会立即触发关闭
                setTimeout(() => {
                    document.addEventListener('click', removeContextMenu, { once: true });
                }, 0);
            }

            function removeContextMenu() {
                const menu = document.querySelector('.context-menu');
                if (menu) menu.remove();
            }                                          
            function handleMessageLongPress(messageWrapper, x, y) {
            if (isInMultiSelectMode) return;
            clearTimeout(longPressTimer);
            const messageId = messageWrapper.dataset.id;
            const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
            const message = chat.history.find(m => m.id === messageId);
            if (!message) return;

            // --- 核心判断逻辑 ---
            const isNarration = /\[system-narration:[\s\S]+?\]/.test(message.content);
            const isTimeSkip = /\[system-display:[\s\S]+?\]/.test(message.content);
            const isWithdrawn = message.isWithdrawn;
            const isOfflineMode = (currentChatType === 'private' && chat.offlineModeEnabled);
            
            let menuItems = [];

            if (isNarration) {
                // --- 旁白菜单 ---
                
                // 1. 复制功能 (使用增强版函数)
                menuItems.push({
                    label: '复制', 
                    action: () => {
                        // A. 尝试提取 [system-narration:...] 里面的内容
                        const match = message.content.match(/\[system-narration:([\s\S]+?)\]/);
                        let textToCopy = match ? match[1] : message.content;
                        
                        // B. 如果提取失败（可能是旧数据或格式不匹配），尝试去掉可能的首尾括号
                        if (!match && textToCopy.startsWith('[') && textToCopy.endsWith(']')) {
                            textToCopy = textToCopy.substring(1, textToCopy.length - 1);
                        }

                        // C. 清洗 Markdown 符号 (把 *斜体* 还原为普通文字)
                        // 将 *文字* 替换为 文字
                        textToCopy = textToCopy.replace(/\*([^*]+)\*/g, '$1').trim();
                        
                        // D. 执行复制
                        copyTextToClipboard(textToCopy)
                            .then(() => showToast('已复制'))
                            .catch((err) => {
                                console.error(err);
                                showToast('复制失败，请重试');
                            });
                    }
                });

                // 2. 编辑功能
                menuItems.push({label: '编辑', action: () => startMessageEdit(messageId)});

                // 3. 删除功能
                menuItems.push({label: '删除', action: () => enterMultiSelectMode(messageId)});

            } else if (isTimeSkip) {
        // --- 新增：时间跳过/剧情显示消息 ---
        menuItems.push({
            label: '复制',
            action: () => {
                const match = message.content.match(/\[system-display:([\s\S]+?)\]/);
                copyTextToClipboard(match ? match[1] : message.content).then(() => showToast('已复制'));
            }
        });
            // 允许编辑
        menuItems.push({label: '编辑', action: () => startMessageEdit(messageId)});
        menuItems.push({label: '删除', action: () => enterMultiSelectMode(messageId)});
            
          } else {
                // --- 普通消息菜单 (保持原有) ---
                const isImageRecognitionMsg = message.parts && message.parts.some(p => p.type === 'image');
                const isVoiceMessage = /\[.*?的语音：.*?\]/.test(message.content);
                const isStickerMessage = /\[.*?的表情包：.*?\]|\[.*?发送的表情包：.*?\]/.test(message.content);
                const isPhotoVideoMessage = /\[.*?发来的照片\/视频：.*?\]/.test(message.content);
                const isTransferMessage = /\[.*?给你转账：.*?\]|\[.*?的转账：.*?\]|\[.*?向.*?转账：.*?\]/.test(message.content);
                const isGiftMessage = /\[.*?送来的礼物：.*?\]|\[.*?向.*?送来了礼物：.*?\]/.test(message.content);
                const isInvisibleMessage = /\[.*?(?:接收|退回).*?的转账\]|\[.*?更新状态为：.*?\]|\[.*?已接收礼物\]|\[system:.*?\]|\[.*?邀请.*?加入了群聊\]|\[.*?修改群名为：.*?\]|\[.*?修改.*?的群昵称为：.*?\]/.test(message.content);

                if (!isWithdrawn) {
                    if (!isImageRecognitionMsg && !isVoiceMessage && !isStickerMessage && !isPhotoVideoMessage && !isTransferMessage && !isGiftMessage && !isInvisibleMessage) {
                         menuItems.push({
                            label: '复制',
                            action: () => {
                                let text = message.content.replace(/\[.*?的消息：([\s\S]+?)\]/, '$1');
                                copyTextToClipboard(text)
                                    .then(() => showToast('已复制'))
                                    .catch(() => showToast('复制失败'));
                            }
                        });
                        menuItems.push({label: '编辑', action: () => startMessageEdit(messageId)});
                    }
                    
                    
                    if (!isInvisibleMessage) {
                        if (!isOfflineMode) {
                    menuItems.push({label: '引用', action: () => startQuoteReply(messageId)});
                }
                    }

                    if (message.role === 'user') {
                        if (!isOfflineMode) {
                    menuItems.push({label: '撤回', action: () => withdrawMessage(messageId)});
                }
                    }
                }
                menuItems.push({label: '删除', action: () => enterMultiSelectMode(messageId)});
            }

            if (menuItems.length > 0) {
                createContextMenu(menuItems, x, y);
            }
        }
        
            // --- 新增：引用功能相关函数 ---
            function startQuoteReply(messageId) {
                const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
                const message = chat.history.find(m => m.id === messageId);
                if (!message) return;

                let senderName = '';
                let senderId = '';
                if (message.role === 'user') {
                    senderName = (currentChatType === 'private') ? chat.myName : chat.me.realName;
                    senderId = 'user_me';
                } else { // assistant
                    if (currentChatType === 'private') {
                        senderName = chat.remarkName;
                        senderId = chat.id;
                    } else {
                        const sender = chat.members.find(m => m.id === message.senderId);
                        senderName = sender ? sender.groupNickname : '未知成员';
                        senderId = sender ? sender.id : 'unknown';
                    }
                }

                // 提取纯文本内容用于预览
                let previewContent = message.content;
                const textMatch = message.content.match(/\[.*?的消息：([\s\S]+?)\]/);
                if (textMatch) {
                    previewContent = textMatch[1];
                } else if (/\[.*?的表情包：.*?\]/.test(message.content)) {
                    previewContent = '[表情包]';
                } else if (/\[.*?的语音：.*?\]/.test(message.content)) {
                    previewContent = '[语音]';
                } else if (/\[.*?发来的照片\/视频：.*?\]/.test(message.content)) {
                    previewContent = '[照片/视频]';
                } else if (message.parts && message.parts.some(p => p.type === 'image')) {
                    previewContent = '[图片]';
                }

                currentQuoteInfo = {
                    id: message.id,
                    senderId: senderId,
                    senderName: senderName,
                    content: previewContent.substring(0, 100) // 截断以防过长
                };

                const previewBar = document.getElementById('reply-preview-bar');
                previewBar.querySelector('.reply-preview-name').textContent = `回复 ${senderName}`;
                previewBar.querySelector('.reply-preview-text').textContent = currentQuoteInfo.content;
                previewBar.classList.add('visible');

                messageInput.focus();
            }

            function cancelQuoteReply() {
                currentQuoteInfo = null;
                const previewBar = document.getElementById('reply-preview-bar');
                previewBar.classList.remove('visible');
            }
           
            
              // --- 编辑功能 ---
            
// --- 替换 startMessageEdit 函数 ---
function startMessageEdit(messageId) {
    exitMultiSelectMode();
    editingMessageId = messageId;
    const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
    const message = chat.history.find(m => m.id === messageId);
    if (!message) return;

    const modal = document.getElementById('message-edit-modal');
    const textarea = document.getElementById('message-edit-textarea');
    const typeSelect = document.getElementById('message-edit-type'); // 获取下拉框

    let contentToEdit = message.content;
    let currentType = 'text'; // 默认为普通文本

    // --- 1. 智能识别当前类型并提取纯文本 ---
    
    // A. 剧情旁白 [system-narration:...]
    const narrationMatch = contentToEdit.match(/^\[system-narration:([\s\S]+?)\]$/);
    // B. 屏幕通知/时间跳过 [system-display:...]
    const displayMatch = contentToEdit.match(/^\[system-display:([\s\S]+?)\]$/);
    // C. 纯系统指令 [system:...]
    const systemMatch = contentToEdit.match(/^\[system:([\s\S]+?)\]$/);
    // D. 普通对话 [名字的消息：...]
    const plainTextMatch = contentToEdit.match(/^\[.*?的消息：([\s\S]*)\]$/);

    if (narrationMatch) {
        contentToEdit = narrationMatch[1].trim();
        currentType = 'narration';
    } else if (displayMatch) {
        contentToEdit = displayMatch[1].trim();
        currentType = 'display';
    } else if (systemMatch) {
        contentToEdit = systemMatch[1].trim();
        currentType = 'system';
    } else if (plainTextMatch && plainTextMatch[1]) {
        contentToEdit = plainTextMatch[1].trim();
        currentType = 'text';
    } else {
        // 兜底：如果都没有匹配上，可能是纯文本或特殊格式，视为普通文本，但清理一下可能的发送时间戳
        contentToEdit = contentToEdit.replace(/\[发送时间:.*?\]/g, '').trim();
        currentType = 'text';
    }

    // --- 2. 赋值给 UI ---
    textarea.value = contentToEdit;
    if (typeSelect) {
        typeSelect.value = currentType; // 设置下拉框选中状态
    }
    
    modal.classList.add('visible');
    // 稍微延迟聚焦，体验更好
    setTimeout(() => textarea.focus(), 50);
}

// --- saveMessageEdit 函数 ---
async function saveMessageEdit() {
    const textarea = document.getElementById('message-edit-textarea');
    const typeSelect = document.getElementById('message-edit-type');
    const newText = textarea.value.trim();
    
    if (!newText || !editingMessageId) {
        cancelMessageEdit();
        return;
    }

    const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
    const messageIndex = chat.history.findIndex(m => m.id === editingMessageId);
    if (messageIndex === -1) {
        cancelMessageEdit();
        return;
    }

    const message = chat.history[messageIndex];
    const selectedType = typeSelect ? typeSelect.value : 'text'; 

    let newContent = '';

    // --- 核心：根据下拉框类型构建新消息格式 ---
    if (selectedType === 'narration') {
        newContent = `[system-narration:${newText}]`;
    } 
    else if (selectedType === 'display') {
        newContent = `[system-display:${newText}]`;
        if (message.id.startsWith('msg_visual_')) {
            const timestampSuffix = message.id.replace('msg_visual_', '');
            const contextMsgId = `msg_context_${timestampSuffix}`;
            const contextMsg = chat.history.find(m => m.id === contextMsgId);
            if (contextMsg) {
                const newContextContent = `[剧情旁白：${newText}]`;
                contextMsg.content = newContextContent;
                if (contextMsg.parts) {
                    contextMsg.parts = [{ type: 'text', text: newContextContent }];
                }
            }
        }
    } 
    else {
        let senderName = '';
        if (message.role === 'user') {
            senderName = (currentChatType === 'private') ? chat.myName : chat.me.realName;
        } else {
            if (currentChatType === 'private') {
                senderName = chat.realName || chat.name;
            } else {
                const sender = chat.members.find(m => m.id === message.senderId);
                senderName = sender ? sender.groupNickname : (chat.name || '未知成员');
            }
        }
        newContent = `[${senderName}的消息：${newText}]`;
    }

    // --- 更新数据 ---
    chat.history[messageIndex].content = newContent;
    
    if (chat.history[messageIndex].parts) {
        chat.history[messageIndex].parts = [{ type: 'text', text: newContent }];
    }

    await saveData();
    
    // ==========================================
    // 【核心修复】原地 DOM 替换，解决跳转和消息丢失问题
    // ==========================================
    
    // 1. 在页面上找到旧的消息气泡 DOM 元素
    const existingBubble = messageArea.querySelector(`.message-wrapper[data-id="${editingMessageId}"]`);

    // 2. 使用现有的函数生成一个新的气泡 DOM 元素
    // 注意：createMessageBubbleElement 依赖已更新的 chat.history 数据
    const newBubble = createMessageBubbleElement(chat.history[messageIndex]);

    if (existingBubble) {
        if (newBubble) {
            // 3a. 如果新气泡生成成功，直接替换旧气泡
            // 这会保留浏览器当前的滚动位置，因为元素高度变化通常不会剧烈影响视口定位
            existingBubble.replaceWith(newBubble);
            
 
        } else {
            // 3b. 如果新内容导致气泡不可见（例如改成了隐藏指令），则移除元素
            existingBubble.remove();
        }
    } else {
        // 4. 兜底：如果找不到旧元素（极少情况），才调用原来的重绘逻辑
        // 但为了防止丢失最新消息，这里建议什么都不做，或者只重绘
        // 只有当真的找不到元素时，我们才被迫重绘
        renderMessages(false, false); 
    }
    
    cancelMessageEdit();
}

            function cancelMessageEdit() {
                editingMessageId = null;
                const modal = document.getElementById('message-edit-modal');
                if (modal) {
                    modal.classList.remove('visible');
                }
            }
            
function enterMultiSelectMode(initialMessageId) {
                isInMultiSelectMode = true;
                chatRoomHeaderDefault.style.display = 'none';
                chatRoomHeaderSelect.style.display = 'flex';
                document.querySelector('.chat-input-wrapper').style.display = 'none';
                multiSelectBar.classList.add('visible');
                chatRoomScreen.classList.add('multi-select-active');
                selectedMessageIds.clear();
                if (initialMessageId) {
                    toggleMessageSelection(initialMessageId);
                }
            }

            function exitMultiSelectMode() {
                isInMultiSelectMode = false;
                chatRoomHeaderDefault.style.display = 'flex';
                chatRoomHeaderSelect.style.display = 'none';
                document.querySelector('.chat-input-wrapper').style.display = 'block';
                multiSelectBar.classList.remove('visible');
                chatRoomScreen.classList.remove('multi-select-active');
                selectedMessageIds.forEach(id => {
                    const el = messageArea.querySelector(`.message-wrapper[data-id="${id}"]`);
                    if (el) el.classList.remove('multi-select-selected');
                });
                selectedMessageIds.clear();
            }

            function toggleMessageSelection(messageId) {
                const el = messageArea.querySelector(`.message-wrapper[data-id="${messageId}"]`);
                if (!el) return;
                if (selectedMessageIds.has(messageId)) {
                    selectedMessageIds.delete(messageId);
                    el.classList.remove('multi-select-selected');
                } else {
                    selectedMessageIds.add(messageId);
                    el.classList.add('multi-select-selected');
                }
                selectCount.textContent = `已选择 ${selectedMessageIds.size} 项`;
                deleteSelectedBtn.disabled = selectedMessageIds.size === 0;
            }

            async function deleteSelectedMessages() {
                if (selectedMessageIds.size === 0) return;
                const deletedCount = selectedMessageIds.size;
                const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
                chat.history = chat.history.filter(m => !selectedMessageIds.has(m.id));
                await saveData();
                currentPage = 1;
                renderMessages(false, true);
                renderChatList();
                exitMultiSelectMode();
                showToast(`已删除 ${deletedCount} 条消息`);
            }

            function openChatRoom(chatId, type) {
                const chat = (type === 'private') ? db.characters.find(c => c.id === chatId) : db.groups.find(g => g.id === chatId);
                if (!chat) return;
                // --- 从这里开始是新增的代码 ---
                if (chat.unreadCount && chat.unreadCount > 0) {
                    chat.unreadCount = 0;
                    saveData();
                    renderChatList(); // 重新渲染列表，清除红点
                }
                // --- 新增代码结束 ---
                exitMultiSelectMode();
                cancelMessageEdit();
                switchScreen('chat-room-screen');
                const peekBtn = document.getElementById('peek-btn');
    if (peekBtn) {
        if (type === 'group') {
            peekBtn.style.display = 'none'; // 群聊隐藏
        } else {
            peekBtn.style.display = 'flex'; // 私聊显示 (使用 flex 以保持图标居中)
        }
    }
                chatRoomTitle.textContent = (type === 'private') ? chat.remarkName : chat.name;
                const subtitle = document.getElementById('chat-room-subtitle');
                if (type === 'private') {
                    subtitle.style.display = 'flex';
                    chatRoomStatusText.textContent = chat.status || '在线';
                } else {
                    subtitle.style.display = 'none';
                }
                getReplyBtn.style.display = 'inline-flex';
                chatRoomScreen.style.backgroundImage = chat.chatBg ? `url(${chat.chatBg})` : 'none';
                typingIndicator.style.display = 'none';
                isGenerating = false;
                getReplyBtn.disabled = false;
                currentPage = 1;
                chatRoomScreen.className = chatRoomScreen.className.replace(/\bchat-active-[^ ]+\b/g, '');
                chatRoomScreen.classList.add(`chat-active-${chatId}`);
                updateCustomBubbleStyle(chatId, chat.customBubbleCss, chat.useCustomBubbleCss);
                // --- 插入代码：初始化线下模式 UI 状态 ---
                if (type === 'private') {
                    applyOfflineNarrationCss(chatId, chat.offlineNarrationCss);
                    // 传入当前是否开启了线下模式
                    updateOfflineModeUI(chat.offlineModeEnabled);
                } else {
                    // 群聊没有线下模式，强制重置为线上状态
                    updateOfflineModeUI(false);
                }
                // --- 插入结束 ---
                renderMessages(false, false);
                
            }

// --- 找到并完全替换 renderMessages 函数 ---

function renderMessages(isLoadMore = false, forceScrollToBottom = false) {
    const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
    if (!chat || !chat.history) return;

    // 1. 【关键】记录插入前的滚动高度和当前滚动位置
    const oldScrollHeight = messageArea.scrollHeight;
    const oldScrollTop = messageArea.scrollTop;

    const totalMessages = chat.history.length;
    const end = totalMessages - (currentPage - 1) * MESSAGES_PER_PAGE;
    const start = Math.max(0, end - MESSAGES_PER_PAGE);
    
    // 截取需要渲染的消息片段
    const messagesToRender = chat.history.slice(start, end);

    if (!isLoadMore) {
        messageArea.innerHTML = '';
    } else {
        // 如果是加载更多，先移除可能存在的 loading 指示器（如果有的话）
        const loader = messageArea.querySelector('.history-loading-indicator');
        if (loader) loader.remove();
    }

    const fragment = document.createDocumentFragment();

    // 2. 如果还有更早的消息，先在顶部插入一个 Loading 指示器
    //    这不仅是视觉提示，也是占位符，防止瞬间拉到顶触发多次
    if (start > 0) {
        const loadingDiv = document.createElement('div');
        loadingDiv.className = 'history-loading-indicator';
        
        // 插入 CSS 画出的 Spinner
        loadingDiv.innerHTML = `<div class="custom-spinner"></div>`;
        // 添加一个简单的旋转动画css到你的css文件里： .spin { animation: spin 1s linear infinite; } @keyframes spin { 100% { transform: rotate(360deg); } }
        fragment.appendChild(loadingDiv);
    }

    // 3. 渲染消息气泡
// ...
    messagesToRender.forEach(msg => {
        if (msg.isHidden) return; 
        
        if (isLoadMore) {
            const existingBubble = messageArea.querySelector(`.message-wrapper[data-id="${msg.id}"]`);
            if (existingBubble) {
                return; // 页面已有此消息，不再重复创建
            }
        }
        
        const bubble = createMessageBubbleElement(msg);
        
        if (bubble) {
            // 【新增】如果是新消息模式，给气泡加动画类
            if (forceScrollToBottom) {
                bubble.classList.add('new-message-anim');
            }
            fragment.appendChild(bubble);
        }
    });
    // ...

    // 4. 将新消息插入到 DOM
// --- 找到 renderMessages 函数的末尾部分并替换 ---

    // 4. 将新消息插入到 DOM
    if (!isLoadMore) {
        messageArea.appendChild(fragment);
    } else {
        messageArea.prepend(fragment);
    }

    // ============================================================
    // 滚动逻辑控制 (修复版)
    // ============================================================
    
    if (forceScrollToBottom) {
        // --- 场景 A：发送/接收新消息 ---
        // 开启平滑滚动动画
        messageArea.style.scrollBehavior = 'smooth';
        requestAnimationFrame(() => {
             messageArea.scrollTop = messageArea.scrollHeight;
        });

    } else if (isLoadMore) {
        // --- 场景 B：加载历史记录 ---
        // 瞬间跳转，维持当前视觉位置
        messageArea.style.scrollBehavior = 'auto';
        const newScrollHeight = messageArea.scrollHeight;
        messageArea.scrollTop = newScrollHeight - oldScrollHeight + oldScrollTop;
        isLoadingHistory = false;

    // --- 找到 renderMessages 函数末尾的 else 分支，完全替换该块内容 ---

    } else {
        // --- 场景 C：初始化进入聊天室 (终极修复版) ---
        
        // 1. 基础设置：关闭动画，瞬间跳转
        messageArea.style.scrollBehavior = 'auto';
        
        // 定义一个强制到底的函数
        const forceToBottom = () => {
            messageArea.scrollTop = messageArea.scrollHeight;
        };

        // 2. 立即执行一次
        forceToBottom();

        // 3. 延迟一小会儿再执行一次 (应对 DOM 渲染延迟)
        setTimeout(forceToBottom, 50);

        // 4. 【核心修复】针对所有图片的“无死角”监听
        const images = messageArea.querySelectorAll('img');
        
        if (images.length > 0) {
            images.forEach(img => {
                // 情况 A: 图片已经有缓存 (complete 为 true)
                // 即使缓存了，浏览器渲染也需要几毫秒，所以必须重新执行滚动
                if (img.complete) {
                    forceToBottom();
                } 
                // 情况 B: 图片正在加载
                else {
                    // 使用 onload 确保加载完撑开高度后滚动
                    img.addEventListener('load', () => {
                requestAnimationFrame(forceToBottom);
            });
            img.addEventListener('error', () => {
                 requestAnimationFrame(forceToBottom);
            });
                }
            });
        }
    }
}

function loadMoreMessages() {
    if (isLoadingHistory) return; // 如果正在加载，直接退出
    isLoadingHistory = true;      // 设为正在加载
    
    // 稍微给一点延迟（例如 200ms），让 Loading 图标能显示出来一瞬间，
    // 否则本地渲染太快，用户可能感觉不到加载动作，体验反而生硬
    setTimeout(() => {
        currentPage++;
        renderMessages(true, false);
    }, 500); 
}

// === 新增函数 1：触发加载后续消息 ===
function loadNewerMessages() {
    if (isLoadingHistory) return;
    isLoadingHistory = true;

    // 添加底部 Loading 指示器 (可选，为了体验更好)
    const bottomLoader = document.createElement('div');
    bottomLoader.className = 'history-loading-indicator bottom-loader';
    bottomLoader.innerHTML = `<div class="custom-spinner"></div>`;
    messageArea.appendChild(bottomLoader);
    
    // 自动滚动一点点以露出 Loading(可选)
    // messageArea.scrollTop += 60;

    // 模拟一点延迟，防止闪烁
    setTimeout(() => {
        // 核心逻辑：页码减 1，代表向“现在”迈进一步
        currentPage--; 
        
        // 渲染下一页数据
        renderNewerMessages();
        
        // 移除 Loading
        if(bottomLoader) bottomLoader.remove();
        
        isLoadingHistory = false;
    }, 500);
}

// === 新增函数 2：渲染后续消息 (追加到底部) ===
function renderNewerMessages() {
    const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
    if (!chat || !chat.history) return;

    // 1. 计算切片范围
    // 逻辑：因为 currentPage 已经减 1 了，我们需要获取这一页对应的数据
    // 假设每页 20 条，总共 100 条。
    // 原来在第 5 页 (index 0-19)。现在变成了第 4 页 (index 20-39)。
    // 公式与 renderMessages 保持一致
    const totalMessages = chat.history.length;
    const end = totalMessages - (currentPage - 1) * MESSAGES_PER_PAGE;
    const start = Math.max(0, end - MESSAGES_PER_PAGE);

    const messagesToRender = chat.history.slice(start, end);

    // 2. 创建文档片段
    const fragment = document.createDocumentFragment();

    messagesToRender.forEach(msg => {
        if (msg.isHidden) return;
        
        // 防重检查：虽然切片逻辑理论上不会重复，但在边界情况检查一下 ID 更安全
        const exists = messageArea.querySelector(`.message-wrapper[data-id="${msg.id}"]`);
        if (!exists) {
            const bubble = createMessageBubbleElement(msg);
            if (bubble) {
                fragment.appendChild(bubble);
            }
        }
    });

    // 3. 追加到现有的消息列表底部 (Append)
    messageArea.appendChild(fragment);
    
    // 注意：加载后续消息时，我们通常不需要调整滚动条位置，
    // 因为追加内容到底部不会影响当前视口（除非用户已经紧贴底部，那样正好顺滑看到新消息）。
}

            function calculateVoiceDuration(text) {
                return Math.max(1, Math.min(60, Math.ceil(text.length / 3.5)));
            }

            function createMessageBubbleElement(message) {
                const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
                const { role, content, timestamp, id, transferStatus, giftStatus, stickerData, senderId, quote, isWithdrawn, originalContent } = message;

                // --- 插入代码：渲染旁白气泡 (支持 Markdown) ---
                const narrationRegex = /\[system-narration:([\s\S]+?)\]/;
                const narrationMatch = content.match(narrationRegex);

                if (narrationMatch) {
                    // 1. 去除首尾空格
                    let text = narrationMatch[1].trim();

                    // 2. 【核心修复】手动预处理斜体语法
                    // 解释：正则 /\*([^*]+)\*/g 会找到所有成对的星号
                    // 并强制将其替换为 <em>...</em> 标签
                    // 这样 marked.js 就再也不会把开头的 * 误认为是列表符号了
                    text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');

                    const wrapper = document.createElement('div');
                    wrapper.dataset.id = id;
                    wrapper.className = 'message-wrapper system-notification narration-wrapper';

                    const bubble = document.createElement('div');
                    bubble.className = 'narration-bubble markdown-content';

                    // 3. 解析 Markdown (此时星号已经变成了 em 标签，不会出错)
                    const htmlContent = marked.parse(text, { breaks: true });
                    bubble.innerHTML = DOMPurify.sanitize(htmlContent);

                    wrapper.appendChild(bubble);

                    wrapper.addEventListener('contextmenu', (e) => {
                        e.preventDefault();
                        if (!isInMultiSelectMode) {
                            createContextMenu([{ label: '删除', action: () => enterMultiSelectMode(id) }], e.clientX, e.clientY);
                        }
                    });

                    return wrapper;
                }
                // --- 插入结束 ---

                // --- 新增：双语模式判断逻辑 ---
                const isBilingualMode = chat.bilingualModeEnabled;
                let bilingualMatch = null;
                if (isBilingualMode && role === 'assistant') {
                    const contentMatch = content.match(/^\[.*?的消息：([\s\S]+)\]$/);
                    if (contentMatch) {
                        const mainText = contentMatch[1].trim();
                        // 从后往前找到最后一个右括号
                        const lastCloseParen = Math.max(mainText.lastIndexOf(')'), mainText.lastIndexOf('）'));
                        if (lastCloseParen > -1) {
                            // 从右括号的位置往前找对应的左括号
                            const lastOpenParen = Math.max(
                                mainText.lastIndexOf('(', lastCloseParen),
                                mainText.lastIndexOf('（', lastCloseParen)
                            );
                            if (lastOpenParen > -1) {
                                const chineseText = mainText.substring(lastOpenParen + 1, lastCloseParen).trim();
                                const foreignText = mainText.substring(0, lastOpenParen).trim();
                                // 确保原文和译文都不是空的
                                if (foreignText && chineseText) {
                                    bilingualMatch = [null, foreignText, chineseText];
                                }
                            }
                        }
                    }
                }


                if (bilingualMatch) {
                    const foreignText = bilingualMatch[1].trim();
                    const chineseText = bilingualMatch[2].trim();
                    const wrapper = document.createElement('div');
                    wrapper.dataset.id = id;
                    wrapper.className = 'message-wrapper received'; // 双语消息总是接收的

                    const bubbleRow = document.createElement('div');
                    bubbleRow.className = 'message-bubble-row';

                    const avatarUrl = chat.avatar;
                    const timeString = `${pad(new Date(timestamp).getHours())}:${pad(new Date(timestamp).getMinutes())}`;

                    const bubbleElement = document.createElement('div');
                    bubbleElement.className = 'message-bubble received bilingual-bubble';
                    bubbleElement.innerHTML = `<span>${DOMPurify.sanitize(foreignText)}</span>`;
                    const themeKey = chat.theme || 'white_blue';
                    const theme = colorThemes[themeKey] || colorThemes['white_blue'];
                    const bubbleTheme = theme.received;
                    if (!chat.useCustomBubbleCss) {
                        bubbleElement.style.backgroundColor = bubbleTheme.bg;
                        bubbleElement.style.color = bubbleTheme.text;
                    }


                    const translationDiv = document.createElement('div');
                    translationDiv.className = 'translation-text';
                    translationDiv.textContent = chineseText;

                    bubbleRow.innerHTML = `<div class="message-info"><img src="${avatarUrl}" class="message-avatar"><span class="message-time">${timeString}</span></div>`;
                    bubbleRow.appendChild(bubbleElement);
                    wrapper.appendChild(bubbleRow);
                    wrapper.appendChild(translationDiv);
                    return wrapper;
                }
                // --- 双语模式逻辑结束 ---

// 如果不是双语模式，则执行旧的逻辑
                
                // --- 修复开始：先创建 wrapper，并优先处理撤回消息，防止被 regex 误伤 ---
                const wrapper = document.createElement('div');
                wrapper.dataset.id = id;

                // 1. 【优先判断】如果是撤回状态，直接渲染，不再进行隐藏正则检查
                if (isWithdrawn) {
                    wrapper.className = 'message-wrapper system-notification';
                    const withdrawnText = (role === 'user') ? '你撤回了一条消息' : `${chat.remarkName || chat.name}撤回了一条消息`;
                    
                    // 处理撤回内容的显示，兼容 AI 撤回的特殊格式
                    let contentToShow = '';
                    if (originalContent) {
                        contentToShow = originalContent;
                    } else {
                        // 如果没有 originalContent (旧数据)，尝试从 system 文本中提取
                        // AI 撤回格式通常为 [system: ... Original: ...]
                        const match = content.match(/Original: ([\s\S]+?)\]/);
                        contentToShow = match ? match[1] : content;
                    }
                    // 清理一下格式，只保留纯文本
                    contentToShow = contentToShow.replace(/\[.*?的消息：([\s\S]+?)\]/, '$1');

                    wrapper.innerHTML = `<div><span class="withdrawn-message">${withdrawnText}</span></div><div class="withdrawn-content">${DOMPurify.sanitize(contentToShow)}</div>`;
                    
                    const withdrawnMessageSpan = wrapper.querySelector('.withdrawn-message');
                    if (withdrawnMessageSpan) {
                        withdrawnMessageSpan.addEventListener('click', () => {
                            const withdrawnContent = wrapper.querySelector('.withdrawn-content');
                            if (withdrawnContent && withdrawnContent.textContent.trim()) {
                                withdrawnContent.classList.toggle('active');
                            }
                        });
                    }
                    return wrapper;
                }

                // 2. 【之后判断】不可见消息正则（注意：撤回消息已经处理并 return 了，不会走到这里）
                const invisibleRegex = /\[.*?(?:接收|退回).*?的转账\]|\[.*?更新状态为：.*?\]|\[.*?已接收礼物\]|\[system:.*?\]|\[系统情景通知：.*?\]/;
                if (invisibleRegex.test(content)) {
                    return null;
                }

                // 3. 处理其他可见的系统通知
                const timeSkipRegex = /\[system-display:([\s\S]+?)\]/;
                const inviteRegex = /\[(.*?)邀请(.*?)加入了群聊\]/;
                const renameRegex = /\[(.*?)修改群名为：(.*?)\]/;
                const memberRenameRegex = /\[(.*?)修改(.*?)的群昵称为：(.*?)\]/;
                const selfRenameRegex = /\[(.*?)将自己的群昵称修改为：(.*?)\]/;
                const timeSkipMatch = content.match(timeSkipRegex);
                const inviteMatch = content.match(inviteRegex);
                const renameMatch = content.match(renameRegex);
                const memberRenameMatch = content.match(memberRenameRegex);
                const selfRenameMatch = content.match(selfRenameRegex);

                if (timeSkipMatch || inviteMatch || renameMatch || memberRenameMatch || selfRenameMatch) {
                    // --- 修复结束 ---
                    wrapper.className = 'message-wrapper system-notification';
                    let bubbleText = '';
                    if (timeSkipMatch) bubbleText = timeSkipMatch[1];
                    if (inviteMatch) bubbleText = `${inviteMatch[1]}邀请${inviteMatch[2]}加入了群聊`;
                    if (renameMatch) bubbleText = `${renameMatch[1]}修改群名为“${renameMatch[2]}”`;
                    if (memberRenameMatch) bubbleText = `${memberRenameMatch[1]}将${memberRenameMatch[2]}的群昵称修改为“${memberRenameMatch[3]}”`;
                    if (selfRenameMatch) bubbleText = `${selfRenameMatch[1]}将自己的群昵称修改为“${selfRenameMatch[2]}”`;
                    wrapper.innerHTML = `<div class="system-notification-bubble">${bubbleText}</div>`;
                    return wrapper;
                }
                const isSent = (role === 'user');
                let avatarUrl, bubbleTheme, senderNickname = '';
                const themeKey = chat.theme || 'white_blue';
                const theme = colorThemes[themeKey] || colorThemes['white_blue'];
                let messageSenderId = isSent ? 'user_me' : senderId;
                if (isSent) {
                    avatarUrl = (currentChatType === 'private') ? chat.myAvatar : chat.me.avatar;
                    bubbleTheme = theme.sent;
                } else {
                    if (currentChatType === 'private') {
                        avatarUrl = chat.avatar;
                    } else {
                        const sender = chat.members.find(m => m.id === senderId);
                        if (sender) {
                            avatarUrl = sender.avatar;
                            senderNickname = sender.groupNickname;
                        } else {
                            avatarUrl = 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg';
                        }
                    }
                    bubbleTheme = theme.received;
                }
                const timeString = `${pad(new Date(timestamp).getHours())}:${pad(new Date(timestamp).getMinutes())}`;
                wrapper.className = `message-wrapper ${isSent ? 'sent' : 'received'}`;
                if (currentChatType === 'group' && !isSent) {
                    wrapper.classList.add('group-message');
                }
                const bubbleRow = document.createElement('div');
                bubbleRow.className = 'message-bubble-row';
                let bubbleElement;
                const urlRegex = /^(https?:\/\/[^\s]+\.(?:jpg|jpeg|png|gif|webp|bmp|svg)|data:image\/[a-z]+;base64,)/i;
                // === 替换开始 ===
                const unifiedStickerRegex = /\[(.*?)的表情包：(.*?)\]/; 
                const legacyReceivedStickerRegex = /\[(?:.+?)发送的表情包：([\s\S]+?)\]/i;
                // === 替换结束 ===
                const voiceRegex = /\[(?:.+?)的语音：([\s\S]+?)\]/;
                const photoVideoRegex = /\[(?:.+?)发来的照片\/视频：([\s\S]+?)\]/;
                const privateSentTransferRegex = /\[.*?给你转账：([\d.]+)元；备注：(.*?)\]/;
                const privateReceivedTransferRegex = /\[.*?的转账：([\d.]+)元；备注：(.*?)\]/;
                const groupTransferRegex = /\[(.*?)\s*向\s*(.*?)\s*转账：([\d.]+)元；备注：(.*?)\]/;
                const privateGiftRegex = /\[(?:.+?)送来的礼物：([\s\S]+?)\]/;
                const groupGiftRegex = /\[(.*?)\s*向\s*(.*?)\s*送来了礼物：([\s\S]+?)\]/;
                const imageRecogRegex = /\[.*?发来了一张图片：\]/;
                const textRegex = /\[(?:.+?)的消息：([\s\S]+?)\]/;
                const pomodoroRecordRegex = /\[专注记录\]\s*任务：([\s\S]+?)，时长：([\s\S]+?)，期间与 .*? 互动 (\d+)\s*次。/;
                const pomodoroMatch = content.match(pomodoroRecordRegex);
const unifiedStickerMatch = content.match(unifiedStickerRegex);
                const legacyReceivedStickerMatch = content.match(legacyReceivedStickerRegex);
                const voiceMatch = content.match(voiceRegex);
                const photoVideoMatch = content.match(photoVideoRegex);
                const privateSentTransferMatch = content.match(privateSentTransferRegex);
                const privateReceivedTransferMatch = content.match(privateReceivedTransferRegex);
                const groupTransferMatch = content.match(groupTransferRegex);
                const privateGiftMatch = content.match(privateGiftRegex);
                const groupGiftMatch = content.match(groupGiftRegex);
                const imageRecogMatch = content.match(imageRecogRegex);
                const textMatch = content.match(textRegex);
                if (pomodoroMatch) {
                    const taskName = pomodoroMatch[1];
                    const duration = pomodoroMatch[2];
                    const pokeCount = pomodoroMatch[3];
                    bubbleElement = document.createElement('div');
                    bubbleElement.className = 'pomodoro-record-card';
                    const details = { taskName, duration, pokeCount };
                    bubbleElement.innerHTML = `<img src="https://i.postimg.cc/sgdS9khZ/chan-122.png" class="pomodoro-record-icon" alt="pomodoro complete"><div class="pomodoro-record-body"><p class="task-name">${taskName}</p></div>`;
                    const detailsDiv = document.createElement('div');
                    detailsDiv.className = 'pomodoro-record-details';
                    detailsDiv.innerHTML = `<p><strong>任务名称:</strong> ${taskName}</p><p><strong>专注时长:</strong> ${duration}</p><p><strong>“戳一戳”次数:</strong> ${pokeCount}</p>`;
                    wrapper.appendChild(detailsDiv);
                    bubbleElement.addEventListener('click', () => {
                        detailsDiv.classList.toggle('active');
                    });
                } else if (unifiedStickerMatch || legacyReceivedStickerMatch) {
                    let stickerSrc = '';
                    let stickerName = '未知表情';

                    // 1. 获取图片路径
                    if (legacyReceivedStickerMatch && !isSent) {
                        // 兼容早期基于 URL 的旧数据
                        stickerSrc = legacyReceivedStickerMatch[1].trim();
                        if (!stickerSrc.startsWith('http')) stickerSrc = 'https://i.postimg.cc/' + stickerSrc.split('/').pop();
                    } 
                    else if (unifiedStickerMatch) {
                        // 新逻辑：只认表情名字，所有表情都去物理库 db.myStickers 里找
                        stickerName = unifiedStickerMatch[2].trim();
                        const s = db.myStickers.find(x => x.name === stickerName);
                        if (s) {
                            stickerSrc = s.data;
                        } else if (isSent && stickerData) {
                            // 我自己发送那一瞬间的临时兜底
                            stickerSrc = stickerData;
                        }
                    }

                    // 2. 渲染气泡
                    bubbleElement = document.createElement('div');
                    if (stickerSrc) {
                        // 找到了图片，应用专门的贴纸样式，去掉普通的泡泡框
                        bubbleElement.className = 'sticker-bubble';
                        bubbleElement.innerHTML = `<img src="${stickerSrc}" alt="${stickerName}">`;
                    } else {
                        // 如果库里没找到（比如被删了），优雅降级为带背景色的文本
                        bubbleElement.className = `message-bubble ${isSent ? 'sent' : 'received'}`;
                        if (!chat.useCustomBubbleCss) {
                            bubbleElement.style.backgroundColor = bubbleTheme.bg;
                            bubbleElement.style.color = bubbleTheme.text;
                        }
                        bubbleElement.innerHTML = `[表情包：${stickerName}]`;
                    }
                } else if (privateGiftMatch || groupGiftMatch) {
                    const match = privateGiftMatch || groupGiftMatch;
                    bubbleElement = document.createElement('div');
                    bubbleElement.className = 'gift-card';
                    if (giftStatus === 'received') {
                        bubbleElement.classList.add('received');
                    }
                    let giftText;
                    if (groupGiftMatch) {
                        const from = groupGiftMatch[1];
                        const to = groupGiftMatch[2];
                        giftText = isSent ? `你送给 ${to} 的礼物` : `${from} 送给 ${to} 的礼物`;
                    } else {
                        giftText = isSent ? '您有一份礼物～' : '您有一份礼物～';
                    }
                    bubbleElement.innerHTML = `<img src="https://i.postimg.cc/rp0Yg31K/chan-75.png" alt="gift" class="gift-card-icon"><div class="gift-card-text">${giftText}</div><div class="gift-card-received-stamp">已查收</div>`;
                    const description = groupGiftMatch ? groupGiftMatch[3].trim() : match[1].trim();
                    const descriptionDiv = document.createElement('div');
                    descriptionDiv.className = 'gift-card-description';
                    descriptionDiv.textContent = description;
                    wrapper.appendChild(descriptionDiv);
                } else if (content.startsWith('[喵坛分享]')) {


                    // --- 新代码开始 ---
                    // 修改正则匹配 "内容" 而不是 "摘要"
                    const forumShareRegex = /\[喵坛分享\]标题：([\s\S]+?)\n内容：([\s\S]+)/;
                    const forumShareMatch = content.match(forumShareRegex);

                    if (forumShareMatch) {
                        const title = forumShareMatch[1].trim();
                        const fullContent = forumShareMatch[2].trim();

                        // --- 修改点：视觉显示处理，截取前50个字 ---
                        // 注意：这里我们尝试去除分享信息中可能包含的"作者："等前缀，只显示正文，
                        // 或者简单粗暴只截取字符串。为了简单，这里直接截取。
                        let displaySummary = fullContent.substring(0, 50);
                        if (fullContent.length > 50) {
                            displaySummary += '...';
                        }

                        bubbleElement = document.createElement('div');
                        bubbleElement.className = 'forum-share-card';
                        bubbleElement.innerHTML = `
        <div class="forum-share-header">
            <svg viewBox="0 0 24 24"><path d="M21,3H3A2,2 0 0,0 1,5V19A2,2 0 0,0 3,21H21A2,2 0 0,0 23,19V5A2,2 0 0,0 21,3M21,19H3V5H21V19M8,11H16V9H8V11M8,15H13V13H8V15Z" /></svg>
            <span>来自喵坛的分享</span>
        </div>
        <div class="forum-share-content">
            <div class="forum-share-title">${title}</div>
            <div class="forum-share-summary">${displaySummary}</div>
        </div>`;
                    }
                    // --- 新代码结束 ---
                } else if (voiceMatch) {
                    bubbleElement = document.createElement('div');
                    bubbleElement.className = 'voice-bubble';
                    if (!chat.useCustomBubbleCss) {
                        bubbleElement.style.backgroundColor = bubbleTheme.bg;
                        bubbleElement.style.color = bubbleTheme.text;
                    }
                    bubbleElement.innerHTML = `<svg class="play-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"></path></svg><svg class="voice-icon" viewBox="0 0 24 24" fill="currentColor">
  <!-- 多个竖线表示声波 -->
    <path d="M3 9v6h2V9H6z"></path>
  <path d="M7 7v10h2V7h-2z"></path>
  <path d="M11 5v14h2V5h-2z"></path>
  <path d="M15 9v6h2V9H6z"></path>
</svg><span class="duration">${calculateVoiceDuration(voiceMatch[1].trim())}"</span>`;
                    const transcriptDiv = document.createElement('div');
                    transcriptDiv.className = 'voice-transcript';
                    transcriptDiv.textContent = voiceMatch[1].trim();
                    wrapper.appendChild(transcriptDiv);
                } else if (photoVideoMatch) {
                    bubbleElement = document.createElement('div');
                    bubbleElement.className = 'pv-card';
                    bubbleElement.innerHTML = `<div class="pv-card-content">${photoVideoMatch[1].trim()}</div><div class="pv-card-image-overlay" style="background-image: url('${isSent ? 'https://i.postimg.cc/L8NFrBrW/1752307494497.jpg' : 'https://i.postimg.cc/1tH6ds9g/1752301200490.jpg'}');"></div><div class="pv-card-footer"><svg viewBox="0 0 24 24"><path d="M4,4H20A2,2 0 0,1 22,6V18A2,2 0 0,1 20,20H4A2,2 0 0,1 2,18V6A2,2 0 0,1 4,4M4,6V18H20V6H4M10,9A1,1 0 0,1 11,10A1,1 0 0,1 10,11A1,1 0 0,1 9,10A1,1 0 0,1 10,9M8,17L11,13L13,15L17,10L20,14V17H8Z"></path></svg><span>照片/视频・点击查看</span></div>`;
                } else if (privateSentTransferMatch || privateReceivedTransferMatch || groupTransferMatch) {
                    const isSentTransfer = !!privateSentTransferMatch || (groupTransferMatch && isSent);
                    const match = privateSentTransferMatch || privateReceivedTransferMatch || groupTransferMatch;
                    let amount, remarkText, titleText;
                    if (groupTransferMatch) {
                        const from = groupTransferMatch[1];
                        const to = groupTransferMatch[2];
                        amount = parseFloat(groupTransferMatch[3]).toFixed(2);
                        remarkText = groupTransferMatch[4] || '';
                        titleText = isSent ? `向 ${to} 转账` : `${from} 向你转账`;
                    } else {
                        amount = parseFloat(match[1]).toFixed(2);
                        remarkText = match[2] || '';
                        titleText = isSentTransfer ? '给你转账' : '转账';
                    }
                    bubbleElement = document.createElement('div');
                    bubbleElement.className = `transfer-card ${isSentTransfer ? 'sent-transfer' : 'received-transfer'}`;
                    let statusText = isSentTransfer ? '待查收' : '转账给你';
                    if (groupTransferMatch && !isSent) statusText = '转账给Ta';
                    if (transferStatus === 'received') {
                        statusText = '已收款';
                        bubbleElement.classList.add('received');
                    } else if (transferStatus === 'returned') {
                        statusText = '已退回';
                        bubbleElement.classList.add('returned');
                    }
                    if ((transferStatus !== 'pending' && currentChatType === 'private') || currentChatType === 'group') {
                        bubbleElement.style.cursor = 'default';
                    }
                    const remarkHTML = remarkText ? `<p class="transfer-remark">${remarkText}</p>` : '';
                    bubbleElement.innerHTML = `<div class="overlay"></div><div class="transfer-content"><p class="transfer-title">${titleText}</p><p class="transfer-amount">¥${amount}</p>${remarkHTML}<p class="transfer-status">${statusText}</p></div>`;
                } else if (imageRecogMatch || urlRegex.test(content)) {
                    bubbleElement = document.createElement('div');
                    bubbleElement.className = 'image-bubble';
                    bubbleElement.innerHTML = `<img src="${content}" alt="图片消息">`;
                } else if (textMatch) {
                    bubbleElement = document.createElement('div');
                    bubbleElement.className = `message-bubble ${isSent ? 'sent' : 'received'}`;
                    let userText = textMatch[1].trim().replace(/\[发送时间:.*?\]/g, '').trim();
                    bubbleElement.innerHTML = DOMPurify.sanitize(userText);
                    if (!chat.useCustomBubbleCss) {
                        bubbleElement.style.backgroundColor = bubbleTheme.bg;
                        bubbleElement.style.color = bubbleTheme.text;
                    }
                } else if (message && Array.isArray(message.parts) && message.parts[0].type === 'html') {
                    bubbleElement = document.createElement('div');
                    bubbleElement.className = `message-bubble ${isSent ? 'sent' : 'received'}`;
                    bubbleElement.innerHTML = DOMPurify.sanitize(message.parts[0].text, { ADD_TAGS: ['style'], ADD_ATTR: ['style'] });
                } else {
                    bubbleElement = document.createElement('div');
                    bubbleElement.className = `message-bubble ${isSent ? 'sent' : 'received'}`;
                    let displayedContent = content;
                    const plainTextMatch = content.match(/^\[.*?：([\s\S]*)\]$/);
                    if (plainTextMatch && plainTextMatch[1]) {
                        displayedContent = plainTextMatch[1].trim();
                    }
                    displayedContent = displayedContent.replace(/\[发送时间:.*?\]/g, '').trim();
                    bubbleElement.innerHTML = DOMPurify.sanitize(displayedContent);
                    if (!chat.useCustomBubbleCss) {
                        bubbleElement.style.backgroundColor = bubbleTheme.bg;
                        bubbleElement.style.color = bubbleTheme.text;
                    }
                }
                    // 1. 创建头像元素
    const avatarImg = document.createElement('img');
    avatarImg.src = avatarUrl;
    avatarImg.className = 'message-avatar';
    
    // 2. 创建内容列容器 (用于垂直排列：昵称/时间 + 气泡)
    const contentCol = document.createElement('div');
    contentCol.className = 'message-content-col';

    // 3. 创建元数据行 (身份标签 + 昵称 + 时间)
    const metaRow = document.createElement('div');
    metaRow.className = 'message-meta-info';

    // 仅在群聊模式下显示身份和昵称
    if (currentChatType === 'group') {
        let displayName = '';
        let roleText = '';
        let roleClass = '';

        if (isSent) {
            // --- 情况 A: 我发送的消息 (强制为群主) ---
            // 获取我的显示名称 (优先群昵称 > 昵称 > 实名 > '我')
            displayName = chat.me.groupNickname || chat.me.nickname || chat.me.realName || '我';
            
            roleText = '群主';
            roleClass = 'owner'; // 金色样式类名
        } else {
            // --- 情况 B: 别人发送的消息 (强制为群成员) ---
            displayName = senderNickname || '未知成员';
            
            roleText = '群成员';
            roleClass = 'member'; // 绿色样式类名
        }

        // A. 创建身份标签 (放在最前面 = 左侧)
        const roleBadge = document.createElement('span');
        roleBadge.className = `role-badge ${roleClass}`;
        roleBadge.textContent = roleText;
        metaRow.appendChild(roleBadge);

        // B. 创建昵称 (放在标签后面 = 右侧)
        const nameSpan = document.createElement('span');
        nameSpan.className = 'group-nickname';
        nameSpan.textContent = displayName;
        metaRow.appendChild(nameSpan);
    

    // C. 添加时间 (可选项，放在最后)
    const timeSpan = document.createElement('span');
    timeSpan.className = 'message-time';
    timeSpan.textContent = timeString;
    metaRow.appendChild(timeSpan);

    // 4. 组装内容列
    contentCol.appendChild(metaRow);
    }
    
    if (bubbleElement) {
        // 处理引用消息 (保持原有逻辑)
        if (quote) {
            let quotedSenderName = '';
                        if (quote.senderId === 'user_me') {
                            quotedSenderName = (currentChatType === 'private') ? chat.myNickname : chat.me.nickname;
                        } else {
                            if (currentChatType === 'private') {
                                quotedSenderName = chat.remarkName;
                            } else {
                                const sender = chat.members.find(m => m.id === quote.senderId);
                                quotedSenderName = sender ? sender.groupNickname : '未知成员';
                            }
                        }
                        const quoteDiv = document.createElement('div');
                        quoteDiv.className = 'quoted-message';
                        const sanitizedQuotedText = DOMPurify.sanitize(quote.content, { ALLOWED_TAGS: [] });
                        quoteDiv.innerHTML = `<span class="quoted-sender">${quotedSenderName}：</span><p class="quoted-text">${sanitizedQuotedText}</p>`;
                        bubbleElement.prepend(quoteDiv);
                    }
        contentCol.appendChild(bubbleElement);
    }

    // 5. 最终组装 bubbleRow
    // 注意：CSS 的 row-reverse 会自动处理左右顺序，所以这里统一顺序：头像 + 内容
    bubbleRow.innerHTML = ''; // 清空可能存在的旧内容
    
    // 只有在 flex-direction: row (接收) 时，头像是第一个
    // 在 flex-direction: row-reverse (发送) 时，CSS会把第一个元素(头像)放到最右边
    bubbleRow.appendChild(avatarImg);
    bubbleRow.appendChild(contentCol);

    wrapper.prepend(bubbleRow);
    return wrapper;
            }


            async function addMessageBubble(message, targetChatId, targetChatType) {
                // If the target chat is not the current chat, show a toast notification and do nothing else.
                if (targetChatId !== currentChatId || targetChatType !== currentChatType) {
                    const senderChat = (targetChatType === 'private')
                        ? db.characters.find(c => c.id === targetChatId)
                        : db.groups.find(g => g.id === targetChatId);

                    if (senderChat) {
                        // --- 从这里开始是新增的代码 ---
                        // 如果消息不是系统内部不可见的消息，才增加未读计数
                        const invisibleRegex = /\[system:.*?\]|\[.*?更新状态为：.*?\]|\[.*?已接收礼物\]|\[.*?(?:接收|退回).*?的转账\]/;
                        if (!invisibleRegex.test(message.content)) {
                            senderChat.unreadCount = (senderChat.unreadCount || 0) + 1;
                            saveData(); // 保存数据
                            renderChatList(); // 重新渲染列表以显示红点
                        }
                        // --- 新增代码结束 ---

                        let senderName, senderAvatar;
                        if (targetChatType === 'private') {
                            senderName = senderChat.remarkName;
                            senderAvatar = senderChat.avatar;
                        } else { // Group chat
                            const sender = senderChat.members.find(m => m.id === message.senderId);
                            if (sender) {
                                senderName = sender.groupNickname;
                                senderAvatar = sender.avatar;
                            } else { // Fallback for unknown sender (e.g. system message in group)
                                senderName = senderChat.name;
                                senderAvatar = senderChat.avatar;
                            }
                        }

                        let previewText = message.content;

                        // Extract clean text for preview
                        const textMatch = previewText.match(/\[.*?的消息：([\s\S]+?)\]/);
                        if (textMatch) {
                            previewText = textMatch[1];
                        } else {
                            // Handle other message types for preview
                            if (/\[.*?的表情包：.*?\]/.test(previewText)) previewText = '[表情包]';
                            else if (/\[.*?的语音：.*?\]/.test(previewText)) previewText = '[语音]';
                            else if (/\[.*?发来的照片\/视频：.*?\]/.test(previewText)) previewText = '[照片/视频]';
                            else if (/\[.*?的转账：.*?\]/.test(previewText)) previewText = '[转账]';
                            else if (/\[.*?送来的礼物：.*?\]/.test(previewText)) previewText = '[礼物]';
                            else if (/\[.*?发来了一张图片：\]/.test(previewText)) previewText = '[图片]';
                            else if (message.parts && message.parts.some(p => p.type === 'html')) previewText = '[互动]';
                        }

                        showToast({
                            avatar: senderAvatar,
                            name: senderName,
                            message: previewText.substring(0, 30)
                        });
                    }
                    return; // IMPORTANT: Stop further execution
                }

                // --- Original logic for when the chat is active ---
                if (currentChatType === 'private') {
                    const character = db.characters.find(c => c.id === currentChatId);
                    const updateStatusRegex = new RegExp(`\\[${character.realName}更新状态为：(.*?)\\]`);
                    const transferActionRegex = new RegExp(`\\[${character.realName}(接收|退回)${character.myName}的转账\\]`);
                    const giftReceivedRegex = new RegExp(`\\[${character.realName}已接收礼物\\]`);

                    if (message.content.match(updateStatusRegex)) {
                        character.status = message.content.match(updateStatusRegex)[1];
                        chatRoomStatusText.textContent = character.status;
                        await dexieDB.groups.put(group);
                        return;
                    }
                    if (message.content.match(giftReceivedRegex) && message.role === 'assistant') {
                        const lastPendingGiftIndex = character.history.slice().reverse().findIndex(m => m.role === 'user' && m.content.includes('送来的礼物：') && m.giftStatus !== 'received');
                        if (lastPendingGiftIndex !== -1) {
                            const actualIndex = character.history.length - 1 - lastPendingGiftIndex;
                            const giftMsg = character.history[actualIndex];
                            giftMsg.giftStatus = 'received';
                            const giftCardOnScreen = messageArea.querySelector(`.message-wrapper[data-id="${giftMsg.id}"] .gift-card`);
                            if (giftCardOnScreen) {
                                giftCardOnScreen.classList.add('received');
                            }
                            await dexieDB.groups.put(group);
                        }
                        return;
                    }
                    if (message.content.match(transferActionRegex) && message.role === 'assistant') {
                        const action = message.content.match(transferActionRegex)[1];
                        const statusToSet = action === '接收' ? 'received' : 'returned';
                        const lastPendingTransferIndex = character.history.slice().reverse().findIndex(m => m.role === 'user' && m.content.includes('给你转账：') && m.transferStatus === 'pending');
                        if (lastPendingTransferIndex !== -1) {
                            const actualIndex = character.history.length - 1 - lastPendingTransferIndex;
                            const transferMsg = character.history[actualIndex];
                            transferMsg.transferStatus = statusToSet;
                            const transferCardOnScreen = messageArea.querySelector(`.message-wrapper[data-id="${transferMsg.id}"] .transfer-card`);
                            if (transferCardOnScreen) {
                                transferCardOnScreen.classList.remove('received', 'returned');
                                transferCardOnScreen.classList.add(statusToSet);
                                const statusElem = transferCardOnScreen.querySelector('.transfer-status');
                                if (statusElem) statusElem.textContent = statusToSet === 'received' ? '已收款' : '已退回';
                            }
                            await dexieDB.groups.put(group);
                        }
                    } else {
                        const bubbleElement = createMessageBubbleElement(message);
                        if (bubbleElement) {
                            
 bubbleElement.classList.add('new-message-anim');                           messageArea.appendChild(bubbleElement);
                                    // B. 【核心修复】强制开启平滑滚动，覆盖掉进入房间时的 'auto'
        messageArea.style.scrollBehavior = 'smooth';
        

        requestAnimationFrame(() => {
            messageArea.scrollTop = messageArea.scrollHeight;
        });
                        }
                    }
                } else { // For group chats
                    const bubbleElement = createMessageBubbleElement(message);
                    if (bubbleElement) {
   bubbleElement.classList.add('new-message-anim');                     
                        messageArea.appendChild(bubbleElement);
                                // C. 执行滚动
        // C. 执行滚动
        requestAnimationFrame(() => {
            messageArea.scrollTop = messageArea.scrollHeight;
        });
                    }
                }
            }

/**
 * 核心逻辑：处理时间流逝感知
 * 在任何用户动作（发消息、发图、发语音、system-display）之前调用
 */
// --- 找到这个函数并完全替换 ---
async function processTimePerception(chat, chatId, chatType) {
    // 0. 检查功能开关
    if (!db.apiSettings || !db.apiSettings.timePerceptionEnabled) return;

    const now = new Date();
    
    // 1. 【核心修改】从 history 倒序查找最后一条【真正的】用户消息
    let lastUserMsg = null;
    
    if (chat.history && chat.history.length > 0) {
        for (let i = chat.history.length - 1; i >= 0; i--) {
            const msg = chat.history[i];
            
            // --- 筛选条件升级 ---
            // 1. 角色必须是 user
            if (msg.role === 'user') {
                
                // 2. 排除 ID 包含 'msg_context_timesense' 的（这是自动生成的隐藏时间提示）
                const isTimeSense = msg.id && msg.id.includes('msg_context_timesense');
                
                // 3. 【新增】排除 ID 包含 'msg_ins_' 的（这是切换线下/线上模式的指令）
                // 在 setupOfflineModeLogic 中，我们定义的ID是 msg_ins_off_xxx 和 msg_ins_on_xxx
                const isModeInstruction = msg.id && msg.id.includes('msg_ins_');

                // 4. 【新增】排除内容以 [system: 开头的（这是单纯的指令，不算互动）
                // 这样如果你手动发送 [system:忽略我] 也不会重置时间
                const isSystemCommand = msg.content.trim().startsWith('[system:');

                // 只有当它既不是时间提示，也不是模式指令，也不是系统命令时，才算作“用户的互动”
                if (!isTimeSense && !isModeInstruction && !isSystemCommand) {
                    lastUserMsg = msg;
                    break; // 找到了最近的一条有效互动，停止寻找
                }
            }
        }
    }

    // 2. 如果整个历史里都没有有效用户发言，说明是第一次，直接返回
    if (!lastUserMsg) return;

    // 3. 计算时间差
    const timeGap = now.getTime() - lastUserMsg.timestamp;
    const thirtyMinutes = 30 * 60 * 1000; // 阈值：30分钟

    // 4. 如果超过阈值，插入感知消息
    if (timeGap > thirtyMinutes) {
        // A. 创建对用户可见的提示
        const displayContent = `[system-display:距离上次互动已经过去 ${formatTimeGap(timeGap)}]`;
        const visualMessage = {
            id: `msg_visual_timesense_${Date.now()}`,
            role: 'system',
            content: displayContent,
            parts: [],
            // 存盘时间设为当前，但在逻辑上它属于“现在”这个动作的前置
            timestamp: now.getTime() - 2 
        };

        // B. 创建给 AI 看的情景通知
        const contextContent = `[系统情景通知：与用户的上一次互动发生在${formatTimeGap(timeGap)}前。当前时刻是${getFormattedTimestamp(now)}。用户刚才打破了沉默，请注意时间流逝带来的情境变化。]`;
        const contextMessage = {
            id: `msg_context_timesense_${Date.now()}`, 
            role: 'user', 
            content: contextContent,
            parts: [{ type: 'text', text: contextContent }],
            timestamp: now.getTime() - 1 
        };

        // C. 群聊处理
        if (chatType === 'group') {
            visualMessage.senderId = 'user_me';
            contextMessage.senderId = 'user_me';
        }

        // D. 存入历史并渲染
        chat.history.push(visualMessage, contextMessage);
        addMessageBubble(visualMessage, chatId, chatType);
    }
}



            async function sendMessage() {
                const text = messageInput.value.trim();
                if (!text || isGenerating) return;
                if (currentPage > 1) {
        currentPage = 1;
        // 重新渲染整个页面为最新状态，或者您可以选择仅提示用户
        renderMessages(false, true); 
    }
                
                const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);

// 这行代码确保了“时间流逝提示”永远出现在“你的新消息”上方
    await processTimePerception(chat, currentChatId, currentChatType);
    // -----------------------------------------------------
    messageInput.value = ''; // Clear input immediately for better UX

                let messageContent;
                const systemRegex = /\[system:.*?\]|\[system-display:.*?\]/;
                const inviteRegex = /\[.*?邀请.*?加入群聊\]/;
                const renameRegex = /\[(.*?)修改群名为“(.*?)”\]/;
                const myName = (currentChatType === 'private') ? chat.myName : chat.me.realName;

                if (renameRegex.test(text)) {
                    const match = text.match(renameRegex);
                    chat.name = match[2];
                    chatRoomTitle.textContent = chat.name;
                    messageContent = `[${chat.me.nickname}修改群名为“${chat.name}”]`;
                } else if (systemRegex.test(text) || inviteRegex.test(text)) {
                    messageContent = text;
                } else {
                    let userText = text;

                    messageContent = `[${myName}的消息：${userText}]`;
                }

                const message = {
                    id: `msg_${Date.now()}`,
                    role: 'user',
                    content: messageContent,
                    parts: [{ type: 'text', text: messageContent }],
                    timestamp: Date.now()
                };

                // 新增：附加引用信息
                if (currentQuoteInfo) {
                    message.quote = {
                        messageId: currentQuoteInfo.id,
                        senderId: currentQuoteInfo.senderId, // 存储senderId用于查找昵称
                        content: currentQuoteInfo.content
                    };
                }

                if (currentChatType === 'group') {
                    message.senderId = 'user_me';
                }
                chat.history.push(message);
                addMessageBubble(message, currentChatId, currentChatType);

                if (chat.history.length > 0 && chat.history.length % 100 === 0) {
                    promptForBackupIfNeeded('history_milestone');
                }

                await saveData();
                renderChatList();

                // 新增：发送后清空引用状态
                if (currentQuoteInfo) {
                    cancelQuoteReply();
                }
            }
            
            // --- 新增：撤回消息函数 ---
 // --- 找到这个函数 ---
async function withdrawMessage(messageId) {
    const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
    if (!chat) return;

    const messageIndex = chat.history.findIndex(m => m.id === messageId);
    if (messageIndex === -1) return;

    const message = chat.history[messageIndex];
    const messageTime = message.timestamp;
    const now = Date.now();

    if (now - messageTime > 2 * 60 * 1000) {
        showToast('超过2分钟的消息无法撤回');
        return;
    }

    // 更新数据模型
    message.isWithdrawn = true;

    // 提取干净的原始内容用于AI上下文和UI的“重新编辑”
    const cleanContentMatch = message.content.match(/\[.*?的消息：([\s\S]+?)\]/);
    const cleanOriginalContent = cleanContentMatch ? cleanContentMatch[1] : message.content;
    message.originalContent = cleanOriginalContent; // 保存干净的原始内容

    // 获取当前用户的昵称
    const myName = (currentChatType === 'private') ? chat.myName : chat.me.realName;

    // 为AI生成新的、可理解的上下文消息
    const newContent = `[${myName} 撤回了一条消息：${cleanOriginalContent}]`; // 定义新内容变量
    
    message.content = newContent; // 1. 更新 content

    // ==========================================
    // 【核心修复】同步更新 parts
    // 这样 getAiReply 读取 parts 时才能看到撤回提示
    // ==========================================
    if (message.parts) {
        message.parts = [{ type: 'text', text: newContent }];
    }

    // 保存数据
    await saveData();

    // 重新渲染
    currentPage = 1;
    renderMessages(false, true);
    renderChatList();
    showToast('消息已撤回');
}

            // 辅助函数1：格式化时间戳 YYYY-MM-DD HH:MM:SS
            function getFormattedTimestamp(date) {
                const Y = date.getFullYear();
                const M = String(date.getMonth() + 1).padStart(2, '0');
                const D = String(date.getDate()).padStart(2, '0');
                const h = String(date.getHours()).padStart(2, '0');
                const m = String(date.getMinutes()).padStart(2, '0');
                const s = String(date.getSeconds()).padStart(2, '0');
                return `${Y}-${M}-${D} ${h}:${m}:${s}`;
            }

            // 辅助函数2：格式化时间差
            function formatTimeGap(milliseconds) {
                const seconds = Math.floor(milliseconds / 1000);
                const minutes = Math.floor(seconds / 60);
                const hours = Math.floor(minutes / 60);
                const days = Math.floor(hours / 24); if (days > 0) return `${days}天${hours % 24}小时`;
                if (hours > 0) return `${hours}小时${minutes % 60}分钟`;
                if (minutes > 0) return `${minutes}分钟`;
                return `${seconds}秒`;
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
                await saveData();
                renderChatList();
            }

            async function sendSticker(sticker) {
                const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
                const myName = (currentChatType === 'private') ? chat.myName : chat.me.realName;
                await processTimePerception(chat, currentChatId, currentChatType);
                const messageContentForAI = `[${myName}的表情包：${sticker.name}]`;
                const message = {
                    id: `msg_${Date.now()}`,
                    role: 'user',
                    content: messageContentForAI,
                    parts: [{ type: 'text', text: messageContentForAI }],
                    timestamp: Date.now(),
                    stickerData: sticker.data
                };
                if (currentChatType === 'group') {
                    message.senderId = 'user_me';
                }
                chat.history.push(message);
                addMessageBubble(message, currentChatId, currentChatType);
                await saveData();
                renderChatList();
                stickerModal.classList.remove('visible');
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
                await saveData();
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
                await saveData();
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
                } else { // Group chat
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
                        }
                    });
                }
                await saveData();
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
                } else { // Group chat
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
                        }
                    });
                }
                await saveData();
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
    await saveData();
    // renderChatList(); // 不需要调用
}

            // --- 线下模式 ---
            const offlineModeModal = document.getElementById('offline-mode-modal');
            const offlineModeForm = document.getElementById('offline-mode-form');
            const offlineModeToggle = document.getElementById('offline-mode-toggle');
            const offlineNarrationCssInput = document.getElementById('offline-narration-css');
            const cancelOfflineModeBtn = document.getElementById('cancel-offline-mode-btn');

            function setupOfflineModeLogic() {
                // 初始化监听器
                cancelOfflineModeBtn.addEventListener('click', () => {
                    offlineModeModal.classList.remove('visible');
                });

                offlineModeModal.addEventListener('click', (e) => {
                    if (e.target === offlineModeModal) offlineModeModal.classList.remove('visible');
                });

                offlineModeForm.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    if (currentChatType !== 'private') {
                        showToast('线下模式仅支持单人聊天');
                        return;
                    }

                    const chat = db.characters.find(c => c.id === currentChatId);
                    if (!chat) return;

                    const wasEnabled = chat.offlineModeEnabled;
                    const isNowEnabled = offlineModeToggle.checked;

                    // 更新数据
                    chat.offlineModeEnabled = isNowEnabled;
                    chat.offlineNarrationCss = offlineNarrationCssInput.value;

                    const now = Date.now();

                    // =======================================================
                    // 情况 1: 退出线下模式
                    // =======================================================
                    if (wasEnabled && !isNowEnabled) {
                        // 1. 指令消息 (isHidden: true -> 用户不看，AI看)
                        const endInstruction = `[system: 面对面情节结束。切换回手机聊天模式。恢复使用 [${chat.realName}的消息：...] 格式。]`;
                        const instructionMsg = {
                            id: `msg_ins_off_${now}`,
                            role: 'user', 
                            content: endInstruction,
                            parts: [{ type: 'text', text: endInstruction }],
                            timestamp: now,
                            isHidden: true // 🚩 只有 AI 能看到
                        };
                        chat.history.push(instructionMsg);

                        // 2. 展示消息 (isAiIgnore: true -> 用户看，AI不看)
                        const displayMsg = {
                            id: `msg_vis_off_${now}`,
                            role: 'system',
                            content: `[system-display: 已退出线下模式]`,
                            parts: [],
                            timestamp: now + 1,
                            isAiIgnore: true // 🚩 只有用户能看到 (AI 忽略)
                        };
                        chat.history.push(displayMsg);
                        addMessageBubble(displayMsg, currentChatId, currentChatType);
                    }
                    // =======================================================
                    // 情况 2: 进入线下模式
                    // =======================================================
                    else if (!wasEnabled && isNowEnabled) {
                        // 1. 指令消息 (用户不看，AI看)
                        const startInstruction = `[system: 场景切换：从现在开始，${chat.realName}与用户进行【面对面】互动。请根据人设直接描写动作和语言。]`;
                        const instructionMsg = {
                            id: `msg_ins_on_${now}`,
                            role: 'user', 
                            content: startInstruction,
                            parts: [{ type: 'text', text: startInstruction }],
                            timestamp: now,
                            isHidden: true // 🚩 只有 AI 能看到
                        };
                        chat.history.push(instructionMsg);

                        // 2. 展示消息 (用户看，AI不看)
                        const displayMsg = {
                            id: `msg_vis_on_${now}`,
                            role: 'system',
                            content: `[system-display: 已开启线下模式]`,
                            parts: [],
                            timestamp: now + 1,
                            isAiIgnore: true // 🚩 只有用户能看到 (AI 忽略)
                        };
                        chat.history.push(displayMsg);
                        addMessageBubble(displayMsg, currentChatId, currentChatType);
                    }

                    await saveData();

                    applyOfflineNarrationCss(chat.id, chat.offlineNarrationCss);
                    updateOfflineModeUI(chat.offlineModeEnabled);
                    
                    const offlineBtn = document.querySelector('.expansion-item[data-action="offline-mode-settings"]');
                    if (offlineBtn) {
                        if (chat.offlineModeEnabled) offlineBtn.classList.add('active');
                        else offlineBtn.classList.remove('active');
                    }

                    offlineModeModal.classList.remove('visible');
                    showToast(chat.offlineModeEnabled ? '线下模式已开启' : '线下模式已关闭');
                });
            }

            function openOfflineModeSettings() {
                if (currentChatType !== 'private') {
                    showToast('线下模式仅支持单人聊天');
                    return;
                }
                const chat = db.characters.find(c => c.id === currentChatId);

                // 填充表单
                offlineModeToggle.checked = !!chat.offlineModeEnabled;
                offlineNarrationCssInput.value = chat.offlineNarrationCss || '';

                offlineModeModal.classList.add('visible');
            }

            function applyOfflineNarrationCss(chatId, css) {
                const styleId = `offline-narration-style-${chatId}`;
                let styleElement = document.getElementById(styleId);

                if (css && css.trim()) {
                    if (!styleElement) {
                        styleElement = document.createElement('style');
                        styleElement.id = styleId;
                        document.head.appendChild(styleElement);
                    }
                    // 限制作用域在当前聊天室
                    const scopedCss = `#chat-room-screen.chat-active-${chatId} ${css}`;
                    styleElement.textContent = scopedCss;
                } else {
                    if (styleElement) styleElement.remove();
                }
            }


            // 统一控制线下模式的 UI 状态（按钮禁用 + 状态灯颜色）
            function updateOfflineModeUI(isOffline) {
                // 1. 处理顶部状态灯 (Requirement 4)
                const indicator = document.querySelector('.online-indicator');
                if (indicator) {
                    // 线下模式为粉色(#FF69B4)，线上模式恢复默认绿色(var(--online-status-color))
                    indicator.style.backgroundColor = isOffline ? 'var(--primary-color)' : 'var(--online-status-color)';

                }

                // 2. 处理 Sticker Bar 按钮 (Requirement 3)
                // 需要禁用的按钮 ID 列表
                const buttonsToDisable = [
                    'voice-message-btn',       // 语音
                    'photo-video-btn',         // 照片/视频
                    'image-recognition-btn',   // 发送图片/识图
                    'sticker-toggle-btn',       // 表情包
                    'wallet-btn'               // --- 新增：转账/钱包按钮 ---
                ];

                buttonsToDisable.forEach(btnId => {
                    const btn = document.getElementById(btnId);
                    if (btn) {
                        btn.disabled = isOffline; // true则禁用，false则启用
                        // 禁用时禁止点击事件，防止触发 ripple 动画或弹窗
                        btn.style.pointerEvents = isOffline ? 'none' : 'auto';
                    }
                });
            }

            // --- NEW: Chat Expansion Panel ---
            function setupChatExpansionPanel() {
                const expansionGrid = document.getElementById('chat-expansion-grid');
                const expansionItems = [
                    {
                        id: 'memory-journal',
                        name: '记忆档案',
                        icon: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
  <path fill-rule="evenodd" d="
    M4,0 h16 a2,2 0 0 1 2,2 v20 a2,2 0 0 1 -2,2 H4 a2,2 0 0 1 -2,-2 V2 a2,2 0 0 1 2,-2 z

    M9,3 h10 a1,1 0 0 1 1,1 v16 a1,1 0 0 1 -1,1 H9 a1,1 0 0 1 -1,-1 V4 a1,1 0 0 1 1,-1 z

    M3,6 h4 a0.5,0.5 0 0 1 0.5,0.5 v0 a0.5,0.5 0 0 1 -0.5,0.5 H3 a0.5,0.5 0 0 1 -0.5,-0.5 v0 a0.5,0.5 0 0 1 0.5,-0.5 z

    M3,17 h4 a0.5,0.5 0 0 1 0.5,0.5 v0 a0.5,0.5 0 0 1 -0.5,0.5 H3 a0.5,0.5 0 0 1 -0.5,-0.5 v0 a0.5,0.5 0 0 1 0.5,-0.5 z

    M14,10 c-0.8-0.8-2.1-0.6-2.5,0.5 c-0.4,1.1 1.4,2.6 2.5,3.1 c1.1-0.5 2.9-2 2.5-3.1 C16.1,9.4 14.8,9.2 14,10 z
  "/>
</svg>`
                    },

                    {
                        id: 'send-gift-modal',
                        name: '赠送礼物',
                        icon: `<svg viewBox="0 0 24 24"><path d="M22,12V20A2,2 0 0,1 20,22H4A2,2 0 0,1 2,20V12A1,1 0 0,1 1,11V8A2,2 0 0,1 3,6H6.17C6.06,5.69 6,5.35 6,5A3,3 0 0,1 9,2C10,2 10.88,2.5 11.43,3.24V3.23L12,4L12.57,3.23V3.24C13.12,2.5 14,2 15,2A3,3 0 0,1 18,5C18,5.35 17.94,5.69 17.83,6H21A2,2 0 0,1 23,8V11A1,1 0 0,1 22,12M4,20H11V12H4V20M20,20V12H13V20H20M9,4A1,1 0 0,0 8,5A1,1 0 0,0 9,6A1,1 0 0,0 10,5A1,1 0 0,0 9,4M15,4A1,1 0 0,0 14,5A1,1 0 0,0 15,6A1,1 0 0,0 16,5A1,1 0 0,0 15,4M3,8V10H11V8H3M13,8V10H21V8H13Z" /></svg>`
                    },
                    {
                        id: 'time-skip-modal',
                        name: '剧情旁白',
                        icon: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M2.5 7.25C2.08579 7.25 1.75 7.58579 1.75 8C1.75 8.41421 2.08579 8.75 2.5 8.75V7.25ZM22 7.25H2.5V8.75H22V7.25Z" fill="#555" stroke="#555"/>
<path d="M10.5 2.5L7 8M17 2.5L13.5 8" stroke="#555" stroke-width="2" fill="none" stroke-linecap="round"/>
<path d="M15 14.5C15 13.8666 14.338 13.4395 13.014 12.5852C11.6719 11.7193 11.0008 11.2863 10.5004 11.6042C10 11.9221 10 12.7814 10 14.5C10 16.2186 10 17.0779 10.5004 17.3958C11.0008 17.7137 11.6719 17.2807 13.014 16.4148C14.338 15.5605 15 15.1334 15 14.5Z" stroke="#555" stroke-width="2" fill="none" stroke-linecap="round"/>
<path d="M22 12C22 16.714 22 19.0711 20.5355 20.5355C19.0711 22 16.714 22 12 22C7.28595 22 4.92893 22 3.46447 20.5355C2 19.0711 2 16.714 2 12C2 7.28595 2 4.92893 3.46447 3.46447C4.92893 2 7.28595 2 12 2C16.714 2 19.0711 2 20.5355 3.46447C21.5093 4.43821 21.8356 5.80655 21.9449 8" stroke="#555" stroke-width="2" fill="none" stroke-linecap="round"/>
</svg>`
                    },
                    {
                        id: 'offline-mode-settings',
                        name: '线下模式',
                        icon: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path fill-rule="evenodd" clip-rule="evenodd" d="M16 6C14.3432 6 13 7.34315 13 9C13 10.6569 14.3432 12 16 12C17.6569 12 19 10.6569 19 9C19 7.34315 17.6569 6 16 6ZM11 9C11 6.23858 13.2386 4 16 4C18.7614 4 21 6.23858 21 9C21 10.3193 20.489 11.5193 19.6542 12.4128C21.4951 13.0124 22.9176 14.1993 23.8264 15.5329C24.1374 15.9893 24.0195 16.6114 23.5631 16.9224C23.1068 17.2334 22.4846 17.1155 22.1736 16.6591C21.1979 15.2273 19.4178 14 17 14C13.166 14 11 17.0742 11 19C11 19.5523 10.5523 20 10 20C9.44773 20 9.00001 19.5523 9.00001 19C9.00001 18.308 9.15848 17.57 9.46082 16.8425C9.38379 16.7931 9.3123 16.7323 9.24889 16.6602C8.42804 15.7262 7.15417 15 5.50001 15C3.84585 15 2.57199 15.7262 1.75114 16.6602C1.38655 17.075 0.754692 17.1157 0.339855 16.7511C-0.0749807 16.3865 -0.115709 15.7547 0.248886 15.3398C0.809035 14.7025 1.51784 14.1364 2.35725 13.7207C1.51989 12.9035 1.00001 11.7625 1.00001 10.5C1.00001 8.01472 3.01473 6 5.50001 6C7.98529 6 10 8.01472 10 10.5C10 11.7625 9.48013 12.9035 8.64278 13.7207C9.36518 14.0785 9.99085 14.5476 10.5083 15.0777C11.152 14.2659 11.9886 13.5382 12.9922 12.9945C11.7822 12.0819 11 10.6323 11 9ZM3.00001 10.5C3.00001 9.11929 4.1193 8 5.50001 8C6.88072 8 8.00001 9.11929 8.00001 10.5C8.00001 11.8807 6.88072 13 5.50001 13C4.1193 13 3.00001 11.8807 3.00001 10.5Z"/></svg>`
                    },
                    {
            id: 'chat-search', // 这里的 ID 对应下面的 case
            name: '聊天搜索',
            icon: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path
                            d="M15.7955 15.8111L21 21M18 10.5C18 14.6421 14.6421 18 10.5 18C6.35786 18 3 14.6421 3 10.5C3 6.35786 6.35786 3 10.5 3C14.6421 3 18 6.35786 18 10.5Z"
                            stroke="#555" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none" />
                    </svg>`
        },
                    {
                        id: 'delete-history-chunk',
                        name: '批量删除',
                        icon: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M19 7L18.1327 19.1425C18.0579 20.1891 17.187 21 16.1378 21H7.86224C6.81296 21 5.94208 20.1891 5.86732 19.1425L5 7M10 11V17M14 11V17M15 7V4C15 3.44772 14.5523 3 14 3H10C9.44772 3 9 3.44772 9 4V7M4 7H20" stroke="#555" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
            </svg>`
                    }
                ];

                // 在渲染 expansionGrid 时，检查当前角色是否开启了线下模式，如果是，给按钮加 active 样式
                expansionGrid.innerHTML = '';
                expansionItems.forEach(item => {
                    const itemEl = document.createElement('div');
                    itemEl.className = 'expansion-item';
                    itemEl.dataset.action = item.id;

                    // --- 新增：检查激活状态 ---
                    if (item.id === 'offline-mode-settings' && currentChatType === 'private') {
                        const chat = db.characters.find(c => c.id === currentChatId);
                        if (chat && chat.offlineModeEnabled) {
                            itemEl.classList.add('active');
                        }
                    }
                    itemEl.innerHTML = `
                    <div class="expansion-item-icon">${item.icon}</div>
                    <span class="expansion-item-name">${item.name}</span>
                `;
                    expansionGrid.appendChild(itemEl);
                });

                expansionGrid.addEventListener('click', (e) => {
                    const item = e.target.closest('.expansion-item');
                    if (!item) return;

                    const action = item.dataset.action;

switch (action) {
    case 'memory-journal':
        // 1. 重置主 Tab 为“剧情总结”
        currentMemoryTab = 'summary';
        
        // 2. 【关键】重置子 Tab 为“短期总结”，防止之前卡在长期总结页面
        currentSummarySubTab = 'short';
        
    // 3. 更新 Tab 按钮样式
    const allTabs = document.querySelectorAll('.mem-tab-btn');
    const journalTab = document.querySelector('.mem-tab-btn[data-tab="journal"]');
        allTabs.forEach(t => {
        if (t.dataset.tab === 'summary') t.classList.add('active');
        else t.classList.remove('active');
         // 重置状态
        t.style.opacity = '1';
        t.style.pointerEvents = 'auto';
        t.style.cursor = 'pointer';
    });
        // 【新增】如果是群聊，禁用日记 Tab
    if (currentChatType === 'group' && journalTab) {
        journalTab.style.opacity = '0.5';
        journalTab.style.pointerEvents = 'none';
        journalTab.style.cursor = 'not-allowed';
    }       

        // 4. 更新侧边栏样式
        const sidebarItems = document.querySelectorAll('.summary-sidebar-item');
        sidebarItems.forEach(item => {
             if (item.dataset.sub === 'short') item.classList.add('active');
             else item.classList.remove('active');
        });
        
        // 5. 显示侧边栏（因为是summary tab）
        const sidebar = document.getElementById('summary-sidebar');
        if(sidebar) sidebar.classList.remove('hidden');

        // 6. 渲染并跳转
        renderMemoryScreen();
        switchScreen('memory-journal-screen');
        break;

                        case 'chat-search':
                openSearchModal(); // 调用 chat_search.js 中的函数
                break;
                        case 'delete-history-chunk':
                            openDeleteChunkModal();
                            break;
                        case 'send-gift-modal':
                            // 打开礼物框
                            if (currentChatType === 'private') {
                                sendGiftForm.reset();
                                sendGiftModal.classList.add('visible');
                            } else if (currentChatType === 'group') {
                                currentGroupAction.type = 'gift';
                                renderGroupRecipientSelectionList('送礼物给');
                                groupRecipientSelectionModal.classList.add('visible');
                            }
                            break;
                        case 'time-skip-modal':
                            // 打开跳过时间

                            timeSkipForm.reset();
                            timeSkipModal.classList.add('visible');
                            break;
                        case 'offline-mode-settings':
                            openOfflineModeSettings();
                            break;
                    }
                    // Hide panel after action
                    document.getElementById('chat-expansion-panel').classList.remove('visible');
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

                let startRange, endRange;

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
                    const messagesToDelete = chat.history.slice(startIndex, endIndex);

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
                    await saveData();

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

            function getMixedContent(responseData) {
                const results = [];
                let i = 0;

                while (i < responseData.length) {
                    const nextTagStart = responseData.indexOf('<', i);
                    const nextBracketStart = responseData.indexOf('[', i);

                    // Find the start of the next special block
                    let firstSpecialIndex = -1;
                    if (nextTagStart !== -1 && nextBracketStart !== -1) {
                        firstSpecialIndex = Math.min(nextTagStart, nextBracketStart);
                    } else {
                        firstSpecialIndex = Math.max(nextTagStart, nextBracketStart);
                    }

                    // If no special blocks left, the rest is plain text
                    if (firstSpecialIndex === -1) {
                        const text = responseData.substring(i).trim();
                        if (text) results.push({ type: 'text', content: `[unknown的消息：${text}]` });
                        break;
                    }

                    // If there's plain text before the special block, add it
                    if (firstSpecialIndex > i) {
                        const text = responseData.substring(i, firstSpecialIndex).trim();
                        if (text) results.push({ type: 'text', content: `[unknown的消息：${text}]` });
                    }

                    i = firstSpecialIndex;

                    // Process the block
                    if (responseData[i] === '<') {
                        // Potential HTML block
                        const tagMatch = responseData.substring(i).match(/^<([a-zA-Z0-9]+)/);
                        if (tagMatch) {
                            const tagName = tagMatch[1];
                            let openCount = 0;
                            let searchIndex = i;
                            let blockEnd = -1;

                            // Find the end of the outermost tag
                            while (searchIndex < responseData.length) {
                                const openTagPos = responseData.indexOf('<' + tagName, searchIndex);
                                const closeTagPos = responseData.indexOf('</' + tagName, searchIndex);

                                if (openTagPos !== -1 && (closeTagPos === -1 || openTagPos < closeTagPos)) {
                                    openCount++;
                                    searchIndex = openTagPos + 1;
                                } else if (closeTagPos !== -1) {
                                    openCount--;
                                    searchIndex = closeTagPos + 1;
                                    if (openCount === 0) {
                                        blockEnd = closeTagPos + `</${tagName}>`.length;
                                        break;
                                    }
                                } else {
                                    break; // Malformed, no closing tag
                                }
                            }

                            if (blockEnd !== -1) {
                                const htmlBlock = responseData.substring(i, blockEnd);
                                const charMatch = htmlBlock.match(/<[a-z][a-z0-9]*\s+char="([^"]*)"/i);
                                const char = charMatch ? charMatch[1] : null;
                                results.push({ type: 'html', char: char, content: htmlBlock });
                                i = blockEnd;
                                continue;
                            }
                        }
                    }

                    if (responseData[i] === '[') {
                        // Potential [...] block
                        const endBracket = responseData.indexOf(']', i);
                        if (endBracket !== -1) {
                            const text = responseData.substring(i, endBracket + 1);
                            results.push({ type: 'text', content: text });
                            i = endBracket + 1;
                            continue;
                        }
                    }

                    // If we got here, it was a false alarm (e.g., a lone '<' or '[').
                    // Treat it as plain text and move on.
                    const nextSpecial1 = responseData.indexOf('<', i + 1);
                    const nextSpecial2 = responseData.indexOf('[', i + 1);
                    let endOfText = -1;
                    if (nextSpecial1 !== -1 && nextSpecial2 !== -1) {
                        endOfText = Math.min(nextSpecial1, nextSpecial2);
                    } else {
                        endOfText = Math.max(nextSpecial1, nextSpecial2);
                    }
                    if (endOfText === -1) {
                        endOfText = responseData.length;
                    }
                    const text = responseData.substring(i, endOfText).trim();
                    if (text) results.push({ type: 'text', content: `[unknown的消息：${text}]` });
                    i = endOfText;
                }
                return results;

                // ==================================================================================================================
                // ========================================== 错误处理翻译官 (Error Translator) ==========================================
                // ==================================================================================================================

                /**
                 * 我们的“错误词典”，负责将技术性错误翻译成用户友好的提示。
                 * @param {Error} error - 捕获到的错误对象。
                 * @returns {string} - 返回一句通俗易懂的错误提示。
                 */
                function getFriendlyErrorMessage(error) {
                    // 检查 fetch 的 AbortError，这通常用于实现请求超时
                    if (error.name === 'AbortError') {
                        return '请求超时了，请检查您的网络或稍后再试。';
                    }

                    // 检查 JSON 解析错误，这对应您说的“返回格式错误”
                    if (error instanceof SyntaxError) {
                        return '服务器返回的数据格式不对，建议您点击“重回”按钮再试一次。';
                    }

                    // 检查服务器有响应、但HTTP状态码是失败的情况 (如 429, 504)
                    if (error.response) {
                        const status = error.response.status;
                        switch (status) {
                            case 429:
                                return '您点的太快啦，请稍等一下再试。';
                            case 504:
                                return '服务器有点忙，响应不过来了，请稍后再试。';
                            case 500:
                                return '服务器内部出错了，他们应该正在修复。';
                            case 401:
                                return 'API密钥好像不对或者过期了，请检查一下设置。';
                            case 404:
                                return '请求的API地址找不到了，请检查一下设置。';
                            default:
                                // 对于其他未预设的HTTP错误，给一个通用提示
                                return `服务器返回了一个错误 (代码: ${status})，请稍后再试。`;
                        }
                    }

                    // 检查通用的网络错误 (例如，断网了，fetch自己就会报TypeError)
                    if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
                        return '网络连接好像出问题了，请检查一下网络。';
                    }

                    // 对于所有其他未知错误，显示原始信息，方便排查
                    return `发生了一个未知错误：${error.message}`;
                }

                /**
                 * 统一的API错误显示函数。
                 * @param {Error} error - 捕获到的错误对象。
                 */
                function showApiError(error) {
                    // 在控制台打印详细错误，方便您自己调试
                    console.error("API Error Detected:", error);

                    // 获取翻译后的友好提示
                    const friendlyMessage = getFriendlyErrorMessage(error);

                    // 使用您项目中已有的 showToast 函数来显示提示
                    showToast(friendlyMessage);
                }

                // ==================================================================================================================
                // ========================================== END Error Translator ==================================================
                // ==================================================================================================================
            }





// 辅助函数：计算打字机延迟
function calculateTypingDelay(text, isFirstMessage) {
    const baseDelay = isFirstMessage ? 500 : 1500;
    const msPerChar = 60;
    let delay = baseDelay + (text.length * msPerChar);
    return Math.min(delay, 3000); // 最大延迟不超过3秒
}

// 主处理函数
// ============================================================
// 最终修复版：处理 AI 回复内容 (修复旁白重复嵌套问题)
// ============================================================
async function handleAiReplyContent(fullResponse, chat, targetChatId, targetChatType) {
    console.log("🟢 开始处理 AI 回复:", fullResponse.substring(0, 50) + "..."); 

    try {
        if (!fullResponse) return;

        // ============================================================
        // 🛡️ 预处理：Prompt C 格式清洗 (通用逻辑)
        // ============================================================
        let cleanResponse = fullResponse;

        // 1. 去除 Markdown 代码块标记 (```)
        cleanResponse = cleanResponse.replace(/^```\w*\s*$/gm, '');

        // 2. 分离“导演侧写”与“正文”
        const contentSplitRegex = /###\s*🎭\s*(?:正文|剧情正文|剧情).*/i;
        if (contentSplitRegex.test(cleanResponse)) {
            const parts = cleanResponse.split(contentSplitRegex);
            if (parts.length > 1) {
                console.log("🧠 AI 导演侧写 (已隐藏):", parts[0].trim());
                cleanResponse = parts[1];
            }
        } else if (cleanResponse.includes('### 🧠')) {
            console.warn("⚠️ 检测到思考过程但未找到正文标记");
        }

        cleanResponse = cleanResponse.trim();

// ============================================================
        // 分支一：线下模式 (Offline / Writer Mode)
        // ============================================================
        if (targetChatType === 'private' && chat.offlineModeEnabled) {
    
            let processed = cleanResponse;
            
            // 1. 基础清洗
            processed = processed.replace(/\r\n/g, '\n');
            processed = processed.replace(/([^\n])\s*(\[.*?[:：])/g, '$1\n$2');
            processed = processed.replace(/^```\w*\s*$/gm, '');
            processed = processed.replace(/^#+\s+.*$/gm, '');
            processed = processed.replace(/\]\s*\[/g, ']\n[');
            processed = processed.replace(/([^\n])\s*(>>>)/g, '$1\n$2');
            
            const lines = processed.split('\n');
            let isFirstLine = true;

            for (let line of lines) {
                line = line.trim();
                
                // 2. 过滤空行和垃圾
                if (!line || line === '[' || line === ']' || line === '[]' || line === '][') continue;
                
                // 3. 过滤思考过程残留
                if (/^[\d]+\.\s/.test(line)) continue;
                if (line.includes('意图：') || line.includes('情绪：') || line.includes('锚点：')) continue;
                if (line.includes('问题：') || line.includes('优点：')) continue;

                // 计算打字机延迟
                const cleanTextForCalc = line.replace('>>>', '').replace(/\[.*?\]/g, '');
                const delay = calculateTypingDelay(cleanTextForCalc, isFirstLine);
                await new Promise(r => setTimeout(r, delay));
                isFirstLine = false;

                // 4. 状态更新 (已修改：保持与线上模式一致的存档逻辑)
                const statusRegex = /\[?.*?更新状态为[:：](.*?)(?:\]|$)/;
                const statusMatch = line.match(statusRegex);
                if (statusMatch) {
                    let newStatus = statusMatch[1].trim().replace(/[\])]+$/, '').trim();
                    if (newStatus) {
                        // A. 更新内存和UI
                        chat.status = newStatus;
                        const statusTextEl = document.getElementById('chat-room-status-text');
                        if (statusTextEl) statusTextEl.textContent = chat.status;

                        // B. 【关键修改】将状态指令作为消息存入历史记录
                        // 这样 handleRegenerate 才能在回滚时找到它
                        const statusMsg = {
                            id: `msg_status_${Date.now()}_${Math.random()}`,
                            role: 'assistant',
                            content: line, // 保存原始指令，如 "[更新状态为：开心]"
                            parts: [{ type: 'text', text: line }],
                            timestamp: Date.now()
                        };
                        chat.history.push(statusMsg);

                        // C. 存完之后，跳过气泡渲染 (continue)
                        // 注意：这里选择跳过是为了保持线下模式界面的整洁（只看小说内容）。
                        // 也就是“存而不显”，这符合线下模式注重沉浸感的逻辑。
                        continue;
                    }
                }

                // 5. 内容渲染 (普通对话和旁白)
                let messageContent = "";
                
                if (line.startsWith('>>>')) {
                    // --- 对话 ---
                    let speech = line.substring(3).trim();
                    speech = speech.replace(/\]+$/, '');
                    speech = speech.replace(/^["'「『""'']+/, '').replace(/["'」』""'']+$/, '');
                    messageContent = `[${chat.realName}的消息：${speech}]`;
                } 
                else if (/^\[.*?的消息：[\s\S]+?\]$/.test(line)) {
                    // --- 标准消息格式兼容 ---
                    const match = line.match(/^\[.*?的消息：([\s\S]+?)\]$/);
                    let speech = match ? match[1] : line;
                    speech = speech.replace(/\]+$/, '');
                    speech = speech.replace(/^["'「『""'']+/, '').replace(/["'」』""'']+$/, '');
                    messageContent = `[${chat.realName}的消息：${speech}]`;
                } 
                else {           
                    // --- 旁白处理 ---
                    let rawText = line.trim();
                    // 1. 🛑 剥离 [system-narration: 标签 (防止嵌套)
                    if (rawText.includes('[system-narration:')) {
                        rawText = rawText.replace(/\[system-narration:/g, '');
                    }
                    rawText = rawText.replace(/\[.*?的消息：/g, '');

                    // 3. 去掉末尾可能残留的 "]"
                    rawText = rawText.replace(/\]+$/, '');
                    
                    if (rawText.startsWith('[system-narration:') && rawText.endsWith(']')) {
                        rawText = rawText.replace(/^\[system-narration:/, '').replace(/\]$/, '');
                    }
                    if (/^\[(user-narration|system-narration|user|model|assistant)[:：]?\s*\]?$/.test(rawText)) {
                        continue; 
                    }
                    if (rawText === '[]' || rawText === '[:]' || rawText === '()' || !rawText) {
                        continue;
                    }
                    messageContent = `[system-narration:${rawText}]`;
                }

                const message = {
                    id: `msg_${Date.now()}_${Math.random()}`,
                    role: 'assistant',
                    content: messageContent,
                    parts: [{ type: 'text', text: messageContent }],
                    timestamp: Date.now()
                };
                chat.history.push(message);
                addMessageBubble(message, targetChatId, targetChatType);
            }
        }
        // ============================================================
        // 分支二：线上模式 (Online Mode) - 保持不变
        // ============================================================
        else {
            let processedResponse = cleanResponse;
            processedResponse = processedResponse.replace(/\]\s*\[/g, ']\n[');
            processedResponse = processedResponse.replace(/([^\n>])\s*\[(?!system-narration|system-display)/g, '$1\n[');
            processedResponse = processedResponse.replace(/\]\s*([^\n<])/g, ']\n$1');

            const trimmedResponse = processedResponse.trim();
            let messages;

            if (trimmedResponse.startsWith('<') && trimmedResponse.endsWith('>')) {
                messages = [{ type: 'html', content: trimmedResponse }];
            } else {
                messages = getMixedContent(processedResponse).filter(item => item.content.trim() !== '');
            }

            let isFirstMsg = true;

            for (const item of messages) {
                let textLen = item.content.replace(/\[.*?：/g, '').replace(/\]/g, '').length;
                if (textLen < 5) textLen = 5;
                const delay = calculateTypingDelay('x'.repeat(textLen), isFirstMsg);
                await new Promise(resolve => setTimeout(resolve, delay));
                isFirstMsg = false;

                // 1. 撤回逻辑
                const aiWithdrawRegex = /\[(.*?)撤回了上一条消息：([\s\S]*?)\]/;
                const withdrawMatch = item.content.match(aiWithdrawRegex);
                if (withdrawMatch) {
                    const characterName = withdrawMatch[1];
                    const originalContent = withdrawMatch[2];
                    let lastAssistantMessageIndex = -1;
                    for (let i = chat.history.length - 1; i >= 0; i--) {
                        if (chat.history[i].role === 'assistant' && !chat.history[i].isWithdrawn) {
                            lastAssistantMessageIndex = i;
                            break;
                        }
                    }
                    if (lastAssistantMessageIndex !== -1) {
                        const messageToWithdraw = chat.history[lastAssistantMessageIndex];
                        messageToWithdraw.isWithdrawn = true;
                        const cleanContentMatch = messageToWithdraw.content.match(/\[.*?的消息：([\s\S]+?)\]/);
                        messageToWithdraw.originalContent = cleanContentMatch ? cleanContentMatch[1] : messageToWithdraw.content;
                        messageToWithdraw.content = `[system: ${characterName} withdrew a message. Original: ${originalContent}]`;
                        renderMessages(false, true);
                    }
                    continue;
                }

                // 2. 私聊逻辑
                if (targetChatType === 'private') {
                    const character = chat;
                    const standardMsgMatch = item.content.match(/\[(.*?)的消息：([\s\S]+?)\]/);
                    const aiQuoteRegex = /\[.*?引用["“](.*?)["”]并回复[:：]([\s\S]*?)\]/;
                    const aiQuoteMatch = item.content.match(aiQuoteRegex);

                    if (standardMsgMatch) {
                        // A: 标准消息
                        const contentText = standardMsgMatch[2];
                        const fixedContent = `[${character.realName}的消息：${contentText}]`;
                        const message = {
                            id: `msg_${Date.now()}_${Math.random()}`,
                            role: 'assistant',
                            content: fixedContent,
                            parts: [{ type: 'text', text: fixedContent }],
                            timestamp: Date.now(),
                        };
                        chat.history.push(message);
                        addMessageBubble(message, targetChatId, targetChatType);

                    } else if (aiQuoteMatch) {
                        // B: 引用回复
                        const quotedText = aiQuoteMatch[1];
                        const replyText = aiQuoteMatch[2];
                        const originalMessage = chat.history.slice().reverse().find(m => {
                            if (m.role === 'user') {
                                const userMessageMatch = m.content.match(/\[.*?的消息：([\s\S]+?)\]/);
                                const userMessageText = userMessageMatch ? userMessageMatch[1] : m.content;
                                return userMessageText.trim() === quotedText.trim();
                            }
                            return false;
                        });

                        const message = {
                            id: `msg_${Date.now()}_${Math.random()}`,
                            role: 'assistant',
                            content: `[${character.realName}的消息：${replyText}]`,
                            parts: [{ type: 'text', text: `[${character.realName}的消息：${replyText}]` }],
                            timestamp: Date.now(),
                        };

                        if (originalMessage) {
                            message.quote = {
                                messageId: originalMessage.id,
                                senderId: 'user_me',
                                content: quotedText
                            };
                        }
                        chat.history.push(message);
                        addMessageBubble(message, targetChatId, targetChatType);

                    } else {
                        // C: 其他
                        const receivedTransferRegex = /\[.*?的转账：.*?元；备注：.*?\]/;
                        const giftRegex = /\[.*?送来的礼物：.*?\]/;
                        
                        const message = {
                            id: `msg_${Date.now()}_${Math.random()}`,
                            role: 'assistant',
                            content: item.content.trim(),
                            parts: [{ type: item.type, text: item.content.trim() }],
                            timestamp: Date.now(),
                        };

                        if (receivedTransferRegex.test(message.content)) {
                            message.transferStatus = 'pending';
                        } else if (giftRegex.test(message.content)) {
                            message.giftStatus = 'sent';
                        }
                        chat.history.push(message);
                        addMessageBubble(message, targetChatId, targetChatType);
                    }
                } 
                // 3. 群聊逻辑
// 3. 群聊逻辑 (修复版：增加引用功能)
                else if (targetChatType === 'group') {
                    const group = chat;
                    
                    // 正则定义
                    // 1. 标准消息/媒体
                    const standardRegex = /\[(.*?)((?:的消息|的语音|的表情包|发送的表情包|发来的照片\/视频))[:：]/;
                    // 2. 引用消息 (新增)
                    const quoteRegex = /\[(.*?)引用["“](.*?)["”]并回复[:：]([\s\S]*?)\]/;

                    const quoteMatch = item.content.match(quoteRegex);
                    const standardMatch = item.content.match(standardRegex);

                    // --- 情况 A: 引用回复 ---
                    if (quoteMatch) {
                        const senderName = quoteMatch[1];
                        const quotedText = quoteMatch[2]; // 被引用的原文
                        const replyText = quoteMatch[3];  // 回复的内容

                        const sender = group.members.find(m => (m.realName === senderName || m.groupNickname === senderName));
                        
                        if (sender) {
                            // 在历史记录中查找被引用的原文 (用于获取 quote 元数据)
                            // 注意：群聊里原文可能是 user 发的，也可能是其他 assistant 发的
                            const originalMessage = group.history.slice().reverse().find(m => {
                                // 提取纯文本内容进行比对
                                let contentText = m.content;
                                const textMatch = m.content.match(/\[.*?的消息：([\s\S]+?)\]/);
                                if (textMatch) contentText = textMatch[1];
                                
                                return contentText.trim().includes(quotedText.trim());
                            });

                            const messageContent = `[${sender.realName}的消息：${replyText}]`; // 转换回标准格式存储
                            const message = {
                                id: `msg_${Date.now()}_${Math.random()}`,
                                role: 'assistant',
                                content: messageContent,
                                parts: [{ type: 'text', text: messageContent }],
                                timestamp: Date.now(),
                                senderId: sender.id
                            };

                            // 如果找到了原文，添加引用元数据
                            if (originalMessage) {
                                message.quote = {
                                    messageId: originalMessage.id,
                                    senderId: originalMessage.senderId || 'unknown',
                                    content: quotedText
                                };
                            }

                            group.history.push(message);
                            addMessageBubble(message, targetChatId, targetChatType);
                        }
                    } 
                    // --- 情况 B: 标准消息/特殊媒体 (原逻辑) ---
                    else if (standardMatch || item.char) {
                        const senderName = item.char || (standardMatch[1]);
                        const sender = group.members.find(m => (m.realName === senderName || m.groupNickname === senderName));
                        
                        if (sender) {
                            const message = {
                                id: `msg_${Date.now()}_${Math.random()}`,
                                role: 'assistant',
                                content: item.content.trim(),
                                parts: [{ type: item.type, text: item.content.trim() }],
                                timestamp: Date.now(),
                                senderId: sender.id
                            };
                            group.history.push(message);
                            addMessageBubble(message, targetChatId, targetChatType);
                        }
                    }
                }
            } // end for loop
        } // end else (online mode)

        await saveData();
        renderChatList();

    } catch (error) {
        console.error("🔴 处理 AI 回复时发生错误:", error);
    }
}




            async function getAiReply(chatId, chatType) {
                if (isGenerating) return;
                const { url, key, model, provider, streamEnabled } = db.apiSettings; // 修改：获取 streamEnabled 设置
                if (!url || !key || !model) {
                    showToast('请先在“api”应用中完成设置！');
                    switchScreen('api-settings-screen');
                    return;
                }
                const chat = (chatType === 'private') ? db.characters.find(c => c.id === chatId) : db.groups.find(g => g.id === chatId);
                if (!chat) return;
                isGenerating = true;
                getReplyBtn.disabled = true;
                regenerateBtn.disabled = true;
                const typingName = chatType === 'private' ? chat.remarkName : chat.name;
                // --- 修改开始：判断是否为线下模式，改变提示语 ---
            let actionStatusText = '正在输入中...';
            if (chatType === 'private' && chat.offlineModeEnabled) {
                actionStatusText = '正在行动中...';
            }
            typingIndicator.textContent = `“${typingName}”${actionStatusText}`;
            // --- 修改结束 ---
                typingIndicator.style.display = 'block';
                messageArea.scrollTop = messageArea.scrollHeight;
                try {
                    let systemPrompt, requestBody;
                    if (chatType === 'private') {
                        systemPrompt = generatePrivateSystemPrompt(chat);
                    } else {
                        systemPrompt = generateGroupSystemPrompt(chat);
                    }
  

// 1. 获取最近的消息
let rawHistory = chat.history.slice(-chat.maxMemory);

// 2. 🛑 智能过滤
const historySlice = rawHistory.filter(msg => {
    // 如果这条消息被打上了“AI忽略”的标签 (比如模式切换提示)，则不发送
    if (msg.isAiIgnore) {
        return false;
    }
    // 其他所有的消息（包括普通的旁白、隐藏的指令）都正常发送
    return true;
});

// 1. 定义线下模式的“后置强化指令”
// 这段话会紧贴着 AI 即将生成的回复，权重极高
let offlineReinforcement = null;
if (chatType === 'private' && chat.offlineModeEnabled) {
// 重新获取写作风格（因为此处是在另一个函数作用域） 
const worldBooksWriting = (chat.worldBookIds || []).map(id => db.worldBooks.find(wb => wb.id === id && wb.position === 'writing')).filter(Boolean).map(wb => wb.content).join(''); offlineReinforcement = ` [🛑 严格执行以下写作手册]

## 1. 🧠 动笔前的快速自问（100字以内，无需输出，心底自问）
1.  **人设**：**往上看一眼双方最后的互动内容**，根据${chat.realName}的人设，他/她现在会是什么心境？
2.  **回应**：${chat.myName}说的话，重点是哪个词？${chat.realName}该回应哪个点？
3.  **意图**：${chat.myName}这句话/行为，${chat.realName}会怎么理解？会觉得是试探、关心、还是随口一说？
4.  **时间**：现在是什么季节？是几点？
5.  **查重**：上一轮回复里是不是已经描写过${chat.realName}的声音、眼神，或者周围的环境？如果有，这一轮**绝对禁止**再次描写这些内容。

    
## 2. ✍️ 写作六大原则
${worldBooksWriting ? `1. **文风第一**：严格遵循【写作风格】设定：${worldBooksWriting}` : ''}
2. **人设为本**：${chat.realName}的反应必须符合他/她的设定
   - 冷静的人不会突然歇斯底里
   - 开朗的人不会动不动陷入绝望
   - 每个角色都有自己的反应模式
3. **拒绝“网文味”和“古早言情土味”**：
   - **严禁**使用“邪魅一笑”、“宠溺”、“彻底沦陷”、“命都给你”、“揉进骨血”等廉价网文词汇。
   - 保持文字的**现实逻辑**。真实的人不会立刻承认自己“输了”或“栽了”，不会直接投降。
4. **逻辑严密**：物理动作连续，物品去向明确，时间流逝合理。
5. **渐进变化**：${chat.realName}的情绪和情境的转变要合理，避免过度煽情
   - 不要动不动就"心碎""绝望""崩溃""心如刀绞"
   - 冲突和张力需要积累
   - 留白往往比直白更有力
6. **拒绝冗余和重复**：
   - **严禁**连续两轮使用相同的比喻和形容词，如果想不到新的，就不要使用，改成白描。
   - 除非环境和角色状态变化，否则**绝对不要**反复描写同一个环境和状态。

    
## 3. 📤 强制输出格式
1. **叙事与对话**：聚焦${chat.realName}，自由混合描写（第三人称）和对话（只有${chat.realName}嘴巴说出口的话行首必须加 \`>>>\`，且不加引号）。
2. **心理活动**：${chat.realName}内心独白或一闪而过的念头，请用**单星号**包裹。
   - 格式：\`*心里的想法*\`
   - 效果：\`*她怎么还没来？*\`
   - **内容限制**：心理活动是「正在进行时」的、第一人称的、碎片化的，往往反映真实内在感受，或与最终的外在行为产生反差感。仅允许写**感官捕捉**、**逻辑推理**或**潜意识碎片**。
3. **状态速写（频繁更新）**：
   - 不需要每一句都更新，但**只要${chat.realName}的心情、姿态发生了变化**，就请务必在文末输出状态。
   - 格式：\`[${chat.realName}更新状态为：动作或心情速写]\`
   - 要求：字数简短（15字以内），紧跟当前剧情。
4. **人称**：全文使用"他/她"或"${chat.realName}"指代主角，使用"你"指代${chat.myName}，绝不使用"我"。

**输出示例**：
\`\`\`
${chat.realName}愣了一下，指尖无意识地摩挲着杯沿。
*明明是她先提出来的，现在却装作无事发生？*
他的视线落在桌角的咖啡渍上，没有抬头看你。
>>> ...嗯，也没什么要紧的。
[${chat.realName}更新状态为：垂眸掩饰情绪]
\`\`\`

## 4.🛑 **动笔前的自我灵魂拷问**：
1. **人设校验**：回到最上方，重新浏览一遍**👤 角色档案**，问自己：这个反应符合${chat.realName}的性格吗？如果不符合，调整到符合为止。
2. **文风校验**：${worldBooksWriting ? '回顾**✍️ 写作六大原则**' : ''}你的文字是否完全符合要求？如果不符合，调整到符合为止。
3. **情感检查**：有没有过度煽情？如果用了"绝望""崩溃""心碎"等词，请改为更克制的表达。
4. **禁词检查**：如果不幸写出了网文的油腻土味，例如“宠溺”、“我栽了”、“彻底输了”等字眼，**请立刻将其删除**，并改写为一个具体的、无言的动作。

## 5.⚠️ **最重要的提醒**：
   - 把${chat.realName}当作一个真实的人去描写
   - 你正在写的是连载小说中同一个章节内的剧情，你描写的剧情应该是无缝衔接上一段剧情的。相信读者的记忆力，不要重复已知信息，读者不喜欢重复的文字内容。


现在，根据下方${chat.myName}的最新动态开始创作。深呼吸，回想一下${chat.realName}的人设，然后自然地续写接下来的剧情。\n\n
`;
}

// ... 在 getAiReply 函数中 ...

// ... Inside getAiReply ...
if (provider === 'gemini') {
    const contents = historySlice.map(msg => {
        const role = (msg.role === 'assistant' || msg.role === 'model') ? 'model' : 'user';
        let parts;
        
        // ------------------------------------------------------
        // 🛠️ 修复：线下模式格式清洗 (Offline Format Fix)
        // ------------------------------------------------------
        let processingContent = msg.content;
        if (chat.offlineModeEnabled) {                       
            processingContent = processingContent.replace(/\[system-narration:([\s\S]*?)\]/g, '\n\n$1');
            processingContent = processingContent.replace(/(\[.*?更新状态为[:：][\s\S]*?\])/g, '\n\n$1');
        if (role === 'user') {
            processingContent = processingContent.replace(/的消息：/g, '说：');
            }
        }
        // ------------------------------------------------------

        if (msg.parts && msg.parts.length > 0) {
             parts = msg.parts.map(p => {
                if (p.type === 'text' || p.type === 'html') {
                    // 使用处理过的文本
                    let text = p.text; 
                    if (chat.offlineModeEnabled && role === 'user') {
                        text = text.replace(/的消息：/g, '说：');
                    }
                    return { text: text };
                } else if (p.type === 'image') {
                    // ... (图片逻辑保持不变) ...
                    let mimeType = 'image/jpeg';
                    let data = p.data;
                    const match = p.data.match(/^data:(image\/(\w+));base64,(.*)$/);
                    if (match) {
                        mimeType = match[1];
                        data = match[3];
                    }
                    return { inline_data: { mime_type: mimeType, data: data } };
                }
                return null;
            }).filter(p => p);
        } else {
            // 使用处理过的文本
            parts = [{ text: processingContent }];
        }
        return { role, parts };
    });
    
    // ... 后续代码保持不变 (注入 offlineReinforcement 的逻辑) ...

    // 2. ✨✨ 智能无痕注入 (Seamless Injection) ✨✨
    if (offlineReinforcement) {
        // 你的 prompt 结尾建议修改为：
        // "...回想一下${chat.realName}的人设，然后自然地写出他/她的反应。\n\n" 
        // 这样这里只需要拼接即可

        let targetIndex = -1;
        
        // 倒序查找：找到【最新一轮】用户连续发言的【第一条】
        // 比如：[AI] -> [User A] -> [User B] -> [User C]
        // 我们要插在 [User A] 前面，这样 AI 先读指令，再读 A、B、C，逻辑最顺
        for (let i = contents.length - 1; i >= 0; i--) {
            if (contents[i].role === 'user') {
                targetIndex = i;
            } else {
                // 遇到 AI 消息，说明这一轮用户发言结束了
                break; 
            }
        }

        if (targetIndex !== -1) {
            const targetMsg = contents[targetIndex];
            
            // 仅仅使用换行符进行自然拼接
            // 这种方式让 AI 感觉指令和你的话是一体的
            const injectionText = `${offlineReinforcement}`; 
            
            if (targetMsg.parts && targetMsg.parts.length > 0) {
                // 找到第一个文本块进行拼接
                const textPart = targetMsg.parts.find(p => p.text);
                if (textPart) {
                    // 原代码
// textPart.text = injectionText + textPart.text;

// ✅ 建议修改为：增加明确的分隔符
textPart.text = `${injectionText}\n\n==========\n${chat.myName}最新动态：\n${textPart.text}`;
                } else {
                    // 只有图片的情况，插在最前
                    targetMsg.parts.unshift({ text: injectionText });
                }
            } else {
                targetMsg.parts = [{ text: injectionText }];
            }
        } else {
            // 兜底：如果没有找到用户消息（极罕见），则单独追加一条
            contents.push({ role: 'user', parts: [{ text: offlineReinforcement }] });
        }
    }

    requestBody = {
        contents: contents,
        system_instruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {}
    };
}
 else {
    // ... 在 getAiReply 函数内部 ...

    // === 【OpenAI / Claude / 其他标准 API 注入点】 ===
    // 1. 先初始化系统 Prompt
    let apiMessages = [{ role: 'system', content: systemPrompt }];
    
    // ... else (provider is NOT gemini) ...

    // 1. 构建基础消息列表
    historySlice.forEach(msg => {
        let content;
        
        // ------------------------------------------------------
        // 🛠️ 修复：线下模式格式清洗
        // ------------------------------------------------------
        let rawContent = msg.content;
        if (chat.offlineModeEnabled) {                       
            rawContent = rawContent.replace(/\[system-narration:([\s\S]*?)\]/g, '\n\n$1');
            rawContent = rawContent.replace(/(\[.*?更新状态为[:：][\s\S]*?\])/g, '\n\n$1');
        if (msg.role === 'user') {
            rawContent = rawContent.replace(/的消息：/g, '说：');
            }
        }
        // ------------------------------------------------------

        if (msg.role === 'user' && msg.quote) {
             const replyTextMatch = rawContent.match(/\[.*?[:：]([\s\S]+?)\]/); // 稍微放宽正则以匹配修改后的格式
             const replyText = replyTextMatch ? replyTextMatch[1] : rawContent;
             // 引用也改成“面对面”
             content = `[${chat.myName}引用“${msg.quote.content}”并回复：${replyText}]`;
        } else {
            if (msg.parts && msg.parts.length > 0) {
                 content = msg.parts.map(p => {
                    if (p.type === 'text' || p.type === 'html') {
                        let text = p.text;
                        if (chat.offlineModeEnabled && msg.role === 'user') {
                            text = text.replace(/的消息：/g, '说：');
                        }
                        return { type: 'text', text: text };
                    } else if (p.type === 'image') {
                        return { type: 'image_url', image_url: { url: p.data } };
                    }
                    return null;
                }).filter(p => p);
            } else {
                content = rawContent;
            }
        }
        
        // ... 后续代码 (apiMessages.push) ...
        apiMessages.push({ role: msg.role, content: content });
    });

    // 3. ✨✨ 关键修改：智能插入线下强化指令 ✨✨
    if (offlineReinforcement) {
        // 寻找插入点：我们要找到“最后一段连续的用户消息”的开始位置
        let insertIndex = apiMessages.length;
        
        // 从后往前遍历，只要是 user 就继续往前找
        for (let i = apiMessages.length - 1; i >= 0; i--) {
            if (apiMessages[i].role === 'user') {
                insertIndex = i;
            } else {
                // 遇到了 AI 的消息或 System 消息，停止，这里就是分界线
                break; 
            }
        }
        
        // 构建指令消息
        // 注意：有些模型(如DeepSeek/Claude)处理中间的 system 效果很好
        // 有些严格模型可能不喜欢中间插 system，如果报错，可以将 role 改为 'user'
        const instructionMsg = { 
            role: 'system', 
            content: offlineReinforcement 
        };

        // 插入到用户最新消息组的前面
        // 效果：[...历史AI消息, <强化指令>, 用户消息1, 用户消息2] -> AI回复
        apiMessages.splice(insertIndex, 0, instructionMsg);
    }

    requestBody = { model: model, messages: apiMessages, stream: streamEnabled };

// ... 后续代码保持不变 ...
}

// ... 后续的 fetch 代码保持不变 ...
                    const endpoint = (provider === 'gemini') ? `${url}/v1beta/models/${model}:streamGenerateContent?key=${getRandomValue(key)}` : `${url}/v1/chat/completions`;
                    const headers = (provider === 'gemini') ? { 'Content-Type': 'application/json' } : {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${key}`
                    };
                    const response = await fetch(endpoint, {
                        method: 'POST',
                        headers: headers,
                        body: JSON.stringify(requestBody)
                    });
                    if (!response.ok) {
                        const error = new Error(`API Error: ${response.status} ${await response.text()}`);
                        error.response = response;
                        throw error;
                    }

                    // 新增：根据 streamEnabled 调用不同的处理函数
                    if (streamEnabled) {
                        await processStream(response, chat, provider, chatId, chatType);
                    } else {
                        const result = await response.json();
                        let fullResponse = "";
                        if (provider === 'gemini') {
                            fullResponse = result.candidates?.[0]?.content?.parts?.[0]?.text || "";
                        } else {
                            fullResponse = result.choices[0].message.content;
                        }
                        await handleAiReplyContent(fullResponse, chat, chatId, chatType);
                    }

                } catch (error) {
                    showApiError(error);
                } finally {
                    isGenerating = false;
                    getReplyBtn.disabled = false;
                    regenerateBtn.disabled = false;
                    typingIndicator.style.display = 'none';
                }
            }

            async function processStream(response, chat, apiType, targetChatId, targetChatType) {
                const reader = response.body.getReader(), decoder = new TextDecoder();
                let fullResponse = "", accumulatedChunk = "";
                for (; ;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    accumulatedChunk += decoder.decode(value, { stream: true });
                    if (apiType === "openai" || apiType === "deepseek" || apiType === "claude" || apiType === "newapi") {
                        const parts = accumulatedChunk.split("\n\n");
                        accumulatedChunk = parts.pop();
                        for (const part of parts) {
                            if (part.startsWith("data: ")) {
                                const data = part.substring(6);
                                if (data.trim() !== "[DONE]") {
                                    try {
                                        fullResponse += JSON.parse(data).choices[0].delta?.content || "";
                                    } catch (e) { /* ignore */
                                    }
                                }
                            }
                        }
                    }
                }
                // ... 在 processStream 函数内部 ...

                if (apiType === "gemini") {
                    // Gemini 的流式数据通常是以逗号分隔的数组元素，或者是一行一个 JSON
                    // 这里采用简单的正则提取方案，比直接 JSON.parse 更稳健
                    try {
                        // 1. 简单的做法：因为 accumulatedChunk 可能不完整，我们每次只处理新增的部分会很麻烦
                        // 但通常 Gemini 的 chunk 是一段合法的 JSON 文本片段
                        // 如果 accumulatedChunk 包含了开头 '[' 和结尾 ']' 最好，但流式不一定。
                        
                        // 建议的修复逻辑：不依赖 JSON.parse 整个大字符串，而是提取文本
                        // 这是一个简化的提取器，提取所有 "text": "..." 结构
                        const textRegex = /"text":\s*"((?:[^"\\]|\\.)*)"/g;
                        let match;
                        fullResponse = ""; // 重置，重新从头计算
                        while ((match = textRegex.exec(accumulatedChunk)) !== null) {
                            // 处理转义字符，如 \n, \"
                            let contentText = match[1];
                            try {
                                contentText = JSON.parse(`"${contentText}"`); // 利用 JSON.parse 处理转义
                            } catch (e) { /* 忽略转义错误 */ }
                            fullResponse += contentText;
                        }

                    } catch (e) {
                        console.error("Error parsing Gemini stream:", e);
                    }
                }
                // 调用新的公共函数来处理回复内容
                await handleAiReplyContent(fullResponse, chat, targetChatId, targetChatType);
            }

async function handleRegenerate() {
    if (isGenerating) return;

    const chat = (currentChatType === 'private')
        ? db.characters.find(c => c.id === currentChatId)
        : db.groups.find(g => g.id === currentChatId);

    if (!chat || !chat.history || chat.history.length === 0) {
        showToast('没有可供重新生成的内容。');
        return;
    }

    // 1. 找到最后一条“非AI发送”的消息索引（作为锚点）
    let lastInputIndex = -1;
    for (let i = chat.history.length - 1; i >= 0; i--) {
        // 只要不是 AI (assistant/model) 发的消息，都视为“用户的输入或系统事件”
        // 这包括 role: 'user', role: 'system' 等
        if (chat.history[i].role !== 'assistant' && chat.history[i].role !== 'model') {
            lastInputIndex = i;
            break;
        }
    }

    // 🔴 修复点：将 lastUserMessageIndex 修改为 lastInputIndex
    // 如果没找到输入，或者最后一个输入就是列表的最后一条（意味着AI还没回复），则无法重生成
    if (lastInputIndex === -1 || lastInputIndex === chat.history.length - 1) {
        showToast('AI尚未回复，无法重新生成。');
        return;
    }

    // 2. 截取历史记录（从锚点的下一条开始删除，也就是删除 AI 的回复）
    const originalLength = chat.history.length;
    const removedMessages = chat.history.splice(lastInputIndex + 1);

    if (chat.history.length === originalLength) {
        showToast('未找到AI的回复，无法重新生成。');
        return;
    }

    // ============================================================
    // 🧠 智能状态回滚逻辑 (保持不变)
    // ============================================================
    if (currentChatType === 'private') {
        const statusRegex = /更新状态为[:：](.*?)(?:\]|$)/;
        
        let statusWasChangedInDeletedMsg = false;
        for (const removedMsg of removedMessages) {
            if (statusRegex.test(removedMsg.content)) {
                statusWasChangedInDeletedMsg = true;
                break;
            }
        }

        if (statusWasChangedInDeletedMsg) {
            let foundStatus = false;
            for (let i = chat.history.length - 1; i >= 0; i--) {
                const msg = chat.history[i];
                const match = msg.content.match(statusRegex);
                
                if (match) {
                    let newStatus = match[1].trim().replace(/[\])]+$/, '').trim();
                    if (newStatus) {
                        console.log(`🔄 状态回滚触发：恢复至历史状态 "${newStatus}"`);
                        chat.status = newStatus;
                        foundStatus = true;
                        break;
                    }
                }
            }
            if (!foundStatus) {
                console.log("⚠️ 未在历史中找到上一个状态，保持当前状态或重置");
            }
        } else {
            console.log("🛡️ 被删除的消息未包含状态更新，无需回滚状态");
        }

        const statusTextEl = document.getElementById('chat-room-status-text');
        if (statusTextEl) statusTextEl.textContent = chat.status;
    }
    // ============================================================

    await saveData();

    // 3. 重新渲染消息区域
    currentPage = 1; 
    renderMessages(false, true); 

    // 4. 重新触发AI回复
    await getAiReply(currentChatId, currentChatType);
}

// 重名处理函数
            function getUniqueStickerName(baseName, excludeId = null) {
                let name = baseName;
                let counter = 1;
                while (db.myStickers.some(s => s.name === name && s.id !== excludeId)) {
                    name = `${baseName}(${counter})`;
                    counter++;
                }
                return name;
            }

            async function setupStickerSystem() {
                const batchAddStickerBtn = document.getElementById('batch-add-sticker-btn');
                const batchAddStickerModal = document.getElementById('batch-add-sticker-modal');
                const batchAddStickerForm = document.getElementById('batch-add-sticker-form');
                const stickerUrlsTextarea = document.getElementById('sticker-urls-textarea');
                const manageStickersBtn = document.getElementById('manage-stickers-btn');
                const stickerManageBar = document.getElementById('sticker-manage-bar');
                const deleteSelectedStickersBtn = document.getElementById('delete-selected-stickers-btn');
                
                const linkStickerBtn = document.getElementById('link-sticker-btn');
                const linkStickerModal = document.getElementById('link-sticker-modal');
                const cancelLinkBtn = document.getElementById('cancel-link-sticker-btn');
                const confirmLinkBtn = document.getElementById('confirm-link-sticker-btn');
                const linkSelectAllBtn = document.getElementById('link-sticker-select-all-btn'); // ✨全选按钮

                // ==========================================
                // 1. 关联表情包及【全选】逻辑
                // ==========================================
                linkStickerBtn.addEventListener('click', () => {
                    selectedLinkStickerIds.clear();
                    const chat = db.characters.find(c => c.id === currentChatId);
                    const charIds = chat.stickerIds ||[];
                    charIds.forEach(id => selectedLinkStickerIds.add(id)); 
                    
                    currentLinkStickerCategory = '全部'; 
                    renderLinkStickerGrid();
                    linkStickerModal.classList.add('visible');
                });

                cancelLinkBtn.addEventListener('click', () => {
                    linkStickerModal.classList.remove('visible');
                });

                confirmLinkBtn.addEventListener('click', async () => {
                    const chat = db.characters.find(c => c.id === currentChatId);
                    chat.stickerIds = Array.from(selectedLinkStickerIds);
                    await saveData();
                    showToast('关联成功');
                    linkStickerModal.classList.remove('visible');
                });

                // ✨全选按钮点击逻辑
                linkSelectAllBtn.addEventListener('click', () => {
                    let stickersInView = db.myStickers;
                    if (currentLinkStickerCategory !== '全部') {
                        stickersInView = db.myStickers.filter(s => (s.category || '默认') === currentLinkStickerCategory);
                    }
                    
                    // 检查当前视图下的是否已全部选中
                    const allSelected = stickersInView.every(s => selectedLinkStickerIds.has(s.id));
                    
                    if (allSelected) {
                        // 取消全选
                        stickersInView.forEach(s => selectedLinkStickerIds.delete(s.id));
                    } else {
                        // 全选
                        stickersInView.forEach(s => selectedLinkStickerIds.add(s.id));
                    }
                    renderLinkStickerGrid(); 
                });

                // ==========================================
                // 2. 分类标签长按管理菜单逻辑 ✨
                // ==========================================
                const categoryActionSheet = document.getElementById('category-actionsheet');
                const renameCategoryBtn = document.getElementById('rename-category-btn');
                const linkCategoryBtn = document.getElementById('link-category-btn');
                const deleteCategoryBtn = document.getElementById('delete-category-btn');

                categoryActionSheet.addEventListener('click', (e) => {
                    if (e.target === categoryActionSheet) {
                        categoryActionSheet.classList.remove('visible');
                    }
                });

                // 一键重命名
renameCategoryBtn.addEventListener('click', () => {
                    categoryActionSheet.classList.remove('visible');
                    // ✨ 修复：增加对“默认”分类的拦截
                    if (!currentActionCategory || currentActionCategory === '默认') return; 
                    
                    // 找到当前分类的DOM按钮
                    const bar = document.getElementById('sticker-category-bar');
                    const btns = Array.from(bar.querySelectorAll('.category-btn'));
                    const targetBtn = btns.find(b => b.textContent === currentActionCategory);
                    if (!targetBtn) return;
                    
                    // 恢复系统的文本选中和交互功能
                    targetBtn.style.userSelect = 'text';
                    targetBtn.style.webkitUserSelect = 'text';
                    targetBtn.style.webkitTouchCallout = 'default';

                    // 让其可编辑并全选文字
                    targetBtn.contentEditable = "true";
                    targetBtn.focus();
                    const range = document.createRange();
                    range.selectNodeContents(targetBtn);
                    const sel = window.getSelection();
                    sel.removeAllRanges();
                    sel.addRange(range);
                    
                    // 完成编辑的处理函数
                    const finishEditing = async () => {
                        targetBtn.contentEditable = "false";
                        targetBtn.style.userSelect = 'none';
                        targetBtn.style.webkitUserSelect = 'none';
                        targetBtn.style.webkitTouchCallout = 'none';

                        const newName = targetBtn.textContent.trim();
                        targetBtn.removeEventListener('blur', finishEditing);
                        targetBtn.removeEventListener('keydown', keydownHandler);
                        
                        if (!newName || newName === '全部' || newName === '默认') { // 也禁止重命名为"默认"
                            showToast('分类名称无效');
                            renderStickerGrid(); // 恢复原状
                            return;
                        }
                        
                        if (newName !== currentActionCategory) {
                            // 批量修改该分类下所有表情的属性
                            db.myStickers.forEach(s => {
                                const sCat = s.category || '默认';
                                if (sCat === currentActionCategory) s.category = newName;
                            });
                            await saveData();
                            if (currentStickerCategory === currentActionCategory) {
                                currentStickerCategory = newName;
                            }
                            showToast(`分类已重命名为 ${newName}`);
                        }
                        renderStickerGrid();
                    };

                    const keydownHandler = (e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            targetBtn.blur(); // 失去焦点会触发 finishEditing
                        }
                    };
                    
                    targetBtn.addEventListener('blur', finishEditing);
                    targetBtn.addEventListener('keydown', keydownHandler);
                });

                // 一键关联
                linkCategoryBtn.addEventListener('click', async () => {
                    categoryActionSheet.classList.remove('visible');
                    if (!currentActionCategory || currentChatType !== 'private') return;
                    
                    const chat = db.characters.find(c => c.id === currentChatId);
                    if (!chat) return;

                    const stickersInCat = db.myStickers.filter(s => (s.category || '默认') === currentActionCategory);
                    const idsToLink = stickersInCat.map(s => s.id);
                    
                    // 将这些 ID 追加到角色身上并去重
                    const currentSet = new Set(chat.stickerIds ||[]);
                    idsToLink.forEach(id => currentSet.add(id));
                    chat.stickerIds = Array.from(currentSet);
                    
                    await saveData();
                    showToast(`已将该分类的 ${idsToLink.length} 个表情关联到角色`);
                });

                // 一键删除整个分类
deleteCategoryBtn.addEventListener('click', async () => {
                    categoryActionSheet.classList.remove('visible');
                    // ✨ 修复：增加对“默认”分类的拦截
                    if (!currentActionCategory || currentActionCategory === '默认') return;

                    const stickersInCat = db.myStickers.filter(s => (s.category || '默认') === currentActionCategory);
                    
                    if (await AppUI.confirm(`确定要彻底删除【${currentActionCategory}】分类下的所有 ${stickersInCat.length} 个表情包吗？此操作不可恢复！`)) {
                        const idsToDelete = new Set(stickersInCat.map(s => s.id));
                        
                        // 1. 删除内存中属于该分类的表情
                        db.myStickers = db.myStickers.filter(s => !idsToDelete.has(s.id));
                        
                        // 2. 清理全站所有角色身上的关联
                        db.characters.forEach(c => {
                            if (c.stickerIds) {
                                c.stickerIds = c.stickerIds.filter(id => !idsToDelete.has(id));
                            }
                        });
                        
                        // 3. 物理删除
                        await dexieDB.myStickers.bulkDelete(Array.from(idsToDelete));
                        await saveData();
                        
                        if (currentStickerCategory === currentActionCategory) {
                            currentStickerCategory = '全部';
                        }
                        showToast(`已删除整个分类`);
                        renderStickerGrid();
                    }
                });


                // ==========================================
                // 3. 批量管理与彻底删除
                // ==========================================
                manageStickersBtn.addEventListener('click', () => {
                    isStickerManageMode = !isStickerManageMode;
                    if (isStickerManageMode) {
                        manageStickersBtn.textContent = '取消';
                        manageStickersBtn.classList.replace('btn-primary', 'btn-neutral');
                        stickerManageBar.style.display = 'flex';
                    } else {
                        manageStickersBtn.textContent = '管理';
                        manageStickersBtn.classList.replace('btn-neutral', 'btn-primary');
                        stickerManageBar.style.display = 'none';
                        selectedStickerIds.clear();
                    }
                    deleteSelectedStickersBtn.textContent = `删除已选 (${selectedStickerIds.size})`;
                    deleteSelectedStickersBtn.disabled = selectedStickerIds.size === 0;
                    renderStickerGrid();
                });

                deleteSelectedStickersBtn.addEventListener('click', async () => {
                    if (selectedStickerIds.size === 0) return showToast('请先选择');
                    
                    if (await AppUI.confirm(`将彻底从库中删除这 ${selectedStickerIds.size} 个表情，是否继续？`)) {
                        db.myStickers = db.myStickers.filter(s => !selectedStickerIds.has(s.id));
                        db.characters.forEach(c => {
                            if (c.stickerIds) {
                                c.stickerIds = c.stickerIds.filter(id => !selectedStickerIds.has(id));
                            }
                        });
                        await dexieDB.myStickers.bulkDelete(Array.from(selectedStickerIds));
                        await saveData();
                        
                        showToast('删除成功');
                        isStickerManageMode = false;
                        manageStickersBtn.textContent = '管理';
                        manageStickersBtn.classList.replace('btn-neutral', 'btn-primary');
                        stickerManageBar.style.display = 'none';
                        selectedStickerIds.clear();
                        renderStickerGrid();
                    }
                });

                // ==========================================
                // 4. 面板打开控制及上传功能
                // ==========================================
                stickerToggleBtn.addEventListener('click', () => {
                    const chatExpansionPanel = document.getElementById('chat-expansion-panel');
                    if (chatExpansionPanel.classList.contains('visible')) {
                        chatExpansionPanel.classList.remove('visible');
                    }
                    if (currentChatType === 'group') {
                        linkStickerBtn.style.display = 'none';
                    } else {
                        linkStickerBtn.style.display = 'inline-block';
                    }
                    
                    stickerModal.classList.toggle('visible');
                    if (stickerModal.classList.contains('visible')) {
                        renderStickerGrid();
                    }
                });
                
                addNewStickerBtn.addEventListener('click', () => {
                    addStickerModalTitle.textContent = '添加新表情';
                    addStickerForm.reset();
                    stickerEditIdInput.value = '';
                    document.getElementById('sticker-category-input').value = currentStickerCategory === '全部' ? '' : currentStickerCategory;
                    stickerPreview.innerHTML = '<span>预览</span>';
                    stickerUrlInput.disabled = false;
                    addStickerModal.classList.add('visible');
                });
                
                addStickerForm.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    let name = stickerNameInput.value.trim();
                    let category = document.getElementById('sticker-category-input').value.trim() || '默认';
                    const id = stickerEditIdInput.value;
                    const previewImg = stickerPreview.querySelector('img');
                    const data = previewImg ? previewImg.src : null;
                    if (!name || !data) return showToast('请填写表情名称并提供图片');
                    
                    name = getUniqueStickerName(name, id);
                    const stickerData = { name, data, category };
                    if (id) {
                        const index = db.myStickers.findIndex(s => s.id === id);
                        if (index > -1) db.myStickers[index] = { ...db.myStickers[index], ...stickerData };
                    } else {
                        stickerData.id = `sticker_${Date.now()}`;
                        db.myStickers.push(stickerData);
                    }
                    await saveData();
                    renderStickerGrid();
                    addStickerModal.classList.remove('visible');
                    showToast('表情包已保存');
                });
                
                stickerUrlInput.addEventListener('input', (e) => {
                    stickerPreview.innerHTML = `<img src="${e.target.value}" alt="预览">`;
                    stickerFileUpload.value = '';
                });
                
                stickerFileUpload.addEventListener('change', async (e) => {
                    const file = e.target.files[0];
                    if (file) {
                        try {
                            const compressedUrl = await compressImage(file, { quality: 0.8, maxWidth: 200, maxHeight: 200 });
                            stickerPreview.innerHTML = `<img src="${compressedUrl}" alt="预览">`;
                            stickerUrlInput.value = '';
                            stickerUrlInput.disabled = true;
                        } catch (error) {
                            showToast('表情包压缩失败，请重试');
                        }
                    }
                });

                // ==========================================
                // 5. 批量导入
                // ==========================================
                batchAddStickerBtn.addEventListener('click', () => {
                    batchAddStickerModal.classList.add('visible');
                    stickerUrlsTextarea.value = ''; 
                });
                
                batchAddStickerForm.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const textInput = stickerUrlsTextarea.value.trim();
                    const category = document.getElementById('batch-category-input').value.trim() || '默认';
                    
                    if (!textInput) return showToast('请输入表情包数据');
                    const lines = textInput.split('\n');
                    const newStickers =[];
                    for (const line of lines) {
                        const trimmedLine = line.trim();
                        if (!trimmedLine) continue; 
                        const colonIndex = trimmedLine.indexOf(':');
                        if (colonIndex <= 0) continue;
                        let name = trimmedLine.substring(0, colonIndex).trim();
                        const url = trimmedLine.substring(colonIndex + 1).trim();
                        
                        if (name && url.startsWith('http')) {
                            name = getUniqueStickerName(name); 
                            db.myStickers.push({id:'temp', name}); 
                            newStickers.push({ 
                                id: `sticker_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`, 
                                name, 
                                data: url,
                                category
                            });
                        }
                    }
                    db.myStickers = db.myStickers.filter(s => s.id !== 'temp');
                    
                    if (newStickers.length > 0) {
                        db.myStickers.push(...newStickers); 
                        await saveData();
                        renderStickerGrid();
                        batchAddStickerModal.classList.remove('visible');
                        showToast(`成功导入 ${newStickers.length} 个新表情！`);
                    }
                });

                // ==========================================
                // 6. 编辑和彻底删除(单张长按菜单)
                // ==========================================
                editStickerBtn.addEventListener('click', () => {
                    if (!currentStickerActionTarget) return;
                    const sticker = db.myStickers.find(s => s.id === currentStickerActionTarget);
                    if (sticker) {
                        addStickerModalTitle.textContent = '编辑表情';
                        stickerEditIdInput.value = sticker.id;
                        stickerNameInput.value = sticker.name;
                        document.getElementById('sticker-category-input').value = sticker.category || '默认';
                        stickerPreview.innerHTML = `<img src="${sticker.data}" alt="预览">`;
                        if (sticker.data.startsWith('http')) {
                            stickerUrlInput.value = sticker.data;
                            stickerUrlInput.disabled = false;
                        } else {
                            stickerUrlInput.value = '';
                            stickerUrlInput.disabled = true;
                        }
                        addStickerModal.classList.add('visible');
                    }
                    stickerActionSheet.classList.remove('visible');
                    currentStickerActionTarget = null;
                });
                
                deleteStickerBtn.addEventListener('click', async () => {
                    if (!currentStickerActionTarget) return;
                    const sticker = db.myStickers.find(s => s.id === currentStickerActionTarget);
                    if (sticker) {
                        if (await AppUI.confirm(`确定要彻底删除表情“${sticker.name}”吗？`)) {
                            db.myStickers = db.myStickers.filter(s => s.id !== currentStickerActionTarget);
                            db.characters.forEach(c => {
                                if (c.stickerIds) c.stickerIds = c.stickerIds.filter(id => id !== currentStickerActionTarget);
                            });
                            await dexieDB.myStickers.delete(currentStickerActionTarget);
                            await saveData();
                            renderStickerGrid();
                            showToast('表情已彻底删除');
                        }
                    }
                    stickerActionSheet.classList.remove('visible');
                    currentStickerActionTarget = null;
                });
            }

            // ==========================================================
            // ======================= 渲染函数 =========================
            // ==========================================================

// 渲染主面板底部分类栏 (含长按逻辑)
            function renderCategoryBar() {
                const bar = document.getElementById('sticker-category-bar');
                const datalist = document.getElementById('category-datalist');
                if (!bar) return;

                const categories = new Set(['全部', '默认']);
                db.myStickers.forEach(s => { if (s.category) categories.add(s.category); });

                bar.innerHTML = '';
                categories.forEach(cat => {
                    const btn = document.createElement('div');
                    btn.className = `category-btn ${cat === currentStickerCategory ? 'active' : ''}`;
                    btn.textContent = cat;
                    
                    // 默认禁止文本选中，防止长按时触发浏览器放大镜和复制菜单
                    btn.style.userSelect = 'none';
                    btn.style.webkitUserSelect = 'none';
                    btn.style.webkitTouchCallout = 'none';
                    
                    // 点击切换
                    btn.onclick = (e) => {
                        if (btn.isContentEditable) return; // 正在编辑时阻止点击
                        currentStickerCategory = cat;
                        renderStickerGrid();
                    };

                    // ✨ 长按弹出管理菜单：动态判断按钮显隐
                    const handleCategoryLongPress = () => {
                        if (cat === '全部' || btn.isContentEditable) return;
                        currentActionCategory = cat;
                        
                        const linkBtn = document.getElementById('link-category-btn');
                        const renameBtn = document.getElementById('rename-category-btn');
                        const deleteBtn = document.getElementById('delete-category-btn');

                        // 1. 群聊隐藏一键关联按钮
                        if (currentChatType === 'private') {
                            linkBtn.style.display = 'block';
                        } else {
                            linkBtn.style.display = 'none';
                        }
                        
                        // 2. “默认”分类隐藏重命名和删除
                        if (cat === '默认') {
                            renameBtn.style.display = 'none';
                            deleteBtn.style.display = 'none';
                        } else {
                            renameBtn.style.display = 'block';
                            deleteBtn.style.display = 'block';
                        }
                        
                        // 3. 如果所有可用按钮都被隐藏了(比如群聊里长按“默认”)，就不弹窗
                        if (linkBtn.style.display === 'none' && renameBtn.style.display === 'none') {
                            return;
                        }
                        
                        document.getElementById('category-actionsheet').classList.add('visible');
                    };

                    btn.addEventListener('contextmenu', (e) => {
                        if (cat === '全部' || btn.isContentEditable) return;
                        e.preventDefault(); 
                        e.stopPropagation();
                        handleCategoryLongPress();
                    });

                    let catPressTimer;
                    btn.addEventListener('touchstart', (e) => {
                        if (cat === '全部' || btn.isContentEditable) return;
                        e.stopPropagation();
                        catPressTimer = setTimeout(() => handleCategoryLongPress(), 500);
                    });
                    btn.addEventListener('touchend', () => clearTimeout(catPressTimer));
                    btn.addEventListener('touchmove', () => clearTimeout(catPressTimer)); 

                    bar.appendChild(btn);
                });

                if (datalist) {
                    datalist.innerHTML = '';
                    categories.forEach(cat => {
                        if (cat !== '全部' && cat !== '默认') {
                            const opt = document.createElement('option');
                            opt.value = cat;
                            datalist.appendChild(opt);
                        }
                    });
                }
            }

            // 渲染主面板表情网格
            function renderStickerGrid() {
                stickerGridContainer.innerHTML = '';
                renderCategoryBar();
                
                let stickersToRender = db.myStickers;
                if (currentStickerCategory !== '全部') {
                    stickersToRender = db.myStickers.filter(s => (s.category || '默认') === currentStickerCategory);
                }

                if (stickersToRender.length === 0) {
                    const emptyMsg = currentStickerCategory === '全部' ? '还没有表情包，快去添加吧！' : `该分类下没有表情`;
                    stickerGridContainer.innerHTML = `<p style="color:#aaa; text-align:center; margin-top: 20px; width: 100%;">${emptyMsg}</p>`;
                    return;
                }

                stickersToRender.forEach(sticker => {
                    const item = document.createElement('div');
                    item.className = 'sticker-item';
                    item.innerHTML = `<img src="${sticker.data}" alt="${sticker.name}"><span title="${sticker.name}">${sticker.name}</span>`;

                    if (isStickerManageMode) {
                        item.classList.add('is-managing');
                        if (selectedStickerIds.has(sticker.id)) item.classList.add('is-selected');
                        item.addEventListener('click', () => {
                            if (selectedStickerIds.has(sticker.id)) {
                                selectedStickerIds.delete(sticker.id);
                                item.classList.remove('is-selected');
                            } else {
                                selectedStickerIds.add(sticker.id);
                                item.classList.add('is-selected');
                            }
                            const deleteBtn = document.getElementById('delete-selected-stickers-btn');
                            deleteBtn.textContent = `删除已选 (${selectedStickerIds.size})`;
                            deleteBtn.disabled = selectedStickerIds.size === 0;
                        });
                    } else {
                        item.addEventListener('click', () => sendSticker(sticker));
                        
                        item.addEventListener('contextmenu', (e) => { 
                            e.preventDefault(); e.stopPropagation();
                            handleStickerLongPress(sticker.id);
                        });
                        item.addEventListener('touchstart', (e) => {
                            e.stopPropagation();
                            longPressTimer = setTimeout(() => handleStickerLongPress(sticker.id), 500);
                        });
                        item.addEventListener('touchend', () => clearTimeout(longPressTimer));
                        item.addEventListener('touchmove', () => clearTimeout(longPressTimer));
                    }
                    stickerGridContainer.appendChild(item);
                });
            }

            // 渲染关联表情弹窗内的网格与分类，并动态更新全选按钮文字
            function renderLinkStickerGrid() {
                const grid = document.getElementById('link-sticker-grid');
                const catBar = document.getElementById('link-sticker-category-bar');
                const selectAllBtn = document.getElementById('link-sticker-select-all-btn');
                
                // 1. 渲染分类栏
                const categories = new Set(['全部', '默认']);
                db.myStickers.forEach(s => { if (s.category) categories.add(s.category); });
                
                catBar.innerHTML = '';
                categories.forEach(cat => {
                    const btn = document.createElement('div');
                    btn.className = `category-btn ${cat === currentLinkStickerCategory ? 'active' : ''}`;
                    btn.textContent = cat;
                    btn.onclick = () => {
                        currentLinkStickerCategory = cat;
                        renderLinkStickerGrid(); // 点击重绘
                    };
                    catBar.appendChild(btn);
                });

                // 2. 渲染关联网格
                grid.innerHTML = '';
                let stickersToRender = db.myStickers;
                if (currentLinkStickerCategory !== '全部') {
                    stickersToRender = db.myStickers.filter(s => (s.category || '默认') === currentLinkStickerCategory);
                }

                // 3. ✨动态判定全选状态
                if (stickersToRender.length === 0) {
                    grid.innerHTML = '<p style="color:#aaa; text-align:center; width: 100%;">该分类下没有表情。</p>';
                    selectAllBtn.style.display = 'hidden';
                    return;
                }
                selectAllBtn.style.display = 'visible';
                const allSelected = stickersToRender.every(s => selectedLinkStickerIds.has(s.id));
                selectAllBtn.textContent = allSelected ? '☑ 全选' : '☐ 全选';

                // 4. 填充图片
                stickersToRender.forEach(sticker => {
                    const item = document.createElement('div');
                    item.className = 'sticker-item is-managing'; // 强制套用管理样式的遮罩效果
                    item.innerHTML = `<img src="${sticker.data}" alt="${sticker.name}"><span>${sticker.name}</span>`;
                    
                    if (selectedLinkStickerIds.has(sticker.id)) {
                        item.classList.add('is-selected');
                    }

                    item.addEventListener('click', () => {
                        if (selectedLinkStickerIds.has(sticker.id)) {
                            selectedLinkStickerIds.delete(sticker.id);
                            item.classList.remove('is-selected');
                        } else {
                            selectedLinkStickerIds.add(sticker.id);
                            item.classList.add('is-selected');
                        }
                        // 点单张时，实时检查是否达到了全选状态
                        const nowAllSelected = stickersToRender.every(s => selectedLinkStickerIds.has(s.id));
                        selectAllBtn.textContent = nowAllSelected ? '取消全选' : '全选';
                    });
                    grid.appendChild(item);
                });
            }

            function handleStickerLongPress(stickerId) {
                if (isStickerManageMode) return;
                clearTimeout(longPressTimer);
                currentStickerActionTarget = stickerId;
                stickerActionSheet.classList.add('visible');
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
                    await saveData();
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