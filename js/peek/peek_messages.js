// ==========================================
// peek_messages.js
// 私信列表、对话详情、消息生成
// ==========================================

function renderPeekChatList(conversations =[], isAppend = false, resetPage = false) {
    if (resetPage) PeekPager.reset('messages');

    const container = document.getElementById('peek-chat-list-container');
    if (!isAppend) container.innerHTML = '';

    if (!conversations || conversations.length === 0) return;

    const isEdit = PeekDeleteManager.isEditMode && PeekDeleteManager.currentAppType === 'messages';

    // 分页：追加时只渲染当前页，全量重绘渲染第0页到当前页
    const dataToRender = PeekPager.slice('messages', conversations, isAppend);

    dataToRender.forEach((convo) => {
        if (!convo.id) convo.id = 'msg_old_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        const isSelected = isEdit && PeekDeleteManager.selectedIds.has(convo.id);

        const history = convo.history || [];
        const lastMessage =[...history].reverse().find(m => m.type !== 'time-divider') || null;
        const lastMessageText = lastMessage ? (lastMessage.content || '').replace(/\[.*?的消息：([\s\S]+)\]/, '$1') : '...';

        // 提取最新时间：如果有更新时间戳则直接格式化，否则向后寻找最近的时间分割线
        let timeStr = '';
        if (convo.lastUpdated) {
            timeStr = typeof formatSmartTime === 'function' ? formatSmartTime(convo.lastUpdated) : new Date(convo.lastUpdated).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        } else {
            const lastDiv = [...history].reverse().find(m => m.content === '[time-divider]' && m.timestamp);
            if (lastDiv) timeStr = typeof formatSmartTime === 'function' ? formatSmartTime(lastDiv.timestamp) : '';
        }

        const li = document.createElement('li');
        li.className = `list-item chat-item ${isEdit ? 'is-selecting' : ''} ${isSelected ? 'selected' : ''}`;
        li.dataset.name = convo.partnerName;
        li.dataset.id = convo.id;

        const avatarUrl = 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg';
        
        // 屏蔽标记图标
        const hiddenIcon = convo.isHidden ? 
            `<svg class="hidden-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>` : '';

        li.innerHTML = `
            <img src="${avatarUrl}" alt="${convo.partnerName}" class="chat-avatar">
            <div class="item-details">
                <div class="item-details-row">
                    <div class="item-name">${convo.partnerName} ${convo.isNew ? '<span class="new-badge">new!</span>' : ''}</div>
                    <div class="item-time">${timeStr}</div>
                </div>
                <div class="item-preview-wrapper">
                    <div class="item-preview">${lastMessageText}</div>
                    ${hiddenIcon}
                </div>
            </div>`;
        container.appendChild(li);
    });

    // 底部"上滑加载更多"提示
    PeekPager.updateTip(container.parentElement, 'messages', conversations.length, 'peek-msglist-loading-tip');
}

// ==========================================
// 对话详情：向上翻页加载（聊天式）
// 默认只渲染最近 CONVO_PAGE_SIZE 条，滚动到顶部时向上补一页历史
// ==========================================
const PEEK_CONVO_PAGE_SIZE = 30;
let _peekConvoRenderedStart = 0;   // 当前已渲染区间的起始下标
let _peekConvoPartnerName = null;  // 当前详情页对应的联系人（防旧监听误触发）

function _buildPeekMessageEl(msg, isEdit) {
    if (!msg.id) msg.id = 'msg_item_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    const isSelected = isEdit && PeekDeleteManager.selectedIds.has(msg.id);
    const editClasses = `message-item-wrapper ${isEdit ? 'is-selecting' : ''} ${isSelected ? 'selected' : ''}`;

    // ── 时间分隔符 ────────────────────────────────────────────────
    if (msg.content === '[time-divider]') {
        const dividerWrapper = document.createElement('div');
        dividerWrapper.className = `message-wrapper time-divider-wrapper ${editClasses}`;
        dividerWrapper.dataset.id = msg.id;
        const label = (typeof formatSmartTime === 'function' && msg.timestamp)
            ? formatSmartTime(msg.timestamp) : (msg.label || '');
        dividerWrapper.innerHTML = `<div class="chat-time-divider">${label}</div>`;
        return dividerWrapper;
    }

    // ── 普通消息气泡 ─────────────────────────────────────────────────
    const isSentByChar = msg.sender === 'char';
    const wrapper = document.createElement('div');
    wrapper.className = `message-wrapper ${isSentByChar ? 'sent' : 'received'} ${editClasses}`;
    wrapper.dataset.id = msg.id;

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
    return wrapper;
}

// 向上补一页更早的历史消息（保持滚动位置不跳动）
function _loadOlderPeekMessages() {
    if (_peekConvoRenderedStart <= 0 || !_peekConvoPartnerName) return;
    const convo = peekContentCache?.messages?.conversations?.find(c => c.partnerName === _peekConvoPartnerName);
    if (!convo) return;

    const messageAreaEl = document.getElementById('peek-message-area');
    const contentContainer = messageAreaEl.closest('.content');
    const isEdit = PeekDeleteManager.isEditMode && PeekDeleteManager.currentAppType === 'conversation';

    const newStart = Math.max(0, _peekConvoRenderedStart - PEEK_CONVO_PAGE_SIZE);
    const olderChunk = convo.history.slice(newStart, _peekConvoRenderedStart);
    _peekConvoRenderedStart = newStart;

    // 记录补页前高度，插入后原地回补 scrollTop，视觉上不跳动
    // （实际滚动容器可能是 .content 或 .message-area，两个都补偿）
    const prevAreaHeight = messageAreaEl.scrollHeight;
    const prevContentHeight = contentContainer ? contentContainer.scrollHeight : 0;
    const frag = document.createDocumentFragment();
    olderChunk.forEach(msg => frag.appendChild(_buildPeekMessageEl(msg, isEdit)));
    messageAreaEl.insertBefore(frag, messageAreaEl.firstChild);
    messageAreaEl.scrollTop += (messageAreaEl.scrollHeight - prevAreaHeight);
    if (contentContainer) {
        contentContainer.scrollTop += (contentContainer.scrollHeight - prevContentHeight);
    }

    _updatePeekConvoTopTip();
}

function _updatePeekConvoTopTip() {
    const messageAreaEl = document.getElementById('peek-message-area');
    if (!messageAreaEl) return;
    let tip = document.getElementById('peek-convo-history-tip');
    if (_peekConvoRenderedStart > 0) {
        if (!tip || !messageAreaEl.contains(tip)) {
            tip = document.createElement('div');
            tip.id = 'peek-convo-history-tip';
            tip.className = 'memo-loading-tip';
            tip.textContent = '下拉加载更早的消息...';
        }
        messageAreaEl.insertBefore(tip, messageAreaEl.firstChild);
        tip.style.display = 'block';
    } else if (tip) {
        tip.style.display = 'none';
    }
}

function renderPeekConversation(history, partnerName, wasNew = false) {
    const titleEl = document.getElementById('peek-conversation-title');
    const messageAreaEl = document.getElementById('peek-message-area');

    titleEl.textContent = partnerName;
    messageAreaEl.innerHTML = '';
    messageAreaEl.scrollTop = 0;

    // 先存下上一个联系人再切换：空对话会提前 return，放在这里保证状态始终正确
    const prevPartnerName = _peekConvoPartnerName;
    _peekConvoPartnerName = partnerName;

    // 整页重绘了，正在逐条放消息的动画必须作废，否则会重复追加
    _peekConvoRevealToken++;

    // ── 屏蔽/取消屏蔽 按钮逻辑 (保留你原有的功能) ─────────────────
    const convo = peekContentCache?.messages?.conversations?.find(c => c.partnerName === partnerName);
    const actionBtn = document.getElementById('peek-conversation-action-btn');

    // ── 继续推演按钮：能定位到对话且非多选模式时才露出，并同步生成中的禁用态 ──
    // （多选模式下 PeekDeleteManager 只管第一个 action-btn，这个按钮得自己收起来）
    const continueBtn = document.getElementById('peek-conversation-continue-btn');
    if (continueBtn) {
        const inEditMode = PeekDeleteManager.isEditMode && PeekDeleteManager.currentAppType === 'conversation';
        continueBtn.style.visibility = (convo && !inEditMode) ? 'visible' : 'hidden';
    }
    _syncPeekContinueUI(partnerName);

    if (actionBtn && convo) {
        actionBtn.style.visibility = 'visible';
        const renderActionBtnSVG = () => {
            if (convo.isHidden) {
                actionBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;
            } else {
                actionBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
            }
        };

        renderActionBtnSVG();
        actionBtn.onclick = async () => {
            convo.isHidden = !convo.isHidden;
            renderActionBtnSVG();
            await savePeekData(window.activePeekCharId).catch(e => console.error(e));
            if (typeof showToast === 'function') showToast(convo.isHidden ? '已屏蔽该聊天' : '已取消屏蔽');
            renderPeekChatList(peekContentCache.messages.conversations);
        };
    } else if (actionBtn) {
        actionBtn.style.visibility = 'hidden';
    }

    if (!history || history.length === 0) {
        _peekConvoRenderedStart = 0;
        messageAreaEl.innerHTML = '<p class="placeholder-text">这里空空如也...</p>';
        return;
    }

    const isEdit = PeekDeleteManager.isEditMode && PeekDeleteManager.currentAppType === 'conversation';

    // 用于记录我们需要滚动到的“未读边界”DOM节点
    let unreadBoundaryEl = null;

    // ── 分页：默认只渲染最近一页，更早的历史滚动到顶部时再补 ──
    let startIndex = Math.max(0, history.length - PEEK_CONVO_PAGE_SIZE);

    // 编辑模式进入/退出触发的同会话重绘要保持已渲染区间不变，
    // 避免丢失已向上加载的历史（exitMode 重绘时 isEditMode 已复位，故用 currentAppType 判断）
    const isEditRerender = isEdit || PeekDeleteManager.currentAppType === 'conversation';
    if (isEditRerender && prevPartnerName === partnerName && _peekConvoRenderedStart < startIndex) {
        startIndex = _peekConvoRenderedStart;
    }

    // 如果存在未读边界且落在首屏之外，扩展渲染区间以包含它（保证能定位到未读处）
    if (wasNew) {
        const boundaryIdx = history.findIndex(m => m.isUnreadBoundary);
        if (boundaryIdx !== -1 && boundaryIdx < startIndex) {
            startIndex = boundaryIdx;
        }
    }
    _peekConvoRenderedStart = startIndex;

    history.slice(startIndex).forEach(msg => {
        const currentWrapper = _buildPeekMessageEl(msg, isEdit);
        messageAreaEl.appendChild(currentWrapper);

        // 寻找第一个未读边界标记
        if (msg.isUnreadBoundary && wasNew && !unreadBoundaryEl) {
            unreadBoundaryEl = currentWrapper;
        }
    });

    // 顶部"加载更早消息"提示
    _updatePeekConvoTopTip();

    // 抽离滚动逻辑，进行精准定位
    const scrollToTarget = () => {
        // 多选编辑模式下不要自动滚动，以免打断用户选择
        if (PeekDeleteManager.isEditMode) return;

        const contentContainer = messageAreaEl.closest('.content');
        if (wasNew && unreadBoundaryEl) {
            // 偏移量减去20像素作为呼吸空间，确保时间戳完全露出来
            const targetScrollTop = Math.max(0, unreadBoundaryEl.offsetTop - 20);
            if (contentContainer) contentContainer.scrollTop = targetScrollTop;
            messageAreaEl.scrollTop = targetScrollTop;
        } else {
            // 普通打开或者没有未读：常规直接滚到底部
            if (contentContainer) contentContainer.scrollTop = contentContainer.scrollHeight;
            messageAreaEl.scrollTop = messageAreaEl.scrollHeight;
        }
    };

    requestAnimationFrame(scrollToTarget);
    setTimeout(scrollToTarget, 150);

    // 渲染完毕后，清理这些已被读过的未读边界标记，防止下次打开仍卡在中间
    if (wasNew) {
        let needsSave = false;
        history.forEach(m => {
            if (m.isUnreadBoundary) {
                m.isUnreadBoundary = false;
                needsSave = true;
            }
        });
        if (needsSave) {
            savePeekData(window.activePeekCharId).catch(e => console.error(e));
        }
    }
}

// ==========================================
// 解析消息标签文本 → 对话数组（批量生成复用）
// ==========================================
function parsePeekMessagesContent(messagesRawText) {
    const rawItems = (messagesRawText || '').split('===SEP===');
    const parsedConversations = [];
    const now = Date.now();

    rawItems.forEach(rawText => {
        if (!rawText.trim()) return;
        const partnerMatch = rawText.match(/#PARTNER#\s*([\s\S]*?)(?=#HISTORY#|$)/);
        const historyMatch = rawText.match(/#HISTORY#\s*([\s\S]*?)(?=(?:===SEP===|$))/);

        if (partnerMatch && historyMatch) {
            const historyLines = historyMatch[1].trim().split('\n');
            const history = [];
            historyLines.forEach(line => {
                const msgId = `msg_gen_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
                if (line.trim().toLowerCase().startsWith('char:')) {
                    history.push({ id: msgId, sender: 'char', content: line.replace(/^char:\s*/i, '').trim() });
                } else if (line.trim().toLowerCase().startsWith('partner:')) {
                    history.push({ id: msgId, sender: 'partner', content: line.replace(/^partner:\s*/i, '').trim() });
                }
            });

            if (history.length > 0) {
                parsedConversations.push({
                    id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                    partnerName: partnerMatch[1].trim(),
                    history: history,
                    isNew: true,
                    lastUpdated: now
                });
            }
        }
    });

    return parsedConversations;
}

// 把解析好的对话并入缓存：同名联系人追加时间分割线，新联系人置顶（批量生成复用）
function applyPeekMessagesContent(parsedConversations) {
    if (!parsedConversations || parsedConversations.length === 0) return 0;
    if (!peekContentCache['messages']) peekContentCache['messages'] = { conversations: [] };

    const existingConvos = peekContentCache['messages'].conversations;
    const now = Date.now();

    parsedConversations.forEach(newConvo => {
        const existingIdx = existingConvos.findIndex(c => c.partnerName === newConvo.partnerName);
        if (existingIdx !== -1) {
            // 如果对方已经积攒了之前的未读消息没看，就保留最早的边界不覆盖
            const hasUnread = existingConvos[existingIdx].history.some(m => m.isUnreadBoundary);

            const divider = {
                id: `msg_div_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                content: '[time-divider]',
                timestamp: now,
                isUnreadBoundary: !hasUnread // 标记本次新增的时间戳为未读边界起点
            };
            existingConvos[existingIdx].history = [
                ...existingConvos[existingIdx].history,
                divider,
                ...newConvo.history
            ];
            existingConvos[existingIdx].isNew = true;
            existingConvos[existingIdx].lastUpdated = now;
            const [merged] = existingConvos.splice(existingIdx, 1);
            existingConvos.unshift(merged);
        } else {
            // 新联系人，把第一句话作为未读锚定点（如果内容很长，打开刚好看到对话第一句）
            if (newConvo.history && newConvo.history.length > 0) {
                newConvo.history[0].isUnreadBoundary = true;
            }
            existingConvos.unshift(newConvo);
        }
    });

    return parsedConversations.length;
}

// ==========================================
// 继续推演：基于当前打开的这一组对话往下生成后续消息
// 只读本组对话（最多 200 条）+ 主线上下文/世界书，不掺别的 peek 消息，也不生成顺风车
// ==========================================
const PEEK_CONTINUE_CONTEXT_LIMIT = 200;   // 本组对话最多带多少条上文
const _peekConvoGenerating = new Set();    // 正在推演中的 partnerName
let _peekConvoRevealToken = 0;             // 逐条放消息的动画令牌，换会话/重绘即失效

// 逐条放出的节奏相对聊天室打字速度的倍率（1 = 完全一致）
// 旁观别人的对话不用等那么久，这里比聊天室快一点；想完全一致就改成 1
const PEEK_REVEAL_SPEED = 0.6;

// 把"生成中"状态同步到刷新按钮（禁用+旋转）和底部"正在输入"提示
function _syncPeekContinueUI(partnerName) {
    const btn = document.getElementById('peek-conversation-continue-btn');
    const typingEl = document.getElementById('peek-convo-typing');
    const busy = !!partnerName && _peekConvoGenerating.has(partnerName);

    if (btn) {
        btn.disabled = busy;
        btn.classList.toggle('is-spinning', busy);
    }
    if (typingEl) {
        typingEl.textContent = busy ? `"${partnerName}"正在输入中` : '';
        typingEl.classList.toggle('visible', busy);
    }
}

// 解析推演结果：逐行取 char: / partner: 前缀
function parsePeekConversationLines(rawText) {
    const messages = [];
    (rawText || '').split('\n').forEach((line, i) => {
        const m = line.trim().match(/^(char|partner)\s*[:：]\s*(.+)$/i);
        if (!m) return;
        const content = m[2].trim();
        if (!content) return;
        messages.push({
            id: `msg_gen_${Date.now()}_${i}_${Math.random().toString(36).substr(2, 5)}`,
            sender: m[1].toLowerCase() === 'char' ? 'char' : 'partner',
            content
        });
    });
    return messages;
}

// 详情页滚到底部（滚动容器可能是 .content 或 .message-area，两个都推）
function _scrollPeekConvoToBottom() {
    const messageAreaEl = document.getElementById('peek-message-area');
    if (!messageAreaEl) return;
    const doScroll = () => {
        const contentContainer = messageAreaEl.closest('.content');
        if (contentContainer) contentContainer.scrollTop = contentContainer.scrollHeight;
        messageAreaEl.scrollTop = messageAreaEl.scrollHeight;
    };
    requestAnimationFrame(doScroll);
    setTimeout(doScroll, 150);
}

// 详情页此刻是否正停在这段对话上（切走了就别再动 DOM）
function _isPeekConvoOnScreen(partnerName) {
    if (_peekConvoPartnerName !== partnerName) return false;
    const screen = document.getElementById('peek-conversation-screen');
    return !!screen && screen.classList.contains('active');
}

// 把新推演出的消息直接追加到详情页 DOM（不整页重绘，保住已向上加载的历史）
function _appendPeekConvoMessages(partnerName, newMessages) {
    // 用户可能已经切走了：那就只落库，不动 DOM
    if (!_isPeekConvoOnScreen(partnerName)) return;

    const messageAreaEl = document.getElementById('peek-message-area');
    if (!messageAreaEl) return;

    // 原本是空对话的话，先清掉占位文案
    messageAreaEl.querySelector('.placeholder-text')?.remove();

    const isEdit = PeekDeleteManager.isEditMode && PeekDeleteManager.currentAppType === 'conversation';
    const frag = document.createDocumentFragment();
    newMessages.forEach(msg => frag.appendChild(_buildPeekMessageEl(msg, isEdit)));
    messageAreaEl.appendChild(frag);

    _scrollPeekConvoToBottom();
}

// 逐条"打字机"式放出新消息，节奏沿用聊天室的 calculateTypingDelay
// 数据在调用前就已经落库，这里纯粹是播放动画；中途被打断就直接收手
async function _revealPeekConvoMessages(partnerName, newMessages, charName) {
    const token = ++_peekConvoRevealToken;
    const typingEl = document.getElementById('peek-convo-typing');
    let isFirst = true;

    for (const msg of newMessages) {
        // 换了会话 / 页面重绘 / 又点了一次推演，都会让 token 失效
        if (token !== _peekConvoRevealToken || !_isPeekConvoOnScreen(partnerName)) return;

        // "正在输入"跟着下一条消息的说话人走，两边轮流打字更像真的
        if (typingEl) {
            typingEl.textContent = `"${msg.sender === 'char' ? charName : partnerName}"正在输入中`;
            typingEl.classList.add('visible');
        }

        const baseDelay = (typeof calculateTypingDelay === 'function')
            ? calculateTypingDelay(msg.content || '', isFirst)
            : (isFirst ? 500 : 1500);
        await new Promise(r => setTimeout(r, Math.round(baseDelay * PEEK_REVEAL_SPEED)));
        isFirst = false;

        if (token !== _peekConvoRevealToken || !_isPeekConvoOnScreen(partnerName)) return;

        _appendPeekConvoMessages(partnerName, [msg]);
    }
}

async function continuePeekConversation(partnerName) {
    if (!partnerName) return;
    if (PeekDeleteManager?.isEditMode) { showToast('请先退出多选模式'); return; }
    if (_peekConvoGenerating.has(partnerName)) { showToast('正在生成中，请稍候...'); return; }

    const convo = peekContentCache?.messages?.conversations?.find(c => c.partnerName === partnerName);
    if (!convo) { showToast('找不到对话记录'); return; }

    const char = db.characters.find(c => c.id === window.activePeekCharId);
    if (!char) return showToast('无法找到当前角色');

    const { url, key, model, streamEnabled, temperature } = getPeekApiConfig(window.activePeekCharId);
    if (!url || !key || !model) { showToast('请先配置 API！'); return switchScreen('api-settings-screen'); }

    const ok = await AppUI.confirm(
        `确认将等待与「${partnerName}」的对话窗口继续生成后续消息。`,
        '等待后续消息', '确认', '取消'
    );
    if (!ok) return;
    // 确认弹窗期间可能已被再次触发
    if (_peekConvoGenerating.has(partnerName)) return;

    _peekConvoGenerating.add(partnerName);
    _syncPeekContinueUI(_peekConvoPartnerName);
    _scrollPeekConvoToBottom();   // 让"正在输入"提示落在视野里

    try {
        const peekSettings = char.peekScreenSettings || {};
        const limitCount = (peekSettings.contextLimit !== undefined) ? peekSettings.contextLimit : 50;
        const mainChatContext = limitCount > 0 ? historyToPlainText(char.history.slice(-limitCount)) : "";
        const baseContextPrompt = getPeekBasePromptContext(char, mainChatContext);

        // 只取本组对话最近 N 条；时间分割线转成"隔了一段时间"的提示
        const convoText = (convo.history || [])
            .slice(-PEEK_CONTINUE_CONTEXT_LIMIT)
            .map(m => {
                if (m.content === '[time-divider]') return '(隔了一段时间)';
                if (!m.content) return '';
                return `${m.sender === 'char' ? 'char' : 'partner'}: ${m.content}`;
            })
            .filter(Boolean)
            .join('\n');

        let systemPrompt = `你正在模拟角色 ${char.realName} 手机里的一段私聊对话。\n`;
        systemPrompt += baseContextPrompt;
        systemPrompt += `\n【本次任务】\n下面是 ${char.realName} 与「${partnerName}」这段对话目前的记录（展示的是最近${PEEK_CONTINUE_CONTEXT_LIMIT}条）。请**紧接着最后一条消息**继续往下推演，写出这段对话接下来自然发生的内容。\n`;
        systemPrompt += `\n【当前对话记录】\n---\n${convoText || '（这段对话还没有任何消息，请自然地开启它）'}\n---\n`;
        systemPrompt += `\n【要求】\n`;
        systemPrompt += `1. 只推演 ${char.realName} 和「${partnerName}」之间的这一段对话，不要另起一段新对话。\n`;
        systemPrompt += `2. 严禁复述、总结或改写上面已有的消息，只输出**新增**的后续内容。\n`;
        systemPrompt += `3. 承接最后一条消息的语气和话题自然往下写，允许话题自然推进、转移或让对话自然收尾；内容要符合 ${char.realName} 的人设，并与上面的主线聊天上下文保持一致。\n`;
        systemPrompt += `4. 口吻是真人线上聊天，简短口语化。\n`;
        systemPrompt += `5. 严格按行输出，每条消息单独一行：${char.realName} 发送的以 "char: " 开头；「${partnerName}」发送的以 "partner: " 开头。\n`;
        systemPrompt += `6. 直接输出消息行，不要输出任何标签，也不要编号、解释或额外说明。\n`;
        systemPrompt += `\n输出格式示例：\npartner: 对方发送的消息内容\nchar: ${char.realName}发送的消息内容\npartner: 对方发送的消息内容\n`;

        const contentStr = await callPeekApi({
            url, key, model,
            messages: [{ role: 'user', content: systemPrompt }],
            temperature, streamEnabled
        });

        const newMessages = parsePeekConversationLines(contentStr);
        if (newMessages.length === 0) throw new Error('解析内容失败，未获取到有效消息。');

        // 直接续在本组对话末尾，不插时间分割线（是同一段对话的延续）
        convo.history = [...(convo.history || []), ...newMessages];
        convo.lastUpdated = Date.now();

        // 有新内容就顶到列表最前（用户正看着，不打 new 角标）
        const list = peekContentCache.messages.conversations;
        const idx = list.indexOf(convo);
        if (idx > 0) { list.splice(idx, 1); list.unshift(convo); }

        savePeekData(char.id).catch(e => console.error('Peek自动保存失败:', e));
        renderPeekChatList(list, false, true);

        // 数据已经落库，这里只是把气泡一条条放出来；中途切走也不会丢内容
        await _revealPeekConvoMessages(partnerName, newMessages, char.realName || char.name);

        if (typeof showToast === 'function') showToast(`已发现 ${newMessages.length} 条新消息`);

    } catch (error) {
        console.error(error);
        if (typeof showApiError === 'function') showApiError(error);
        else if (typeof showToast === 'function') showToast('生成失败: ' + error.message);
    } finally {
        _peekConvoGenerating.delete(partnerName);
        _syncPeekContinueUI(_peekConvoPartnerName);
    }
}

async function generateAndRenderPeekMessages(options = {}) {
    const appType = 'messages';
    const { forceRefresh = false } = options;

    if (generatingPeekApps.has(appType)) { showToast('消息内容正在生成中，请稍候...'); return; }

    if (!forceRefresh && peekContentCache[appType]) {
        renderPeekChatList(peekContentCache[appType].conversations, false, true);
        switchScreen('peek-messages-screen');
        return;
    }

    const char = db.characters.find(c => c.id === window.activePeekCharId);
    if (!char) return showToast('无法找到当前角色');

    const { url, key, model, streamEnabled, temperature } = getPeekApiConfig(window.activePeekCharId);
    if (!url || !key || !model) { showToast('请先配置 API！'); return switchScreen('api-settings-screen'); }

    generatingPeekApps.add(appType);
    switchScreen('peek-messages-screen');
    const targetContainer = document.getElementById('peek-chat-list-container');
    const hideLoading = showLoadingToast('正在生成对话列表...');

    try {
        const peekSettings = char.peekScreenSettings || {};
        const limitCount = (peekSettings.contextLimit !== undefined) ? peekSettings.contextLimit : 50;
        const mainChatContext = limitCount > 0 ? historyToPlainText(char.history.slice(-limitCount)) : "";

        const senderName = char.realName || char.name;
        const baseContextPrompt = getPeekBasePromptContext(char, mainChatContext);

        // 排除已屏蔽（isHidden为true）的联系人
        const existingNames = (peekContentCache['messages']?.conversations ||[])
            .filter(c => !c.isHidden)
            .map(c => c.partnerName)
            .filter(Boolean);

        let systemPrompt = `你正在模拟角色 ${char.realName} 的手机聊天/消息应用。\n`;
        systemPrompt += baseContextPrompt;
        systemPrompt += `\n【任务1：消息记录】`;

        if (existingNames.length > 0) {
            systemPrompt += `\n请为 ${char.realName} 编造4-6个最近的对话。\n当前手机里已有以下联系人：\n${existingNames.map((n, i) => `${i + 1}. ${n}`).join('\n')}\n但联系人不仅仅局限于这些人。你应该根据聊天上下文情况，尽可能积极创造**新的联系人**进行对话。`;
        } else {
            systemPrompt += `\n请为 ${char.realName} 编造3-5个最近的对话。\n`;
        }

        systemPrompt += `对话内容需要强烈反映Ta的人设以及和最近聊天上下文。\n每段对话需要提供对话对象的称呼(#PARTNER#)以及具体的聊天记录(#HISTORY#)。\n在 #HISTORY# 中，请严格使用以下格式记录每条消息：\n如果是 ${char.realName} 发送的，以 "char: " 开头；\n如果是对方发送的，以 "partner: " 开头。\n\n【任务2：话题分享】\n在消息记录生成完毕后，请从刚刚生成的这几段对话中挑选1个值得吐槽或分享的对话，预测一下，在未来的某个时间，${senderName}会主动把这个对话内容当成话题发消息分享给${char.myName}。\n`;
        systemPrompt += getPeekProactiveFormatPrompt(char);
        systemPrompt += `\n请严格按照以下标签文本格式输出，**每段对话之间使用 ===SEP=== 分隔**。在所有对话结束后，使用 ===PROACTIVE_MESSAGES=== 分割，再输出主动消息。\n\n输出格式示例：\n#PARTNER#\n与Ta对话的人的称呼\n#HISTORY#\npartner: 对方发送的消息内容\nchar: ${char.realName}发送的消息内容\npartner: 对方发送的消息内容\n===SEP===\n#PARTNER#\n与Ta对话的人的称呼\n#HISTORY#\npartner: 对方发送的消息内容\nchar: ${char.realName}发送的消息内容\n===PROACTIVE_MESSAGES===\n#SECRET_CHAT_EVENING_85%#[19:15|${senderName}的消息:突然好想吃我妈做的排骨啊(T_T)][19:16|${senderName}的消息:你吃晚饭了吗？]\n`;

        const contentStr = await callPeekApi({ url, key, model, messages: [{ role: 'user', content: systemPrompt }], temperature, streamEnabled });

        const parts = contentStr.split(/===PROACTIVE_MESSAGES===/i);
        const messagesRawText = parts[0] || '';
        const hitchhikerRawText = parts.length > 1 ? parts[1] : '';

        const parsedConversations = parsePeekMessagesContent(messagesRawText);

        if (parsedConversations.length > 0) {
            applyPeekMessagesContent(parsedConversations);
            savePeekData(char.id).catch(e => console.error("Peek自动保存失败:", e));
            renderPeekChatList(peekContentCache['messages'].conversations, false, true);
        } else {
            throw new Error("解析消息内容失败，未找到对应标签。");
        }

        if (hitchhikerRawText.trim()) {
            parseAndSavePeekProactiveHitchhiker(char, hitchhikerRawText);
            saveSingleChat(char.id, 'private').catch(e => console.error(e));
        }

    } catch (error) {
        console.error(error);
        if (typeof showApiError === 'function') showApiError(error);
        if (peekContentCache['messages']?.conversations?.length > 0) {
            renderPeekChatList(peekContentCache['messages'].conversations, false, true);
            if (typeof showToast === 'function') showToast('刷新失败: ' + error.message);
        } else {
            if (targetContainer) {
                targetContainer.innerHTML = `<li class="list-item chat-item"><p class="placeholder-text" style="color:#ff4d4f; text-align:center; width:100%;">内容生成失败，请重试。<br><span style="font-size:12px;">${error.message}</span></p></li>`;
            }
        }
    } finally {
        generatingPeekApps.delete(appType);
        hideLoading();
    }
}

async function addPeekContact() {
    const name = await AppUI.prompt(
        '请输入新增的联系人名称。',
        '例如：c喵、g喵…',
        '新增联系人'
    );
    if (!name || !name.trim()) return;

    const trimmedName = name.trim();
    if (!peekContentCache['messages']) peekContentCache['messages'] = { conversations: [] };

    const exists = peekContentCache['messages'].conversations.some(c => c.partnerName === trimmedName);
    if (exists) { showToast(`"${trimmedName}" 已在联系人列表中`); return; }

    const newConvo = {
        id: `msg_manual_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        partnerName: trimmedName,
        history:[],   
        isNew: false,
        lastUpdated: Date.now()
    };

    peekContentCache['messages'].conversations.push(newConvo);
    savePeekData(window.activePeekCharId).catch(e => console.error('Peek保存失败:', e));
    renderPeekChatList(peekContentCache['messages'].conversations);
    showToast(`已添加"${trimmedName}"✓`);
}

// ==========================================
// 初始化消息模块事件（供 peek_core.js 调用）
// ==========================================
function initPeekMessagesEvents() {
    // 消息列表：滚动触底加载下一页
    const listScrollContainer = document.querySelector('#peek-messages-screen .content');
    PeekPager.bindScroll(
        listScrollContainer,
        'messages',
        () => (peekContentCache?.messages?.conversations || []).length,
        () => renderPeekChatList(peekContentCache.messages.conversations, true)
    );

    // 对话详情：滚动到顶部加载更早的历史消息
    // 实际滚动容器可能是 .content 或 .message-area（视内容高度而定），两个都绑
    const convoScreen = document.getElementById('peek-conversation-screen');
    [convoScreen?.querySelector('.content'), document.getElementById('peek-message-area')]
        .filter(Boolean)
        .forEach(el => {
            el.addEventListener('scroll', () => {
                if (_peekConvoRenderedStart <= 0) return;
                if (el.scrollTop <= 50) {
                    _loadOlderPeekMessages();
                }
            });
        });

    // 兜底：点击顶部提示也可加载（内容不足一屏无法滚动时）
    document.getElementById('peek-message-area')?.addEventListener('click', (e) => {
        if (e.target.id === 'peek-convo-history-tip') _loadOlderPeekMessages();
    });

    // 对话详情：继续推演（按 _peekConvoPartnerName 定位当前打开的这一组）
    document.getElementById('peek-conversation-continue-btn')
        ?.addEventListener('click', () => continuePeekConversation(_peekConvoPartnerName));
}
