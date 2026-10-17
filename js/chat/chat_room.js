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

// 实时追加一条消息后把底部游标推到数组末尾 —— addMessageBubble 开头调它。
//
// ★ 为什么非得有这一步：底部游标原来只有三条路径在维护 —— 全量重绘(= history.length)、
//   前插平移、下翻分页。`addMessageBubble` 这条"实时追加"的路径（30+ 个调用点）一条都不占。
//   追加**可见**气泡时看不出问题，因为气泡自己就在 DOM 里，_getRenderedRange 能从 DOM 把底
//   反推出来；但只进 history、不进 DOM 的那些就漏了：
//     · 时间流逝一次 push 两条：`[time-divider]`(可见，画出来了) + `[系统情景通知：…]`(画不出来)，
//       游标停在时间戳那条，情景通知落在渲染窗口**之外**；
//     · `[X接收了Y的转账]` / `[…更新状态为：…]`：走 addMessageBubble 的早返回分支，只改状态不画气泡。
//   它们全落在 [_renderTopCeil, _renderBottomFloor) 外面 → _injectHiddenRows 扫不到 →
//   多选开「显示隐藏」看不见刚生成的那条，**退出聊天室再进才出现**（全量重绘把游标
//   重置成 history.length）。症状只在"刚生成的"那几条上，很容易误判成生成端没存盘。
//
// ★ 只在视图本来就贴着最新时才推。用户翻在历史里时推了，会让 _isViewingLatest 误判成
//   "在最新"，sendMessage 就不再重置回底部，新气泡被追加到几天前那段 DOM 的下面。
//   判据是「已覆盖到这条消息之前」(covered >= 它的下标)：调用时还没 append，贴底时
//   DOM 实际底恰好等于这条消息的下标，而同一批 push 的兄弟（时间流逝那两条）排在它
//   后面，一并被这次 history.length 覆盖进来。
function _advanceRenderFloorToLatest(message) {
    if (!message) return;
    const chat = (currentChatType === 'private')
        ? db.characters.find(c => c.id === currentChatId)
        : db.groups.find(g => g.id === currentChatId);
    if (!chat || !chat.history) return;
    const idx = chat.history.findIndex(m => m.id === message.id);
    if (idx === -1) return;                          // 还没 push 进 history，轮不到推游标
    if (_getNewerRenderStart(chat) < idx) return;    // 视图停在历史里，别动
    window._renderBottomFloor = Math.max(Number(window._renderBottomFloor) || 0, chat.history.length);
}

// 下面还有没有"值得渲染"的东西（用于滚动门槛）：
// 末尾常挂着 isHidden 的 context 消息，只看下标会导致反复空转转圈，所以要求至少有一条可见消息。
// ★ 例外：多选开了「显示隐藏」时看不见的消息**本身就是**要渲染的东西，这时候不能再把它们当空气 ——
//   否则末尾那串通话 [system:…] 永远翻不出来，而那恰恰是用户最想删的一批。
function _hasMoreNewerToRender(chat) {
    if (!chat || !chat.history) return false;
    const showHidden = isShowingHiddenMessages();
    const start = _getNewerRenderStart(chat);
    for (let i = start; i < chat.history.length; i++) {
        if (showHidden || !chat.history[i].isHidden) return true;
    }
    return false;
}

// ==========================================
// ★★★ 多选模式下的「显示隐藏」
//
// 判据是**「普通视图里画不出可勾选的气泡」**，不是 `isHidden`。这两者不等价，
// 而且差集正好是用户实际删不掉的那几类（都存在 history 里、批量删除按序号看得见）：
//   · `isHidden` 的上下文          `[system: 场景切换：…]`
//   · 不带 isHidden、但撞上气泡工厂 invisibleRegex 被 return null 的：
//       `[系统情景通知：距离上一次互动已经过去…]`（时间流逝提示）
//       `[小明接收了小猫的转账]` / `[…更新状态为：…]` / `[…已接收礼物]`
// 按字段分类过一版，结果就是漏掉后面那一整排。所以改成照常调 createMessageBubbleElement，
// **它画不出来才退回隐藏行** —— 以后再冒出新的"画不出来"的形状也自动被覆盖。
//
// 另外两类不是"画不出来"，而是"画出来了点不着"，各自单独修：
//   · `[time-divider]` 时间戳：有 .message-wrapper 和 data-id，但 CSS 写了
//     pointer-events:none。开关打开时用 .show-hidden-msgs 把它放开（见 chat_room.css）。
//   · 折叠的通话气泡：原先只有 data-call-session-id、没有 data-id，
//     toggleMessageSelection 拿到 undefined 直接 bail —— 点它什么都不会发生。
//     现在补了 data-id，且勾一下等于勾整段通话的全部消息（见 idsForMessageSelection）。
// ==========================================
function isShowingHiddenMessages() {
    return typeof isInMultiSelectMode !== 'undefined' && isInMultiSelectMode
        && typeof showHiddenInSelect !== 'undefined' && showHiddenInSelect;
}

// 渲染一条消息：能画正常气泡就画，画不出来的（isHidden / 撞 invisibleRegex）
// 在「显示隐藏」开着时退回极简行，否则照旧当空气。
// ★ isHidden 的不进气泡工厂：它们全是 role:'user'，走完整气泡会顶着用户头像渲染成
//   自己发的蓝气泡和真消息混在一起；旧数据里那条隐藏的 `[剧情旁白：…]` 还会被气泡工厂
//   认成旁白气泡，和它那条可见的 `[system-display:…]` 孪生叠成重影。
function _bubbleOrHiddenRow(msg) {
    const bubble = msg.isHidden ? null : createMessageBubbleElement(msg);
    if (bubble) return bubble;
    return isShowingHiddenMessages() ? createHiddenMessageRow(msg) : null;
}

// 折叠成一个气泡的那段通话。展开后的容器**不算** —— 那时 session 里每条各归各位。
function _collapsedCallNode(sid) {
    return sid
        ? messageArea.querySelector(`.collapsed-call-bubble[data-call-session-id="${sid}"]`)
        : null;
}

// 一段通话在 DOM 里的节点（折叠成一个气泡，或展开后的容器）
function _callSessionNode(sid) {
    if (!sid) return null;
    return _collapsedCallNode(sid)
        || messageArea.querySelector(`[data-call-session-expanded-container="${sid}"]`)
        || null;
}

// 【定位用】一条消息在 DOM 里落在哪个节点上。折叠通话气泡代表整段通话，session 里任一条都算它。
function _findRenderedNodeFor(msg) {
    if (!msg) return null;
    return messageArea.querySelector(`.message-wrapper[data-id="${msg.id}"]`)
        || _callSessionNode(msg.callSessionId);
}

// 【判据用】这条消息在 DOM 里"有没有被代表"。
// ★ 和上面那个**不是**一个问题，混用过一次就踩了坑（见下面折叠/展开的分野）。
function _isRepresentedInDom(msg) {
    if (!msg) return true;
    if (messageArea.querySelector(`.message-wrapper[data-id="${msg.id}"]`)) return true;

    // 折叠气泡 = 整段通话压成一条，**连里面的隐藏消息一起代表**。勾它就是勾整段
    // （idsForMessageSelection 按 callSessionId 筛 history，隐藏的也一并带走），
    // 所以块外面不该再补出任何一行。
    // ★ 这里一度写作 `!msg.isHidden && ...`，于是通话起止那两条隐藏指令
    //   （`[system: 场景切换：…]` / `[system: …已结束…]`）被判成"还没画"，补成了折叠块
    //   **外面**的两行 —— 一行在块前、一行在块后。后果不只是位置难看：用户去点那一行
    //   想"把它也选上"，而它早已被折叠块连带勾上了，这一点等于取消勾选，
    //   删完整块之后正好剩下这两条。
    // ★ 反过来也别整段免判：展开状态下隐藏消息必须照常补出来，
    //   漏了就是"开了显示隐藏，通话那段还是少几行"（这条是 _collapsedCallNode
    //   只认折叠气泡、不认展开容器的全部理由）。
    if (_collapsedCallNode(msg.callSessionId)) return true;

    // 展开状态：可见的那几条各自成气泡（上面第一个 querySelector 就命中了），
    // 走到这儿还没命中的是气泡工厂画不出来的，交给 _injectHiddenRows 补进容器里。
    return !msg.isHidden && !!_callSessionNode(msg.callSessionId);
}

// 勾一下要连带勾中哪些消息 id。
// 折叠的通话气泡是一整段通话压成的一个气泡，勾它就得勾这段通话的**全部**消息
// （含中间那几条隐藏的）—— 只勾首条的话，删完会剩下半段孤零零的通话，AI 那边也对不上。
// 这里按 callSessionId 直接筛 history，不走 getCallSessionRange：那个函数会滤掉
// isHidden 的，而隐藏的恰恰是这里必须一起带走的。
function idsForMessageSelection(el) {
    // 绑死在折叠气泡这个类上，而不是"有 data-call-session-id 就算"：
    // 通话展开后的单条气泡将来要是也挂上这个属性，连带勾选会静默打开 ——
    // 那时点一条却"已选择 5 项"、屏幕上只有一条高亮，对不上。
    const sid = (el && el.classList && el.classList.contains('collapsed-call-bubble'))
        ? el.dataset.callSessionId : null;
    if (!sid) return [el.dataset.id];
    const chat = (currentChatType === 'private')
        ? db.characters.find(c => c.id === currentChatId)
        : db.groups.find(g => g.id === currentChatId);
    const ids = ((chat && chat.history) || [])
        .filter(m => m.callSessionId === sid).map(m => m.id);
    return ids.length ? ids : [el.dataset.id];
}

// 开关隐藏行时保住视觉位置。
// ★ 不能图省事直接 renderMessages(false,false) 重绘：那条路走的是「场景 C 初始化」，
//   里面有 forceToBottom + 50ms 定时器 + 图片 onload 监听，会把用户翻了半天的
//   位置一路拽到底部。所以只增删隐藏行，再按锚点把 scrollTop 补回去。
function _withScrollAnchored(mutate) {
    const areaTop = messageArea.getBoundingClientRect().top;
    // 锚点只从"不会被这次增删动到"的元素里挑（隐藏行自己随时会被删掉）
    const candidates = messageArea.querySelectorAll(
        '.message-wrapper:not(.hidden-msg-wrapper), .collapsed-call-bubble');
    let anchor = null;
    for (const el of candidates) {
        if (el.getBoundingClientRect().bottom >= areaTop) { anchor = el; break; }
    }
    const before = anchor ? (anchor.getBoundingClientRect().top - areaTop) : 0;
    // 贴底时保持贴底：看不见的消息多半堆在末尾，新画出来的行就在那儿，锚点算法会把它们推出视野
    const atBottom = (messageArea.scrollHeight - messageArea.scrollTop - messageArea.clientHeight) < 40;

    mutate();

    messageArea.style.scrollBehavior = 'auto';
    if (atBottom) {
        messageArea.scrollTop = messageArea.scrollHeight;
    } else if (anchor && anchor.isConnected) {
        messageArea.scrollTop += (anchor.getBoundingClientRect().top - areaTop) - before;
    }
}

// 游标只许前进，不许倒退。
// ★ 折叠通话气泡代表整个 session，session 里**每一条**消息都回查到同一个气泡。
//   一段通话是「可见起点 → 隐藏若干条 → 可见终点 → 还有隐藏的收尾」，走到"可见终点"
//   时 _findRenderedNodeFor 又给出那个折叠气泡，游标就退回了通话气泡本身，
//   于是收尾那条被插在前面几条之前 —— 症状是隐藏行乱序（CALL h3 h1 h2）。
function _advanceCursor(cursor, node) {
    if (!node) return cursor;
    if (!cursor || node === cursor) return cursor || node;
    return (cursor.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)
        ? node : cursor;
}

// 把当前已渲染窗口 [_renderTopCeil, _renderBottomFloor) 内"没被 DOM 代表"的消息补成隐藏行。
// ★ 判据 _isRepresentedInDom 和渲染循环那边的 `_bubbleOrHiddenRow` 同源：
//   那边问"气泡工厂画得出来吗"，这边问"画出来的东西在不在"，两个问题同一个答案。
//   这样两条路径不会各持一套规则慢慢分叉（这仓库里"两条通道必须一致"已经栽过几次）。
// cursor 记着"上一条已处理消息的落点"，一路 after() 下去，这样连着好几条
// 也能保持时间顺序（每次都 insertBefore 下一个可见节点的话会插成倒序）。
function _injectHiddenRows(chat) {
    if (!chat || !chat.history) return;
    const h = chat.history;
    const top = Math.max(0, Number(window._renderTopCeil) || 0);
    // 底部取「游标 ∪ DOM 实际底」，和下翻那条路径共用 _getNewerRenderStart 这一套校正：
    // 游标是别人维护的，实时追加的气泡可能已经贴进 DOM 而游标还没跟上。读裸游标的话
    // 窗口会比屏幕上实际画出来的还窄，末尾几条补不出来。
    const bottom = Math.min(h.length, _getNewerRenderStart(chat));
    let cursor = null;

    for (let i = top; i < bottom; i++) {
        const msg = h[i];
        if (!msg) continue;
        if (_isRepresentedInDom(msg)) {
            cursor = _advanceCursor(cursor, _findRenderedNodeFor(msg));
            continue;
        }

        const row = createHiddenMessageRow(msg);
        if (!row) continue;
        // 这一条属于一段**展开着**的通话时，它的位置在容器里面。
        // ★ 尤其是打头那条隐藏的场景切换：游标此刻还停在通话之前的气泡上，
        //   照常 cursor.after() 会把它甩到容器外面 —— 正是折叠态那个老毛病的展开版。
        const expandedBox = msg.callSessionId
            ? messageArea.querySelector(`[data-call-session-expanded-container="${msg.callSessionId}"]`)
            : null;
        if (expandedBox && !(cursor && expandedBox.contains(cursor))) {
            expandedBox.prepend(row);
        } else if (cursor) {
            cursor.after(row);
        } else {
            // 窗口顶部就是看不见的消息：插在第一个气泡前面（loading 指示器要留在最上面）
            const first = messageArea.querySelector('.message-wrapper, .collapsed-call-bubble');
            if (first) first.before(row); else messageArea.appendChild(row);
        }
        cursor = row;
    }
}

// 把某个子树里的隐藏行从选中集里摘掉（不删行，只退勾选）。
// 行要被移出 DOM 之前调它：id 还留在 selectedMessageIds 里的话，屏幕上什么都没高亮，
// 删除时却会连着一条看不见的消息一起删。
function _unselectHiddenRowsIn(root) {
    if (!root || typeof selectedMessageIds === 'undefined') return;
    root.querySelectorAll('.hidden-msg-wrapper').forEach(el => {
        selectedMessageIds.delete(el.dataset.id);
    });
    if (typeof updateMultiSelectBar === 'function') updateMultiSelectBar();
}

function _removeHiddenRows() {
    messageArea.querySelectorAll('.hidden-msg-wrapper').forEach(el => {
        // 取消勾选：行没了但 id 还留在选中集里，会连着一条看不见的消息一起删
        if (typeof selectedMessageIds !== 'undefined' && selectedMessageIds.has(el.dataset.id)) {
            selectedMessageIds.delete(el.dataset.id);
        }
        el.remove();
    });
}

// showHiddenInSelect 改动后调它：把 DOM 对齐到新状态（不重绘整页）
function applyHiddenMessageVisibility() {
    const chat = (currentChatType === 'private')
        ? db.characters.find(c => c.id === currentChatId)
        : db.groups.find(g => g.id === currentChatId);
    _withScrollAnchored(() => {
        if (isShowingHiddenMessages()) _injectHiddenRows(chat);
        else _removeHiddenRows();
    });
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
                toggleHiddenMsgBtn = document.getElementById('toggle-hidden-msg-btn'),
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
                deleteSelectedBtn = document.getElementById('delete-selected-btn'),
                forwardSelectedBtn = document.getElementById('forward-selected-btn');

// 「重新生成」（原名「重回」）已从底栏挪进"+"面板（误触代价太大：它会连带删掉 AI 最后那段回复）。
// 入口是面板里 data-action="regenerate" 那一项，置灰走 setRegenerateBusy。

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
    //    ★ 有**两颗**加号：工具栏上那颗 #placeholder-plus-btn，和收纳工具栏后顶替它、
    //      住在输入框右边的 #inline-plus-btn。同一时刻只有一颗可见（CSS 决定），
    //      但行为必须一模一样，所以共用这个 handler 而不是各写一份。
    //    开关面板本身的四件事（重排页 / 加号转 × / 消息区让位 / 跟着滚）都在
    //    setChatExpansionPanelOpen 里，这里只管「开之前要先收拾什么」。
    const togglePlusPanel = () => {
        if (stickerModal.classList.contains('visible')) {
            stickerModal.classList.remove('visible');
        }

        // 面板是单例复用的，开之前必须按当前会话重新点灯
        syncChatExpansionActiveState();

        setChatExpansionPanelOpen(!chatExpansionPanel.classList.contains('visible'));
    };
    placeholderPlusBtn.addEventListener('click', togglePlusPanel);
    document.getElementById('inline-plus-btn')?.addEventListener('click', togglePlusPanel);

    // 点输入框 = 要打字，面板得让位给输入法（QQ/微信都是这个行为）。
    // 面板高度(~235px)和安卓输入法高度差不多纯属巧合 —— 它是内容撑出来的（两行图标 + 圆点），
    // 不是照着键盘量的，所以别想着「让面板原地变成键盘」把底栏钉住：那得盯
    // visualViewport 的 resize 自己算键盘高度，是另一摊事。现在就是单纯收起来。
    // 用 focus 而不是 click：移动端点输入框先 focus 再 click，而且别处 .focus() 唤起键盘的
    // 路径（chat_actions.js 点「回复」那下）同样该收面板。
    messageInput.addEventListener('focus', () => setChatExpansionPanelOpen(false));
    
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
    // 「收纳 AI 回复」那一档（外观→底栏）：按钮住在输入框**内部**右侧，靠包装层的
    // :focus-within 只在输入框有焦点时浮出来。于是点它的那一下有个陷阱 ——
    // mousedown 的默认行为会把焦点从输入框挪走（iOS 上顺带收键盘），:focus-within
    // 当场变假、按钮被 opacity:0 + pointer-events:none 藏掉，后面的 click 就打空了
    // （症状是"点了没反应"，而且只在收纳态下复现）。preventDefault 让焦点压根不动。
    // ★ 只在收纳态下拦：常态那颗在输入框外面，点它顺手收起键盘是原本的行为，别改。
    getReplyBtn.addEventListener('mousedown', (e) => {
        if (document.getElementById('chat-room-screen')?.classList.contains('bar-collapse-reply')) {
            e.preventDefault();
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

// ==========================================
    // 【核心修复】双向滚动监听 (加入无感预加载)
    // ==========================================
    messageArea.addEventListener('scroll', () => {
        // ⚠️ 隐藏态送达的 scroll 事件一律丢掉 —— 这不是防御性冗余，是修一个真 bug。
        //    `.screen` 之间靠 display:none 互斥，而 display:none 的元素**没有布局盒**，
        //    scrollTop / scrollHeight / clientHeight 三个读数全是 0（实测）。于是下面
        //    两个判据在隐藏态**双双无条件成立**：上翻 `0 < 50`、下翻 `0-0-0 < 50`，
        //    等于凭空替用户滚了一次到顶 + 一次到底。
        //    事件从哪来：scroll 事件是**异步派发**的。离开聊天室时 _screenLeaveHooks 先调
        //    closeChatRoomPanels → setChatExpansionPanelOpen(false) → `scrollTop -= h`
        //    （见那个函数第 ④ 条），此时页面还可见；紧接着同一个 task 里 switchScreen 把
        //    聊天室 display:none 掉，排队中的 scroll 事件这才送达 —— 处理器重新读 scrollTop
        //    就读成 0 了。所以只要「从 + 面板点进记忆总结/喵坛等别的页」就会踩上。
        //    后果不在当场而在返回时：loadMoreMessages 延迟 200ms 渲染，人在那边多待一会儿
        //    （比如在详情页滑两下）这一页就在隐藏态前插进 DOM，而 renderMessages 的位置补偿
        //    `newScrollHeight - oldScrollHeight + oldScrollTop` 三项全是 0、完全失效；
        //    Chrome 在重新显示时会把隐藏前那个「贴底」偏移量原样恢复，上方却凭空多了一页
        //    （MESSAGES_PER_PAGE=50 条），表现为「返回聊天室后往上翻了很多」。
        //    秒回则 200ms 还没到、渲染发生在可见态，补偿正常 —— 这就是它时灵时不灵的原因。
        //    用 clientHeight 而不是查 #chat-room-screen 有没有 .active：0 高度正是
        //    「这些读数不可信」的充要条件，顺带盖住别的隐藏方式（见记忆里那条
        //    「属性读数和几何量值对不上时信几何」）。
        if (!messageArea.clientHeight) return;

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
        // ⚠️ 必须走 setChatExpansionPanelOpen：这里曾经是裸 classList.remove('visible')，
        //    症状是「点空白关掉面板后，加号还卡在 ×、消息区还按面板在的尺寸留白」——
        //    面板自己是消失了，另外三件事（加号转回 +、收回 --exp-panel-h、退滚动）全没做。
        if (chatExpansionPanel.classList.contains('visible')) {
            setChatExpansionPanelOpen(false);
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
    // 转发的实现在 js/chat/chat_feature_share.js（它产出的是一张分享卡片）
    if (forwardSelectedBtn && typeof openForwardMessagesModal === 'function') {
        forwardSelectedBtn.addEventListener('click', openForwardMessagesModal);
    }
    if (toggleHiddenMsgBtn) {
        toggleHiddenMsgBtn.addEventListener('click', toggleHiddenMessagesInSelect);
    }

    document.getElementById('cancel-reply-btn').addEventListener('click', cancelQuoteReply);
    initCallFeature();
    
}

    // ==========================================
    // 聊天室临时 UI 复位
    // ==========================================
// "+"面板里属于"隔着手机才成立"的线上功能，线下模式（面对面）下要禁用。
// sticker bar 上的转账/语音/照片由 updateOfflineModeUI 用 disabled 属性禁；
// 面板项是 div，只能靠 class 置灰 + 点击拦截，所以清单放在这里。
// ⚠️ 收纳进来的 relay-* 也要列进来：它们转手去 click 底栏那颗真按钮，而那颗在线下模式下
//    是 disabled 的 —— 不列的话点下去**什么都不会发生**，连"为什么没反应"的提示都没有。
const OFFLINE_DISABLED_EXPANSION_ACTIONS = [
    'send-location-modal', 'send-share-modal',
    'relay-sticker', 'relay-wallet', 'relay-voice', 'relay-image', 'relay-photo', 'relay-call'
];

// 收纳位 → 底栏/顶栏上那颗真按钮。点收纳位就是替用户按一下原按钮，
// 弹窗、文件选择、通话那套逻辑一份都不用抄。
// ⚠️ 原按钮此时是 display:none 的（整条 #sticker-bar 被收起来了），但 .click() 照样派发事件 ——
//    靠的是"藏起来"而不是"拆掉"，所以这些功能的绑定、禁用、状态全都还是原来那一套。
const EXPANSION_RELAY_BTNS = {
    'relay-sticker': 'sticker-toggle-btn',
    'relay-wallet':  'wallet-btn',
    'relay-voice':   'voice-message-btn',
    'relay-image':   'image-recognition-btn',
    'relay-photo':   'photo-video-btn',
    'relay-call':    'video-call-btn'
};

/**
 * 「重新生成」现在住在"+"面板里，是个 div，没有 disabled 属性可用。
 * 生成期间沿用面板自己那套 .disabled 置灰（和线下模式共用一个样式），
 * 真正拦住重复触发的是 handleRegenerate 开头的 isGenerating 判断。
 */
function setRegenerateBusy(busy) {
    document.querySelector('.expansion-item[data-action="regenerate"]')
        ?.classList.toggle('disabled', !!busy);
}

/**
 * 把"+"面板里与会话绑定的开关（线下模式 / 后台消息）对齐到当前会话的真实状态，
 * 并按线下模式置灰面板里的线上功能（发送位置 / 转发分享）。
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

// ======================= "+"面板的横向翻页 =======================
// 一页 4 列 × 2 行。为什么要 JS 参与而不是纯 CSS：面板里 15 项有 6 项是**收纳位**，
// 显示与否由 #chat-room-screen 上的 bar-collapse-* / is-group-chat 决定，
// 所以「可见项」是 9~15 项之间浮动的，页的边界只能现算。
const EXPANSION_ITEMS_PER_PAGE = 8;

/**
 * 把平铺的 .expansion-item 重新装进 .expansion-page（每页 8 个**可见**项）。
 *
 * 隐藏项（收纳位关着的时候）不占格子、不计入页数，但必须留在 DOM 里 ——
 * 它们挂着 active / disabled 状态，而且开关一开就得原地复活（见 setupChatExpansionPanel
 * 里那段「全画出来、CSS 只放开该放的」）。做法是攒着，跟到下一个可见项所在的那一页，
 * 这样顺序不乱、也不会单独凑出一个「整页都是隐藏项」的空页占掉一个吸附位。
 *
 * 判可见用 getComputedStyle 而不是 offsetParent/getBoundingClientRect：
 * 调用时机是**面板还没显示**（togglePlusPanel 里先排版再加 .visible），
 * 此时整个面板 display:none，所有量出来都是 0；而 display 的计算值不受祖先影响，
 * 照样能读到 .stow-* 那几条规则的结果。
 */
function layoutChatExpansionPages() {
    const grid = document.getElementById('chat-expansion-grid');
    if (!grid) return;
    const items = Array.from(grid.querySelectorAll('.expansion-item'));
    if (!items.length) return;

    const frag = document.createDocumentFragment();
    const newPage = () => {
        const p = document.createElement('div');
        p.className = 'expansion-page';
        frag.appendChild(p);
        return p;
    };

    let page = null, shown = 0, pending = [];
    items.forEach(el => {
        if (getComputedStyle(el).display === 'none') { pending.push(el); return; }
        if (!page || shown % EXPANSION_ITEMS_PER_PAGE === 0) page = newPage();
        pending.forEach(hidden => page.appendChild(hidden));
        pending = [];
        page.appendChild(el);
        shown++;
    });
    // 末尾那串隐藏项（没有后续可见项可以跟）挂在最后一页上
    if (pending.length) {
        if (!page) page = newPage();
        pending.forEach(hidden => page.appendChild(hidden));
    }

    // items 已经被 appendChild 搬进 frag 了，grid 里剩下的只有上一轮的空页壳
    grid.replaceChildren(frag);
    syncChatExpansionDots();
}

/**
 * 按当前页数补齐圆点、并点亮正在看的那一页。
 * 只有一页时**一个都不渲染** —— CSS 的 .expansion-dots:empty 会把那一行高度也收掉。
 */
function syncChatExpansionDots() {
    const grid = document.getElementById('chat-expansion-grid');
    const dots = document.getElementById('chat-expansion-dots');
    if (!grid || !dots) return;

    const pageCount = grid.querySelectorAll('.expansion-page').length;
    const wanted = pageCount > 1 ? pageCount : 0;
    if (dots.children.length !== wanted) {
        dots.replaceChildren(...Array.from({ length: wanted }, (_, i) => {
            const d = document.createElement('span');
            d.className = 'dot';
            d.dataset.page = String(i);
            return d;
        }));
    }
    if (!wanted) return;

    // 面板没显示时 clientWidth 是 0，除出来是 NaN/Infinity —— 退回第 0 页
    const width = grid.clientWidth;
    const current = width
        ? Math.max(0, Math.min(wanted - 1, Math.round(grid.scrollLeft / width)))
        : 0;
    Array.from(dots.children).forEach((d, i) => d.classList.toggle('active', i === current));
}

/** 每次打开面板都回到第一页（和微信一致），顺手把圆点点回去 */
function resetChatExpansionPage() {
    const grid = document.getElementById('chat-expansion-grid');
    if (!grid) return;
    grid.scrollLeft = 0;
    syncChatExpansionDots();
}

/**
 * 开 / 关 "+"面板。**所有**入口都必须走这里，别自己去 classList.toggle('visible') ——
 * 开一次面板要连着做四件事，散在各处写必然漂（面板有 6 个关闭点：点加号、点消息区空白、
 * 点输入框、开表情面板、点面板里的项、离开聊天室/进多选）：
 *
 *   ① 重排页 —— 收纳开关是按预设存的，换个聊天「可见项有几个」就变了，页边界得现算。
 *   ② 两颗加号转成 ×（加 .plus-active）。漏一处的症状是「面板关了，加号还是个叉」。
 *   ③ 量出面板实高写进 --exp-panel-h —— 消息区的底部留白和"正在输入"的落点都是按
 *      --chat-foot-total 算的，它把这个值叠进去（见 chat_room.css 开头那段）。
 *      必须现量不能写死：一页 8 个和末页 1 行，高度差着 ~90px。
 *      ⚠️ 这条 custom property 就是「面板开着」的**唯一**状态载体，不要再另挂一个
 *      表示同一件事的 class：两份状态就有对不上的那天，而 CSS 这边
 *      var(--exp-panel-h, 0px) 的兜底已经等价于「没开」。
 *   ④ 把列表往下滚同样的距离 —— 面板现在是把底栏**顶上去**，不顶的话原来贴着输入栏的
 *      那几条消息会被升高后的底栏盖住。③ 的 padding 是这一步的前提：贴底时 scrollTop
 *      已经到顶格，没有多出来的 padding 根本滚不动。
 */
function setChatExpansionPanelOpen(open) {
    const panel = document.getElementById('chat-expansion-panel');
    if (!panel) return;
    // 幂等：关着的时候再关一次，不能把消息列表又往回滚一截
    if (panel.classList.contains('visible') === !!open) return;

    const screen = document.getElementById('chat-room-screen');
    const messageArea = document.getElementById('message-area');

    if (open) {
        // ★ 排版必须在加 .visible **之前**，否则用户会看见「先排好 1 页、再跳成 2 页」那一帧
        layoutChatExpansionPages();
        panel.classList.add('visible');
        // 高度要等真的显示出来才量得到（display:none 时 offsetHeight 恒为 0）。
        // slideUp 动画走的是 transform，不改布局，这里量到的就是最终高度。
        const h = panel.offsetHeight;
        screen?.style.setProperty('--exp-panel-h', `${h}px`);
        // 回第一页同样要等显示 —— display:none 时 scrollLeft 写不进去
        resetChatExpansionPage();
        if (messageArea) messageArea.scrollTop += h;
    } else {
        // 关的时候面板还在，高度照样量得到，不用把 h 存下来
        const h = panel.offsetHeight;
        // ⚠️ 顺序：先退滚动，再收 padding。反过来的话浏览器会先把 scrollTop 按变短了的
        //    内容夹一次，再减就多退了一截，看上去是「一关面板列表往回跳半屏」。
        if (messageArea) messageArea.scrollTop -= h;
        screen?.style.removeProperty('--exp-panel-h');
        panel.classList.remove('visible');
    }

    document.getElementById('placeholder-plus-btn')?.classList.toggle('plus-active', !!open);
    document.getElementById('inline-plus-btn')?.classList.toggle('plus-active', !!open);
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
    setChatExpansionPanelOpen(false);
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
    // 群聊标记挂在屏幕上，供 CSS 压掉"+"面板里的通话收纳位。
    // ★ 为什么不像上面那样直接改那一项的 inline display：收纳位的显示是 CSS 驱动的
    //   （.bar-collapse-call 放开），inline 和 class 混着用，下次换会话时谁覆盖谁要看顺序。
    //   统一成两条 CSS 规则，群聊那条带 !important，关系是写死的、不随调用顺序漂。
    document.getElementById('chat-room-screen')
        ?.classList.toggle('is-group-chat', type === 'group');
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

    // 折叠会把容器连里面的隐藏行一起换掉，勾选得跟着退掉 —— 同 _removeHiddenRows 那条
    // 「行没了但 id 还留在选中集里，会连着一条看不见的消息一起删」。
    // （真要删整段，勾折叠气泡就行，它代表 session 的全部消息。）
    _unselectHiddenRowsIn(
        messageArea.querySelector(`[data-call-session-expanded-container="${sessionId}"]`));

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

    // ⚠️ 第二道闸：**前插这一页绝不能在隐藏态执行**。
    //    上面那个 scroll 守卫挡住的是「隐藏态凭空触发」，这里挡的是另一半 ——
    //    用户**真的**滚到顶触发了加载，然后在渲染落地前离开了聊天室：
    //    loadMoreMessages 要等 200ms，loadOlderFromDB 还要 await 一次 DB 读，
    //    这两个窗口里换页完全来得及。一旦落在隐藏态，下面场景 B 的位置补偿
    //    `newScrollHeight - oldScrollHeight + oldScrollTop` 三项全读成 0（没有布局盒），
    //    补偿变成空操作，而 DOM 顶部已经实实在在多了一页 —— 返回时 Chrome 恢复
    //    隐藏前的偏移量，人就被顶到一页之上，和那个 bug 一模一样。
    //    直接放弃本次渲染并解锁：数据和游标都没动（loadOlderFromDB 的 unshift + 游标平移
    //    已经自洽，只是 DOM 还没吃到这一页），下次可见态滚到顶会自然补上，不会丢消息。
    //    只拦 isLoadMore：全量重绘（场景 C）不靠补偿、自己会 forceToBottom，隐藏态跑也无害，
    //    而且进聊天室那一下本来就可能赶在显示之前。
    if (isLoadMore && !messageArea.clientHeight) {
        isLoadingHistory = false;
        return;
    }

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

        const bubble = _bubbleOrHiddenRow(msg);
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

        const bubble = _bubbleOrHiddenRow(msg);
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
// 这份名单要和 chat_bubble_factory.js 里 return null 的那条对齐（外加时间分割线）：
// 聊天室里画不出气泡的消息，既不该算未读，也不该弹顶部通知条。
const invisibleRegex = /\[system:[\s\S]*?\]|\[.*?更新状态为[:：].*?\]|\[.*?已接收礼物\]|\[.*?(?:接收|退回).*?的转账\]|\[系统情景通知[:：][\s\S]*?\]/;
const isInvisible = message.content === '[time-divider]' || invisibleRegex.test(message.content);
if (!isInvisible) {
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

// 不可见消息（改状态、收转账/礼物、情景注入、时间分割线）到此为止，不弹通知条
if (isInvisible) return;


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
                        const textMatch = previewText.match(/\[.*?的消息[:：]([\s\S]+?)\]/);
                        if (message.isWithdrawn) {
                            // 撤回的消息在聊天室里只显示"撤回了一条消息"，通知条也别把原文抖出来
                            previewText = '撤回了一条消息';
                        } else if (textMatch) {
                            previewText = textMatch[1];
                        } else {
                            // 线下模式的旁白气泡：正文就是给人看的，只把 [system-narration: ] 这层壳剥掉
                            const narrationMatch = previewText.match(/\[system-narration[:：]([\s\S]+?)\]/);
                            const displayMatch = previewText.match(/\[system-display[:：]([\s\S]+?)\]/);
                            // Handle other message types for preview
                            // 转账/礼物的正则放宽到不带"的"字，群聊的「向X转账」「向X送来了礼物」也能命中
                            if (narrationMatch) previewText = narrationMatch[1].trim();
                            else if (displayMatch) previewText = displayMatch[1].trim();
                            else if (/\[.*?表情包[:：].*?\]/.test(previewText)) previewText = '[表情包]';
                            else if (/\[.*?的语音[:：].*?\]/.test(previewText)) previewText = '[语音]';
                            else if (/\[.*?照片\/视频[:：].*?\]/.test(previewText)) previewText = '[照片/视频]';
                            else if (/\[.*?转账[:：].*?\]/.test(previewText)) previewText = '[转账]';
                            else if (/\[.*?礼物[:：].*?\]/.test(previewText)) previewText = '[礼物]';
                            else if (/\[.*?发送了位置[:：].*?\]/.test(previewText)) previewText = '[位置]';
                            else if (/\[.*?发来了一张图片[:：]\]/.test(previewText)) previewText = '[图片]';
                            else if (message.parts && message.parts.some(p => p.type === 'html')) previewText = '[互动]';
                            else {
                                // 兜底：上面都没命中（群聊改名/踢人这类可见通知、或没见过的新格式），
                                // 只把外层方括号剥掉、保留整句，别把原始标记直接摆给用户看。
                                // 这里刻意不按冒号切——「阿花修改群名为：喵喵星球」切掉前半句就读不懂了。
                                previewText = previewText.replace(/^\[+/, '').replace(/\]+$/, '').trim();
                            }
                        }

                        showToast({
                            avatar: senderAvatar,
                            name: senderName,
                            message: previewText.substring(0, 30),
                            // 带上会话标识，顶部通知条就能点进这个聊天室（见 utils.js processToastQueue）
                            chatId: targetChatId,
                            chatType: targetChatType
                        });
                    }
                    return; // IMPORTANT: Stop further execution
                }

                // --- Original logic for when the chat is active ---
                // ★ 先推底部游标再做别的：下面几个分支（改状态/收转账/收礼物）会直接 return，
                //   画不出气泡的消息只有这一次机会被纳入渲染窗口，否则「显示隐藏」扫不到它。
                //   详见 _advanceRenderFloorToLatest 的注释。
                _advanceRenderFloorToLatest(message);

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
                        // isHidden 的一律不进气泡工厂，理由同 _bubbleOrHiddenRow 顶上那段：
                        // 旧数据里那条隐藏的 `[剧情旁白：…]` 现在画得出旁白气泡，会跟它的可见孪生重影。
                        const bubbleElement = message.isHidden ? null : createMessageBubbleElement(message);
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
                    // 同上：isHidden 的不进气泡工厂
                    const bubbleElement = message.isHidden ? null : createMessageBubbleElement(message);
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

                    // ★ 通话里自己说的话也存成语音气泡（和 AI 那边同一条规则，
                    //   见 chat_voice_call.js 顶部）：这样事后展开通话记录，
                    //   整通电话两边都是语音条，而不是一半语音一半文字。
                    //   注意自己发的语音**永远合不出音频**（没有"我"的音色，
                    //   _voiceProfileForBubble 对 sent 气泡直接返回 null），
                    //   那个播放键点下去是"看文字稿"，这是既有行为。
                    // ★ 喂给模型时会被还原成「的消息」（chat_ai_service.js 的
                    //   historySlice 那一处），所以提示词一个字都不用改。
                    const inCall = currentChatType === 'private' && chat.callMode;
                    messageContent = (inCall && typeof buildCallVoiceContent === 'function')
                        ? buildCallVoiceContent(myName, userText)
                        : `[${myName}的消息：${userText}]`;
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
                        id: 'regenerate',
                        name: '重新生成',
                        icon: `<svg viewBox="0 0 24 24" class="ic-line" xmlns="http://www.w3.org/2000/svg">
<path d="M21 3V8M21 8H16M21 8L18 5.29168C16.4077 3.86656 14.3051 3 12 3C7.02944 3 3 7.02944 3 12C3 16.9706 7.02944 21 12 21C16.2832 21 19.8675 18.008 20.777 14"/>
</svg>`
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
                    // ===== 以下 5 项是底栏工具栏的收纳位 =====
                    // 它们**一直**在面板的 DOM 里，默认 display:none（chat_room.css 的 .stow-toolbar），
                    // 外观→底栏→「收纳工具栏」打开时才放出来。为什么不按需增删节点：
                    // 这个面板是全局单例、只在启动时 setupChatExpansionPanel 一次，而收纳开关
                    // 是**按预设存的**（每个聊天可以不一样），换聊天要重建就得把点击委托一起重来。
                    // 和「消息时间三个槽位」同一个套路：全画出来，CSS 只放开该放的那个。
                    // 这 5 项自己不干活，点了就去 click 底栏上那颗真按钮（EXPANSION_RELAY_BTNS），
                    // 省得把弹窗/文件选择那套逻辑再抄一份。
                    // ⚠️ 图标必须和底栏那颗**同一张**（见 index.html 的 #sticker-bar）：
                    //    它们是同一个功能的两个入口，开着收纳开关时底栏那颗根本不露脸，
                    //    一旦两边各画一张，用户拨一下开关就会觉得功能都换了。
                    //    .ic-line 的含义同底栏：svg 里只留几何，颜色/线宽交给
                    //    chat_modal.css 的 .expansion-item-icon svg.ic-line。
                    {
                        id: 'relay-sticker',
                        name: '发送表情',
                        stow: 'toolbar',
                        icon: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
<path d="M14.9348 13.1725C15.3654 13.3446 15.5817 13.8402 15.3237 14.2255C15.0294 14.665 14.6493 15.0442 14.2032 15.3386C13.522 15.7881 12.7196 16.0185 11.9037 15.9988C11.0878 15.9792 10.2975 15.7104 9.6387 15.2287C9.20726 14.9131 8.8458 14.5161 8.573 14.0629C8.33384 13.6656 8.57376 13.181 9.01216 13.0299C9.45056 12.8788 9.91919 13.1274 10.2157 13.4839C10.3367 13.6294 10.4756 13.7603 10.63 13.8732C11.0122 14.1527 11.4708 14.3087 11.9441 14.3201C12.4175 14.3315 12.883 14.1978 13.2782 13.937C13.4379 13.8316 13.583 13.7076 13.7108 13.5681C14.0241 13.2262 14.5042 13.0005 14.9348 13.1725Z"/>
<path d="M10 9C10 8.44772 9.55228 8 9 8C8.44772 8 8 8.44772 8 9V10C8 10.5523 8.44772 11 9 11C9.55228 11 10 10.5523 10 10V9Z"/>
<path d="M16 9C16 8.44772 15.5523 8 15 8C14.4477 8 14 8.44772 14 9V10C14 10.5523 14.4477 11 15 11C15.5523 11 16 10.5523 16 10V9Z"/>
<path fill-rule="evenodd" clip-rule="evenodd" d="M2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12ZM12 4C7.58172 4 4 7.58172 4 12C4 16.4183 7.58172 20 12 20C16.4183 20 20 16.4183 20 12C20 7.58172 16.4183 4 12 4Z"/>
</svg>`
                    },
                    {
                        id: 'relay-wallet',
                        name: '发送转账',
                        stow: 'toolbar',
                        icon: `<svg viewBox="0 0 24 24" class="ic-line" xmlns="http://www.w3.org/2000/svg">
<path d="M13 9H7"/>
<path d="M22 10.9699V13.03C22 13.58 21.56 14.0299 21 14.0499H19.0399C17.9599 14.0499 16.97 13.2599 16.88 12.1799C16.82 11.5499 17.0599 10.9599 17.4799 10.5499C17.8499 10.1699 18.36 9.94995 18.92 9.94995H21C21.56 9.96995 22 10.4199 22 10.9699Z"/>
<path d="M17.48 10.55C17.06 10.96 16.82 11.55 16.88 12.18C16.97 13.26 17.96 14.05 19.04 14.05H21V15.5C21 18.5 19 20.5 16 20.5H7C4 20.5 2 18.5 2 15.5V8.5C2 5.78 3.64 3.88 6.19 3.56C6.45 3.52 6.72 3.5 7 3.5H16C16.26 3.5 16.51 3.50999 16.75 3.54999C19.33 3.84999 21 5.76 21 8.5V9.95001H18.92C18.36 9.95001 17.85 10.17 17.48 10.55Z"/>
</svg>`
                    },
                    {
                        id: 'relay-voice',
                        name: '发送语音',
                        stow: 'toolbar',
                        icon: `<svg viewBox="0 0 24 24" class="ic-line" xmlns="http://www.w3.org/2000/svg">
<rect x="8" y="2" width="8" height="13" rx="4"/>
<path d="M20,10v1a8,8,0,0,1-8,8h0a8,8,0,0,1-8-8V10"/>
<line x1="12" y1="19" x2="12" y2="22"/>
</svg>`
                    },
                    {
                        // 真图上传，发给模型去看（即底栏那颗"识图"）
                        id: 'relay-image',
                        name: '发送图片',
                        stow: 'toolbar',
                        icon: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
<path d="M8.5 10C9.32843 10 10 9.32843 10 8.5C10 7.67157 9.32843 7 8.5 7C7.67157 7 7 7.67157 7 8.5C7 9.32843 7.67157 10 8.5 10Z"/>
<path fill-rule="evenodd" clip-rule="evenodd" d="M11.0055 2H12.9945C14.3805 1.99999 15.4828 1.99999 16.3716 2.0738C17.2819 2.14939 18.0575 2.30755 18.7658 2.67552C19.8617 3.24477 20.7552 4.1383 21.3245 5.23415C21.6925 5.94253 21.8506 6.71811 21.9262 7.62839C22 8.5172 22 9.61946 22 11.0054V12.9945C22 13.6854 22 14.306 21.9909 14.8646C22.0049 14.9677 22.0028 15.0726 21.9846 15.175C21.9741 15.6124 21.9563 16.0097 21.9262 16.3716C21.8506 17.2819 21.6925 18.0575 21.3245 18.7658C20.7552 19.8617 19.8617 20.7552 18.7658 21.3245C18.0575 21.6925 17.2819 21.8506 16.3716 21.9262C15.4828 22 14.3805 22 12.9946 22H11.0055C9.61955 22 8.5172 22 7.62839 21.9262C6.71811 21.8506 5.94253 21.6925 5.23415 21.3245C4.43876 20.9113 3.74996 20.3273 3.21437 19.6191C3.20423 19.6062 3.19444 19.5932 3.185 19.5799C2.99455 19.3238 2.82401 19.0517 2.67552 18.7658C2.30755 18.0575 2.14939 17.2819 2.0738 16.3716C1.99999 15.4828 1.99999 14.3805 2 12.9945V11.0055C1.99999 9.61949 1.99999 8.51721 2.0738 7.62839C2.14939 6.71811 2.30755 5.94253 2.67552 5.23415C3.24477 4.1383 4.1383 3.24477 5.23415 2.67552C5.94253 2.30755 6.71811 2.14939 7.62839 2.0738C8.51721 1.99999 9.61949 1.99999 11.0055 2ZM20 11.05V12.5118L18.613 11.065C17.8228 10.2407 16.504 10.2442 15.7182 11.0727L11.0512 15.9929L9.51537 14.1359C8.69326 13.1419 7.15907 13.1746 6.38008 14.2028L4.19042 17.0928C4.13682 16.8463 4.09606 16.5568 4.06694 16.2061C4.0008 15.4097 4 14.3905 4 12.95V11.05C4 9.60949 4.0008 8.59025 4.06694 7.79391C4.13208 7.00955 4.25538 6.53142 4.45035 6.1561C4.82985 5.42553 5.42553 4.82985 6.1561 4.45035C6.53142 4.25538 7.00955 4.13208 7.79391 4.06694C8.59025 4.0008 9.60949 4 11.05 4H12.95C14.3905 4 15.4097 4.0008 16.2061 4.06694C16.9905 4.13208 17.4686 4.25538 17.8439 4.45035C18.5745 4.82985 19.1702 5.42553 19.5497 6.1561C19.7446 6.53142 19.8679 7.00955 19.9331 7.79391C19.9992 8.59025 20 9.60949 20 11.05ZM6.1561 19.5497C5.84198 19.3865 5.55279 19.1833 5.295 18.9467L7.97419 15.4106L9.51005 17.2676C10.2749 18.1924 11.6764 18.24 12.5023 17.3693L17.1693 12.449L19.9782 15.3792C19.9683 15.6812 19.9539 15.9547 19.9331 16.2061C19.8679 16.9905 19.7446 17.4686 19.5497 17.8439C19.1702 18.5745 18.5745 19.1702 17.8439 19.5497C17.4686 19.7446 16.9905 19.8679 16.2061 19.9331C15.4097 19.9992 14.3905 20 12.95 20H11.05C9.60949 20 8.59025 19.9992 7.79391 19.9331C7.00955 19.8679 6.53142 19.7446 6.1561 19.5497Z"/>
</svg>`
                    },
                    {
                        // 不传图，打字描述一张照片/视频（即底栏那颗"分享照片/视频"）
                        id: 'relay-photo',
                        name: '文字图片',
                        stow: 'toolbar',
                        icon: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
<path fill-rule="evenodd" clip-rule="evenodd" d="M6.39252 3.83025C7.04361 2.75654 8.20958 2 9.54508 2H14.4549C15.7904 2 16.9564 2.75654 17.6075 3.83025C17.8059 4.15753 18.0281 4.50118 18.257 4.81533C18.3665 4.96564 18.5804 5.08571 18.8771 5.08571H18.9998C21.209 5.08571 23 6.87668 23 9.08571V17C23 19.2091 21.2091 21 19 21H5C2.79086 21 1 19.2091 1 17V9.08572C1 6.87668 2.79052 5.08571 4.99976 5.08571H5.12238C5.41912 5.08571 5.63348 4.96564 5.74301 4.81533C5.97193 4.50118 6.19407 4.15753 6.39252 3.83025ZM9.54508 4C8.98673 4 8.43356 4.32159 8.10267 4.86727C7.88516 5.22596 7.63139 5.61989 7.35939 5.99317C6.81056 6.74635 5.94404 7.08571 5.12286 7.08571H5.00024C3.89578 7.08571 3 7.98104 3 9.08572V17C3 18.1046 3.89543 19 5 19H19C20.1046 19 21 18.1046 21 17V9.08571C21 7.98104 20.1047 7.08571 19.0002 7.08571H18.8776C18.0564 7.08571 17.1894 6.74635 16.6406 5.99317C16.3686 5.61989 16.1148 5.22596 15.8973 4.86727C15.5664 4.32159 15.0133 4 14.4549 4H9.54508ZM12 9C10.3431 9 9 10.3431 9 12C9 13.6569 10.3431 15 12 15C13.6569 15 15 13.6569 15 12C15 10.3431 13.6569 9 12 9ZM7 12C7 9.23858 9.23858 7 12 7C14.7614 7 17 9.23858 17 12C17 14.7614 14.7614 17 12 17C9.23858 17 7 14.7614 7 12Z"/>
</svg>`
                    },
                    {
                        id: 'send-share-modal',
                        name: '转发分享',
                        icon: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path fill-rule="evenodd" clip-rule="evenodd" d="M1 18.5088C1 13.1679 4.90169 8.77098 9.99995 7.84598V5.51119C9.99995 3.63887 12.1534 2.58563 13.6313 3.73514L21.9742 10.224C23.1323 11.1248 23.1324 12.8752 21.9742 13.7761L13.6314 20.2649C12.1534 21.4144 10 20.3612 10 18.4888V16.5189C7.74106 16.9525 5.9625 18.1157 4.92778 19.6838C4.33222 20.5863 3.30568 20.7735 2.55965 20.5635C1.80473 20.3511 1.00011 19.6306 1 18.5088ZM12.4034 5.31385C12.2392 5.18613 11.9999 5.30315 11.9999 5.51119V9.41672C11.9999 9.55479 11.8873 9.66637 11.7493 9.67008C8.09094 9.76836 4.97774 12.0115 3.66558 15.1656C3.46812 15.6402 3.31145 16.1354 3.19984 16.6471C3.07554 17.217 3.00713 17.8072 3.00053 18.412C3.00018 18.4442 3 18.4765 3 18.5088C3.00001 18.6437 3.18418 18.6948 3.25846 18.5822C3.27467 18.5577 3.29101 18.5332 3.30747 18.5088C3.30748 18.5088 3.30746 18.5088 3.30747 18.5088C3.63446 18.0244 4.01059 17.5765 4.42994 17.168C4.71487 16.8905 5.01975 16.6313 5.34276 16.3912C7.05882 15.1158 9.28642 14.3823 11.7496 14.3357C11.8877 14.3331 12 14.4453 12 14.5834V18.4888C12 18.6969 12.2393 18.8139 12.4035 18.6862L20.7463 12.1973C20.875 12.0973 20.875 11.9028 20.7463 11.8027L12.4034 5.31385Z"/>
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
                        // 顶栏通话键的收纳位。和上面 5 项同理：节点常在、默认 display:none
                        // （.stow-call），由外观→顶栏→「收纳通话」放出来。
                        // 群聊没有通话，另有一条 .is-group-chat 规则把它压回去，见 chat_room.css。
                        id: 'relay-call',
                        name: '通话',
                        stow: 'call',
                        // 几何必须和 index.html 的 #video-call-btn 一模一样（同一个功能的两个入口，
                        // 理由同上面那 5 项）。改成 .ic-line 后这里只留 d：颜色和线宽交给
                        // chat_modal.css，才能和面板里 relay-wallet/relay-voice 那几张线型图一样粗；
                        // 原先是写死的 stroke="#555" stroke-width="1.3"，比邻居细一圈。
                        // 这张 d 和 chat_bubble_factory.js 通话气泡里那张是同一张（顶栏也用它，
                        // 三处一个图形；气泡只有拒接时套 rotate(135)，不旋转就是这个方向）。
                        icon: `<svg viewBox="0 0 24 24" class="ic-line" xmlns="http://www.w3.org/2000/svg">
<path d="M21.97 18.33C21.97 18.69 21.89 19.06 21.72 19.42C21.55 19.78 21.33 20.12 21.04 20.44C20.55 20.98 20.01 21.37 19.4 21.62C18.8 21.87 18.15 22 17.45 22C16.43 22 15.34 21.76 14.19 21.27C13.04 20.78 11.89 20.12 10.75 19.29C9.6 18.45 8.51 17.52 7.47 16.49C6.44 15.45 5.51 14.36 4.68 13.22C3.86 12.08 3.2 10.94 2.72 9.81C2.24 8.67 2 7.58 2 6.54C2 5.86 2.12 5.21 2.36 4.61C2.6 4 2.98 3.44 3.51 2.94C4.15 2.31 4.85 2 5.59 2C5.87 2 6.15 2.06 6.4 2.18C6.66 2.3 6.89 2.48 7.07 2.74L9.39 6.01C9.57 6.26 9.7 6.49 9.79 6.71C9.88 6.92 9.93 7.13 9.93 7.32C9.93 7.56 9.86 7.8 9.72 8.03C9.59 8.26 9.4 8.5 9.16 8.74L8.4 9.53C8.29 9.64 8.24 9.77 8.24 9.93C8.24 10.01 8.25 10.08 8.27 10.16C8.3 10.24 8.33 10.3 8.35 10.36C8.53 10.69 8.84 11.12 9.28 11.64C9.73 12.16 10.21 12.69 10.73 13.22C11.27 13.75 11.79 14.24 12.32 14.69C12.84 15.13 13.27 15.43 13.61 15.61C13.66 15.63 13.72 15.66 13.79 15.69C13.87 15.72 13.95 15.73 14.04 15.73C14.21 15.73 14.34 15.67 14.45 15.56L15.21 14.81C15.46 14.56 15.7 14.37 15.93 14.25C16.16 14.11 16.39 14.04 16.64 14.04C16.83 14.04 17.03 14.08 17.25 14.17C17.47 14.26 17.7 14.39 17.95 14.56L21.26 16.91C21.52 17.09 21.7 17.3 21.81 17.55C21.91 17.8 21.97 18.05 21.97 18.33Z"/>
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
                    // stow 的两项（toolbar / call）默认是 display:none 的，
                    // 由 #chat-room-screen 上的 bar-collapse-* class 放开，见 chat_room.css。
                    itemEl.className = 'expansion-item' + (item.stow ? ` stow-${item.stow}` : '');
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

                // 分页：上面是一串平铺的 .expansion-item，由 layoutChatExpansionPages
                // 现场塞进 .expansion-page（一页 8 个）。这里先排一次，之后每次开面板再排。
                layoutChatExpansionPages();

                // 滑动过程中同步圆点。rAF 节流：原生滚动事件一次滑动能来几十发，
                // 每发都读 scrollLeft/clientWidth 会强制同步布局。
                let dotsRaf = 0;
                expansionGrid.addEventListener('scroll', () => {
                    if (dotsRaf) return;
                    dotsRaf = requestAnimationFrame(() => {
                        dotsRaf = 0;
                        syncChatExpansionDots();
                    });
                }, { passive: true });

                // 滚轮/触控板翻页。必须自己接管，不能指望原生滚动：
                // scroll-snap-type: x mandatory 会把滚轮那「一格 120px」当场弹回起点
                // （实测对照：同样手势打在不带 snap 的容器上滚得动 480px，带 snap 的原地不动，
                //   一次给满整页宽度 500px 才认），所以 PC 上滚轮根本翻不动页。
                // 这里改成「一次手势 = 一页」，顺手也把只有 deltaY 的普通鼠标接上。
                let wheelLockUntil = 0;
                expansionGrid.addEventListener('wheel', (e) => {
                    // 取主导方向：触控板横滑给 deltaX，普通滚轮只给 deltaY
                    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
                    if (!delta) return;
                    // 拦住默认行为，否则滚动链会传给面板**背后**的消息区，变成「开着面板翻聊天记录」
                    e.preventDefault();

                    const now = Date.now();
                    if (now < wheelLockUntil) return;   // 一次手势会连发十几个 wheel，别一下翻好几页
                    wheelLockUntil = now + 420;

                    const pages = expansionGrid.querySelectorAll('.expansion-page').length;
                    const width = expansionGrid.clientWidth;
                    if (pages < 2 || !width) return;
                    const cur = Math.round(expansionGrid.scrollLeft / width);
                    const next = Math.max(0, Math.min(pages - 1, cur + (delta > 0 ? 1 : -1)));
                    expansionGrid.scrollTo({ left: width * next, behavior: 'smooth' });
                }, { passive: false });

                // 点圆点直接跳页（PC 上比滚轮确定，也是唯一能一步跨多页的入口）
                document.getElementById('chat-expansion-dots')?.addEventListener('click', (e) => {
                    const dot = e.target.closest('.dot');
                    if (!dot) return;
                    expansionGrid.scrollTo({
                        left: expansionGrid.clientWidth * Number(dot.dataset.page),
                        behavior: 'smooth'
                    });
                });

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

                    // 收纳位：转手按一下底栏/顶栏上那颗真按钮就完事，不进下面的 switch。
                    // 放在线下模式拦截之后 —— 那颗真按钮在线下模式下是 disabled 的，
                    // .click() 不会有任何反应，得先把"为什么没反应"说出来。
                    if (EXPANSION_RELAY_BTNS[action]) {
                        document.getElementById(EXPANSION_RELAY_BTNS[action])?.click();
                        setChatExpansionPanelOpen(false);
                        return;
                    }

switch (action) {
    case 'regenerate':
        // 面板关在前面：handleRegenerate 会弹二次确认，面板盖在弹窗上面很难看
        setChatExpansionPanelOpen(false);
        if (typeof handleRegenerate === 'function') handleRegenerate();
        return;
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
                        case 'send-share-modal':
                            // 万能分享卡片：直接发当前会话，不选收件人
                            if (typeof openShareModal === 'function') openShareModal();
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
                    setChatExpansionPanelOpen(false);
                });
            }
