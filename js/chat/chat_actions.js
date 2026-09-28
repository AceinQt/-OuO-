   // 长按功能
function createContextMenu(items, x, y) {
    removeContextMenu(); // 移除旧菜单
    
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    
    // 生成菜单项
    items.forEach(item => {
        const menuItem = document.createElement('div');
        menuItem.className = 'context-menu-item';
        if (item.danger) menuItem.classList.add('danger');
        menuItem.textContent = item.label;
        menuItem.onclick = (e) => {
            e.stopPropagation(); // 阻止冒泡
            item.action();
            removeContextMenu();
        };
        menu.appendChild(menuItem);
    });

    // 核心修复：直接添加到 DOM 中（不需要 visibility: hidden）
    // 浏览器在当前 JS 代码块执行完之前，不会把半成品画到屏幕上
    document.body.appendChild(menu);

    // 获取尺寸
    const menuRect = menu.getBoundingClientRect();
    const windowHeight = window.innerHeight;
    const windowWidth = window.innerWidth;

    // --- 智能定位逻辑 ---
    if (y + menuRect.height > windowHeight - 10) { 
        menu.style.top = `${y - menuRect.height}px`;
        menu.style.transformOrigin = 'bottom left';
    } else {
        menu.style.top = `${y}px`;
        menu.style.transformOrigin = 'top left';
    }

    if (x + menuRect.width > windowWidth) {
        menu.style.left = `${windowWidth - menuRect.width - 10}px`;
    } else {
        menu.style.left = `${x}px`;
    }

    // 核心修复：稍微延迟一点再绑定全局点击关闭事件
    // 移动端长按抬手时会触发 touchend -> click，延迟 100ms 可完美避开这个抬手误触
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
            // 旁白有两种来源，菜单一视同仁（复制/编辑/多选）：
            //   `[system-narration:…]` AI 在线下模式/通话里写的
            //   `[剧情旁白：…]`        用户自己在"+"面板发的（新格式，只有一条）
            const isNarration = /\[system-narration:[\s\S]+?\]/.test(message.content)
                || /^\[剧情旁白[:：][\s\S]+?\]$/.test(message.content);
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
                        // A. 尝试提取旁白壳里面的内容（两种格式都认）
                        const match = message.content.match(/\[system-narration:([\s\S]+?)\]/)
                            || message.content.match(/^\[剧情旁白[:：]([\s\S]+?)\]$/);
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

                // 3. 多选（进去以后可删可转发）
                menuItems.push({label: '多选', action: () => enterMultiSelectMode(messageId)});

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
        menuItems.push({label: '多选', action: () => enterMultiSelectMode(messageId)});

          } else {
                // --- 普通消息菜单 (保持原有) ---
                const isImageRecognitionMsg = message.parts && message.parts.some(p => p.type === 'image');
                const isStickerMessage = /\[.*?的表情包[:：].*?\]|\[.*?发送的表情包[:：].*?\]/.test(message.content);
                const isTransferMessage = /\[.*?给你转账[:：].*?\]|\[.*?的转账[:：].*?\]|\[.*?向.*?转账[:：].*?\]/.test(message.content);
                const isGiftMessage = /\[.*?送来的礼物[:：].*?\]|\[.*?向.*?送来了礼物[:：].*?\]/.test(message.content);
                const isLocationMessage = /\[.*?发送了位置[:：].*?\]/.test(message.content);
                const isInvisibleMessage = /\[.*?(?:接收|退回).*?的转账\]|\[.*?更新状态为[:：].*?\]|\[.*?已接收礼物\]|\[system:.*?\]|\[.*?邀请.*?加入了群聊\]|\[.*?将.*?移出了群聊\]|\[.*?修改群名为[:：].*?\]|\[.*?修改.*?的群昵称为[:：].*?\]/.test(message.content);

                if (!isWithdrawn) {
                    // 普通对话、语音、照片/视频（图文）共用同一套编辑弹窗，且可互相转换。
                    if (!isImageRecognitionMsg && !isStickerMessage && !isTransferMessage && !isGiftMessage && !isLocationMessage && !isInvisibleMessage) {
                         menuItems.push({
                            label: '复制',
                            action: () => {
                                const editableMatch = message.content.match(/^\[(?:.+?)(?:的消息|的语音|发来的照片\/视频)[:：]\s*([\s\S]*?)\]$/);
                                const text = editableMatch ? editableMatch[1].trim() : message.content;
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

                    // 语音消息：重新生成音频
                    // ★ 缓存键只认预设 id 不认预设内容，所以调语速/改描述/换音色都不会
                    //   让已有音频自动作废（免得每次微调都白花一次合成的钱）。
                    //   这里是那个策略必需的手动出口。
                    const isVoiceMessage = typeof parseVoiceMessage === 'function'
                        && !!parseVoiceMessage(message.content)
                        && message.role !== 'user';
                    if (isVoiceMessage && typeof regenerateVoiceClip === 'function') {
                        menuItems.push({
                            label: '重新生成语音',
                            action: () => regenerateVoiceClip(messageId, chat, currentChatType)
                        });
                    }

                    // 语音消息：把音频存成 mp3 文件
                    // ★ 不检查"有没有生成过"就放这一项 —— 那要查一次 IndexedDB，
                    //   而长按菜单是同步构建的。没生成过的情况由 downloadVoiceClip
                    //   自己提示"先点播放键生成"。
                    if (isVoiceMessage && typeof downloadVoiceClip === 'function') {
                        menuItems.push({
                            label: '下载语音',
                            action: () => downloadVoiceClip(messageId, chat, currentChatType)
                        });
                    }

                    // 图片消息的"转文字"不在这里 —— 已挪到图片气泡右下角的按钮
                    // （chat_bubble_factory.js 的 .image-ocr-btn），和生图键同一个位置。
                }
                menuItems.push({label: '多选', action: () => enterMultiSelectMode(messageId)});
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
                        const sender = findGroupMemberById(chat, message.senderId);
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
                } else if (/\[.*?发送了位置：.*?\]/.test(message.content)) {
                    previewContent = '[位置]';
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

// ============================================================
// === 老版「用户剧情旁白」的孪生消息 ==========================
// ============================================================
// 旧数据里，用户发一条剧情旁白会存**两条**：
//   可见：`msg_visual_*`  role system + isAiIgnore  `[system-display:正文]`
//   隐藏：`msg_context_*` role user   + isHidden    `[剧情旁白：正文]`
// 新发的只存一条了（chat_feature_basic.js 的 sendTimeSkipMessage），但旧数据照原样留着。
//
// 配对靠**时间戳**：两条是同一个 `now` 建出来的。原先那段按 id 后缀配对的
// （`msg_visual_x` → `msg_context_x`）是死代码 —— 两条 id 的随机段各自 Math.random()
// 生成，永远对不上，所以在此之前编辑旁白，模型读的那一份从来没被改过。
//
// ★ 只改写、绝不删除：总结存的是「第 N 条到第 M 条」的全局序号
//   （lazy_load.js 的 getMessagesByGlobalRange 按 offset 取），删一条会让它后面
//   所有消息的序号往前挪一格，历史总结引用的区间全部指偏。
function findLegacyNarrationTwin(chat, message) {
    if (!chat || !message || !message.timestamp) return null;
    const isHiddenSide = !!message.isHidden;
    return (chat.history || []).find(m => {
        if (!m || m.id === message.id) return false;
        if (m.timestamp !== message.timestamp) return false;
        if (typeof m.content !== 'string') return false;
        return isHiddenSide
            // 自己是隐藏那条 → 找可见那条（老的 system-display，或已经改成新格式的）
            ? (!m.isHidden && (/^\[system-display[:：]/.test(m.content) || /^\[剧情旁白[:：]/.test(m.content)))
            // 自己是可见那条 → 找隐藏那条（模型真正读的那一份）
            : (!!m.isHidden && /^\[剧情旁白[:：]/.test(m.content));
    }) || null;
}

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
    
    // A. 线下模式旁白 [system-narration:...]（AI 写的）
    const narrationMatch = contentToEdit.match(/^\[system-narration:([\s\S]+?)\]$/);
    // A2. 用户自己发的剧情旁白 [剧情旁白：...]（新格式，单条）
    const mineNarrationMatch = contentToEdit.match(/^\[剧情旁白[:：]([\s\S]+?)\]$/);
    // B. 屏幕通知/时间跳过 [system-display:...]
    const displayMatch = contentToEdit.match(/^\[system-display:([\s\S]+?)\]$/);
    // C. 纯系统指令 [system:...]
    const systemMatch = contentToEdit.match(/^\[system:([\s\S]+?)\]$/);
    // D. 普通对话、语音和照片/视频（同时兼容中英文冒号）
    const plainTextMatch = contentToEdit.match(/^\[.*?的消息[:：]\s*([\s\S]*)\]$/);
    const voiceMatch = contentToEdit.match(/^\[.*?的语音[:：]\s*([\s\S]*)\]$/);
    const photoVideoMatch = contentToEdit.match(/^\[.*?发来的照片\/视频[:：]\s*([\s\S]*)\]$/);

    if (narrationMatch) {
        contentToEdit = narrationMatch[1].trim();
        currentType = 'narration';
    } else if (mineNarrationMatch) {
        contentToEdit = mineNarrationMatch[1].trim();
        currentType = 'user-narration';
    } else if (displayMatch) {
        contentToEdit = displayMatch[1].trim();
        // 老的那对用户旁白（可见 system-display + 隐藏 剧情旁白）预选「剧情旁白」：
        // 保存时就地升级成新格式，于是画成新样式的旁白气泡（条数不变，见 saveMessageEdit）。
        // 找不到孪生的才是真·屏幕提示（通话起止、线下模式开关），保持 display。
        currentType = findLegacyNarrationTwin(chat, message) ? 'user-narration' : 'display';
    } else if (systemMatch) {
        contentToEdit = systemMatch[1].trim();
        currentType = 'system';
    } else if (voiceMatch) {
        contentToEdit = voiceMatch[1].trim();
        currentType = 'voice';
    } else if (photoVideoMatch) {
        contentToEdit = photoVideoMatch[1].trim();
        currentType = 'photo-video';
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
    let senderName = '';
    if (message.role === 'user') {
        senderName = (currentChatType === 'private') ? chat.myName : chat.me.realName;
    } else if (currentChatType === 'private') {
        senderName = chat.realName || chat.name;
    } else {
        const sender = findGroupMemberById(chat, message.senderId);
        senderName = sender ? sender.groupNickname : (chat.name || '未知成员');
    }

    let legacyTwinToSave = null;

    if (selectedType === 'narration') {
        newContent = `[system-narration:${newText}]`;
    } else if (selectedType === 'user-narration') {
        newContent = `[剧情旁白：${newText}]`;
        // 老数据是一对（见 findLegacyNarrationTwin 上面那段）：两条改成同一段新文本 ——
        // 可见那条从此画成新样式的旁白气泡，隐藏那条继续当模型读的那一份。
        // ★ 条数、时间戳、角色、标志位一律不动：删一条会把它后面所有消息的全局序号
        //   往前挪一格，历史总结引用的区间全部指偏。
        const twin = findLegacyNarrationTwin(chat, message);
        if (twin) {
            twin.content = newContent;
            twin.parts = [{ type: 'text', text: newContent }];
            legacyTwinToSave = twin;
        } else if (message.isAiIgnore) {
            // 孤儿（隐藏那条早被单独删掉了）：让这条自己升级成新格式的单条旁白，
            // 否则它是一条"模型看不见的假旁白"。同样不增不减。
            delete message.isAiIgnore;
            message.role = 'user';
            if (currentChatType === 'group' && !message.senderId) message.senderId = 'user_me';
        }
    } else if (selectedType === 'display') {
        newContent = `[system-display:${newText}]`;
    } else if (selectedType === 'voice') {
        newContent = `[${senderName}的语音：${newText}]`;
    } else if (selectedType === 'photo-video') {
        newContent = `[${senderName}发来的照片/视频：${newText}]`;
    } else {
        newContent = `[${senderName}的消息：${newText}]`;
    }

    // 转换后统一落为纯文字 parts，避免旧格式残留导致渲染器继续误判气泡类型。
    chat.history[messageIndex].content = newContent;
    chat.history[messageIndex].parts = [{ type: 'text', text: newContent }];

    // 双语照片描述：用户改了中文，之前那份英文提示词就过时了，必须清掉。
    // 留着的话下次点生成会拿旧英文去画，画出来和眼前的描述对不上 ——
    // 宁可退回用新的中文（效果差一点），也不要画一张明显不对的图。
    // 用户若把英文连括号一起手写进来，紧接着的 strip 会重新摘出去。
    delete chat.history[messageIndex].imagePromptEn;
    if (typeof stripBilingualImagePrompt === 'function') {
        stripBilingualImagePrompt(chat.history[messageIndex]);
    }

    await saveMessageToDB(chat.history[messageIndex], currentChatId, currentChatType);
    if (legacyTwinToSave) {
        await saveMessageToDB(legacyTwinToSave, currentChatId, currentChatType);
    }
    await saveSingleChat(currentChatId, currentChatType);

    // ==========================================
    // 【核心修复】原地 DOM 替换，解决跳转和消息丢失问题
    // ==========================================

    // 1. 在页面上找到旧的消息气泡 DOM 元素
    const existingBubble = messageArea.querySelector(`.message-wrapper[data-id="${editingMessageId}"]`);

    // 2. 使用现有的函数生成一个新的气泡 DOM 元素
    // 注意：createMessageBubbleElement 依赖已更新的 chat.history 数据
    // ★ 走 _bubbleOrHiddenRow 而不是直接进气泡工厂：isHidden 的消息不能画成完整气泡
    //   （旧数据里那条隐藏的 `[剧情旁白：…]` 现在画得出旁白气泡，会和可见孪生重影）
    const editedMsg = chat.history[messageIndex];
    const newBubble = (typeof _bubbleOrHiddenRow === 'function')
        ? _bubbleOrHiddenRow(editedMsg)
        : (editedMsg.isHidden ? null : createMessageBubbleElement(editedMsg));

    if (existingBubble) {
        if (typeof releaseImageObjectUrlsWithin === 'function') {
            releaseImageObjectUrlsWithin(existingBubble);
        }
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

    // 老旁白那对是一起改的，屏幕上那条孪生（通常是可见的那一条）也要跟着重画，
    // 否则要等下次进聊天室才看得到新样式。
    if (legacyTwinToSave) {
        const twinNode = messageArea.querySelector(`.message-wrapper[data-id="${legacyTwinToSave.id}"]`);
        if (twinNode) {
            const rebuiltTwin = (typeof _bubbleOrHiddenRow === 'function')
                ? _bubbleOrHiddenRow(legacyTwinToSave)
                : (legacyTwinToSave.isHidden ? null : createMessageBubbleElement(legacyTwinToSave));
            if (rebuiltTwin) twinNode.replaceWith(rebuiltTwin);
        }
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
                // 「显示隐藏」每次进多选都从关着开始：它是个临时视图，不该跨会话记着
                showHiddenInSelect = false;
                if (typeof _removeHiddenRows === 'function') _removeHiddenRows();
                syncHiddenToggleBtn();
                updateMultiSelectBar();
                if (initialMessageId) {
                    toggleMessageSelection(initialMessageId);
                }
            }

            // 多选栏的计数和两个按钮的可用态，就这三行，三个调用方共用
            function updateMultiSelectBar() {
                selectCount.textContent = `已选择 ${selectedMessageIds.size} 项`;
                deleteSelectedBtn.disabled = selectedMessageIds.size === 0;
                if (forwardSelectedBtn) forwardSelectedBtn.disabled = selectedMessageIds.size === 0;
            }

            // 把 showHiddenInSelect 反映到界面上：按钮文案/状态 + 屏幕上那个模式类。
            // 模式类是给 CSS 用的 —— 时间戳 `[time-divider]` 本来就画在 DOM 里、也有 data-id，
            // 只是 .time-divider-wrapper 写了 pointer-events:none 点不着，开关打开时靠它放开。
            function syncHiddenToggleBtn() {
                const on = !!showHiddenInSelect;
                if (chatRoomScreen) chatRoomScreen.classList.toggle('show-hidden-msgs', on);
                if (!toggleHiddenMsgBtn) return;
                toggleHiddenMsgBtn.textContent = on ? '收起隐藏' : '显示隐藏';
                toggleHiddenMsgBtn.classList.toggle('active', on);
            }

            // 「显示隐藏」：把平时画不出来的消息都摆出来，让用户能逐条勾选删或转。
            // 判据是"普通视图里画不出可勾选的气泡"，不是 isHidden —— 详见
            // chat_room.js 里 isShowingHiddenMessages 上面那段。
            // 只增删 DOM 行，不重绘整页（见 applyHiddenMessageVisibility 注释）。
            function toggleHiddenMessagesInSelect() {
                if (!isInMultiSelectMode) return;
                showHiddenInSelect = !showHiddenInSelect;
                syncHiddenToggleBtn();
                applyHiddenMessageVisibility();
                // 收起时里面被勾上的那些会一起取消勾选，计数得跟着退回来
                updateMultiSelectBar();
            }

            function exitMultiSelectMode() {
                isInMultiSelectMode = false;
                chatRoomHeaderDefault.style.display = 'flex';
                chatRoomHeaderSelect.style.display = 'none';
                document.querySelector('.chat-input-wrapper').style.display = 'block';
                multiSelectBar.classList.remove('visible');
                chatRoomScreen.classList.remove('multi-select-active');
                // 隐藏行只属于多选模式，退出就得连行带勾选一起清掉，
                // 不然它们会一直挂在 DOM 里，普通模式下点一下还会触发长按菜单之类的动作
                showHiddenInSelect = false;
                if (typeof _removeHiddenRows === 'function') _removeHiddenRows();
                syncHiddenToggleBtn();
                selectedMessageIds.forEach(id => {
                    const el = messageArea.querySelector(`.message-wrapper[data-id="${id}"]`);
                    if (el) el.classList.remove('multi-select-selected');
                });
                selectedMessageIds.clear();
            }

            function toggleMessageSelection(messageId) {
                const el = messageArea.querySelector(`.message-wrapper[data-id="${messageId}"]`);
                if (!el) return;
                // 折叠的通话气泡一勾就是整段通话的全部消息，见 idsForMessageSelection
                const ids = idsForMessageSelection(el);
                if (selectedMessageIds.has(messageId)) {
                    ids.forEach(id => selectedMessageIds.delete(id));
                    el.classList.remove('multi-select-selected');
                } else {
                    ids.forEach(id => selectedMessageIds.add(id));
                    el.classList.add('multi-select-selected');
                }
                updateMultiSelectBar();
            }

            async function deleteSelectedMessages() {
                if (selectedMessageIds.size === 0) return;

                const chatForCount = (currentChatType === 'private')
                    ? db.characters.find(c => c.id === currentChatId)
                    : db.groups.find(g => g.id === currentChatId);
                // 隐藏消息是给 AI 看的上下文（场景切换、通话起止……），成对出现的居多，
                // 删一半会让 AI 那边的情节对不上，所以单独把条数说出来，别让人误以为在删普通消息
                const hiddenCount = ((chatForCount && chatForCount.history) || [])
                    .filter(m => selectedMessageIds.has(m.id) && m.isHidden).length;

                // ★ 二次确认是必需的，不是礼貌：删除键旁边就是转发键，两个都在
                //   多选栏右下角、指头底下差几毫米，误触一次就是不可恢复的删除。
                const hiddenNote = hiddenCount
                    ? `（其中 ${hiddenCount} 条是隐藏消息，是给 AI 看的上下文，删了可能影响剧情连贯）`
                    : '';
                const ok = await AppUI.confirm(
                    `将删除选中的 ${selectedMessageIds.size} 条消息${hiddenNote}，删掉就找不回来了。`,
                    '删除消息', '删除', '取消'
                );
                if (!ok) return;

                // 条数在弹窗关掉之后再数一遍：等确认那会儿后台投递主动消息可能
                // 走过 resetChatRoomState 把选中集清了，拿旧数字会报错数量。
                if (selectedMessageIds.size === 0) return;
                const deletedCount = selectedMessageIds.size;

                const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
                chat.history = chat.history.filter(m => !selectedMessageIds.has(m.id));
                await deleteMessagesFromDB(Array.from(selectedMessageIds));
    await saveSingleChat(currentChatId, currentChatType);
                // ★ 先退出多选再重绘：反过来的话，重绘那一下「显示隐藏」还开着，
                //   隐藏行会先画出来、紧接着被 exitMultiSelectMode 清掉，闪一下。
                exitMultiSelectMode();
                currentPage = 1;
                renderMessages(false, true);
                renderChatList();
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
    await saveMessageToDB(message, currentChatId, currentChatType);
    await saveSingleChat(currentChatId, currentChatType);

    // 重新渲染
    currentPage = 1;
    renderMessages(false, true);
    renderChatList();
    showToast('消息已撤回');
}
