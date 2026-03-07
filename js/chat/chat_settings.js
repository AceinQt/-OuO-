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
                        showToast('已选择新身份，请记得点击下方“保存设置”');
                    }
                });
            } else {
                showToast("功能未就绪，请刷新页面");
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
                        await saveData();
                        showToast('聊天背景已更换');
                    } catch (error) {
                        showToast('背景压缩失败，请重试');
                    }
                }
            }
        });
    }

    const clearChatHistoryBtn = document.getElementById('clear-chat-history-btn');
    if (clearChatHistoryBtn) {
        clearChatHistoryBtn.addEventListener('click', async () => {
            const character = db.characters.find(c => c.id === currentChatId);
            if (!character) return;
            if (await AppUI.confirm(`你确定要清空与“${character.remarkName}”的所有聊天记录吗？这个操作是不可恢复的！`, "系统提示", "确认", "取消")) {
                character.history =[];
                character.status = '在线';
                await saveData();
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
            await saveData();
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
        document.getElementById('setting-char-real-name').value = e.realName || '';
        document.getElementById('setting-char-persona').value = e.persona;
        
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
        document.getElementById('setting-max-memory').value = e.maxMemory;
        document.getElementById('setting-bilingual-mode').checked = e.bilingualModeEnabled || false;

        // 【核心变更】读取当前气泡预设并映射到选择框
        window.populateChatThemeSelects();
        const themeSelect = document.getElementById('setting-theme-color');
        
        // 如果当前并不是名为 default 或 默认，则去尝试回显它原本的主题名
        if (e.useCustomBubbleCss && e.bubbleThemeName && e.bubbleThemeName !== 'default' && e.bubbleThemeName !== '默认') {
            const optExists = Array.from(themeSelect.options).some(o => o.value === `preset:${e.bubbleThemeName}`);
            themeSelect.value = optExists ? `preset:${e.bubbleThemeName}` : 'default';
        } else {
            // 不然全部回显为默认
            themeSelect.value = 'default';
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

        // 【核心变更】保存预设：让 default 也能够去读取自制的外观！
        const themeVal = document.getElementById('setting-theme-color').value;
        
        if (themeVal === 'default') {
            const defaultPreset = _getBubblePresets().find(p => p.name === '默认');
            e.theme = 'white_blue';
            
            // 简化逻辑：直接获取，由 !! 判断真伪
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

        await saveData();
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