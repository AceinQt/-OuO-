// ==========================================
// chat_feature_call.js - 语音/视频通话功能
// ==========================================

let callTimerInterval   = null;
let callStartTime       = null;
let incomingCallTimeout = null;   // 来电未接听倒计时

// ------------------------------------------
// 视频通话专用写作手册（独立于线下模式）
// 在此函数内单独调整视频通话的 AI 写作格式
// ------------------------------------------
function generateCallVideoReinforcement(chat) {
    const worldBooksWriting = (chat.worldBookIds || [])
        .map(id => db.worldBooks.find(wb => wb.id === id && wb.position === 'writing'))
        .filter(Boolean)
        .map(wb => wb.content)
        .join('');

    return `[🛑 严格执行以下写作手册]
## 1. 🧠 动笔前的快速自问（无需输出，心底自问）
1. **状态**：视频通话中，${chat.realName}此刻的神情、环境是什么样的？
2. **回应**：${chat.myName}刚才说的话，${chat.realName}会针对哪个点进行回应？
3. **查重**：上一轮是否已经描写过同一个表情/动作/环境细节？如果有，**禁止**重复。

## 2. ✍️ 写作原则
${worldBooksWriting ? `1. **文风第一**：严格遵循【写作风格】设定：${worldBooksWriting}` : ''}
2. **人设为本**：${chat.realName}的反应必须符合他/她的设定
3. **通话质感**：聚焦镜头里"看得见"的——动作、表情、环境光影，而非无法通过画面传递的内心堆砌。
4. **逻辑严密**：动作连续，时间流逝合理。
5. **渐进变化**：情绪转变要自然，避免过度煽情。
6. **拒绝冗余**：禁止连续两轮使用相同比喻；禁止反复描写同一环境或状态。

## 3. 📤 强制输出格式
1. **旁白**：第三人称描写${chat.realName}在视频画面中的状态（动作、神情、背景），直接输出，**不加任何前缀**。
2. **对话**：${chat.realName}嘴巴说出口的每句话，行首加 \`>>>\`，不加引号。注意每句话都要分开，表示说话停顿。
3. **不得输出心理活动**：记住你是在描写视频通话场景，视频通话只能看到动作和表情。
4. **人称**：全文用"他/她"或"${chat.realName}"指代主角，用"你"指代${chat.myName}，**绝不使用"我"**。
5. **挂断通话**：如果对话到了自然结束的时刻，你想主动结束视频时，请单起一行输出：\`[${chat.realName}挂断了通话]\`。

**输出示例**：
\`\`\`
${chat.realName}低头看了一眼不知道什么东西，重新抬起脸时神情已经平静下来。
>>> 你刚才说什么？
>>> 我没听清。
镜头前，他的手指无声地敲了敲桌沿。
>>> 你再说一次。
\`\`\`

## 4. 🛑 动笔前自我灵魂拷问
1. **人设校验**：这个反应符合${chat.realName}的性格吗？
2. **禁词检查**：是否写出了"宠溺"、"彻底沦陷"等油腻词汇？如有，立刻删除，改为具体动作。
3. **内容检查**：始终记住，你描写地是手机镜头里的${chat.realName}，你无法得知镜头以外的事，包括心理想法。如果有超出镜头的描写，立刻删除。

现在，根据${chat.myName}的最新动态，以视频画面中的旁白和对话开始续写。\n\n`;
}

// ------------------------------------------
// 打开通话类型选择底部菜单
// ------------------------------------------
function openCallTypeMenu() {
    if (currentChatType !== 'private') {
        showToast('通话功能仅支持单人聊天');
        return;
    }
    const chat = db.characters.find(c => c.id === currentChatId);
    if (!chat) return;

    if (chat.offlineModeEnabled) {
        showToast('线下模式中无法使用通话功能');
        return;
    }

    document.getElementById('call-type-actionsheet').classList.add('visible');
}

// ------------------------------------------
// 进入通话（用户主动发起）
// ------------------------------------------
async function startCall(type) {
    document.getElementById('call-type-actionsheet').classList.remove('visible');

    const chat = db.characters.find(c => c.id === currentChatId);
    if (!chat) return;
       if (typeof processTimePerception === 'function') {
        await processTimePerception(chat, currentChatId, currentChatType);
    }

    const sessionId = `call_${Date.now()}`;
    chat.callMode = type;
    chat.currentCallSessionId = sessionId;

    const now = Date.now();
    const typeName = type === 'voice' ? '语音通话' : '视频通话';

    const instructionContent = type === 'voice'
        ? `[system: 场景切换：${chat.realName}和${chat.myName}切换到语音通话模式。]`
        : `[system: 场景切换：${chat.realName}和${chat.myName}切换到视频通话模式。]`;

    const instructionMsg = {
        id: `msg_call_start_ins_${now}`,
        role: 'user',
        content: instructionContent,
        parts: [{ type: 'text', text: instructionContent }],
        timestamp: now,
        isHidden: true,
        callSessionId: sessionId
    };
    chat.history.push(instructionMsg);

    const displayContent = `[system-display: ${typeName}开始]`;
    const displayMsg = {
        id: `msg_call_start_vis_${now}`,
        role: 'system',
        content: displayContent,
        parts: [],
        timestamp: now + 1,
        isAiIgnore: true,
        callSessionId: sessionId
    };
    chat.history.push(displayMsg);
    addMessageBubble(displayMsg, currentChatId, currentChatType);

    await saveMessagesToDB([instructionMsg, displayMsg], currentChatId, currentChatType);
    await saveSingleChat(currentChatId, currentChatType);

    _showCallOverlay(type, chat, false);

    chat.callConnected = false;
    await saveSingleChat(currentChatId, currentChatType);
    getAiReply(currentChatId, currentChatType);
}

// ------------------------------------------
// 挂断通话
// ------------------------------------------
async function endCall() {
    const chat = db.characters.find(c => c.id === currentChatId);
    if (!chat || !chat.callMode) return;
    
    // ← 新增：立即中断正在进行的 AI 生成请求
    if (typeof callAbortController !== 'undefined' && callAbortController) {
        callAbortController.abort();
        callAbortController = null;
    }

    const type      = chat.callMode;
    const sessionId = chat.currentCallSessionId;
    const typeName  = type === 'voice' ? '语音通话' : '视频通话';

    if (callTimerInterval) {
        clearInterval(callTimerInterval);
        callTimerInterval = null;
    }

    // ★ 清空通话页 header title（通话结束，#call-connected 即将隐藏）
    const titleEl = document.querySelector('#call-connected .title');
    if (titleEl) titleEl.textContent = '';

    const duration    = callStartTime ? Math.floor((Date.now() - callStartTime) / 1000) : 0;
    const durationStr = _formatCallDuration(duration);
    callStartTime = null;

    const now = Date.now();

    const endInstruction = `[system: ${typeName}已结束，切换回手机聊天模式。恢复使用“${chat.realName}的消息...” 格式]`;
    const instructionMsg = {
        id: `msg_call_end_ins_${now}`,
        role: 'user',
        content: endInstruction,
        parts: [{ type: 'text', text: endInstruction }],
        timestamp: now,
        isHidden: true,
        callSessionId: sessionId
    };
    chat.history.push(instructionMsg);

    const displayContent = `[system-display: ${typeName}结束 · ${durationStr}]`;
    const displayMsg = {
        id: `msg_call_end_vis_${now}`,
        role: 'system',
        content: displayContent,
        parts: [],
        timestamp: now + 1,
        isAiIgnore: true,
        callSessionId: sessionId
    };
    chat.history.push(displayMsg);

    chat.callMode             = null;
    chat.callConnected        = null;
    chat.currentCallSessionId = null;

    await saveMessagesToDB([instructionMsg, displayMsg], currentChatId, currentChatType);
    await saveSingleChat(currentChatId, currentChatType);

    _hideCallOverlay();
    addMessageBubble(displayMsg, currentChatId, currentChatType);
    updateOfflineModeUI(chat.offlineModeEnabled || false);
    const _endedSessionId = sessionId;
    setTimeout(() => {
        if (typeof foldCallSession === 'function') foldCallSession(_endedSessionId);
    }, 80);
}

// ------------------------------------------
// AI 主动挂断通话
// ------------------------------------------
async function aiHangupCall() {
    const chat = db.characters.find(c => c.id === currentChatId);
    if (!chat || !chat.callMode) return;

    // 立即中断正在进行的 AI 生成请求（停止后续的废话）
    if (typeof callAbortController !== 'undefined' && callAbortController) {
        callAbortController.abort();
        callAbortController = null;
    }

    const type      = chat.callMode;
    const sessionId = chat.currentCallSessionId;
    const typeName  = type === 'voice' ? '语音通话' : '视频通话';

    if (callTimerInterval) {
        clearInterval(callTimerInterval);
        callTimerInterval = null;
    }

    const titleEl = document.querySelector('#call-connected .title');
    if (titleEl) titleEl.textContent = '';

    const duration    = callStartTime ? Math.floor((Date.now() - callStartTime) / 1000) : 0;
    const durationStr = _formatCallDuration(duration);
    callStartTime = null;

    const now = Date.now();

    // 通知 AI 切换回文字模式
    const endInstruction = `[system: ${chat.realName}主动挂断了${typeName}，切换回手机聊天模式。恢复使用“${chat.realName}的消息...” 格式]`;
    const instructionMsg = {
        id: `msg_call_end_ins_${now}`,
        role: 'user',
        content: endInstruction,
        parts: [{ type: 'text', text: endInstruction }],
        timestamp: now,
        isHidden: true,
        callSessionId: sessionId
    };
    chat.history.push(instructionMsg);

    // 屏幕上显示的提示文本（带时长）
    const displayContent = `[system-display: ${typeName}结束 · ${durationStr}]`;
    const displayMsg = {
        id: `msg_call_end_vis_${now}`,
        role: 'system',
        content: displayContent,
        parts: [],
        timestamp: now + 1,
        isAiIgnore: true,
        callSessionId: sessionId
    };
    chat.history.push(displayMsg);

    chat.callMode             = null;
    chat.callConnected        = null;
    chat.currentCallSessionId = null;

    await saveMessagesToDB([instructionMsg, displayMsg], currentChatId, currentChatType);
    await saveSingleChat(currentChatId, currentChatType);

    _hideCallOverlay();
    addMessageBubble(displayMsg, currentChatId, currentChatType);
    updateOfflineModeUI(chat.offlineModeEnabled || false);
    
    // 触发气泡折叠
    const _endedSessionId = sessionId;
    setTimeout(() => {
        if (typeof foldCallSession === 'function') foldCallSession(_endedSessionId);
    }, 80);
}

// ------------------------------------------
// 来电：AI 主动发起邀请后，显示来电等待屏
// ------------------------------------------
function showIncomingCall(type, chat) {
    if (chat.callMode) return;
    _showCallOverlay(type, chat, true);
}

// ------------------------------------------
// 来电：接听
// ------------------------------------------
async function acceptIncomingCall() {
    if (incomingCallTimeout) { clearTimeout(incomingCallTimeout); incomingCallTimeout = null; }
    const chat = db.characters.find(c => c.id === currentChatId);
    if (!chat) return;

    // 复用邀请时生成的 sessionId，而不是重新生成
    const sessionId = chat.currentCallSessionId || `call_${Date.now()}`;
    chat.currentCallSessionId = sessionId;

    const now = Date.now();

    const instructionContent = chat.callMode === 'voice'
        ? `[system: ${chat.myName}接听了语音通话。场景切换：${chat.realName}和${chat.myName}切换到语音通话模式。]`
        : `[system: ${chat.myName}接听了视频通话。场景切换：${chat.realName}和${chat.myName}切换到视频通话模式。]`;

    const instructionMsg = {
        id: `msg_call_accept_ins_${now}`,
        role: 'user',
        content: instructionContent,
        parts: [{ type: 'text', text: instructionContent }],
        timestamp: now,
        isHidden: true,
        callSessionId: sessionId
    };
    chat.history.push(instructionMsg);
    await saveMessagesToDB([instructionMsg], currentChatId, currentChatType);

    onCallConnected();

    await saveSingleChat(currentChatId, currentChatType);
    getAiReply(currentChatId, currentChatType);
}

// ------------------------------------------
// 来电：拒接
// ------------------------------------------
async function declineIncomingCall() {
    if (incomingCallTimeout) { clearTimeout(incomingCallTimeout); incomingCallTimeout = null; }
    const chat = db.characters.find(c => c.id === currentChatId);
    if (!chat) return;

    const callType = chat.callMode || 'voice';
    const typeName = callType === 'video' ? '视频通话' : '语音通话';

    const sessionId = chat.currentCallSessionId; // 👉 新增：提前保存当前的 sessionId

    chat.callMode             = null;
    chat.currentCallSessionId = null;
    chat.callConnected        = null;

    _hideCallOverlay();

    const now = Date.now();
    const displayContent = `[system-display: 已拒接${typeName}]`;
    const displayMsg = {
        id: `msg_call_decline_vis_${now}`,
        role: 'system',
        content: displayContent,
        parts: [],
        timestamp: now,
        isAiIgnore: true,
        callSessionId: sessionId // 👉 新增
    };
    chat.history.push(displayMsg);
    addMessageBubble(displayMsg, currentChatId, currentChatType);

    const instructionContent = `[system: ${chat.myName}拒绝了${typeName}邀请，请根据角色性格自然地继续对话。]`;
    const instructionMsg = {
        id: `msg_call_decline_ins_${now}`,
        role: 'user',
        content: instructionContent,
        parts: [{ type: 'text', text: instructionContent }],
        timestamp: now + 1,
        isHidden: true,
        callSessionId: sessionId // 👉 新增
    };
    chat.history.push(instructionMsg);

    await saveMessagesToDB([displayMsg, instructionMsg], currentChatId, currentChatType);
    await saveSingleChat(currentChatId, currentChatType);

    // 拒接后立刻触发界面折叠
    setTimeout(() => {
        if (typeof foldCallSession === 'function' && sessionId) foldCallSession(sessionId);
    }, 80);
}

// ------------------------------------------
// appendCallDialogue：第一条消息到来时自动接通
// ------------------------------------------
function appendCallDialogue(text) {
    const chat = db.characters.find(c => c.id === currentChatId);
    if (chat && !chat.callConnected) {
        onCallConnected();
    }

    const inner = document.getElementById('call-dialogue-inner');
    if (!inner) return;

    const loading = inner.querySelector('.call-dialogue-loading');
    if (loading) {
        loading.remove();
        // ✅ 新增：文字出现时恢复气泡外壳
        document.getElementById('call-dialogue-area')?.classList.remove('loading-state');
    }

    const line = document.createElement('div');
    line.className = 'call-dialogue-line';
    line.textContent = text;
    inner.appendChild(line);

    requestAnimationFrame(() => { inner.scrollTop = inner.scrollHeight; });
    setTimeout(() => { inner.scrollTop = inner.scrollHeight; }, 50);
}

// ------------------------------------------
// 每次 AI 开始回复前清空对话区
// ------------------------------------------
function clearCallDialogue() {
    const inner = document.getElementById('call-dialogue-inner');
    if (!inner) return;
    inner.innerHTML = '';
    // ✅ 新增：loading 时隐藏气泡外壳
    document.getElementById('call-dialogue-area')?.classList.add('loading-state');
    
    const loading = document.createElement('div');
    loading.className = 'call-dialogue-loading';
    for (let i = 0; i < 15; i++) loading.appendChild(document.createElement('span'));
    inner.appendChild(loading);
}

// ------------------------------------------
// 旁白（视频通话）
// ------------------------------------------
function appendCallNarration(text) {
    const chat = db.characters.find(c => c.id === currentChatId);
    if (chat && !chat.callConnected) onCallConnected();

    const area = document.getElementById('call-narration-area');
    if (!area) return;

    // ★ 确保前后 spacer 存在并更新高度，使新行能 scroll 到视觉中间
    _ensureNarrationSpacers(area);

    const line = document.createElement('p');
    line.className = 'call-narration-line';
    line.textContent = text;

    // 插在 bottom spacer 之前
    const botSpacer = area.querySelector('.narration-spacer-bottom');
    area.insertBefore(line, botSpacer);

    // 激活最新一行并滚动使其居中
    _setNarrationActive(area, line);
}

// ★ 确保旁白区前后有 spacer，并将其高度设为容器一半
//   这样第一条消息 append 后 scroll 居中时，正好落在视觉正中间
function _ensureNarrationSpacers(area) {
    let topSpacer = area.querySelector('.narration-spacer-top');
    let botSpacer = area.querySelector('.narration-spacer-bottom');

    if (!topSpacer) {
        topSpacer = document.createElement('div');
        topSpacer.className = 'narration-spacer-top';
        area.insertBefore(topSpacer, area.firstChild);
    }
    if (!botSpacer) {
        botSpacer = document.createElement('div');
        botSpacer.className = 'narration-spacer-bottom';
        area.appendChild(botSpacer);
    }

    // 每次 append 时都更新一次，以防容器尺寸变化
    const half = area.clientHeight / 2;
    topSpacer.style.height = half + 'px';
    botSpacer.style.height = half + 'px';
}

// 激活指定旁白行，其余暗淡，慢速 eased 滚动使其垂直居中于容器
function _setNarrationActive(area, activeLine) {
    area.querySelectorAll('.call-narration-line')
        .forEach(l => l.classList.remove('active'));
    activeLine.classList.add('active');

    requestAnimationFrame(() => {
        const lineCenter = activeLine.offsetTop + activeLine.offsetHeight / 2;
        const areaHalf  = area.clientHeight / 1.5;  // 控制新消息出现位置，数值越小，基准点越靠下，新消息出现越靠下。
        _smoothScrollNarration(area, lineCenter - areaHalf, 950);
    });
}

// 旁白区自定义慢速平滑滚动（比原生 smooth 慢）
function _smoothScrollNarration(area, target, duration) {
    const start = area.scrollTop;
    const dist  = target - start;
    if (Math.abs(dist) < 1) return;
    const t0 = performance.now();
    function step(now) {
        const p = Math.min((now - t0) / duration, 1);
        // ease-in-out cubic
        const eased = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
        area.scrollTop = start + dist * eased;
        if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}

// 用户手动滚动时，找到最靠近容器中心的行并高亮
function _onNarrationScroll(area) {
    const lines = area.querySelectorAll('.call-narration-line');
    if (!lines.length) return;
    const center = area.scrollTop + area.clientHeight / 1.5; // 控制滚动识别位置，数值越小，基准点越靠下，识别越靠下。
    let closest = null, minDist = Infinity;
    lines.forEach(line => {
        const lc   = line.offsetTop + line.offsetHeight / 2;
        const dist = Math.abs(lc - center);
        if (dist < minDist) { minDist = dist; closest = line; }
    });
    lines.forEach(l => l.classList.remove('active'));
    if (closest) closest.classList.add('active');
}

// ------------------------------------------
// 用户发送内容气泡
// ------------------------------------------
function appendCallUserMessage(text) {
    const area = document.getElementById('call-user-area');
    if (!area) return;

    const line = document.createElement('div');
    line.className = 'call-user-line';
    line.textContent = text;
    area.appendChild(line);
    area.scrollTop = area.scrollHeight;
}

// ------------------------------------------
// AI 回复完成后清空用户气泡
// ------------------------------------------
function clearCallUserArea() {
    const area = document.getElementById('call-user-area');
    if (area) area.innerHTML = '';
}

// ------------------------------------------
// 通话历史侧边栏
// ------------------------------------------
function openCallHistory() {
    const chat = db.characters.find(c => c.id === currentChatId);
    if (!chat) return;

    const sessionId = chat.currentCallSessionId;
    if (!sessionId) return;

    const panel = document.getElementById('call-history-panel');
    const list  = document.getElementById('call-history-list');
    if (!panel || !list) return;

    const callMsgs = chat.history.filter(m =>
        m.callSessionId === sessionId &&
        !m.isHidden &&
        !m.isAiIgnore
    );

    list.innerHTML = '';
    callMsgs.forEach(m => {
        const item = document.createElement('div');
        item.className = 'call-history-item';

        let label = '';
        let text  = m.content;

        if (m.role === 'user') {
            label = '用户';
            const match = m.content.match(/\[.*?的消息：([\s\S]+?)\]$/);
            text = match ? match[1] : m.content;
        } else if (m.role === 'assistant') {
            label = chat.remarkName || chat.realName;
            const dialogueMatch  = m.content.match(/\[.*?的消息：([\s\S]+?)\]$/);
            const narrationMatch = m.content.match(/^\[system-narration:([\s\S]+?)\]$/);
            if (dialogueMatch) {
                text = dialogueMatch[1];
            } else if (narrationMatch) {
                label = '旁白';
                text  = narrationMatch[1];
            } else {
                return;
            }
        } else {
            return;
        }

        // 根据角色决定颜色类
        let labelCls, textCls;
        if (label === '旁白') {
            labelCls = 'call-history-label call-history-label--narration';
            textCls  = 'call-history-text call-history-text--narration';
        } else if (label === '用户') {
            labelCls = 'call-history-label call-history-label--user';
            textCls  = 'call-history-text call-history-text--user';
        } else {
            labelCls = 'call-history-label call-history-label--ai';
            textCls  = 'call-history-text call-history-text--ai';
        }

        item.innerHTML = `<span class="${labelCls}">${label}</span><span class="${textCls}">${text}</span>`;
        list.appendChild(item);
    });

    panel.classList.add('visible');
    setTimeout(() => { list.scrollTop = list.scrollHeight; }, 50);
}

function closeCallHistory() {
    document.getElementById('call-history-panel')?.classList.remove('visible');
}

function _showCallOverlay(callMode, chat, isIncoming = false) {
    const overlay = document.getElementById('call-overlay');
    if (!overlay) return;

    if (isIncoming) chat.callMode = callMode;

    // 等待屏背景模糊
    const bgBlur = document.getElementById('call-bg-blur');
    if (bgBlur) {
        if (chat.avatar) {
            bgBlur.style.backgroundImage = `url('${chat.avatar}')`;
            bgBlur.style.display = 'block';
        } else {
            bgBlur.style.display = 'none';
        }
    }

    // 等待屏姓名
    const waitingName = document.getElementById('call-waiting-name');
    if (waitingName) waitingName.textContent = chat.remarkName || chat.realName;

    _setWaitingScreenMode(isIncoming);

    // 来电 60 秒无人接听 → 自动提示"用户未接听"
    if (incomingCallTimeout) clearTimeout(incomingCallTimeout);
    if (isIncoming) {
        incomingCallTimeout = setTimeout(_onIncomingCallTimeout, 60000);
    }

    // 接通屏：头像 / 姓名
    const avatarImg = document.getElementById('call-avatar-img');
    if (avatarImg) avatarImg.src = chat.avatar || '';
    const charName = document.getElementById('call-char-name');
    if (charName) charName.textContent = chat.remarkName || chat.realName;

    // 旁白区：语音时 hidden，视频时展开
    const narrationArea = document.getElementById('call-narration-area');
    if (narrationArea) {
        narrationArea.classList.toggle('hidden', callMode !== 'video');
        // 清空旁白区（含 spacer）
        narrationArea.innerHTML = '';
    }

    // video-mode class 控制布局
    overlay.classList.toggle('video-mode', callMode === 'video');

    _updateSwitchBtnIcon(callMode);

    // 清空气泡区
    document.getElementById('call-dialogue-inner').innerHTML = '';
    document.getElementById('call-user-area').innerHTML      = '';
    document.getElementById('call-timer').textContent        = '00:00';

    // ★ 重置通话页 header title
    const titleEl = document.querySelector('#call-connected .title');
    if (titleEl) titleEl.textContent = '';

    overlay.classList.remove('input-mode-active');

    const waiting   = document.getElementById('call-waiting');
    const connected = document.getElementById('call-connected');
    if (connected) connected.classList.remove('show-anim');
    if (waiting)   waiting.style.display   = 'block';
    if (connected) connected.style.display = 'none';

    overlay.style.display = 'block';
    const wrapper = document.querySelector('.chat-input-wrapper');
    if (wrapper) wrapper.style.display = 'none';
}

// ------------------------------------------
// 来电：60 秒无人接听 → 提示"用户未接听"
// ------------------------------------------
async function _onIncomingCallTimeout() {
    incomingCallTimeout = null;
    const chat = db.characters.find(c => c.id === currentChatId);
    if (!chat || chat.callConnected) return;   // 已接听则忽略

    const callType = chat.callMode || 'voice';
    const typeName = callType === 'video' ? '视频通话' : '语音通话';

    const sessionId = chat.currentCallSessionId; // 👉 新增

    chat.callMode             = null;
    chat.currentCallSessionId = null;
    chat.callConnected        = null;

    _hideCallOverlay();

    const now = Date.now();
    const displayContent = `[system-display: ${typeName}未接听]`;
    const displayMsg = {
        id: `msg_call_noanswer_${now}`,
        role: 'system',
        content: displayContent,
        parts: [],
        timestamp: now,
        isAiIgnore: true,
        callSessionId: sessionId // 👉 新增
    };
    chat.history.push(displayMsg);
    addMessageBubble(displayMsg, currentChatId, currentChatType);
    await saveMessagesToDB([displayMsg], currentChatId, currentChatType);
    await saveSingleChat(currentChatId, currentChatType);

    // 超时未接后立刻触发界面折叠
    setTimeout(() => {
        if (typeof foldCallSession === 'function' && sessionId) foldCallSession(sessionId);
    }, 80);
}

// ------------------------------------------
// 主动拨出：AI 生成失败 → 提示"AI未接听"
// ------------------------------------------
async function endCallAiFailure() {
    const chat = db.characters.find(c => c.id === currentChatId);
    if (!chat || !chat.callMode) return;

    const type      = chat.callMode;
    const sessionId = chat.currentCallSessionId;
    const typeName  = type === 'voice' ? '语音通话' : '视频通话';

    chat.callMode             = null;
    chat.callConnected        = null;
    chat.currentCallSessionId = null;

    _hideCallOverlay();

    const now = Date.now();
    const displayContent = `[system-display: ${typeName}未接听]`;
    const displayMsg = {
        id: `msg_call_aifail_${now}`,
        role: 'system',
        content: displayContent,
        parts: [],
        timestamp: now,
        isAiIgnore: true,
        callSessionId: sessionId
    };
    chat.history.push(displayMsg);
    addMessageBubble(displayMsg, currentChatId, currentChatType);
    await saveMessagesToDB([displayMsg], currentChatId, currentChatType);
    await saveSingleChat(currentChatId, currentChatType);
}

// ------------------------------------------
// 切换等待屏的按钮模式
// ------------------------------------------
function _setWaitingScreenMode(isIncoming) {
    const statusEl     = document.getElementById('call-waiting-status');
    const endWrap      = document.getElementById('call-waiting-end-wrap');
    const incomingBtns = document.getElementById('incoming-call-btns');

    if (statusEl)     statusEl.textContent      = isIncoming ? '邀请你通话' : '等待对方接听';
    if (endWrap)      endWrap.style.display      = isIncoming ? 'none' : 'flex';
    if (incomingBtns) incomingBtns.style.display = isIncoming ? 'flex' : 'none';
}

// ------------------------------------------
// AI 接通后切换到接通屏
// ------------------------------------------
function onCallConnected() {
    const chat = db.characters.find(c => c.id === currentChatId);
    if (!chat || chat.callConnected) return;
    chat.callConnected = true;

    // ★ 新增：接通屏背景图（头像模糊背景）
    const connectedBg = document.getElementById('call-connected-bg');
    if (connectedBg) {
        connectedBg.style.backgroundImage = chat.avatar ? `url('${chat.avatar}')` : 'none';
    }
    
    // ★ 写入通话页 app-header 的 .title，开始显示计时
    const titleEl = document.querySelector('#call-connected .title');
    if (titleEl) titleEl.textContent = '00:00';

    callStartTime     = Date.now();
    callTimerInterval = setInterval(_updateCallTimer, 1000);

    const waiting   = document.getElementById('call-waiting');
    const connected = document.getElementById('call-connected');

    if (waiting)   waiting.style.display = 'none';
    if (connected) {
        connected.style.display = 'block';
        setTimeout(() => connected.classList.add('show-anim'), 50);
    }
}

// ------------------------------------------
// 隐藏通话界面
// ------------------------------------------
function _hideCallOverlay() {
    const overlay = document.getElementById('call-overlay');
    if (!overlay) return;

    overlay.style.display = 'none';
    overlay.classList.remove('input-mode-active');
    overlay.classList.remove('video-mode');

    const connected = document.getElementById('call-connected');
    if (connected) connected.classList.remove('show-anim');

    const wrapper = document.querySelector('.chat-input-wrapper');
    if (wrapper) wrapper.style.display = '';

    closeCallHistory();
}

// ------------------------------------------
// 切换输入栏展开 / 收起
// ------------------------------------------
function _toggleCallInput(show) {
    const overlay = document.getElementById('call-overlay');
    if (!overlay) return;

    if (show) {
        overlay.classList.add('input-mode-active');
        setTimeout(() => {
            document.getElementById('call-message-input')?.focus();
        }, 150);
    } else {
        overlay.classList.remove('input-mode-active');
        document.getElementById('call-message-input')?.blur();
    }
}

// ------------------------------------------
// 意外中断恢复
// ------------------------------------------
async function recoverInterruptedCall(chat) {
    if (!chat || !chat.callMode) return;

    const sessionId = chat.currentCallSessionId;
    const typeName  = chat.callMode === 'voice' ? '语音通话' : '视频通话';
    const now       = Date.now();

    const endInstruction = `[system: ${typeName}已意外中断，切换回手机聊天模式。请恢复使用“${chat.realName}的消息…”格式。]`;
    const instructionMsg = {
        id: `msg_call_interrupt_ins_${now}`,
        role: 'user',
        content: endInstruction,
        parts: [{ type: 'text', text: endInstruction }],
        timestamp: now,
        isHidden: true,
        callSessionId: sessionId
    };

    const startMarker = chat.history.find(
    m => m.callSessionId === sessionId &&
    (m.id?.includes('_start_vis_') || m.id?.includes('_accept_ins_')));
    const interruptDuration = startMarker
        ? Math.floor((now - startMarker.timestamp) / 1000)
        : 0;
    const interruptDurStr = interruptDuration > 0
        ? ` · ${_formatCallDuration(interruptDuration)}`
        : '';
    const displayContent = `[system-display: ${typeName}中断${interruptDurStr}]`;
    const displayMsg = {
        id: `msg_call_interrupt_vis_${now}`,
        role: 'system',
        content: displayContent,
        parts: [],
        timestamp: now + 1,
        isAiIgnore: true,
        callSessionId: sessionId
    };

    chat.history.push(instructionMsg);
    chat.history.push(displayMsg);
    chat.callMode             = null;
    chat.currentCallSessionId = null;
    chat.callConnected        = null;

    await saveMessagesToDB([instructionMsg, displayMsg], chat.id, 'private');
    await saveSingleChat(chat.id, 'private');
    addMessageBubble(displayMsg, chat.id, 'private');
    const _interruptedSessionId = sessionId;
    setTimeout(() => {
        if (typeof foldCallSession === 'function') foldCallSession(_interruptedSessionId);
    }, 80);
}

// ------------------------------------------
// 更新切换按钮图标
// ------------------------------------------
function _updateSwitchBtnIcon(mode) {
    const btn = document.getElementById('call-switch-btn');
    if (!btn) return;

    if (mode === 'video') {
        btn.title = '切换为语音通话';
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M21.15 6.17C20.74 5.95 19.88 5.72 18.71 6.54L17.24 7.58C17.13 4.47 15.78 3.25 12.5 3.25H6.5C3.08 3.25 1.75 4.58 1.75 8V16C1.75 18.3 3 20.75 6.5 20.75H12.5C15.78 20.75 17.13 19.53 17.24 16.42L18.71 17.46C19.33 17.9 19.87 18.04 20.3 18.04C20.67 18.04 20.96 17.93 21.15 17.83C21.56 17.62 22.25 17.05 22.25 15.62V8.38C22.25 6.95 21.56 6.38 21.15 6.17ZM11 11.38C9.97 11.38 9.12 10.54 9.12 9.5C9.12 8.46 9.97 7.62 11 7.62C12.03 7.62 12.88 8.46 12.88 9.5C12.88 10.54 12.03 11.38 11 11.38Z" fill="currentColor"/>
</svg>`;
    } else {
        btn.title = '切换为视频通话';
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path opacity="0.4" d="M17.7405 7.57031C17.7505 7.64031 17.7505 7.72031 17.7405 7.79031C17.7405 7.72031 17.7305 7.65031 17.7305 7.58031L17.7405 7.57031Z" fill="currentColor"/>
<path d="M17.2789 6.56L3.82891 20.01C2.42891 19.12 1.87891 17.53 1.87891 16V8C1.87891 4.58 3.20891 3.25 6.62891 3.25H12.6289C15.5189 3.25 16.9089 4.2 17.2789 6.56Z" fill="currentColor"/>
<path d="M21.4 2.22891C21.1 1.92891 20.61 1.92891 20.31 2.22891L1.85 20.6889C1.55 20.9889 1.55 21.4789 1.85 21.7789C2 21.9189 2.2 21.9989 2.39 21.9989C2.59 21.9989 2.78 21.9189 2.93 21.7689L21.4 3.30891C21.7 3.00891 21.7 2.52891 21.4 2.22891Z" fill="currentColor"/>
<path d="M22.3802 8.38047V15.6205C22.3802 17.0505 21.6802 17.6205 21.2802 17.8305C21.0902 17.9305 20.7902 18.0405 20.4202 18.0405C19.9902 18.0405 19.4602 17.9005 18.8402 17.4605L17.3602 16.4205C17.2902 18.6305 16.5902 19.8905 15.0002 20.4205C14.3602 20.6505 13.5702 20.7505 12.6202 20.7505H6.62016C6.38016 20.7505 6.15016 20.7405 5.91016 20.7105L15.0002 11.6305L20.6502 5.98047C20.9102 6.00047 21.1202 6.08047 21.2802 6.17047C21.6802 6.38047 22.3802 6.95047 22.3802 8.38047Z" fill="currentColor"/>
</svg>`;
    }
}

// ------------------------------------------
// 切换视频 ↔ 语音通话模式
// ------------------------------------------
async function _switchCallMode() {
    const chat = db.characters.find(c => c.id === currentChatId);
    if (!chat || !chat.callConnected) return;

    const newMode     = chat.callMode === 'video' ? 'voice' : 'video';
    const newTypeName = newMode === 'voice' ? '语音通话' : '视频通话';
    chat.callMode = newMode;

    const narrationArea = document.getElementById('call-narration-area');
    if (narrationArea) narrationArea.classList.toggle('hidden', newMode !== 'video');

    document.getElementById('call-overlay')
        ?.classList.toggle('video-mode', newMode === 'video');

    _updateSwitchBtnIcon(newMode);

    const now            = Date.now();
    const sessionId      = chat.currentCallSessionId;
    const instructionContent = `[system: 已切换为${newTypeName}。请按${newTypeName}模式继续回复。]`;
    const instructionMsg = {
        id: `msg_call_switch_${now}`,
        role: 'user',
        content: instructionContent,
        parts: [{ type: 'text', text: instructionContent }],
        timestamp: now,
        isHidden: true,
        callSessionId: sessionId
    };
    chat.history.push(instructionMsg);

    await saveMessagesToDB([instructionMsg], currentChatId, currentChatType);
    await saveSingleChat(currentChatId, currentChatType);

    showToast(`已切换为${newTypeName}`);
}

// ------------------------------------------
// 计时器：每秒写入通话页 app-header 的 .title
// ------------------------------------------
function _updateCallTimer() {
    if (!callStartTime) return;
    const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
    // ★ 精确定位：通话接通屏里的 .title，不影响任何其他页面的 header
    const titleEl = document.querySelector('#call-connected .title');
    if (titleEl) titleEl.textContent = _formatCallDuration(elapsed);
}

function _formatCallDuration(seconds) {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

// ------------------------------------------
// 初始化：在 setupChatRoom() 末尾调用
// ------------------------------------------
function initCallFeature() {
    document.getElementById('video-call-btn')
        ?.addEventListener('click', openCallTypeMenu);

    document.getElementById('start-voice-call-btn')
        ?.addEventListener('click', () => startCall('voice'));

    document.getElementById('start-video-call-btn')
        ?.addEventListener('click', () => startCall('video'));

    document.getElementById('cancel-call-type-btn')
        ?.addEventListener('click', () => {
            document.getElementById('call-type-actionsheet').classList.remove('visible');
        });

    document.getElementById('call-type-actionsheet')
        ?.addEventListener('click', (e) => {
            if (e.target === document.getElementById('call-type-actionsheet'))
                document.getElementById('call-type-actionsheet').classList.remove('visible');
        });

    document.getElementById('call-end-btn-waiting')?.addEventListener('click', endCall);
    document.getElementById('call-end-btn')?.addEventListener('click', endCall);

    document.getElementById('incoming-call-accept-btn')?.addEventListener('click', acceptIncomingCall);
    document.getElementById('incoming-call-decline-btn')?.addEventListener('click', declineIncomingCall);

    document.getElementById('call-history-btn')?.addEventListener('click', openCallHistory);
    document.getElementById('call-history-close-btn')?.addEventListener('click', closeCallHistory);

    document.getElementById('call-mic-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof isGenerating !== 'undefined' && isGenerating) {
            showToast('等待对方发言…');
            return;
        }
        _toggleCallInput(true);
    });

    document.getElementById('call-switch-btn')?.addEventListener('click', () => {
        if (typeof isGenerating !== 'undefined' && isGenerating) {
            showToast('等待对方发言…');
            return;
        }
        _switchCallMode();
    });

    document.getElementById('call-overlay')?.addEventListener('click', (e) => {
        const overlay  = document.getElementById('call-overlay');
        const inputBar = document.getElementById('call-input-bar');
        if (overlay?.classList.contains('input-mode-active')) {
            if (!inputBar.contains(e.target) && !e.target.closest('#call-mic-btn')) {
                _toggleCallInput(false);
            }
        }
    });

    const callInput = document.getElementById('call-message-input');

const callSendBtn = document.getElementById('call-send-btn');
callSendBtn?.addEventListener('touchend', (e) => {
    e.preventDefault();                                  // 阻止 touch → click 的 blur
    const val = callInput?.value.trim();
    if (!val) return;
    document.getElementById('message-input').value = val;
    callInput.value = '';
    sendMessage();
    setTimeout(() => callInput?.focus(), 50);            // 回还焦点
});
callSendBtn?.addEventListener('click', () => {           // PC 端兜底
    const val = callInput?.value.trim();
    if (!val) return;
    document.getElementById('message-input').value = val;
    callInput.value = '';
    sendMessage();
});

    document.getElementById('call-ai-reply-btn')?.addEventListener('click', () => {
        _toggleCallInput(false);
        clearCallUserArea();
        getAiReply(currentChatId, currentChatType);
    });

    callInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') document.getElementById('call-send-btn')?.click();
    });

    // ★ 旁白区滚动追踪：手动滚动时高亮最近中心的那条
    const narrationArea = document.getElementById('call-narration-area');
    narrationArea?.addEventListener('scroll', () => _onNarrationScroll(narrationArea), { passive: true });
}
