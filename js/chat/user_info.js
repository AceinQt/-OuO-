// --- START OF FILE user_info.js ---

function setupUserPersonaScreen() {
    const personaScreen = document.getElementById('persona-edit-screen');
    if (!personaScreen) return;
    
    // 监听输入，实现自适应撑开高度
    const personaStatusInput = document.getElementById('persona-edit-status');
    if (personaStatusInput) {
        personaStatusInput.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = this.scrollHeight + 'px';
        });
    }

    // 1. 返回按钮
const backBtn = document.getElementById('persona-edit-back-btn');
if (backBtn) {
    const newBackBtn = backBtn.cloneNode(true);
    backBtn.parentNode.replaceChild(newBackBtn, backBtn);
    newBackBtn.addEventListener('click', () => {
        const source = personaScreen.dataset.source; // ← 补上这行
        if (source === 'chat-room') {
            switchScreen('chat-room-screen');
        } else if (source === 'group-info') {
            _returnToGroupInfoScreen();
        } else {
            goBackToContacts();
        }
    });
}

    // 2. 头像上传
    const personaAvatarUpload = document.getElementById('persona-edit-avatar-upload');
    const personaAvatarPreview = document.getElementById('persona-edit-avatar-preview');

    if (personaAvatarUpload) {
        personaAvatarUpload.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            try {
                if (typeof compressImage === 'function') {
                    personaAvatarPreview.src = await compressImage(file, { quality: 0.8, maxWidth: 400, maxHeight: 400 });
                } else {
                    const reader = new FileReader();
                    reader.onload = (ev) => { personaAvatarPreview.src = ev.target.result; };
                    reader.readAsDataURL(file);
                }
                const heroBg = document.getElementById('persona-edit-hero-bg');
                if (heroBg) heroBg.style.backgroundImage = `url(${personaAvatarPreview.src})`;
            } catch (err) {
                if (typeof showToast === 'function') showToast('头像处理失败');
            }
        });
    }

    // 3. 保存表单
    const personaForm = document.getElementById('persona-edit-form');
    if (personaForm) {
        personaForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const realName = document.getElementById('persona-edit-realname').value.trim();
            const nickname = document.getElementById('persona-edit-nickname').value.trim();
            const persona  = document.getElementById('persona-edit-desc').value.trim();
            const avatar   = personaAvatarPreview.src;
            const status   = (document.getElementById('persona-edit-status')?.value ?? '').trim();

            if (!realName || !nickname) {
                showToast('姓名和昵称不能为空');
                return;
            }

            if (window._currentPersonaIdToEdit) {
                const existingPersona = db.userPersonas.find(p => p.id === window._currentPersonaIdToEdit);
                if (existingPersona) {
                    const oldStatus = existingPersona.status ?? '';

                    existingPersona.realName = realName;
                    existingPersona.nickname = nickname;
                    existingPersona.persona  = persona;
                    existingPersona.avatar   = avatar;
                    existingPersona.status   = status;

                    if (db.characters) {
                        db.characters.forEach(char => {
                            if (char.boundPersonaId === existingPersona.id) {
                                char.myName     = realName;
                                char.myNickname = nickname;
                                char.myPersona  = persona;
                                char.myAvatar   = avatar;
                            }
                        });
                    }
                    if (db.groups) {
                        db.groups.forEach(group => {
                            if (group.me && group.me.boundPersonaId === existingPersona.id) {
                                group.me.realName = realName;
                                group.me.persona  = persona;
                                group.me.avatar   = avatar;
                            }
                        });
                    }
                    // 同步论坛身份：论坛"我"页面绑定了该档案时，姓名/人设跟随变动
                    if (db.forumUserIdentity && db.forumUserIdentity.boundPersonaId === existingPersona.id) {
                        db.forumUserIdentity.realName = realName;
                        db.forumUserIdentity.persona  = persona;
                        if (typeof saveForumMeta === 'function') {
                            await saveForumMeta();
                        }
                    }

                    // 状态有变更时向所有涉及该档案的聊天推送通知
                    if (status !== oldStatus) {
                        await _pushUserStatusNotification(existingPersona);
                    }

                    showToast('档案已更新');
                }
            }

            if (typeof saveUserPersonaTable === 'function') await saveUserPersonaTable();

            try {
                if (db.characters && db.characters.length > 0) {
                    const safeChars = db.characters.map(c => {
                        const o = { ...c };
                        if (window.isMessageMigrated) delete o.history;
                        return o;
                    });
                    if (typeof dexieDB !== 'undefined' && dexieDB.characters) {
                        await dexieDB.characters.bulkPut(safeChars);
                    }
                }
                if (db.groups && db.groups.length > 0) {
                    const safeGroups = db.groups.map(g => {
                        const o = { ...g };
                        if (window.isMessageMigrated) delete o.history;
                        return o;
                    });
                    if (typeof dexieDB !== 'undefined' && dexieDB.groups) {
                        await dexieDB.groups.bulkPut(safeGroups);
                    }
                }
            } catch (err) {
                console.error('同步角色/群组数据失败:', err);
            }

            if (typeof renderContacts === 'function') renderContacts();

            const source = personaScreen.dataset.source;
if (source === 'chat-room') {
    switchScreen('chat-room-screen');
    if (typeof loadSettingsToSidebar === 'function') loadSettingsToSidebar();
} else if (source === 'group-info') {
    _returnToGroupInfoScreen();  // ← 重新渲染，避免群主信息显示旧值
} else {
    goBackToContacts();
}
        });
    }

    // 4. 删除档案
    const personaDeleteBtn = document.getElementById('persona-edit-delete-btn');
    if (personaDeleteBtn) {
        personaDeleteBtn.addEventListener('click', async () => {
            if (!window._currentPersonaIdToEdit) return;
            const p = db.userPersonas.find(x => x.id === window._currentPersonaIdToEdit);
            if (!p) return;

            const isBound = db.characters.some(c => c.boundPersonaId === p.id) ||
                            db.groups.some(g => g.me && g.me.boundPersonaId === p.id);
            if (isBound) {
                showToast('该档案已绑定聊天，无法删除');
                return;
            }

            if (await AppUI.confirm(`确定要删除档案"${p.nickname}"吗？`, '系统提示', '确认', '取消')) {
                if (typeof dexieDB !== 'undefined' && dexieDB.userPersonas) {
                    await dexieDB.userPersonas.delete(p.id);
                }
                db.userPersonas = db.userPersonas.filter(x => x.id !== p.id);
                // 论坛身份若绑定了该档案，解除绑定（内容保留）
                if (db.forumUserIdentity && db.forumUserIdentity.boundPersonaId === p.id) {
                    db.forumUserIdentity.boundPersonaId = null;
                    if (typeof saveForumMeta === 'function') await saveForumMeta();
                }
                if (typeof renderContacts === 'function') renderContacts();
                showToast('档案已删除');
                goBackToContacts();
            }
        });
    }

    // 5. Tab 切换（事件委托）
    const tabBar = personaScreen.querySelector('.char-info-tab-bar');
    if (tabBar) {
        tabBar.addEventListener('click', (e) => {
            const btn = e.target.closest('.char-info-tab-btn');
            if (!btn) return;
            const tab = btn.dataset.tab;
            personaScreen.querySelectorAll('.char-info-tab-btn').forEach(b => b.classList.remove('active'));
            personaScreen.querySelectorAll('.char-info-tab-panel').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            const panel = personaScreen.querySelector(`.char-info-tab-panel[data-panel="${tab}"]`);
            if (panel) panel.classList.add('active');
        });
    }
}

// 返回群信息页时重新渲染（群主名片可能刚绑定/编辑过档案），仅切屏会显示旧值
function _returnToGroupInfoScreen() {
    const infoScreen = document.getElementById('group-info-screen');
    const group = infoScreen && db.groups
        ? db.groups.find(g => g.id === infoScreen.dataset.groupId)
        : null;
    if (group && typeof openGroupInfoScreen === 'function') {
        openGroupInfoScreen(group, infoScreen.dataset.source || '');
    } else {
        switchScreen('group-info-screen');
    }
}

/**
 * 向所有绑定该档案的私聊和群聊推送一条用户状态更新的系统通知消息。
 * 格式 [nickname更新状态为：status] 在 chat_list / chat_room 的 invisibleRegex 中均已覆盖，
 * 不会增加未读计数、不出现在聊天列表预览中，行为与角色状态更新一致。
 */
async function _pushUserStatusNotification(persona) {
    if (!persona || !persona.status) return;

    const notifContent = `[${persona.realName}更新状态为：${persona.status}]`;
    const now = Date.now();
    const savePromises = [];

    (db.characters || []).forEach(char => {
        if (char.boundPersonaId !== persona.id) return;
        const msg = {
    id: `msg_status_${now}_${char.id}`,
    role: 'user',
    content: notifContent,
    timestamp: now,
    isAiIgnore: false,
    isUserStatusNotif: true   // ← 新增
};
        if (!char.history) char.history = [];
        char.history.push(msg);
        if (typeof saveMessageToDB === 'function')
            savePromises.push(saveMessageToDB(msg, char.id, 'private').catch(console.warn));
        if (typeof saveSingleChat === 'function')
            savePromises.push(saveSingleChat(char.id, 'private').catch(console.warn));
    });

    (db.groups || []).forEach(group => {
        if (!group.me || group.me.boundPersonaId !== persona.id) return;
        const msg = {
            id: `msg_status_${now}_${group.id}`,
            role: 'user',
            content: notifContent,
            timestamp: now,
            isAiIgnore: true
        };
        if (!group.history) group.history = [];
        group.history.push(msg);
        if (typeof saveMessageToDB === 'function')
            savePromises.push(saveMessageToDB(msg, group.id, 'group').catch(console.warn));
        if (typeof saveSingleChat === 'function')
            savePromises.push(saveSingleChat(group.id, 'group').catch(console.warn));
    });

    await Promise.all(savePromises);
    if (typeof renderChatList === 'function') renderChatList();
}

// 打开并填充用户档案编辑页
function openUserPersonaScreen(persona = null, source = '') {
    if (!persona) return;

    const screen = document.getElementById('persona-edit-screen');
    screen.dataset.source = source;

    if (typeof switchScreen === 'function') switchScreen('persona-edit-screen');

    window._currentPersonaIdToEdit = persona.id;

    document.getElementById('persona-edit-avatar-preview').src = persona.avatar || '';
    document.getElementById('persona-edit-nickname').value     = persona.nickname || '';
    document.getElementById('persona-edit-realname').value     = persona.realName || '';
    document.getElementById('persona-edit-desc').value         = persona.persona || '';

    const statusEl = document.getElementById('persona-edit-status');
    if (statusEl) {
        statusEl.value = persona.status || '';
        // 渲染下一帧计算实际高度以撑开内容
        requestAnimationFrame(() => {
            statusEl.style.height = 'auto';
            if (statusEl.scrollHeight > 0) {
                statusEl.style.height = statusEl.scrollHeight + 'px';
            }
        });
    }

    // 同步模糊背景
    const heroBg = document.getElementById('persona-edit-hero-bg');
    if (heroBg) heroBg.style.backgroundImage = persona.avatar ? `url(${persona.avatar})` : '';

    // 每次打开重置回第一个 tab
    screen.querySelectorAll('.char-info-tab-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
    screen.querySelectorAll('.char-info-tab-panel').forEach((p, i) => p.classList.toggle('active', i === 0));
}

window.setupUserPersonaScreen = setupUserPersonaScreen;
window.openUserPersonaScreen  = openUserPersonaScreen;

// --- END OF FILE user_info.js ---
