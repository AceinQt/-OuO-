// forum_core.js - 论坛核心：分页/滚动状态、懒加载前缀、匿名名、自定义CSS、底部导航、主入口 setupForumFeature

// --- 分页控制变量 ---
let currentForumPage = 1;
const FORUM_PAGE_SIZE = 15; // 每次加载15条
let isForumLoadingMore = false; // 防止滚动时重复触发
// --- 论坛滚动位置记忆 ---
let savedForumScrollY = 0;

// ★ [论坛懒加载 F5] 连续前缀长度：窗口数组倒序排列，前缀（timestamp >= 游标）与 DB 最新一段
//   完全一致、无缝隙；比游标更旧的只有收藏/在看散点，中间有缝。翻页绝不能直接翻进散点区，
//   否则会跳帖；必须先 fetchOlderForumPosts 把缝补齐（见下方滚动监听）。
function _forumContiguousCount() {
    const posts = db.forumPosts || [];
    const boundary = window._forumOldestContiguousTs;
    if (boundary === undefined || boundary === Number.NEGATIVE_INFINITY) return posts.length;
    const idx = posts.findIndex(p => (p.timestamp || 0) < boundary);
    return idx === -1 ? posts.length : idx;
}

// ★ New! 标记的语义是「你还没看过」，实现是帖子上的 isNew 字段，点开详情即已读（照 peek 的做法）。
//   标题里不再写任何标记。这个函数只为兼容遗留数据而留：
//   Dexie v17 升级已把库里的 "[New!] xxx" 前缀洗干净了，但导入旧备份会把带前缀的标题
//   重新写进表（backup_data.js 的 forumPosts 分支是直接 bulkPut 备份里的原始对象），
//   所以所有「拿标题去显示 / 喂给 AI」的地方都过一遍这里。
function forumCleanTitle(title) {
    if (typeof title !== 'string') return '';
    return title.replace(/^\[New!\]\s*/, '').replace(/^【新】/, '');
}
            
                                    // --- 新增：获取匿名名字 (喵叽+4位代号) ---
            function getAnonymousName() {
                const identity = db.forumUserIdentity || {};
                // 获取代号，默认为 0311，确保补足4位
                const code = (identity.anonCode || '0311').toString().padStart(4, '0');
                return `喵叽${code}`;
            }

            // --- 新增：应用用户自定义的正文CSS ---
            function applyCustomPostCss() {
                // 1. 获取用户保存的 CSS
                const identity = db.forumUserIdentity || {};
                const customCss = identity.customDetailCss;

                // 2. 查找 or 创建 style 标签
                let styleTag = document.getElementById('user-post-detail-style');
                if (!styleTag) {
                    styleTag = document.createElement('style');
                    styleTag.id = 'user-post-detail-style';
                    document.head.appendChild(styleTag);
                }

                // 3. 注入样式，限定在 .post-detail-content-body 范围内
                if (customCss && customCss.trim()) {
                    styleTag.textContent = `.post-detail-content-body { ${customCss} }`;
                } else {
                    styleTag.textContent = '';
                }
            }
                        // --- 喵坛底部导航栏 ---
// ⚠️ 这里原来有个 setupBottomNavigation()：给 .bottom-tab-bar 绑 click → switchScreen。
// 但 4 个 .tab-item 都带 data-target，main.js:315 的 body 委托
// ([data-target] → navigateTo → switchScreen) 本来就会处理它们 —— 于是每点一下底部导航
// switchScreen 跑两遍，下游每个 screen 的 MutationObserver 也跟着跑两遍
//（世界页那个会把所有角色头像的 base64 重新塞一遍 DOM，就是「点世界栏目有点延迟」的由来）。
// 已整个删掉，导航全交给 body 委托：它还多一道 isUiBusy 忙锁，比这里更严。
// 别再在论坛这边重新绑一个 —— 要改导航行为就去改 main.js 那一处。

            function setupForumFeature() {
                const refreshBtn = document.getElementById('forum-refresh-btn');
                const createBtn = document.getElementById('forum-create-btn');
                const postsContainer = document.getElementById('forum-posts-container');
                const forumScreen = document.getElementById('forum-screen');

                // 1. 初始化新模块
                setupMePageFeature();
                setupForumBindingFeature();
                setupForumAdminFeature();
                setupFavoritesFeature();
                setupForumMultiSelectFeature();
                renderHotPosts();

// 修改 JS 选择器
const scrollableArea = document.querySelector('#forum-screen .forum-content-area');
    
    if (scrollableArea) {
        scrollableArea.addEventListener('scroll', async () => {
            // 简单的防抖锁
            if (isForumLoadingMore) return;

            // 距离底部 100px 时触发加载
            const threshold = 300;
            const distanceToBottom = scrollableArea.scrollHeight - (scrollableArea.scrollTop + scrollableArea.clientHeight);

            if (distanceToBottom < threshold) {
                isForumLoadingMore = true;
                try {
                    // ★ [论坛懒加载 F5] 下一页若会越过"连续前缀"（更旧的只有收藏/在看散点，中间有缝），
                    //   先查 DB 把缝补齐再翻页，防止跳帖/重复渲染。开关关闭时游标为 undefined，
                    //   _forumContiguousCount() 返回全长，这段 while 不会进入，行为与原来完全一致。
                    if (window.LAZY_FORUM) {
                        const nextEnd = (currentForumPage + 1) * FORUM_PAGE_SIZE;
                        let guard = 0;
                        while (window._forumOldestContiguousTs !== Number.NEGATIVE_INFINITY
                               && _forumContiguousCount() < nextEnd && guard++ < 10) {
                            const inMemoryIds = new Set((db.forumPosts || []).map(p => p.id));
                            const older = await window.fetchOlderForumPosts(
                                window._forumOldestContiguousTs, inMemoryIds, FORUM_PAGE_SIZE * 2);
                            if (older.length === 0) {
                                window._forumOldestContiguousTs = Number.NEGATIVE_INFINITY; // DB 到底
                                break;
                            }
                            db.forumPosts.push(...older);
                            // 帖子排序铁律：只按 timestamp 倒序（散点老帖会落到正确位置）
                            db.forumPosts.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
                            window._forumOldestContiguousTs = older[older.length - 1].timestamp || 0;
                        }
                    }

                    const totalPosts = db.forumPosts ? db.forumPosts.length : 0;
                    // 如果还有未加载的数据
                    if (totalPosts > currentForumPage * FORUM_PAGE_SIZE) {
                        currentForumPage++; // 页码+1
                        renderForumPosts(db.forumPosts, true); // true = 追加模式
                    }
                } catch (err) {
                    console.error('❌ [论坛加载更多] 失败:', err);
                } finally {
                    // 解锁
                    setTimeout(() => { isForumLoadingMore = false; }, 200);
                }
            }
        });
    }


                // 2. 搜索/刷新按钮
                if (refreshBtn) {
                    refreshBtn.addEventListener('click', () => {
                        handleForumRefresh();
                    });
                }

                // 3. 发帖按钮逻辑
                if (createBtn) {
                    const createModal = document.getElementById('forum-create-post-modal');
                    const confirmCreate = document.getElementById('confirm-create-post-btn');
                    const anonCheckbox = document.getElementById('create-post-is-anon');

                    // 点击“发帖”按钮打开弹窗
                    createBtn.addEventListener('click', () => {
                        document.getElementById('create-post-title').value = '';
                        document.getElementById('create-post-content').value = '';

                        // 默认不勾选匿名
                        if (anonCheckbox) anonCheckbox.checked = false;

                        createModal.classList.add('visible');
                    });

                    // 点击遮罩层关闭
                    createModal.addEventListener('click', (e) => {
                        if (e.target === createModal) {
                            createModal.classList.remove('visible');
                        }
                    });

                    // 确认发送按钮
                    const newConfirmBtn = confirmCreate.cloneNode(true);
                    confirmCreate.parentNode.replaceChild(newConfirmBtn, confirmCreate);

                    newConfirmBtn.addEventListener('click', async () => {
                        const titleInput = document.getElementById('create-post-title').value.trim();
                        const content = document.getElementById('create-post-content').value.trim();

                        // 获取身份
                        const isAnon = anonCheckbox ? anonCheckbox.checked : false;
                        const myIdentity = db.forumUserIdentity || { nickname: '我', avatar: '' };

                        // 【修改】使用 getAnonymousName()
                        const selectedAuthor = isAnon ? getAnonymousName() : (myIdentity.nickname || '我');

                        if (!titleInput || !content) {
                            showToast('标题和内容不能为空');
                            return;
                        }

                        let postAvatar = null;
                        let isUserPost = false;

                        // 如果不是匿名，标记为本人并保存头像
                        if (!isAnon) {
                            postAvatar = myIdentity.avatar || './png/avatar_default.jpg';
                            isUserPost = true;
                        }

                        if (!db.forumPosts) db.forumPosts = [];

                        // 自己发的帖不标 New! —— 那个标记的意思是「你还没看过」
                        const newPost = {
                            id: `post_${Date.now()}_${Math.random()}`,
                            username: selectedAuthor,
                            title: titleInput,
                            content: content,
                            likeCount: Math.floor(Math.random() * 9000) + 50,
                            comments: [],
                            timestamp: Date.now(),
                            avatar: postAvatar,
                            isUser: isUserPost
                        };

                        db.forumPosts.unshift(newPost);
// 使用新函数保存这一条新帖
await saveSinglePost(newPost.id); 
renderForumPosts(db.forumPosts);

                        createModal.classList.remove('visible');
                        showToast('发送成功');
                    });
                }

                // 4. 帖子列表点击进入详情
                if (postsContainer) {
                    postsContainer.addEventListener('click', (e) => {
                        const card = e.target.closest('.forum-post-card[data-id]');
                        if (card) {
                            // 长按多选模式下，点卡片是勾选/取消勾选，不进详情
                            // （长按抬手补的那一发 click 由 toggle 自己挡掉）
                            if (typeof isForumMultiSelectActive === 'function' && isForumMultiSelectActive()) {
                                toggleForumPostSelection(card.dataset.id);
                                return;
                            }
   // 1. 【新增】保存当前滚动条位置
            const scrollArea = document.querySelector('#forum-screen .forum-content-area');
            if (scrollArea) {
                savedForumScrollY = scrollArea.scrollTop;
            }                         currentSourceScreen = 'forum-screen';
                            const postId = card.dataset.id;
                            const post = db.forumPosts.find(p => p.id === postId);
                            if (post) {
                                // 从详情页返回时 observer 走「已有内容就不重绘」分支，卡片 DOM 不会刷新，
                                // 所以徽章得在这里当场摘掉（renderPostDetail 只改数据）
                                const badge = card.querySelector('.new-badge');
                                if (badge) badge.remove();

                                renderPostDetail(post);
                                switchScreen('forum-post-detail-screen');
                                const detailContent = document.getElementById('detail-content-area');
                                if (detailContent) {
                                    detailContent.scrollTop = 0;
                                }
                            }
                        }
                    });
                }

                // 5. 观察者

// ★ 同世界页/我页/收藏页：只在「不活跃 → 活跃」跳变时干活。
//   下面「列表已有内容就只恢复滚动位置」那个 hasContent 分支本来就挡住了重绘，
//   但搜索框重置、底部导航高亮这些原先每条 class 变更记录都要跑一遍，白跑好几次
//   （switchScreen 一次会攒出多条记录：先给所有 .screen 去 active、再给目标加 active）。
let forumWasActive = forumScreen ? forumScreen.classList.contains('active') : false;
const observer = new MutationObserver(() => {
    const isActive = forumScreen.classList.contains('active');
    if (isActive === forumWasActive) return;   // 同一次切换的其余记录，直接丢
    forumWasActive = isActive;
    if (!isActive) {
        // 离开主页时把多选态收掉：底部那条操作条盖的是**全局**导航栏，
        // 不收的话它会跟着用户去世界页/收藏页，还把导航栏一直压着
        if (typeof exitForumMultiSelectMode === 'function') exitForumMultiSelectMode();
        return;
    }

    // 1. 搜索框重置
    const searchInput = document.getElementById('forum-search-input');
    if (searchInput) searchInput.value = '';

    // 2. 底部导航激活
    const bottomNav = document.querySelector('.bottom-tab-bar');
    if (bottomNav) {
        bottomNav.querySelectorAll('.tab-item').forEach(tab => tab.classList.remove('active'));
        const discoverTab = bottomNav.querySelector('.tab-item[data-target="forum-screen"]');
        if (discoverTab) discoverTab.classList.add('active');
    }

    // 3. 列表：已有内容就绝对不重绘，只恢复滚动位置
    const postsContainer = document.getElementById('forum-posts-container');
    const scrollArea = document.querySelector('#forum-screen .forum-content-area');

    // 判断当前列表是否有内容（排除 loading 和 占位符）
    const hasContent = postsContainer.children.length > 0 &&
                       !postsContainer.querySelector('.placeholder-text') &&
                       !postsContainer.querySelector('.temp-loading');

    if (db.forumPosts && db.forumPosts.length > 0) {
        if (hasContent) {
            // A. 列表里已经有帖子（从详情页返回，或切了 Tab 又切回来）
            //    -> 绝对不要重绘！保留现有 DOM（包括已经翻出来的那几十页）
            //    -> 仅恢复滚动位置
            if (scrollArea && savedForumScrollY > 0) {
                // 稍微延迟一点，确保浏览器切换显示的渲染完成
                requestAnimationFrame(() => {
                    scrollArea.scrollTop = savedForumScrollY;
                });
            }
        } else {
            // B. 列表是空的（第一次打开，或被强制刷新过）-> 初始化渲染
            renderForumPosts(db.forumPosts, false);
            renderHotPosts();

            // 既然是重新渲染，位置归零
            if (scrollArea) scrollArea.scrollTop = 0;
            savedForumScrollY = 0;
        }
    }
});

                if (forumScreen) {
                    observer.observe(forumScreen, { attributes: true, attributeFilter: ['class'] });
                }

                setupDetailScreenEvents();
                
            }

