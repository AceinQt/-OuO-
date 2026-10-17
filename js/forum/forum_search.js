// forum_search.js - 喵坛帖子搜索：世界页「管理」Tab 的入口 → 配置弹窗 → 独立结果页 → 跳原帖
//
// 整体照着 js/chat/chat_search.js 抄（弹窗结构、showLoadingToast 的搜索动画、
// 滚动到底分批渲染、独立结果页），三处**故意不一样**，都是被数据形状逼的：
//
// 1) 结果数组存的是**轻量投影**，不是整条 post。一条帖子平均十几 KB 还拖着整个
//    comments 数组；chat_search 的 allMatchedResults 存完整 msg 是因为单条消息很小，
//    这边照抄的话搜个"的"就能把好几 MB 钉在内存里。投影在 lazy_load.js 的
//    searchForumPostsInDB 里产出，点进详情时才按 id 去库里取整条。
//
// 2) 跳转前**必须把帖子并进 db.forumPosts**，见 _openSearchedPost 的注释。
//
// 3) 退出结果页的清理走 window._screenLeaveHooks，不给返回按钮绑 click。
//    chat_search.js 那边是「data-target + 自己再 addEventListener 一个 switchScreen」，
//    switchScreen 会跑两遍（forum_core.js:60 记着这个坑的来历）—— 新写的别再犯。

// 结果数组：元素是 searchForumPostsInDB 产出的投影
// { id, title, username, timestamp, hitIn, hitAuthor, snippet }
let _forumSearchResults = [];
let _forumSearchRendered = 0;
const FORUM_SEARCH_BATCH = 50;

function setupForumSearchFeature() {
    const openBtn = document.getElementById('forum-post-search-btn');
    const modal = document.getElementById('forum-search-config-modal');
    const form = document.getElementById('forum-search-config-form');
    const cancelBtn = document.getElementById('cancel-forum-search-btn');
    const scrollContainer = document.getElementById('forum-search-scroll-container');

    if (!openBtn || !modal || !form) return;

    // setupForumFeature 每次都会调到这儿，重复绑会让一次提交搜两遍
    if (openBtn.dataset.searchBound === '1') return;
    openBtn.dataset.searchBound = '1';

    openBtn.addEventListener('click', openForumSearchModal);

    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => modal.classList.remove('visible'));
    }
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.remove('visible');
    });

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const dateVal = (document.getElementById('forum-search-date-input') || {}).value || '';
        const keywordVal = ((document.getElementById('forum-search-keyword-input') || {}).value || '').trim();
        const scopeVal = (document.getElementById('forum-search-scope-select') || {}).value || 'all';

        if (!dateVal && !keywordVal) {
            showToast('请至少输入一个搜索条件');
            return;
        }
        performForumSearch(dateVal, keywordVal, scopeVal);
    });

    // 滚动到底加载下一批
    if (scrollContainer) {
        scrollContainer.addEventListener('scroll', () => {
            if (_forumSearchRendered >= _forumSearchResults.length) return;
            const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
            if (scrollTop + clientHeight >= scrollHeight - 100) {
                _renderNextForumSearchBatch();
            }
        });
    }

    // 离开结果页时释放：几百上千个 DOM 节点 + 投影数组没必要一直留着。
    // ★ 但去帖子详情不清 —— 详情页的返回按钮被 renderPostDetail 指回了本页，
    //   用户看完一条还要回来接着翻，清了就是一片空白。
    window._screenLeaveHooks = window._screenLeaveHooks || {};
    window._screenLeaveHooks['forum-search-results-screen'] = (targetId) => {
        if (targetId === 'forum-post-detail-screen') return;
        const list = document.getElementById('forum-search-results-list');
        if (list) list.innerHTML = '';
        _forumSearchResults = [];
        _forumSearchRendered = 0;
    };
}

function openForumSearchModal() {
    const modal = document.getElementById('forum-search-config-modal');
    const form = document.getElementById('forum-search-config-form');
    if (!modal || !form) return;
    form.reset(); // 范围回到首项「全文」
    modal.classList.add('visible');
    setTimeout(() => {
        const kw = document.getElementById('forum-search-keyword-input');
        if (kw) kw.focus();
    }, 100);
}

async function performForumSearch(dateStr, keyword, scope) {
    const modal = document.getElementById('forum-search-config-modal');
    const list = document.getElementById('forum-search-results-list');
    const scrollContainer = document.getElementById('forum-search-scroll-container');
    const emptyEl = document.getElementById('forum-search-empty');
    const noMoreEl = document.getElementById('forum-search-no-more');
    const loadingEl = document.getElementById('forum-search-loading');

    if (!window.dexieDB) { showToast('数据库未就绪'); return; }

    // 先收弹窗再转圈：叠在一起会让人以为还能改条件重搜（抄 chat_search.js 的处理）。
    // 出错时再放回来，输入框内容还在（reset 只发生在 openForumSearchModal）。
    if (modal) modal.classList.remove('visible');

    const hideLoading = (typeof showLoadingToast === 'function')
        ? showLoadingToast('搜索中…') : null;

    try {
        const results = await window.searchForumPostsInDB(dateStr, keyword, scope);
        if (hideLoading) hideLoading();

        _forumSearchResults = results;
        _forumSearchRendered = 0;
        if (list) list.innerHTML = '';
        if (scrollContainer) scrollContainer.scrollTop = 0;
        if (emptyEl) emptyEl.style.display = 'none';
        if (noMoreEl) noMoreEl.style.display = 'none';
        if (loadingEl) loadingEl.style.display = 'none';

        switchScreen('forum-search-results-screen');

        if (_forumSearchResults.length === 0) {
            if (emptyEl) emptyEl.style.display = 'block';
        } else {
            _renderNextForumSearchBatch();
        }
    } catch (e) {
        if (hideLoading) hideLoading();
        console.error('❌ [帖子搜索] 失败:', e);
        if (modal) modal.classList.add('visible'); // 放回弹窗供改条件重试
        showToast('搜索失败：' + e.message);
    }
}

function _renderNextForumSearchBatch() {
    const list = document.getElementById('forum-search-results-list');
    const loadingEl = document.getElementById('forum-search-loading');
    const noMoreEl = document.getElementById('forum-search-no-more');
    if (!list) return;

    if (loadingEl) loadingEl.style.display = 'block';

    requestAnimationFrame(() => {
        const start = _forumSearchRendered;
        const end = Math.min(start + FORUM_SEARCH_BATCH, _forumSearchResults.length);
        const fragment = document.createDocumentFragment();

        for (let i = start; i < end; i++) {
            fragment.appendChild(_createForumSearchItem(_forumSearchResults[i]));
        }
        list.appendChild(fragment);
        _forumSearchRendered = end;

        if (loadingEl) loadingEl.style.display = 'none';
        if (_forumSearchRendered >= _forumSearchResults.length && noMoreEl) {
            noMoreEl.style.display = 'block';
        }
    });
}

const FORUM_HIT_LABEL = { title: '标题', content: '正文', comment: '评论' };

function _createForumSearchItem(hit) {
    const item = document.createElement('div');
    item.className = 'search-result-item forum-search-result-item';

    // 标题走 forumCleanTitle：老数据的标题带 "[New!] " 前缀，不洗的话结果页里满屏都是
    const title = ((typeof forumCleanTitle === 'function')
        ? forumCleanTitle(hit.title) : hit.title) || '无标题';

    const d = new Date(hit.timestamp || 0);
    const timeStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-`
        + `${String(d.getDate()).padStart(2, '0')} `
        + `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

    // 命中在评论里时署名换成评论人：卡片上只有一行作者名，显示楼主的话
    // 用户看到的是个跟关键词毫不相干的名字，会以为搜歪了
    const author = (hit.hitIn === 'comment' && hit.hitAuthor) ? hit.hitAuthor : hit.username;
    const authorPrefix = (hit.hitIn === 'comment' && hit.hitAuthor) ? '评论 @' : '@';

    const esc = (s) => (typeof DOMPurify !== 'undefined')
        ? DOMPurify.sanitize(s || '', { ALLOWED_TAGS: [] })
        : String(s || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

    const hitLabel = FORUM_HIT_LABEL[hit.hitIn];
    const badge = hitLabel
        ? `<span class="forum-result-hit forum-result-hit-${hit.hitIn}">${hitLabel}</span>`
        : '';

    item.innerHTML = `
        <div class="result-header">
            <span class="result-sender">${esc(title)}</span>
            <span class="result-time">${timeStr}</span>
        </div>
        <div class="result-content">${esc(hit.snippet)}</div>
        <div class="forum-result-meta">
            ${badge}
            <span class="forum-result-author">${esc(authorPrefix + (author || '匿名'))}</span>
        </div>
    `;

    item.addEventListener('click', () => _openSearchedPost(hit.id));
    return item;
}

// 点结果 → 打开原帖详情页（一律落在帖子顶部）
async function _openSearchedPost(postId) {
    let post = (db.forumPosts || []).find(p => String(p.id) === String(postId));

    // ★ 懒加载窗口只有「最新 100 条 + 收藏 + 在看」，搜出来的老帖大概率不在内存里。
    //   renderPostDetail(post) 吃的是完整 post 对象，光把库里取出的对象传进去是不够的：
    //   它内部会调 saveSinglePost(post.id)，而那个函数按 db.forumPosts.find 回查
    //  （database.js:885），查不到就静默 return —— 表现为帖子能看，但 isNew 清不掉、
    //   在这儿发的评论下次进来就没了。所以必须先并进内存窗口。
    //   并进来的老帖是「散点」，比 window._forumOldestContiguousTs 更旧，这不破坏
    //   懒加载的不变量（收藏/在看本来就是这么散着放的），游标不用动。
    if (!post) {
        try {
            post = await window.dexieDB.forumPosts.get(postId);
            if (!post) {
                // 老数据的主键可能是数字，get(字符串) 拿不到，按 String 全表兜一次
                await window.dexieDB.forumPosts.toCollection().each(p => {
                    if (!post && String(p.id) === String(postId)) post = p;
                });
            }
        } catch (e) {
            console.error('❌ [帖子搜索] 取帖失败:', e);
        }
        if (post) {
            db.forumPosts = db.forumPosts || [];
            db.forumPosts.push(post);
            // 帖子排序铁律：只按 timestamp 倒序
            db.forumPosts.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        }
    }

    if (!post) { showToast('帖子似乎已被删除'); return; }

    // 让详情页的返回按钮指回搜索结果页（renderPostDetail 读的就是这个全局）
    currentSourceScreen = 'forum-search-results-screen';
    renderPostDetail(post);
    switchScreen('forum-post-detail-screen');
    const area = document.getElementById('detail-content-area');
    if (area) area.scrollTop = 0;
}
