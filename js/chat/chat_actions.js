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

    await saveSingleChat(currentChatId, currentChatType);
    
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
                await saveSingleChat(currentChatId, currentChatType);
                currentPage = 1;
                renderMessages(false, true);
                renderChatList();
                exitMultiSelectMode();
                showToast(`已删除 ${deletedCount} 条消息`);
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
    await saveSingleChat(currentChatId, currentChatType);

    // 重新渲染
    currentPage = 1;
    renderMessages(false, true);
    renderChatList();
    showToast('消息已撤回');
}            