// forum_multiselect.js - 喵坛主页长按多选：顶栏换「取消 + 计数」、底栏换「删除 / 收藏 / 转发」
//
// 布局照搬聊天室多选那一套，两处刻意不同：
//   1. 计数写「已选择 N 个帖子」，不是聊天室的「已选择 N 项」。
//   2. 底部要盖掉的是**全局**底部导航栏 `.bottom-tab-bar` —— 论坛四个页面共用一条，
//      显隐由 utils.js 的 switchScreen 写 inline style 控制。所以这里绝不能去动它的
//      `style.display`：退出多选那一刻我们并不知道当前该不该显示它（用户可能已经
//      切到没有导航栏的页面去了），按「恢复成 flex」写就会在那些页面上凭空多出一条。
//      改成在 body 上挂一个类、CSS 里用 !important 盖掉，退出时摘类，inline style
//      原封不动 —— 谁该显示谁显示，这件事仍然只有 switchScreen 一个主人。
//
// 进入方式是长按列表里的帖子卡片（桌面右键同）。热帖榜不参与：它是个 Top3 排行小挂件，
// 不是列表本体。

let isForumMultiSelectMode = false;
const selectedForumPostIds = new Set();

let forumLongPressTimer = null;
let forumLongPressStart = null;      // 触摸起点，用来分辨「按住」和「滑动翻页」
let forumSuppressClickForId = null;  // 长按抬手浏览器会补一发 click，见 toggleForumPostSelection

const FORUM_LONG_PRESS_MS = 500;
const FORUM_LONG_PRESS_SLOP = 10;    // 位移超过这么多像素才算滚动；按住不动时的手抖不该取消长按

function isForumMultiSelectActive() {
    return isForumMultiSelectMode;
}

function setupForumMultiSelectFeature() {
    const container = document.getElementById('forum-posts-container');
    if (!container) return;

    // --- 长按进入多选 ---
    container.addEventListener('touchstart', (e) => {
        const card = e.target.closest('.forum-post-card[data-id]');
        if (!card) return;
        const touch = e.touches[0];
        forumLongPressStart = touch ? { x: touch.clientX, y: touch.clientY } : null;
        clearTimeout(forumLongPressTimer);
        forumLongPressTimer = setTimeout(() => _forumEnterFromLongPress(card), FORUM_LONG_PRESS_MS);
    }, { passive: true });

    // ★ 挪动超过阈值才取消，不是「一有 touchmove 就取消」：按住不动的这 500ms 里
    //   手指几乎必然有一两像素的抖动，一律取消的话手机上十次有三次进不去多选。
    container.addEventListener('touchmove', (e) => {
        if (forumLongPressTimer === null || !forumLongPressStart) return;
        const touch = e.touches[0];
        if (!touch) return;
        if (Math.abs(touch.clientX - forumLongPressStart.x) > FORUM_LONG_PRESS_SLOP ||
            Math.abs(touch.clientY - forumLongPressStart.y) > FORUM_LONG_PRESS_SLOP) {
            clearTimeout(forumLongPressTimer);
            forumLongPressTimer = null;
        }
    }, { passive: true });

    ['touchend', 'touchcancel'].forEach(evt => {
        container.addEventListener(evt, () => {
            clearTimeout(forumLongPressTimer);
            forumLongPressTimer = null;
        });
    });

    // 桌面右键 / 安卓 WebView 的原生长按菜单：拦下来走同一条路，别弹系统菜单
    container.addEventListener('contextmenu', (e) => {
        const card = e.target.closest('.forum-post-card[data-id]');
        if (!card) return;
        e.preventDefault();
        _forumEnterFromLongPress(card);
    });

    // --- 顶栏「取消」 ---
    const cancelBtn = document.getElementById('forum-multi-cancel-btn');
    if (cancelBtn) cancelBtn.addEventListener('click', () => exitForumMultiSelectMode());

    // --- 底栏三个动作 ---
    const deleteBtn = document.getElementById('forum-multi-delete-btn');
    if (deleteBtn) deleteBtn.addEventListener('click', () => _forumMultiDeleteSelected());

    const favBtn = document.getElementById('forum-multi-fav-btn');
    if (favBtn) favBtn.addEventListener('click', () => _forumMultiFavoriteSelected());

    const forwardBtn = document.getElementById('forum-multi-forward-btn');
    if (forwardBtn) forwardBtn.addEventListener('click', () => _forumMultiForwardSelected());

    _forumUpdateMultiSelectBar();
}

function _forumEnterFromLongPress(card) {
    clearTimeout(forumLongPressTimer);
    forumLongPressTimer = null;
    if (isForumMultiSelectMode) return;

    enterForumMultiSelectMode(card.dataset.id);

    // 长按抬手后浏览器还会补一发 click，冒泡到 forum_core 的列表点击委托上；
    // 不挡掉的话刚选中的这条当场被 toggle 回未选中，表现为「长按进去是 0 项」。
    // ★ 记的是**哪一条**而不是「下一次点击」：桌面右键进多选是不会补 click 的，
    //   记成布尔的话紧接着点别的帖子那一下会被白白吃掉。
    const pressedId = card.dataset.id;
    forumSuppressClickForId = pressedId;
    setTimeout(() => {
        if (forumSuppressClickForId === pressedId) forumSuppressClickForId = null;
    }, 400);
}

function enterForumMultiSelectMode(initialPostId) {
    if (isForumMultiSelectMode) return;
    isForumMultiSelectMode = true;
    selectedForumPostIds.clear();
    document.body.classList.add('forum-multi-select-on');
    _forumUpdateMultiSelectBar();
    if (initialPostId) toggleForumPostSelection(initialPostId);
}

function exitForumMultiSelectMode() {
    if (!isForumMultiSelectMode) return;
    isForumMultiSelectMode = false;
    document.body.classList.remove('forum-multi-select-on');
    document.querySelectorAll('#forum-posts-container .forum-post-card.multi-selected')
        .forEach(card => card.classList.remove('multi-selected'));
    selectedForumPostIds.clear();
    forumSuppressClickForId = null;
    _forumUpdateMultiSelectBar();
}

// 由 forum_core.js 的列表点击委托调用（多选模式下点卡片是勾选，不是进详情）
function toggleForumPostSelection(postId) {
    if (!isForumMultiSelectMode || !postId) return;
    if (forumSuppressClickForId === postId) { forumSuppressClickForId = null; return; }

    const card = document.querySelector(`#forum-posts-container .forum-post-card[data-id="${postId}"]`);
    if (selectedForumPostIds.has(postId)) {
        selectedForumPostIds.delete(postId);
        if (card) card.classList.remove('multi-selected');
    } else {
        selectedForumPostIds.add(postId);
        if (card) card.classList.add('multi-selected');
    }
    _forumUpdateMultiSelectBar();
}

function _forumUpdateMultiSelectBar() {
    const count = selectedForumPostIds.size;

    const countEl = document.getElementById('forum-multi-count');
    if (countEl) countEl.textContent = `已选择 ${count} 个帖子`;

    ['forum-multi-delete-btn', 'forum-multi-fav-btn', 'forum-multi-forward-btn'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.disabled = count === 0;
    });
}

// 选中的 id 按**列表里的先后顺序**排一遍：用户看的是列表，删除提示的条数、
// 转发出去的卡片顺序都跟屏幕上对得上才不奇怪（Set 存的是点选顺序）。
function _forumSelectedIdsInListOrder() {
    const order = new Map((db.forumPosts || []).map((p, i) => [String(p.id), i]));
    return Array.from(selectedForumPostIds)
        .sort((a, b) => (order.has(String(a)) ? order.get(String(a)) : Infinity)
                      - (order.has(String(b)) ? order.get(String(b)) : Infinity));
}

// --- 删除 ---

async function _forumMultiDeleteSelected() {
    const ids = _forumSelectedIdsInListOrder();
    if (ids.length === 0) return;

    // ★ 二次确认是必需的，不是礼貌：删除键和收藏/转发挤在同一条底栏上，
    //   指头底下差几毫米，而帖子没有回收站，误触一次就是不可恢复的删除。
    const ok = await AppUI.confirm(
        `将删除选中的 ${ids.length} 个帖子，删掉就找不回来了。`,
        '删除帖子', '删除', '取消'
    );
    if (!ok) return;

    try {
        await forumDeletePostsByIds(ids);
    } catch (e) {
        console.error('❌ [喵坛多选删除] 失败:', e);
        showToast('删除失败: ' + e.message);
        return;
    }

    exitForumMultiSelectMode();
    showToast(`已删除 ${ids.length} 个帖子`);
}

// 按 id 批量删帖：详情页单条删帖那套口径的批量版。
// 库、内存窗口、收藏/在看三处必须一起删 —— 收藏/在看里留下悬空 id 的话，
// 收藏页渲染时 find 不到就直接 return，表现为「列表里空掉一行」。
async function forumDeletePostsByIds(postIds) {
    const ids = Array.from(new Set((postIds || []).map(String)));
    if (ids.length === 0) return 0;

    // 1. 先删库（跟单条删帖同一个顺序：库是真相，内存是缓存）
    await dexieDB.forumPosts.bulkDelete(ids);

    // 2. 内存窗口删同一批。★ 懒加载游标 window._forumOldestContiguousTs 不用动：
    //    两边删的是同一批，「内存前缀 == DB 最新一段」这个不变量还成立。
    const gone = new Set(ids);
    db.forumPosts = (db.forumPosts || []).filter(p => !gone.has(String(p.id)));

    // 3. 收藏/在看里的悬空 id 一起清
    if (db.favoritePostIds) db.favoritePostIds = db.favoritePostIds.filter(id => !gone.has(String(id)));
    if (db.watchingPostIds) db.watchingPostIds = db.watchingPostIds.filter(id => !gone.has(String(id)));
    await saveForumMeta();

    // 4. DOM 里把卡片摘掉：列表走的是「已有内容就绝不重绘」，不手动摘就一直挂在那儿
    const container = document.getElementById('forum-posts-container');
    if (container) {
        ids.forEach(id => {
            const card = container.querySelector(`.forum-post-card[data-id="${id}"]`);
            if (card) card.remove();
        });
    }
    if (typeof renderHotPosts === 'function') renderHotPosts();

    return ids.length;
}

// --- 收藏 ---

async function _forumMultiFavoriteSelected() {
    const ids = _forumSelectedIdsInListOrder();
    if (ids.length === 0) return;

    const ok = await AppUI.confirm(
        `将把选中的 ${ids.length} 个帖子加入「我的收藏」。`,
        '收藏帖子', '收藏', '取消'
    );
    if (!ok) return;

    if (!db.favoritePostIds) db.favoritePostIds = [];
    const already = new Set(db.favoritePostIds.map(String));
    const added = ids.filter(id => !already.has(String(id)));
    if (added.length > 0) {
        db.favoritePostIds.push(...added);
        await saveForumMeta();
    }

    exitForumMultiSelectMode();
    // 选中的本来就已经在收藏里时要说清楚，否则只弹一句「已收藏」，
    // 用户回收藏页一看数量没变，会以为功能坏了。
    showToast(added.length === ids.length
        ? `已收藏 ${added.length} 个帖子`
        : `已收藏 ${added.length} 个帖子（${ids.length - added.length} 个已在收藏中）`);
}

// --- 转发 ---

function _forumMultiForwardSelected() {
    const ids = _forumSelectedIdsInListOrder();
    if (ids.length === 0) return;
    // 直接复用帖子详情页那个分享弹窗（forum_share.js），多选时一帖一张卡片。
    // 退出多选交给那边发送成功之后做 —— 用户在弹窗里点取消时，选中的还在。
    openSharePostModal(ids);
}
