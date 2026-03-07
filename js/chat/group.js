const createGroupBtn = document.getElementById('create-group-btn'),
    createGroupModal = document.getElementById('create-group-modal'),
    createGroupForm = document.getElementById('create-group-form'),
    memberSelectionList = document.getElementById('member-selection-list'),
    groupNameInput = document.getElementById('group-name-input'),
    groupSettingsSidebar = document.getElementById('group-settings-sidebar'),
    groupSettingsForm = document.getElementById('group-settings-form'),
    groupMembersListContainer = document.getElementById('group-members-list-container'),
    editGroupMemberModal = document.getElementById('edit-group-member-modal'),
    editGroupMemberForm = document.getElementById('edit-group-member-form');

const addMemberActionSheet = document.getElementById('add-member-actionsheet'),
    inviteExistingMemberBtn = document.getElementById('invite-existing-member-btn'),
    createNewMemberBtn = document.getElementById('create-new-member-btn'),
    inviteMemberModal = document.getElementById('invite-member-modal'),
    inviteMemberSelectionList = document.getElementById('invite-member-selection-list'),
    confirmInviteBtn = document.getElementById('confirm-invite-btn'),
    createMemberForGroupModal = document.getElementById('create-member-for-group-modal'),
    createMemberForGroupForm = document.getElementById('create-member-for-group-form');

const groupRecipientSelectionModal = document.getElementById('group-recipient-selection-modal'),
    groupRecipientSelectionList = document.getElementById('group-recipient-selection-list'),
    confirmGroupRecipientBtn = document.getElementById('confirm-group-recipient-btn'),
    groupRecipientSelectionTitle = document.getElementById('group-recipient-selection-title');
const linkGroupWorldBookBtn = document.getElementById('link-group-world-book-btn');

// --- GROUP CHAT FUNCTIONS ---
function setupGroupChatSystem() {
    // 1. 打开创建群聊弹窗
    createGroupBtn.addEventListener('click', () => {
        renderMemberSelectionList();
        // 重置表单
        createGroupForm.reset();
        
        // 清空隐藏域
        if(document.getElementById('group-my-persona')) document.getElementById('group-my-persona').value = '';
        if(document.getElementById('group-selected-persona-id')) document.getElementById('group-selected-persona-id').value = '';
        if(document.getElementById('group-my-name')) document.getElementById('group-my-name').value = '';
        if(document.getElementById('group-my-nickname')) document.getElementById('group-my-nickname').value = '';

        // 重置绑定按钮状态
        const bindBtn = document.getElementById('create-group-select-persona-btn');
        if (bindBtn) {
            bindBtn.textContent = '选择群主';
            bindBtn.classList.remove('btn-secondary');
            bindBtn.classList.add('btn-primary');
        }

        createGroupModal.classList.add('visible');
    });

    // 2. 创建群聊弹窗中的“绑定人设”按钮逻辑
    const createGroupBindBtn = document.getElementById('create-group-select-persona-btn');
    if (createGroupBindBtn) {
        // 防止重复绑定，先克隆替换
        const newBtn = createGroupBindBtn.cloneNode(true);
        createGroupBindBtn.parentNode.replaceChild(newBtn, createGroupBindBtn);

        newBtn.addEventListener('click', () => {
            if (typeof window.openSelectPersonaModal === 'function') {
                window.openSelectPersonaModal((p) => {
                    if (p) {
                        // 填充数据
                        document.getElementById('group-selected-persona-id').value = p.id;
                        document.getElementById('group-my-name').value = p.realName;
                        document.getElementById('group-my-nickname').value = p.nickname;
                        document.getElementById('group-my-persona').value = p.persona;

                        // 改变按钮状态
                        newBtn.textContent = `✓ 群主: ${p.nickname}`;
                        newBtn.classList.remove('btn-primary');
                        newBtn.classList.add('btn-secondary');

                        showToast(`已选择群主：${p.nickname}`);
                    }
                });
            }
        });
    }

    // 3. 提交创建群聊
    createGroupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const selectedMemberIds = Array.from(memberSelectionList.querySelectorAll('input:checked')).map(input => input.value);
        const groupName = groupNameInput.value.trim();
        
        // 获取新的字段
        const myRealName = document.getElementById('group-my-name').value.trim();
        const myNickname = document.getElementById('group-my-nickname').value.trim();
        const myPersona = document.getElementById('group-my-persona').value.trim();
        const boundPersonaId = document.getElementById('group-selected-persona-id').value;

        if (selectedMemberIds.length < 1) return showToast('请至少选择一个群成员。');
        if (!groupName) return showToast('请输入群聊名称。');
        if (!myRealName) return showToast('请选择群主。');

        // 尝试获取绑定的头像，如果没有则用默认图
        let myAvatar = 'https://i.postimg.cc/GtbTnxhP/o-o-1.jpg';
        if (boundPersonaId) {
            const p = db.userPersonas.find(up => up.id === boundPersonaId);
            if (p) myAvatar = p.avatar;
        }

        const newGroup = {
            id: `group_${Date.now()}`,
            name: groupName,
            avatar: 'https://i.postimg.cc/fTLCngk1/image.jpg',
            me: {
                realName: myRealName,      // 新增：真名
                nickname: myNickname,      // 昵称
                persona: myPersona,        // 人设
                avatar: myAvatar,          // 头像
                boundPersonaId: boundPersonaId // 绑定ID
            },
            members: selectedMemberIds.map(charId => {
                const char = db.characters.find(c => c.id === charId);
                return {
                    id: `member_${char.id}`,
                    originalCharId: char.id, // 重要：用于同步
                    realName: char.realName,
                    groupNickname: char.remarkName,
                    persona: char.persona,
                    avatar: char.avatar
                };
            }),
            theme: 'white_blue',
            maxMemory: 10,
            chatBg: '',
            history: [],
            isPinned: false,
            unreadCount: 0,
            useCustomBubbleCss: (typeof _getBubblePresets === 'function' && _getBubblePresets().find(p => p.name === '默认')?.css) ? true : false,
            customBubbleCss: (typeof _getBubblePresets === 'function') ? (_getBubblePresets().find(p => p.name === '默认')?.css || '') : '',
            bubbleThemeName: 'default',
            worldBookIds:[]
        };
        db.groups.push(newGroup);
        await saveData();
        renderChatList();
        createGroupModal.classList.remove('visible');
        showToast(`群聊“${groupName}”创建成功！`);
    });

    // 4. 群聊设置表单提交
    groupSettingsForm.addEventListener('submit', e => {
        e.preventDefault();
        saveGroupSettingsFromSidebar();
        groupSettingsSidebar.classList.remove('open');
    });

    // 6. 群头像上传
    document.getElementById('setting-group-avatar-upload').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            try {
                const compressedUrl = await compressImage(file, { quality: 0.8, maxWidth: 400, maxHeight: 400 });
                const group = db.groups.find(g => g.id === currentChatId);
                if (group) {
                    group.avatar = compressedUrl;
                    document.getElementById('setting-group-avatar-preview').src = compressedUrl;
                }
            } catch (error) {
                showToast('群头像压缩失败，请重试');
            }
        }
    });

    // 7. 群背景上传
    document.getElementById('setting-group-chat-bg-upload').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            try {
                const compressedUrl = await compressImage(file, {
                    quality: 0.85,
                    maxWidth: 1080,
                    maxHeight: 1920
                });
                const group = db.groups.find(g => g.id === currentChatId);
                if (group) {
                    group.chatBg = compressedUrl;
                    chatRoomScreen.style.backgroundImage = `url(${compressedUrl})`;
                    await saveData();
                    showToast('聊天背景已更换');
                }
            } catch (error) {
                showToast('群聊背景压缩失败，请重试');
            }
        }
    });

    // 8. 清空记录
    document.getElementById('clear-group-chat-history-btn').addEventListener('click', async () => {
        const group = db.groups.find(g => g.id === currentChatId);
        if (!group) return;
        if (await AppUI.confirm(`你确定要清空群聊“${group.name}”的所有聊天记录吗？这个操作是不可恢复的！`, "系统提示", "确认", "取消")) {
            group.history = [];
            await saveData();
            renderMessages(false, true);
            renderChatList();
            groupSettingsSidebar.classList.remove('open');
            showToast('聊天记录已清空');
        }
    });

    // 9. 群成员点击事件
    groupMembersListContainer.addEventListener('click', e => {
        const memberDiv = e.target.closest('.group-member');
        const addBtn = e.target.closest('.add-member-btn');
        if (memberDiv) {
            openGroupMemberEditModal(memberDiv.dataset.id);
        } else if (addBtn) {
            addMemberActionSheet.classList.add('visible');
        }
    });

    // 10. 编辑成员头像上传
    document.getElementById('edit-member-avatar-preview').addEventListener('click', () => {
        document.getElementById('edit-member-avatar-upload').click();
    });
    document.getElementById('edit-member-avatar-upload').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            try {
                const compressedUrl = await compressImage(file, { quality: 0.8, maxWidth: 400, maxHeight: 400 });
                document.getElementById('edit-member-avatar-preview').src = compressedUrl;
            } catch (error) {
                showToast('成员头像压缩失败，请重试');
            }
        }
    });

    // 11. 提交成员编辑
    editGroupMemberForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const memberId = document.getElementById('editing-member-id').value;
        const group = db.groups.find(g => g.id === currentChatId);
        const member = group.members.find(m => m.id === memberId);
        if (member) {
            await processTimePerception(group, currentChatId, 'group');
            const oldNickname = member.groupNickname;
            const newNickname = document.getElementById('edit-member-group-nickname').value;
            member.avatar = document.getElementById('edit-member-avatar-preview').src;
            member.groupNickname = newNickname;
            member.realName = document.getElementById('edit-member-real-name').value;
            member.persona = document.getElementById('edit-member-persona').value;
                        if (oldNickname !== newNickname) {
               const myName = group.me.realName;
               const messageContent = `[${myName}修改${member.realName}的群昵称为：${newNickname}]`;
               const message = {
                   id: `msg_${Date.now()}`,
                   role: 'user',
                   content: messageContent,
                   parts: [{ type: 'text', text: messageContent }],
                   timestamp: Date.now()
               };
               group.history.push(message);
               addMessageBubble(message, group.id, 'group'); // 立即显示气泡
               showToast('成员昵称已变更');
           }
            
            await saveData();
            renderGroupMembersInSettings(group);
            document.querySelectorAll(`.message-wrapper[data-sender-id="${member.id}"] .group-nickname`).forEach(el => {
                el.textContent = member.groupNickname;
            });
            
        }
        editGroupMemberModal.classList.remove('visible');
    });

    // 12. 邀请/新建成员逻辑
    inviteExistingMemberBtn.addEventListener('click', () => {
        renderInviteSelectionList();
        inviteMemberModal.classList.add('visible');
        addMemberActionSheet.classList.remove('visible');
    });
    createNewMemberBtn.addEventListener('click', () => {
        createMemberForGroupForm.reset();
        document.getElementById('create-group-member-avatar-preview').src = 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg';
        createMemberForGroupModal.classList.add('visible');
        addMemberActionSheet.classList.remove('visible');
    });
    document.getElementById('create-group-member-avatar-preview').addEventListener('click', () => {
        document.getElementById('create-group-member-avatar-upload').click();
    });
    document.getElementById('create-group-member-avatar-upload').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            try {
                const compressedUrl = await compressImage(file, { quality: 0.8, maxWidth: 400, maxHeight: 400 });
                document.getElementById('create-group-member-avatar-preview').src = compressedUrl;
            } catch (error) {
                showToast('新成员头像压缩失败，请重试');
            }
        }
    });
    confirmInviteBtn.addEventListener('click', async () => {
        const group = db.groups.find(g => g.id === currentChatId);
        if (!group) return;
        await processTimePerception(group, currentChatId, 'group');
        const selectedCharIds = Array.from(inviteMemberSelectionList.querySelectorAll('input:checked')).map(input => input.value);
        selectedCharIds.forEach(charId => {
            const char = db.characters.find(c => c.id === charId);
            if (char) {
                const newMember = {
                    id: `member_${char.id}`,
                    originalCharId: char.id,
                    realName: char.realName,
                    groupNickname: char.remarkName,
                    persona: char.persona,
                    avatar: char.avatar
                };
                group.members.push(newMember);
                sendInviteNotification(group, newMember.realName);
            }
        });
        if (selectedCharIds.length > 0) {
            await saveData();
            renderGroupMembersInSettings(group);
            renderMessages(false, true);
            showToast('已邀请新成员');
        }
        inviteMemberModal.classList.remove('visible');
    });
    createMemberForGroupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const group = db.groups.find(g => g.id === currentChatId);
        if (!group) return;
        await processTimePerception(group, currentChatId, 'group');
        const newMember = {
            id: `member_group_only_${Date.now()}`,
            originalCharId: null,
            realName: document.getElementById('create-group-member-realname').value,
            groupNickname: document.getElementById('create-group-member-nickname').value,
            persona: document.getElementById('create-group-member-persona').value,
            avatar: document.getElementById('create-group-member-avatar-preview').src,
        };
        group.members.push(newMember);
        sendInviteNotification(group, newMember.realName);
        await saveData();
        renderGroupMembersInSettings(group);
        renderMessages(false, true);
        showToast(`新成员 ${newMember.realName} 已加入`);
        createMemberForGroupModal.classList.remove('visible');
    });

    // 13. 设置：我的头像上传
    document.getElementById('setting-group-my-avatar-upload').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            try {
                const compressedUrl = await compressImage(file, { quality: 0.8, maxWidth: 400, maxHeight: 400 });
                document.getElementById('setting-group-my-avatar-preview').src = compressedUrl;
            } catch (error) {
                showToast('头像压缩失败')
            }
        }
    });

    // 14. 互动功能：选择接收人
    confirmGroupRecipientBtn.addEventListener('click', () => {
        const selectedRecipientIds = Array.from(groupRecipientSelectionList.querySelectorAll('input:checked')).map(input => input.value);
        if (selectedRecipientIds.length === 0) {
            return showToast('请至少选择一个收件人。');
        }
        currentGroupAction.recipients = selectedRecipientIds;
        groupRecipientSelectionModal.classList.remove('visible');

        if (currentGroupAction.type === 'transfer') {
            const form = document.getElementById('send-transfer-form');
            if(form) form.reset();
            const modal = document.getElementById('send-transfer-modal');
            if(modal) modal.classList.add('visible');
        } else if (currentGroupAction.type === 'gift') {
            const form = document.getElementById('send-gift-form');
            if(form) form.reset();
            const modal = document.getElementById('send-gift-modal');
            if(modal) modal.classList.add('visible');
        }
    });

    // 15. 关联世界书
    linkGroupWorldBookBtn.addEventListener('click', () => {
        const group = db.groups.find(g => g.id === currentChatId);
        if (!group) return;
        renderCategorizedWorldBookList(document.getElementById('world-book-selection-list'), db.worldBooks, group.worldBookIds || [], 'wb-select-group');
        document.getElementById('world-book-selection-modal').classList.add('visible');
    });
}

// --- 辅助函数 ---

function renderMemberSelectionList() {
    memberSelectionList.innerHTML = '';
    if (db.characters.length === 0) {
        memberSelectionList.innerHTML = '<li style="color:#aaa; text-align:center; padding: 10px 0;">没有可选择的人设。</li>';
        return;
    }
    db.characters.forEach(char => {
        const li = document.createElement('li');
        li.className = 'list-item';
        li.innerHTML = `<input type="checkbox" id="select-${char.id}" value="${char.id}"><img src="${char.avatar}" alt="${char.remarkName}"><label for="select-${char.id}">${char.remarkName}（${char.realName}）</label>`;
        memberSelectionList.appendChild(li);
    });
}

function loadGroupSettingsToSidebar() {
    const group = db.groups.find(g => g.id === currentChatId);
    if (!group) return;
    
    document.getElementById('setting-group-avatar-preview').src = group.avatar;
    document.getElementById('setting-group-name').value = group.name;
    
    // --- 填充我的信息 (支持真名和绑定) ---
    // 如果有绑定ID，尝试从全局档案库获取最新数据 (实现同步读取)
    let myAvatar = group.me.avatar;
    let myRealName = group.me.realName || group.me.nickname; // 兼容旧数据
    let myNickname = group.me.nickname;
    let myPersona = group.me.persona;

    if (group.me.boundPersonaId) {
        const p = db.userPersonas.find(up => up.id === group.me.boundPersonaId);
        if (p) {
            myAvatar = p.avatar;
            myRealName = p.realName;
            myPersona = p.persona;
        }
    }

    document.getElementById('setting-group-my-avatar-preview').src = myAvatar;
    document.getElementById('setting-group-my-realname').value = myRealName;
    document.getElementById('setting-group-my-nickname').value = myNickname;
    document.getElementById('setting-group-my-persona').value = myPersona;

    // 存储绑定ID到 form 标签上，方便保存时读取
    document.getElementById('group-settings-form').dataset.pendingBindId = group.me.boundPersonaId || '';

    // --- 绑定按钮逻辑 ---
    const groupBindBtn = document.getElementById('bind-group-user-persona-btn');
    if (groupBindBtn) {
        const newGroupBindBtn = groupBindBtn.cloneNode(true);
        groupBindBtn.parentNode.replaceChild(newGroupBindBtn, groupBindBtn);

        newGroupBindBtn.addEventListener('click', () => {
            if (typeof window.openSelectPersonaModal === 'function') {
                window.openSelectPersonaModal((p) => {
                    if (p) {
                        document.getElementById('setting-group-my-avatar-preview').src = p.avatar;
                        document.getElementById('setting-group-my-realname').value = p.realName;
                        document.getElementById('setting-group-my-nickname').value = p.nickname;
                        document.getElementById('setting-group-my-persona').value = p.persona;
                        // 暂存 ID
                        document.getElementById('group-settings-form').dataset.pendingBindId = p.id;
                        showToast('已选择新身份，请记得保存');
                    }
                });
            }
        });
    }

    document.getElementById('setting-group-max-memory').value = group.maxMemory;
    renderGroupMembersInSettings(group);
    
    // 【核心变更】读取当前气泡预设并映射到选择框
    if (typeof window.populateChatThemeSelects === 'function') {
        window.populateChatThemeSelects();
    }
    const themeSelect = document.getElementById('setting-group-theme-color');
    if (themeSelect) {
        // 【修复】如果群聊当前并不是名为 default 或 默认，则去尝试回显它原本的主题名
        if (group.useCustomBubbleCss && group.bubbleThemeName && group.bubbleThemeName !== 'default' && group.bubbleThemeName !== '默认') {
            const optExists = Array.from(themeSelect.options).some(o => o.value === `preset:${group.bubbleThemeName}`);
            themeSelect.value = optExists ? `preset:${group.bubbleThemeName}` : 'default';
        } else {
            // 不然全部回显为默认
            themeSelect.value = 'default';
        }
    }
}

function renderGroupMembersInSettings(group) {
    groupMembersListContainer.innerHTML = '';
    group.members.forEach(member => {
        const memberDiv = document.createElement('div');
        memberDiv.className = 'group-member';
        memberDiv.dataset.id = member.id;
        memberDiv.innerHTML = `<img src="${member.avatar}" alt="${member.groupNickname}"><span>${member.groupNickname}</span>`;
        groupMembersListContainer.appendChild(memberDiv);
    });
    const addBtn = document.createElement('div');
    addBtn.className = 'add-member-btn';
    addBtn.innerHTML = `<div class="add-icon">+</div><span>添加</span>`;
    groupMembersListContainer.appendChild(addBtn);
}

function renderGroupRecipientSelectionList(actionText) {
    const group = db.groups.find(g => g.id === currentChatId);
    if (!group) return;
    groupRecipientSelectionTitle.textContent = actionText;
    groupRecipientSelectionList.innerHTML = '';
    group.members.forEach(member => {
        const li = document.createElement('li');
        li.className = 'group-recipient-select-item';
        li.innerHTML = `
            <input type="checkbox" id="recipient-select-${member.id}" value="${member.id}">
            <label for="recipient-select-${member.id}">
                <img src="${member.avatar}" alt="${member.groupNickname}">
                <span>${member.groupNickname}</span>
            </label>`;
        groupRecipientSelectionList.appendChild(li);
    });
}

async function saveGroupSettingsFromSidebar() {
    const group = db.groups.find(g => g.id === currentChatId);
    if (!group) return;
    await processTimePerception(group, currentChatId, 'group');
    const oldName = group.name;
    const newName = document.getElementById('setting-group-name').value;
    if (oldName !== newName) {
        group.name = newName;
        sendRenameNotification(group, newName);
    }
    group.avatar = document.getElementById('setting-group-avatar-preview').src;
    
    // --- 保存我的信息 ---
    const pendingBindId = document.getElementById('group-settings-form').dataset.pendingBindId;
    const oldMeNickname = group.me.nickname;
    const newMeNickname = document.getElementById('setting-group-my-nickname').value;
    if (oldMeNickname !== newMeNickname) {
        const messageContent = `[${group.me.realName}将自己的群昵称修改为：${newMeNickname}]`;
        const message = {
            id: `msg_${Date.now()}_self_rename`,
            role: 'user',
            content: messageContent,
            parts:[{ type: 'text', text: messageContent }],
            timestamp: Date.now()
        };
        group.history.push(message);
    }

    group.me.avatar = document.getElementById('setting-group-my-avatar-preview').src;
    group.me.realName = document.getElementById('setting-group-my-realname').value;
    group.me.nickname = document.getElementById('setting-group-my-nickname').value;
    group.me.persona = document.getElementById('setting-group-my-persona').value;

    if (pendingBindId) {
        group.me.boundPersonaId = pendingBindId;
    }
    
    group.maxMemory = document.getElementById('setting-group-max-memory').value;

    // 【核心变更】保存群聊气泡预设
        const themeSelect = document.getElementById('setting-group-theme-color');
    if (themeSelect) {
        const themeVal = themeSelect.value;
        if (themeVal === 'default') {
            // 【修复】让群聊保存 default 时也能够去读取自制的外观！
            const presets = (typeof _getBubblePresets === 'function') ? _getBubblePresets() :[];
            const defaultPreset = presets.find(p => p.name === '默认');
            
            group.theme = 'white_blue';
            // 如果外观里的“默认”确实被修改配有CSS了，我们就让它生效
            if (defaultPreset && defaultPreset.css) {
                group.useCustomBubbleCss = true;
                group.customBubbleCss = defaultPreset.css;
            } else {
                group.useCustomBubbleCss = false;
                group.customBubbleCss = '';
            }
            group.bubbleThemeName = 'default';
            
        } else if (themeVal && themeVal.startsWith('preset:')) {
            const presetName = themeVal.replace('preset:', '');
            // 确保读取预设的函数不会报错
            const presets = (typeof _getBubblePresets === 'function') ? _getBubblePresets() :[];
            const preset = presets.find(p => p.name === presetName);
            if (preset) {
                group.theme = 'white_blue';
                group.useCustomBubbleCss = true;
                group.customBubbleCss = preset.css;
                group.bubbleThemeName = presetName;
            }
        }
    }
    
    // 确保调用 updateCustomBubbleStyle 时函数存在，避免保存时报错
    if (typeof updateCustomBubbleStyle === 'function') {
        updateCustomBubbleStyle(currentChatId, group.customBubbleCss, group.useCustomBubbleCss);
    }
    
    await saveData();
    showToast('群聊设置已保存！');
    chatRoomTitle.textContent = group.name;
    renderChatList();
    renderMessages(false, true);
}

function openGroupMemberEditModal(memberId) {
    const group = db.groups.find(g => g.id === currentChatId);
    const member = group.members.find(m => m.id === memberId);
    if (!member) return;

    document.getElementById('edit-group-member-title').textContent = `修改群昵称`;
    document.getElementById('editing-member-id').value = member.id;

    // 核心逻辑：检查是否关联了原始角色
    let isLinkedCharacter = false;
    let originalChar = null;

    if (member.originalCharId) {
        originalChar = db.characters.find(c => c.id === member.originalCharId);
        if (originalChar) {
            isLinkedCharacter = true;
            // 强制同步：使用原始角色的最新数据
            member.avatar = originalChar.avatar;
            member.realName = originalChar.realName;
            member.persona = originalChar.persona;
        }
    }

    // 填充数据
    document.getElementById('edit-member-avatar-preview').src = member.avatar;
    document.getElementById('edit-member-group-nickname').value = member.groupNickname;
    document.getElementById('edit-member-real-name').value = member.realName;
    document.getElementById('edit-member-persona').value = member.persona;

    // --- 如果是关联角色，禁用关键字段 ---
    const realNameInput = document.getElementById('edit-member-real-name');
    const personaInput = document.getElementById('edit-member-persona');
    const avatarPreview = document.getElementById('edit-member-avatar-preview');

    if (isLinkedCharacter) {
        realNameInput.disabled = true;
        personaInput.disabled = true;
        personaInput.placeholder = "该内容已与角色库同步，无法在群聊中修改。";
        // 禁用头像点击更换
        if(avatarPreview) avatarPreview.style.pointerEvents = 'none';
    } else {
        realNameInput.disabled = false;
        personaInput.disabled = false;
        personaInput.placeholder = "详细描述角色的性格、背景等。";
        if(avatarPreview) avatarPreview.style.pointerEvents = 'auto';
    }

    editGroupMemberModal.classList.add('visible');
}

function renderInviteSelectionList() {
    inviteMemberSelectionList.innerHTML = '';
    const group = db.groups.find(g => g.id === currentChatId);
    if (!group) return;
    const currentMemberCharIds = new Set(group.members.map(m => m.originalCharId));
    const availableChars = db.characters.filter(c => !currentMemberCharIds.has(c.id));
    if (availableChars.length === 0) {
        inviteMemberSelectionList.innerHTML = '<li style="color:#aaa; text-align:center; padding: 10px 0;">没有可邀请的新成员了。</li>';
        confirmInviteBtn.disabled = true;
        return;
    }
    confirmInviteBtn.disabled = false;
    availableChars.forEach(char => {
        const li = document.createElement('li');
        li.className = 'invite-member-select-item';
        li.innerHTML = `<input type="checkbox" id="invite-select-${char.id}" value="${char.id}"><label for="invite-select-${char.id}"><img src="${char.avatar}" alt="${char.remarkName}"><span>${char.remarkName}</span></label>`;
        inviteMemberSelectionList.appendChild(li);
    });
}

function sendInviteNotification(group, newMemberRealName) {
    const messageContent = `[${group.me.realName}邀请${newMemberRealName}加入了群聊]`;
    const message = {
        id: `msg_${Date.now()}`,
        role: 'user',
        content: messageContent,
        parts: [{ type: 'text', text: messageContent }],
        timestamp: Date.now(),
        senderId: 'user_me'
    };
    group.history.push(message);
}

function sendRenameNotification(group, newName) {
    const myName = group.me.realName;
    const messageContent = `[${myName}修改群名为：${newName}]`;
    const message = {
        id: `msg_${Date.now()}`,
        role: 'user',
        content: messageContent,
        parts: [{ type: 'text', text: messageContent }],
        timestamp: Date.now()
    };
    group.history.push(message);
}