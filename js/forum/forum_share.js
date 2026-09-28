// forum_share.js - 分享到聊天：分享弹窗与富上下文构建

            function setupShareModal() {
                const modal = document.getElementById('share-post-modal');
                const confirmBtn = document.getElementById('confirm-share-btn');
                const charList = document.getElementById('share-char-list');
                const groupList = document.getElementById('share-group-list');
                const countInput = document.getElementById('share-comment-count-input'); // 获取输入框
                const tabBar = document.getElementById('share-target-tab-bar');

                // --- tab 切换：私聊 / 群聊 ---
                if (tabBar) {
                    tabBar.querySelectorAll('.char-info-tab-btn').forEach(btn => {
                        btn.addEventListener('click', () => {
                            tabBar.querySelectorAll('.char-info-tab-btn').forEach(b => b.classList.remove('active'));
                            btn.classList.add('active');
                            const isPrivate = btn.dataset.shareTab === 'private';
                            charList.style.display = isPrivate ? '' : 'none';
                            if (groupList) groupList.style.display = isPrivate ? 'none' : '';
                        });
                    });
                }

                const newBtn = confirmBtn.cloneNode(true);
                confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);

                newBtn.addEventListener('click', async () => {
                    const selectedCharIds = Array.from(charList.querySelectorAll('input:checked')).map(input => input.value);
                    const selectedGroupIds = groupList
                        ? Array.from(groupList.querySelectorAll('input:checked')).map(input => input.value)
                        : [];

                    if (selectedCharIds.length === 0 && selectedGroupIds.length === 0) {
                        showToast('请至少选择一个分享对象。');
                        return;
                    }

                    // 获取用户输入的条数
                    let commentCount = 30;
                    if (countInput) {
                        commentCount = parseInt(countInput.value);
                        if (isNaN(commentCount) || commentCount < 0) commentCount = 0;
                    }

                    // 一次可能分享好几个帖子（主页长按多选→转发）。单帖路径写的也是
                    // 这个 postIds，dataset.postId 只留给下面那条兜底用。
                    let postIds = [];
                    try {
                        postIds = JSON.parse(modal.dataset.postIds || '[]');
                    } catch (e) { postIds = []; }
                    if (postIds.length === 0 && modal.dataset.postId) postIds = [modal.dataset.postId];

                    let sentPosts = 0;
                    for (const postId of postIds) {
                        // 按 ID 取帖（openSharePostModal 存的）。以前这里用
                        // title.includes(...) 模糊找，标题重复或被改过就会分享错帖子。
                        const targetPost = db.forumPosts.find(p => String(p.id) === String(postId));

                        // 懒加载窗口外取不到帖时，用打开弹窗那会儿抄下来的快照兜底。
                        // 快照只有一份（第一个帖子的），所以多选时取不到就只能跳过。
                        const share = targetPost
                            ? _buildPostSharePayload(targetPost, commentCount)
                            : (postIds.length === 1 ? {
                                title: modal.dataset.postTitle,
                                category: (typeof SHARE_FORUM_CATEGORY !== 'undefined')
                                    ? SHARE_FORUM_CATEGORY : '来自喵坛的分享',
                                body: modal.dataset.postRawContent || '',
                                extra: modal.dataset.postRichContext || '',
                            } : null);
                        if (!share) continue;

                        // 和 + 号面板手动分享、AI 自己发、转发聊天记录共用一套格式和
                        // 投递口径。构建/投递都在 js/chat/chat_feature_share.js ——
                        // 这里别再写一遍循环，两份迟早分叉（发送者昵称取哪个字段、
                        // 群聊要不要补 senderId 这类事）。
                        await deliverShareToChats({
                            charIds: selectedCharIds,
                            groupIds: selectedGroupIds,
                        }, share);
                        sentPosts++;
                    }

                    try { if (typeof renderChatList === 'function') renderChatList(); } catch (e) { }

                    modal.classList.remove('visible');
                    // 主页长按多选转发过来的：发完才退出多选（弹窗里点取消时选中的还留着）
                    if (typeof exitForumMultiSelectMode === 'function') exitForumMultiSelectMode();

                    const totalCount = selectedCharIds.length + selectedGroupIds.length;
                    if (sentPosts === 0) {
                        showToast('分享失败，没找到帖子内容。');
                    } else if (sentPosts > 1) {
                        showToast(`已把 ${sentPosts} 个帖子分享给 ${totalCount} 个聊天！`);
                    } else {
                        showToast(`成功分享给 ${totalCount} 个聊天！`);
                    }
                });
            }

            // 一个帖子 → 一张分享卡片的载荷。多选转发时按帖循环调用：**一帖一张**，
            // 不合并成一张 —— 卡片的字段边界是靠行首关键字切的（见 parseShareFields），
            // 几个帖子的正文挤进一张迟早把边界切坏。
            function _buildPostSharePayload(post, commentCount) {
                const postTime = new Date(post.timestamp || Date.now()).toLocaleString();
                let commentsText = "暂无评论";

                if (post.comments && post.comments.length > 0) {
                    // 数组本身是按时间 push 的，slice(-N) 取最后 N 条即保持旧→新顺序
                    let recentComments = [];
                    if (commentCount > 0) {
                        recentComments = post.comments.slice(-commentCount);
                    }
                    commentsText = recentComments.length
                        ? recentComments.map(c => `${c.username}: ${c.content}`).join('\n')
                        : "（本次未附带评论）";
                }

                return {
                    title: forumCleanTitle(post.title) || "无标题",
                    category: (typeof SHARE_FORUM_CATEGORY !== 'undefined')
                        ? SHARE_FORUM_CATEGORY : '来自喵坛的分享',
                    // 正文存**全文**，不在这里截断 —— 卡片上的省略交给渲染层。
                    // 以前先截 50 字再存，那条消息里的正文就永久只有 50 字了。
                    body: post.content || "",
                    extra: `发帖人：${post.username}\n发布时间：${postTime}\n\n【最新 ${commentCount} 条评论】\n${commentsText}`,
                };
            }

            // 完整替换 openSharePostModal 函数
            // 吃单个 postId（详情页分享）或一串 postId（主页长按多选→转发）
            function openSharePostModal(postIdOrIds) {
                const wantIds = (Array.isArray(postIdOrIds) ? postIdOrIds : [postIdOrIds]).map(String);
                const posts = wantIds
                    .map(id => db.forumPosts.find(p => String(p.id) === id))
                    .filter(Boolean);
                if (posts.length === 0) {
                    showToast('找不到该帖子信息。');
                    return;
                }

                const modal = document.getElementById('share-post-modal');
                const charList = document.getElementById('share-char-list');
                const groupList = document.getElementById('share-group-list');
                const detailsElement = modal.querySelector('details');

                const firstPost = posts[0];

                // --- 1. 清理标题中的遗留 [New!] 前缀（旧备份导入的数据可能还带着） ---
                const cleanTitle = forumCleanTitle(firstPost.title) || "无标题";

                // --- 2. 将数据存入 dataset ---
                // 发送时按这串 ID 取帖，一帖一张卡片
                modal.dataset.postIds = JSON.stringify(posts.map(p => p.id));

                // ID 是发送时取帖的唯一依据，别删（以前只存标题，靠模糊匹配找帖）
                modal.dataset.postId = firstPost.id;

                // 存入清理后的标题
                modal.dataset.postTitle = cleanTitle;

                // 原始正文：发送时若按 ID 取不到帖（比如懒加载窗口外）就用这份兜底
                modal.dataset.postRawContent = firstPost.content || "";

                // --- 3. 兜底用的附加信息（正常路径下发送时会按实际条数重新拼） ---
                const postTime = new Date(firstPost.timestamp || Date.now()).toLocaleString();
                let commentsText = "";
                if (firstPost.comments && firstPost.comments.length > 0) {
                    // 取最新30条评论，倒序（最新的在前）
                    const recentComments = firstPost.comments.slice(-30).reverse();
                    commentsText = recentComments.map(c => `${c.username}: ${c.content}`).join('\n');
                } else {
                    commentsText = "暂无评论";
                }

                modal.dataset.postRichContext = `发帖人：${firstPost.username}\n发布时间：${postTime}\n\n【最新评论】\n${commentsText}`;

                // 多选转发时把条数写进标题，免得用户以为只发了一个
                const heading = modal.querySelector('h3');
                if (heading) {
                    heading.textContent = posts.length > 1
                        ? `分享 ${posts.length} 个帖子给角色`
                        : '分享帖子给角色';
                }

                // --- 4. 渲染分享对象列表 ---
                charList.innerHTML = '';
                if (db.characters.length > 0) {
                    db.characters.forEach(char => {
                        const li = document.createElement('li');
                        li.className = 'binding-list-item';
                        li.innerHTML = `
                <input type="checkbox" id="share-to-${char.id}" value="${char.id}">
                <label for="share-to-${char.id}" style="display: flex; align-items: center; gap: 10px;">
                    <img src="${char.avatar}" alt="${char.remarkName}" style="width: 32px; height: 32px; border-radius: 50%;">
                    ${char.remarkName}
                </label>
            `;
                        charList.appendChild(li);
                    });
                } else {
                    charList.innerHTML = '<li style="color: #888;">暂无可以分享的角色。</li>';
                }

                // --- 4.5 渲染群聊列表（与私聊同样式） ---
                if (groupList) {
                    groupList.innerHTML = '';
                    if (db.groups && db.groups.length > 0) {
                        db.groups.forEach(group => {
                            const li = document.createElement('li');
                            li.className = 'binding-list-item';
                            li.innerHTML = `
                <input type="checkbox" id="share-to-group-${group.id}" value="${group.id}">
                <label for="share-to-group-${group.id}" style="display: flex; align-items: center; gap: 10px;">
                    <img src="${group.avatar}" alt="${group.name}" style="width: 32px; height: 32px; border-radius: 50%;">
                    ${group.name}
                </label>
            `;
                            groupList.appendChild(li);
                        });
                    } else {
                        groupList.innerHTML = '<li style="color: #888;">暂无可以分享的群聊。</li>';
                    }
                }

                if (detailsElement) detailsElement.open = false;
                modal.classList.add('visible');
            }
