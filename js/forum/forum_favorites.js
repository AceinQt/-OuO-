// forum_favorites.js - Favorites & watching lists: tab switch, manage mode, batch delete

            function setupFavoritesFeature() {
                const listContainer = document.getElementById('favorites-list-container');
                const manageBtn = document.getElementById('fav-manage-btn');
                const actionsBar = document.getElementById('fav-manage-actions');
                const deleteBtn = document.getElementById('fav-delete-confirm-btn');
                const tabBtns = document.querySelectorAll('.fav-tab-btn');

                let isManageMode = false;
                let currentFavTab = 'my-fav';

                // 1. Tab 切换逻辑
                tabBtns.forEach(btn => {
                    btn.addEventListener('click', () => {
                        tabBtns.forEach(b => b.classList.remove('active'));
                        btn.classList.add('active');
                        currentFavTab = btn.dataset.tab;

                        if (isManageMode) {
                            if (manageBtn) manageBtn.click();
                        } else {
                            renderFavoritesList();
                        }
                    });
                });

                // 2. 核心渲染函数 (含新样式逻辑)
                window.renderFavoritesList = function () {
                    if (!listContainer) return;
                    listContainer.innerHTML = '';

                    let targetIds = [];
                    let emptyText = '';

                    if (currentFavTab === 'my-fav') {
                        targetIds = db.favoritePostIds || [];
                        emptyText = '暂无收藏内容';
                    } else {
                        targetIds = db.watchingPostIds || [];
                        emptyText = '角色暂无正在关注的帖子';
                    }

                    if (!targetIds || targetIds.length === 0) {
                        listContainer.innerHTML = `<p class="placeholder-text" style="margin-top:50px;">${emptyText}</p>`;
                        return;
                    }

                    const displayIds = [...targetIds].reverse();

                    displayIds.forEach(id => {
                        const post = db.forumPosts.find(p => String(p.id) === String(id));
                        if (!post) return;

                        // --- 创建卡片 ---
                        const card = document.createElement('div');
                        // 添加 custom-check-item 类以支持选中样式过渡
                        card.className = 'fav-post-card custom-check-item';
                        card.style.cursor = 'pointer';

                        // 隐藏的复选框 (保留逻辑功能，但视觉隐藏)
                        const checkbox = document.createElement('input');
                        checkbox.type = 'checkbox';
                        checkbox.className = 'fav-checkbox hidden-checkbox';
                        checkbox.value = id;

                        const contentDiv = document.createElement('div');
                        contentDiv.className = 'fav-post-content';

                        const title = post.title ? post.title.replace(/^\[New!\]\s*/, '').replace(/^【新】/, '') : '无标题';
                        const timeStr = post.timestamp ? new Date(post.timestamp).toLocaleString() : '未知时间';
                        contentDiv.innerHTML = `
                <div class="fav-post-title">${title}</div>
                <div class="fav-post-meta">
                    <span>${post.username || '匿名'}</span>
                    <span>${timeStr}</span>
                </div>
            `;

                        card.appendChild(checkbox);
                        card.appendChild(contentDiv);

                        // --- 点击事件 ---
                        card.onclick = (e) => {
                            if (isManageMode) {
                                // 管理模式：切换选中状态和 UI 样式
                                checkbox.checked = !checkbox.checked;
                                if (checkbox.checked) {
                                    card.classList.add('selected');
                                } else {
                                    card.classList.remove('selected');
                                }
                            } else {
                                // 正常模式：跳转详情
                                currentSourceScreen = 'favorites-screen';
                                renderPostDetail(post);
                                switchScreen('forum-post-detail-screen');
                                const detailContent = document.getElementById('detail-content-area');
                                if (detailContent) detailContent.scrollTop = 0;
                            }
                        };

                        listContainer.appendChild(card);
                    });
                };

                // 3. 切换管理模式逻辑
                const newManageBtn = manageBtn.cloneNode(true);
                manageBtn.parentNode.replaceChild(newManageBtn, manageBtn);

                newManageBtn.addEventListener('click', () => {
                    isManageMode = !isManageMode;

                    if (isManageMode) {
                        listContainer.classList.add('manage-mode');
                        actionsBar.style.display = 'flex';
                        newManageBtn.style.color = '#ff4444';
                    } else {
                        listContainer.classList.remove('manage-mode');
                        actionsBar.style.display = 'none';
                        newManageBtn.style.color = '';
                    }
                    renderFavoritesList();
                });

                // 4. 批量删除逻辑
                const newDeleteBtn = deleteBtn.cloneNode(true);
                deleteBtn.parentNode.replaceChild(newDeleteBtn, deleteBtn);

                newDeleteBtn.addEventListener('click', async () => {
                    const checked = document.querySelectorAll('.fav-checkbox:checked');
                    if (checked.length === 0) return;

                    const actionName = currentFavTab === 'my-fav' ? '取消收藏' : '移除关注';

                    if (await AppUI.confirm(`确定${actionName}这 ${checked.length} 个帖子吗？`, "系统提示", "确认", "取消")) {
                        const idsToRemove = Array.from(checked).map(cb => cb.value);

                        if (currentFavTab === 'my-fav') {
                            db.favoritePostIds = db.favoritePostIds.filter(id => !idsToRemove.includes(id));
                        } else {
                            db.watchingPostIds = db.watchingPostIds.filter(id => !idsToRemove.includes(id));
                        }

await saveForumMeta();
renderFavoritesList();
showToast(`已${actionName}`);

                        newManageBtn.click(); // 退出管理模式
                    }
                });

                renderFavoritesList();

                // 自动刷新监听
                const favScreen = document.getElementById('favorites-screen');
                if (favScreen && !favScreen.dataset.observerAttached) {
                    const observer = new MutationObserver((mutations) => {
                        for (let mutation of mutations) {
                            if (mutation.attributeName === 'class') {
                                if (favScreen.classList.contains('active')) {
                                    renderFavoritesList();
                                }
                            }
                        }
                    });
                    observer.observe(favScreen, { attributes: true });
                    favScreen.dataset.observerAttached = "true";
                }
            }
