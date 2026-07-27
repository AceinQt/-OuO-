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

                    const postTitle = modal.dataset.postTitle;
                    const postRawContent = modal.dataset.postRawContent || "";
                    // 这里我们需要重新构建 context，因为之前的 dataset 可能只存了部分
                    // 为了确保实时性和自定义条数，最好重新从 DB 读 post
                    const currentPost = db.forumPosts.find(p => p.title.includes(postTitle) || p.content === postRawContent);
                    // 简单的查找方式，实际上 openSharePostModal 应该存 ID
                    // 这里简化逻辑，利用 dataset 里的 ID 更好

                    // 修正：openSharePostModal 需要存 ID
                    // 假设 modal.dataset.postId 存在 (需要在 openSharePostModal 增加一行)

                    let targetPost = currentPost;
                    // 如果上面没找到，尝试模糊匹配

                    let richContext = "";
                    let visibleSnippet = postRawContent.substring(0, 50);
                    if (postRawContent.length > 50) visibleSnippet += "...";

                    if (targetPost) {
                        const postTime = new Date(targetPost.timestamp || Date.now()).toLocaleString();
                        let commentsText = "暂无评论";

                        if (targetPost.comments && targetPost.comments.length > 0) {
                            // --- 关键修改：按顺序切片 ---
                            // 需求：分享评论20-30给角色，角色看到的顺序是20,21...
                            // slice(-N) 获取最后N个。由于数组是按时间push的，所以顺序本身就是旧->新
                            // 直接 slice(-commentCount) 即可保持顺序
                            const sliceCount = commentCount === 0 ? 0 : commentCount;
                            let recentComments = [];
                            if (sliceCount > 0) {
                                recentComments = targetPost.comments.slice(-sliceCount);
                            }

                            commentsText = recentComments.map(c => `${c.username}: ${c.content}`).join('\n');
                        }

                        richContext = `\n\n=== 帖子详情 ===\n发帖人：${targetPost.username}\n发布时间：${postTime}\n\n【完整正文】\n${targetPost.content}\n\n【最新 ${commentCount} 条评论】\n${commentsText}`;
                    } else {
                        richContext = modal.dataset.postRichContext || "";
                    }

                    const buildShareMessage = () => {
                        const messageContent = `[喵坛分享]标题：${postTitle}\n内容：${visibleSnippet}<span style="display:none;">${richContext}</span>`;
                        return {
                            id: `msg_${Date.now()}_${Math.random()}`,
                            role: 'user',
                            content: messageContent,
                            parts: [{ type: 'text', text: messageContent }],
                            timestamp: Date.now()
                        };
                    };

                    selectedCharIds.forEach(charId => {
                        const character = db.characters.find(c => c.id === charId);
                        if (character) {
                            const message = buildShareMessage();
                            character.history.push(message);
                            saveSingleChat(charId, 'private');
                            saveMessageToDB(message, charId, 'private');
                        }
                    });

                    selectedGroupIds.forEach(groupId => {
                        const group = db.groups.find(g => g.id === groupId);
                        if (group) {
                            const message = buildShareMessage();
                            message.senderId = 'user_me'; // 群聊消息需要标记发送者
                            if (!group.history) group.history = [];
                            group.history.push(message);
                            saveSingleChat(groupId, 'group');
                            saveMessageToDB(message, groupId, 'group');
                        }
                    });


                    try { if (typeof renderChatList === 'function') renderChatList(); } catch (e) { }

                    modal.classList.remove('visible');
                    const totalCount = selectedCharIds.length + selectedGroupIds.length;
                    showToast(`成功分享给 ${totalCount} 个聊天！`);
                });
            }

            // 完整替换 openSharePostModal 函数
            function openSharePostModal(postId) {
                const post = db.forumPosts.find(p => p.id === postId);
                if (!post) {
                    showToast('找不到该帖子信息。');
                    return;
                }

                const modal = document.getElementById('share-post-modal');
                const charList = document.getElementById('share-char-list');
                const groupList = document.getElementById('share-group-list');
                const detailsElement = modal.querySelector('details');

                // --- 1. 清理标题中的 [New!] 标记 ---
                let cleanTitle = post.title || "无标题";
                if (cleanTitle.startsWith('[New!] ')) {
                    cleanTitle = cleanTitle.substring(7);
                } else if (cleanTitle.startsWith('【新】')) {
                    cleanTitle = cleanTitle.substring(3);
                }

                // --- 2. 将数据存入 dataset ---
                // 存入清理后的标题
                modal.dataset.postTitle = cleanTitle;

                // 存入原始正文（用于生成卡片上显示的50字摘要）
                modal.dataset.postRawContent = post.content || "";

                // --- 3. 构建完整上下文（隐藏在卡片里，给AI看） ---
                const postTime = new Date(post.timestamp || Date.now()).toLocaleString();
                let commentsText = "";
                if (post.comments && post.comments.length > 0) {
                    // 取最新30条评论，倒序（最新的在前）
                    const recentComments = post.comments.slice(-30).reverse();
                    commentsText = recentComments.map(c => `${c.username}: ${c.content}`).join('\n');
                } else {
                    commentsText = "暂无评论";
                }

                // 组合成AI能读懂的格式
                const richContext = `\n\n=== 帖子详情 (系统后台数据) ===\n发帖人：${post.username}\n发布时间：${postTime}\n\n【完整正文】\n${post.content}\n\n【最新评论】\n${commentsText}`;

                modal.dataset.postRichContext = richContext;

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
