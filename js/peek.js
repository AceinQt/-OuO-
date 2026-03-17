
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
        
        // === 关键：进入多选时给 body 加 class，触发 layout.css 中的避让样式 ===
        document.body.classList.add('peek-editing-mode');
        
        // 隐藏当前应用的刷新/操作按钮，防止在编辑时误触
        const activeScreen = document.querySelector('.screen.active');
        if(activeScreen) {
            const actionBtn = activeScreen.querySelector('.app-header .action-btn');
            if(actionBtn) actionBtn.style.visibility = 'hidden';
        }

        this.updateBottomBar();

        // 记录进入编辑模式时的滚动条位置
        const scrollContainer = activeScreen ? (activeScreen.querySelector('.content') || activeScreen) : null;
        const scrollTop = scrollContainer ? scrollContainer.scrollTop : 0;
        
        renderFunction(); // 触发重新渲染以显示多选 UI

        // 恢复滚动条位置，避免视觉闪烁
        if (scrollContainer) {
            requestAnimationFrame(() => {
                const newScrollContainer = document.querySelector('.screen.active .content') || document.querySelector('.screen.active');
                if (newScrollContainer) {
                    newScrollContainer.scrollTop = scrollTop;
                }
            });
        }
    },

exitMode() {
        this.isEditMode = false;
        this.selectedIds.clear();
        
        const bar = document.getElementById('peek-delete-bottom-bar');
        if (bar) bar.style.display = 'none';

        // === 关键：退出多选时移除 class，恢复正常布局 ===
        document.body.classList.remove('peek-editing-mode');

        // 恢复刷新按钮显示
        const activeScreen = document.querySelector('.screen.active');
        if(activeScreen) {
            const actionBtn = activeScreen.querySelector('.app-header .action-btn');
            if(actionBtn) actionBtn.style.visibility = 'visible';
        }

        // 记录退出编辑模式时的滚动条位置
        const scrollContainer = activeScreen ? (activeScreen.querySelector('.content') || activeScreen) : null;
        const scrollTop = scrollContainer ? scrollContainer.scrollTop : 0;

        if (this.currentRenderFunction) this.currentRenderFunction();
        
        // 恢复滚动条位置，避免视觉闪烁
        if (scrollContainer) {
            requestAnimationFrame(() => {
                const newScrollContainer = document.querySelector('.screen.active .content') || document.querySelector('.screen.active');
                if (newScrollContainer) {
                    newScrollContainer.scrollTop = scrollTop;
                }
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

    // 通用绑定长按与选择逻辑
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
        
        const cancelPress = () => {
            clearTimeout(pressTimer);
        };

        // 移动端长按
        container.addEventListener('touchstart', startPress, {passive: true});
        container.addEventListener('touchend', cancelPress);
        container.addEventListener('touchmove', cancelPress);
        // PC端模拟长按
        container.addEventListener('mousedown', startPress);
        container.addEventListener('mouseup', cancelPress);
        container.addEventListener('mouseleave', cancelPress);
        
        // PC端右键
        container.addEventListener('contextmenu', (e) => {
            if (this.isEditMode) {
                e.preventDefault();
                return;
            }
            const item = e.target.closest(itemSelector);
            if (!item) return;
            e.preventDefault();
            const itemId = item.dataset.id;
            if (itemId) {
                this.enterMode(appType, dataArrayPath, renderFunction, itemId);
            }
        });

        // 捕获阶段拦截点击事件：只要在编辑模式下，任何原本的卡片点击全部转为选中/反选逻辑
        container.addEventListener('click', (e) => {
            if (!this.isEditMode || this.currentAppType !== appType) return;
            
            const item = e.target.closest(itemSelector);
            if (item) {
                e.preventDefault();
                e.stopPropagation(); 
                const itemId = item.dataset.id;
                if (itemId) {
                    this.toggleSelect(itemId);
                    // 仅切换元素的 selected 类，不重新绘制全部内容，解决回滚到顶部的问题
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
// Peek 专用工具函数：提取公用的背景提要 (人设、世界书、记忆、上下文)
// ==========================================
function getPeekBasePromptContext(char, mainChatContext) {
    const now = new Date();
    const pad = (n) => n < 10 ? '0' + n : n;
    const weekDays =['日', '一', '二', '三', '四', '五', '六'];
    const currentWeekDay = weekDays[now.getDay()];
    const currentTime = `${now.getFullYear()}年${pad(now.getMonth() + 1)}月${pad(now.getDate())}日 星期${currentWeekDay} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

     // 获取并注入世界书设定
    const worldBooksBefore = (char.worldBookIds ||[]).map(id => typeof db !== 'undefined' && db.worldBooks ? db.worldBooks.find(wb => wb.id === id && wb.position === 'before') : null).filter(Boolean).map(wb => wb.content).join('\n');
    const worldBooksAfter = (char.worldBookIds ||[]).map(id => typeof db !== 'undefined' && db.worldBooks ? db.worldBooks.find(wb => wb.id === id && wb.position === 'after') : null).filter(Boolean).map(wb => wb.content).join('\n');
    
       let prompt = ``;
       if (worldBooksBefore) {
        prompt += `**世界观/背景**：\n${worldBooksBefore}\n\n`;
    }
    prompt += `## 👤 角色档案\n**角色姓名**：${char.realName}\n**人设**：${char.persona}\n**当前状态**：${char.status || '日常'}\n\n`;
    
        // 获取并注入用户人设
    const userNick = char.myNickname || char.myName;
    prompt += `**我的名字**：${char.myName} (你看到的昵称是${userNick})\n`;
    if (char.myPersona) {
        prompt += `**我的人设**：${char.myPersona}\n\n`;
    }

    if (worldBooksAfter) {
        prompt += `**其他重要事项**：\n${worldBooksAfter}\n\n`;
    }
    
    // 注入回忆
    let allFavs = "";
    if (char.memorySummaries || char.longTermSummaries) {
        const shortFavs = (char.memorySummaries ||[]).filter(s => s.isFavorited).map(s => `[回忆] ${s.title}\n${s.content}`);
        const longFavs = (char.longTermSummaries ||[]).filter(s => s.isFavorited).map(s => `[长期历史] ${s.title}\n${s.content}`);
        allFavs = [...longFavs, ...shortFavs].join('\n\n');
    }
    if (allFavs) prompt += `**重要记忆**：\n${allFavs}\n\n`;

    // 注入最近的聊天历史
    prompt += `**最近聊天记录**（这是人物关系和当前状态的核心参考）：\n---\n${mainChatContext}\n---\n`;
    
    return prompt;
}

// ==========================================
// Peek 专用工具函数：获取顺风车消息的格式说明
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
    prompt += `g) 话题会在未来三天中的某一天发出，因此生成的消息中请不要使用确切日期以及“今天”“刚刚”指代某件事的发生时间，应使用“之前”“上次”等模糊词语指代。\n`;
    
    return prompt;
}


// ==========================================
// Peek 专用工具函数：获取当前时段（供顺风车使用）
// ==========================================
function getPeekTargetSlots(nowTime) {
    const slots =[
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
    else return[slots[currIdx], slots[(currIdx + 1) % 5]];
}

// ==========================================
// Peek 专用工具函数：解析顺风车标签并存入队列 (超强容错版)
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
        let messages =[];
        
const lineRegex = /\[?\s*(\d{1,2}[:：]\d{2})\s*[|｜]\s*([^:：\]]+)[:：]\s*([\s\S]*?)\s*\]?(?=\s*(?:\[?\s*\d{1,2}[:：]\d{2}\s*[|｜]|$))/g;
        let lineMatch;
        
        while ((lineMatch = lineRegex.exec(block)) !== null) {
            let prefix = lineMatch[2].trim();
            let senderName = prefix;
            let actionType = "的消息";
            const actionKeywords =[
                "的消息", "的表情包", "发来的照片/视频", "的照片/视频", "发来的照片", "的照片", 
                "的语音", "发来的语音", "撤回了上一条消息","撤回了一条消息","的转账", 
                "发来的转账", "送来的礼物", "的礼物", "的动作", "的语言"
            ];
            for (const kw of actionKeywords) {
                if (prefix.endsWith(kw)) {
                    senderName = prefix.slice(0, -kw.length).trim();
                    actionType = kw; 
                    
                    // --- 新增：标准化 actionType 以完美匹配气泡工厂的正则 ---
                    if (['的照片', '发来的照片', '的照片/视频'].includes(actionType)) {
                        actionType = '发来的照片/视频';
                    } else if (actionType === '发来的语音') {
                        actionType = '的语音';
                    } else if (actionType === '发来的转账') {
                        actionType = '的转账';
                    } else if (actionType === '的礼物') {
                        actionType = '送来的礼物';
                    }
                    
                    break;
                }
            }                        
            messages.push({ time: lineMatch[1].replace('：', ':'), sender: senderName, action: actionType, text: lineMatch[3].trim() });
        }

        if (messages.length > 0) {
            // 加入微小的随机偏差，防止同毫秒时间戳导致排序混乱
            let uniqueSlotId = `${baseSlotName}_peek_${Date.now()}_${Math.floor(Math.random()*1000)}`;
            proactiveOptions[uniqueSlotId] = { 
                probability: finalProb, 
                messages: messages,
                generatedAt: Date.now() + Math.random() 
            };
        }
    }

    if (Object.keys(proactiveOptions).length > 0) {
        char.proactiveMessageQueue = char.proactiveMessageQueue ||[];
        let existingPeek = char.proactiveMessageQueue.find(m => m.type === 'time_window_peek');
        if (!existingPeek) {
            existingPeek = { 
                id: `promsg_peek_${Date.now()}`, 
                type: 'time_window_peek', 
                generatedAt: Date.now(), 
                expireAt: Date.now() + 72 * 60 * 60 * 1000, // 72小时过期 
                content: {} 
            };
            char.proactiveMessageQueue.push(existingPeek);
        }
        
        // 合并新的内容
        for (let k in proactiveOptions) {
            existingPeek.content[k] = proactiveOptions[k];
        }
        
        // 【精准修剪】限制最多保留10组最新的
        let allKeys = Object.keys(existingPeek.content);
        if (allKeys.length > 10) {
            // 按 generatedAt 升序排列（越旧的时间越小，排在前面）
            allKeys.sort((a, b) => (existingPeek.content[a].generatedAt || 0) - (existingPeek.content[b].generatedAt || 0));
            // 截取末尾10个（即最新生成的10个），自动抛弃最旧的
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
                        
                                                function setupPeekFeature() {
                const peekBtn = document.getElementById('peek-btn');
                const peekConfirmModal = document.getElementById('peek-confirm-modal');
                const peekConfirmYes = document.getElementById('peek-confirm-yes');
                const peekConfirmNo = document.getElementById('peek-confirm-no');
                const peekSettingsBtn = document.getElementById('peek-settings-btn');
                const peekWallpaperModal = document.getElementById('peek-wallpaper-modal');
                const peekWallpaperForm = document.getElementById('peek-wallpaper-form');
                const peekWallpaperUpload = document.getElementById('peek-wallpaper-upload');
                const peekWallpaperPreview = document.getElementById('peek-wallpaper-preview');

                peekBtn?.addEventListener('click', () => {
                    peekConfirmModal.classList.add('visible');
                });

                peekConfirmNo?.addEventListener('click', () => {
                    peekConfirmModal.classList.remove('visible');
                });

peekConfirmYes?.addEventListener('click', () => {
                    peekConfirmModal.classList.remove('visible');
                    
                    // ====== 【终极修复】拯救意外丢失的 currentChatId ======
                    let safeChatId = currentChatId;
                    
                    // 如果发现 currentChatId 为空，说明被之前的清理逻辑误杀了
                    if (!safeChatId) {
                        // 从聊天室的 DOM class 中把 ID 抢救回来
                        const chatScreen = document.getElementById('chat-room-screen');
                        // 匹配类似 chat-active-char_123123 的类名
                        const match = chatScreen.className.match(/chat-active-([^ ]+)/);
                        if (match) {
                            safeChatId = match[1];
                            currentChatId = safeChatId; // 【关键】顺手修复全局变量！不然你回聊天室也发不了消息
                        }
                    }
 
 currentChatType = 'private';                                      
                    // 如果万一连 DOM 里都没找到，直接阻断，防止后面的代码崩溃
                    if (!safeChatId) {
                        if (typeof showToast === 'function') showToast('错误：丢失聊天对象信息');
                        return;
                    }

                    // 把安全拿到手的 ID 交给 Peek 专属缓存
                    window.activePeekCharId = safeChatId;

                    // 而是从 db 加载当前角色的数据
                    if (!db.peekData) db.peekData = {};
                    
                    // 如果这个角色还没有数据，初始化为空对象
                    if (!db.peekData[window.activePeekCharId]) {
                        db.peekData[window.activePeekCharId] = {};
                    }             
                    
                    window.peekContentCache = db.peekData[window.activePeekCharId];
                    renderPeekScreen(); // Render before switching
                    switchScreen('peek-screen');
                });

                // New simplified settings functionality
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

                // Combined save button for all peek settings
                document.getElementById('save-peek-settings-btn')?.addEventListener('click', async () => {
                    const character = db.characters.find(c => c.id === window.activePeekCharId);
                    if (!character) {
                        showToast('错误：未找到当前角色');
                        return;
                    }

                    if (!character.peekScreenSettings) {
                        character.peekScreenSettings = { wallpaper: '', customIcons: {}, unlockAvatar: '' , contextLimit: 50};
                    }

                    // Save wallpaper
                    character.peekScreenSettings.wallpaper = document.getElementById('peek-wallpaper-url-input').value.trim();

                    // Save custom app icons
                    const iconInputs = document.querySelectorAll('#peek-app-icons-settings input[type="url"]');
                    iconInputs.forEach(input => {
                        const appId = input.dataset.appId;
                        const newUrl = input.value.trim();
                        if (newUrl) {
                            if (!character.peekScreenSettings.customIcons) {
                                character.peekScreenSettings.customIcons = {};
                            }
                            character.peekScreenSettings.customIcons[appId] = newUrl;
                        } else {
                            if (character.peekScreenSettings.customIcons) {
                                delete character.peekScreenSettings.customIcons[appId];
                            }
                        }
                    });

                    // Save unlock avatar
                    character.peekScreenSettings.unlockAvatar = document.getElementById('peek-unlock-avatar-url').value.trim();
                    
                    const contextInput = document.getElementById('peek-context-limit');
    let limit = parseInt(contextInput.value);
    
    // 验证数据：如果是NaN则设为50，限制最大500，最小0
    if (isNaN(limit)) limit = 50;
    if (limit > 500) limit = 500;
    if (limit < 0) limit = 0;
    
    character.peekScreenSettings.contextLimit = limit;

await saveSingleChat(window.activePeekCharId, 'private');
                    renderPeekScreen(); // Re-render to apply all changes
                    showToast('已保存！');
                    peekWallpaperModal.classList.remove('visible');
                });

                // Add collapsible functionality
                peekWallpaperModal.addEventListener('click', (e) => {
                    const header = e.target.closest('.collapsible-header');
                    if (header) {
                        header.parentElement.classList.toggle('open');
                    }
                });


                                const peekMessagesScreen = document.getElementById('peek-messages-screen');
peekMessagesScreen.addEventListener('click', (e) => {
                    if (PeekDeleteManager.isEditMode) return; // 编辑模式拦截
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
                        generateAndRenderPeekMessages({ forceRefresh: true }); // <-- 修改为调用独立的消息生成函数
                    }
                });

                const peekConversationScreen = document.getElementById('peek-conversation-screen');
                peekConversationScreen.addEventListener('click', (e) => {
                    if (e.target.closest('.action-btn')) {
                        generateAndRenderPeekMessages({ forceRefresh: true }); // <-- 修改为调用独立的消息生成函数
                    }
                });

                // 为相册刷新按钮添加事件监听
                const refreshAlbumBtn = document.getElementById('refresh-album-btn');
if (refreshAlbumBtn) {
    refreshAlbumBtn.addEventListener('click', () => generateAndRenderPeekAlbum({ forceRefresh: true }));
}
                
                // (在 setupPeekFeature 函数内部)
                const refreshStepsBtn = document.getElementById('refresh-steps-btn');
                if (refreshStepsBtn) {
                    refreshStepsBtn.addEventListener('click', () => generateAndRenderPeekSteps({ forceRefresh: true })); // <-- 更新为新函数
                }

                // 为照片详情模态框添加关闭事件
                const photoModal = document.getElementById('peek-photo-modal');
                if (photoModal) {
                    photoModal.addEventListener('click', (e) => {
                        if (e.target === photoModal) {
                            photoModal.classList.remove('visible');
                        }
                    });
                }
                
                // === 绑定长按删除多选逻辑 ===
                PeekDeleteManager.bindEvents();
                PeekDeleteManager.attachLongPress(document.getElementById('peek-messages-screen'), '.chat-item', 'messages', 'conversations', () => renderPeekChatList(peekContentCache.messages?.conversations));
                PeekDeleteManager.attachLongPress(document.getElementById('peek-memos-screen'), '.memo-item', 'memos', 'memos', () => renderMemosList(peekContentCache.memos?.memos));
                PeekDeleteManager.attachLongPress(document.getElementById('peek-cart-screen'), '.cart-item', 'cart', 'items', () => renderPeekCart(peekContentCache.cart?.items));
                PeekDeleteManager.attachLongPress(document.getElementById('peek-transfer-station-screen'), '.transfer-item', 'transfer', 'entries', () => renderPeekTransferStation(peekContentCache.transfer?.entries));
                PeekDeleteManager.attachLongPress(document.getElementById('peek-browser-screen'), '.browser-history-item', 'browser', 'history', () => renderPeekBrowser(peekContentCache.browser?.history));
                PeekDeleteManager.attachLongPress(document.getElementById('peek-album-screen'), '.album-photo', 'album', 'photos', () => renderPeekAlbum(peekContentCache.album?.photos));
                PeekDeleteManager.attachLongPress(document.getElementById('peek-unlock-screen'), '.unlock-post-card', 'unlock', 'posts', () => renderPeekUnlock(peekContentCache.unlock));

            }

            function renderPeekAlbum(photos) {
                const screen = document.getElementById('peek-album-screen');
                const grid = screen.querySelector('.album-grid');
                grid.innerHTML = ''; // Clear previous content

                if (!photos || photos.length === 0) {
                    grid.innerHTML = '<p class="placeholder-text">正在生成相册内容...</p>';
                    return;
                }

                const isEdit = PeekDeleteManager.isEditMode && PeekDeleteManager.currentAppType === 'album';
                
                photos.forEach(photo => {
                    // 为以前旧的没有id的数据自动赋id，否则多选无法选中
                    if (!photo.id) photo.id = 'album_old_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
                    const isSelected = isEdit && PeekDeleteManager.selectedIds.has(photo.id);
                    const photoEl = document.createElement('div');
                    photoEl.className = `album-photo ${isEdit ? 'is-selecting' : ''} ${isSelected ? 'selected' : ''}`;
                    photoEl.dataset.id = photo.id;
                    photoEl.dataset.imageDescription = photo.imageDescription;
                    photoEl.dataset.description = photo.description;

                    const img = document.createElement('img');
                    img.src = 'https://i.postimg.cc/1tH6ds9g/1752301200490.jpg'; // 使用一个静态占位图
                    img.alt = "相册照片";
                    photoEl.appendChild(img);

                                        if (photo.type === 'video') {
                        const videoIndicator = document.createElement('div');
                        videoIndicator.className = 'video-indicator';
                        videoIndicator.innerHTML = `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"></path></svg>`;
                        photoEl.appendChild(videoIndicator);
                    }

                    if (photo.isNew) {
                        const badge = document.createElement('span');
                        badge.className = 'new-badge';
                        badge.textContent = 'new!';
                        badge.style.position = 'absolute';
                        badge.style.top = '5px';
                        badge.style.right = '5px';
                        badge.style.zIndex = '10';
                        badge.style.backgroundColor = 'rgba(255, 255, 255, 0.8)';
                        badge.style.borderRadius = '4px';
                        photoEl.appendChild(badge);
                    }

                    photoEl.addEventListener('click', () => {
                        if (PeekDeleteManager.isEditMode) return;
                        if (photo.isNew) {
                            photo.isNew = false;
                            savePeekData(window.activePeekCharId);
                            const badge = photoEl.querySelector('.new-badge');
                            if (badge) badge.remove();
                        }
                        const modal = document.getElementById('peek-photo-modal');
                        const imgContainer = document.getElementById('peek-photo-image-container');
                        const descriptionEl = document.getElementById('peek-photo-description');

                        // 将AI生成的图片文字描述展示出来，而不是真的图片
                        imgContainer.innerHTML = `<div style="padding: 20px; text-align: left; color: #555; font-size: 16px; line-height: 1.6; height: 100%; overflow-y: auto;">${photo.imageDescription}</div>`;
                        // 显示角色对照片的批注
                        descriptionEl.textContent = `批注：${photo.description}`;

                        modal.classList.add('visible');
                    });

                    grid.appendChild(photoEl);
                });
            }

            function renderPeekUnlock(data) {
                const screen = document.getElementById('peek-unlock-screen');
                if (!screen) return;

                // Handle loading/empty state
                if (!data) {
                    screen.innerHTML = `
                    <header class="app-header">
                        <button class="back-btn" data-target="peek-screen">‹</button>
                        <div class="title-container"><h1 class="title">...</h1></div>
                        <button class="action-btn">···</button>
                    </header>
                    <main class="content"><p class="placeholder-text">正在生成小号内容...</p></main>
                `;
                    return;
                }

                const { nickname, handle, bio, posts } = data;
                const character = db.characters.find(c => c.id === window.activePeekCharId);
                const peekSettings = character?.peekScreenSettings || { unlockAvatar: '' };
                const fixedAvatar = peekSettings.unlockAvatar || 'https://i.postimg.cc/SNwL1XwR/chan-11.png';

                // Random numbers for stats
                const randomFollowers = (Math.random() * 5 + 1).toFixed(1) + 'k';
                const randomFollowing = Math.floor(Math.random() * 500) + 50;

                let postsHtml = '';
                if (posts && posts.length > 0) {
                const isEdit = PeekDeleteManager.isEditMode && PeekDeleteManager.currentAppType === 'unlock';
                
                    posts.forEach(post => {
                        // 为旧数据赋予ID使其能被选中和删除
                        if (!post.id) post.id = 'post_old_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
                        const isSelected = isEdit && PeekDeleteManager.selectedIds.has(post.id);
                        const randomComments = Math.floor(Math.random() * 100);
                        const randomLikes = Math.floor(Math.random() * 500);
                        postsHtml += `
                        <div class="unlock-post-card ${isEdit ? 'is-selecting' : ''} ${isSelected ? 'selected' : ''}" data-id="${post.id}" style="position:relative;">
                            ${post.isNew ? '<span class="new-badge" style="position:absolute; top:16px; right:16px;">new!</span>' : ''}
                            <div class="unlock-post-card-header">
                                <img src="${fixedAvatar}" alt="Profile Avatar">
                                <div class="unlock-post-card-author-info">
                                    <span class="username">${nickname}</span>
                                    <span class="timestamp">${post.timestamp}</span>
                                </div>
                            </div>
                            <div class="unlock-post-card-content">
                                ${post.content.replace(/\n/g, '<br>')}
                            </div>
                            <div class="unlock-post-card-actions">
                                <div class="action"><svg viewBox="0 0 24 24"><path d="M18,16.08C17.24,16.08 16.56,16.38 16.04,16.85L8.91,12.7C8.96,12.47 9,12.24 9,12C9,11.76 8.96,11.53 8.91,11.3L16.04,7.15C16.56,7.62 17.24,7.92 18,7.92C19.66,7.92 21,6.58 21,5C21,3.42 19.66,2 18,2C16.34,2 15,3.42 15,5C15,5.24 15.04,5.47 15.09,5.7L7.96,9.85C7.44,9.38 6.76,9.08 6,9.08C4.34,9.08 3,10.42 3,12C3,13.58 4.34,14.92 6,14.92C6.76,14.92 7.44,14.62 7.96,14.15L15.09,18.3C15.04,18.53 15,18.76 15,19C15,20.58 16.34,22 18,22C19.66,22 21,20.58 21,19C21,17.42 19.66,16.08 18,16.08Z"></path></svg> <span>分享</span></div>
                                <div class="action"><svg viewBox="0 0 24 24"><path d="M20,2H4C2.9,0,2,0.9,2,2v18l4-4h14c1.1,0,2-0.9,2-2V4C22,2.9,21.1,2,20,2z M18,14H6v-2h12V14z M18,11H6V9h12V11z M18,8H6V6h12V8z"></path></svg> <span>${randomComments}</span></div>
                                <div class="action"><svg viewBox="0 0 24 24"><path d="M12,21.35L10.55,20.03C5.4,15.36,2,12.27,2,8.5C2,5.42,4.42,3,7.5,3c1.74,0,3.41,0.81,4.5,2.09C13.09,3.81,14.76,3,16.5,3C19.58,3,22,5.42,22,8.5c0,3.78-3.4,6.86-8.55,11.54L12,21.35z"></path></svg> <span>${randomLikes}</span></div>
                            </div>
                        </div>
                    `;
                    });
                }

                screen.innerHTML = `
                <header class="app-header">
                    <button class="back-btn" data-target="peek-screen">‹</button>
                    <div class="title-container">
                        <h1 class="title">${nickname}</h1>
                    </div>
                    <button class="action-btn" id="refresh-unlock-btn"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"></path></svg></button>
                </header>
                <main class="content">
                    <div class="unlock-profile-header">
                        <img src="${fixedAvatar}" alt="Profile Avatar" class="unlock-profile-avatar">
                        <div class="unlock-profile-info">
                            <h2 class="unlock-profile-username">${nickname}</h2>
                            <p class="unlock-profile-handle">${handle}</p>
                        </div>
                    </div>
                    <div class="unlock-profile-bio">
                        <p>${bio.replace(/\n/g, '<br>')}</p>
                    </div>
                    <div class="unlock-profile-stats">
                        <div class="unlock-profile-stat">
                            <span class="count">${posts.length}</span>
                            <span class="label">帖子</span>
                        </div>
                        <div class="unlock-profile-stat">
                            <span class="count">${randomFollowers}</span>
                            <span class="label">粉丝</span>
                        </div>
                        <div class="unlock-profile-stat">
                            <span class="count">${randomFollowing}</span>
                            <span class="label">关注</span>
                        </div>
                    </div>
                    <div class="unlock-post-feed">
                        ${postsHtml}
                    </div>
                </main>
            `;

                // Add event listener for the new refresh button
                screen.querySelector('#refresh-unlock-btn').addEventListener('click', () => {
                    generateAndRenderPeekUnlock({ forceRefresh: true }); // <-- 修改为独立函数
                });

                // Clear isNew flags for the viewed posts
                let hasNewUnlock = false;
                if (data && data.posts) {
                    data.posts.forEach(post => {
                        if (post.isNew) {
                            post.isNew = false;
                            hasNewUnlock = true;
                        }
                    });
                    if (hasNewUnlock) savePeekData(window.activePeekCharId);
                }
            }

            function renderPeekConversation(history, partnerName) {
                const titleEl = document.getElementById('peek-conversation-title');
                const messageAreaEl = document.getElementById('peek-message-area');

                titleEl.textContent = partnerName;
                messageAreaEl.innerHTML = '';

                if (!history || history.length === 0) {
                    messageAreaEl.innerHTML = '<p class="placeholder-text">正在生成对话...</p>';
                    return;
                }

                history.forEach(msg => {
                    const isSentByChar = msg.sender === 'char'; // 'char' is the character whose phone we are peeking
                    const wrapper = document.createElement('div');
                    wrapper.className = `message-wrapper ${isSentByChar ? 'sent' : 'received'}`;

                    const bubbleRow = document.createElement('div');
                    bubbleRow.className = 'message-bubble-row';

                    const bubble = document.createElement('div');
                    bubble.className = `message-bubble ${isSentByChar ? 'sent' : 'received'}`;
                    bubble.textContent = msg.content;

                    if (isSentByChar) {
                        bubbleRow.appendChild(bubble);
                    } else {
                        const avatar = document.createElement('img');
                        avatar.className = 'message-avatar';
                        avatar.src = 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg';
                        bubbleRow.appendChild(avatar);
                        bubbleRow.appendChild(bubble);
                    }

                    wrapper.appendChild(bubbleRow);
                    messageAreaEl.appendChild(wrapper);
                });
                messageAreaEl.scrollTop = messageAreaEl.scrollHeight;
            }

            function renderPeekScreen() {
                const peekScreen = document.getElementById('peek-screen');
                const contentArea = peekScreen.querySelector('main.content');

                // Set content
                contentArea.innerHTML = `
                <div class="time-widget">
                    <div class="time" id="peek-time-display"></div>
                    <div class="date" id="peek-date-display"></div>
                </div>
                <div class="app-grid"></div>
            `;

                const character = db.characters.find(c => c.id === window.activePeekCharId);
                const peekSettings = character?.peekScreenSettings || { wallpaper: '', customIcons: {} };

                // Apply wallpaper to the parent screen element
                const wallpaper = peekSettings.wallpaper;
                if (wallpaper) {
                    peekScreen.style.backgroundImage = `url(${wallpaper})`;
                } else {
                    peekScreen.style.backgroundImage = `url(${db.wallpaper})`; // Fallback to global wallpaper
                }
                peekScreen.style.backgroundSize = 'cover';
                peekScreen.style.backgroundPosition = 'center';

                // Render the 6 specific, non-functional icons
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
// (在 renderPeekScreen 函数内部)
                iconEl.addEventListener('click', (e) => {
                    e.preventDefault();
                    // 所有应用全部路由到各自的独立函数！
                    if (id === 'album') {
                        generateAndRenderPeekAlbum();
                    } else if (id === 'browser') {
                        generateAndRenderPeekBrowser();
                    } else if (id === 'steps') {
                        generateAndRenderPeekSteps(); 
                    } else if (id === 'drafts') {
                        generateAndRenderPeekDrafts();
                    } else if (id === 'memos') {
                        generateAndRenderPeekMemos();
                    } else if (id === 'transfer') {
                        generateAndRenderPeekTransfer();
                    } else if (id === 'messages') {
                        generateAndRenderPeekMessages();
                    } else if (id === 'cart') {
                        generateAndRenderPeekCart();     // <-- 新增购物车通道
                    } else if (id === 'unlock') {
                        generateAndRenderPeekUnlock();   // <-- 新增小号通道
                    }
                });
                appGrid.appendChild(iconEl);
                });

                // Call updateClock to immediately populate the time
                updateClock();
            }

            function renderPeekChatList(conversations =[]) {
                const container = document.getElementById('peek-chat-list-container');
                container.innerHTML = '';

                if (!conversations || conversations.length === 0) {
                    // This case is handled by the loading/error message in generateAndRenderPeekContent
                    return;
                }

                const isEdit = PeekDeleteManager.isEditMode && PeekDeleteManager.currentAppType === 'messages';
                
                conversations.forEach((convo) => {
                    // 为旧数据赋id
                    if (!convo.id) convo.id = 'msg_old_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
                    const isSelected = isEdit && PeekDeleteManager.selectedIds.has(convo.id);
                    const history = convo.history || [];
                    const lastMessage = history.length > 0 ? history[history.length - 1] : null;
                    const lastMessageText = lastMessage ? (lastMessage.content || '').replace(/\[.*?的消息：([\s\S]+)\]/, '$1') : '...';

                    const li = document.createElement('li');
                    li.className = `list-item chat-item ${isEdit ? 'is-selecting' : ''} ${isSelected ? 'selected' : ''}`;
                    // Use partnerName as the unique identifier for clicking, but add data-id for deleting
                    li.dataset.name = convo.partnerName;
                    li.dataset.id = convo.id;

                    const avatarUrl = 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg';

                    li.innerHTML = `
                    <img src="${avatarUrl}" alt="${convo.partnerName}" class="chat-avatar">
                    <div class="item-details">
                        <div class="item-details-row"><div class="item-name">${convo.partnerName} ${convo.isNew ? '<span class="new-badge">new!</span>' : ''}</div></div>
                        <div class="item-preview-wrapper">
                            <div class="item-preview">${lastMessageText}</div>
                        </div>
                    </div>`;
                    container.appendChild(li);
                });
            }

            function renderMemosList(memos) {
                const screen = document.getElementById('peek-memos-screen');
                let listHtml = '';
                const isEdit = PeekDeleteManager.isEditMode && PeekDeleteManager.currentAppType === 'memos';
                
                if (!memos || memos.length === 0) {
                    listHtml = '<p class="placeholder-text">正在生成备忘录...</p>';
                } else {
                    memos.forEach(memo => {
                        // 补充旧数据缺失的id
                        if (!memo.id) memo.id = 'memo_old_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
                        const isSelected = isEdit && PeekDeleteManager.selectedIds.has(memo.id);
                        const firstLine = memo.content.split('\n')[0];
                        listHtml += `
                        <li class="memo-item ${isEdit ? 'is-selecting' : ''} ${isSelected ? 'selected' : ''}" data-id="${memo.id}">
                            <h3 class="memo-item-title">${memo.title} ${memo.isNew ? '<span class="new-badge">new!</span>' : ''}</h3>
                            <p class="memo-item-preview">${firstLine}</p>
                        </li>
                    `;
                    });
                }

                screen.innerHTML = `
                <header class="app-header">
                    <button class="back-btn" data-target="peek-screen">‹</button>
                    <div class="title-container"><h1 class="title">备忘录</h1></div>
                    <button class="action-btn"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"></path></svg></button>
                </header>
                <main class="content"><ul id="peek-memos-list">${listHtml}</ul></main>
            `;

 screen.querySelector('.action-btn').addEventListener('click', () => {
                    generateAndRenderPeekMemos({ forceRefresh: true }); // 修改为调用独立的备忘录生成函数
                });

                screen.querySelectorAll('.memo-item').forEach(item => {
                    item.addEventListener('click', () => {
                        if (PeekDeleteManager.isEditMode) return;
                        const memo = peekContentCache.memos?.memos?.find(m => m.id === item.dataset.id);
                        if (memo) {
                            if (memo.isNew) {
                                memo.isNew = false;
                                savePeekData(window.activePeekCharId);
                                const badge = item.querySelector('.new-badge');
                                if (badge) badge.remove();
                            }
                            renderMemoDetail(memo);
                            switchScreen('peek-memo-detail-screen');
                        }
                    });
                });
            }

            function renderMemoDetail(memo) {
                const screen = document.getElementById('peek-memo-detail-screen');
                if (!memo) return;
                const contentHtml = memo.content.replace(/\n/g, '<br>');
                screen.innerHTML = `
                <header class="app-header">
                    <button class="back-btn" data-target="peek-memos-screen">‹</button>
                    <div class="title-container"><h1 class="title">${memo.title}</h1></div>
                    <button class="action-btn"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"></path></svg></button>
                </header>
                <main class="content" style="padding: 20px; line-height: 1.6;">${contentHtml}</main>
            `;
            }

            function renderPeekCart(items) {
                const screen = document.getElementById('peek-cart-screen');
                let itemsHtml = '';
                let totalPrice = 0;

                const isEdit = PeekDeleteManager.isEditMode && PeekDeleteManager.currentAppType === 'cart';
                
                if (!items || items.length === 0) {
                    itemsHtml = '<p class="placeholder-text">正在生成购物车内容...</p>';
                } else {
                    items.forEach(item => {
                        if (!item.id) item.id = 'cart_old_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
                        const isSelected = isEdit && PeekDeleteManager.selectedIds.has(item.id);
                        itemsHtml += `
                        <li class="cart-item ${isEdit ? 'is-selecting' : ''} ${isSelected ? 'selected' : ''}" data-id="${item.id}">
                            <img src="https://i.postimg.cc/wMbSMvR9/export202509181930036600.png" class="cart-item-image" alt="${item.title}">
                            <div class="cart-item-details">
                                <h3 class="cart-item-title">${item.title} ${item.isNew ? '<span class="new-badge">new!</span>' : ''}</h3>
                                <p class="cart-item-spec">规格：${item.spec}</p>
                                <p class="cart-item-price">¥${item.price}</p>
                            </div>
                        </li>
                    `;
                        totalPrice += parseFloat(item.price);
                    });
                }

                screen.innerHTML = `
               <header class="app-header">
                   <button class="back-btn" data-target="peek-screen">‹</button>
                   <div class="title-container"><h1 class="title">购物车</h1></div>
                   <button class="action-btn"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"></path></svg></button>
               </header>
               <main class="content"><ul class="cart-item-list">${itemsHtml}</ul></main>
               <footer class="cart-footer">
                   <div class="cart-total-price">
                       <span class="label">合计：</span>¥${totalPrice.toFixed(2)}
                   </div>
                   <button class="checkout-btn">结算</button>
               </footer>
           `;

                screen.querySelector('.checkout-btn').addEventListener('click', () => {
                    showToast('功能开发中');
                });
// 新增：为顶部栏的刷新按钮绑定重新生成事件
                screen.querySelector('.action-btn').addEventListener('click', () => {
                    generateAndRenderPeekCart({ forceRefresh: true });
                });
                // Clear isNew flags for the viewed cart items
                let hasNewCart = false;
                if (items) {
                    items.forEach(item => {
                        if (item.isNew) {
                            item.isNew = false;
                            hasNewCart = true;
                        }
                    });
                    if (hasNewCart) savePeekData(window.activePeekCharId);
                }
            }

            function renderPeekTransferStation(entries) {
                const screen = document.getElementById('peek-transfer-station-screen');
                let messagesHtml = '';

                const isEdit = PeekDeleteManager.isEditMode && PeekDeleteManager.currentAppType === 'transfer';
                
if (!entries || entries.length === 0) {
                    messagesHtml = '<p class="placeholder-text">正在生成中转站内容...</p>';
                } else {
                    // === 修复2：数据格式迁移 ===
                    // 将旧版本的纯字符串数据转换为新的对象结构，以支持 ID 绑定
                    let needsSave = false;
                    for (let i = 0; i < entries.length; i++) {
                        if (typeof entries[i] === 'string') {
                            entries[i] = {
                                id: 'transfer_old_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
                                content: entries[i], // 将原本的字符串放入 content 字段
                                isNew: false
                            };
                            needsSave = true;
                        } else if (!entries[i].id) {
                            entries[i].id = 'transfer_old_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
                            needsSave = true; // 补充了 ID 也触发一次静默保存
                        }
                    }
                    
                    // 如果发生了数据结构升级，后台静默保存一下
                    if (needsSave && window.activePeekCharId) {
                        savePeekData(window.activePeekCharId).catch(e => console.error(e));
                    }

                    entries.forEach(entry => {
                        const isSelected = isEdit && PeekDeleteManager.selectedIds.has(entry.id);
                        // Each entry is a message from the character to themselves.
                        // We'll render it as a 'sent' message bubble.
                        messagesHtml += `
                        <div class="message-wrapper sent transfer-item ${isEdit ? 'is-selecting' : ''} ${isSelected ? 'selected' : ''}" data-id="${entry.id}" style="position:relative;">
                            <div class="message-bubble-row" style="align-items: center;">
                                <div class="message-bubble sent" style="background-color: #98E165; color: #000;">
                                    ${entry.content}
                                </div>
                                ${entry.isNew ? '<span class="new-badge" style="margin-left: 8px;">new!</span>' : ''}
                            </div>
                        </div>
                    `;
                    });
                }

                screen.innerHTML = `
               <header class="app-header">
                   <button class="back-btn" data-target="peek-screen">‹</button>
                   <div class="title-container">
                       <h1 class="title">文件传输助手</h1>
                   </div>
                   <button class="action-btn">
                       <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"></path></svg>
                   </button>
               </header>
               <main class="content">
                   <div class="message-area" style="padding: 10px;">
                        ${messagesHtml}
                   </div>
                   <div class="transfer-station-input-area">
                       <div class="fake-input"></div>
                       <button class="plus-btn"></button>
                   </div>
               </main>
           `;

                screen.querySelector('.action-btn').addEventListener('click', () => {
                   generateAndRenderPeekTransfer({ forceRefresh: true }); // <-- 修改为调用独立的中转站生成函数
               });

                const messageArea = screen.querySelector('.message-area');
                if (messageArea) {
                    messageArea.scrollTop = messageArea.scrollHeight;
                }

                // Clear isNew flags for viewed entries
                let hasNewTransfer = false;
                if (entries) {
                    entries.forEach(entry => {
                        if (entry.isNew) {
                            entry.isNew = false;
                            hasNewTransfer = true;
                        }
                    });
                    if (hasNewTransfer) savePeekData(window.activePeekCharId);
                }
            }

            function renderPeekBrowser(historyItems) {
                const screen = document.getElementById('peek-browser-screen');
                let itemsHtml = '';
               const isEdit = PeekDeleteManager.isEditMode && PeekDeleteManager.currentAppType === 'browser';
                
                if (!historyItems || historyItems.length === 0) {
                    itemsHtml = '<p class="placeholder-text">正在生成浏览记录...</p>';
                } else {
                    historyItems.forEach(item => {
                        if (!item.id) item.id = 'browser_old_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
                        const isSelected = isEdit && PeekDeleteManager.selectedIds.has(item.id);
                        itemsHtml += `
                        <li class="browser-history-item ${isEdit ? 'is-selecting' : ''} ${isSelected ? 'selected' : ''}" data-id="${item.id}">
                            <h3 class="history-item-title">${item.isNew ? '<span class="new-badge">new!</span>' : ''}${item.title}</h3>
                            <p class="history-item-url">${item.url}</p>
                            <div class="history-item-annotation">${item.annotation}</div>
                        </li>
                    `;
                    });
                }

                screen.innerHTML = `
              <header class="app-header">
                  <button class="back-btn" data-target="peek-screen">‹</button>
                  <div class="title-container"><h1 class="title">浏览器</h1></div>
                  <button class="action-btn"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"></path></svg></button>
              </header>
<main class="content"><ul class="browser-history-list">${itemsHtml}</ul></main>
          `;
                screen.querySelector('.action-btn').addEventListener('click', () => {
                    generateAndRenderPeekBrowser({ forceRefresh: true }); // 修改为调用独立的浏览器生成函数
                });

                // Clear isNew flags for viewed browser history
                let hasNewBrowser = false;
                if (historyItems) {
                    historyItems.forEach(item => {
                        if (item.isNew) {
                            item.isNew = false;
                            hasNewBrowser = true;
                        }
                    });
                    if (hasNewBrowser) savePeekData(window.activePeekCharId);
                }
            }

            function renderPeekDrafts(draft) {
                const screen = document.getElementById('peek-drafts-screen');
                let draftTo = '...';
                let draftContent = '<p class="placeholder-text">正在生成草稿...</p>';

                if (draft) {
                    draftTo = draft.to;
                    draftContent = draft.content;
                }

                screen.innerHTML = `
               <header class="app-header">
                   <button class="back-btn" data-target="peek-screen">‹</button>
                   <div class="title-container"><h1 class="title">草稿箱</h1></div>
                   <button class="action-btn"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"></path></svg></button>
               </header>
               <main class="content">
                   <div class="draft-paper">
                       <div class="draft-to">To: ${draftTo}</div>
                       <div class="draft-content">${draftContent}</div>
                   </div>
               </main>
           `;
screen.querySelector('.action-btn').addEventListener('click', () => {
                   generateAndRenderPeekDrafts({ forceRefresh: true }); // 修改为调用独立的草稿箱生成函数
               });
            }
            
                                    function renderPeekSteps(data) {
                const screen = document.getElementById('peek-steps-screen');
                const char = db.characters.find(c => c.id === window.activePeekCharId);
                if (!char) return; // 如果找不到角色，则不渲染

                const avatarEl = screen.querySelector('#steps-char-avatar');
                const nameEl = screen.querySelector('#steps-char-name');
                const currentStepsEl = screen.querySelector('#steps-current-count');
                const goalStepsEl = screen.querySelector('.steps-label');
                const progressRingEl = screen.querySelector('#steps-progress-ring');
                const trackListEl = screen.querySelector('#activity-track-list');
                const annotationEl = screen.querySelector('#steps-annotation-content');

                // 无论AI数据是否返回，都先渲染固定信息
                avatarEl.src = char.avatar;
                nameEl.textContent = char.realName;
                goalStepsEl.textContent = '/ 6000 步';

                if (!data) {
                    // Display loading or empty state for dynamic content
                    currentStepsEl.textContent = '----';
                    trackListEl.innerHTML = '<li class="activity-track-item">正在生成活动轨迹...</li>';
                    annotationEl.textContent = '正在生成角色批注...';
                    progressRingEl.style.setProperty('--steps-percentage', 0);
                    return;
                }

                // 填充AI返回的动态内容
                currentStepsEl.textContent = data.currentSteps;

                const percentage = (data.currentSteps / 6000) * 100;
                progressRingEl.style.setProperty('--steps-percentage', percentage);

                trackListEl.innerHTML = data.trajectory.map(item => `<li class="activity-track-item">${item}</li>`).join('');
                annotationEl.textContent = data.annotation;
            }

            function renderPeekSettings() {
                const character = db.characters.find(c => c.id === window.activePeekCharId);
                if (!character) return;

                const peekSettings = character.peekScreenSettings || { wallpaper: '', customIcons: {}, unlockAvatar: '', contextLimit: 50 };

                // Populate wallpaper
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

                // Add event listeners for all new upload buttons
                iconsContainer.querySelectorAll('input[type="file"]').forEach(uploadInput => {
                    uploadInput.addEventListener('change', handlePeekIconUpload);
                });

                // Populate unlock avatar url
                document.getElementById('peek-unlock-avatar-url').value = peekSettings.unlockAvatar || '';
                document.getElementById('peek-context-limit').value = peekSettings.contextLimit !== undefined ? peekSettings.contextLimit : 50;
            }

            async function handlePeekIconUpload(e) {
                const file = e.target.files[0];
                const appId = e.target.dataset.appId;
                if (file && appId) {
                    try {
                        const compressedUrl = await compressImage(file, { quality: 0.8, maxWidth: 120, maxHeight: 120 });
                        const urlInput = document.querySelector(`#peek-app-icons-settings input[data-app-id="${appId}"]`);
                        const previewImg = urlInput.closest('.icon-custom-item').querySelector('.icon-preview');
                        if (urlInput) {
                            urlInput.value = compressedUrl;
                        }
                        if (previewImg) {
                            previewImg.src = compressedUrl;
                        }
                        showToast(`${peekScreenApps[appId].name} 图标已上传并压缩`);
                    } catch (error) {
                        showToast('图标压缩失败，请重试');
                    }
                }
            }


// ==========================================
// 独立应用生成函数：相册 (Album) + 顺风车提取
// ==========================================
async function generateAndRenderPeekAlbum(options = {}) {
    const appType = 'album';
    const { forceRefresh = false } = options;

    if (generatingPeekApps.has(appType)) {
        showToast('相册内容正在生成中，请稍候...');
        return;
    }

    if (!forceRefresh && peekContentCache[appType]) {
        renderPeekAlbum(peekContentCache[appType].photos);
        switchScreen('peek-album-screen');
        return;
    }

    const char = db.characters.find(c => c.id === window.activePeekCharId);
    if (!char) return showToast('无法找到当前角色');

    const { url, key, model } = db.apiSettings;
    if (!url || !key || !model) {
        showToast('请先配置 API！');
        return switchScreen('api-settings-screen');
    }

    generatingPeekApps.add(appType);
    switchScreen('peek-album-screen');    
    
    // 使用统一的加载动画
    const hideLoading = showLoadingToast('正在读取相册数据...');

    try {
        const peekSettings = char.peekScreenSettings || {};
        const limitCount = (peekSettings.contextLimit !== undefined) ? peekSettings.contextLimit : 50;
        const mainChatContext = limitCount > 0 ? char.history.slice(-limitCount).map(m => m.content).join('\n') : "";
        
        const senderName = char.realName || char.name;
        const baseContextPrompt = getPeekBasePromptContext(char, mainChatContext);
        
        let systemPrompt = `你正在模拟角色 ${char.realName} 的手机相册。\n`;
        systemPrompt += baseContextPrompt;
        
        systemPrompt += `
【任务1：相册数据】
请为 ${char.realName} 的手机相册生成5-8个Ta拍摄的照片或视频。内容需要与Ta的人设和聊天上下文高度相关。'IMAGE_DESC' 是对这张照片/视频的详细文字描述，它将代替真实的图片展示给用户。'ANNOTATION' 是 ${char.realName} 自己对这张照片/视频的批注，会显示在描述下方。

【任务2：话题分享】
在相册内容生成完毕后，请从你刚刚生成的相册内容中挑选1个你认为最适合分享给${char.myName}的条目。
预测一下，在未来的某个时间，${senderName}会主动把这张照片/视频发给${char.myName}，并开启话题。
`;

        systemPrompt += getPeekProactiveFormatPrompt(char);

        systemPrompt += `
请严格按照以下标签文本格式输出，**相册条目之间使用 ===SEP=== 分隔**。在相册结束后，使用 ===PROACTIVE_MESSAGES=== 分割，再输出主动消息。

输出格式示例：
#TYPE#
photo
#IMAGE_DESC#
一张傍晚在海边的自拍，背景是橙色的晚霞和归来的渔船。
#ANNOTATION#
那天的风很舒服。
===SEP===
#TYPE#
video
#IMAGE_DESC#
一段在猫咖撸猫的视频，视频里有一只橘猫在打哈欠。
#ANNOTATION#
下次还来这里！
===PROACTIVE_MESSAGES===
#SECRET_CHAT_AFTERNOON_85%#[15:15|${senderName}发来的照片/视频:详细描述][15:16|${senderName}的消息:翻相册看到这张，觉得挺好看的，发给你看看。]
`;

        const requestBody = { model: model, messages:[{ role: 'user', content: systemPrompt }], temperature: 0.85 };
        const response = await fetch(`${url}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) throw new Error(`API error: ${response.status}`);
        const result = await response.json();
        const contentStr = result.choices[0].message.content.trim();

        const parts = contentStr.split(/===PROACTIVE_MESSAGES===/i);
        const albumRawText = parts[0] || '';
        const hitchhikerRawText = parts.length > 1 ? parts[1] : '';

        const rawPhotos = albumRawText.split('===SEP===');
        const parsedPhotos =[];

        rawPhotos.forEach(rawText => {
            if (!rawText.trim()) return;
            const typeMatch = rawText.match(/#TYPE#\s*([\s\S]*?)(?=#IMAGE_DESC#|$)/);
            const descMatch = rawText.match(/#IMAGE_DESC#\s*([\s\S]*?)(?=#ANNOTATION#|$)/);
            const annoMatch = rawText.match(/#ANNOTATION#\s*([\s\S]*?)(?=(?:===SEP===|$))/);

            if (typeMatch && descMatch) {
                parsedPhotos.push({
                    id: `album_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`, // 给每张照片打上唯一ID
                    type: typeMatch[1].trim() === 'video' ? 'video' : 'photo',
                    imageDescription: descMatch[1].trim(),
                    description: annoMatch ? annoMatch[1].trim() : '无批注',
                    isNew: true
                });
            }
        });

        if (parsedPhotos.length > 0) {
            // 如果以前没生成过相册，先初始化一个空列表
            if (!peekContentCache['album']) peekContentCache['album'] = { photos:[] };

            peekContentCache['album'].photos = [...parsedPhotos, ...peekContentCache['album'].photos];
            
            savePeekData(char.id).catch(e => console.error("Peek自动保存失败:", e)); // 独立防卡顿保存
            renderPeekAlbum(peekContentCache['album'].photos);
        } else {
            throw new Error("解析相册内容失败，未找到对应标签。");
        }

        if (hitchhikerRawText.trim()) {
            parseAndSavePeekProactiveHitchhiker(char, hitchhikerRawText);
            saveSingleChat(char.id, 'private').catch(e => console.error(e));
        }

    } catch (error) {
        console.error(error);
        showApiError(error);
        // 如果有缓存且存在历史数据，报错时不冲掉已有视图
        if (peekContentCache['album'] && peekContentCache['album'].photos && peekContentCache['album'].photos.length > 0) {
            renderPeekAlbum(peekContentCache['album'].photos);
            if (typeof showToast === 'function') showToast('刷新失败: ' + error.message);
        } else {
            document.querySelector('#peek-album-screen .album-grid').innerHTML = `<p class="placeholder-text">内容生成失败，请重试。<br><span style="font-size:12px;color:#999;">${error.message}</span></p>`;
        }
    } finally {
        generatingPeekApps.delete(appType);
        hideLoading(); // 关闭加载动画
    }
}

// ==========================================
// 独立应用生成函数：浏览器 (Browser) + 顺风车提取
// ==========================================
async function generateAndRenderPeekBrowser(options = {}) {
    const appType = 'browser';
    const { forceRefresh = false } = options;

    if (generatingPeekApps.has(appType)) {
        showToast('浏览器内容正在生成中，请稍候...');
        return;
    }

    if (!forceRefresh && peekContentCache[appType]) {
        renderPeekBrowser(peekContentCache[appType].history);
        switchScreen('peek-browser-screen');
        return;
    }

    const char = db.characters.find(c => c.id === window.activePeekCharId);
    if (!char) return showToast('无法找到当前角色');

    const { url, key, model } = db.apiSettings;
    if (!url || !key || !model) {
        showToast('请先配置 API！');
        return switchScreen('api-settings-screen');
    }

    generatingPeekApps.add(appType);
    switchScreen('peek-browser-screen');    
    
    // 调用全局加载框
    const hideLoading = showLoadingToast('正在生成浏览记录...');

    try {
        const peekSettings = char.peekScreenSettings || {};
        const limitCount = (peekSettings.contextLimit !== undefined) ? peekSettings.contextLimit : 50;
        const mainChatContext = limitCount > 0 ? char.history.slice(-limitCount).map(m => m.content).join('\n') : "";
        
        const senderName = char.realName || char.name;
        const baseContextPrompt = getPeekBasePromptContext(char, mainChatContext);
        
        let systemPrompt = `你正在模拟角色 ${char.realName} 的手机浏览器浏览记录。\n`;
        systemPrompt += baseContextPrompt;
        
        systemPrompt += `
【任务1：浏览器记录】
请生成3-5条浏览记录。记录本身要符合${char.realName}的人设和聊天上下文，'ANNOTATION' 字段则要站在角色自己的视角，记录Ta对这条浏览记录的想法或批注。

【任务2：话题分享】
在浏览记录生成完毕后，请从你刚刚生成的内容中挑选1个你认为最适合分享给${char.myName}的网页。
预测一下，在未来的某个时间，${senderName}会根据这个网页内容，发送消息给${char.myName}开启话题。
`;

        systemPrompt += getPeekProactiveFormatPrompt(char);

        systemPrompt += `
请严格按照以下标签文本格式输出，**浏览记录之间使用 ===SEP=== 分隔**。在浏览记录结束后，使用 ===PROACTIVE_MESSAGES=== 分割，再输出主动消息。

输出格式示例：
#TITLE#
超简单！10分钟搞定的快手早餐教程
#URL#
www.example.com/breakfast-tutorial
#ANNOTATION#
明早可以试试看，看起来很好吃。
===SEP===
#TITLE#
网页标题
#URL#
www.example.com/tech-review-2026
#ANNOTATION#
角色对于这条浏览记录的想法或批注
===PROACTIVE_MESSAGES===
#SECRET_CHAT_EVENING_85%#[19:15|${senderName}的消息:最近有没有什么特别想吃的？][19:16|${senderName}的消息:我刚刚看到一个不错的菜谱，周末我们一起做做看？]
`;

        const requestBody = { model: model, messages:[{ role: 'user', content: systemPrompt }], temperature: 0.85 };
        const response = await fetch(`${url}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) throw new Error(`API error: ${response.status}`);
        const result = await response.json();
        const contentStr = result.choices[0].message.content.trim();

        const parts = contentStr.split(/===PROACTIVE_MESSAGES===/i);
        const browserRawText = parts[0] || '';
        const hitchhikerRawText = parts.length > 1 ? parts[1] : '';

        // 解析文本格式标签
        const rawItems = browserRawText.split('===SEP===');
        const parsedHistory =[];

        rawItems.forEach(rawText => {
            if (!rawText.trim()) return;
            const titleMatch = rawText.match(/#TITLE#\s*([\s\S]*?)(?=#URL#|$)/);
            const urlMatch = rawText.match(/#URL#\s*([\s\S]*?)(?=#ANNOTATION#|$)/);
            const annoMatch = rawText.match(/#ANNOTATION#\s*([\s\S]*?)(?=(?:===SEP===|$))/);

if (titleMatch && urlMatch) {
                parsedHistory.push({
                    id: `browser_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`, // 生成浏览器ID
                    title: titleMatch[1].trim(),
                    url: urlMatch[1].trim(),
                    annotation: annoMatch ? annoMatch[1].trim() : '',
                    isNew: true
                });
            }
        });

        if (parsedHistory.length > 0) {
            if (!peekContentCache['browser']) peekContentCache['browser'] = { history:[] };
            
            // 增量拼接
            peekContentCache['browser'].history = [...parsedHistory, ...peekContentCache['browser'].history];
            
            savePeekData(char.id).catch(e => console.error("Peek自动保存失败:", e));
            renderPeekBrowser(peekContentCache['browser'].history);
        } else {
            throw new Error("解析浏览器内容失败，未找到对应标签。");
        }

        // 提取并保存顺风车消息
        if (hitchhikerRawText.trim()) {
            parseAndSavePeekProactiveHitchhiker(char, hitchhikerRawText);
            saveSingleChat(char.id, 'private').catch(e => console.error(e));
        }

    } catch (error) {
        console.error(error);
        showApiError(error);
        if (peekContentCache['browser'] && peekContentCache['browser'].history && peekContentCache['browser'].history.length > 0) {
            renderPeekBrowser(peekContentCache['browser'].history);
            if (typeof showToast === 'function') showToast('刷新失败: ' + error.message);
        } else {
            document.querySelector('#peek-browser-screen .browser-history-list').innerHTML = `<li class="browser-history-item"><p class="placeholder-text" style="text-align:center;">内容生成失败，请重试。<br><span style="font-size:12px;color:#999;">${error.message}</span></p></li>`;
        }
    } finally {
        generatingPeekApps.delete(appType);
        hideLoading(); // 关闭加载动画
    }
}

// ==========================================
// 独立应用生成函数：步数 (Steps) + 顺风车提取
// ==========================================
async function generateAndRenderPeekSteps(options = {}) {
    const appType = 'steps';
    const { forceRefresh = false } = options;

    if (generatingPeekApps.has(appType)) {
        showToast('步数内容正在生成中，请稍候...');
        return;
    }

    if (!forceRefresh && peekContentCache[appType]) {
        renderPeekSteps(peekContentCache[appType]);
        switchScreen('peek-steps-screen');
        return;
    }

    const char = db.characters.find(c => c.id === window.activePeekCharId);
    if (!char) return showToast('无法找到当前角色');

    const { url, key, model } = db.apiSettings;
    if (!url || !key || !model) {
        showToast('请先配置 API！');
        return switchScreen('api-settings-screen');
    }

    generatingPeekApps.add(appType);
    switchScreen('peek-steps-screen');
    
    // 调用全局加载框
    const hideLoading = showLoadingToast('正在生成步数记录...');

    try {
        const peekSettings = char.peekScreenSettings || {};
        const limitCount = (peekSettings.contextLimit !== undefined) ? peekSettings.contextLimit : 50;
        const mainChatContext = limitCount > 0 ? char.history.slice(-limitCount).map(m => m.content).join('\n') : "";
        
        const senderName = char.realName || char.name;
        const baseContextPrompt = getPeekBasePromptContext(char, mainChatContext);
        
        let systemPrompt = `你正在模拟角色 ${char.realName} 的手机记步应用。\n`;
        systemPrompt += baseContextPrompt;
        
        systemPrompt += `
【任务1：步数与轨迹数据】
请为 ${char.realName} 生成今天的步数信息。你只需要生成Ta的当前步数(CURRENT_STEPS)，Ta的6条运动轨迹(TRAJECTORY)（禁止照搬示例）以及批注(ANNOTATION)。内容需要与${char.realName}的人设和聊天上下文高度相关。

【任务2：话题分享】
在步数信息生成完毕后，请结合这部分内容
，预测一下，在未来的某个时间，${senderName}会主动把这个情况分享/发消息给${char.myName}，并开启话题。
`;

        systemPrompt += getPeekProactiveFormatPrompt(char);

        systemPrompt += `
请严格按照以下标签文本格式输出。在步数信息结束后，使用 ===PROACTIVE_MESSAGES=== 分割，再输出主动消息。

输出格式示例：
#CURRENT_STEPS#
8102
#TRAJECTORY#
08:30 AM - 公司楼下咖啡馆
10:00 AM - 宠物用品店
12:00 PM - 附近日料店
03:00 PM - 回家路上的甜品店
04:00 PM - 楼下的便利店
06:30 PM - 健身房
#ANNOTATION#
角色对自己今天运动情况的批注
===PROACTIVE_MESSAGES===
#SECRET_CHAT_EVENING_85%#[19:15|${senderName}的消息:最近一直在健身～][19:16|${senderName}的消息:感觉隐约有点儿肌肉了][19:16|${senderName}发来的照片/视频:手臂照片][19:16|${senderName}的消息:你看是不是？]
`;

        const requestBody = { model: model, messages:[{ role: 'user', content: systemPrompt }], temperature: 0.85 };
        const response = await fetch(`${url}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) throw new Error(`API error: ${response.status}`);
        const result = await response.json();
        const contentStr = result.choices[0].message.content.trim();

        const parts = contentStr.split(/===PROACTIVE_MESSAGES===/i);
        const stepsRawText = parts[0] || '';
        const hitchhikerRawText = parts.length > 1 ? parts[1] : '';

        // 解析文本格式标签
        const stepsMatch = stepsRawText.match(/#CURRENT_STEPS#\s*(\d+)/i);
        const trajMatch = stepsRawText.match(/#TRAJECTORY#\s*([\s\S]*?)(?=#ANNOTATION#|$)/i);
        const annoMatch = stepsRawText.match(/#ANNOTATION#\s*([\s\S]*?)$/i);

        if (stepsMatch && trajMatch) {
            const parsedSteps = {
                currentSteps: parseInt(stepsMatch[1].trim(), 10),
                // 按行分割并去除空行
                trajectory: trajMatch[1].trim().split('\n').map(s => s.trim()).filter(Boolean),
                annotation: annoMatch ? annoMatch[1].trim() : '无批注'
            };

            peekContentCache['steps'] = parsedSteps;
            savePeekData(char.id).catch(e => console.error("Peek自动保存失败:", e));
            renderPeekSteps(parsedSteps);
        } else {
            throw new Error("解析步数内容失败，未找到对应标签。");
        }

        // 提取并保存顺风车消息
        if (hitchhikerRawText.trim()) {
            parseAndSavePeekProactiveHitchhiker(char, hitchhikerRawText);
            saveSingleChat(char.id, 'private').catch(e => console.error(e));
        }

    } catch (error) {
        console.error(error);
        showApiError(error);
        if (peekContentCache['steps']) {
            renderPeekSteps(peekContentCache['steps']);
            if (typeof showToast === 'function') showToast('刷新失败: ' + error.message);
        } else {
            // 生成失败时在页面上呈现错误反馈
            const screen = document.getElementById('peek-steps-screen');
            if (screen) {
                const currentStepsEl = screen.querySelector('#steps-current-count');
                const trackListEl = screen.querySelector('#activity-track-list');
                const annotationEl = screen.querySelector('#steps-annotation-content');
                if(currentStepsEl) currentStepsEl.textContent = '错误';
                if(trackListEl) trackListEl.innerHTML = `<li class="activity-track-item" style="color:#ff4d4f;">内容生成失败，请重试。<br><span style="font-size:12px;">${error.message}</span></li>`;
                if(annotationEl) annotationEl.textContent = '生成失败';
            }
        }
    } finally {
        generatingPeekApps.delete(appType);
        hideLoading(); // 关闭加载动画
    }
}

// ==========================================
// 独立应用生成函数：草稿箱 (Drafts) + 顺风车提取
// ==========================================
async function generateAndRenderPeekDrafts(options = {}) {
    const appType = 'drafts';
    const { forceRefresh = false } = options;

    if (generatingPeekApps.has(appType)) {
        showToast('草稿箱内容正在生成中，请稍候...');
        return;
    }

    if (!forceRefresh && peekContentCache[appType]) {
        renderPeekDrafts(peekContentCache[appType].draft);
        switchScreen('peek-drafts-screen');
        return;
    }

    const char = db.characters.find(c => c.id === window.activePeekCharId);
    if (!char) return showToast('无法找到当前角色');

    const { url, key, model } = db.apiSettings;
    if (!url || !key || !model) {
        showToast('请先配置 API！');
        return switchScreen('api-settings-screen');
    }

    generatingPeekApps.add(appType);
    switchScreen('peek-drafts-screen');   
    
    // 调用全局加载框
    const hideLoading = showLoadingToast('正在生成草稿...');

    try {
        const peekSettings = char.peekScreenSettings || {};
        const limitCount = (peekSettings.contextLimit !== undefined) ? peekSettings.contextLimit : 50;
        const mainChatContext = limitCount > 0 ? char.history.slice(-limitCount).map(m => m.content).join('\n') : "";
        
        const senderName = char.realName || char.name;
        const baseContextPrompt = getPeekBasePromptContext(char, mainChatContext);
        
        let systemPrompt = `你正在模拟角色 ${char.realName} 的手机草稿箱。\n`;
        systemPrompt += baseContextPrompt;
        
        systemPrompt += `
【任务1：草稿内容】
请结合最近的聊天上下文，生成一份 ${char.realName} 写给${char.myName}，但犹豫未决、未发送的消息草稿。内容要深刻、细腻，反映${char.realName}的内心挣扎、真实情感和与${char.myName}的关系。
可以使用HTML的<span class='strikethrough'></span>标签来表示写了又删掉（划掉）的文字。
你需要生成收件人(#TO#)和草稿正文(#CONTENT#)。

【任务2：话题分享】
在草稿生成完毕后，请结合草稿中的情绪或未说出口的话，预测一下，在未来的某个时间，${senderName}最终鼓起勇气，或者换了一种相对轻松/隐晦的方式，把相关的心意或话题发给${char.myName}开启对话。
`;

        systemPrompt += getPeekProactiveFormatPrompt(char);

        systemPrompt += `
请严格按照以下标签文本格式输出。在草稿内容结束后，使用 ===PROACTIVE_MESSAGES=== 分割，再输出主动消息。

输出格式示例：
#TO#
${char.myName}
#CONTENT#
一封写给${char.myName}但未发送的草稿内容，可以使用HTML的<span class='strikethrough'></span>标签来表示划掉的文字。
===PROACTIVE_MESSAGES===
#SECRET_CHAT_NIGHT_85%#[23:15|${senderName}的消息:睡了吗？][23:16|${senderName}的消息:今天又路过那家店，突然有点想你。]
`;

        const requestBody = { model: model, messages:[{ role: 'user', content: systemPrompt }], temperature: 0.85 };
        const response = await fetch(`${url}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) throw new Error(`API error: ${response.status}`);
        const result = await response.json();
        const contentStr = result.choices[0].message.content.trim();

        const parts = contentStr.split(/===PROACTIVE_MESSAGES===/i);
        const draftsRawText = parts[0] || '';
        const hitchhikerRawText = parts.length > 1 ? parts[1] : '';

        // 解析文本格式标签
        const toMatch = draftsRawText.match(/#TO#\s*([\s\S]*?)(?=#CONTENT#|$)/i);
        const contentMatch = draftsRawText.match(/#CONTENT#\s*([\s\S]*?)$/i);

        if (toMatch && contentMatch) {
            const parsedDraft = {
                draft: {
                    to: toMatch[1].trim(),
                    content: contentMatch[1].trim()
                }
            };

            peekContentCache['drafts'] = parsedDraft;
            savePeekData(char.id).catch(e => console.error("Peek自动保存失败:", e));
            renderPeekDrafts(parsedDraft.draft);
        } else {
            throw new Error("解析草稿内容失败，未找到对应标签。");
        }

        // 提取并保存顺风车消息
        if (hitchhikerRawText.trim()) {
            parseAndSavePeekProactiveHitchhiker(char, hitchhikerRawText);
            saveSingleChat(char.id, 'private').catch(e => console.error(e));
        }

    } catch (error) {
        console.error(error);
        showApiError(error);
        if (peekContentCache['drafts'] && peekContentCache['drafts'].draft) {
            renderPeekDrafts(peekContentCache['drafts'].draft);
            if (typeof showToast === 'function') showToast('刷新失败: ' + error.message);
        } else {
            const screen = document.getElementById('peek-drafts-screen');
            if (screen) {
                const draftContentEl = screen.querySelector('.draft-content');
                if (draftContentEl) {
                    draftContentEl.innerHTML = `<p class="placeholder-text" style="color:#ff4d4f;">内容生成失败，请重试。<br><span style="font-size:12px;">${error.message}</span></p>`;
                }
            }
        }
    } finally {
        generatingPeekApps.delete(appType);
        hideLoading(); // 关闭加载动画
    }
}

// ==========================================
// 独立应用生成函数：备忘录 (Memos) + 顺风车提取
// ==========================================
async function generateAndRenderPeekMemos(options = {}) {
    const appType = 'memos';
    const { forceRefresh = false } = options;

    if (generatingPeekApps.has(appType)) {
        showToast('备忘录内容正在生成中，请稍候...');
        return;
    }

    if (!forceRefresh && peekContentCache[appType]) {
        renderMemosList(peekContentCache[appType].memos);
        switchScreen('peek-memos-screen');
        return;
    }

    const char = db.characters.find(c => c.id === window.activePeekCharId);
    if (!char) return showToast('无法找到当前角色');

    const { url, key, model } = db.apiSettings;
    if (!url || !key || !model) {
        showToast('请先配置 API！');
        return switchScreen('api-settings-screen');
    }

    generatingPeekApps.add(appType);
    switchScreen('peek-memos-screen');
    
    // 调用全局加载框
    const hideLoading = showLoadingToast('正在生成备忘录...');

    try {
        const peekSettings = char.peekScreenSettings || {};
        const limitCount = (peekSettings.contextLimit !== undefined) ? peekSettings.contextLimit : 50;
        const mainChatContext = limitCount > 0 ? char.history.slice(-limitCount).map(m => m.content).join('\n') : "";
        
        const senderName = char.realName || char.name;
        const baseContextPrompt = getPeekBasePromptContext(char, mainChatContext);
        
        let systemPrompt = `你正在模拟角色 ${char.realName} 的手机备忘录应用。\n`;
        systemPrompt += baseContextPrompt;
        
        systemPrompt += `
【任务1：备忘录内容】
请为 ${char.realName} 生成3-4条备忘录。内容要与${char.realName}的人设和聊天上下文高度相关。备忘录可以反映${char.realName}的计划、灵感、或者是日常琐事，备忘录正文(#CONTENT#)中可以包含换行符。

【任务2：话题分享】
在备忘录内容生成完毕后，请从刚刚生成的备忘录中挑选1个最可能引发交流的，预测一下，在未来的某个时间，${senderName}会根据这个备忘录的内容，发送消息给${char.myName}开启话题。
`;

        systemPrompt += getPeekProactiveFormatPrompt(char);

        systemPrompt += `
请严格按照以下标签文本格式输出，**备忘录之间使用 ===SEP=== 分隔**。在所有备忘录结束后，使用 ===PROACTIVE_MESSAGES=== 分割，再输出主动消息。

输出格式示例：
#ID#
memo_1
#TITLE#
备忘录1标题
#CONTENT#
备忘录内容，可以包含换行符
===SEP===
#ID#
memo_2
#TITLE#
备忘录2标题
#CONTENT#
备忘录内容...
可以包含多行...
===PROACTIVE_MESSAGES===
#SECRET_CHAT_AFTERNOON_85%#[15:15|${senderName}的消息:你这周末有空吗？][15:16|${senderName}的消息:我打算去趟超市买点东西，要不要一起？]
`;

        const requestBody = { model: model, messages:[{ role: 'user', content: systemPrompt }], temperature: 0.85 };
        const response = await fetch(`${url}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) throw new Error(`API error: ${response.status}`);
        const result = await response.json();
        const contentStr = result.choices[0].message.content.trim();

        const parts = contentStr.split(/===PROACTIVE_MESSAGES===/i);
        const memosRawText = parts[0] || '';
        const hitchhikerRawText = parts.length > 1 ? parts[1] : '';

        // 解析文本格式标签
        const rawItems = memosRawText.split('===SEP===');
        const parsedMemos =[];

        rawItems.forEach((rawText, index) => {
            if (!rawText.trim()) return;
            const idMatch = rawText.match(/#ID#\s*([\s\S]*?)(?=#TITLE#|$)/);
            const titleMatch = rawText.match(/#TITLE#\s*([\s\S]*?)(?=#CONTENT#|$)/);
            const contentMatch = rawText.match(/#CONTENT#\s*([\s\S]*?)(?=(?:===SEP===|$))/);

           if (titleMatch && contentMatch) {
                parsedMemos.push({
                    id: `memo_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                    title: titleMatch[1].trim(),
                    content: contentMatch[1].trim(),
                    isNew: true
                });
            }
        });

        if (parsedMemos.length > 0) {
            if (!peekContentCache['memos']) {
                peekContentCache['memos'] = { memos:[] };
            }
            
            // 2. 增量拼接：将新生成的内容插入到最前面 (unshift的效果)
            peekContentCache['memos'].memos = [...parsedMemos, ...peekContentCache['memos'].memos];
            
            // 3. 独立保存并渲染
            savePeekData(char.id).catch(e => console.error("Peek自动保存失败:", e));
            // 【重要修复】：把整个合并后的数组传给渲染器，而不是单单传新生成的几个！
            renderMemosList(peekContentCache['memos'].memos);
        } else {
            throw new Error("解析备忘录内容失败，未找到对应标签。");
        }

        // 提取并保存顺风车消息
        if (hitchhikerRawText.trim()) {
            parseAndSavePeekProactiveHitchhiker(char, hitchhikerRawText);
            saveSingleChat(char.id, 'private').catch(e => console.error(e));
        }

    } catch (error) {
        console.error(error);
        showApiError(error);
        if (peekContentCache['memos'] && peekContentCache['memos'].memos && peekContentCache['memos'].memos.length > 0) {
            renderMemosList(peekContentCache['memos'].memos);
            if (typeof showToast === 'function') showToast('刷新失败: ' + error.message);
        } else {
            const screen = document.getElementById('peek-memos-list');
            if (screen) {
                screen.innerHTML = `<li class="memo-item"><p class="placeholder-text" style="color:#ff4d4f; text-align:center;">内容生成失败，请重试。<br><span style="font-size:12px;">${error.message}</span></p></li>`;
            }
        }
    } finally {
        generatingPeekApps.delete(appType);
        hideLoading(); // 关闭加载动画
    }
}

// ==========================================
// 独立应用生成函数：中转站 (Transfer) + 顺风车提取
// ==========================================
async function generateAndRenderPeekTransfer(options = {}) {
    const appType = 'transfer';
    const { forceRefresh = false } = options;

    if (generatingPeekApps.has(appType)) {
        showToast('中转站内容正在生成中，请稍候...');
        return;
    }

    if (!forceRefresh && peekContentCache[appType]) {
        renderPeekTransferStation(peekContentCache[appType].entries);
        switchScreen('peek-transfer-station-screen');
        return;
    }

    const char = db.characters.find(c => c.id === window.activePeekCharId);
    if (!char) return showToast('无法找到当前角色');

    const { url, key, model } = db.apiSettings;
    if (!url || !key || !model) {
        showToast('请先配置 API！');
        return switchScreen('api-settings-screen');
    }

    generatingPeekApps.add(appType);
    switchScreen('peek-transfer-station-screen');

    
    // 调用全局加载框
    const hideLoading = showLoadingToast('正在生成中转站消息...');

    try {
        const peekSettings = char.peekScreenSettings || {};
        const limitCount = (peekSettings.contextLimit !== undefined) ? peekSettings.contextLimit : 50;
        const mainChatContext = limitCount > 0 ? char.history.slice(-limitCount).map(m => m.content).join('\n') : "";
        
        const senderName = char.realName || char.name;
        const baseContextPrompt = getPeekBasePromptContext(char, mainChatContext);
        
        let systemPrompt = `你正在模拟角色 ${char.realName} 的文件传输助手（即发送给自己的消息记录）。\n`;
        systemPrompt += baseContextPrompt;
        
        systemPrompt += `
【任务1：中转站记录】
请为 ${char.realName} 生成4-7条Ta发送给自己的、简短零碎的消息。
这些内容应该像是Ta的临时备忘、灵感闪现或随手保存的链接，要与Ta的人设和聊天上下文相关，但比“备忘录”应用的内容更随意、更口语化。

【任务2：话题分享】
在中转站记录生成完毕后，请从刚刚生成的内容中挑选1个灵感/链接/备忘，预测一下，在未来的某个时间，${senderName}会围绕这个灵感/链接，发送消息给${char.myName}开启话题或分享日常。


`;

        systemPrompt += getPeekProactiveFormatPrompt(char);

        systemPrompt += `
请严格按照以下标签文本格式输出，**每条中转站消息之间使用 ===SEP=== 分隔**。在所有消息结束后，使用 ===PROACTIVE_MESSAGES=== 分割，再输出主动消息。

输出格式示例：
#ENTRY#
要记得买牛奶。
===SEP===
#ENTRY#
https://example.com/interesting-article
===SEP===
#ENTRY#
刚刚那个想法不错，可以深入一下...
===PROACTIVE_MESSAGES===
#SECRET_CHAT_NOON_85%#[12:15|${senderName}的消息:我前阵子看到一篇关于心理学的文章，挺有意思的][12:16|${senderName}的消息:https://example.com/interesting-article]
`;

        const requestBody = { model: model, messages:[{ role: 'user', content: systemPrompt }], temperature: 0.85 };
        const response = await fetch(`${url}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) throw new Error(`API error: ${response.status}`);
        const result = await response.json();
        const contentStr = result.choices[0].message.content.trim();

        const parts = contentStr.split(/===PROACTIVE_MESSAGES===/i);
        const transferRawText = parts[0] || '';
        const hitchhikerRawText = parts.length > 1 ? parts[1] : '';

        // 解析文本格式标签
        const rawItems = transferRawText.split('===SEP===');
        const parsedEntries =[];

        rawItems.forEach((rawText) => {
            if (!rawText.trim()) return;
            const entryMatch = rawText.match(/#ENTRY#\s*([\s\S]*)$/i);
            
if (entryMatch && entryMatch[1].trim()) {
                parsedEntries.push({
                    id: `transfer_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`, // 加上唯一ID
                    content: entryMatch[1].trim(), // 把原来的纯文本装进content里
                    isNew: true
                });
            }
        });

        if (parsedEntries.length > 0) {
            if (!peekContentCache['transfer']) peekContentCache['transfer'] = { entries:[] };
            
            peekContentCache['transfer'].entries = [...parsedEntries, ...peekContentCache['transfer'].entries];
            
            savePeekData(char.id).catch(e => console.error("Peek自动保存失败:", e));
            renderPeekTransferStation(peekContentCache['transfer'].entries);
        } else {
            throw new Error("解析中转站内容失败，未找到对应标签。");
        }

        // 提取并保存顺风车消息
        if (hitchhikerRawText.trim()) {
            parseAndSavePeekProactiveHitchhiker(char, hitchhikerRawText);
            saveSingleChat(char.id, 'private').catch(e => console.error(e));
        }

    } catch (error) {
        console.error(error);
        showApiError(error);
        if (peekContentCache['transfer'] && peekContentCache['transfer'].entries && peekContentCache['transfer'].entries.length > 0) {
            renderPeekTransferStation(peekContentCache['transfer'].entries);
            if (typeof showToast === 'function') showToast('刷新失败: ' + error.message);
        } else {
            const screen = document.getElementById('peek-transfer-station-screen');
            if (screen) {
                const messageArea = screen.querySelector('.message-area');
                if (messageArea) {
                    messageArea.innerHTML = `<p class="placeholder-text" style="color:#ff4d4f; text-align:center;">内容生成失败，请重试。<br><span style="font-size:12px;">${error.message}</span></p>`;
                }
            }
        }
    } finally {
        generatingPeekApps.delete(appType);
        hideLoading(); // 关闭加载动画
    }
}

// ==========================================
// 独立应用生成函数：消息 (Messages) + 顺风车提取
// ==========================================
async function generateAndRenderPeekMessages(options = {}) {
    const appType = 'messages';
    const { forceRefresh = false } = options;

    if (generatingPeekApps.has(appType)) {
        showToast('消息内容正在生成中，请稍候...');
        return;
    }

    if (!forceRefresh && peekContentCache[appType]) {
        renderPeekChatList(peekContentCache[appType].conversations);
        switchScreen('peek-messages-screen');
        return;
    }

    const char = db.characters.find(c => c.id === window.activePeekCharId);
    if (!char) return showToast('无法找到当前角色');

    const { url, key, model } = db.apiSettings;
    if (!url || !key || !model) {
        showToast('请先配置 API！');
        return switchScreen('api-settings-screen');
    }

    generatingPeekApps.add(appType);
    switchScreen('peek-messages-screen');
    const targetContainer = document.getElementById('peek-chat-list-container');
    
    // 调用全局加载框
    const hideLoading = showLoadingToast('正在生成对话列表...');

    try {
        const peekSettings = char.peekScreenSettings || {};
        const limitCount = (peekSettings.contextLimit !== undefined) ? peekSettings.contextLimit : 50;
        const mainChatContext = limitCount > 0 ? char.history.slice(-limitCount).map(m => m.content).join('\n') : "";
        
        const senderName = char.realName || char.name;
        const baseContextPrompt = getPeekBasePromptContext(char, mainChatContext);
        
        let systemPrompt = `你正在模拟角色 ${char.realName} 的手机聊天/消息应用。\n`;
        systemPrompt += baseContextPrompt;
        
        systemPrompt += `
【任务1：消息记录】
请为 ${char.realName} 编造3-5个最近的对话。对话内容需要强烈反映Ta的人设以及和聊天上下文。
每段对话需要提供对话对象的称呼(#PARTNER#)以及具体的聊天记录(#HISTORY#)。
在 #HISTORY# 中，请严格使用以下格式记录每条消息：
如果是 ${char.realName} 发送的，以 "char: " 开头；
如果是对方发送的，以 "partner: " 开头。

【任务2：话题分享】
在消息记录生成完毕后，请从刚刚生成的这几段对话中挑选1个值得吐槽或分享的对话，预测一下，在未来的某个时间，${senderName}会主动把这个对话内容当成话题发消息分享给${char.myName}。
`;

        systemPrompt += getPeekProactiveFormatPrompt(char);

        systemPrompt += `
请严格按照以下标签文本格式输出，**每段对话之间使用 ===SEP=== 分隔**。在所有对话结束后，使用 ===PROACTIVE_MESSAGES=== 分割，再输出主动消息。

输出格式示例：
#PARTNER#
与Ta对话的人的称呼
#HISTORY#
partner: 对方发送的消息内容
char: {char.realName}发送的消息内容
partner: 对方发送的消息内容
===SEP===
#PARTNER#
与Ta对话的人的称呼
#HISTORY#
partner: 对方发送的消息内容
char: {char.realName}发送的消息内容
===PROACTIVE_MESSAGES===
#SECRET_CHAT_EVENING_85%#[19:15|${senderName}的消息:突然好想吃我妈做的排骨啊(T_T)][19:16|${senderName}的消息:你吃晚饭了吗？]
`;

        const requestBody = { model: model, messages:[{ role: 'user', content: systemPrompt }], temperature: 0.85 };
        const response = await fetch(`${url}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) throw new Error(`API error: ${response.status}`);
        const result = await response.json();
        const contentStr = result.choices[0].message.content.trim();

        const parts = contentStr.split(/===PROACTIVE_MESSAGES===/i);
        const messagesRawText = parts[0] || '';
        const hitchhikerRawText = parts.length > 1 ? parts[1] : '';

        // 解析文本格式标签
        const rawItems = messagesRawText.split('===SEP===');
        const parsedConversations =[];

        rawItems.forEach(rawText => {
            if (!rawText.trim()) return;
            const partnerMatch = rawText.match(/#PARTNER#\s*([\s\S]*?)(?=#HISTORY#|$)/);
            const historyMatch = rawText.match(/#HISTORY#\s*([\s\S]*?)(?=(?:===SEP===|$))/);

            if (partnerMatch && historyMatch) {
                const historyLines = historyMatch[1].trim().split('\n');
                const history =[];
                
                historyLines.forEach(line => {
                    if (line.trim().toLowerCase().startsWith('char:')) {
                        history.push({ sender: 'char', content: line.replace(/^char:\s*/i, '').trim() });
                    } else if (line.trim().toLowerCase().startsWith('partner:')) {
                        history.push({ sender: 'partner', content: line.replace(/^partner:\s*/i, '').trim() });
                    }
                });

if (history.length > 0) {
                    parsedConversations.push({
                        id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`, // 生成聊天ID
                        partnerName: partnerMatch[1].trim(),
                        history: history,
                        isNew: true
                    });
                }
            }
        });

        if (parsedConversations.length > 0) {
            if (!peekContentCache['messages']) peekContentCache['messages'] = { conversations:[] };
            
            // 增量拼接
            peekContentCache['messages'].conversations =[...parsedConversations, ...peekContentCache['messages'].conversations];
            
            savePeekData(char.id).catch(e => console.error("Peek自动保存失败:", e));
            renderPeekChatList(peekContentCache['messages'].conversations);
        } else {
            throw new Error("解析消息内容失败，未找到对应标签。");
        }

        // 提取并保存顺风车消息
        if (hitchhikerRawText.trim()) {
            parseAndSavePeekProactiveHitchhiker(char, hitchhikerRawText);
            saveSingleChat(char.id, 'private').catch(e => console.error(e));
        }

    } catch (error) {
        console.error(error);
        showApiError(error);
        if (peekContentCache['messages'] && peekContentCache['messages'].conversations && peekContentCache['messages'].conversations.length > 0) {
            renderPeekChatList(peekContentCache['messages'].conversations);
            if (typeof showToast === 'function') showToast('刷新失败: ' + error.message);
        } else {
            if (targetContainer) {
                targetContainer.innerHTML = `<li class="list-item chat-item"><p class="placeholder-text" style="color:#ff4d4f; text-align:center; width:100%;">内容生成失败，请重试。<br><span style="font-size:12px;">${error.message}</span></p></li>`;
            }
        }
    } finally {
        generatingPeekApps.delete(appType);
        hideLoading(); // 关闭加载动画
    }
}

// ==========================================
// 独立应用生成函数：购物车 (Cart) + 顺风车提取
// ==========================================
async function generateAndRenderPeekCart(options = {}) {
    const appType = 'cart';
    const { forceRefresh = false } = options;

    if (generatingPeekApps.has(appType)) {
        showToast('购物车内容正在生成中，请稍候...');
        return;
    }

    if (!forceRefresh && peekContentCache[appType]) {
        renderPeekCart(peekContentCache[appType].items);
        switchScreen('peek-cart-screen');
        return;
    }

    const char = db.characters.find(c => c.id === window.activePeekCharId);
    if (!char) return showToast('无法找到当前角色');

    const { url, key, model } = db.apiSettings;
    if (!url || !key || !model) {
        showToast('请先配置 API！');
        return switchScreen('api-settings-screen');
    }

    generatingPeekApps.add(appType);
    switchScreen('peek-cart-screen');    
    
    const hideLoading = showLoadingToast('正在读取购物车数据...');

    try {
        const peekSettings = char.peekScreenSettings || {};
        const limitCount = (peekSettings.contextLimit !== undefined) ? peekSettings.contextLimit : 50;
        const mainChatContext = limitCount > 0 ? char.history.slice(-limitCount).map(m => m.content).join('\n') : "";
        
        const senderName = char.realName || char.name;
        const baseContextPrompt = getPeekBasePromptContext(char, mainChatContext);
        
        let systemPrompt = `你正在模拟角色 ${char.realName} 的手机电商平台购物车。\n`;
        systemPrompt += baseContextPrompt;
        
        systemPrompt += `
【任务1：购物车记录】
请为 ${char.realName} 生成3-4件购物车内的商品。这些商品应该反映Ta近期的兴趣、生活需求或最近聊到的话题。你需要生成商品标题(#TITLE#)、商品规格(#SPEC#)和商品价格(#PRICE#)。

【任务2：话题分享】
在购物车内容生成完毕后，请从刚刚生成的商品中挑选1件Ta最纠结要不要买，或者最想展示的商品。
预测一下，在未来的某个时间，${senderName}会围绕这个商品，发送消息给${char.myName}开启话题。
`;

        systemPrompt += getPeekProactiveFormatPrompt(char);

        systemPrompt += `
请严格按照以下标签文本格式输出，**每件商品之间使用 ===SEP=== 分隔**。在所有商品结束后，使用 ===PROACTIVE_MESSAGES=== 分割，再输出主动消息。

输出格式示例：
#TITLE#
某品牌无线降噪耳机
#SPEC#
星空黑 / 官方标配
#PRICE#
1299.00
===SEP===
#TITLE#
猫咪零食冻干大礼包
#SPEC#
混合口味 500g
#PRICE#
89.90
===PROACTIVE_MESSAGES===
#SECRET_CHAT_EVENING_85%#[19:16|${senderName}发来的照片/视频:耳机的图片][19:15|${senderName}的消息:你觉得黑色的耳机好看还是白色的好看？][19:16|${senderName}的消息:我想换个新耳机，但在颜色上纠结了半天...]
`;

        const requestBody = { model: model, messages:[{ role: 'user', content: systemPrompt }], temperature: 0.85 };
        const response = await fetch(`${url}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) throw new Error(`API error: ${response.status}`);
        const result = await response.json();
        const contentStr = result.choices[0].message.content.trim();

        const parts = contentStr.split(/===PROACTIVE_MESSAGES===/i);
        const cartRawText = parts[0] || '';
        const hitchhikerRawText = parts.length > 1 ? parts[1] : '';

        const rawItems = cartRawText.split('===SEP===');
        const parsedItems =[];

        rawItems.forEach((rawText, index) => {
            if (!rawText.trim()) return;
            const titleMatch = rawText.match(/#TITLE#\s*([\s\S]*?)(?=#SPEC#|$)/);
            const specMatch = rawText.match(/#SPEC#\s*([\s\S]*?)(?=#PRICE#|$)/);
            const priceMatch = rawText.match(/#PRICE#\s*([\s\S]*?)(?=(?:===SEP===|$))/);

            if (titleMatch && specMatch && priceMatch) {
let cleanPrice = priceMatch[1].replace(/[^\d.]/g, '').trim();
                parsedItems.push({
                    id: `cart_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`, // 改为绝不重复的随机ID
                    title: titleMatch[1].trim(),
                    spec: specMatch[1].trim(),
                    price: cleanPrice || "0.00",
                    isNew: true
                });
            }
        });

        if (parsedItems.length > 0) {
            if (!peekContentCache['cart']) peekContentCache['cart'] = { items:[] };
            
            // 增量拼接
            peekContentCache['cart'].items =[...parsedItems, ...peekContentCache['cart'].items];
            
            savePeekData(char.id).catch(e => console.error("Peek自动保存失败:", e));
            renderPeekCart(peekContentCache['cart'].items);
        } else {
            throw new Error("解析购物车内容失败，未找到对应标签。");
        }

        if (hitchhikerRawText.trim()) {
            parseAndSavePeekProactiveHitchhiker(char, hitchhikerRawText);
            saveSingleChat(char.id, 'private').catch(e => console.error(e));
        }

    } catch (error) {
        console.error(error);
        showApiError(error);
        if (peekContentCache['cart'] && peekContentCache['cart'].items && peekContentCache['cart'].items.length > 0) {
            renderPeekCart(peekContentCache['cart'].items);
            if (typeof showToast === 'function') showToast('刷新失败: ' + error.message);
        } else {
            const screen = document.getElementById('peek-cart-screen');
            if (screen) {
                const listEl = screen.querySelector('.cart-item-list');
                if(listEl) listEl.innerHTML = `<li style="padding:20px; text-align:center; color:#ff4d4f;">内容生成失败，请重试。<br><span style="font-size:12px;">${error.message}</span></li>`;
            }
        }
    } finally {
        generatingPeekApps.delete(appType);
        hideLoading(); 
    }
}

// ==========================================
// 独立应用生成函数：社交小号 (Unlock) + 顺风车提取
// ==========================================
async function generateAndRenderPeekUnlock(options = {}) {
    const appType = 'unlock';
    const { forceRefresh = false } = options;

    if (generatingPeekApps.has(appType)) {
        showToast('小号内容正在生成中，请稍候...');
        return;
    }

    if (!forceRefresh && peekContentCache[appType]) {
        renderPeekUnlock(peekContentCache[appType]);
        switchScreen('peek-unlock-screen');
        return;
    }

    const char = db.characters.find(c => c.id === window.activePeekCharId);
    if (!char) return showToast('无法找到当前角色');

    const { url, key, model } = db.apiSettings;
    if (!url || !key || !model) {
        showToast('请先配置 API！');
        return switchScreen('api-settings-screen');
    }

    generatingPeekApps.add(appType);
    switchScreen('peek-unlock-screen');    
    
    const hideLoading = showLoadingToast('正在生成神秘小号记录...');

    try {
        const peekSettings = char.peekScreenSettings || {};
        const limitCount = (peekSettings.contextLimit !== undefined) ? peekSettings.contextLimit : 50;
        const mainChatContext = limitCount > 0 ? char.history.slice(-limitCount).map(m => m.content).join('\n') : "";
        
        const senderName = char.realName || char.name;
        const baseContextPrompt = getPeekBasePromptContext(char, mainChatContext);
        
        let systemPrompt = `你正在模拟角色 ${char.realName} 的社交媒体（类似微博/X）私密小号。\n`;
        systemPrompt += baseContextPrompt;
        
        systemPrompt += `
【任务1：小号内容记录】
请为 ${char.realName} 生成一个符合其人设的私密小号。内容要生活化、碎片化，符合小号的风格，并与Ta的人设和聊天上下文高度相关。
你需要生成以下信息：
#NICKNAME#: 小号的昵称
#HANDLE#: @开头的ID
#BIO#: 个性签名
接下来，使用 #POST# 标签生成3-4条最近的帖子内容。每条 #POST# 的第一行用方括号包含生成时间（例如[2小时前]），下方是正文（140字以内）。

【任务2：话题分享】
小号内容往往是私密的，预测一下，在未来的某个时间，${senderName}也许会“不小心”或者以暗示的方式，把小号里表达的某一种情绪/状态，通过日常聊天的口吻发给${char.myName}寻求安慰或产生互动。
`;

        systemPrompt += getPeekProactiveFormatPrompt(char);

        systemPrompt += `
请严格按照以下标签文本格式输出。在所有内容结束后，使用 ===PROACTIVE_MESSAGES=== 分割，再输出主动消息。

输出格式示例：
#NICKNAME#
角色的小号昵称
#HANDLE#
@角色的小号ID
#BIO#
角色的个性签名，可以包含换行符
#POST#
[1小时前]
第一条正文内容
#POST#[昨天]
第二条正文内容
===PROACTIVE_MESSAGES===
#SECRET_CHAT_NIGHT_85%#[23:15|${senderName}的消息:你睡了吗？][23:16|${senderName}的消息:感觉有点丧，不知道该跟谁说...]
`;

        const requestBody = { model: model, messages:[{ role: 'user', content: systemPrompt }], temperature: 0.85 };
        const response = await fetch(`${url}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) throw new Error(`API error: ${response.status}`);
        const result = await response.json();
        const contentStr = result.choices[0].message.content.trim();

        const parts = contentStr.split(/===PROACTIVE_MESSAGES===/i);
        const unlockRawText = parts[0] || '';
        const hitchhikerRawText = parts.length > 1 ? parts[1] : '';

        // 解析头部信息
        const nickMatch = unlockRawText.match(/#NICKNAME#\s*([\s\S]*?)(?=#HANDLE#|$)/i);
        const handleMatch = unlockRawText.match(/#HANDLE#\s*([\s\S]*?)(?=#BIO#|$)/i);
        const bioMatch = unlockRawText.match(/#BIO#\s*([\s\S]*?)(?=#POST#|$)/i);

        // 解析帖子列表
        const postSplits = unlockRawText.split(/#POST#/i).slice(1); // 丢弃第一个#POST#之前的部分
        const parsedPosts =[];

postSplits.forEach(postStr => {
            const postMatch = postStr.match(/^\s*\[([^\]]+)\]\s*([\s\S]*)$/);
            if (postMatch) {
                parsedPosts.push({
                    id: `post_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`, // 给每条帖子发ID
                    timestamp: postMatch[1].trim(),
                    content: postMatch[2].trim(),
                    isNew: true
                });
            }
        });

        if (nickMatch && parsedPosts.length > 0) {
            // 初始化
            if (!peekContentCache['unlock']) {
                peekContentCache['unlock'] = { nickname: '', handle: '', bio: '', posts:[] };
            }
            
            // 每次生成时更新小号资料
            peekContentCache['unlock'].nickname = nickMatch[1].trim();
            peekContentCache['unlock'].handle = handleMatch ? handleMatch[1].trim() : '@unknown';
            peekContentCache['unlock'].bio = bioMatch ? bioMatch[1].trim() : '...';
            
            // 增量拼接帖子列表
            peekContentCache['unlock'].posts =[...parsedPosts, ...peekContentCache['unlock'].posts];

            savePeekData(char.id).catch(e => console.error("Peek自动保存失败:", e));
            renderPeekUnlock(peekContentCache['unlock']);
        } else {
            throw new Error("解析小号内容失败，未找到对应标签。");
        }

        // 提取并保存顺风车消息
        if (hitchhikerRawText.trim()) {
            parseAndSavePeekProactiveHitchhiker(char, hitchhikerRawText);
            saveSingleChat(char.id, 'private').catch(e => console.error(e));
        }

    } catch (error) {
        console.error(error);
        showApiError(error);
        if (peekContentCache['unlock'] && peekContentCache['unlock'].posts && peekContentCache['unlock'].posts.length > 0) {
            renderPeekUnlock(peekContentCache['unlock']);
            if (typeof showToast === 'function') showToast('刷新失败: ' + error.message);
        } else {
            const screen = document.getElementById('peek-unlock-screen');
            if (screen) {
                screen.innerHTML = `<header class="app-header"><button class="back-btn" data-target="peek-screen">‹</button><div class="title-container"><h1 class="title">错误</h1></div></header><main class="content"><p class="placeholder-text" style="color:#ff4d4f;">内容生成失败，请重试。<br><span style="font-size:12px;">${error.message}</span></p></main>`;
            }
        }
    } finally {
        generatingPeekApps.delete(appType);
        hideLoading(); 
    }
}
