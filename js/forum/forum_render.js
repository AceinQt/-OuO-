// forum_render.js - 列表渲染：24小时热帖榜 + 帖子列表分页渲染

            function renderHotPosts() {
                const container = document.getElementById('hot-posts-section');
                const list = document.getElementById('hot-posts-list');
                if (!container || !list) return;

                if (!db.forumPosts || db.forumPosts.length === 0) {
                    container.style.display = 'none';
                    return;
                }

                const now = Date.now();
                const oneDayAgo = now - 24 * 60 * 60 * 1000;

                const activePosts = db.forumPosts.filter(p => {
                    const postTime = p.timestamp || 0;
                    if (postTime > oneDayAgo) return true;

                    if (p.comments && p.comments.length > 0) {
                        const lastComment = p.comments[p.comments.length - 1];
                        const commentTime = new Date(lastComment.timestamp).getTime();
                        if (!isNaN(commentTime) && commentTime > oneDayAgo) return true;
                    }
                    return false;
                });

                if (activePosts.length === 0) {
                    container.style.display = 'none';
                    return;
                }

                activePosts.sort((a, b) => (b.comments ? b.comments.length : 0) - (a.comments ? a.comments.length : 0));
                const top3 = activePosts.slice(0, 3);

                list.innerHTML = '';
                top3.forEach((post, index) => {
                    const item = document.createElement('div');
                    item.className = 'hot-post-item';
                    item.onclick = () => {
                        const scrollArea = document.getElementById('detail-content-area');
                        if (scrollArea) {
                            savedForumScrollY = scrollArea.scrollTop;
                        }
                        
                        currentSourceScreen = 'forum-screen';
                        renderPostDetail(post);
                        switchScreen('forum-post-detail-screen');
                        const detailContent = document.getElementById('detail-content-area');
                        if (detailContent) detailContent.scrollTop = 0;
                    };

                    const rankClass = `rank-${index + 1}`;
                    const cleanTitle = post.title.replace(/^\[New!\]\s*/, '').replace(/^【新】/, '');
                    // 修改：精确到秒
                    const timeStr = new Date(post.timestamp).toLocaleString();

                    item.innerHTML = `
            <div class="rank-badge ${rankClass}">${index + 1}</div>
            <div class="hot-post-info">
                <div class="hot-post-title">${cleanTitle}</div>
                <div class="hot-post-meta-row">
                    <span>${post.username}</span>
                    <span>评论 ${post.comments ? post.comments.length : 0}</span>
                    <span>${timeStr}</span>
                </div>
            </div>
        `;
                    list.appendChild(item);
                });

                container.style.display = 'block';
            }

// --- 找到 renderForumPosts 函数并完全替换 ---
function renderForumPosts(posts, isAppend = false) {
    const postsContainer = document.getElementById('forum-posts-container');
    if (!postsContainer) return;

    // 1. 如果不是追加模式（即刷新或首次进入），先清空容器（保留 loading）
    if (!isAppend) {
        currentForumPage = 1; // 重置页码
        // 移除所有非 loading 元素
        Array.from(postsContainer.children).forEach(child => {
            if (!child.classList.contains('temp-loading')) child.remove();
        });
        
        // 滚动条回到顶部
        const contentArea = document.querySelector('#forum-screen .forum-content-area');
        if (contentArea) contentArea.scrollTop = 0;
    }

    if (!posts || posts.length === 0) {
        if (!isAppend && !postsContainer.querySelector('.temp-loading')) {
            postsContainer.innerHTML = '<p class="placeholder-text" style="margin-top: 50px;">暂无帖子。<br>点击刷新按钮加载！</p>';
        }
        return;
    }

    // 2. 计算需要渲染的数据切片
    // 如果是 Append，渲染 (Page-1)*Size 到 Page*Size
    // 如果是 Reset，渲染 0 到 Size
    const startIndex = (currentForumPage - 1) * FORUM_PAGE_SIZE;
    const endIndex = startIndex + FORUM_PAGE_SIZE;
    
    // 截取当前页需要的数据
    const postsToRender = posts.slice(startIndex, endIndex);

    // 3. 渲染切片数据
    postsToRender.forEach(post => {
        const card = document.createElement('div');
        card.className = 'forum-post-card';
        card.dataset.id = post.id;
        
        // 简单的入场动画
        card.style.animation = 'fadeIn 0.3s ease-in-out';

        const timeStr = new Date(post.timestamp || Date.now()).toLocaleString();

        const titleEl = document.createElement('h3');
        titleEl.className = 'post-title';

        if (post.title && post.title.startsWith('[New!] ')) {
            const realTitle = post.title.substring(7);
            titleEl.innerHTML = `<span class="new-badge">New!</span>${realTitle}`;
        } else if (post.title && post.title.startsWith('【新】')) {
            const realTitle = post.title.substring(3);
            titleEl.innerHTML = `<span class="new-badge">New!</span>${realTitle}`;
        } else {
            titleEl.textContent = post.title || '无标题';
        }

        const metaEl = document.createElement('div');
        metaEl.className = 'post-meta-row';

        metaEl.innerHTML = `
            <span>♪ ${post.username}</span>
            <span>${timeStr}</span>
        `;

        card.appendChild(titleEl);
        card.appendChild(metaEl);

        postsContainer.appendChild(card);
    });
    
    // 4. 处理“没有更多”的情况 (可选)
    // if (isAppend && postsToRender.length === 0) {
    //    showToast("到底啦~");
    // }
}

