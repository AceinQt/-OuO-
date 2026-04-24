// --- START OF FILE chat_settings.js Snippet ---

function setupChatSettings() {
    // 初始化气泡下拉框
    if (typeof window.populateChatThemeSelects === 'function') {
        window.populateChatThemeSelects();
    }

    const chatSettingsBtn = document.getElementById('chat-settings-btn');
    if (chatSettingsBtn) {
        chatSettingsBtn.addEventListener('click', () => {
            if (currentChatType === 'private') {
                loadSettingsToSidebar();
                settingsSidebar.classList.add('open');
            } else if (currentChatType === 'group') {
                if(typeof loadGroupSettingsToSidebar === 'function') loadGroupSettingsToSidebar();
                groupSettingsSidebar.classList.add('open');
            }
        });
    }

    const phoneScreen = document.querySelector('.phone-screen');
    if (phoneScreen) {
        phoneScreen.addEventListener('click', e => {
            const openSidebar = document.querySelector('.settings-sidebar.open');
            if (openSidebar && !openSidebar.contains(e.target) && !e.target.closest('.action-btn') && !e.target.closest('.modal-overlay') && !e.target.closest('.action-sheet-overlay')) {
                openSidebar.classList.remove('open');
            }
        });
    }

    const settingsForm = document.getElementById('chat-settings-form');
    if (settingsForm) {
        settingsForm.addEventListener('submit', e => {
            e.preventDefault();
            saveSettingsFromSidebar();
            settingsSidebar.classList.remove('open');
        });
    }

    const groupSettingsForm = document.getElementById('group-settings-form');
    if(groupSettingsForm) {
        groupSettingsForm.addEventListener('submit', e => {
            e.preventDefault();
            if(typeof saveGroupSettingsFromSidebar === 'function') saveGroupSettingsFromSidebar();
            groupSettingsSidebar.classList.remove('open');
        });
    }

    const charAvatarUpload = document.getElementById('setting-char-avatar-upload');
    if (charAvatarUpload) {
        charAvatarUpload.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                try {
                    const compressedUrl = await compressImage(file, { quality: 0.8, maxWidth: 400, maxHeight: 400 });
                    document.getElementById('setting-char-avatar-preview').src = compressedUrl;
                } catch (error) {
                    showToast('头像压缩失败，请重试');
                }
            }
        });
    }

    // 更换我的身份按钮逻辑
    const bindBtn = document.getElementById('bind-user-persona-btn');
    if(bindBtn) {
        const newBindBtn = bindBtn.cloneNode(true);
        bindBtn.parentNode.replaceChild(newBindBtn, bindBtn);
        newBindBtn.addEventListener('click', () => {
            if(typeof window.openSelectPersonaModal === 'function') {
                window.openSelectPersonaModal((selectedPersona) => {
                    if(selectedPersona) {
                        const myAvatarPreview = document.getElementById('setting-my-avatar-preview');
                        const myNicknameDisplay = document.getElementById('setting-my-nickname-display');
                        const myRealnameDisplay = document.getElementById('setting-my-realname-display');
                        const myPersonaInput = document.getElementById('setting-my-persona');
                        const form = document.getElementById('chat-settings-form');

                        if(myAvatarPreview) myAvatarPreview.src = selectedPersona.avatar;
                        if(myNicknameDisplay) myNicknameDisplay.textContent = selectedPersona.nickname;
                        if(myRealnameDisplay) myRealnameDisplay.textContent = selectedPersona.realName; 
                        if(myPersonaInput) myPersonaInput.value = selectedPersona.persona;
                        
                        if(form) form.dataset.pendingBindId = selectedPersona.id;
                        showToast('已选择新身份，请记得点击下方"保存设置"');
                    }
                });
            } else {
                showToast("功能未就绪，请刷新页面");
            }
        });
    }
    
        // ================= 侧边栏快捷操作按钮 =================
    
    // 1. 编辑我的用户身份档案
    const editUserPersonaBtn = document.getElementById('edit-user-persona-btn');
    if (editUserPersonaBtn) {
        editUserPersonaBtn.addEventListener('click', () => {
            const char = db.characters.find(c => c.id === currentChatId);
            if (char && char.boundPersonaId) {
                const persona = db.userPersonas.find(p => p.id === char.boundPersonaId);
                if (persona) {
                    document.getElementById('chat-settings-sidebar').classList.remove('open'); // 关闭侧边栏
                    if (typeof openUserPersonaScreen === 'function') openUserPersonaScreen(persona, 'chat-room');
                } else {
                    showToast('未找到绑定的身份档案，请重新绑定');
                }
            } else {
                showToast('请先绑定一个身份档案');
            }
        });
    }

    // 2. 偷看角色手机
    const sidebarPeekBtn = document.getElementById('sidebar-peek-btn');
    if (sidebarPeekBtn) {
        sidebarPeekBtn.addEventListener('click', () => {
            document.getElementById('chat-settings-sidebar').classList.remove('open');
            document.getElementById('peek-screen').dataset.source = 'chat-room'; // 标记来源
            if (typeof window.openPeekScreen === 'function') {
                window.openPeekScreen(currentChatId);
            }
        });
    }

    // 3. 编辑角色信息
    const sidebarEditCharBtn = document.getElementById('sidebar-edit-char-btn');
    if (sidebarEditCharBtn) {
        sidebarEditCharBtn.addEventListener('click', () => {
            const char = db.characters.find(c => c.id === currentChatId);
            if (char) {
                document.getElementById('chat-settings-sidebar').classList.remove('open');
                // ✅ source 改为通过参数传入，不再手动设置 dataset，防止脏值残留
                if (typeof openCharacterScreen === 'function') openCharacterScreen(char, 'chat-room');
            }
        });
    }

    const chatBgUpload = document.getElementById('setting-chat-bg-upload');
    if (chatBgUpload) {
        chatBgUpload.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                const char = db.characters.find(c => c.id === currentChatId);
                if (char) {
                    try {
                        const compressedUrl = await compressImage(file, { quality: 0.85, maxWidth: 1080, maxHeight: 1920 });
                        char.chatBg = compressedUrl;
                        document.getElementById('chat-room-screen').style.backgroundImage = `url(${compressedUrl})`;
                        await saveSingleChat(currentChatId, currentChatType);
                        showToast('聊天背景已更换');
                    } catch (error) {
                        showToast('背景压缩失败，请重试');
                    }
                }
            }
        });
    }

    // 最大记忆轮数：点击菜单唤起输入弹窗
    const maxMemoryItem = document.getElementById('setting-max-memory-item');
    if (maxMemoryItem) {
        maxMemoryItem.addEventListener('click', async () => {
            const currentVal = document.getElementById('setting-max-memory').value || 10;
            const result = await AppUI.prompt("请输入最大记忆轮数", currentVal, "最大记忆轮数", "确定", "取消");
            if (result !== null) {
                const num = parseInt(result, 10);
                if (!isNaN(num) && num > 0) {
                    document.getElementById('setting-max-memory').value = num;
                    document.getElementById('setting-max-memory-display').textContent = num;
                } else {
                    showToast('请输入有效的正整数');
                }
            }
        });
    }
    
    const clearChatHistoryBtn = document.getElementById('clear-chat-history-btn');
    if (clearChatHistoryBtn) {
        clearChatHistoryBtn.addEventListener('click', async () => {
            const character = db.characters.find(c => c.id === currentChatId);
            if (!character) return;
            if (await AppUI.confirm(`你确定要清空与"${character.remarkName}"的所有聊天记录吗？这个操作是不可恢复的！`, "系统提示", "确认", "取消")) {
                character.history =[];
                character.status = '在线';
                await clearChatHistoryInDB(currentChatId);
                await saveSingleChat(currentChatId, currentChatType);
                renderMessages(false, true);
                renderChatList();
                if (currentChatId === character.id) {
                    document.getElementById('chat-room-status-text').textContent = '在线';
                }
                document.getElementById('chat-settings-sidebar').classList.remove('open');
                showToast('聊天记录已清空');
            }
        });
    }

    const linkWorldBookBtn = document.getElementById('link-world-book-btn');
    if (linkWorldBookBtn) {
        linkWorldBookBtn.addEventListener('click', () => {
            const character = db.characters.find(c => c.id === currentChatId);
            if (!character) return;
            renderCategorizedWorldBookList(document.getElementById('world-book-selection-list'), db.worldBooks, character.worldBookIds ||[], 'wb-select');
            document.getElementById('world-book-selection-modal').classList.add('visible');
        });
    }

    const saveWorldBookSelectionBtn = document.getElementById('save-world-book-selection-btn');
    if (saveWorldBookSelectionBtn) {
        saveWorldBookSelectionBtn.addEventListener('click', async () => {
            const selectedIds = Array.from(document.getElementById('world-book-selection-list').querySelectorAll('.item-checkbox:checked')).map(input => input.value);
            if (currentChatType === 'private') {
                const character = db.characters.find(c => c.id === currentChatId);
                if (character) character.worldBookIds = selectedIds;
            } else if (currentChatType === 'group') {
                const group = db.groups.find(g => g.id === currentChatId);
                if (group) group.worldBookIds = selectedIds;
            }
            await saveSingleChat(currentChatId, currentChatType);
            document.getElementById('world-book-selection-modal').classList.remove('visible');
            showToast('世界书关联已更新');
        });
    }
}
            
// --- 替换 loadSettingsToSidebar 函数 ---
function loadSettingsToSidebar() {
    const e = db.characters.find(c => c.id === currentChatId);
    if (e) {
        document.getElementById('setting-char-avatar-preview').src = e.avatar;
        document.getElementById('setting-char-remark').value = e.remarkName;
        const charRemarkDisplay = document.getElementById('setting-char-remark-display');
        if (charRemarkDisplay) charRemarkDisplay.textContent = e.remarkName;
        document.getElementById('setting-char-real-name').value = e.realName || '';
        document.getElementById('setting-char-persona').value = e.persona;
        
        // --- Added for Address Book update: make character persona read-only in sidebar ---
        const charRealNameInput = document.getElementById('setting-char-real-name');
        const charRemarkInput = document.getElementById('setting-char-remark');
        const charPersonaInput = document.getElementById('setting-char-persona');
        const charAvatarLabel = document.querySelector('label[for="setting-char-avatar-upload"]');
        
        if (charRealNameInput) charRealNameInput.readOnly = true;
        if (charRemarkInput) charRemarkInput.readOnly = true;
        if (charPersonaInput) charPersonaInput.readOnly = true;
        if (charAvatarLabel) charAvatarLabel.style.display = 'none';
                
        let myAvatar = e.myAvatar;
        let myRealName = e.myName;
        let myNickname = e.myNickname || e.myName;
        let myPersona = e.myPersona;

        if (e.boundPersonaId) {
            const p = db.userPersonas.find(up => up.id === e.boundPersonaId);
            if (p) {
                myAvatar = p.avatar; myRealName = p.realName; myNickname = p.nickname; myPersona = p.persona;
            }
        }

        document.getElementById('setting-my-avatar-preview').src = myAvatar;
        document.getElementById('setting-my-nickname-display').textContent = myNickname;
        document.getElementById('setting-my-realname-display').textContent = myRealName;
        document.getElementById('setting-my-persona').value = myPersona;
        document.getElementById('chat-settings-form').dataset.pendingBindId = e.boundPersonaId || '';

        document.getElementById('setting-max-memory').value = e.maxMemory || 10;
        const maxMemDisplay = document.getElementById('setting-max-memory-display');
        if (maxMemDisplay) {
            maxMemDisplay.textContent = e.maxMemory || 10;
        }
        
        document.getElementById('setting-bilingual-mode').checked = e.bilingualModeEnabled || false;
        const timePEl = document.getElementById('setting-time-perception');
        if (timePEl) timePEl.checked = e.timePerceptionEnabled || false; 
        
        // 【核心变更】读取当前气泡预设并映射到选择框
        window.populateChatThemeSelects();
        const themeSelect = document.getElementById('setting-theme-color');
        
        if (e.useCustomBubbleCss && e.bubbleThemeName && e.bubbleThemeName !== 'default' && e.bubbleThemeName !== '默认') {
            const optExists = Array.from(themeSelect.options).some(o => o.value === `preset:${e.bubbleThemeName}`);
            themeSelect.value = optExists ? `preset:${e.bubbleThemeName}` : 'default';
        } else {
            themeSelect.value = 'default';
        }

        // 👇【修复】：在侧边栏打开时填充 API 预设下拉框，并回显角色的配置
        const apiPresetSel = document.getElementById('setting-chat-api-preset');
        if (apiPresetSel) {
            if (typeof window.populateChatApiPresetSelect === 'function') {
                window.populateChatApiPresetSelect(apiPresetSel);
            } else {
                const presets = (db.apiPresets || []).filter(p => !p.type || p.type === 'chat');
                apiPresetSel.innerHTML = '<option value="">全局默认</option>';
                presets.forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p.name; opt.textContent = p.name;
                    apiPresetSel.appendChild(opt);
                });
            }
            apiPresetSel.value = e.chatApiPreset || '';
        }
    }
}
            
// --- 替换 saveSettingsFromSidebar 函数 ---
async function saveSettingsFromSidebar() {
    const e = db.characters.find(c => c.id === currentChatId);
    if (e) {
        e.avatar = document.getElementById('setting-char-avatar-preview').src;
        e.realName = document.getElementById('setting-char-real-name').value;
        e.remarkName = document.getElementById('setting-char-remark').value;
        e.persona = document.getElementById('setting-char-persona').value;
        
        const pendingBindId = document.getElementById('chat-settings-form').dataset.pendingBindId;
        if (pendingBindId) {
            e.boundPersonaId = pendingBindId;
            const p = db.userPersonas.find(up => up.id === pendingBindId);
            if(p) { e.myAvatar = p.avatar; e.myName = p.realName; e.myNickname = p.nickname; e.myPersona = p.persona; }
        }
        
        e.maxMemory = document.getElementById('setting-max-memory').value;
        e.bilingualModeEnabled = document.getElementById('setting-bilingual-mode').checked;
        const timePEl = document.getElementById('setting-time-perception');
        if (timePEl) e.timePerceptionEnabled = timePEl.checked;

        // 保存预设
        const themeVal = document.getElementById('setting-theme-color').value;
        
        if (themeVal === 'default') {
            const defaultPreset = _getBubblePresets().find(p => p.name === '默认');
            e.theme = 'white_blue';
            e.customBubbleCss = (defaultPreset && defaultPreset.css) ? defaultPreset.css : '';
            e.useCustomBubbleCss = !!e.customBubbleCss;
            e.bubbleThemeName = 'default';
        } else if (themeVal.startsWith('preset:')) {
            const presetName = themeVal.replace('preset:', '');
            const preset = _getBubblePresets().find(p => p.name === presetName);
            if (preset) {
                e.theme = 'white_blue';
                e.useCustomBubbleCss = true;
                e.customBubbleCss = preset.css;
                e.bubbleThemeName = presetName;
            }
        }

        // 👇【修复】：在此处将下拉框选中的 API 预设名称写入数据库
        const apiPresetSel = document.getElementById('setting-chat-api-preset');
        if (apiPresetSel) {
            e.chatApiPreset = apiPresetSel.value;
        }

        await saveSingleChat(currentChatId, currentChatType);
        showToast('设置已保存！');
        chatRoomTitle.textContent = e.remarkName;
        renderChatList();
        updateCustomBubbleStyle(currentChatId, e.customBubbleCss, e.useCustomBubbleCss);
        currentPage = 1;
        renderMessages(false, true);
    }
}
            
// --- 在 chat_settings.js 中寻找并替换 ---
function updateCustomBubbleStyle(chatId, css, enabled) {
    const styleId = `custom-bubble-style-for-${chatId}`;
    let styleElement = document.getElementById(styleId);

    if (enabled && css) {
        if (!styleElement) {
            styleElement = document.createElement('style');
            styleElement.id = styleId;
            document.head.appendChild(styleElement);
        }

        const scope = `#chat-room-screen.chat-active-${chatId}`;
        let finalCss = '';

        const rootRegex = /:root\s*\{([\s\S]*?)\}/;
        const rootMatch = css.match(rootRegex);
        if (rootMatch && rootMatch[1]) {
            const rootVars = rootMatch[1].trim();
            if (rootVars) {
                finalCss += `${scope} { ${rootVars} }\n`;
            }
        }

        // 👇【核心修复】：增加 .replace(/\/\*[\s\S]*?\*\//g, '') 彻底剔除带有 {} 的 META 注释！
        let remainingCss = css
            .replace(/\/\*[\s\S]*?\*\//g, '') 
            .replace(rootRegex, '')
            .replace(/@keyframes[\s\S]*?(\}\s*\}|\})/g, '')
            .replace(/@font-face[\s\S]*?\}/g, '');

        const ruleRegex = /([^{}]+?)\s*\{([^{}]+?)\}/g;
        let match;
        while ((match = ruleRegex.exec(remainingCss)) !== null) {
            const selectors = match[1].trim();
            const properties = match[2].trim();

            if (selectors && properties) {
                const scopedSelectors = selectors
                    .split(',')
                    .map(s => s.trim())
                    .filter(s => s && !s.startsWith('@'))
                    .map(s => {
                        if (s.includes('#chat-room-screen')) {
                            return s.replace('#chat-room-screen', scope);
                        } else {
                            return `${scope} ${s}`;
                        }
                    })
                    .join(', ');

                if (scopedSelectors) {
                    finalCss += `${scopedSelectors} { ${properties} }\n`;
                }
            }
        }
        styleElement.innerHTML = finalCss;
    } else {
        if (styleElement) {
            styleElement.remove();
        }
    }
}
