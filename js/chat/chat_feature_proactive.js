// --- chat_feature_proactive.js ---

/**
 * 打开 主动消息设置弹窗 
 */
function openProactiveMessagingSettings() {
    const chat = getCurrentChatObject();
    if (!chat) return;

    const modal = document.getElementById('proactive-away-modal');
    const form = document.getElementById('proactive-away-form');
    const modeSelect = document.getElementById('pa-mode-select');
    const hintsBox = document.getElementById('pa-mode-hints'); 

    // 主动模式设定
    const fixedSettings = document.getElementById('pa-fixed-settings');
    const dailySlider = document.getElementById('pa-daily-limit-slider');
    const dailyVal = document.getElementById('pa-daily-limit-val');
    const freqSlider = document.getElementById('pa-frequency-slider');
    const freqVal = document.getElementById('pa-frequency-val');

    // 固定模式设定
    const timerSettings = document.getElementById('pa-timer-settings');
    const timerIntervalInput = document.getElementById('pa-timer-interval-input');
    const timerKeepaliveInput = document.getElementById('pa-timer-keepalive-input');

    // ── 新增：API 选择器 ──────────────────────────────────────
    const apiSettings = document.getElementById('pa-api-settings');
    const apiPresetSelect = document.getElementById('pa-api-preset-select');

    if (apiPresetSelect) {
        apiPresetSelect.innerHTML = '<option value="">和聊天一致</option>';
        const chatPresets = (db.apiPresets || []).filter(p => !p.type || p.type === 'chat');
        chatPresets.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.name;
            opt.textContent = p.name;
            apiPresetSelect.appendChild(opt);
        });
        apiPresetSelect.value = chat.proactiveApiPresetName || '';
    }
    // ─────────────────────────────────────────────────────────

    // 初始化读取数据库
    modeSelect.value = chat.proactiveMode || 'random';
    dailySlider.value = chat.proactiveDailyLimit || 10;
    dailyVal.textContent = dailySlider.value;
    freqSlider.value = chat.proactiveFrequency !== undefined ? chat.proactiveFrequency : 1;
    timerIntervalInput.value = chat.proactiveTimerInterval || 5;
    timerKeepaliveInput.value = chat.proactiveKeepAlive || 30;

    const updateFreqText = () => {
        const val = parseInt(freqSlider.value, 10);
        if (val === 0) freqVal.textContent = '佛系';
        else if (val === 1) freqVal.textContent = '普通';
        else if (val === 2) freqVal.textContent = '粘人';
    };
    updateFreqText();

    // 监听模式切换
    const updateHintsAndDisplay = () => {
        const mode = modeSelect.value;
        fixedSettings.style.display = mode === 'fixed' ? 'block' : 'none';
        timerSettings.style.display = mode === 'timer' ? 'block' : 'none';
        
        // ── 新增：API 选择器仅在 fixed / timer 时显示 ──
        if (apiSettings) {
            apiSettings.style.display = (mode === 'fixed' || mode === 'timer') ? 'block' : 'none';
        }
        
        switch(mode) {
            case 'random':
                hintsBox.innerHTML = '<b>* 随机模式：</b>根据其他功能使用情况概率掉落消息，不额外调用api。';
                break;
            case 'fixed':
                hintsBox.innerHTML = '<b>* 主动模式：</b>允许闲暇时主动调用api发送消息。可调整发送消息频率及每日上限。';
                break;
            case 'timer':
                hintsBox.innerHTML = '<b>* 固定模式：</b>定时推进剧情专用。当无操作达到设定分钟数后，系统会模拟获取回复。';
                break;
            case 'dnd':
                hintsBox.innerHTML = '<b>* 免打扰模式：</b>角色绝对不会在后台主动发起任何消息。';
                break;
        }
    };
    updateHintsAndDisplay(); 
    modeSelect.onchange = updateHintsAndDisplay;

    dailySlider.oninput = () => dailyVal.textContent = dailySlider.value;
    freqSlider.oninput = updateFreqText;

    modal.classList.add('visible');

    document.getElementById('pa-cancel-btn').onclick = () => {
        modal.classList.remove('visible');
    };

    form.onsubmit = async (e) => {
        e.preventDefault();
        modal.classList.remove('visible');
        await applyAwaySettings(
            chat, 
            modeSelect.value, 
            parseInt(dailySlider.value, 10), 
            parseInt(freqSlider.value, 10),
            parseInt(timerIntervalInput.value, 10),
            parseInt(timerKeepaliveInput.value, 10),
            apiPresetSelect ? (apiPresetSelect.value || null) : null
        );
    };
}

/**
 * 应用模式并存库，保存全新的 Timer 字段
 */
// 增加第7个参数 apiPresetName
async function applyAwaySettings(chat, mode, dailyLimit, frequency, timerInterval, timerKeepalive, apiPresetName = null) {
    const oldMode = chat.proactiveMode;
    chat.proactiveMode = mode;
    
    if (mode === 'fixed') {
        chat.proactiveDailyLimit = dailyLimit;
        chat.proactiveFrequency = frequency;
    } else if (mode === 'timer') {
        chat.proactiveTimerInterval = timerInterval;
        chat.proactiveKeepAlive = timerKeepalive;
        if (oldMode !== 'timer') {
            chat.timerModeEnabledAt = Date.now();
            chat.lastTimerTrigger = Date.now();
        }
    }

    // ── 新增：保存主动消息 API 预设 ──
    if (mode === 'fixed' || mode === 'timer') {
        chat.proactiveApiPresetName = apiPresetName;
    }
    // ─────────────────────────────────

    await saveSingleChat(chat.id, currentChatType);
    
    const awayBtns = document.querySelectorAll('.expansion-item[data-action*="proactive"], .expansion-item[onclick*="openProactiveMessagingSettings"]');
    awayBtns.forEach(btn => {
        if (mode === 'fixed' || mode === 'timer') btn.classList.add('active');
        else btn.classList.remove('active');
    });
}

/**
 * 往角色的主动消息队列中塞入一条预生成消息 (供外部“顺风车”功能调用)
 */
function pushProactiveMessage(chatId, type, content, expireHours = 24) {
    const chat = (db.characters ||[]).find(c => c.id === chatId) || (db.groups ||[]).find(g => g.id === chatId);
    if (!chat) return;
    
    if (!chat.proactiveMessageQueue) chat.proactiveMessageQueue =[];
    chat.proactiveMessageQueue = chat.proactiveMessageQueue.filter(m => m.type !== type);
    
    if (type === 'time_window_summary') {
        chat.proactiveMessageQueue = chat.proactiveMessageQueue.filter(m => m.type !== 'time_window_idle');
    }
    
    chat.proactiveMessageQueue.push({
        id: `promsg_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        type: type,
        content: content, 
        generatedAt: Date.now(),
        expireAt: Date.now() + (expireHours * 60 * 60 * 1000) 
    });
    
    console.log(`[赠品] ${chat.realName || chat.name} 更换了有概率的赠品内容，原赠品已销毁。`);
}

// ==========================================
// 核心魔法：时间线顺序骰子 + 概率回退 + 多条连发机制
// ==========================================
async function checkAndDeliverProactiveMessages() {
    let hasDelivered = false;
    let charModified = [];
    let groupModified =[];
    
    const now = new Date();
    const tNow = now.getTime();

    const defaultProbabilities = {
        night: 5, morning: 70, noon: 90, afternoon: 60, evening: 90     
    };

    function getRecentSlotInterval(slotId, anchorTime) {
        let startHour, duration;
        switch(slotId.toLowerCase().split('_')[0]) {
            case 'night': startHour = 22; duration = 8; break;
            case 'morning': startHour = 6; duration = 4; break;
            case 'noon': startHour = 10; duration = 4; break;
            case 'afternoon': startHour = 14; duration = 4; break;
            case 'evening': startHour = 18; duration = 4; break;
            default: startHour = 10; duration = 4; break; 
        }
        
        let anchor = new Date(anchorTime);
        let start = new Date(anchor);
        start.setHours(startHour, 0, 0, 0);
        
        let diff = start.getTime() - anchorTime;
        if (diff > 12 * 3600 * 1000) {
            start.setDate(start.getDate() - 1);
        } else if (diff < -12 * 3600 * 1000) {
            start.setDate(start.getDate() + 1);
        }

        let end = new Date(start.getTime());
        end.setHours(end.getHours() + duration);
        return { start: start.getTime(), end: end.getTime() };
    }

    const checkQueue =[
        ...(db.characters || []).map(c => ({ chat: c, type: 'private' })),
        ...(db.groups ||[]).map(g => ({ chat: g, type: 'group' }))
    ];

    for (const { chat, type } of checkQueue) {
        // 【修复 3】：严格拦截免打扰和 Timer 固定模式，防止它偷吃 Peek 池子的盲盒消息
        if (chat.proactiveMode === 'dnd' || chat.proactiveMode === 'timer' || !chat.proactiveMessageQueue || chat.proactiveMessageQueue.length === 0) continue;

        let initialLen = chat.proactiveMessageQueue.length;
        chat.proactiveMessageQueue = chat.proactiveMessageQueue.filter(m => m.type === 'time_window_peek' || m.expireAt > tNow);
        if (chat.proactiveMessageQueue.length !== initialLen) {
            if (type === 'private') { if (!charModified.includes(chat)) charModified.push(chat); } 
            else { if (!groupModified.includes(chat)) groupModified.push(chat); }
        }

        let isPeekSource = false;
        let msgIndex = chat.proactiveMessageQueue.findIndex(m => m.type === 'time_window_summary');
        if (msgIndex === -1) {
            msgIndex = chat.proactiveMessageQueue.findIndex(m => m.type === 'time_window_idle');
        }
        if (msgIndex === -1) {
            const isOfflineMode = (type === 'private' && chat.offlineModeEnabled);
            if (!isOfflineMode) {
                msgIndex = chat.proactiveMessageQueue.findIndex(m => m.type === 'time_window_peek');
                if (msgIndex !== -1) isPeekSource = true;
            }
        }

        if (msgIndex === -1) continue;

        const draft = chat.proactiveMessageQueue[msgIndex];

        let lastInteractTime = 0;
        let lastRealMsgIndex = -1;
        if (chat.history.length > 0) {
            for (let i = chat.history.length - 1; i >= 0; i--) {
                const m = chat.history[i];
                if (!m.id?.includes('msg_proactive_') && !m.id?.includes('msg_visual_')) {
                    lastRealMsgIndex = i;
                    lastInteractTime = m.timestamp || 0;
                    break;
                }
            }
        }

        // 【修复 1】summary / idle 队列：用户在生成后说过话，整条作废，立即清除
        // Peek 来源不受此规则约束（Peek 池子是长期备用的）
        if (!isPeekSource &&
            (draft.type === 'time_window_summary' || draft.type === 'time_window_idle') &&
            lastInteractTime > draft.generatedAt) {
            console.log(`[顺风车] ${chat.realName || chat.name} 的 ${draft.type} 队列因用户发言而作废，已清除。`);
            chat.proactiveMessageQueue.splice(msgIndex, 1);
            if (type === 'private') { if (!charModified.includes(chat)) charModified.push(chat); }
            else { if (!groupModified.includes(chat)) groupModified.push(chat); }
            if (typeof saveSingleChat === 'function') await saveSingleChat(chat.id, type);
            continue;
        }
        
        let hasSentProactiveSinceLastReal = false;
        if (chat.history.length > 0) {
            let checkStartIndex = lastRealMsgIndex === -1 ? 0 : lastRealMsgIndex + 1;
            for (let i = checkStartIndex; i < chat.history.length; i++) {
                if (chat.history[i].id?.includes('msg_proactive_')) {
                    hasSentProactiveSinceLastReal = true;
                    break;
                }
            }
        }

        const minTimeGap = isPeekSource ? 60 * 60 * 1000 : 5 * 60 * 1000;
        if (tNow - lastInteractTime < minTimeGap) continue; 
        
        if (hasSentProactiveSinceLastReal) continue;

        let candidates =[];

        for (const slotId of Object.keys(draft.content)) {
            const slotData = draft.content[slotId];
            if (!slotData.messages || slotData.messages.length === 0) continue; 
            
            let firstMsgTimeStr = slotData.messages[0].time;
            let groupTargetTime;
            let baseStart, baseEnd;

            if (isPeekSource) {
                let tGen = slotData.generatedAt || draft.generatedAt;
                
                let tempDate = new Date(tNow);
                if (firstMsgTimeStr) {
                    const [hours, minutes] = firstMsgTimeStr.split(':').map(Number);
                    tempDate.setHours(hours, minutes, 0, 0);
                    
                    if (tempDate.getTime() > tNow) tempDate.setDate(tempDate.getDate() - 1);
                    groupTargetTime = tempDate.getTime();
                    baseStart = groupTargetTime - 2 * 3600 * 1000;
                    baseEnd = groupTargetTime + 2 * 3600 * 1000;
                } else {
                    const bounds = getRecentSlotInterval(slotId, tNow);
                    baseStart = bounds.start; baseEnd = bounds.end;
                    groupTargetTime = baseStart + Math.random() * (baseEnd - baseStart);
                    if (groupTargetTime > tNow) {
                        groupTargetTime -= 24 * 3600 * 1000;
                        baseStart -= 24 * 3600 * 1000;
                        baseEnd -= 24 * 3600 * 1000;
                    }
                }

                if (groupTargetTime < tGen) continue; 
                if (groupTargetTime < lastInteractTime + 60 * 60 * 1000) continue; 

                let prob = slotData.probability;
                if (prob === null || isNaN(prob)) prob = defaultProbabilities[slotId.toLowerCase().split('_')[0]] || 90;

                candidates.push({ slotId, messages: slotData.messages, probability: prob, groupTargetTime, baseStart, baseEnd });

            } else {
                const baseAnchorTime = slotData.generatedAt || draft.generatedAt;
                const bounds = getRecentSlotInterval(slotId, baseAnchorTime);
                baseStart = bounds.start; baseEnd = bounds.end;
                
                groupTargetTime = baseStart; 
                
                if (firstMsgTimeStr) {
                    const [hours, minutes] = firstMsgTimeStr.split(':').map(Number);
                    let tempDate = new Date(baseStart); 
                    tempDate.setHours(hours, minutes, 0, 0);
                    groupTargetTime = tempDate.getTime();
                    
                    if (groupTargetTime < baseStart - 12 * 3600 * 1000) groupTargetTime += 24 * 3600 * 1000;
                    else if (groupTargetTime > baseEnd + 12 * 3600 * 1000) groupTargetTime -= 24 * 3600 * 1000;
                } else {
                    groupTargetTime = baseStart + Math.random() * (baseEnd - baseStart);
                }

                const effectiveTLast = Math.max(lastInteractTime, baseAnchorTime);

                if (groupTargetTime <= effectiveTLast + 60000) {
                    delete draft.content[slotId]; 
                    continue;
                }
                
                if (groupTargetTime > tNow) continue; 

                let prob = slotData.probability;
                if (prob === null || isNaN(prob)) prob = defaultProbabilities[slotId.toLowerCase().split('_')[0]];

                candidates.push({ slotId, messages: slotData.messages, probability: prob, groupTargetTime, baseStart, baseEnd });
            }
        }

        if (candidates.length === 0) {
            if (Object.keys(draft.content).length === 0) {
                chat.proactiveMessageQueue.splice(msgIndex, 1);
                if (type === 'private') { if (!charModified.includes(chat)) charModified.push(chat); } 
                else { if (!groupModified.includes(chat)) groupModified.push(chat); }
            }
            continue;
        }

        if (isPeekSource) {
            candidates.sort((a, b) => b.groupTargetTime - a.groupTargetTime);
            candidates =[candidates[0]];
        } else {
            candidates.sort((a, b) => a.groupTargetTime - b.groupTargetTime);
        }

        let currentFakeTimestamp = lastInteractTime; 
        let deliveredCount = 0;

        for (const candidate of candidates) {
            const roll = Math.random() * 100;
            console.log(`[抽奖详情] 对象: ${chat.realName || chat.name}, 来源: ${isPeekSource ? 'Peek备用池' : '标准池'}, 组: ${candidate.slotId}, 概率: ${candidate.probability}%, 骰子: ${roll.toFixed(1)}`);
            
            // 【修复 2】先删除当前候选，无论成功与否
            delete draft.content[candidate.slotId];

            if (roll <= candidate.probability) {
                let msgsToPut =[]; 
                console.log(`[抽奖成功] 组: ${candidate.slotId} 连发 ${candidate.messages.length} 条。`);
                
                for (let i = 0; i < candidate.messages.length; i++) {
                    const msgInfo = candidate.messages[i];
                    let msgFakeTimestamp = candidate.groupTargetTime;
                    
                    if (msgInfo.time) {
                        const [hours, minutes] = msgInfo.time.split(':').map(Number);
                        let tempDate = new Date(candidate.baseStart);
                        tempDate.setHours(hours, minutes, 0, 0);
                        msgFakeTimestamp = tempDate.getTime();
                        
                        if (msgFakeTimestamp < candidate.baseStart - 12 * 3600 * 1000) msgFakeTimestamp += 24 * 3600 * 1000;
                        else if (msgFakeTimestamp > candidate.baseEnd + 12 * 3600 * 1000) msgFakeTimestamp -= 24 * 3600 * 1000;
                    }

                    if (msgFakeTimestamp <= currentFakeTimestamp) msgFakeTimestamp = currentFakeTimestamp + 60 * 1000;
                    if (msgFakeTimestamp > tNow) msgFakeTimestamp = tNow - 1000; 
                    
                    let timeGap = msgFakeTimestamp - currentFakeTimestamp;
                    currentFakeTimestamp = msgFakeTimestamp;
                    
                    if (i === 0 && timeGap > 30 * 60 * 1000) {
                        const visualMessage = {
                            id: `msg_visual_timesense_${Date.now()}_${deliveredCount}_${i}`,
                            role: 'system',
                            content: `[time-divider]`,
                            parts:[{ type: 'text', text: '[time-divider]' }],
                            timestamp: msgFakeTimestamp - 1
                        };
                        chat.history.push(visualMessage);
                        msgsToPut.push(visualMessage);
                        if (typeof currentChatId !== 'undefined' && currentChatId === chat.id && typeof addMessageBubble === 'function') {
                            addMessageBubble(visualMessage, chat.id, type);
                        }
                    }

                    let actionStr = msgInfo.action || '的消息';
                    if (['的照片', '发来的照片', '的照片/视频'].includes(actionStr)) {
                        actionStr = '发来的照片/视频';
                    } else if (actionStr === '发来的语音') {
                        actionStr = '的语音';
                    } else if (actionStr === '发来的转账') {
                        actionStr = '的转账';
                    } else if (actionStr === '的礼物') {
                        actionStr = '送来的礼物';
                    }

                    let finalContent = `[${msgInfo.sender}${actionStr}：${msgInfo.text}]`;

                    if (type === 'private' && chat.offlineModeEnabled) {
                        if (actionStr === '的动作') finalContent = `[system-narration:${msgInfo.text}]`; 
                        else if (actionStr === '的语言') finalContent = `[${msgInfo.sender}的消息：${msgInfo.text}]`; 
                        else if (actionStr === '更新状态为') finalContent = `[${msgInfo.sender}更新状态为：${msgInfo.text}]`;
                    }

                    const newMsg = {
                        id: `msg_proactive_${Date.now()}_${deliveredCount}_${i}`,
                        role: 'assistant',
                        content: finalContent,
                        parts:[{ type: 'text', text: finalContent }],
                        timestamp: msgFakeTimestamp
                    };

                    if (actionStr === '撤回了一条消息' || actionStr === '撤回了上一条消息') {
                        newMsg.isWithdrawn = true;
                        newMsg.originalContent = msgInfo.text;
                    }

                    if (type === 'group' && chat.members && chat.members.length > 0) {
                        const sName = msgInfo.sender.trim();
                        const matchedMember = chat.members.find(m => m.realName === sName || m.groupNickname === sName);
                        if (matchedMember) newMsg.senderId = matchedMember.id;
                        else newMsg.senderId = chat.members[0].id;
                    }

                    chat.history.push(newMsg);
                    msgsToPut.push(newMsg);
                    
                    if (typeof currentChatId !== 'undefined' && currentChatId === chat.id && typeof addMessageBubble === 'function') {
                        addMessageBubble(newMsg, chat.id, type);
                    }
                }
                await saveMessagesToDB(msgsToPut, chat.id, type);
                if (typeof currentChatId === 'undefined' || currentChatId !== chat.id) {
                    chat.unreadCount = (chat.unreadCount || 0) + candidate.messages.length;
                }
                deliveredCount++;

                // 【修复 2 续】发成功后销毁其余所有候选，只发一组
                for (const rest of candidates) {
                    delete draft.content[rest.slotId];
                }
                break;

            } else {
                console.log(`[抽奖失败] 组: ${candidate.slotId} 放弃发送。`);
            }
        }

        if (isPeekSource) {
            if (deliveredCount > 0 || Object.keys(draft.content).length === 0) chat.proactiveMessageQueue.splice(msgIndex, 1);
        } else {
            if (Object.keys(draft.content).length === 0) chat.proactiveMessageQueue.splice(msgIndex, 1);
        }

        if (deliveredCount > 0 || candidates.length > 0) {
            hasDelivered = (deliveredCount > 0) || hasDelivered;
            // 【修复】立即保存，缩短崩溃窗口，防止重启后队列未清导致重复投递
            if (typeof saveSingleChat === 'function') await saveSingleChat(chat.id, type);
        }
    }

    if (hasDelivered && typeof renderChatList === 'function') { renderChatList(); }
}

// ==========================================
// 全局闲置计时器与后台静默推演
// ==========================================
let bgAudioElement = null;
let bgTimeoutId = null;
const silentWavBase64 = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";

function unlockAudioElement() {
    const needsAudio = typeof db !== 'undefined' && 
        [...(db.characters || []), ...(db.groups || [])].some(
            chat => chat.proactiveMode === 'fixed' || chat.proactiveMode === 'timer'
        );
    
    if (!needsAudio) {
        window.removeEventListener('touchstart', unlockAudioElement, { passive: true });
        window.removeEventListener('click', unlockAudioElement, { passive: true });
        return;
    }

    if (!bgAudioElement) {
        bgAudioElement = new Audio(silentWavBase64);
        bgAudioElement.loop = true; 
        bgAudioElement.volume = 1;  
        bgAudioElement.setAttribute('playsinline', '');
        bgAudioElement.setAttribute('webkit-playsinline', '');
    }
    
    bgAudioElement.play().then(() => {
        bgAudioElement.pause();
    }).catch(err => {
        console.log("精灵唱歌被拦截，等待下一次敲击...");
    });

    window.removeEventListener('touchstart', unlockAudioElement, { passive: true });
    window.removeEventListener('click', unlockAudioElement, { passive: true });
}

function startBackgroundAudioTimer() {
    stopBackgroundAudioTimer(); 
    
    let maxKeepAliveMs = 5 * 60 * 1000; 
    let needsGenerationOrTimer = false;

    if (typeof db !== 'undefined') {
        const todayStr = new Date().toDateString();
        const allChats = [...(db.characters || []), ...(db.groups ||[])];
        
        allChats.forEach(chat => {
            if (chat.proactiveMode === 'fixed') {
                const maxCalls = chat.proactiveDailyLimit || 10;
                const currentCount = (chat.dailyProactiveUsage && chat.dailyProactiveUsage.date === todayStr) ? chat.dailyProactiveUsage.count : 0;
                    
                if (currentCount < maxCalls) {
                    let lastInteractTime = 0;
                    if (chat.history && chat.history.length > 0) {
                        const lastRealMsg = chat.history.filter(m => !m.id?.includes('msg_proactive_') && !m.id?.includes('msg_visual_')).slice(-1)[0];
                        lastInteractTime = lastRealMsg?.timestamp || 0;
                    }
                    const hasValidDraft = chat.proactiveMessageQueue && chat.proactiveMessageQueue.some(m => {
                        if (m.expireAt <= Date.now()) return false; 
                        if (m.type === 'time_window_summary') return true; 
                        if (m.type === 'time_window_idle') return m.generatedAt >= lastInteractTime;
                        return false;
                    });
                    if (!hasValidDraft) needsGenerationOrTimer = true;
                }
            }
            
            if (chat.proactiveMode === 'timer') {
                needsGenerationOrTimer = true;
                const userKeepAliveMs = (chat.proactiveKeepAlive || 30) * 60 * 1000;
                if (userKeepAliveMs > maxKeepAliveMs) {
                    maxKeepAliveMs = userKeepAliveMs; 
                }
            }
        });
    }

    if (!needsGenerationOrTimer) {
        console.log('[精灵] 虽然user离开了，但奖池已满且无固定定时任务，精灵休息。');
        return; 
    }

    console.log(`[精灵] user离开了，精灵开始唱歌... (本次保活上限: ${Math.floor(maxKeepAliveMs/60000)} 分钟)`);

    if (!bgAudioElement) {
        bgAudioElement = new Audio(silentWavBase64);
        bgAudioElement.loop = true;
        bgAudioElement.volume = 1; 
        bgAudioElement.setAttribute('playsinline', '');
        bgAudioElement.setAttribute('webkit-playsinline', '');
    }

    bgAudioElement.play().catch(e => console.log("[精灵] 精灵发声失败:", e));

    bgTimeoutId = setTimeout(() => {
        console.log(`[精灵] 保活时间到期，精灵唱完了，唤醒一次主动补池...`);
        triggerIdleProactiveGeneration(); 
        stopBackgroundAudioTimer(); 
    }, maxKeepAliveMs);
}

function stopBackgroundAudioTimer() {
    if (bgTimeoutId) {
        clearTimeout(bgTimeoutId);
        bgTimeoutId = null;
    }
    if (bgAudioElement && !bgAudioElement.paused) {
        bgAudioElement.pause();
        bgAudioElement.currentTime = 0; 
    }
}

(function setupInactivityTracker() {
    setInterval(async () => {
        console.log(`[时计] 定时检查是否到达抽奖时间 或 固定触发时间...`);
        
        const now = Date.now();
        const lastRun = parseInt(localStorage.getItem('last_proactive_run') || '0', 10);
        if (now - lastRun < 50000) return;
        localStorage.setItem('last_proactive_run', now.toString());

        if (navigator.locks && navigator.locks.request) {
            await navigator.locks.request('proactive_delivery', { mode: 'exclusive', ifAvailable: true }, async lock => {
                if (!lock) return;
                await checkAndDeliverProactiveMessages(); 
                await checkAndDeliverTimerMessages();     
            });
        } else {
            await checkAndDeliverProactiveMessages();
            await checkAndDeliverTimerMessages();
        }
    }, 60000);

    window.addEventListener('touchstart', unlockAudioElement, { passive: true });
    window.addEventListener('click', unlockAudioElement, { passive: true });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            startBackgroundAudioTimer();
        } else {
            console.log(`[精灵] user回来了，精灵噤声。`);
            stopBackgroundAudioTimer();
        }
    });
})();

// ==========================================
// 【新增功能】：检查并触发 Timer(固定模式) 专属请求
// ==========================================
async function checkAndDeliverTimerMessages() {
    const now = Date.now();
    const checkQueue = [
        ...(db.characters || []).map(c => ({ chat: c, type: 'private' })),
        ...(db.groups ||[]).map(g => ({ chat: g, type: 'group' }))
    ];

    for (const { chat, type } of checkQueue) {
        if (chat.proactiveMode === 'timer') {
            const intervalMs = (chat.proactiveTimerInterval || 5) * 60 * 1000;
            
            // 【修补底层逻辑】：针对首次开启或V4数据库重载，赋予初始安全时间，绝不直接炸开
            if (!chat.timerModeEnabledAt && !chat.lastTimerTrigger) {
                chat.timerModeEnabledAt = now;
                chat.lastTimerTrigger = now;
                if (typeof saveSingleChat === 'function') await saveSingleChat(chat.id, type);
                continue;
            }
            
            // 获取最后一次实际互动的基准点，防切后台丢失导致取值变成 0
            let lastInteractTime = chat.lastMessageTimestamp || chat.timestamp || chat.timerModeEnabledAt || 0;
            
            if (typeof getLastValidInteractMsg === 'function') {
                const lvm = getLastValidInteractMsg(chat);
                if (lvm && lvm.timestamp) lastInteractTime = Math.max(lastInteractTime, lvm.timestamp);
            } else if (chat.history && chat.history.length > 0) {
                const lastRealMsg = chat.history.filter(m => !m.id?.includes('msg_visual_') && !m.id?.includes('msg_ins_')).slice(-1)[0];
                if (lastRealMsg && lastRealMsg.timestamp) {
                    lastInteractTime = Math.max(lastInteractTime, lastRealMsg.timestamp);
                }
            }

            const lastTrigger = chat.lastTimerTrigger || chat.timerModeEnabledAt || 0;

            // 当无操作时间达标，且距离上次被定时期触发的时间也达标
            if (now - lastInteractTime >= intervalMs && now - lastTrigger >= intervalMs) {
                
                // 【修复 1 核心】：必须存入数据库，否则 V4 下切出切回触发重载会丢失此状态，导致重复触发！
                chat.lastTimerTrigger = now; 
                if (typeof saveSingleChat === 'function') {
                    await saveSingleChat(chat.id, type);
                }
                
                console.log(`[Timer模式] 触发固定时间轰炸: ${chat.realName || chat.name}`);
                triggerTimerAiReply(chat, type).catch(e => console.error("Timer AI Reply 报错:", e));
            }
        }
    }
}

async function triggerTimerAiReply(chat, type) {
    const lastValidMsg = (typeof getLastValidInteractMsg === 'function') ? getLastValidInteractMsg(chat) : null;
    
    if (lastValidMsg && (lastValidMsg.role === 'assistant' || lastValidMsg.role === 'model')) {
        let continueInstruction = '';
        if (type === 'private') {
            if (chat.offlineModeEnabled) {
                continueInstruction = `[system: ${chat.myName}暂时没有发起新的动作，请继续实时续写${chat.realName}的故事。]`;
            } else {
                continueInstruction = `[system: ${chat.myName}暂时没有回复，请自然地延续聊天内容。]`;
            }
        } else {
            const myNameInGroup = chat.me?.realName || chat.me?.nickname || "我";
            continueInstruction = `[system: ${myNameInGroup}暂时没有回复，请自然地延续聊天内容。]`;
        }

        const instructionMsg = {
            id: `msg_ins_continue_timer_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
            role: 'user',
            content: continueInstruction,
            parts:[{ type: 'text', text: continueInstruction }],
            timestamp: Date.now(),
            isHidden: true,
            isAiIgnore: false
        };
        if (type === 'group') instructionMsg.senderId = 'user_me';
        
        chat.history.push(instructionMsg);
        if (typeof saveMessageToDB === 'function') {
            await saveMessageToDB(instructionMsg, chat.id, type);
        }
    }

    if (typeof processTimePerception === 'function') {
        await processTimePerception(chat, chat.id, type, true);
    }

    if (typeof getAiReply === 'function') {
        await getAiReply(chat.id, type, true, chat.proactiveApiPresetName || null); 
    }
}


async function triggerIdleProactiveGeneration() {
    if (typeof db === 'undefined' || !db.apiSettings) return;

    const checkQueue =[
        ...(db.characters || []).map(c => ({ chat: c, type: 'private' })),
        ...(db.groups ||[]).map(g => ({ chat: g, type: 'group' }))
    ];
    
    const todayStr = new Date().toDateString();

    for (const { chat, type } of checkQueue) {
        if (chat.proactiveMode === 'fixed') {
            
            if (!chat.dailyProactiveUsage || chat.dailyProactiveUsage.date !== todayStr) {
                chat.dailyProactiveUsage = { date: todayStr, count: 0 };
            }

            const maxCalls = chat.proactiveDailyLimit || 10;
            if (chat.dailyProactiveUsage.count >= maxCalls) continue;

            let lastInteractTime = 0;
            if (chat.history && chat.history.length > 0) {
                const lastRealMsg = chat.history
                    .filter(m => !m.id?.includes('msg_proactive_') && !m.id?.includes('msg_visual_'))
                    .slice(-1)[0];
                lastInteractTime = lastRealMsg?.timestamp || 0;
            }

            const pendingSummary = chat.proactiveMessageQueue && chat.proactiveMessageQueue.find(m => m.type === 'time_window_summary' && m.expireAt > Date.now());
            if (pendingSummary) {
                console.log(`[礼物] ${chat.name || chat.realName} 奖池已满，无需填补。`);
                continue;
            }

            const pendingIdleMsg = chat.proactiveMessageQueue && chat.proactiveMessageQueue.find(m => m.type === 'time_window_idle' && m.expireAt > Date.now());
            
            if (pendingIdleMsg) {
                if (pendingIdleMsg.generatedAt >= lastInteractTime) {
                    console.log(`[礼物] ${chat.name || chat.realName} 礼物还没有送完，无需付费补充。`);
                    continue;
                } else {
                    console.log(`[礼物] ${chat.name || chat.realName} 付费更换奖池内容，原礼物已销毁。`);
                }
            }

            console.log(`[礼物] ${chat.name || chat.realName} 正在付费填充奖池...`);
            await generateBackgroundProactiveMessages(chat, maxCalls, type);
            
            chat.dailyProactiveUsage.count++;
            await saveSingleChat(chat.id, type);
        }
    }
}

async function generateBackgroundProactiveMessages(chat, maxCalls, type, queueType = 'time_window_idle') {
    try {
        // ── 新增：读取主动消息专用API配置 ──────────────────────
        let effectiveApi = db.apiSettings || {};
        if (chat.proactiveApiPresetName) {
            const preset = (db.apiPresets || []).find(p =>
                p.name === chat.proactiveApiPresetName && (!p.type || p.type === 'chat')
            );
            if (preset && preset.data) effectiveApi = { ...db.apiSettings, ...preset.data };
        }
        const { url, key, model, provider } = effectiveApi;
        const temperature = effectiveApi.temperature !== undefined ? effectiveApi.temperature : 0.85;
        const streamEnabled = !!effectiveApi.streamEnabled;
        // ────────────────────────────────────────────────────────

        let systemPrompt = '';
        if (type === 'private' && typeof generateProactivePrivatePrompt === 'function') {
            systemPrompt = generateProactivePrivatePrompt(chat); 
        } else if (type === 'group' && typeof generateProactiveGroupPrompt === 'function') {
            systemPrompt = generateProactiveGroupPrompt(chat);
        } else {
            systemPrompt = `你扮演角色“${chat.realName || chat.name}”。`;
        }

        const isOffline = (type === 'private' && chat.offlineModeEnabled);

        let emotionInstruction = "";
        let countInstruction = "";
        const freqLvl = chat.proactiveFrequency !== undefined ? chat.proactiveFrequency : 1;
        
        if (freqLvl === 2) { 
            emotionInstruction = isOffline ? "你发起互动的频率非常频繁。" : "你发消息的频率频繁。";
            countInstruction = isOffline ? "请在每个时段生成 3~5 组连贯的行为或对话。" : "请在每个时段生成 3~5 组连贯的消息。";
        } else if (freqLvl === 1) { 
            emotionInstruction = isOffline ? "你发起互动的频率普通。" : "你发消息的频率普通。";
            countInstruction = isOffline ? "请结合情景在每个时段生成 2~3 组连贯的行为或对话。" : "请结合情景在每个时段生成 2~3 组连贯的消息。";
        } else { 
            emotionInstruction = isOffline ? "你的行动比较佛系，不会太频繁打扰。" : "你发消息的频率比较低。";
            countInstruction = isOffline ? "请在每个时段最多只生成 1 组行为或对话。" : "请在每个时段最多只生成 1 组消息。";
        }

        function getTargetSlots(nowTime) {
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
            
            let remainingHours = 0;
            if (currIdx === 0 && hour >= 22) {
                remainingHours = (24 - hour - 1) + (60 - minutes) / 60 + 6;
            } else {
                remainingHours = (slots[currIdx].endHour - hour - 1) + (60 - minutes) / 60;
            }
            
            if (remainingHours <= 1) {
                return[slots[(currIdx + 1) % 5], slots[(currIdx + 2) % 5]];
            } else {
                return[slots[currIdx], slots[(currIdx + 1) % 5]];
            }
        }

        const targetSlots = getTargetSlots(new Date());
        const senderInstruction = type === 'private' 
            ? `行动者必须是你自己的名字（${chat.realName || chat.name}）` 
            : `群聊必须严格使用群成员的真名（当前群成员真名列表：${(chat.members ||[]).map(m => m.realName).join('、')}，可多人互动）`;
        
        const now = new Date();
        const pad = (n) => n < 10 ? '0' + n : n;
        const weekDays =['日', '一', '二', '三', '四', '五', '六'];
        const currentWeekDay = weekDays[now.getDay()]; 
        const currentTime = `${now.getFullYear()}年${pad(now.getMonth() + 1)}月${pad(now.getDate())}日 星期${currentWeekDay} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

        let exampleFormat = '';
        if (type === 'private') {
            const senderName = chat.realName || chat.name || '发件人';
            if (isOffline) {
               exampleFormat = `#SECRET_CHAT_${targetSlots[0].id.toUpperCase()}_80%#\n[08:15|${senderName}的动作:他走到你面前停下。]\n[08:16|${senderName}的语言:在发什么呆呢？]\n[08:15|${senderName}的动作:他把你揽进怀里哄你睡觉。]\n\n#SECRET_CHAT_${targetSlots[0].id.toUpperCase()}_60%#\n[09:20|${senderName}的动作: 他就这样一直抱着你。过了一个小时，注意到你似乎醒了，他蹭了蹭你。]\n[09:21|${senderName}的语言:睡醒了？]`;
            } else {
                exampleFormat = `#SECRET_CHAT_${targetSlots[0].id.toUpperCase()}_80%#\n[08:15|${senderName}的消息:醒了吗？]\n[08:16|${senderName}的消息:路上居然看到一只猫]\n[08:17|${senderName}发来的照片/视频:路边的一只猫]\n\n#SECRET_CHAT_${targetSlots[0].id.toUpperCase()}_60%#\n[09:20|${senderName}的消息:你不会还没起床吧？]\n[09:21|${senderName}的语音:大懒虫快起来！]`;
            }
        } else {
            const m1 = (chat.members && chat.members.length > 0) ? chat.members[0].realName : '群成员A';
            const m2 = (chat.members && chat.members.length > 1) ? chat.members[1].realName : m1;
            exampleFormat = `#SECRET_CHAT_${targetSlots[0].id.toUpperCase()}_80%#\n[08:15|${m1}的消息:大家今天干嘛去？]\n[08:16|${m2}的表情包:躺平]\n\n#SECRET_CHAT_${targetSlots[0].id.toUpperCase()}_90%#\n[09:25|${m1}发来的照片/视频:刚做好的早餐]\n[09:26|${m2}的消息:看着不错哦！]`;
        }

        const actionPromptText = isOffline ? "主动发起面对面互动（如靠近、说话、做动作）" : "主动发消息";
        const frequencyTitleText = isOffline ? "【你的互动频率】" : "【你的发消息频率】";
        const messageUnitText = isOffline ? "行为/台词" : "消息";
        const formatExampleText = isOffline
            ? `[HH:MM|发送者名字的动作:内容1][HH:MM|发送者名字的语言:内容2]`
            : `[HH:MM|发送者名字的消息:内容1][HH:MM|发送者名字的消息:内容2]`;

        const awayInstruction = `
\n=========================================
【当前情境与行动指令】
现在是${currentTime}，请预先想好在这两个时间段（${targetSlots[0].name} 和 ${targetSlots[1].name}）如果我没有发起互动，你会如何${actionPromptText}。

${frequencyTitleText}：
${emotionInstruction}

【格式与行动要求】：
1. 数量限制：${countInstruction}。每组内包含多条发生时间非常相近的${messageUnitText}。
2. 概率评估：请根据情境评估这组${messageUnitText}发生的概率（0到100的整数），不同组可以有不同的概率。
3. 每组必须独占一个块，严格使用以下标签结构包裹：

#SECRET_CHAT_{时段ID}_概率%#
${formatExampleText}

参与者要求：${senderInstruction}。
请严格使用以下两个时段ID进行生成：${targetSlots[0].id.toUpperCase()} 和 ${targetSlots[1].id.toUpperCase()}。允许针对同一个时段ID生成多个不同概率的块（组），用于表现时间的推进！

输出示例（格式参考）：
${exampleFormat}
=========================================`;

        systemPrompt += awayInstruction;

const memoryLength = chat.maxMemory || 15;
        const recentHistory = chat.history.slice(-memoryLength).map(m => {
            if (m.isHidden || m.isAiIgnore || m.role === 'system') return null;
            return m.content;
        }).filter(Boolean).join('\n');

        const userMessage = `【最近聊天记录】\n${recentHistory || '（暂无记录）'}\n\n请按格式输出接下来的主动消息：`;

        let textBlock = "";

        // 🌟【双轨制安全网】：哪怕用户没选 API，硬生生用 Gemini，这里也做好了兼容！
        if (provider === 'gemini') {
            // Gemini API 发送逻辑
            const endpoint = `${url}/v1beta/models/${model}:generateContent?key=${typeof getRandomValue === 'function' ? getRandomValue(key) : key}`;
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [ { role: 'user', parts: [{ text: systemPrompt + '\n\n' + userMessage }] } ],
                    generationConfig: { temperature: temperature }
                })
            });

            if (!response.ok) return;
            const result = await response.json();
            textBlock = result.candidates?.[0]?.content?.parts?.[0]?.text || "";

        } else {
            // OpenAI 兼容 API 发送逻辑 (采用 Claude 提供的 SSE 流式解析防超时)
            const response = await fetch(`${url}/v1/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
                body: JSON.stringify({
                    model: model,
                    messages:[{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }],
                    temperature: temperature,
                    stream: streamEnabled
                })
            });

            if (!response.ok) return;

            if (streamEnabled) {
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';
                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop(); // 保留不完整行
                    for (const line of lines) {
                        if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
                        try {
                            const chunk = JSON.parse(line.slice(6));
                            const delta = chunk.choices?.[0]?.delta?.content;
                            if (delta) textBlock += delta;
                        } catch {}
                    }
                }
                textBlock = textBlock.trim();
            } else {
                const result = await response.json();
                textBlock = result.choices[0].message.content.trim();
            }
        }

        let proactiveOptions = {};
        let groupCounters = {}; 
        
        const globalTagRegex = /#SECRET_CHAT_([A-Za-z]+)(?:_(\d+)%?)?#\s*([\s\S]*?)(?=(?:#SECRET_CHAT_|$))/gi;
        let match;
        
        while ((match = globalTagRegex.exec(textBlock)) !== null) {
            let baseSlotName = match[1].toLowerCase(); 
            let rawProb = match[2] ? parseInt(match[2], 10) : 100;
            let finalProb = Math.floor(90 + (rawProb * 0.1));
            let block = match[3].trim();
            
            let messages = [];
            const lineRegex = /\[(\d{1,2}:\d{2})\|([^:：]+)[:：](.*?)\]/g;
            let lineMatch;
            
            while ((lineMatch = lineRegex.exec(block)) !== null) {
                let prefix = lineMatch[2].trim();
                let senderName = prefix;
                let actionType = "的消息";

                const actionKeywords =[
                    "的消息", "的表情包", 
                    "发来的照片/视频", "的照片/视频", "发来的照片", "的照片", 
                    "的语音", "发来的语音", "撤回了一条消息","撤回了上一条消息",
                    "的转账", "发来的转账", 
                    "送来的礼物", "的礼物", 
                    "的动作", "的语言"
                ];
                for (const kw of actionKeywords) {
                    if (prefix.endsWith(kw)) {
                        senderName = prefix.slice(0, -kw.length); 
                        actionType = kw; 
                        
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

                messages.push({
                    time: lineMatch[1],
                    sender: senderName,
                    action: actionType, 
                    text: lineMatch[3].trim()
                });
            }

            if (messages.length === 0 && block.length > 0) {
                let defaultSender = type === 'private' ? (chat.realName || '系统') : (chat.name || '群成员');
                messages.push({
                    time: null,
                    sender: defaultSender,
                    text: block.replace(/^[（(]|[）)]$/g, '').trim() 
                });
            }

            if (messages.length > 0) {
                if (groupCounters[baseSlotName] === undefined) {
                    groupCounters[baseSlotName] = 0;
                }
                let uniqueSlotId = `${baseSlotName}_${groupCounters[baseSlotName]}`;
                groupCounters[baseSlotName]++;
                
                proactiveOptions[uniqueSlotId] = {
                    probability: finalProb,
                    messages: messages 
                };
            }
        }

       if (Object.keys(proactiveOptions).length > 0) {
            if (queueType === 'time_window_peek') {
                chat.proactiveMessageQueue = chat.proactiveMessageQueue ||[];
                let existingPeek = chat.proactiveMessageQueue.find(m => m.type === 'time_window_peek');
                
                if (!existingPeek) {
                    existingPeek = {
                        id: `promsg_peek_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
                        type: 'time_window_peek',
                        generatedAt: Date.now(),
                        expireAt: Date.now() + 72 * 60 * 60 * 1000, 
                        content: {}
                    };
                    chat.proactiveMessageQueue.push(existingPeek);
                }
                
                for (let k in proactiveOptions) {
                    let uniqueKey = `${k}_peek_${Date.now()}_${Math.floor(Math.random()*1000)}`;
                    existingPeek.content[uniqueKey] = {
                        ...proactiveOptions[k],
                        generatedAt: Date.now() 
                    };
                }
                
                let allKeys = Object.keys(existingPeek.content);
                if (allKeys.length > 10) {
                    allKeys.sort((a, b) => {
                        let timeA = existingPeek.content[a].generatedAt || 0;
                        let timeB = existingPeek.content[b].generatedAt || 0;
                        return timeA - timeB;
                    });
                    let keysToKeep = allKeys.slice(-10);
                    let newContent = {};
                    keysToKeep.forEach(k => newContent[k] = existingPeek.content[k]);
                    existingPeek.content = newContent;
                }
                console.log(`[Peek顺风车] 成功收集${Object.keys(proactiveOptions).length}组，当前备用池容量: ${Object.keys(existingPeek.content).length}/10`);
            } else {
                const newProactiveData = {
                    id: `promsg_idle_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
                    type: queueType,
                    generatedAt: Date.now(),
                    expireAt: Date.now() + 12 * 60 * 60 * 1000, 
                    content: proactiveOptions
                };
                chat.proactiveMessageQueue = (chat.proactiveMessageQueue ||[]).filter(m => m.type !== queueType);
                chat.proactiveMessageQueue.push(newProactiveData);
                console.log(`[奖池填充成功] 等待开奖！`);            
            }
        } else {
            console.warn(`[奖池填充失败] 解析失败或 AI 未按格式返回内容。`);
        }
    } catch (error) {
        console.error("抽奖系统机器故障！", error);        
    }
}