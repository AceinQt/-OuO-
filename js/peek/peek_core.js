// ==========================================
// peek_core.js
// 公用常量、删除管理器、工具函数、主屏渲染、设置
// ==========================================

const peekScreenApps = {
    'messages': { name: '消息', url: 'https://i.postimg.cc/Kvs4tDh5/export202509181826424260.png' },
    'memos': { name: '备忘录', url: 'https://i.postimg.cc/JzD0xH1C/export202509181829064550.png' },
    'cart': { name: '购物车', url: 'https://i.postimg.cc/pLwT6VTh/export202509181830143960.png' },
    'transfer': { name: '中转站', url: 'https://i.postimg.cc/63wQBHCB/export202509181831140230.png' },
    'browser': { name: '浏览器', url: 'https://i.postimg.cc/SKcsF02Z/export202509181830445980.png' },
    'drafts': { name: '草稿箱', url: 'https://i.postimg.cc/ZKqC9D2R/export202509181827225860.png' },
    'album': { name: '相册', url: 'https://i.postimg.cc/qBcdpqNc/export202509221549335970.png' },
    'steps': { name: '步数', url: 'https://i.postimg.cc/5NndFrq6/export202509181824532800.png' },
    'unlock': { name: 'unlock！', url: 'https://i.postimg.cc/28zNyYWs/export202509221542593320.png' }
};

// ==========================================
// 全局：正在生成中的应用类型集合（防重复请求）
// ==========================================
const generatingPeekApps = new Set();

// ==========================================
// 多选删除管理器
// ==========================================
window.PeekDeleteManager = {
    isEditMode: false,
    selectedIds: new Set(),
    currentAppType: null,
    currentRenderFunction: null,
    currentDataArrayPath: null,

    enterMode(appType, dataArrayPath, renderFunction, initialId) {
        this.isEditMode = true;
        this.currentAppType = appType;
        this.currentDataArrayPath = dataArrayPath;
        this.currentRenderFunction = renderFunction;
        this.selectedIds.clear();
        if (initialId) this.selectedIds.add(initialId);

        const bar = document.getElementById('peek-delete-bottom-bar');
        if (bar) bar.style.display = 'flex';

        document.body.classList.add('peek-editing-mode');

        const activeScreen = document.querySelector('.screen.active');
        if (activeScreen) {
            const actionBtn = activeScreen.querySelector('.app-header .action-btn');
            if (actionBtn) actionBtn.style.visibility = 'hidden';
        }

        this.updateBottomBar();

        const scrollContainer = activeScreen ? (activeScreen.querySelector('.content') || activeScreen) : null;
        const scrollTop = scrollContainer ? scrollContainer.scrollTop : 0;

        renderFunction();

        if (scrollContainer) {
            requestAnimationFrame(() => {
                const newScrollContainer = document.querySelector('.screen.active .content') || document.querySelector('.screen.active');
                if (newScrollContainer) newScrollContainer.scrollTop = scrollTop;
            });
        }
    },

    exitMode() {
        this.isEditMode = false;
        this.selectedIds.clear();

        const bar = document.getElementById('peek-delete-bottom-bar');
        if (bar) bar.style.display = 'none';

        document.body.classList.remove('peek-editing-mode');

        const activeScreen = document.querySelector('.screen.active');
        if (activeScreen) {
            const actionBtn = activeScreen.querySelector('.app-header .action-btn');
            if (actionBtn) actionBtn.style.visibility = 'visible';
        }

        const scrollContainer = activeScreen ? (activeScreen.querySelector('.content') || activeScreen) : null;
        const scrollTop = scrollContainer ? scrollContainer.scrollTop : 0;

        if (this.currentRenderFunction) this.currentRenderFunction();

        if (scrollContainer) {
            requestAnimationFrame(() => {
                const newScrollContainer = document.querySelector('.screen.active .content') || document.querySelector('.screen.active');
                if (newScrollContainer) newScrollContainer.scrollTop = scrollTop;
            });
        }

        this.currentAppType = null;
        this.currentDataArrayPath = null;
        this.currentRenderFunction = null;
    },

    toggleSelect(id) {
        if (this.selectedIds.has(id)) {
            this.selectedIds.delete(id);
        } else {
            this.selectedIds.add(id);
        }
        this.updateBottomBar();
    },

    updateBottomBar() {
        const countSpan = document.getElementById('peek-delete-count');
        const confirmBtn = document.getElementById('peek-delete-confirm-btn');
        if (this.isEditMode && countSpan) {
            countSpan.innerText = `已选择 ${this.selectedIds.size} 项`;
            if (confirmBtn) confirmBtn.disabled = this.selectedIds.size === 0;
        }
    },

    async executeDelete() {
        if (this.selectedIds.size === 0) return;

        const confirmed = typeof AppUI !== 'undefined' && AppUI.confirm
            ? await AppUI.confirm(`确定要删除这 ${this.selectedIds.size} 项内容吗？`, '删除确认')
            : confirm(`确定要删除这 ${this.selectedIds.size} 项内容吗？`);
        if (!confirmed) return;

        const cache = window.peekContentCache[this.currentAppType];
        if (cache && cache[this.currentDataArrayPath]) {
            cache[this.currentDataArrayPath] = cache[this.currentDataArrayPath].filter(item => {
                return !this.selectedIds.has(item.id);
            });
        }

        await savePeekData(window.activePeekCharId);

        if (typeof showToast === 'function') showToast('删除成功');
        this.exitMode();
    },

    bindEvents() {
        document.getElementById('peek-delete-cancel-btn')?.addEventListener('click', () => this.exitMode());
        document.getElementById('peek-delete-confirm-btn')?.addEventListener('click', () => this.executeDelete());
    },

    attachLongPress(container, itemSelector, appType, dataArrayPath, renderFunction) {
        if (!container) return;
        let pressTimer;

        const startPress = (e) => {
            if (this.isEditMode) return;
            const item = e.target.closest(itemSelector);
            if (!item) return;
            const itemId = item.dataset.id;
            if (!itemId) return;
            pressTimer = setTimeout(() => {
                this.enterMode(appType, dataArrayPath, renderFunction, itemId);
            }, 500);
        };

        const cancelPress = () => clearTimeout(pressTimer);

        container.addEventListener('touchstart', startPress, { passive: true });
        container.addEventListener('touchend', cancelPress);
        container.addEventListener('touchmove', cancelPress);
        container.addEventListener('mousedown', startPress);
        container.addEventListener('mouseup', cancelPress);
        container.addEventListener('mouseleave', cancelPress);

        container.addEventListener('contextmenu', (e) => {
            if (this.isEditMode) { e.preventDefault(); return; }
            const item = e.target.closest(itemSelector);
            if (!item) return;
            e.preventDefault();
            const itemId = item.dataset.id;
            if (itemId) this.enterMode(appType, dataArrayPath, renderFunction, itemId);
        });

        container.addEventListener('click', (e) => {
            if (!this.isEditMode || this.currentAppType !== appType) return;
            const item = e.target.closest(itemSelector);
            if (item) {
                e.preventDefault();
                e.stopPropagation();
                const itemId = item.dataset.id;
                if (itemId) {
                    this.toggleSelect(itemId);
                    if (this.selectedIds.has(itemId)) {
                        item.classList.add('selected');
                    } else {
                        item.classList.remove('selected');
                    }
                }
            }
        }, true);
    }
};

// ==========================================
// 工具函数：生成公用背景提要（人设、世界书、记忆、上下文）
// ==========================================
function getPeekBasePromptContext(char, mainChatContext) {
    const now = new Date();
    const pad = (n) => n < 10 ? '0' + n : n;
    const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
    const currentWeekDay = weekDays[now.getDay()];
    const currentTime = `${now.getFullYear()}年${pad(now.getMonth() + 1)}月${pad(now.getDate())}日 星期${currentWeekDay} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

    const worldBooksBefore = (char.worldBookIds || []).map(id => typeof db !== 'undefined' && db.worldBooks ? db.worldBooks.find(wb => wb.id === id && wb.position === 'before') : null).filter(Boolean).map(wb => wb.content).join('\n');
    const worldBooksAfter = (char.worldBookIds || []).map(id => typeof db !== 'undefined' && db.worldBooks ? db.worldBooks.find(wb => wb.id === id && wb.position === 'after') : null).filter(Boolean).map(wb => wb.content).join('\n');

    let prompt = ``;
    if (worldBooksBefore) prompt += `**世界观/背景**：\n${worldBooksBefore}\n\n`;
    prompt += `## 👤 角色档案\n**角色姓名**：${char.realName}\n**人设**：${char.persona}\n**当前状态**：${char.status || '日常'}\n\n`;

    const userNick = char.myNickname || char.myName;
    prompt += `**我的名字**：${char.myName} (你看到的昵称是${userNick})\n`;
    if (char.myPersona) prompt += `**我的人设**：${char.myPersona}\n\n`;

    if (worldBooksAfter) prompt += `**其他重要事项**：\n${worldBooksAfter}\n\n`;

    let allFavs = "";
    if (char.memorySummaries || char.longTermSummaries) {
        const shortFavs = (char.memorySummaries || []).filter(s => s.isFavorited).map(s => `[回忆] ${s.title}\n${s.content}`);
        const longFavs = (char.longTermSummaries || []).filter(s => s.isFavorited).map(s => `[长期历史] ${s.title}\n${s.content}`);
        allFavs = [...longFavs, ...shortFavs].join('\n\n');
    }
    if (allFavs) prompt += `之前发生的事(仅供你了解背景)：\n${allFavs}\n\n`;

    prompt += `**最近聊天上下文**（生成内容需围绕聊天记录上下文）：\n---\n${mainChatContext}\n---\n`;

    return prompt;
}

// ==========================================
// 工具函数：获取顺风车消息格式说明
// ==========================================
function getPeekProactiveFormatPrompt(char) {
    const senderName = char.realName || char.name;
    let availableStickers = "";
    if (char.stickerIds && char.stickerIds.length > 0 && typeof db !== 'undefined' && db.myStickers) {
        availableStickers = char.stickerIds
            .map(id => db.myStickers.find(s => s.id === id))
            .filter(Boolean)
            .map(s => s.name)
            .join('、');
    }

    let prompt = `可选的时间段ID有：NIGHT(22点-6点), MORNING(6点-10点), NOON(10点-14点), AFTERNOON(14点-18点), EVENING(18点-22点)。请选择最符合该话题的时段生成1组消息！\n`;
    prompt += `\n【主动消息格式规范】\n`;
    prompt += `预测主动消息时，你可以结合情境混合使用以下支持的格式（每条消息必须包含对应的前缀）：\n`;
    prompt += `a) 普通消息: [HH:MM|${senderName}的消息: 文字消息内容]\n`;
    if (availableStickers) {
        prompt += `b) 发送表情包:[HH:MM|${senderName}的表情包: 表情名称] (⚠️ 严禁造词，仅限使用：【${availableStickers}】)\n`;
    } else {
        prompt += `b) (当前角色没有可用表情包，请勿发送表情包)\n`;
    }
    prompt += `c) 照片/视频:[HH:MM|${senderName}发来的照片/视频: 照片画面的详细描述]\n`;
    prompt += `d) 语音消息:[HH:MM|${senderName}的语音: 语音转述的文字内容]\n`;
    prompt += `e) 撤回消息:[HH:MM|${senderName}撤回了上一条消息: 被撤回消息的原文]\n`;
    prompt += `f) 主动转账或送礼物: 转账格式必须为[HH:MM|${senderName}的转账:xxx元；备注：xxx]。送礼物格式必须为[HH:MM|${senderName}送来的礼物:xxx]\n`;
    prompt += `g) 话题会在未来三天中的某一天发出，因此生成的消息中请不要使用确切日期以及"今天""刚刚"指代某件事的发生时间，应使用"之前""上次"等模糊词语指代某件事的发生时间。\n`;

    return prompt;
}

// ==========================================
// 工具函数：获取当前时段（供顺风车使用）
// ==========================================
function getPeekTargetSlots(nowTime) {
    const slots = [
        { id: 'night', name: '深夜(22:00-次日6:00)', endHour: 6 },
        { id: 'morning', name: '早晨(6:00-10:00)', endHour: 10 },
        { id: 'noon', name: '中午(10:00-14:00)', endHour: 14 },
        { id: 'afternoon', name: '下午(14:00-18:00)', endHour: 18 },
        { id: 'evening', name: '晚上(18:00-22:00)', endHour: 22 }
    ];
    const hour = nowTime.getHours();
    const minutes = nowTime.getMinutes();
    let currIdx = 0;
    if (hour >= 22 || hour < 6) currIdx = 0;
    else if (hour >= 6 && hour < 10) currIdx = 1;
    else if (hour >= 10 && hour < 14) currIdx = 2;
    else if (hour >= 14 && hour < 18) currIdx = 3;
    else currIdx = 4;

    let remainingHours = (currIdx === 0 && hour >= 22)
        ? (24 - hour - 1) + (60 - minutes) / 60 + 6
        : (slots[currIdx].endHour - hour - 1) + (60 - minutes) / 60;

    if (remainingHours <= 1) return [slots[(currIdx + 1) % 5], slots[(currIdx + 2) % 5]];
    else return [slots[currIdx], slots[(currIdx + 1) % 5]];
}

// ==========================================
// 工具函数：解析顺风车标签并存入队列（超强容错版）
// ==========================================
function parseAndSavePeekProactiveHitchhiker(char, textBlock) {
    if (!char) return;

    let proactiveOptions = {};
    const globalTagRegex = /#SECRET_CHAT_([A-Za-z]+)(?:_(\d+)%?)?#\s*([\s\S]*?)(?=(?:#SECRET_CHAT_|$))/gi;
    let match;

    while ((match = globalTagRegex.exec(textBlock)) !== null) {
        let baseSlotName = match[1].toLowerCase();
        let finalProb = match[2] ? Math.floor(90 + (parseInt(match[2], 10) * 0.1)) : 90;
        let block = match[3].trim();
        let messages = [];

        const lineRegex = /\[?\s*(\d{1,2}[:：]\d{2})\s*[|｜]\s*([^:：\]]+)[:：]\s*([\s\S]*?)\s*\]?(?=\s*(?:\[?\s*\d{1,2}[:：]\d{2}\s*[|｜]|$))/g;
        let lineMatch;

        while ((lineMatch = lineRegex.exec(block)) !== null) {
            let prefix = lineMatch[2].trim();
            let senderName = prefix;
            let actionType = "的消息";
            const actionKeywords = [
                "的消息", "的表情包", "发来的照片/视频", "的照片/视频", "发来的照片", "的照片",
                "的语音", "发来的语音", "撤回了上一条消息", "撤回了一条消息", "的转账",
                "发来的转账", "送来的礼物", "的礼物", "的动作", "的语言"
            ];
            for (const kw of actionKeywords) {
                if (prefix.endsWith(kw)) {
                    senderName = prefix.slice(0, -kw.length).trim();
                    actionType = kw;
                    if (['的照片', '发来的照片', '的照片/视频'].includes(actionType)) actionType = '发来的照片/视频';
                    else if (actionType === '发来的语音') actionType = '的语音';
                    else if (actionType === '发来的转账') actionType = '的转账';
                    else if (actionType === '的礼物') actionType = '送来的礼物';
                    break;
                }
            }
            messages.push({ time: lineMatch[1].replace('：', ':'), sender: senderName, action: actionType, text: lineMatch[3].trim() });
        }

        if (messages.length > 0) {
            let uniqueSlotId = `${baseSlotName}_peek_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
            proactiveOptions[uniqueSlotId] = {
                probability: finalProb,
                messages: messages,
                generatedAt: Date.now() + Math.random()
            };
        }
    }

    if (Object.keys(proactiveOptions).length > 0) {
        char.proactiveMessageQueue = char.proactiveMessageQueue || [];
        let existingPeek = char.proactiveMessageQueue.find(m => m.type === 'time_window_peek');
        if (!existingPeek) {
            existingPeek = {
                id: `promsg_peek_${Date.now()}`,
                type: 'time_window_peek',
                generatedAt: Date.now(),
                expireAt: Date.now() + 72 * 60 * 60 * 1000,
                content: {}
            };
            char.proactiveMessageQueue.push(existingPeek);
        }

        for (let k in proactiveOptions) existingPeek.content[k] = proactiveOptions[k];

        let allKeys = Object.keys(existingPeek.content);
        if (allKeys.length > 10) {
            allKeys.sort((a, b) => (existingPeek.content[a].generatedAt || 0) - (existingPeek.content[b].generatedAt || 0));
            let keysToKeep = allKeys.slice(-10);
            let newContent = {};
            keysToKeep.forEach(k => newContent[k] = existingPeek.content[k]);
            existingPeek.content = newContent;
        }
        console.log(`[话题] 成功提取 ${Object.keys(proactiveOptions).length} 组话题，当前备用池容量: ${Object.keys(existingPeek.content).length}/10`);
    } else {
        console.warn(`[话题] 未抓取到符合格式的话题数据，AI原始文本：\n`, textBlock);
    }
}

// ==========================================
// 主屏渲染
// ==========================================
function renderPeekScreen() {
    const peekScreen = document.getElementById('peek-screen');
    const contentArea = peekScreen.querySelector('main.content');

    contentArea.innerHTML = `
        <div class="time-widget">
            <div class="time" id="peek-time-display"></div>
            <div class="date" id="peek-date-display"></div>
        </div>
        <div class="app-grid"></div>
    `;

    const character = db.characters.find(c => c.id === window.activePeekCharId);
    const peekSettings = character?.peekScreenSettings || { wallpaper: '', customIcons: {} };

    const wallpaper = peekSettings.wallpaper;
    if (wallpaper) {
        peekScreen.style.backgroundImage = `url(${wallpaper})`;
    } else {
        peekScreen.style.backgroundImage = `url(${db.wallpaper})`;
    }
    peekScreen.style.backgroundSize = 'cover';
    peekScreen.style.backgroundPosition = 'center';

    const appGrid = contentArea.querySelector('.app-grid');
    Object.keys(peekScreenApps).forEach(id => {
        const iconData = peekScreenApps[id];
        const iconEl = document.createElement('a');
        iconEl.href = '#';
        iconEl.className = 'app-icon';
        iconEl.dataset.peekAppId = id;
        const customIconUrl = peekSettings.customIcons?.[id];
        const iconUrl = customIconUrl || iconData.url;
        iconEl.innerHTML = `
            <img src="${iconUrl}" alt="${iconData.name}" class="icon-img">
            <span class="app-name">${iconData.name}</span>
        `;

        iconEl.addEventListener('click', (e) => {
            e.preventDefault();
            if (id === 'album') generateAndRenderPeekAlbum();
            else if (id === 'browser') generateAndRenderPeekBrowser();
            else if (id === 'steps') generateAndRenderPeekSteps();
            else if (id === 'drafts') generateAndRenderPeekDrafts();
            else if (id === 'memos') generateAndRenderPeekMemos();
            else if (id === 'transfer') generateAndRenderPeekTransfer();
            else if (id === 'messages') generateAndRenderPeekMessages();
            else if (id === 'cart') generateAndRenderPeekCart();
            else if (id === 'unlock') generateAndRenderPeekUnlock();
        });

        appGrid.appendChild(iconEl);
    });

    updateClock();
}

// ==========================================
// 设置面板渲染
// ==========================================
function renderPeekSettings() {
    const character = db.characters.find(c => c.id === window.activePeekCharId);
    if (!character) return;

    const peekSettings = character.peekScreenSettings || { wallpaper: '', customIcons: {}, unlockAvatar: '', contextLimit: 50 };

    document.getElementById('peek-wallpaper-url-input').value = peekSettings.wallpaper || '';

    const iconsContainer = document.getElementById('peek-app-icons-settings');
    iconsContainer.innerHTML = '';

    Object.keys(peekScreenApps).forEach(appId => {
        const app = peekScreenApps[appId];
        const currentIcon = peekSettings.customIcons?.[appId] || app.url;

        const itemEl = document.createElement('div');
        itemEl.className = 'icon-custom-item';
        itemEl.innerHTML = `
            <img src="${currentIcon}" alt="${app.name}" class="icon-preview">
            <div class="icon-details">
                <p>${app.name}</p>
                <input type="url" class="form-group" data-app-id="${appId}" placeholder="粘贴新的图标URL" value="${peekSettings.customIcons?.[appId] || ''}">
            </div>
            <input type="file" id="peek-icon-upload-${appId}" data-app-id="${appId}" accept="image/*" style="display:none;">
            <label for="peek-icon-upload-${appId}" class="btn btn-small btn-neutral" style="font-size: 12px;">上传</label>
        `;
        iconsContainer.appendChild(itemEl);
    });

    iconsContainer.querySelectorAll('input[type="file"]').forEach(uploadInput => {
        uploadInput.addEventListener('change', handlePeekIconUpload);
    });

    document.getElementById('peek-unlock-avatar-url').value = peekSettings.unlockAvatar || '';
    document.getElementById('peek-context-limit').value = peekSettings.contextLimit !== undefined ? peekSettings.contextLimit : 50;
}

// ==========================================
// 图标上传处理
// ==========================================
async function handlePeekIconUpload(e) {
    const file = e.target.files[0];
    const appId = e.target.dataset.appId;
    if (file && appId) {
        try {
            const compressedUrl = await compressImage(file, { quality: 0.8, maxWidth: 120, maxHeight: 120 });
            const urlInput = document.querySelector(`#peek-app-icons-settings input[data-app-id="${appId}"]`);
            const previewImg = urlInput.closest('.icon-custom-item').querySelector('.icon-preview');
            if (urlInput) urlInput.value = compressedUrl;
            if (previewImg) previewImg.src = compressedUrl;
            showToast(`${peekScreenApps[appId].name} 图标已上传并压缩`);
        } catch (error) {
            showToast('图标压缩失败，请重试');
        }
    }
}

// ==========================================
// Peek 功能入口初始化（事件绑定）
// ==========================================
function setupPeekFeature() {
    const peekBtn = document.getElementById('peek-btn');
    const peekConfirmModal = document.getElementById('peek-confirm-modal');
    const peekConfirmYes = document.getElementById('peek-confirm-yes');
    const peekConfirmNo = document.getElementById('peek-confirm-no');
    const peekSettingsBtn = document.getElementById('peek-settings-btn');
    const peekWallpaperModal = document.getElementById('peek-wallpaper-modal');
    const peekWallpaperUpload = document.getElementById('peek-wallpaper-upload');

    peekBtn?.addEventListener('click', () => {
        peekConfirmModal.classList.add('visible');
    });

    peekConfirmNo?.addEventListener('click', () => {
        peekConfirmModal.classList.remove('visible');
    });

    peekConfirmYes?.addEventListener('click', () => {
        peekConfirmModal.classList.remove('visible');

        let safeChatId = currentChatId;
        if (!safeChatId) {
            const chatScreen = document.getElementById('chat-room-screen');
            const match = chatScreen.className.match(/chat-active-([^ ]+)/);
            if (match) {
                safeChatId = match[1];
                currentChatId = safeChatId;
            }
        }

        currentChatType = 'private';
        if (!safeChatId) {
            if (typeof showToast === 'function') showToast('错误：丢失聊天对象信息');
            return;
        }

        window.activePeekCharId = safeChatId;

        if (!db.peekData) db.peekData = {};
        if (!db.peekData[window.activePeekCharId]) db.peekData[window.activePeekCharId] = {};

        window.peekContentCache = db.peekData[window.activePeekCharId];
        renderPeekScreen();
        switchScreen('peek-screen');
    });

    peekSettingsBtn?.addEventListener('click', () => {
        renderPeekSettings();
        peekWallpaperModal.classList.add('visible');
    });

    peekWallpaperUpload?.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            try {
                const compressedUrl = await compressImage(file, { quality: 0.85, maxWidth: 1080, maxHeight: 1920 });
                document.getElementById('peek-wallpaper-url-input').value = compressedUrl;
                showToast('图片已压缩并填入URL输入框');
            } catch (error) {
                showToast('壁纸压缩失败，请重试');
            }
        }
    });

    document.getElementById('save-peek-settings-btn')?.addEventListener('click', async () => {
        const character = db.characters.find(c => c.id === window.activePeekCharId);
        if (!character) { showToast('错误：未找到当前角色'); return; }

        if (!character.peekScreenSettings) {
            character.peekScreenSettings = { wallpaper: '', customIcons: {}, unlockAvatar: '', contextLimit: 50 };
        }

        character.peekScreenSettings.wallpaper = document.getElementById('peek-wallpaper-url-input').value.trim();

        const iconInputs = document.querySelectorAll('#peek-app-icons-settings input[type="url"]');
        iconInputs.forEach(input => {
            const appId = input.dataset.appId;
            const newUrl = input.value.trim();
            if (newUrl) {
                if (!character.peekScreenSettings.customIcons) character.peekScreenSettings.customIcons = {};
                character.peekScreenSettings.customIcons[appId] = newUrl;
            } else {
                if (character.peekScreenSettings.customIcons) delete character.peekScreenSettings.customIcons[appId];
            }
        });

        character.peekScreenSettings.unlockAvatar = document.getElementById('peek-unlock-avatar-url').value.trim();

        const contextInput = document.getElementById('peek-context-limit');
        let limit = parseInt(contextInput.value);
        if (isNaN(limit)) limit = 50;
        if (limit > 500) limit = 500;
        if (limit < 0) limit = 0;
        character.peekScreenSettings.contextLimit = limit;

        await saveSingleChat(window.activePeekCharId, 'private');
        renderPeekScreen();
        showToast('已保存！');
        peekWallpaperModal.classList.remove('visible');
    });

    peekWallpaperModal.addEventListener('click', (e) => {
        const header = e.target.closest('.collapsible-header');
        if (header) header.parentElement.classList.toggle('open');
    });

    // 消息列表点击
    const peekMessagesScreen = document.getElementById('peek-messages-screen');
    peekMessagesScreen.addEventListener('click', (e) => {
        if (PeekDeleteManager.isEditMode) return;
        const chatItem = e.target.closest('.chat-item');
        if (chatItem) {
            const partnerName = chatItem.dataset.name;
            const cachedData = peekContentCache.messages;
            if (cachedData && cachedData.conversations) {
                const conversation = cachedData.conversations.find(c => c.partnerName === partnerName);
                if (conversation) {
                    if (conversation.isNew) {
                        conversation.isNew = false;
                        savePeekData(window.activePeekCharId);
                        const badge = chatItem.querySelector('.new-badge');
                        if (badge) badge.remove();
                    }
                    renderPeekConversation(conversation.history, conversation.partnerName);
                    switchScreen('peek-conversation-screen');
                } else {
                    showToast('找不到对话记录');
                }
            }
        } else if (e.target.closest('.action-btn')) {
            generateAndRenderPeekMessages({ forceRefresh: true });
        }
    });

    const peekConversationScreen = document.getElementById('peek-conversation-screen');
    peekConversationScreen.addEventListener('click', (e) => {
        if (e.target.closest('.action-btn')) generateAndRenderPeekMessages({ forceRefresh: true });
    });

    const refreshAlbumBtn = document.getElementById('refresh-album-btn');
    if (refreshAlbumBtn) refreshAlbumBtn.addEventListener('click', () => generateAndRenderPeekAlbum({ forceRefresh: true }));

    const refreshStepsBtn = document.getElementById('refresh-steps-btn');
    if (refreshStepsBtn) refreshStepsBtn.addEventListener('click', () => generateAndRenderPeekSteps({ forceRefresh: true }));

    const photoModal = document.getElementById('peek-photo-modal');
    if (photoModal) {
        photoModal.addEventListener('click', (e) => {
            if (e.target === photoModal) photoModal.classList.remove('visible');
        });
    }

    // 绑定长按多选删除
    PeekDeleteManager.bindEvents();
    PeekDeleteManager.attachLongPress(document.getElementById('peek-messages-screen'), '.chat-item', 'messages', 'conversations', () => renderPeekChatList(peekContentCache.messages?.conversations));
    PeekDeleteManager.attachLongPress(document.getElementById('peek-memos-screen'), '.memo-item', 'memos', 'memos', () => renderMemosList(peekContentCache.memos?.memos));
    PeekDeleteManager.attachLongPress(document.getElementById('peek-cart-screen'), '.cart-item', 'cart', 'items', () => renderPeekCart(peekContentCache.cart?.items));
    PeekDeleteManager.attachLongPress(document.getElementById('peek-transfer-station-screen'), '.transfer-item', 'transfer', 'entries', () => renderPeekTransferStation(peekContentCache.transfer?.entries));
    PeekDeleteManager.attachLongPress(document.getElementById('peek-browser-screen'), '.browser-history-item', 'browser', 'history', () => renderPeekBrowser(peekContentCache.browser?.history));
    PeekDeleteManager.attachLongPress(document.getElementById('peek-album-screen'), '.album-photo', 'album', 'photos', () => renderPeekAlbum(peekContentCache.album?.photos));
    PeekDeleteManager.attachLongPress(document.getElementById('peek-unlock-screen'), '.unlock-post-card', 'unlock', 'posts', () => renderPeekUnlock(peekContentCache.unlock));
}
