let currentPersonaIdToEdit = null;

// --- START OF FILE chat_list.js Snippet ---
function setupChatListScreen() {
    chatListContainer = document.getElementById('chat-list-container');
    noChatsPlaceholder = document.getElementById('no-chats-placeholder');
    addChatBtn = document.getElementById('chat-list-add-btn');
    addCharModal = document.getElementById('add-char-modal');
    addCharForm = document.getElementById('add-char-form');
    
    // 【修改】直接绑定表单与跳转事件，无需再注入页面
    setupContactScreensEvents(); 
    
    renderChatList();
    renderContacts(); 
    
    if(typeof setupBubblePresets === 'function') setupBubblePresets();

    const tabs = document.querySelectorAll('.nav-tab-item');
    const views = document.querySelectorAll('.tab-content-view');
    const title = document.getElementById('chat-list-title');
    const createGroupBtn = document.getElementById('create-group-btn');
    const importBtn = document.getElementById('import-character-card-btn');
    
    const tabMeSpan = document.querySelector('.nav-tab-item[data-tab="me"] span');
    if (tabMeSpan) tabMeSpan.textContent = '通讯录';

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => { t.classList.remove('active'); t.style.color = '#999'; });
            tab.classList.add('active');
            tab.style.color = 'var(--primary-color)';

            views.forEach(v => v.style.display = 'none');
            const targetView = document.getElementById(`tab-view-${tab.dataset.tab}`);
            if (targetView) {
                if (tab.dataset.tab === 'bubbles') {
                    targetView.style.display = 'flex';
                } else {
                    targetView.style.display = 'block';
                }
            }

            if (tab.dataset.tab === 'messages') {
                title.textContent = '聊天';
                if(createGroupBtn) createGroupBtn.style.display = 'inline-flex';
                if(importBtn) importBtn.style.display = 'inline-flex';
                addChatBtn.style.display = 'inline-flex';
                
                addChatBtn.onclick = () => {
                    addCharModal.classList.add('visible');
                    addCharForm.reset();
                    document.getElementById('selected-persona-id').value = ''; 
                    document.getElementById('my-name-for-char').disabled = false;
                    document.getElementById('my-nickname-for-char').disabled = false;
                    const btn = document.getElementById('add-chat-select-persona-btn');
                    if(btn) {
                        btn.innerHTML = '绑定人设';
                        btn.classList.add('btn-secondary');
                        btn.classList.remove('btn-primary');
                    }
                };
            } else if (tab.dataset.tab === 'me') {
                title.textContent = '通讯录';
                if(createGroupBtn) createGroupBtn.style.display = 'none';
                if(importBtn) importBtn.style.display = 'none';
                
                // 【修改】隐藏通讯录页面右上角的添加按钮
                addChatBtn.style.display = 'none';
                
            } else if (tab.dataset.tab === 'bubbles') {
                title.textContent = '外观';
                if(createGroupBtn) createGroupBtn.style.display = 'none';
                if(importBtn) importBtn.style.display = 'none';
                addChatBtn.style.display = 'none';
                
                if(typeof window.renderGlobalBubblePresets === 'function') {
                    window.renderGlobalBubblePresets();
                }
            }
        });
    });

    if(tabs.length > 0) tabs[0].click();

    chatListContainer.addEventListener('click', (e) => {
        const chatItem = e.target.closest('.chat-item');
        if (chatItem) {
            currentChatId = chatItem.dataset.id;
            currentChatType = chatItem.dataset.type;
            openChatRoom(currentChatId, currentChatType);
        }
    });
    chatListContainer.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const chatItem = e.target.closest('.chat-item');
        if (!chatItem) return;
        handleChatListLongPress(chatItem.dataset.id, chatItem.dataset.type, e.clientX, e.clientY);
    });
}

// --- 替换 chat_list.js 中的 setupAddCharModal 函数 ---

function setupAddCharModal() {
    const addCharForm = document.getElementById('add-char-form');
    const addCharModal = document.getElementById('add-char-modal');
    // 获取绑定按钮
    const selectPersonaBtn = document.getElementById('add-chat-select-persona-btn');
    
    // 1. 绑定按钮点击事件 (修复点：确保事件绑定成功)
    if(selectPersonaBtn) {
        // 先移除旧的监听器，防止重复绑定
        const newBtn = selectPersonaBtn.cloneNode(true);
        selectPersonaBtn.parentNode.replaceChild(newBtn, selectPersonaBtn);
        
        newBtn.addEventListener('click', () => {
            if(typeof window.openSelectPersonaModal === 'function') {
                window.openSelectPersonaModal((p) => {
                    if(p) {
                        // 填充数据
                        document.getElementById('selected-persona-id').value = p.id;
                        document.getElementById('my-name-for-char').value = p.realName;
                        document.getElementById('my-nickname-for-char').value = p.nickname;
                        // 填充隐藏的人设字段
                        const personaInput = document.getElementById('my-persona-for-char');
                        if(personaInput) personaInput.value = p.persona;
                        
                        // 锁定输入框
                        document.getElementById('my-name-for-char').disabled = true;
                        document.getElementById('my-nickname-for-char').disabled = true;
                        
                        // 改变按钮状态
                        newBtn.innerHTML = `✓ 已绑定: ${p.nickname}`;
                        newBtn.classList.remove('btn-secondary');
                        newBtn.classList.add('btn-primary');
                        
                        showToast(`已绑定身份：${p.nickname}`);
                    }
                });
            } else {
                console.error("openSelectPersonaModal 未定义");
                showToast("功能未加载，请刷新页面");
            }
        });
    }

    // 2. 处理表单提交
    addCharForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        // 获取输入值
        const realName = document.getElementById('char-real-name').value;
        const remarkName = document.getElementById('char-remark-name').value;
        
        const myRealName = document.getElementById('my-name-for-char').value;
        const myNickname = document.getElementById('my-nickname-for-char').value;
        const myPersonaVal = document.getElementById('my-persona-for-char') ? document.getElementById('my-persona-for-char').value : '';
        const selectedId = document.getElementById('selected-persona-id').value;

        let finalBoundId = selectedId;

        // 如果没有选择现成档案，但填了信息，自动创建一个
        if (!selectedId) {
            const newPersona = {
                id: Date.now().toString(),
                realName: myRealName,
                nickname: myNickname,
                persona: myPersonaVal,
                status: '在线',
                avatar: 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg'
            };
            
            if(!db.userPersonas) db.userPersonas = [];
            db.userPersonas.push(newPersona);
            // 写入数据库
            await dexieDB.userPersonas.put(newPersona);
            finalBoundId = newPersona.id;
            renderUserPersonas(); 
        }

        // 构建新角色对象
        const newChar = {
            id: `char_${Date.now()}`,
            realName: realName,
            remarkName: remarkName,
            persona: '',
            avatar: 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg',
            
            myName: myRealName,
            myNickname: myNickname,
            myPersona: myPersonaVal,
            boundPersonaId: finalBoundId,
            
            myAvatar: 'https://i.postimg.cc/GtbTnxhP/o-o-1.jpg',
            theme: 'white_blue',
            maxMemory: 10,
            chatBg: '',
            history: [],
            isPinned: false,
            status: '在线',
            worldBookIds: [],
            useCustomBubbleCss: false,
            customBubbleCss: '',
            unreadCount: 0,
            memoryJournals: [],
            journalWorldBookIds: [],
            peekScreenSettings: { wallpaper: '', customIcons: {}, unlockAvatar: '' },
            lastUserMessageTimestamp: null,
        };

        db.characters.push(newChar);
        await saveSingleChat(newChar.id, 'private');
        
        if(typeof renderChatList === 'function') renderChatList();
        if(typeof renderCharacters === 'function') renderCharacters();
        addCharModal.classList.remove('visible');
        showToast(`角色“${newChar.remarkName}”创建成功！`);
    });
}



// --- 替换 chat_list.js 中原来的 renderContacts 等三个函数 ---

// --- 替换 chat_list.js 中的 renderContacts 函数 ---
function renderContacts() {
    const tabMe = document.getElementById('tab-view-me');
    if (tabMe && !tabMe.dataset.initialized) {
        tabMe.dataset.initialized = 'true';
        // 绑定新的无缝折叠面板头部
        tabMe.querySelectorAll('.contact-group-header').forEach(header => {
            header.addEventListener('click', () => {
                header.parentElement.classList.toggle('open');
            });
        });
    }
    
    renderCharacters();
    renderUserPersonas();
}

function renderCharacters() {
    const container = document.getElementById('contacts-characters-list');
    if (!container) return;
    container.innerHTML = '';
    
    if (!db.characters || db.characters.length === 0) {
        container.innerHTML = '<li class="list-item" style="justify-content:center; color:#999; padding:20px 0;">暂无角色</li>';
        return;
    }
    
    db.characters.forEach(c => {
        const li = document.createElement('li');
        li.className = 'list-item'; // 使用消息列表同款样式
        li.innerHTML = `
            <img src="${c.avatar}" class="chat-avatar">
            <div class="item-details">
                <div class="item-details-row">
                    <div class="item-name">${c.remarkName}</div>
                </div>
                <div class="item-preview-wrapper">
                    <div class="item-preview">${c.status || '在线'}</div>
                </div>
            </div>
        `;
        li.addEventListener('click', () => {
            openCharacterScreen(c);
        });
        container.appendChild(li);
    });
}

function renderUserPersonas() {
    const container = document.getElementById('my-personas-list');
    if (!container) return;
    container.innerHTML = '';
    
    // 渲染现有的用户档案列表
    if (db.userPersonas && db.userPersonas.length > 0) {
        db.userPersonas.forEach(p => {
            const li = document.createElement('li');
            li.className = 'list-item'; // 使用消息列表同款样式
            li.innerHTML = `
                <img src="${p.avatar}" class="chat-avatar">
                <div class="item-details">
                    <div class="item-details-row">
                        <div class="item-name">${p.nickname}</div>
                    </div>
                    <div class="item-preview-wrapper">
                        <div class="item-preview">${p.status || '在线'}</div>
                    </div>
                </div>
            `;
            li.addEventListener('click', () => {
                openUserPersonaScreen(p);
            });
            container.appendChild(li);
        });
    }

    // 在底部固定添加一个“新增”列表项，使用一致的外观
    const addCard = document.createElement('li');
    addCard.className = 'list-item';
    addCard.innerHTML = `
        <div class="chat-avatar" style="display: flex; justify-content: center; align-items: center; background-color: #f8f9fa; color: #999; font-size: 24px; font-weight: 300; border: 1px dashed #ccc; box-sizing: border-box;">+</div>
        <div class="item-details">
            <div class="item-details-row">
                <div class="item-name" style="color: #333;">新增档案</div>
            </div>
        </div>
    `;
    
    // 绑定点击事件：弹出新建档案弹窗
    addCard.addEventListener('click', () => {
        const modal = document.getElementById('user-persona-modal');
        if (modal) {
            document.getElementById('user-persona-modal-title').textContent = '新建档案';
            document.getElementById('user-persona-form').reset();
            document.getElementById('user-persona-avatar-preview').src = 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg';
            currentPersonaIdToEdit = null;
            modal.classList.add('visible');
        }
    });
    
    container.appendChild(addCard);
}

// --- 专门用于：跳转到通讯录页面的函数 ---
function goBackToContacts() {
    switchScreen('chat-list-screen');
    const meTab = document.querySelector('.nav-tab-item[data-tab="me"]');
    if (meTab) meTab.click(); // 确保返回后仍然停留在"通讯录"视图
}

// openUserPersonaScreen 已迁移至 user_info.js

            function handleChatListLongPress(chatId, chatType, x, y) {
                clearTimeout(longPressTimer);
                const chatItem = (chatType === 'private') ? db.characters.find(c => c.id === chatId) : db.groups.find(g => g.id === chatId);
                if (!chatItem) return;
                const itemName = chatType === 'private' ? chatItem.remarkName : chatItem.name;
                const menuItems = [{
                    label: chatItem.isPinned ? '取消置顶' : '置顶聊天',
                    action: async () => {
                        chatItem.isPinned = !chatItem.isPinned;
                        await saveSingleChat(chatId, chatType); 
                        renderChatList();
                    }
                }, {
                    label: '删除聊天',
                    danger: true,
                    action: async () => {
                        if (await AppUI.confirm(`确定要删除与“${itemName}”的聊天记录吗？此操作不可恢复。`, "系统提示", "确认", "取消")) {
                            if (chatType === 'private') {
                                await dexieDB.characters.delete(chatId);
                                db.characters = db.characters.filter(c => c.id !== chatId);
                            } else {
                                await dexieDB.groups.delete(chatId);
                                db.groups = db.groups.filter(g => g.id !== chatId);
                            }

                            
 await clearChatHistoryInDB(chatId);                           renderChatList();
                            showToast('聊天已删除');
                        }
                    }
                }];
                createContextMenu(menuItems, x, y);
            }

            function renderChatList() {
                chatListContainer.innerHTML = '';
                const allChats = [...db.characters.map(c => ({ ...c, type: 'private' })), ...db.groups.map(g => ({
                    ...g,
                    type: 'group'
                }))];
                noChatsPlaceholder.style.display = (db.characters.length + db.groups.length) === 0 ? 'block' : 'none';
// 【修复】过滤掉用户全局状态推送的时间戳，防止列表被异常顶起
                const getEffectiveSortTime = (chatItem) => {
                    if (!chatItem.history || chatItem.history.length === 0) return 0;
                    // 从后往前找，找到第一个不是"用户全局状态通知"的消息时间戳
                    for (let i = chatItem.history.length - 1; i >= 0; i--) {
                        const m = chatItem.history[i];
                        const isUserStatus = m.isUserStatusNotif || (m.role === 'user' && /\[.*?更新状态为：.*?\]/.test(m.content));
                        if (!isUserStatus) {
                            return m.timestamp;
                        }
                    }
                    // 如果全是状态通知，就保底返回最早一条的时间
                    return chatItem.history[0].timestamp; 
                };

                const sortedChats = allChats.sort((a, b) => {
                    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
                    const lastMsgTimeA = getEffectiveSortTime(a);
                    const lastMsgTimeB = getEffectiveSortTime(b);
                    return lastMsgTimeB - lastMsgTimeA;
                });
                sortedChats.forEach(chat => {
                    let lastMessageText = '开始聊天吧...';
                    if (chat.history && chat.history.length > 0) {
                        const invisibleRegex = /\[.*?(?:接收|退回).*?的转账\]|\[.*?更新状态为：.*?\]|\[.*?已接收礼物\]|\[system:.*?\]|\[.*?邀请.*?加入了群聊\]|\[.*?修改群名为：.*?\]|\[system-display:.*?\]/;
                        const visibleHistory = chat.history.filter(msg => !invisibleRegex.test(msg.content));
                        if (visibleHistory.length > 0) {
                            const lastMsg = visibleHistory[visibleHistory.length - 1];
                            const urlRegex = /^(https?:\/\/[^\s]+\.(?:jpg|jpeg|png|gif|webp|bmp|svg)|data:image\/[a-z]+;base64,)/i;
                            const imageRecogRegex = /\[.*?发来了一张图片：\]/
                            const voiceRegex = /\[.*?的语音：.*?\]/;
                            const photoVideoRegex = /\[.*?发来的照片\/视频：.*?\]/;
                            const transferRegex = /\[.*?的转账：.*?元.*?\]|\[.*?给你转账：.*?元.*?\]|\[.*?向.*?转账：.*?元.*?\]/;
                            const stickerRegex = /\[.*?的表情包：.*?\]|\[.*?发送的表情包：.*?\]/;
                            const giftRegex = /\[.*?送来的礼物：.*?\]|\[.*?向.*?送来了礼物：.*?\]/;



                            if (giftRegex.test(lastMsg.content)) {
                                lastMessageText = '[礼物]';
                            } else if (stickerRegex.test(lastMsg.content)) {
                                lastMessageText = '[表情包]';
                            } else if (voiceRegex.test(lastMsg.content)) {
                                lastMessageText = '[语音]';
                            } else if (photoVideoRegex.test(lastMsg.content)) {
                                lastMessageText = '[照片/视频]';
                            } else if (transferRegex.test(lastMsg.content)) {
                                lastMessageText = '[转账]';
                            } else if (imageRecogRegex.test(lastMsg.content) || (lastMsg.parts && lastMsg.parts.some(p => p.type === 'image'))) {
                                lastMessageText = '[图片]';
                            } else if ((lastMsg.parts && lastMsg.parts.some(p => p.type === 'html'))) {
                                lastMessageText = '[互动]';
                            } else {
                                    let text = lastMsg.content.trim();
                                    
// 1. 尝试匹配中文冒号的标准格式 [名字：内容]
                                    const plainTextMatch = text.match(/^\[.*?：([\s\S]*)\]$/);
                                    
                                    // 2. 尝试匹配英文冒号的旁白格式 [system-narration:内容]
                                    const narrationMatch = text.match(/^\[system-narration:([\s\S]+?)\]$/);

                                    // 3. 【新增】尝试匹配剧情旁白格式 (兼容中英文冒号)
                                    const contextMatch = text.match(/^\[剧情旁白[:：]([\s\S]+?)\]$/);

                                    if (narrationMatch) {
                                        // 如果是系统旁白，提取内容
                                        text = narrationMatch[1].trim();
                                    } else if (contextMatch) {
                                        // 【新增】如果是剧情旁白，提取内容
                                        text = contextMatch[1].trim();
                                    } else if (plainTextMatch && plainTextMatch[1]) {
                                        // 如果是普通消息，提取内容
                                        text = plainTextMatch[1].trim();
                                    }

                                    // 3. 清理末尾可能的时间戳
                                    text = text.replace(/\[发送时间:.*?\]$/, '').trim(); 
                                    
                                    const htmlRegex = /<[a-z][\s\S]*>/i;
                                    if (htmlRegex.test(text)) {
                                        lastMessageText = '[互动]';
                                    } else {
                                        lastMessageText = urlRegex.test(text) ? '[图片]' : text;
                                    }
                                }
                        } else {
                            const lastEverMsg = chat.history[chat.history.length - 1];
                            const inviteRegex = /\[(.*?)邀请(.*?)加入了群聊\]/;
                            const renameRegex = /\[.*?修改群名为：.*?\]/;
                            const timeSkipRegex = /\[system-display:([\s\S]+?)\]/;
                            const timeSkipMatch = lastEverMsg.content.match(timeSkipRegex);

                            if (timeSkipMatch) {
                                lastMessageText = timeSkipMatch[1];
                            } else if (inviteRegex.test(lastEverMsg.content)) {
                                lastMessageText = '新成员加入了群聊';
                            } else if (renameRegex.test(lastEverMsg.content)) {
                                lastMessageText = '群聊名称已修改';
                            } else {
                                lastMessageText = 'ta正在等你';
                            }

                        }
                    }
                    const li = document.createElement('li');
                    li.className = 'list-item chat-item';
                    if (chat.isPinned) li.classList.add('pinned');
                    li.dataset.id = chat.id;
                    li.dataset.type = chat.type;
                    const avatarClass = chat.type === 'group' ? 'group-avatar' : '';
                    const itemName = chat.type === 'private' ? chat.remarkName : chat.name;
                    const pinBadgeHTML = chat.isPinned ? '<span class="pin-badge">置顶</span>' : '';
                    let timeString = '';
                    const lastMessage = chat.history && chat.history.length > 0
    ? [...chat.history].reverse().find(m => !m.isUserStatusNotif) ?? null
    : null;
                    if (lastMessage) {
                        const date = new Date(lastMessage.timestamp);
                        const now = new Date();
                        if (date.toDateString() === now.toDateString()) {
                            timeString = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
                        } else {
                            timeString = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
                        }
                    }

                    const unreadCount = chat.unreadCount || 0;
                    const unreadBadgeHTML = unreadCount > 0
                        ? `<span class="unread-badge visible">${unreadCount > 99 ? '99+' : unreadCount}</span>`
                        : `<span class="unread-badge"></span>`;

                    li.innerHTML = `
<img src="${chat.avatar}" alt="${itemName}" class="chat-avatar ${avatarClass}">
<div class="item-details">
    <div class="item-details-row">
        <div class="item-name">${itemName}</div>
        <div class="item-meta">
            <span class="item-time">${timeString}</span>
        </div>
    </div>
    <div class="item-preview-wrapper">
        <div class="item-preview">${lastMessageText}</div>
        ${pinBadgeHTML}
    </div>
</div>
${unreadBadgeHTML}`; /* <-- 将红点元素移动到这里 */


                    chatListContainer.appendChild(li);
                });
                if (typeof updateHomeChatBadge === 'function') {
                    updateHomeChatBadge();
                }
            }
            


function setupContactScreensEvents() {

    // 返回键 / 头像上传 / 表单保存 / 删除 已迁移至 user_info.js -> setupUserPersonaScreen()

    // --- 1. 新建用户档案（Modal弹窗逻辑） ---
    const modalForm = document.getElementById('user-persona-form');
    const modalAvatarUpload = document.getElementById('user-persona-avatar-upload');
    const modalAvatarPreview = document.getElementById('user-persona-avatar-preview');
    const modalCancelBtn = document.getElementById('user-persona-cancel-btn');

    if (modalAvatarUpload) {
        modalAvatarUpload.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                try {
                    if (typeof compressImage === 'function') {
                        modalAvatarPreview.src = await compressImage(file, { quality: 0.8, maxWidth: 400, maxHeight: 400 });
                    } else {
                        const reader = new FileReader();
                        reader.onload = (e) => modalAvatarPreview.src = e.target.result;
                        reader.readAsDataURL(file);
                    }
                } catch (error) { showToast('头像上传失败'); }
            }
        });
    }

    if (modalForm) {
        modalForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const realName = document.getElementById('user-persona-realname').value.trim();
            const nickname = document.getElementById('user-persona-nickname').value.trim();
            const persona = document.getElementById('user-persona-desc').value.trim();
            const avatar = modalAvatarPreview.src;
            
            if (!realName || !nickname) {
                showToast('真名和昵称不能为空');
                return;
            }
            
            if (!db.userPersonas) db.userPersonas =[];
            
            // 永远都是新建
            const newPersona = {
                id: Date.now().toString() + Math.random().toString().slice(2, 6),
                realName: realName,
                nickname: nickname,
                persona: persona,
                status: '在线',
                avatar: avatar
            };
            db.userPersonas.push(newPersona);
            showToast('档案创建成功');
            
            if (typeof saveUserPersonaTable === 'function') {
                await saveUserPersonaTable();
            }
            
            renderContacts();
            document.getElementById('user-persona-modal').classList.remove('visible');
        });
    }

    if (modalCancelBtn) {
        modalCancelBtn.addEventListener('click', () => {
            document.getElementById('user-persona-modal').classList.remove('visible');
        });
    }



    // 编辑已有档案的独立页面逻辑已迁移至 user_info.js -> setupUserPersonaScreen()
}

// 辅助函数：打开选择档案模态框 (给 settings.js 和 addChat 用)
// --- 放在 chat_list.js 文件的最底部 ---

window.openSelectPersonaModal = function(callback) {
    const modal = document.getElementById('select-persona-modal');
    const list = document.getElementById('select-persona-list');
    const closeBtn = document.getElementById('close-select-persona-btn');
    
    // 清空旧列表
    list.innerHTML = '';
    
    if(!db.userPersonas || db.userPersonas.length === 0) {
        list.innerHTML = '<p style="text-align:center;padding:20px;color:#999;">暂无档案，请去“我”的页面创建</p>';
    } else {
        db.userPersonas.forEach(p => {
            const li = document.createElement('li');
            li.className = 'list-item';
            // 添加点击反馈样式
            li.style.cssText = 'display:flex; align-items:center; padding:10px; border-bottom:1px solid #eee; cursor:pointer;';
            li.innerHTML = `
                <img src="${p.avatar}" style="width:40px;height:40px;border-radius:50%;margin-right:10px;object-fit:cover;">
                <div>
                    <div style="font-weight:bold">${p.nickname}</div>
                    <div style="font-size:12px;color:#888">真名: ${p.realName}</div>
                </div>
            `;
            li.onclick = () => {
                callback(p);
                modal.classList.remove('visible');
            };
            list.appendChild(li);
        });
    }
    
    modal.classList.add('visible');
    
    // 绑定关闭按钮（防止重复绑定，用 onclick 覆盖）
    closeBtn.onclick = () => {
        modal.classList.remove('visible');
        callback(null); // 取消时回调 null
    };
    
    // 点击背景关闭
    modal.onclick = (e) => {
        if(e.target === modal) {
            modal.classList.remove('visible');
            callback(null);
        }
    };
}