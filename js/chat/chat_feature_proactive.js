// --- chat_feature_proactive.js ---

/**
 * 打开 主动消息设置弹窗 (读取 HTML 结构)
 */
function openProactiveMessagingSettings() {
    const chat = getCurrentChatObject();
    if (!chat) return;

    const modal = document.getElementById('proactive-away-modal');
    const form = document.getElementById('proactive-away-form');
    const modeSelect = document.getElementById('pa-mode-select');
    const fixedSettings = document.getElementById('pa-fixed-settings');
    const dailySlider = document.getElementById('pa-daily-limit-slider');
    const dailyVal = document.getElementById('pa-daily-limit-val');
    
    // 新增：频率控制滑块
    const freqSlider = document.getElementById('pa-frequency-slider');
    const freqVal = document.getElementById('pa-frequency-val');

    // 1. 初始化读取数据库
    modeSelect.value = chat.proactiveMode || 'random';
    dailySlider.value = chat.proactiveDailyLimit || 10;
    dailyVal.textContent = dailySlider.value;
    
    // 读取频率值 (由于0是假值，所以用 !== undefined 判断，默认为 1 普通)
    freqSlider.value = chat.proactiveFrequency !== undefined ? chat.proactiveFrequency : 1;
    const updateFreqText = () => {
        const val = parseInt(freqSlider.value, 10);
        if (val === 0) freqVal.textContent = '佛系';
        else if (val === 1) freqVal.textContent = '普通';
        else if (val === 2) freqVal.textContent = '粘人';
    };
    updateFreqText();

    // 2. 监听模式切换，展开/收起下方滑块 (现在包含调用次数和发送频率)
    const toggleSettings = () => {
        fixedSettings.style.display = modeSelect.value === 'fixed' ? 'block' : 'none';
    };
    toggleSettings(); // 初始化执行一次
    modeSelect.onchange = toggleSettings;

    // 3. 滑块实时显示数值
    dailySlider.oninput = () => dailyVal.textContent = dailySlider.value;
    freqSlider.oninput = updateFreqText;

    // 4. 显示弹窗
    modal.classList.add('visible');

    // 5. 绑定取消按钮
    document.getElementById('pa-cancel-btn').onclick = () => {
        modal.classList.remove('visible');
    };

    // 6. 绑定表单提交（增加传参 frequency）
    form.onsubmit = async (e) => {
        e.preventDefault();
        modal.classList.remove('visible');
        await applyAwaySettings(chat, modeSelect.value, parseInt(dailySlider.value, 10), parseInt(freqSlider.value, 10));
    };
}

/**
 * 应用模式并存库，不再锁定任何 UI
 */
async function applyAwaySettings(chat, mode, dailyLimit, frequency) {
    chat.proactiveMode = mode;
    
    if (mode === 'fixed') {
        chat.proactiveDailyLimit = dailyLimit;
        chat.proactiveFrequency = frequency; // ★ 仅在固定模式下保存发送频率
    }

    await saveSingleChat(chat.id, currentChatType);
    
    // 加号面板中，仅“固定模式”高亮亮起以示区别
    const awayBtn = document.querySelector('.expansion-item[data-action="proactive-messaging-settings"]');
    if (awayBtn) {
        if (mode === 'fixed') awayBtn.classList.add('active');
        else awayBtn.classList.remove('active');
    }
}

/**
 * 往角色的主动消息队列中塞入一条预生成消息 (供外部“顺风车”功能调用)
 */
function pushProactiveMessage(chatId, type, content, expireHours = 24) {
    // 兼容两库搜索
    const chat = (db.characters ||[]).find(c => c.id === chatId) || (db.groups ||[]).find(g => g.id === chatId);
if (!chat) return;
    
    if (!chat.proactiveMessageQueue) chat.proactiveMessageQueue =[];
    
    // 【核心修改】：先过滤掉旧的同类型草稿，实现“最新覆盖最旧”
    chat.proactiveMessageQueue = chat.proactiveMessageQueue.filter(m => m.type !== type);
    
    // 修改二.1：顺风车生成成功时，删掉队列里已有的 time_window_idle
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
        if (chat.proactiveMode === 'dnd' || !chat.proactiveMessageQueue || chat.proactiveMessageQueue.length === 0) continue;

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
            msgIndex = chat.proactiveMessageQueue.findIndex(m => m.type === 'time_window_peek');
            if (msgIndex !== -1) isPeekSource = true;
        }

        if (msgIndex === -1) continue;

        const draft = chat.proactiveMessageQueue[msgIndex];

        // --- 核心修复区开始 ---
        // 1. 精准提取上次“真正发言（User/正常回复）”的时间
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
        
        // 2. 检查自从上次“真正发言”后，是否已经投递过主动消息了？
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

        const minTimeGap = isPeekSource ? 120 * 60 * 1000 : 5 * 60 * 1000;
        if (tNow - lastInteractTime < minTimeGap) continue; 
        
        // 3. 【Peek 连发锁】如果发送过任何主动消息，且用户没重新说话前，Peek 被彻底锁死，杜绝“几秒钟后又发一组”
        if (isPeekSource && hasSentProactiveSinceLastReal) {
            continue;
        }
        // --- 核心修复区结束 ---

        let candidates =[];

        for (const slotId of Object.keys(draft.content)) {
            const slotData = draft.content[slotId];
            if (!slotData.messages || slotData.messages.length === 0) continue; 
            
            let firstMsgTimeStr = slotData.messages[0].time;
            let groupTargetTime;
            let baseStart, baseEnd;

if (isPeekSource) {
                // ==========================================
                // 【PEEK 专属逻辑：永不过期的相对时间映射】
                // ==========================================
                // 获取这组消息被 AI “创造”出来的绝对时间戳
                let tGen = slotData.generatedAt || draft.generatedAt;
                
                let tempDate = new Date(tNow);
                if (firstMsgTimeStr) {
                    const [hours, minutes] = firstMsgTimeStr.split(':').map(Number);
                    tempDate.setHours(hours, minutes, 0, 0);
                    
                    // 找到离当前时间(tNow)最近的这个时刻（如果今天还没到这个点，就退回昨天）
                    if (tempDate.getTime() > tNow) {
                        tempDate.setDate(tempDate.getDate() - 1);
                    }
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

                // ★ 终极防线：如果倒推出来的发送时间，比这组消息“被创造”的时刻还要早，
                // 说明 AI 预测的其实是【明天及以后】的这个时间，时机未到，直接跳过等以后！
                if (groupTargetTime < tGen) {
                    continue; 
                }

                // 【约束】：被映射后的真实投递时间，必须在用户最后一次真实发言时间的 30 分钟以后
                if (groupTargetTime < lastInteractTime + 120 * 60 * 1000) {
                    continue; // 没满足，留到未来哪天满足了再发
                }

                let prob = slotData.probability;
                if (prob === null || isNaN(prob)) prob = defaultProbabilities[slotId.toLowerCase().split('_')[0]] || 90;

                candidates.push({
                    slotId: slotId,
                    messages: slotData.messages, 
                    probability: prob,
                    groupTargetTime: groupTargetTime,
                    baseStart: baseStart,
                    baseEnd: baseEnd
                });

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
                    
                    if (groupTargetTime < baseStart - 12 * 3600 * 1000) { 
                        groupTargetTime += 24 * 3600 * 1000;
                    } else if (groupTargetTime > baseEnd + 12 * 3600 * 1000) {
                        groupTargetTime -= 24 * 3600 * 1000;
                    }
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

                candidates.push({
                    slotId: slotId,
                    messages: slotData.messages, 
                    probability: prob,
                    groupTargetTime: groupTargetTime,
                    baseStart: baseStart,
                    baseEnd: baseEnd
                });
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

        // 【选取规则分离】
        if (isPeekSource) {
            // Peek 专属：如果有多个有效（比如既有昨晚23:30，又有今天21:00），倒序选取离“现在”最近的一个。只发这一个！
            candidates.sort((a, b) => b.groupTargetTime - a.groupTargetTime);
            candidates = [candidates[0]];
        } else {
            // 原版按时间线顺序执行
            candidates.sort((a, b) => a.groupTargetTime - b.groupTargetTime);
        }

        let currentFakeTimestamp = lastInteractTime; 
        let deliveredCount = 0;

        for (const candidate of candidates) {
            const roll = Math.random() * 100;
            console.log(`[抽奖详情] 对象: ${chat.realName || chat.name}, 来源: ${isPeekSource ? 'Peek备用池' : '标准池'}, 组: ${candidate.slotId}, 概率: ${candidate.probability}%, 骰子: ${roll.toFixed(1)}`);
            
            if (roll <= candidate.probability) {
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

                    if (msgFakeTimestamp <= currentFakeTimestamp) {
                        msgFakeTimestamp = currentFakeTimestamp + 60 * 1000;
                    }
                    if (msgFakeTimestamp > tNow) {
                        msgFakeTimestamp = tNow - 1000; 
                    }
                    
                    let timeGap = msgFakeTimestamp - currentFakeTimestamp;
                    currentFakeTimestamp = msgFakeTimestamp;
                    
                    if (i === 0 && timeGap > 30 * 60 * 1000) {
                        const visualMessage = {
                            id: `msg_visual_timesense_${Date.now()}_${deliveredCount}_${i}`,
                            role: 'system',
                            content: `[time-divider]`,
                            parts: [{ type: 'text', text: '[time-divider]' }],
                            timestamp: msgFakeTimestamp - 1
                        };
                        chat.history.push(visualMessage);
                        if (typeof currentChatId !== 'undefined' && currentChatId === chat.id && typeof addMessageBubble === 'function') {
                            addMessageBubble(visualMessage, chat.id, type);
                        }
                    }

                    let actionStr = msgInfo.action || '的消息';
                    
                    // 兜底标准化，防止队列里的历史旧数据格式不对导致气泡工厂无法识别
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
                        if (actionStr === '的动作') {
                            finalContent = `[system-narration:${msgInfo.text}]`; 
                        } else if (actionStr === '的语言') {
                            finalContent = `[${msgInfo.sender}的消息：${msgInfo.text}]`; 
                        } else if (actionStr === '更新状态为') {
                            finalContent = `[${msgInfo.sender}更新状态为：${msgInfo.text}]`;
                        }
                    }

                    const newMsg = {
                        id: `msg_proactive_${Date.now()}_${deliveredCount}_${i}`,
                        role: 'assistant',
                        content: finalContent,
                        parts: [{ type: 'text', text: finalContent }],
                        timestamp: msgFakeTimestamp
                    };

                    // 补充撤回状态参数供气泡工厂原生逻辑识别
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
                    
                    if (typeof currentChatId !== 'undefined' && currentChatId === chat.id && typeof addMessageBubble === 'function') {
                        addMessageBubble(newMsg, chat.id, type);
                    }
                }
                
                if (typeof currentChatId !== 'undefined' && currentChatId === chat.id) {
                } else {
                    chat.unreadCount = (chat.unreadCount || 0) + candidate.messages.length;
                }
                
                deliveredCount++;
            } else {
                console.log(`[抽奖失败] 组: ${candidate.slotId} 放弃发送。`);
            }
            
            // 用完一条就删除一条
            delete draft.content[candidate.slotId];
        }

        if (Object.keys(draft.content).length === 0) {
            chat.proactiveMessageQueue.splice(msgIndex, 1);
        }

        if (deliveredCount > 0 || candidates.length > 0) {
            hasDelivered = (deliveredCount > 0) || hasDelivered;
            if (type === 'private') { if (!charModified.includes(chat)) charModified.push(chat); } 
            else { if (!groupModified.includes(chat)) groupModified.push(chat); }
        }
    }

    if (hasDelivered || charModified.length > 0 || groupModified.length > 0) {
        for (const c of charModified) { if (typeof saveSingleChat === 'function') await saveSingleChat(c.id, 'private'); }
        for (const g of groupModified) { if (typeof saveSingleChat === 'function') await saveSingleChat(g.id, 'group'); }
        if (hasDelivered && typeof renderChatList === 'function') { renderChatList(); }
    }
}


// ==========================================
// 全局闲置计时器与后台静默推演
// ==========================================
let bgAudioElement = null;
let bgTimeoutId = null;
const silentWavBase64 = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";

function unlockAudioElement() {
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

    // 解锁一次即可，阅后即焚
    window.removeEventListener('touchstart', unlockAudioElement, { passive: true });
    window.removeEventListener('click', unlockAudioElement, { passive: true });
}

function startBackgroundAudioTimer() {
    stopBackgroundAudioTimer(); // 确保先清理旧的定时器
    
    // ==========================================
    // 精准排查是否【有任何角色需要补充奖池】
    // ==========================================
    if (typeof db !== 'undefined') {
        const now = Date.now();
        const todayStr = new Date().toDateString();
        const allChats = [...(db.characters || []), ...(db.groups ||[])];
        
        const needsGeneration = allChats.some(chat => {
            if (chat.proactiveMode !== 'fixed') return false;

            const maxCalls = chat.proactiveDailyLimit || 10;
            const currentCount = (chat.dailyProactiveUsage && chat.dailyProactiveUsage.date === todayStr) 
                ? chat.dailyProactiveUsage.count 
                : 0;
            if (currentCount >= maxCalls) return false;

            let lastInteractTime = 0;
            if (chat.history && chat.history.length > 0) {
                const lastRealMsg = chat.history
                    .filter(m => !m.id?.includes('msg_proactive_') && !m.id?.includes('msg_visual_'))
                    .slice(-1)[0];
                lastInteractTime = lastRealMsg?.timestamp || 0;
            }

            const hasValidDraft = chat.proactiveMessageQueue && chat.proactiveMessageQueue.some(m => {
                if (m.expireAt <= now) return false; 
                if (m.type === 'time_window_summary') return true; 
                if (m.type === 'time_window_idle') {
                    return m.generatedAt >= lastInteractTime;
                }
                return false;
            });

            return !hasValidDraft; // 如果没有有效草稿，就说明需要生成
        });

        if (!needsGeneration) {
            console.log('[精灵] 虽然user离开了，但奖池是满的，精灵休息。');
            return; 
        }
    }
    // ==========================================

    console.log(`[精灵] user离开了，精灵开始唱歌...`);

    // 如果用户极其罕见地没点过屏幕就切后台，兜底创建
    if (!bgAudioElement) {
        bgAudioElement = new Audio(silentWavBase64);
        bgAudioElement.loop = true;
        bgAudioElement.volume = 1; // 🌟 核心修复 1：保持音量 1
        bgAudioElement.setAttribute('playsinline', '');
        bgAudioElement.setAttribute('webkit-playsinline', '');
    }

    // 开始无限循环播放静音音频，这一步执行后，JS 线程就像钉子一样钉在后台了
    bgAudioElement.play().catch(e => console.log("[精灵] 精灵发声失败:", e));

    // 既然 JS 线程活下来了，我们就可以放心地用 setTimeout 计时 5 分钟
    const IDLE_DELAY = 5 * 60 * 1000; 
    bgTimeoutId = setTimeout(() => {
        console.log(`[精灵] 精灵唱完了，召唤角色补充奖池...`);
        triggerIdleProactiveGeneration();
        stopBackgroundAudioTimer(); // 生成后停止唱歌，节约电量
    }, IDLE_DELAY);
}

// 🌟 核心修复 2：删掉了下面重复的报错代码，保留这唯一正确的清理函数
function stopBackgroundAudioTimer() {
    if (bgTimeoutId) {
        clearTimeout(bgTimeoutId);
        bgTimeoutId = null;
    }
    if (bgAudioElement && !bgAudioElement.paused) {
        bgAudioElement.pause();
        bgAudioElement.currentTime = 0; // 重置进度
    }
}

// 🌟 核心修复 3：统一唯一且正确的监听器入口
(function setupInactivityTracker() {
    // 投递逻辑：独立的setInterval，每分钟检查一次
    setInterval(() => {
        console.log(`[时计] 定时检查是否到达抽奖时间...`);
        checkAndDeliverProactiveMessages();
    }, 60000);

    // 绑定解锁事件
    window.addEventListener('touchstart', unlockAudioElement, { passive: true });
    window.addEventListener('click', unlockAudioElement, { passive: true });

    // 监听切出、切回页面的动作
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            startBackgroundAudioTimer();
        } else {
            console.log(`[精灵] user回来了，精灵噤声，准备待会重新开始唱。`);
            stopBackgroundAudioTimer();
        }
    });
})();


async function triggerIdleProactiveGeneration() {
    // 确保依赖数据库已加载
    if (typeof db === 'undefined' || !db.apiSettings) return;

    const checkQueue = [
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

            // 获取最后一次聊天的真实时间
            let lastInteractTime = 0;
            if (chat.history && chat.history.length > 0) {
                const lastRealMsg = chat.history
                    .filter(m => !m.id?.includes('msg_proactive_') && !m.id?.includes('msg_visual_'))
                    .slice(-1)[0];
                lastInteractTime = lastRealMsg?.timestamp || 0;
            }

            // 修改二.3：检查队列里是否有未过期的 time_window_summary，有的话直接跳过，不发起API调用
            const pendingSummary = chat.proactiveMessageQueue && chat.proactiveMessageQueue.find(m => m.type === 'time_window_summary' && m.expireAt > Date.now());
            if (pendingSummary) {
                console.log(`[礼物] ${chat.name || chat.realName} 奖池已满，无需填补。`);
                continue;
            }

            // 获取当前尚未过期的时间窗口闲置草稿
            const pendingIdleMsg = chat.proactiveMessageQueue && chat.proactiveMessageQueue.find(m => m.type === 'time_window_idle' && m.expireAt > Date.now());
            
            // 【核心修改：完美满足你的覆盖逻辑】
            if (pendingIdleMsg) {
                if (pendingIdleMsg.generatedAt >= lastInteractTime) {
                    console.log(`[礼物] ${chat.name || chat.realName} 礼物还没有送完，无需付费补充。`);
                    continue;
                } else {
                    // 情况 B：草稿的生成时间【早于】最后一次聊天，说明用户后来又去聊过天了，原有语境已作废。
                    // 结论：放行！继续往下走去调用 API 重新生成，覆盖旧的废案。
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
        const { url, key, model } = db.apiSettings;
let systemPrompt = '';
        if (type === 'private' && typeof generateProactivePrivatePrompt === 'function') {
            systemPrompt = generateProactivePrivatePrompt(chat); 
        } else if (type === 'group' && typeof generateProactiveGroupPrompt === 'function') {
            systemPrompt = generateProactiveGroupPrompt(chat);
        } else {
            systemPrompt = `你扮演角色“${chat.realName || chat.name}”。`;
        }

// 判断是否为线下模式
        const isOffline = (type === 'private' && chat.offlineModeEnabled);

        // --- 优化 1：读取固定模式专属频率设定并生成 Prompt ---
        let emotionInstruction = "";
        let countInstruction = "";
        
        // 提取频率设定，默认 1(普通)
        const freqLvl = chat.proactiveFrequency !== undefined ? chat.proactiveFrequency : 1;
        
        if (freqLvl === 2) { // 粘人
            emotionInstruction = isOffline ? "你发起互动的频率非常频繁。" : "你发消息的频率频繁。";
            countInstruction = isOffline ? "请在每个时段生成 3~5 组连贯的行为或对话。" : "请在每个时段生成 3~5 组连贯的消息。";
        } else if (freqLvl === 1) { // 普通
            emotionInstruction = isOffline ? "你发起互动的频率普通。" : "你发消息的频率普通。";
            countInstruction = isOffline ? "请结合情景在每个时段生成 2~3 组连贯的行为或对话。" : "请结合情景在每个时段生成 2~3 组连贯的消息。";
        } else { // 佛系 (0)
            emotionInstruction = isOffline ? "你的行动比较佛系，不会太频繁打扰。" : "你发消息的频率比较低。";
            countInstruction = isOffline ? "请在每个时段最多只生成 1 组行为或对话。" : "请在每个时段最多只生成 1 组消息。";
        }

        // --- 优化 2：精准的“本时段剩余时间”判定算法 ---
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
            
            // 计算当前时段距离结束还有几个小时
            let remainingHours = 0;
            if (currIdx === 0 && hour >= 22) {
                remainingHours = (24 - hour - 1) + (60 - minutes) / 60 + 6;
            } else {
                remainingHours = (slots[currIdx].endHour - hour - 1) + (60 - minutes) / 60;
            }
            
            if (remainingHours <= 1) {
                return [slots[(currIdx + 1) % 5], slots[(currIdx + 2) % 5]];
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

        // 示例格式匹配
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

        // 动态术语：根据是否为线下模式，更改指令中的词汇
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

const response = await fetch(`${url}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify({
                model: model,
                messages:[{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }],
                temperature: 0.85 
            })
        });

        if (!response.ok) return;
        const result = await response.json();
        const textBlock = result.choices[0].message.content.trim();

        // --- 重构：完美的全局捕获正则，不丢弃任何一个组 ---
        let proactiveOptions = {};
        let groupCounters = {}; // 用来记录每个时段被切分了几个组，例如 morning_0, morning_1
        
        // 使用带有 g (全局匹配) 的正则，抓取所有出现过的 #SECRET_CHAT 标签块
        const globalTagRegex = /#SECRET_CHAT_([A-Za-z]+)(?:_(\d+)%?)?#\s*([\s\S]*?)(?=(?:#SECRET_CHAT_|$))/gi;
        let match;
        
        while ((match = globalTagRegex.exec(textBlock)) !== null) {
            let baseSlotName = match[1].toLowerCase(); // 提取纯时段，例如 'morning'
            let rawProb = match[2] ? parseInt(match[2], 10) : 100;
            let finalProb = Math.floor(90 + (rawProb * 0.1));
            let block = match[3].trim();
            
            // --- 升级的正则捕获区域 ---
            let messages = [];
            const lineRegex = /\[(\d{1,2}:\d{2})\|([^:：]+)[:：](.*?)\]/g;
            let lineMatch;
            
            while ((lineMatch = lineRegex.exec(block)) !== null) {
                let prefix = lineMatch[2].trim();
                let senderName = prefix;
                let actionType = "的消息";

                // 核心：从前缀中剥离特殊动作（保留给下一步拼装使用）
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
                        senderName = prefix.slice(0, -kw.length); // 留下纯名字
                        actionType = kw; // 保存动作
                        
                        // 标准化动作类型，以便准确匹配气泡工厂的正则
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
                    action: actionType, // ★ 保存动作标识
                    text: lineMatch[3].trim()
                });
            }

            // 兜底防错
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
                // 给这个组打上唯一标记，比如 morning_0, morning_1
                let uniqueSlotId = `${baseSlotName}_${groupCounters[baseSlotName]}`;
                groupCounters[baseSlotName]++;
                
                proactiveOptions[uniqueSlotId] = {
                    probability: finalProb,
                    messages: messages 
                };
            }
        }

       if (Object.keys(proactiveOptions).length > 0) {
            // ==========================================
            // 【新增】：根据 queueType 进行分别处理
            // ==========================================
            if (queueType === 'time_window_peek') {
                chat.proactiveMessageQueue = chat.proactiveMessageQueue ||[];
                let existingPeek = chat.proactiveMessageQueue.find(m => m.type === 'time_window_peek');
                
                if (!existingPeek) {
                    existingPeek = {
                        id: `promsg_peek_${Date.now()}`,
                        type: 'time_window_peek',
                        generatedAt: Date.now(),
                        expireAt: Date.now() + 72 * 60 * 60 * 1000, // 72小时过期
                        content: {}
                    };
                    chat.proactiveMessageQueue.push(existingPeek);
                }
                
                // 为了防止多时段重名，并保留真实生成时间供以后追溯
                for (let k in proactiveOptions) {
                    let uniqueKey = `${k}_peek_${Date.now()}_${Math.floor(Math.random()*1000)}`;
                    existingPeek.content[uniqueKey] = {
                        ...proactiveOptions[k],
                        generatedAt: Date.now() // 挂载单组的生成时间
                    };
                }
                
                // 限制最多保存最新的 10 组
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
                    id: `promsg_idle_${Date.now()}`,
                    type: queueType,
                    generatedAt: Date.now(),
                    expireAt: Date.now() + 12 * 60 * 60 * 1000, 
                    content: proactiveOptions
                };
                // 确保不覆盖其他类型的草稿
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