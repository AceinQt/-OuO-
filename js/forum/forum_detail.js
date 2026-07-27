// forum_detail.js - 帖子详情页：渲染、评论回复/删除、删帖、复制、匿名回复

            // --- 修改部分 1：详情页渲染 (统一头像颜色) ---
            function renderPostDetail(post) {
                db.currentViewingPostId = post.id;

                // 设置返回按钮
                const backBtn = document.querySelector('#forum-post-detail-screen .back-btn');
                if (backBtn) {
                    backBtn.dataset.target = currentSourceScreen || 'forum-screen';
                }

                const titleEl = document.getElementById('d-post-title');
                const contentEl = document.getElementById('d-post-content');
                const avatarEl = document.getElementById('d-author-avatar');
                const nameEl = document.getElementById('d-author-name');
                const timeEl = document.getElementById('d-post-time');

                const watchingBtn = document.getElementById('detail-watching-btn');
                const watchingCountEl = document.getElementById('d-like-count');

                const commentListEl = document.getElementById('detail-comment-list');
                const commentHeaderEl = document.querySelector('.comments-header');

                // 星标按钮
                const starBtn = document.getElementById('detail-star-btn');
                if (starBtn) {
                    const isFav = (db.favoritePostIds || []).includes(post.id);
                    if (isFav) starBtn.classList.add('active');
                    else starBtn.classList.remove('active');

                    const newStarBtn = starBtn.cloneNode(true);
                    starBtn.parentNode.replaceChild(newStarBtn, starBtn);

                    newStarBtn.addEventListener('click', async () => {
                        if (!db.favoritePostIds) db.favoritePostIds = [];
                        const index = db.favoritePostIds.indexOf(post.id);
                        if (index === -1) {
                            db.favoritePostIds.push(post.id);
                            newStarBtn.classList.add('active');
                            showToast('已收藏');
                        } else {
                            db.favoritePostIds.splice(index, 1);
                            newStarBtn.classList.remove('active');
                            showToast('已取消收藏');
                        }
                        await saveForumMeta();
                        if (typeof renderFavoritesList === 'function') renderFavoritesList();
                    });
                }

                const myIdentity = db.forumUserIdentity || { nickname: '我', avatar: '' };

                // 标题
                let displayTitle = post.title;
                if (displayTitle.startsWith('[New!] ')) displayTitle = displayTitle.substring(7);
                else if (displayTitle.startsWith('【新】')) displayTitle = displayTitle.substring(3);
                titleEl.textContent = displayTitle;

                // 正文
                if (post.content) {
                    contentEl.className = 'post-detail-content-body markdown-content';
                    let raw = post.content || '';
                    raw = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
                    const lines = raw.split('\n');
                    const htmlParts = lines.map(line => {
                        const text = line.trim();
                        if (!text) return '';
                        let html = marked.parse(text);
                        // --- 【核心修复 1】: 强制处理未识别的斜体 ---
                        // 解决 *文字* 紧挨着汉字时不显示斜体的问题
                        // 查找成对的星号，强制替换为 <em> 标签
                        html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

                        // --- 【核心修复 2】: 对话引号高亮 ---
                        // 匹配 “任意内容”，添加高亮样式
                        html = html.replace(/(“[^”]*”)/g, '<span class="inline-quote">$1</span>');
                        return html;
                    });
                    contentEl.innerHTML = htmlParts.join('');
                } else {
                    contentEl.innerHTML = '';
                }

                nameEl.textContent = post.username;
                timeEl.textContent = new Date(post.timestamp || Date.now()).toLocaleString();

                // 在看按钮
                if (watchingCountEl) watchingCountEl.textContent = '在看';

                if (watchingBtn) {
                    if (!db.watchingPostIds) db.watchingPostIds = [];
                    const isWatching = db.watchingPostIds.includes(post.id);

                    if (isWatching) {
                        watchingBtn.classList.add('watching');
                    } else {
                        watchingBtn.classList.remove('watching');
                    }

                    const newWatchingBtn = watchingBtn.cloneNode(true);
                    watchingBtn.parentNode.replaceChild(newWatchingBtn, watchingBtn);

                    const activeBtn = document.getElementById('detail-watching-btn');

                    activeBtn.addEventListener('click', async () => {
                        if (!db.watchingPostIds) db.watchingPostIds = [];
                        const idx = db.watchingPostIds.indexOf(post.id);

                        if (idx === -1) {
                            db.watchingPostIds.push(post.id);
                            activeBtn.classList.add('watching');
                            showToast('已加入“角色在看”列表');
                        } else {
                            db.watchingPostIds.splice(idx, 1);
                            activeBtn.classList.remove('watching');
                            showToast('已移出“角色在看”列表');
                        }
                        await saveForumMeta();
                    });
                }

                // 头像
                avatarEl.innerHTML = '';
                avatarEl.style.backgroundColor = '';
                let displayAvatar = post.avatar;
                if (post.isUser || (post.username === myIdentity.nickname && myIdentity.nickname !== '一只喵叽')) {
                    displayAvatar = myIdentity.avatar || 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg';
                }

                if (displayAvatar) {
                    const img = document.createElement('img');
                    img.src = displayAvatar;
                    img.style.width = '100%';
                    img.style.height = '100%';
                    img.style.borderRadius = '50%';
                    img.style.objectFit = 'cover';
                    avatarEl.appendChild(img);
                    avatarEl.style.backgroundColor = 'transparent';
                } else {
                    const firstChar = post.username ? post.username.charAt(0).toUpperCase() : '?';
                    avatarEl.textContent = firstChar;
                    avatarEl.style.backgroundColor = 'var(--primary-color)';
                    avatarEl.style.color = '#FFFFFF';
                }

                // 评论列表
                const commentLen = post.comments ? post.comments.length : 0;
                if (commentHeaderEl) commentHeaderEl.textContent = `全部评论 (${commentLen})`;

                let commentsHtml = '';
                const displayComments = post.comments || [];

                if (displayComments.length > 0) {
                    displayComments.forEach((comment, index) => {
                        const floorNumber = index + 1;
                        const displayTime = comment.timestamp || new Date().toLocaleString();
                        const newTag = comment.isNew ? '<span style="color: #0099FF; font-weight: bold; margin-right: 5px; font-size: 10px;font-style: italic;">New!</span>' : '';

                        let commentDisplayAvatar = comment.avatar;
                        if (comment.isUser || (comment.username === myIdentity.nickname && myIdentity.nickname !== '一只喵叽')) {
                            commentDisplayAvatar = myIdentity.avatar || 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg';
                        }

                        let avatarHtml = '';
                        if (commentDisplayAvatar) {
                            avatarHtml = `<div class="comment-author-avatar" style="background: transparent; overflow: hidden;">
                                <img src="${commentDisplayAvatar}" style="width: 100%; height: 100%; object-fit: cover;">
                              </div>`;
                        } else {
                            const cFirstChar = comment.username ? comment.username.charAt(0).toUpperCase() : '?';
                            avatarHtml = `<div class="comment-author-avatar" style="background-color: var(--accent-color); color: white;">${cFirstChar}</div>`;
                        }

                        commentsHtml += `
              <li class="comment-item">
                  ${avatarHtml}
                  <div class="comment-body">
                      <div class="comment-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 4px;">
                          <div>
                              <span class="comment-author-name">${comment.username}</span>
                          </div>
                          <div class="comment-floor" style="font-size:12px; color:#999;">${newTag}#${floorNumber}</div>
                      </div>
                      <div class="comment-content">${comment.content.replace(/\n/g, '<br>')}</div>
                      <div class="comment-timestamp" style="font-size:11px; color:#aaa; margin-top:4px;">
                        ${displayTime}
                        <span class="comment-delete-btn" data-original-index="${index}">删除</span>
                        <span class="comment-reply-btn" data-username="${comment.username}">回复</span>
                      </div>
                  </div>
              </li>
            `;
                    });
                } else {
                    commentsHtml = '<li style="padding:20px; text-align:center; color:#999;">暂无评论，快来抢沙发吧~</li>';
                }
                commentListEl.innerHTML = commentsHtml;

                // 【新增】应用自定义CSS
                applyCustomPostCss();
            }

            // 代理点击事件处理“回复”
            document.getElementById('detail-comment-list').addEventListener('click', (e) => {
                if (e.target.classList.contains('comment-reply-btn')) {
                    const username = e.target.dataset.username;
                    const input = document.getElementById('reply-content-input');
                    input.value = `回复 @${username}：`;
                    input.focus();
                }
            });

            function setupDetailScreenEvents() {
                // 1. 处理匿名按钮的视觉切换
                const anonTrigger = document.getElementById('reply-anon-trigger');
                const anonCheckbox = document.getElementById('reply-is-anon');

                if (anonTrigger && anonCheckbox) {
                    // 重置状态
                    anonCheckbox.checked = false;
                    anonTrigger.classList.remove('selected');

                    // 使用克隆防止重复绑定
                    const newTrigger = anonTrigger.cloneNode(true);
                    anonTrigger.parentNode.replaceChild(newTrigger, anonTrigger);

                    // 重新获取新节点
                    const currentTrigger = document.getElementById('reply-anon-trigger');
                    // 注意：内部的 input 也被克隆了，需要重新获取
                    const currentCheckbox = currentTrigger.querySelector('input');

                    currentTrigger.addEventListener('click', () => {
                        currentCheckbox.checked = !currentCheckbox.checked;

                        if (currentCheckbox.checked) {
                            currentTrigger.classList.add('selected');
                        } else {
                            currentTrigger.classList.remove('selected');
                        }
                    });
                }

                // 2. 回复发送逻辑
                const submitBtn = document.getElementById('submit-reply-btn');
                const newSubmitBtn = submitBtn.cloneNode(true);
                submitBtn.parentNode.replaceChild(newSubmitBtn, submitBtn);

                newSubmitBtn.addEventListener('click', async () => {
                    const contentInput = document.getElementById('reply-content-input');
                    const content = contentInput.value.trim();
                    const postId = db.currentViewingPostId;

                    if (!postId) return;
                    const post = db.forumPosts.find(p => p.id === postId);
                    if (!post) return;

                    if (!content) {
                        showToast('评论内容不能为空');
                        return;
                    }

                    // 获取匿名状态 (直接查DOM)
                    const isAnon = document.getElementById('reply-is-anon').checked;
                    const myIdentity = db.forumUserIdentity || { nickname: '我', avatar: '' };
                    // 【修改】使用 getAnonymousName()
                    const author = isAnon ? getAnonymousName() : (myIdentity.nickname || '我');

                    if (post.comments) {
                        post.comments.forEach(c => delete c.isNew);
                    } else {
                        post.comments = [];
                    }

                    let commentAvatar = null;
                    let isUserComment = false;

                    if (!isAnon) {
                        commentAvatar = myIdentity.avatar || 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg';
                        isUserComment = true;
                    }

                    const newComment = {
                        username: author,
                        content: content,
                        timestamp: new Date().toLocaleString(),
                        isNew: true,
                        avatar: commentAvatar,
                        isUser: isUserComment
                    };

                    post.comments.push(newComment);
// 只保存当前这条帖子（评论是包含在帖子对象里的）
await saveSinglePost(post.id); 
contentInput.value = '';

                    renderPostDetail(post);

                    const area = document.getElementById('detail-content-area');
                    if (area) area.scrollTop = area.scrollHeight;

                    showToast('回复成功');
                });

                // 3. 评论删除事件
                const listEl = document.getElementById('detail-comment-list');
                listEl.onclick = async (e) => {
                    if (e.target.classList.contains('comment-delete-btn')) {
                        const index = parseInt(e.target.dataset.originalIndex);
                        const postId = db.currentViewingPostId;
                        const post = db.forumPosts.find(p => p.id === postId);

                        if (post && await AppUI.confirm('确定要删除这条评论吗？', "系统提示", "确认", "取消")) {
                            post.comments.splice(index, 1);
                            await saveSinglePost(post.id);
                            renderPostDetail(post);
                            showToast('评论已删除');
                        }
                    }
                };


const deletePostBtn = document.getElementById('d-delete-btn');
if (deletePostBtn) {
    const newDelBtn = deletePostBtn.cloneNode(true);
    deletePostBtn.parentNode.replaceChild(newDelBtn, deletePostBtn);
    
    newDelBtn.addEventListener('click', async () => {
        const postId = db.currentViewingPostId;
        
        if (!postId) {
            showToast('无法获取帖子ID');
            return;
        }
        
        if (await AppUI.confirm('确定要删除这条帖子吗？', "系统提示", "确认", "取消")) {
            try {
                // ★★★ 1. 先从数据库删除（最重要！）★★★
                await dexieDB.forumPosts.delete(postId);
                
                // 2. 从内存数组中删除
                db.forumPosts = db.forumPosts.filter(p => p.id !== postId);
                
                // 3. 清理收藏和关注
                if (db.favoritePostIds) {
                    db.favoritePostIds = db.favoritePostIds.filter(id => id !== postId);
                }
                if (db.watchingPostIds) {
                    db.watchingPostIds = db.watchingPostIds.filter(id => id !== postId);
                }
                
                // 4. 保存收藏和关注的变化
                await saveForumMeta();

                // 5. 清理主页DOM
                const mainContainer = document.getElementById('forum-posts-container');
                if (mainContainer) {
                    const cardToRemove = mainContainer.querySelector(`.forum-post-card[data-id="${postId}"]`);
                    if (cardToRemove) {
                        cardToRemove.remove();
                    }
                }

                // 6. 刷新热帖
                if (typeof renderHotPosts === 'function') {
                    renderHotPosts();
                }

                showToast('帖子已删除');
                switchScreen('forum-screen');
                
            } catch (e) {
                console.error('删除帖子失败:', e);
                showToast('删除失败: ' + e.message);
            }
        }
    });
}

                // 5. AI 生成
                const aiBtn = document.getElementById('detail-ai-btn');
                if (aiBtn) {
                    const newAiBtn = aiBtn.cloneNode(true);
                    aiBtn.parentNode.replaceChild(newAiBtn, aiBtn);
                    newAiBtn.addEventListener('click', () => {
                        const postId = db.currentViewingPostId;
                        const post = db.forumPosts.find(p => p.id === postId);
                        if (post) handleGenerateComments(post);
                    });
                }

                // 6. 分享
                const shareBtn = document.getElementById('detail-share-btn');
                if (shareBtn) {
                    const newShareBtn = shareBtn.cloneNode(true);
                    shareBtn.parentNode.replaceChild(newShareBtn, shareBtn);
                    newShareBtn.addEventListener('click', () => {
                        const postId = db.currentViewingPostId;
                        if (postId) openSharePostModal(postId);
                    });
                }

                // 7. 复制标题和正文
                const copyBtn = document.getElementById('d-copy-btn');
                if (copyBtn) {
                    const newCopyBtn = copyBtn.cloneNode(true);
                    copyBtn.parentNode.replaceChild(newCopyBtn, copyBtn);

                    newCopyBtn.addEventListener('click', () => {
                        const titleEl = document.getElementById('d-post-title');
                        const contentEl = document.getElementById('d-post-content');

                        if (!titleEl || !contentEl) return;

                        const titleText = titleEl.innerText || '';
                        const contentText = contentEl.innerText || '';
                        const textToCopy = `${titleText}\n\n${contentText}`;

                        const handleSuccess = () => {
                            showToast('已复制到剪贴板');
                            newCopyBtn.style.color = 'var(--primary-color)';
                            setTimeout(() => { newCopyBtn.style.color = ''; }, 200);
                        };

                        const handleError = (err) => {
                            console.error('复制出错:', err);
                            showToast('复制失败，请手动复制');
                        };

                        const fallbackCopy = (text) => {
                            try {
                                const textArea = document.createElement("textarea");
                                textArea.value = text;
                                textArea.style.top = "0";
                                textArea.style.left = "0";
                                textArea.style.position = "fixed";
                                textArea.style.opacity = "0";
                                document.body.appendChild(textArea);
                                textArea.focus();
                                textArea.select();
                                const successful = document.execCommand('copy');
                                document.body.removeChild(textArea);
                                if (successful) handleSuccess();
                                else handleError('execCommand failed');
                            } catch (err) {
                                handleError(err);
                            }
                        };

                        if (navigator.clipboard && window.isSecureContext) {
                            navigator.clipboard.writeText(textToCopy)
                                .then(handleSuccess)
                                .catch(() => {
                                    fallbackCopy(textToCopy);
                                });
                        } else {
                            fallbackCopy(textToCopy);
                        }
                    });
                }
            }

            // 辅助函数：更新回复框的 User 选项

            function updateReplyAuthorSelect() {
                const select = document.getElementById('reply-author-select');
                if (!select) return;

                // 清空除了"匿名"以外的选项
                select.innerHTML = '';

                // 1. 匿名选项
                const anon = document.createElement('option');
                anon.value = '喵叽0311';
                anon.textContent = '喵叽0311';
                select.appendChild(anon);

                // 2. “我”的选项
                const myIdentity = db.forumUserIdentity || { nickname: '我' };
                const myName = myIdentity.nickname || '我';

                const opt = document.createElement('option');
                opt.value = myName;
                opt.textContent = myName; // 显示昵称
                opt.selected = true;      // 默认选中
                select.appendChild(opt);
            }

