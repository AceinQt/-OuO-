let isLoadingHistory = false; // 原有的：控制 DOM 渲染的锁
let isFetchingDB = false;     // 新增的：控制后台静默读 DB 的锁

// ==========================================
// ★★★ 渲染窗口游标（指向 chat.history 的下标）
//   历史上翻/下翻都靠 currentPage 反推 `total - (currentPage-1)*PAGE`，
//   这个公式把窗口死死锚在数组末尾，数组一旦在中间或前面被改（搜索跳转 merge、
//   后台预加载 unshift、新消息 push），下标就整体错位 → 边界处漏渲染整段消息。
//   现在改成显式游标：
//     _renderTopCeil     = 已向上覆盖到的最小下标（含）。0 表示内存里上面没货了。
//     _renderBottomFloor = 已向下覆盖到的下标上界（不含）。== history.length 表示已到最新。
//   两个游标在"前插 N 条"时整体 +N；渲染时再用 DOM 实际区间做一次校正（防止某页
//   整页 isHidden 时游标不动导致死循环，也防止有人绕过分页直接往 DOM 追加气泡）。
// ==========================================
window._renderTopCeil = 0;
window._renderBottomFloor = 0;

// 单次扫描建立 id→下标 / callSessionId→首尾下标 的映射
function _buildHistoryIndexMaps(chat) {
    const h = chat.history;
    const idToIndex = new Map();
    const sidToFirstIndex = new Map();
    const sidToLastIndex = new Map();
    for (let i = 0; i < h.length; i++) {
        idToIndex.set(h[i].id, i);
        const sid = h[i].callSessionId;
        if (sid) {
            if (!sidToFirstIndex.has(sid)) sidToFirstIndex.set(sid, i);
            sidToLastIndex.set(sid, i);
        }
    }
    return { idToIndex, sidToFirstIndex, sidToLastIndex };
}

// 从 DOM 反推"当前实际已渲染"的 history 下标区间 [top, bottomExclusive)
// 折叠/展开的通话气泡按整个 session 的首尾下标算。DOM 里没有可定位气泡时返回 null。
function _getRenderedRange(chat) {
    if (!chat || !chat.history || chat.history.length === 0) return null;
    const { idToIndex, sidToFirstIndex, sidToLastIndex } = _buildHistoryIndexMaps(chat);
    let top = -1, bottom = -1;

    messageArea.querySelectorAll('.message-wrapper[data-id]').forEach(el => {
        const i = idToIndex.get(el.dataset.id);
        if (i === undefined) return;
        if (top === -1 || i < top) top = i;
        if (i > bottom) bottom = i;
    });

    messageArea.querySelectorAll('[data-call-session-id], [data-call-session-expanded-container]').forEach(el => {
        const sid = el.dataset.callSessionId || el.dataset.callSessionExpandedContainer;
        if (!sid) return;
        const f = sidToFirstIndex.get(sid);
        const l = sidToLastIndex.get(sid);
        if (f === undefined) return;
        if (top === -1 || f < top) top = f;
        if (l > bottom) bottom = l;
    });

    if (top === -1) return null;
    return { top, bottomExclusive: bottom + 1 };
}

// 上翻：本次要渲染的 end（不含）。取 DOM 实际顶 与 游标 的较小者。
function _getOlderRenderEnd(chat) {
    const r = _getRenderedRange(chat);
    const domTop = r ? r.top : chat.history.length;
    const ceil = (typeof window._renderTopCeil === 'number') ? window._renderTopCeil : domTop;
    return Math.max(0, Math.min(domTop, ceil));
}

// 下翻：本次要渲染的 start（含）。取 DOM 实际底 与 游标 的较大者。
function _getNewerRenderStart(chat) {
    const r = _getRenderedRange(chat);
    const domBottom = r ? r.bottomExclusive : 0;
    const floor = (typeof window._renderBottomFloor === 'number') ? window._renderBottomFloor : domBottom;
    return Math.min(chat.history.length, Math.max(domBottom, floor));
}

// 下面还有没有"值得渲染"的东西（用于滚动门槛）：
// 末尾常挂着 isHidden 的 context 消息，只看下标会导致反复空转转圈，所以要求至少有一条可见消息。
function _hasMoreNewerToRender(chat) {
    if (!chat || !chat.history) return false;
    const start = _getNewerRenderStart(chat);
    for (let i = start; i < chat.history.length; i++) {
        if (!chat.history[i].isHidden) return true;
    }
    return false;
}

// 当前视图是否已经贴着"最新"（决定发消息时要不要先重置回底部视图）
function _isViewingLatest() {
    const chat = (currentChatType === 'private')
        ? db.characters.find(c => c.id === currentChatId)
        : db.groups.find(g => g.id === currentChatId);
    if (!chat || !chat.history) return true;
    return _getNewerRenderStart(chat) >= chat.history.length;
}
let selectedLinkStickerIds = new Set(); // 关联弹窗选中的ID
let currentStickerCategory = '全部';    // 主面板当前选中的分类
let currentLinkStickerCategory = '全部';// 关联弹窗当前选中的分类
let currentActionCategory = null;// 记录长按操作的分类名

const chatRoomScreen = document.getElementById('chat-room-screen'),
                chatRoomHeaderDefault = document.getElementById('chat-room-header-default'),
                chatRoomHeaderSelect = document.getElementById('chat-room-header-select'),
                cancelMultiSelectBtn = document.getElementById('cancel-multi-select-btn'),
                multiSelectTitle = document.getElementById('multi-select-title'),
                chatRoomTitle = document.getElementById('chat-room-title'),
                chatRoomStatusText = document.getElementById('chat-room-status-text'),
                messageArea = document.getElementById('message-area'),
                messageInputDefault = document.getElementById('message-input-default'),
                messageInput = document.getElementById('message-input'),
                sendMessageBtn = document.getElementById('send-message-btn'),
                getReplyBtn = document.getElementById('get-reply-btn'),
                typingIndicator = document.getElementById('typing-indicator'),
                chatSettingsBtn = document.getElementById('chat-settings-btn'),
                settingsSidebar = document.getElementById('chat-settings-sidebar'),
                settingsForm = document.getElementById('chat-settings-form'),
                multiSelectBar = document.getElementById('multi-select-bar'),
                selectCount = document.getElementById('select-count'),
                deleteSelectedBtn = document.getElementById('delete-selected-btn');

const regenerateBtn = document.getElementById('regenerate-btn');

const stickerToggleBtn = document.getElementById('sticker-toggle-btn'),
                stickerModal = document.getElementById('sticker-modal'),
                stickerGridContainer = document.getElementById('sticker-grid-container'),
                addNewStickerBtn = document.getElementById('add-new-sticker-btn'),
                addStickerModal = document.getElementById('add-sticker-modal'),
                addStickerModalTitle = document.getElementById('add-sticker-modal-title'),
                addStickerForm = document.getElementById('add-sticker-form'),
                stickerEditIdInput = document.getElementById('sticker-edit-id'),
                stickerPreview = document.getElementById('sticker-preview'),
                stickerNameInput = document.getElementById('sticker-name'),
                stickerUrlInput = document.getElementById('sticker-url-input'),
                stickerFileUpload = document.getElementById('sticker-file-upload');
  const stickerActionSheet = document.getElementById('sticker-actionsheet'),
                editStickerBtn = document.getElementById('edit-sticker-btn'),
                deleteStickerBtn = document.getElementById('delete-sticker-btn'); 
            
    // ==========================================
    // 绑定事件
    // ==========================================
function setupChatRoom() {
    if ('scrollRestoration' in history) {
        history.scrollRestoration = 'manual';
    }
    const placeholderPlusBtn = document.getElementById('placeholder-plus-btn');
    const chatExpansionPanel = document.getElementById('chat-expansion-panel');

    // 1. 加号按钮逻辑
    placeholderPlusBtn.addEventListener('click', () => {
        if (stickerModal.classList.contains('visible')) {
            stickerModal.classList.remove('visible');
        }

        // 面板是单例复用的，开之前必须按当前会话重新点灯
        syncChatExpansionActiveState();
        chatExpansionPanel.classList.toggle('visible');
    });
    
    // ★ sendMessage 是 fire-and-forget（三处调用点都不 await），异常默认只会变成
    //   静默的 unhandled rejection —— 曾经因此让"消息没落库"的 ReferenceError 毫无征兆。
    //   统一走这个包装：出错就报红 + 弹提示，让丢消息类问题第一时间可见。
    const _safeSendMessage = () => {
        Promise.resolve()
            .then(() => sendMessage())
            .catch(err => {
                console.error('❌ [sendMessage] 发送流程异常，该消息可能未写入数据库：', err);
                if (typeof showToast === 'function') showToast('消息发送异常，请截图控制台报错');
            });
    };

// 1. 手机端触摸发送 (保留原有，e.preventDefault()会阻止移动端再触发click，防止发两次)
    sendMessageBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        _safeSendMessage();
        setTimeout(() => {
            messageInput.focus();
        }, 50);
    });
    
    // 2. 电脑端鼠标点击发送 (新增这个监听器)
    sendMessageBtn.addEventListener('click', (e) => {
        e.preventDefault(); // 防止默认提交等行为
        _safeSendMessage();
        // 电脑端发送后保持输入框焦点，方便继续打字
        messageInput.focus(); 
    });

    // 3. 键盘回车发送 (保留原有)
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !isGenerating) {
            e.preventDefault();
            _safeSendMessage();
        }
    });
    getReplyBtn.addEventListener('click', async () => {
        if (isGenerating) return;

        // 1. 获取当前聊天的实例
        const chat = (currentChatType === 'private') 
            ? db.characters.find(c => c.id === currentChatId) 
            : db.groups.find(g => g.id === currentChatId);

        if (chat) {
            const lastValidMsg = getLastValidInteractMsg(chat);
            // 2. 如果最后一条有效消息是 AI 发送的，说明用户没有回复
            if (lastValidMsg && (lastValidMsg.role === 'assistant' || lastValidMsg.role === 'model')) {
                const confirmed = await AppUI.confirm("你还没有回复，是否继续？", "确认继续", "继续", "取消");
                if (!confirmed) return; 
                
                // === 关键修改：区分线上/线下模式，动态获取角色名称注入 Prompt ===
                let continueInstruction = '';
                
                if (currentChatType === 'private') {
                    if (chat.offlineModeEnabled) {
                        // 线下模式：强调动作和续写故事
                        continueInstruction = `[system: ${chat.myName}暂时没有发起新的动作，请继续实时续写${chat.realName}的故事。]`;
                    } else {
                        // 线上模式私聊：强调聊天延续
                        continueInstruction = `[system: ${chat.myName}暂时没有回复，请自然地延续聊天内容。]`;
                    }
                } else {
                    // 线上模式群聊：获取群聊中我的真名或昵称
                    const myNameInGroup = chat.me.realName || chat.me.nickname || "我";
                    continueInstruction = `[system: ${myNameInGroup}暂时没有回复，请自然地延续聊天内容。]`;
                }

                const instructionMsg = {
                    id: `msg_ins_continue_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,  
                    role: 'user', 
                    content: continueInstruction,
                    parts:[{ type: 'text', text: continueInstruction }],
                    timestamp: Date.now(),
                    isHidden: true, // 在界面中隐身
                    isAiIgnore: false // 提交给 AI 接口
                };
                
                if (currentChatType === 'group') {
                    instructionMsg.senderId = 'user_me';
                }
                
                // 推入历史并保存
                chat.history.push(instructionMsg);
                await saveMessageToDB(instructionMsg, currentChatId, currentChatType);
            }
        }
        
        // 3. 时间感知检查（与 sendMessage 一致，补上点击按钮时也能触发）
        if (chat) {
            await processTimePerception(chat, currentChatId, currentChatType, true);
        }

        // 4. 正常调用获取 AI 回复
        getAiReply(currentChatId, currentChatType);
    });
    regenerateBtn.addEventListener('click', handleRegenerate);

// ==========================================
    // 【核心修复】双向滚动监听 (加入无感预加载)
    // ==========================================
    messageArea.addEventListener('scroll', () => {
        // 1. 向上滚动：加载历史消息 (Older)
        if (messageArea.scrollTop < 50) {
            const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
            if (!chat || !chat.history) return;
            
            // ★ 内存里还没渲染的剩余条数 = 已渲染窗口顶部之上还剩多少条（游标即下标，O(1)）
            //   原来用 total - currentPage*PAGE 反推，数组在中间/前面被改动后会算错。
            const unrenderedMemory = Math.max(0, window._renderTopCeil || 0);

            // [A] DOM 渲染逻辑：只要内存里还有货，就无脑调用 loadMoreMessages (它内部有 isLoadingHistory 锁防抖)
            if (unrenderedMemory > 0) {
                if (!isLoadingHistory) {
                    loadMoreMessages(); 
                }
            } 
            // 极端兜底：内存真的一滴都没有了，且后台还没拉回来，只能硬等（出现转圈）
            else if (window.LAZY_LOAD && !chat._noMoreOlderInDB && !isLoadingHistory && !isFetchingDB) {
                loadOlderFromDB(); 
            }

            // [B] 无感预加载逻辑 (Silent Pre-fetch)：
            // 当内存剩余不足 3 页 (比如少于 60 条) 时，后台偷偷去 DB 进货 200 条
            if (window.LAZY_LOAD && !chat._noMoreOlderInDB && unrenderedMemory < (MESSAGES_PER_PAGE * 3)) {
                preloadOlderFromDBInBackground(chat);
            }
        }

        // 2. 向下滚动：加载后续消息 (Newer)
        if (isLoadingHistory) return;
        const isNearBottom = messageArea.scrollHeight - messageArea.scrollTop - messageArea.clientHeight < 50;
        if (isNearBottom) {
            // ★ 原来的门槛是 currentPage > 1（页码计数器，跳转后是错的，且到底后还会反复空转）。
            //   现在直接看底部游标有没有到数组末尾。
            const chatForNewer = (currentChatType === 'private')
                ? db.characters.find(c => c.id === currentChatId)
                : db.groups.find(g => g.id === currentChatId);
            if (_hasMoreNewerToRender(chatForNewer)) {
                loadNewerMessages();
            }
        }
    });

    // ==========================================
    // 点击监听 (处理点击气泡、面板关闭等)
    // ==========================================
    messageArea.addEventListener('click', (e) => {
        // 1. 点击空白处关闭面板
        if (stickerModal.classList.contains('visible')) {
            stickerModal.classList.remove('visible');
            return;
        }
        if (chatExpansionPanel.classList.contains('visible')) {
            chatExpansionPanel.classList.remove('visible');
            return;
        }

        // 2. 多选模式处理
        if (isInMultiSelectMode) {
            const messageWrapper = e.target.closest('.message-wrapper');
            if (messageWrapper) {
                toggleMessageSelection(messageWrapper.dataset.id);
            }
        } else {
            // 3. 普通模式下的点击事件
            const voiceBubble = e.target.closest('.voice-bubble');
            if (voiceBubble) {
                // ★ 两个动作分给两个目标：点播放键出声，点气泡其他地方切换文字稿。
                //   文字稿照旧独立于音频 —— 有没有声音都不影响看文字。
                //   例外是自己发的语音（播不了），播放键也会退回切文字稿。
                if (e.target.closest('.voice-play-btn')) {
                    if (typeof handleVoiceBubbleClick === 'function') {
                        const wrapper = voiceBubble.closest('.message-wrapper');
                        const chat = (currentChatType === 'group' ? db.groups : db.characters)
                            .find(c => c.id === currentChatId);
                        handleVoiceBubbleClick(voiceBubble, chat, currentChatType,
                            wrapper && wrapper.dataset.senderId);
                    }
                } else if (typeof toggleVoiceTranscript === 'function') {
                    toggleVoiceTranscript(voiceBubble);
                }
            }
            
            const bilingualBubble = e.target.closest('.bilingual-bubble');
            if (bilingualBubble) {
                const translationText = bilingualBubble.closest('.message-wrapper').querySelector('.translation-text');
                if (translationText) {
                    translationText.classList.toggle('active');
                }
            }

            const pvCard = e.target.closest('.pv-card');
            if (pvCard) {
                if (e.target.closest('.image-zoom-btn')) return;
                const imageOverlay = pvCard.querySelector('.pv-card-image-overlay');
                const footer = pvCard.querySelector('.pv-card-footer');
                if (imageOverlay && footer) {
                    imageOverlay.classList.toggle('hidden');
                    footer.classList.toggle('hidden');
                }
            }
            const giftCard = e.target.closest('.gift-card');
            if (giftCard) {
                const description = giftCard.closest('.message-wrapper').querySelector('.gift-card-description');
                if (description) {
                    description.classList.toggle('active');
                }
            }
            const transferCard = e.target.closest('.transfer-card.received-transfer');
            if (transferCard && currentChatType === 'private') {
                const messageWrapper = transferCard.closest('.message-wrapper');
                const messageId = messageWrapper.dataset.id;
                const character = db.characters.find(c => c.id === currentChatId);
                const message = character.history.find(m => m.id === messageId);
                if (message && message.transferStatus === 'pending') {
                    handleReceivedTransferClick(messageId);
                }
            }
        }
    });

let isTouchLongPress = false; // 用于标记是否是由触摸触发的长按

    messageArea.addEventListener('contextmenu', (e) => {
        e.preventDefault(); // 阻止浏览器自带的右键菜单
        if (isInMultiSelectMode) return;
        
        if (isTouchLongPress) {
            // 注意：这里不要重置 isTouchLongPress，留给下一次触摸去重置
            // 拦截系统自带的 contextmenu，防止弹两次
            return;
        }

        const messageWrapper = e.target.closest('.message-wrapper');
        if (!messageWrapper) return;
        handleMessageLongPress(messageWrapper, e.clientX, e.clientY);
    });

    messageArea.addEventListener('touchstart', (e) => {
        isTouchLongPress = false; // 每次手指落下时重置
        const messageWrapper = e.target.closest('.message-wrapper');
        if (!messageWrapper) return;
        
        longPressTimer = setTimeout(() => {
            isTouchLongPress = true; // 标记为：已经成功触发了长按
            const touch = e.touches[0];
            handleMessageLongPress(messageWrapper, touch.clientX, touch.clientY);
        }, 400);
    });

    messageArea.addEventListener('touchmove', () => {
        clearTimeout(longPressTimer); // 手指滑动时取消长按判定
    });

    messageArea.addEventListener('touchend', (e) => {
        clearTimeout(longPressTimer);
        
        // 核心修复：如果长按菜单已经弹出了，就阻止默认行为！
        // 这会掐断浏览器在抬手时自动生成的 click 事件，完美解决“概率性消失”
        if (isTouchLongPress) {
            if (e.cancelable) {
                e.preventDefault();
            }
        }
    });

    const messageEditForm = document.getElementById('message-edit-form');
    if (messageEditForm) {
        messageEditForm.addEventListener('submit', (e) => {
            e.preventDefault();
            saveMessageEdit();
        });
    }

    const cancelEditModalBtn = document.getElementById('cancel-edit-modal-btn');
    if (cancelEditModalBtn) {
        cancelEditModalBtn.addEventListener('click', cancelMessageEdit);
    }

    cancelMultiSelectBtn.addEventListener('click', exitMultiSelectMode);
    deleteSelectedBtn.addEventListener('click', deleteSelectedMessages);

    document.getElementById('cancel-reply-btn').addEventListener('click', cancelQuoteReply);
    initCallFeature();
    
}

    // ==========================================
    // 聊天室临时 UI 复位
    // ==========================================
// "+"面板里属于"隔着手机才成立"的线上功能，线下模式（面对面）下要禁用。
// sticker bar 上的转账/语音/照片由 updateOfflineModeUI 用 disabled 属性禁；
// 面板项是 div，只能靠 class 置灰 + 点击拦截，所以清单放在这里。
const OFFLINE_DISABLED_EXPANSION_ACTIONS = ['send-gift-modal', 'send-location-modal'];

/**
 * 把"+"面板里与会话绑定的开关（线下模式 / 后台消息）对齐到当前会话的真实状态，
 * 并按线下模式置灰面板里的线上功能（送礼物 / 发送位置）。
 * 面板是全局单例、只在启动时构建一次，所以每次打开面板、每次进聊天室都得重新对齐，
 * 否则会挂着上一个会话残留的蓝色高亮 / 置灰状态。
 */
function syncChatExpansionActiveState(chatId = currentChatId, chatType = currentChatType) {
    const chat = (chatType === 'private' && chatId && Array.isArray(window.db?.characters))
        ? db.characters.find(c => c.id === chatId)
        : null;

    const offlineBtn = document.querySelector('.expansion-item[data-action="offline-mode-settings"]');
    if (offlineBtn) {
        offlineBtn.classList.toggle('active', !!(chat && chat.offlineModeEnabled));
    }

    const proactiveBtn = document.querySelector('.expansion-item[data-action="proactive-messaging-settings"]');
    if (proactiveBtn) {
        // ★ 括号不能省：原来的 `chat && x === 'fixed' || x === 'timer'` 因 && 优先级更高，
        //   timer 模式下整个条件恒真，会把面板里所有图标都点亮。
        proactiveBtn.classList.toggle('active',
            !!chat && (chat.proactiveMode === 'fixed' || chat.proactiveMode === 'timer'));
    }

    // 线下模式是面对面互动，隔着手机才成立的功能要跟 sticker bar 上的转账/语音一样禁掉。
    // 这些是 div 不是 button，disabled 无效，只能靠 .disabled class + 点击处的拦截。
    const isOffline = !!(chat && chat.offlineModeEnabled);
    OFFLINE_DISABLED_EXPANSION_ACTIONS.forEach(action => {
        const el = document.querySelector(`.expansion-item[data-action="${action}"]`);
        if (el) el.classList.toggle('disabled', isOffline);
    });
}

/**
 * 关闭聊天室里所有"浮在页面上"的临时 UI：底部 + 面板、表情面板、设置侧边栏、
 * 通话记录侧栏、通话记录折叠浮动按钮。离开聊天室时由 _screenLeaveHooks 自动调用。
 *
 * ⚠️ 故意不碰 #call-overlay：通话中有计时器、音频和未落库的会话状态，
 *    只把 UI 藏掉会变成"看不见但还在跑"，挂断另有出口。
 */
function closeChatRoomPanels() {
    // 这两个是裸 .visible 的普通 div，switchScreen 的遮罩清理覆盖不到，必须手动关
    document.getElementById('chat-expansion-panel')?.classList.remove('visible');
    document.getElementById('sticker-modal')?.classList.remove('visible');
    if (typeof exitStickerManageMode === 'function') exitStickerManageMode();

    // 侧边栏：switchScreen 也会清，但"聊天室 → 聊天室"直切时这里要兜住
    document.getElementById('chat-settings-sidebar')?.classList.remove('open');
    document.getElementById('group-settings-sidebar')?.classList.remove('open');

    // 通话的附属 UI（通话本体不动）
    if (typeof closeCallHistory === 'function') closeCallHistory();
    if (typeof hideCallCollapseBtn === 'function') hideCallCollapseBtn();

    // 顺手把开关高亮复位，避免下次面板出现的第一帧还是旧会话的状态
    syncChatExpansionActiveState();
}

/**
 * 换会话时的完整复位：面板之外，再把输入区的会话级状态（多选、引用、编辑）清掉，
 * 否则 A 会话选中的消息 / 引用的气泡会带进 B 会话。
 */
function resetChatRoomState() {
    closeChatRoomPanels();
    if (typeof exitMultiSelectMode === 'function') exitMultiSelectMode();
    if (typeof cancelQuoteReply === 'function') cancelQuoteReply();
    if (typeof cancelMessageEdit === 'function') cancelMessageEdit();
}

// 离开聊天室即复位（界面返回按钮 / 滑动返回 / 系统返回键最终都会走 switchScreen）
window._screenLeaveHooks = window._screenLeaveHooks || {};
window._screenLeaveHooks['chat-room-screen'] = closeChatRoomPanels;

    // ==========================================
    // 初始化聊天室界面
    // ==========================================                       
            function openChatRoom(chatId, type) {
                const chat = (type === 'private') ? db.characters.find(c => c.id === chatId) : db.groups.find(g => g.id === chatId);
                if (!chat) return;
// --- 从这里开始是新增的代码 ---
if (chat.unreadCount && chat.unreadCount > 0) {
    chat.unreadCount = 0;
    saveSingleChat(chatId, type);
    
    // 【优化】点开聊天瞬间立刻清除主页红点
    if (typeof updateHomeChatBadge === 'function') {
        updateHomeChatBadge();
    }
    
    // 延迟更新列表，让进入聊天室的切换动画更顺滑
    setTimeout(() => {
        if (typeof renderChatList === 'function') renderChatList();
    }, 50);
}

// 进了聊天室就算已读：把该会话残留在通知栏里的系统通知清掉
// （用户不点通知、直接点 App 图标进来看消息时，通知栏本来会一直挂着）
if (window.NotifyCenter && typeof NotifyCenter.clearChatNotifications === 'function') {
    NotifyCenter.clearChatNotifications(chatId);
}

                // 进新会话前先把上一个会话残留的面板/侧边栏/多选/引用全部清干净
                resetChatRoomState();
                switchScreen('chat-room-screen');
                // 按本次要打开的会话重新点灯（不依赖调用方是否已同步全局 currentChatId）
                syncChatExpansionActiveState(chatId, type);
                const callBtn = document.getElementById('video-call-btn');
    if (callBtn) {
        if (type === 'group') {
            callBtn.style.display = 'none'; // 群聊隐藏
        } else {
            callBtn.style.display = 'flex'; // 私聊显示 (使用 flex 以保持图标居中)
        }
    }
                chatRoomTitle.textContent = (type === 'private') ? chat.remarkName : chat.name;
                const subtitle = document.getElementById('chat-room-subtitle');
                
                if (type === 'private') {
                    subtitle.style.display = 'flex';
                    chatRoomStatusText.textContent = chat.status || '在线';
                } else {
                    subtitle.style.display = 'none';
                }
                getReplyBtn.style.display = 'inline-flex';
                chatRoomScreen.style.backgroundImage = chat.chatBg ? `url(${chat.chatBg})` : 'none';
                typingIndicator.style.display = 'none';
                isGenerating = false;
                getReplyBtn.disabled = false;
                currentPage = 1;
                chatRoomScreen.className = chatRoomScreen.className.replace(/\bchat-active-[^ ]+\b/g, '');
                chatRoomScreen.classList.add(`chat-active-${chatId}`);
                
                // --- 【核心修复：动态应用全局默认气泡】 ---
                let cssToApply = chat.customBubbleCss || '';

if (!chat.bubbleThemeName || chat.bubbleThemeName === 'default' || chat.bubbleThemeName === '默认') {
    if (typeof _getBubblePresets === 'function') {
        // 实时抓取最新的全局“默认”预设
        const defaultPreset = _getBubblePresets().find(p => p.name === '默认');
        if (defaultPreset && defaultPreset.css) {
            cssToApply = defaultPreset.css;
        } else {
            cssToApply = '';
        }
    }
}

                let useCustomToApply = !!cssToApply;

updateCustomBubbleStyle(chatId, cssToApply, useCustomToApply);
                // --- 修复结束 ---
                // --- 插入代码：初始化线下模式 UI 状态 ---
                if (type === 'private') {
                    applyOfflineNarrationCss(chatId, chat.offlineNarrationCss);
                    // 传入当前是否开启了线下模式
                    updateOfflineModeUI(chat.offlineModeEnabled);
                } else {
                    // 群聊没有线下模式，强制重置为线上状态
                    updateOfflineModeUI(false);
                }
                // --- 插入结束 ---
if (type === 'private' && chat.callMode && typeof recoverInterruptedCall === 'function') {
    recoverInterruptedCall(chat).then(() => renderMessages(false, false));
} else {
    renderMessages(false, false);
}
                
            }

// ==========================================
// 通话记录折叠/展开 工具函数
// ==========================================

/**
 * 根据 callSessionId 找出 history 中属于该 session 的所有可见消息
 * 使用时间范围：session marker（含hidden）确定边界，取边界内所有非hidden消息
 */
function getCallSessionRange(history, sessionId) {
    // 含 hidden 消息确定时间边界
    const markers = history.filter(m => m.callSessionId === sessionId);
    if (markers.length === 0) return null;

    const startTime = Math.min(...markers.map(m => m.timestamp));
    const endTime   = Math.max(...markers.map(m => m.timestamp));

    // 边界内所有非hidden的可见消息
    const msgs = history.filter(m =>
        !m.isHidden && m.timestamp >= startTime && m.timestamp <= endTime);

    return { sessionId, startTime, endTime, msgs };
}

/**
 * 通话结束后，将聊天室里已渲染的消息气泡合并为折叠气泡
 * 在 endCall / recoverInterruptedCall 的 addMessageBubble 之后调用
 */
function foldCallSession(sessionId) {
    const chat = (currentChatType === 'private')
        ? db.characters.find(c => c.id === currentChatId)
        : null;
    if (!chat) return;

    const range = getCallSessionRange(chat.history, sessionId);
    if (!range || range.msgs.length === 0) return;

    const isSentByUser = range.msgs.some(m => m.id?.includes('_start_vis_'));

    // 找到 DOM 里属于该 session 的所有消息元素
    const domEls = range.msgs
        .map(m => messageArea.querySelector(`.message-wrapper[data-id="${m.id}"]`))
        .filter(Boolean);

    if (domEls.length === 0) return;

    const collapsed = createCollapsedCallBubble(sessionId, range.msgs, isSentByUser);

    // 用折叠气泡替换第一个，删除其余
    domEls[0].replaceWith(collapsed);
    for (let i = 1; i < domEls.length; i++) domEls[i].remove();

    // 如果之前有展开的浮动收起按钮，隐藏
    if (document.getElementById('call-collapse-floating-btn')?.dataset.sessionId === sessionId) {
        hideCallCollapseBtn();
    }
}

/**
 * 展开折叠气泡，显示所有通话期间消息
 */
function expandCallSession(sessionId, collapsedEl) {
    const chat = (currentChatType === 'private')
        ? db.characters.find(c => c.id === currentChatId)
        : null;
    if (!chat) return;

    const range = getCallSessionRange(chat.history, sessionId);
    if (!range) return;

    // Accordion：收起所有其他已展开的 session
    const allExpanded = messageArea.querySelectorAll('[data-call-session-expanded-container]');
    allExpanded.forEach(el => {
        const sid = el.dataset.callSessionExpandedContainer;
        if (sid !== sessionId) collapseCallSession(sid);
    });

    const container = document.createElement('div');
    container.className = 'expanded-call-session-container';
    container.dataset.callSessionExpandedContainer = sessionId;

    range.msgs.forEach(msg => {
        const bubble = createMessageBubbleElement(msg);
        if (bubble) {
            bubble.dataset.callSessionExpanded = sessionId;
            container.appendChild(bubble);
        }
    });

    collapsedEl.replaceWith(container);
    showCallCollapseBtn(sessionId);
}

/**
 * 收起已展开的通话记录，还原折叠气泡
 */
function collapseCallSession(sessionId) {
    const chat = (currentChatType === 'private')
        ? db.characters.find(c => c.id === currentChatId)
        : null;
    if (!chat) return;

    const range = getCallSessionRange(chat.history, sessionId);
    if (!range) return;

    const isSentByUser = range.msgs.some(m => m.id?.includes('_start_vis_'));
    
    // --- 【修改点2】：优先寻找新增的包裹容器进行折叠还原 ---
    const container = messageArea.querySelector(`[data-call-session-expanded-container="${sessionId}"]`);

    if (container) {
        const collapsed = createCollapsedCallBubble(sessionId, range.msgs, isSentByUser);
        container.replaceWith(collapsed);
    } else {
        // 兼容之前未刷新页面时，没有容器的旧版结构
        const expandedEls = Array.from(
            messageArea.querySelectorAll(`[data-call-session-expanded="${sessionId}"]`));

        if (expandedEls.length === 0) return;

        const collapsed = createCollapsedCallBubble(sessionId, range.msgs, isSentByUser);
        expandedEls[0].replaceWith(collapsed);
        for (let i = 1; i < expandedEls.length; i++) expandedEls[i].remove();
    }

    hideCallCollapseBtn();
}

/** 显示右侧浮动收起按钮 */
function showCallCollapseBtn(sessionId) {
    let btn = document.getElementById('call-collapse-floating-btn');
    if (!btn) {
        btn = document.createElement('div');
        btn.id = 'call-collapse-floating-btn';
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
            <path d="M12 8l-6 6 1.41 1.41L12 10.83l4.59 4.58L18 14z"/>
        </svg>`;
        document.getElementById('chat-room-screen').appendChild(btn);
    }
    btn.dataset.sessionId = sessionId;
    btn.style.display = 'flex';
    btn.onclick = async () => {
    const ok = await AppUI.confirm('是否收起通话记录？', '通话记录', '收起', '取消');
    if (ok) {
        hideCallCollapseBtn();          // 先隐藏，不依赖 collapseCallSession 内部调用
        collapseCallSession(btn.dataset.sessionId);
    }
};
}

/** 隐藏浮动收起按钮 */
function hideCallCollapseBtn() {
    const btn = document.getElementById('call-collapse-floating-btn');
    if (btn) btn.style.display = 'none';
}

function _calcInitialStart(chat) {
    const history = chat.history;
    const total = history.length;

    // ★ 一次扫描同时建立：
    //   msgIdToSession: msgId → sessionId（用于后向扫描时 O(1) 查找）
    //   sessionComplete: sessionId → bool（是否是完整 session）
    const msgIdToSession = new Map();
    const sessionComplete = new Map();

    if (currentChatType === 'private') {
        for (const msg of history) {
            if (!msg.callSessionId || msg.isHidden) continue;
            msgIdToSession.set(msg.id, msg.callSessionId);
            if (msg.id?.includes('_end_vis_') || msg.id?.includes('_interrupt_vis_') || msg.id?.includes('_decline_vis_') || msg.id?.includes('_noanswer_')) {
    sessionComplete.set(msg.callSessionId, true);
} else if (!sessionComplete.has(msg.callSessionId)) {
                sessionComplete.set(msg.callSessionId, false);
            }
        }
    }

    // 后向扫描，按可见气泡计数
    const countedSessions = new Set();
    let bubbleCount = 0;
    let startIdx = 0;

    for (let i = total - 1; i >= 0; i--) {
        const msg = history[i];
        if (msg.isHidden) continue;

        const sid = msgIdToSession.get(msg.id);
        if (sid && sessionComplete.get(sid)) {
            // 属于完整通话 session
            if (!countedSessions.has(sid)) {
                countedSessions.add(sid);
                bubbleCount++;
            }
        } else {
            bubbleCount++;
        }

        if (bubbleCount >= MESSAGES_PER_PAGE) {
            startIdx = i;
            break;
        }
    }

    currentPage = 1;
    return startIdx;
}

    // ==========================================
    // 滚动画布和加载历史
    // ==========================================    

function renderMessages(isLoadMore = false, forceScrollToBottom = false) {
    const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
    if (!chat || !chat.history) return;

    // 1. 【关键】记录插入前的滚动高度和当前滚动位置
    const oldScrollHeight = messageArea.scrollHeight;
    const oldScrollTop = messageArea.scrollTop;

    const totalMessages = chat.history.length;
let start, end;

if (!isLoadMore) {
    // ★ 【跳转覆盖】：search 跳转时设置 _jumpRenderStart/End，优先使用
    if (typeof window._jumpRenderStart === 'number' && window._jumpRenderStart >= 0) {
        start = window._jumpRenderStart;
        end   = (typeof window._jumpRenderEnd === 'number' && window._jumpRenderEnd > start)
                    ? window._jumpRenderEnd
                    : totalMessages;
        window._jumpRenderStart = -1;
        window._jumpRenderEnd   = -1;
    } else {
        // ★ 正常初始化：按"可见气泡数"计算切片
        start = _calcInitialStart(chat);  // 同时更新 currentPage
        end   = totalMessages;
    }
    // 全量重绘：两端游标都重置为本次切片的真实边界
    window._renderTopCeil     = start;
    window._renderBottomFloor = end;
} else {
    // ★ 上翻：end 用显式游标（DOM 实际顶 ∩ 游标），不再用 total-(currentPage-1)*PAGE 反推。
    //   反推公式把窗口锚在数组末尾，跳转/新消息导致数组长度变化后会在顶部边界漏掉几十条。
    end   = _getOlderRenderEnd(chat);
    start = Math.max(0, end - MESSAGES_PER_PAGE);
    window._renderTopCeil = start;
}

// currentPage 现已退化为派生量（外部多处仍在写 currentPage = 1 再全量重绘，保持兼容）：
// 语义 = 已渲染窗口顶部距数组末尾有几页
currentPage = Math.max(1, Math.ceil((totalMessages - start) / MESSAGES_PER_PAGE));

const messagesToRender = chat.history.slice(start, end);

    if (!isLoadMore) {
        if (typeof releaseImageObjectUrlsWithin === 'function') releaseImageObjectUrlsWithin(messageArea);
        messageArea.innerHTML = '';
    } else {
        // 如果是加载更多，先移除可能存在的 loading 指示器（如果有的话）
        const loader = messageArea.querySelector('.history-loading-indicator');
        if (loader) loader.remove();
    }

    const fragment = document.createDocumentFragment();

    // 2. 如果还有更早的消息，先在顶部插入一个 Loading 指示器
    //    这不仅是视觉提示，也是占位符，防止瞬间拉到顶触发多次
    if (start > 0) {
        const loadingDiv = document.createElement('div');
        loadingDiv.className = 'history-loading-indicator';
        
        // 插入 CSS 画出的 Spinner
        loadingDiv.innerHTML = `<div class="custom-spinner"></div>`;
        // 添加一个简单的旋转动画css到你的css文件里： .spin { animation: spin 1s linear infinite; } @keyframes spin { 100% { transform: rotate(360deg); } }
        fragment.appendChild(loadingDiv);
    }

// 3. 渲染消息气泡
    // --- 预扫描：识别当前页面中需要折叠的完整通话 session ---
    const callSessionsToFold = new Map();  // sessionId → {range, isSentByUser, firstMsgId}
    const skippedMsgIds = new Set();

    if (currentChatType === 'private') {
        // 收集本页所有带 callSessionId 的 session
        const sessionIds = new Set(
            messagesToRender
                .filter(m => m.callSessionId && !m.isHidden)
                .map(m => m.callSessionId)
        );

for (const sid of sessionIds) {
    const range = getCallSessionRange(chat.history, sid);
    if (!range || range.msgs.length === 0) continue;

    const isComplete = range.msgs.some(m =>
    m.id?.includes('_end_vis_') || m.id?.includes('_interrupt_vis_') || m.id?.includes('_decline_vis_') || m.id?.includes('_noanswer_'));
    if (!isComplete) continue;

    // ★ 【修改点3】：loadMore 时，增加对 expanded-container 容器存在与否的判断
    if (isLoadMore) {
        const alreadyInDom =
            messageArea.querySelector(`.collapsed-call-bubble[data-call-session-id="${sid}"]`) ||
            messageArea.querySelector(`[data-call-session-expanded-container="${sid}"]`) ||
            messageArea.querySelector(`[data-call-session-expanded="${sid}"]`);
        if (alreadyInDom) {
            range.msgs.forEach(m => skippedMsgIds.add(m.id));
            continue;
        }
    }

    const isSentByUser = range.msgs.some(m => m.id?.includes('_start_vis_'));
    const firstInPage = messagesToRender.find(m =>
        !m.isHidden && range.msgs.some(r => r.id === m.id));
    if (!firstInPage) continue;

    callSessionsToFold.set(sid, { range, isSentByUser, firstMsgId: firstInPage.id });
    range.msgs.forEach(m => skippedMsgIds.add(m.id));
}
    } // 关闭 if (currentChatType === 'private')

    let renderedCount = 0; // 统计本页实际渲染的气泡数（不含 loading indicator）

    messagesToRender.forEach(msg => {
        if (msg.isHidden) return;

        if (isLoadMore) {
            const existingBubble = messageArea.querySelector(`.message-wrapper[data-id="${msg.id}"]`);
            if (existingBubble) return;
        }

        // 属于折叠 session 的消息：只在第一条位置插入折叠气泡
        if (skippedMsgIds.has(msg.id)) {
            for (const [sid, info] of callSessionsToFold.entries()) {
                if (info.firstMsgId === msg.id) {
                    const collapsed = createCollapsedCallBubble(sid, info.range.msgs, info.isSentByUser);
                    if (forceScrollToBottom) collapsed.classList.add('new-message-anim');
                    fragment.appendChild(collapsed);
                    renderedCount++;
                }
            }
            return;
        }

        const bubble = createMessageBubbleElement(msg);
        if (bubble) {
            if (forceScrollToBottom) bubble.classList.add('new-message-anim');
            fragment.appendChild(bubble);
            renderedCount++;
        }
    });

    // 4. 将新消息插入到 DOM
    if (!isLoadMore) {
        messageArea.appendChild(fragment);
    } else {
        messageArea.prepend(fragment);
    }

    // ============================================================
    // 滚动逻辑控制 (修复版)
    // ============================================================
    
    if (forceScrollToBottom) {
        // --- 场景 A：发送/接收新消息 ---
        // 开启平滑滚动动画
        messageArea.style.scrollBehavior = 'smooth';
        requestAnimationFrame(() => {
             messageArea.scrollTop = messageArea.scrollHeight;
        });

    } else if (isLoadMore) {
        // --- 场景 B：加载历史记录 ---
        // 瞬间跳转，维持当前视觉位置
        messageArea.style.scrollBehavior = 'auto';
        const newScrollHeight = messageArea.scrollHeight;
        messageArea.scrollTop = newScrollHeight - oldScrollHeight + oldScrollTop;
        isLoadingHistory = false;

        // ★ 空页自动穿透：整页消息全被折叠/跳过，DOM 高度不变 → 自动再加载一页
        if (renderedCount === 0 && start > 0) {
            setTimeout(() => loadMoreMessages(), 0);
        }

    // --- 找到 renderMessages 函数末尾的 else 分支，完全替换该块内容 ---

} else {
        // --- 场景 C：初始化进入聊天室 (终极修复版) ---
        
        // 1. 基础设置：关闭动画，瞬间跳转
        messageArea.style.scrollBehavior = 'auto';
        
        // 定义一个强制到底的函数
        const forceToBottom = () => {
            messageArea.scrollTop = messageArea.scrollHeight;
        };

        // 2. 立即执行一次
        forceToBottom();

        // 3. 延迟一小会儿再执行一次 (应对 DOM 渲染延迟)
        setTimeout(forceToBottom, 50);

// 4. 【核心修复】针对所有图片的"无死角"监听
        const images = messageArea.querySelectorAll('img');
        
        if (images.length > 0) {
            // 💡 声明一个变量用于防抖
            let scrollTimeout = null;
            // 💡 封装一个防抖的滚动函数
            const debouncedScroll = () => {
                if (scrollTimeout) clearTimeout(scrollTimeout);
                scrollTimeout = setTimeout(() => {
                    requestAnimationFrame(forceToBottom);
                }, 30); // 30ms 内如果有多张图片连续加载完成，只会执行最后一次滚动
            };

            images.forEach(img => {
                if (img.complete) {
                    debouncedScroll();
                } else {
                    img.addEventListener('load', debouncedScroll);
                    img.addEventListener('error', debouncedScroll);
                }
            });
        }
    }
}

function loadMoreMessages() {
    if (isLoadingHistory) return; // 如果正在加载，直接退出
    isLoadingHistory = true;      // 设为正在加载

    // 稍微给一点延迟（例如 200ms），让 Loading 图标能显示出来一瞬间，
    // 否则本地渲染太快，用户可能感觉不到加载动作，体验反而生硬
    setTimeout(() => {
        // ★ 不再 currentPage++：切片边界由 _renderTopCeil 决定，currentPage 由 renderMessages 派生
        renderMessages(true, false);
    }, 200);
}

// === Step 3：懒加载模式下，翻到内存窗口顶部时从 DB 取更旧的一页 ===
async function loadOlderFromDB() {
    if (isLoadingHistory) return;
    const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
    if (!chat || !chat.history || chat.history.length === 0) return;
    isLoadingHistory = true;

    // 顶部 Loading 指示（复用现有样式）
    const topLoader = document.createElement('div');
    topLoader.className = 'history-loading-indicator';
    topLoader.innerHTML = `<div class="custom-spinner"></div>`;
    messageArea.insertBefore(topLoader, messageArea.firstChild);

    const chatIdAtStart = currentChatId; // ★ 下面有 await，中途切会话必须放弃本次渲染
    try {
        const oldestTs = chat.history[0].timestamp || 0;
        const inMemoryIds = new Set(chat.history.map(m => m.id));
        const DB_FETCH_CHUNK = 200; 
        const older = await window.fetchOlderMessages(chatIdAtStart, oldestTs, inMemoryIds, DB_FETCH_CHUNK);
        topLoader.remove();
        if (currentChatId !== chatIdAtStart) { isLoadingHistory = false; return; } // 已切会话，作废
        if (!older || older.length === 0) {
            chat._noMoreOlderInDB = true; // 真到头了，本次会话不再查
            isLoadingHistory = false;
            return;
        }
        // 前插到 chat.history（older 已升序且 timestamp 全 <= oldestTs，不整体重排，避免打乱已渲染 DOM）
        chat.history.unshift(...older);
        // ★ 前插 N 条 → DOM 内容没变但所有下标整体后移 N，两端游标同步平移
        window._renderTopCeil     = (window._renderTopCeil || 0) + older.length;
        window._renderBottomFloor = (window._renderBottomFloor || 0) + older.length;
        // 复用现有渲染路径：renderMessages(true) 会按 _renderTopCeil 切出这一页并前插到 DOM
        renderMessages(true, false); // 其内部会把 isLoadingHistory 置回 false
    } catch (e) {
        console.error('❌ [懒加载] 加载更旧消息失败:', e);
        topLoader.remove();
        isLoadingHistory = false;
    }
}

// === 新增：后台无感预加载 DB 数据 ===
async function preloadOlderFromDBInBackground(chat) {
    if (isFetchingDB || chat._noMoreOlderInDB) return;
    isFetchingDB = true; // 上锁，防止重复查库

    const chatIdAtStart = currentChatId; // ★ 下面有 await；游标属于"当前会话"，切走了就不能再动
    try {
        const oldestTs = chat.history[0].timestamp || 0;
        const inMemoryIds = new Set(chat.history.map(m => m.id));
        
        // 每次偷偷进货 200 条
        const DB_FETCH_CHUNK = 200; 
        const older = await window.fetchOlderMessages(chatIdAtStart, oldestTs, inMemoryIds, DB_FETCH_CHUNK);

        if (!older || older.length === 0) {
            chat._noMoreOlderInDB = true; // 数据库到底了
        } else {
            // ★ 重点：只把数据塞进内存，绝对不触碰 DOM
            chat.history.unshift(...older);
            // ★ 但下标整体后移了 N，游标必须同步平移，否则下次上翻/下翻会切错位置
            //   （若期间已切到别的会话，游标已属于新会话，绝不能平移）
            if (currentChatId === chatIdAtStart) {
                window._renderTopCeil     = (window._renderTopCeil || 0) + older.length;
                window._renderBottomFloor = (window._renderBottomFloor || 0) + older.length;
            }
        }
    } catch (e) {
        console.error('❌ [懒加载] 后台预加载更旧消息失败:', e);
    } finally {
        isFetchingDB = false; // 解锁
    }
}

// === 新增函数 1：触发加载后续消息 ===
async function loadNewerMessages() {
    if (isLoadingHistory) return;

    const chat = (currentChatType === 'private')
        ? db.characters.find(c => c.id === currentChatId)
        : db.groups.find(g => g.id === currentChatId);
    if (!chat || !chat.history) return;

    // ★ 先算起点再决定要不要转圈：已经贴着最新就直接校正游标退出，不再空转 500ms
    const start = _getNewerRenderStart(chat);
    if (start >= chat.history.length) {
        window._renderBottomFloor = chat.history.length;
        return;
    }

    isLoadingHistory = true;

    // 底部 Loading 指示器
    const bottomLoader = document.createElement('div');
    bottomLoader.className = 'history-loading-indicator bottom-loader';
    bottomLoader.innerHTML = `<div class="custom-spinner"></div>`;
    messageArea.appendChild(bottomLoader);

    try {
        await renderNewerMessages(start);
    } catch (e) {
        console.error('❌ [懒加载] 向下加载失败:', e);
    } finally {
        if (bottomLoader) bottomLoader.remove();
        isLoadingHistory = false;
    }
}

// === 新增函数 2：渲染后续消息 (追加到底部) ===
async function renderNewerMessages(startIndex) {
    const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
    if (!chat || !chat.history) return;

    const chatIdAtStart = currentChatId; // ★ 下面有 await，中途切会话必须放弃本次渲染
    let start = (typeof startIndex === 'number') ? startIndex : _getNewerRenderStart(chat);

    // ★★★ 缝隙回填（本次 bug 的根治点）
    //   搜索跳转会把"目标附近 300 条"merge 进只有最近 1500 条的 chat.history，
    //   数组中间因此出现一个洞（洞里的消息只在 DB）。往下翻如果只按下标 slice，
    //   就会从洞的上沿直接跳到下沿——用户看到 8/10 后面直接接 8/12，中间整天消失。
    //   所以这一页以 DB 为准：拉一页真序回来，跟内存从 start 开始归并，
    //   凡是内存里缺的就地插进去。洞在页首还是页中间都能兜住。
    if (window.LAZY_LOAD && typeof window.fetchNewerMessages === 'function'
        && start > 0 && start <= chat.history.length) {
        try {
            const prevTs = chat.history[start - 1].timestamp || 0;
            const dbRows = await window.fetchNewerMessages(chatIdAtStart, prevTs, MESSAGES_PER_PAGE);
            if (currentChatId !== chatIdAtStart) return; // 已切到别的会话，本次结果作废

            const inMemoryIds = new Set(chat.history.map(m => m.id));
            let ptr = start;   // 内存指针
            let filled = 0;    // 本页补进内存的条数
            for (const row of dbRows) {
                if (ptr - start >= MESSAGES_PER_PAGE) break;     // 本页够了
                if (ptr < chat.history.length && chat.history[ptr].id === row.id) {
                    ptr++;      // 内存里有且位置吻合 → 指针前进
                    continue;
                }
                if (inMemoryIds.has(row.id)) continue;            // 已在内存别处（含上沿本身/等时间戳边界）
                chat.history.splice(ptr, 0, row);                 // 内存里缺 → 就地补上
                inMemoryIds.add(row.id);
                ptr++;
                filled++;
            }
            if (filled > 0) {
                console.log(`🕳️ [懒加载] 向下翻发现内存缝隙，已回填 ${filled} 条（起点下标 ${start}）`);
                if (typeof window.assertHistoryOrder === 'function') {
                    window.assertHistoryOrder(chat, 'scroll-down-gapfill');
                }
            }
        } catch (e) {
            console.error('❌ [懒加载] 缝隙回填失败:', e);
        }
    }

    const totalMessages = chat.history.length;
    const end = Math.min(totalMessages, start + MESSAGES_PER_PAGE);
    if (end <= start) {
        window._renderBottomFloor = totalMessages;
        return;
    }

    const messagesToRender = chat.history.slice(start, end);

    const fragment = document.createDocumentFragment();

    // --- 预扫描：识别新页中需要折叠的完整通话 session ---
    const callSessionsToFold = new Map();
    const skippedMsgIds = new Set();

    if (currentChatType === 'private') {
        const sessionIds = new Set(
            messagesToRender
                .filter(m => m.callSessionId && !m.isHidden)
                .map(m => m.callSessionId)
        );

        for (const sid of sessionIds) {
            const range = getCallSessionRange(chat.history, sid);
            if (!range || range.msgs.length === 0) continue;

            const isComplete = range.msgs.some(m =>
    m.id?.includes('_end_vis_') || m.id?.includes('_interrupt_vis_') || m.id?.includes('_decline_vis_') || m.id?.includes('_noanswer_'));
            if (!isComplete) continue;

            // session 已在 DOM → 【修改点4】：同样增加对 expanded-container 容器的防重检查
            const alreadyInDom =
                messageArea.querySelector(`.collapsed-call-bubble[data-call-session-id="${sid}"]`) ||
                messageArea.querySelector(`[data-call-session-expanded-container="${sid}"]`) ||
                messageArea.querySelector(`[data-call-session-expanded="${sid}"]`);
            if (alreadyInDom) {
                range.msgs.forEach(m => skippedMsgIds.add(m.id));
                continue;
            }

            // session 首次出现在 DOM → 折叠
            const isSentByUser = range.msgs.some(m => m.id?.includes('_start_vis_'));
            const firstInPage = messagesToRender.find(m =>
                !m.isHidden && range.msgs.some(r => r.id === m.id));
            if (!firstInPage) continue;

            callSessionsToFold.set(sid, { range, isSentByUser, firstMsgId: firstInPage.id });
            range.msgs.forEach(m => skippedMsgIds.add(m.id));
        }
    }

    let renderedCount = 0; // 统计本页实际渲染的气泡数

    messagesToRender.forEach(msg => {
        if (msg.isHidden) return;

        // 防重检查
        const exists = messageArea.querySelector(`.message-wrapper[data-id="${msg.id}"]`);
        if (exists) return;

        // 属于折叠 session 的消息：只在第一条位置插入折叠气泡
        if (skippedMsgIds.has(msg.id)) {
            for (const [sid, info] of callSessionsToFold.entries()) {
                if (info.firstMsgId === msg.id) {
                    const collapsed = createCollapsedCallBubble(sid, info.range.msgs, info.isSentByUser);
                    fragment.appendChild(collapsed);
                    renderedCount++;
                }
            }
            return;
        }

        const bubble = createMessageBubbleElement(msg);
        if (bubble) {
            fragment.appendChild(bubble);
            renderedCount++;
        }
    });

    // 追加到底部
    messageArea.appendChild(fragment);

    // ★ 推进底部游标（这一页已覆盖到 end）
    window._renderBottomFloor = end;

    // ★ 空页自动穿透：整页都是隐藏/已折叠消息 → DOM 高度不变，用户没法再触发滚动，
    //   这里自动接着加载下一页（游标已前进，不会死循环）
    if (renderedCount === 0 && end < chat.history.length) {
        setTimeout(() => loadNewerMessages(), 0);
    }
}

            async function addMessageBubble(message, targetChatId, targetChatType) {
                // If the target chat is not the current chat, show a toast notification and do nothing else.
                if (targetChatId !== currentChatId || targetChatType !== currentChatType) {
                    const senderChat = (targetChatType === 'private')
                        ? db.characters.find(c => c.id === targetChatId)
                        : db.groups.find(g => g.id === targetChatId);

                    if (senderChat) {
                        // --- 从这里开始是新增的代码 ---
                        // 如果消息不是系统内部不可见的消息，才增加未读计数
                        // --- 从这里开始是新增的代码 ---
// 如果消息不是系统内部不可见的消息，才增加未读计数
const invisibleRegex = /\[system:.*\]|\[.*?更新状态为：.*?\]|\[.*?已接收礼物\]|\[.*?(?:接收|退回).*?的转账\]/;
if (!invisibleRegex.test(message.content)) {
    senderChat.unreadCount = (senderChat.unreadCount || 0) + 1;
    saveSingleChat(targetChatId, targetChatType); // 异步保存数据

    // 【优化1】立刻更新主页角标，0延迟，最快响应
    if (typeof updateHomeChatBadge === 'function') {
        updateHomeChatBadge();
    }

    // 【优化2】将耗时的“重绘聊天列表”任务延后 100 毫秒
    // 优先保证顶部的 Toast 提示框能够无比丝滑地弹出
    setTimeout(() => {
        if (typeof renderChatList === 'function') renderChatList(); 
    }, 100);
}


                        let senderName, senderAvatar;
                        if (targetChatType === 'private') {
                            senderName = senderChat.remarkName;
                            senderAvatar = senderChat.avatar;
                        } else { // Group chat
                            const sender = findGroupMemberById(senderChat, message.senderId);
                            if (sender) {
                                senderName = sender.groupNickname;
                                senderAvatar = sender.avatar;
                            } else { // Fallback for unknown sender (e.g. system message in group)
                                senderName = senderChat.name;
                                senderAvatar = senderChat.avatar;
                            }
                        }

                        let previewText = message.content;

                        // Extract clean text for preview
                        const textMatch = previewText.match(/\[.*?的消息：([\s\S]+?)\]/);
                        if (textMatch) {
                            previewText = textMatch[1];
                        } else {
                            // Handle other message types for preview
                            if (/\[.*?的表情包：.*?\]/.test(previewText)) previewText = '[表情包]';
                            else if (/\[.*?的语音：.*?\]/.test(previewText)) previewText = '[语音]';
                            else if (/\[.*?发来的照片\/视频：.*?\]/.test(previewText)) previewText = '[照片/视频]';
                            else if (/\[.*?的转账：.*?\]/.test(previewText)) previewText = '[转账]';
                            else if (/\[.*?送来的礼物：.*?\]/.test(previewText)) previewText = '[礼物]';
                            else if (/\[.*?发送了位置：.*?\]/.test(previewText)) previewText = '[位置]';
                            else if (/\[.*?发来了一张图片：\]/.test(previewText)) previewText = '[图片]';
                            else if (message.parts && message.parts.some(p => p.type === 'html')) previewText = '[互动]';
                        }

                        showToast({
                            avatar: senderAvatar,
                            name: senderName,
                            message: previewText.substring(0, 30)
                        });
                    }
                    return; // IMPORTANT: Stop further execution
                }

                // --- Original logic for when the chat is active ---
                if (currentChatType === 'private') {
                    const character = db.characters.find(c => c.id === currentChatId);
                    const updateStatusRegex = new RegExp(`\\[${character.realName}更新状态为：(.*?)\\]`);
                    const transferActionRegex = new RegExp(`\\[${character.realName}(接收|退回)${character.myName}的转账\\]`);
                    const giftReceivedRegex = new RegExp(`\\[${character.realName}已接收礼物\\]`);

                    if (message.content.match(updateStatusRegex)) {
                        character.status = message.content.match(updateStatusRegex)[1];
                        const statusEl = document.getElementById('chat-room-status-text');
if (statusEl) statusEl.textContent = character.status;
                        await saveSingleChat(currentChatId, currentChatType);
                        return;
                    }
                    if (message.content.match(giftReceivedRegex) && message.role === 'assistant') {
                        const lastPendingGiftIndex = character.history.slice().reverse().findIndex(m => m.role === 'user' && m.content.includes('送来的礼物：') && m.giftStatus !== 'received');
                        if (lastPendingGiftIndex !== -1) {
                            const actualIndex = character.history.length - 1 - lastPendingGiftIndex;
                            const giftMsg = character.history[actualIndex];
                            giftMsg.giftStatus = 'received';
                            const giftCardOnScreen = messageArea.querySelector(`.message-wrapper[data-id="${giftMsg.id}"] .gift-card`);
                            if (giftCardOnScreen) {
                                giftCardOnScreen.classList.add('received');
                            }
                            await saveMessageToDB(giftMsg, currentChatId, currentChatType);
                            await saveSingleChat(currentChatId, currentChatType);
                        }
                        return;
                    }
                    if (message.content.match(transferActionRegex) && message.role === 'assistant') {
                        const action = message.content.match(transferActionRegex)[1];
                        const statusToSet = action === '接收' ? 'received' : 'returned';
                        const lastPendingTransferIndex = character.history.slice().reverse().findIndex(m => m.role === 'user' && m.content.includes('给你转账：') && m.transferStatus === 'pending');
                        if (lastPendingTransferIndex !== -1) {
                            const actualIndex = character.history.length - 1 - lastPendingTransferIndex;
                            const transferMsg = character.history[actualIndex];
                            transferMsg.transferStatus = statusToSet;
                            const transferCardOnScreen = messageArea.querySelector(`.message-wrapper[data-id="${transferMsg.id}"] .transfer-card`);
                            if (transferCardOnScreen) {
                                transferCardOnScreen.classList.remove('received', 'returned');
                                transferCardOnScreen.classList.add(statusToSet);
                                const statusElem = transferCardOnScreen.querySelector('.transfer-status');
                                if (statusElem) statusElem.textContent = statusToSet === 'received' ? '已收款' : '已退回';
                            }
                            await saveMessageToDB(transferMsg, currentChatId, currentChatType);
                            await saveSingleChat(currentChatId, currentChatType);
                        }
                    } else {
                        const bubbleElement = createMessageBubbleElement(message);
                        if (bubbleElement) {
                            
 bubbleElement.classList.add('new-message-anim');                           messageArea.appendChild(bubbleElement);
                                    // B. 【核心修复】强制开启平滑滚动，覆盖掉进入房间时的 'auto'
        messageArea.style.scrollBehavior = 'smooth';
        

        requestAnimationFrame(() => {
            messageArea.scrollTop = messageArea.scrollHeight;
        });
                        }
                    }
                } else { // For group chats
                    const bubbleElement = createMessageBubbleElement(message);
                    if (bubbleElement) {
   bubbleElement.classList.add('new-message-anim');                     
                        messageArea.appendChild(bubbleElement);
                                // C. 执行滚动
        // C. 执行滚动
        requestAnimationFrame(() => {
            messageArea.scrollTop = messageArea.scrollHeight;
        });
                    }
                }
            }

// 新增公共辅助函数：获取最后一条真正的互动消息
// 新增公共辅助函数：获取最后一条真正的互动消息
function getLastValidInteractMsg(chat) {
    if (!chat || !chat.history || chat.history.length === 0) return null;
    
    for (let i = chat.history.length - 1; i >= 0; i--) {
        const msg = chat.history[i];
        if (msg.role === 'user' || msg.role === 'assistant') {
            const isTimeSense = msg.id && (msg.id.includes('msg_context_timesense') || msg.id.includes('msg_visual_timesense'));
            const isModeInstruction = msg.id && msg.id.includes('msg_ins_');
            const isSystemCommand = typeof msg.content === 'string' && msg.content.trim().startsWith('[system:');
            const isSystemDisplay = typeof msg.content === 'string' && msg.content.trim().startsWith('[system-display:');
            const isTimeDivider = typeof msg.content === 'string' && msg.content.trim() === '[time-divider]';
            const isAiIgnore = msg.isAiIgnore === true;
            
            // 明确排除用户的全局状态通知
            const isUserStatusNotif = msg.isUserStatusNotif === true;  
            // 【新增兼容】兜底判断旧版本没有打上 isUserStatusNotif 标记的用户状态消息
            const isOldUserStatus = msg.role === 'user' && typeof msg.content === 'string' && /\[.*?更新状态为：.*?\]/.test(msg.content);

            // 排除了所有隐藏提示、单纯系统UI、以及【用户状态通知】，剩下的才是真正的聊天互动
            if (!isTimeSense && !isModeInstruction && !isSystemCommand && !isSystemDisplay && !isTimeDivider && !isAiIgnore && !isUserStatusNotif && !isOldUserStatus) {
                return msg; 
            }
        }
    }
    return null;
}

async function processTimePerception(chat, chatId, chatType, isAiReplyTrigger = false) {
    if (!chat.timePerceptionEnabled) return;

    // 1. 直接调用提取出来的公共函数
    const lastValidMsg = getLastValidInteractMsg(chat);
    if (!lastValidMsg) return;

    const now = new Date();
    const timeGap = now.getTime() - lastValidMsg.timestamp;
    const thirtyMinutes = 30 * 60 * 1000;
    
    // 2. 只有超过30分钟才插入 [time-divider] 和 AI提示词
    if (timeGap > thirtyMinutes) {
        // ✅ 新增：检查 lastValidMsg 之后是否已存在时间感知消息，避免重复注入
        const lastValidIndex = chat.history.findIndex(m => m.id === lastValidMsg.id);
        const alreadyInjected = chat.history.slice(lastValidIndex + 1).some(
            m => m.id && m.id.includes('msg_context_timesense')
        );
        if (alreadyInjected) return;

        const visualMessage = {
            id: `msg_visual_timesense_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
            role: 'system',
            content: `[time-divider]`,
            parts: [{ type: 'text', text: '[time-divider]' }],
            timestamp: now.getTime() - 2 
        };

const contextContent = `[系统情景通知：距离上一次互动已经过去${formatTimeGap(timeGap)}。当前时刻是${getFormattedTimestamp(now)}。请注意这段时间流逝带来的情境和心理变化，结合上下文自然地继续互动。]`;
        
        const contextMessage = {
            id: `msg_context_timesense_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`, 
            role: 'user', 
            content: contextContent,
            parts: [{ type: 'text', text: contextContent }],
            timestamp: now.getTime() - 1 
        };

        if (chatType === 'group') {
            visualMessage.senderId = 'user_me';
            contextMessage.senderId = 'user_me';
        }

        chat.history.push(visualMessage, contextMessage);
        addMessageBubble(visualMessage, chatId, chatType);
        await saveMessagesToDB([visualMessage, contextMessage], chatId, chatType);
    }
}


            async function sendMessage() {
                const text = messageInput.value.trim();
                if (!text || isGenerating) return;
                if (!currentChatType && currentChatId) {
        currentChatType = currentChatId.startsWith('char_') ? 'private' : 'group';
    }
                // ★ 视图停在历史里（含搜索跳转后停在几天前）时，先重置回最新，
                //   否则新气泡会被追加到"几天前"那段 DOM 的下面。
                //   原来判断 currentPage > 1，跳转后该值不可靠且到底后不会复位。
                if (!_isViewingLatest()) {
        currentPage = 1;
        // 重新渲染整个页面为最新状态，或者您可以选择仅提示用户
        renderMessages(false, true); 
    }
                
                const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
                
                if (chat && chat.proactiveMessageQueue) {
        // 用户发言：撤销该会话在 CF 上的待发推送（summary/idle 作废，peek 也一并撤，未启用则内部跳过）
        if (window.PushNode && typeof window.PushNode.cancelChat === 'function') {
            window.PushNode.cancelChat(chat).catch(() => {});
        }
        chat.proactiveMessageQueue = chat.proactiveMessageQueue.filter(m =>
            m.type !== 'time_window_summary' && m.type !== 'time_window_idle'
        );
    }

// 这行代码确保了“时间流逝提示”永远出现在“你的新消息”上方
    await processTimePerception(chat, currentChatId, currentChatType);
    // -----------------------------------------------------
    messageInput.value = ''; // Clear input immediately for better UX

                let messageContent;
                const systemRegex = /\[system:[\s\S]*?\]|\[system-display:.*?\]/;
                const inviteRegex = /\[.*?邀请.*?加入群聊\]/;
                const renameRegex = /\[(.*?)修改群名为“(.*?)”\]/;
                const myName = (currentChatType === 'private') ? chat.myName : chat.me.realName;

                if (renameRegex.test(text)) {
                    const match = text.match(renameRegex);
                    chat.name = match[2];
                    chatRoomTitle.textContent = chat.name;
                    messageContent = `[${chat.me.nickname}修改群名为“${chat.name}”]`;
                } else if (systemRegex.test(text) || inviteRegex.test(text)) {
                    messageContent = text;
                } else {
                    let userText = text;

                    messageContent = `[${myName}的消息：${userText}]`;
                }

                const message = {
                    id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
                    role: 'user',
                    content: messageContent,
                    parts: [{ type: 'text', text: messageContent }],
                    timestamp: Date.now()
                };

                // 新增：附加引用信息
                if (currentQuoteInfo) {
                    message.quote = {
                        messageId: currentQuoteInfo.id,
                        senderId: currentQuoteInfo.senderId, // 存储senderId用于查找昵称
                        content: currentQuoteInfo.content
                    };
                }

                if (currentChatType === 'group') {
                    message.senderId = 'user_me';
                }
   if (currentChatType === 'private' && chat.currentCallSessionId) {
    message.callSessionId = chat.currentCallSessionId;
}             
                chat.history.push(message);

                // ★★★ 落库铁律 ★★★
                //   消息进了内存，就必须落库。push 与 saveMessageToDB 之间不允许出现任何
                //   会同步抛异常的语句，可选逻辑一律套 try/catch。
                //
                //   历史 Bug（用户消息偶发丢失的根因）：这里原先在写库之前调用了一个
                //   从未定义过的 promptForBackupIfNeeded('history_milestone')，
                //   条件是 chat.history.length % 100 === 0 —— 每满 100 条触发一次
                //   ReferenceError，把后面的 saveMessageToDB / saveSingleChat 全部掀翻。
                //   于是：消息在内存里、气泡在屏幕上、AI 也读得到并正常回复，
                //   但数据库里从来没有过它。重开 App 后用户消息消失、AI 的回复还在，
                //   表现就是"最后一次对话的倒数第二条丢了"，且只发生在普通文字消息上
                //   （贴纸/图片/转账等走 chat_feature_basic.js，没有这段代码）。
                //   三个调用点（click / touchend / Enter）都是 fire-and-forget，
                //   异常只是静默的 unhandled rejection，界面上毫无征兆。

                // 气泡先上屏，保持发送手感（async 函数未 await，其内部异常不会波及本函数）
                try {
                    addMessageBubble(message, currentChatId, currentChatType);
                    if (currentChatType === 'private' && chat.callMode && typeof appendCallUserMessage === 'function') {
                        appendCallUserMessage(text);
                    }
                } catch (e) {
                    console.error('⚠️ [sendMessage] 气泡渲染失败，但消息仍会正常落库：', e);
                }

                // 关键路径：写库。上面无论出什么事都必须执行到这里。
                await saveMessageToDB(message, currentChatId, currentChatType);
                await saveSingleChat(currentChatId, currentChatType);

                // 收尾的非关键逻辑，同样不允许影响已落库的消息
                try {
                    renderChatList();
                    // 新增：发送后清空引用状态
                    if (currentQuoteInfo) {
                        cancelQuoteReply();
                    }
                } catch (e) {
                    console.error('⚠️ [sendMessage] 消息已成功落库，但收尾步骤出错：', e);
                }
            }
            
            // 辅助函数1：格式化时间戳 YYYY-MM-DD HH:MM:SS
            function getFormattedTimestamp(date) {
                const Y = date.getFullYear();
                const M = String(date.getMonth() + 1).padStart(2, '0');
                const D = String(date.getDate()).padStart(2, '0');
                const h = String(date.getHours()).padStart(2, '0');
                const m = String(date.getMinutes()).padStart(2, '0');
                const s = String(date.getSeconds()).padStart(2, '0');
                return `${Y}-${M}-${D} ${h}:${m}:${s}`;
            }

            // 辅助函数2：格式化时间差
            function formatTimeGap(milliseconds) {
                const seconds = Math.floor(milliseconds / 1000);
                const minutes = Math.floor(seconds / 60);
                const hours = Math.floor(minutes / 60);
                const days = Math.floor(hours / 24); if (days > 0) return `${days}天${hours % 24}小时`;
                if (hours > 0) return `${hours}小时${minutes % 60}分钟`;
                if (minutes > 0) return `${minutes}分钟`;
                return `${seconds}秒`;
            }
            
// 新增辅助函数：智能格式化时间（类似微信的时间轴风格）
function formatSmartTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    
    // 判断是否同一天
    const isSameDay = (d1, d2) => d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
    
    // 计算“昨天”的日期
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);

    const padZero = (num) => num.toString().padStart(2, '0');
    const timeStr = `${padZero(date.getHours())}:${padZero(date.getMinutes())}`;
    
    if (isSameDay(date, now)) {
        return timeStr; // 今天只显示 12:01
    } else if (isSameDay(date, yesterday)) {
        return `昨天 ${timeStr}`; // 昨天
    } else if (date.getFullYear() === now.getFullYear()) {
        return `${date.getMonth() + 1}月${date.getDate()}日 ${timeStr}`; // 同一年
    } else {
        return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${timeStr}`; // 跨年
    }
}            

            // --- NEW: Chat Expansion Panel ---
            function setupChatExpansionPanel() {
                const expansionGrid = document.getElementById('chat-expansion-grid');
                const expansionItems = [
                    {
                        id: 'memory-journal',
                        name: '记忆档案',
                        icon: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
  <path fill-rule="evenodd" d="
    M4,0 h16 a2,2 0 0 1 2,2 v20 a2,2 0 0 1 -2,2 H4 a2,2 0 0 1 -2,-2 V2 a2,2 0 0 1 2,-2 z

    M9,3 h10 a1,1 0 0 1 1,1 v16 a1,1 0 0 1 -1,1 H9 a1,1 0 0 1 -1,-1 V4 a1,1 0 0 1 1,-1 z

    M3,6 h4 a0.5,0.5 0 0 1 0.5,0.5 v0 a0.5,0.5 0 0 1 -0.5,0.5 H3 a0.5,0.5 0 0 1 -0.5,-0.5 v0 a0.5,0.5 0 0 1 0.5,-0.5 z

    M3,17 h4 a0.5,0.5 0 0 1 0.5,0.5 v0 a0.5,0.5 0 0 1 -0.5,0.5 H3 a0.5,0.5 0 0 1 -0.5,-0.5 v0 a0.5,0.5 0 0 1 0.5,-0.5 z

    M14,10 c-0.8-0.8-2.1-0.6-2.5,0.5 c-0.4,1.1 1.4,2.6 2.5,3.1 c1.1-0.5 2.9-2 2.5-3.1 C16.1,9.4 14.8,9.2 14,10 z
  "/>
</svg>`
                    },

                    {
                        id: 'send-gift-modal',
                        name: '赠送礼物',
                        icon: `<svg viewBox="0 0 24 24"><path d="M22,12V20A2,2 0 0,1 20,22H4A2,2 0 0,1 2,20V12A1,1 0 0,1 1,11V8A2,2 0 0,1 3,6H6.17C6.06,5.69 6,5.35 6,5A3,3 0 0,1 9,2C10,2 10.88,2.5 11.43,3.24V3.23L12,4L12.57,3.23V3.24C13.12,2.5 14,2 15,2A3,3 0 0,1 18,5C18,5.35 17.94,5.69 17.83,6H21A2,2 0 0,1 23,8V11A1,1 0 0,1 22,12M4,20H11V12H4V20M20,20V12H13V20H20M9,4A1,1 0 0,0 8,5A1,1 0 0,0 9,6A1,1 0 0,0 10,5A1,1 0 0,0 9,4M15,4A1,1 0 0,0 14,5A1,1 0 0,0 15,6A1,1 0 0,0 16,5A1,1 0 0,0 15,4M3,8V10H11V8H3M13,8V10H21V8H13Z" /></svg>`
                    },
                    {
                        id: 'time-skip-modal',
                        name: '剧情旁白',
                        icon: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M2.5 7.25C2.08579 7.25 1.75 7.58579 1.75 8C1.75 8.41421 2.08579 8.75 2.5 8.75V7.25ZM22 7.25H2.5V8.75H22V7.25Z" fill="#555" stroke="#555"/>
<path d="M10.5 2.5L7 8M17 2.5L13.5 8" stroke="#555" stroke-width="2" fill="none" stroke-linecap="round"/>
<path d="M15 14.5C15 13.8666 14.338 13.4395 13.014 12.5852C11.6719 11.7193 11.0008 11.2863 10.5004 11.6042C10 11.9221 10 12.7814 10 14.5C10 16.2186 10 17.0779 10.5004 17.3958C11.0008 17.7137 11.6719 17.2807 13.014 16.4148C14.338 15.5605 15 15.1334 15 14.5Z" stroke="#555" stroke-width="2" fill="none" stroke-linecap="round"/>
<path d="M22 12C22 16.714 22 19.0711 20.5355 20.5355C19.0711 22 16.714 22 12 22C7.28595 22 4.92893 22 3.46447 20.5355C2 19.0711 2 16.714 2 12C2 7.28595 2 4.92893 3.46447 3.46447C4.92893 2 7.28595 2 12 2C16.714 2 19.0711 2 20.5355 3.46447C21.5093 4.43821 21.8356 5.80655 21.9449 8" stroke="#555" stroke-width="2" fill="none" stroke-linecap="round"/>
</svg>`
                    },
                    {
                        id: 'offline-mode-settings',
                        name: '线下模式',
                        icon: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path fill-rule="evenodd" clip-rule="evenodd" d="M16 6C14.3432 6 13 7.34315 13 9C13 10.6569 14.3432 12 16 12C17.6569 12 19 10.6569 19 9C19 7.34315 17.6569 6 16 6ZM11 9C11 6.23858 13.2386 4 16 4C18.7614 4 21 6.23858 21 9C21 10.3193 20.489 11.5193 19.6542 12.4128C21.4951 13.0124 22.9176 14.1993 23.8264 15.5329C24.1374 15.9893 24.0195 16.6114 23.5631 16.9224C23.1068 17.2334 22.4846 17.1155 22.1736 16.6591C21.1979 15.2273 19.4178 14 17 14C13.166 14 11 17.0742 11 19C11 19.5523 10.5523 20 10 20C9.44773 20 9.00001 19.5523 9.00001 19C9.00001 18.308 9.15848 17.57 9.46082 16.8425C9.38379 16.7931 9.3123 16.7323 9.24889 16.6602C8.42804 15.7262 7.15417 15 5.50001 15C3.84585 15 2.57199 15.7262 1.75114 16.6602C1.38655 17.075 0.754692 17.1157 0.339855 16.7511C-0.0749807 16.3865 -0.115709 15.7547 0.248886 15.3398C0.809035 14.7025 1.51784 14.1364 2.35725 13.7207C1.51989 12.9035 1.00001 11.7625 1.00001 10.5C1.00001 8.01472 3.01473 6 5.50001 6C7.98529 6 10 8.01472 10 10.5C10 11.7625 9.48013 12.9035 8.64278 13.7207C9.36518 14.0785 9.99085 14.5476 10.5083 15.0777C11.152 14.2659 11.9886 13.5382 12.9922 12.9945C11.7822 12.0819 11 10.6323 11 9ZM3.00001 10.5C3.00001 9.11929 4.1193 8 5.50001 8C6.88072 8 8.00001 9.11929 8.00001 10.5C8.00001 11.8807 6.88072 13 5.50001 13C4.1193 13 3.00001 11.8807 3.00001 10.5Z"/></svg>`
                    },
                    {
                        id: 'proactive-messaging-settings',
                        name: '后台消息',
                        icon: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M8 12H8.009M11.991 12H12M15.991 12H16" stroke="#555" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
<path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 13.5997 2.37562 15.1116 3.04346 16.4525C3.22094 16.8088 3.28001 17.2161 3.17712 17.6006L2.58151 19.8267C2.32295 20.793 3.20701 21.677 4.17335 21.4185L6.39939 20.8229C6.78393 20.72 7.19121 20.7791 7.54753 20.9565C8.88837 21.6244 10.4003 22 12 22Z" stroke="#555" stroke-width="2" fill="none"/>
</svg>`
                    },
                    {
                        id: 'send-location-modal',
                        name: '发送位置',
                        icon: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M12 21.5C12 21.5 19 15.6 19 10C19 6.1 15.9 3 12 3C8.1 3 5 6.1 5 10C5 15.6 12 21.5 12 21.5Z" stroke="#555" stroke-width="2" fill="none" stroke-linejoin="round"/>
<circle cx="12" cy="10" r="2.6" stroke="#555" stroke-width="2"/>
</svg>`
                    },
                    {
            id: 'chat-search', // 这里的 ID 对应下面的 case
            name: '聊天搜索',
            icon: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path
                            d="M15.7955 15.8111L21 21M18 10.5C18 14.6421 14.6421 18 10.5 18C6.35786 18 3 14.6421 3 10.5C3 6.35786 6.35786 3 10.5 3C14.6421 3 18 6.35786 18 10.5Z"
                            stroke="#555" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none" />
                    </svg>`
        },
                    {
                        id: 'delete-history-chunk',
                        name: '批量删除',
                        icon: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M19 7L18.1327 19.1425C18.0579 20.1891 17.187 21 16.1378 21H7.86224C6.81296 21 5.94208 20.1891 5.86732 19.1425L5 7M10 11V17M14 11V17M15 7V4C15 3.44772 14.5523 3 14 3H10C9.44772 3 9 3.44772 9 4V7M4 7H20" stroke="#555" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
            </svg>`
                    }
                ];

                expansionGrid.innerHTML = '';
                expansionItems.forEach(item => {
                    const itemEl = document.createElement('div');
                    itemEl.className = 'expansion-item';
                    itemEl.dataset.action = item.id;

                    itemEl.innerHTML = `
                    <div class="expansion-item-icon">${item.icon}</div>
                    <span class="expansion-item-name">${item.name}</span>
                `;
                    expansionGrid.appendChild(itemEl);
                });

                // 激活状态（线下模式 / 后台消息）统一交给 syncChatExpansionActiveState，
                // 这里构建时先按当前会话对齐一次；之后每次开面板、每次进聊天室都会再对齐。
                syncChatExpansionActiveState();

                expansionGrid.addEventListener('click', (e) => {
                    const item = e.target.closest('.expansion-item');
                    if (!item) return;

                    const action = item.dataset.action;

                    // 线下模式下的线上功能：按数据判断，不依赖 DOM 上的置灰 class 是否刷新过
                    // （置灰用的是 class 而非 pointer-events:none，点击照样会走到这里）
                    if (OFFLINE_DISABLED_EXPANSION_ACTIONS.includes(action)
                        && typeof isOfflineModeActive === 'function' && isOfflineModeActive()) {
                        showToast('线下模式下无法使用该功能');
                        return;
                    }

switch (action) {
    case 'memory-journal':
        // 1. 重置主 Tab 为“剧情总结”
        currentMemoryTab = 'summary';
        
        // 2. 【关键】重置子 Tab 为“短期总结”，防止之前卡在长期总结页面
        currentSummarySubTab = 'short';
        
    // 3. 更新 Tab 按钮样式
    const allTabs = document.querySelectorAll('.mem-tab-btn');
    const journalTab = document.querySelector('.mem-tab-btn[data-tab="journal"]');
        allTabs.forEach(t => {
        if (t.dataset.tab === 'summary') t.classList.add('active');
        else t.classList.remove('active');
         // 重置状态
        t.style.opacity = '1';
        t.style.pointerEvents = 'auto';
        t.style.cursor = 'pointer';
    });
        // 【新增】如果是群聊，禁用日记 Tab
    if (currentChatType === 'group' && journalTab) {
        journalTab.style.opacity = '0.5';
        journalTab.style.pointerEvents = 'none';
        journalTab.style.cursor = 'not-allowed';
    }       

        // 4. 更新侧边栏样式
        const sidebarItems = document.querySelectorAll('.summary-sidebar-item');
        sidebarItems.forEach(item => {
             if (item.dataset.sub === 'short') item.classList.add('active');
             else item.classList.remove('active');
        });
        
        // 5. 显示侧边栏（因为是summary tab）
        const sidebar = document.getElementById('summary-sidebar');
        if(sidebar) sidebar.classList.remove('hidden');

        // 6. 渲染并跳转
        renderMemoryScreen();
        switchScreen('memory-journal-screen');
        break;

                        case 'chat-search':
                openSearchModal(); // 调用 chat_search.js 中的函数
                break;
                        case 'delete-history-chunk':
                            openDeleteChunkModal();
                            break;
                        case 'send-gift-modal':
                            // 打开礼物框
                            if (currentChatType === 'private') {
                                sendGiftForm.reset();
                                sendGiftModal.classList.add('visible');
                            } else if (currentChatType === 'group') {
                                currentGroupAction.type = 'gift';
                                renderGroupRecipientSelectionList('送礼物给');
                                groupRecipientSelectionModal.classList.add('visible');
                            }
                            break;
                        case 'send-location-modal':
                            // 打开发送位置弹窗（私聊/群聊直接发送，无需选收件人）
                            sendLocationForm.reset();
                            sendLocationModal.classList.add('visible');
                            break;
                        case 'time-skip-modal':
                            // 打开跳过时间

                            timeSkipForm.reset();
                            timeSkipModal.classList.add('visible');
                            break;
                        case 'offline-mode-settings':
                            openOfflineModeSettings();
                            break;
                        // ====== 【新增：点击触发逻辑】 ======
                        case 'proactive-messaging-settings':
                            if (typeof openProactiveMessagingSettings === 'function') {
                                openProactiveMessagingSettings();
                            } else {
                                // 兜底提示，防止我们还没写 js 就报错
                                showToast('正在初始化主动发消息模块...');
                            }
                            break;
                        // =================================
                            
                    }
                    // Hide panel after action
                    document.getElementById('chat-expansion-panel').classList.remove('visible');
                });
            }
