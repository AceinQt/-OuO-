            const peekScreenApps = {
                'messages': { name: '消息', url: 'https://i.postimg.cc/Kvs4tDh5/export202509181826424260.png' },
                'memos': { name: '备忘录', url: 'https://i.postimg.cc/JzD0xH1C/export202509181829064550.png' },
                'cart': { name: '购物车', url: 'https://i.postimg.cc/pLwT6VTh/export202509181830143960.png' },
                'transfer': { name: '中转站', url: 'https://i.postimg.cc/63wQBHCB/export202509181831140230.png' },
                'browser': { name: '浏览器', url: 'https://i.postimg.cc/SKcsF02Z/export202509181830445980.png' },
                'drafts': { name: '草稿箱', url: 'https://i.postimg.cc/ZKqC9D2R/export202509181827225860.png' },
                'album': { name: '相册', url: 'https://i.postimg.cc/qBcdpqNc/export202509221549335970.png' },
                'steps': { name: '步数', url: 'https://i.postimg.cc/5NndFrq6/export202509181824532800.png' },
                'unlock': { name: 'unlock！', url: 'https://i.postimg.cc/28zNyYWs/export202509221542593320.png' }
            };

            
                        
                                                function setupPeekFeature() {
                const peekBtn = document.getElementById('peek-btn');
                const peekConfirmModal = document.getElementById('peek-confirm-modal');
                const peekConfirmYes = document.getElementById('peek-confirm-yes');
                const peekConfirmNo = document.getElementById('peek-confirm-no');
                const peekSettingsBtn = document.getElementById('peek-settings-btn');
                const peekWallpaperModal = document.getElementById('peek-wallpaper-modal');
                const peekWallpaperForm = document.getElementById('peek-wallpaper-form');
                const peekWallpaperUpload = document.getElementById('peek-wallpaper-upload');
                const peekWallpaperPreview = document.getElementById('peek-wallpaper-preview');

                peekBtn?.addEventListener('click', () => {
                    peekConfirmModal.classList.add('visible');
                });

                peekConfirmNo?.addEventListener('click', () => {
                    peekConfirmModal.classList.remove('visible');
                });

                peekConfirmYes?.addEventListener('click', () => {
                    peekConfirmModal.classList.remove('visible');
           // 而是从 db 加载当前角色的数据
    if (!db.peekData) db.peekData = {};
    
    // 如果这个角色还没有数据，初始化为空对象
    if (!db.peekData[currentChatId]) {
        db.peekData[currentChatId] = {};
    }             
                    
                    window.peekContentCache = db.peekData[currentChatId];
                    renderPeekScreen(); // Render before switching
                    switchScreen('peek-screen');
                });

                // New simplified settings functionality
                peekSettingsBtn?.addEventListener('click', () => {
                    renderPeekSettings();
                    peekWallpaperModal.classList.add('visible');
                });

                peekWallpaperUpload?.addEventListener('change', async (e) => {
                    const file = e.target.files[0];
                    if (file) {
                        try {
                            const compressedUrl = await compressImage(file, { quality: 0.85, maxWidth: 1080, maxHeight: 1920 });
                            document.getElementById('peek-wallpaper-url-input').value = compressedUrl;
                            showToast('图片已压缩并填入URL输入框');
                        } catch (error) {
                            showToast('壁纸压缩失败，请重试');
                        }
                    }
                });

                // Combined save button for all peek settings
                document.getElementById('save-peek-settings-btn')?.addEventListener('click', async () => {
                    const character = db.characters.find(c => c.id === currentChatId);
                    if (!character) {
                        showToast('错误：未找到当前角色');
                        return;
                    }

                    if (!character.peekScreenSettings) {
                        character.peekScreenSettings = { wallpaper: '', customIcons: {}, unlockAvatar: '' , contextLimit: 50};
                    }

                    // Save wallpaper
                    character.peekScreenSettings.wallpaper = document.getElementById('peek-wallpaper-url-input').value.trim();

                    // Save custom app icons
                    const iconInputs = document.querySelectorAll('#peek-app-icons-settings input[type="url"]');
                    iconInputs.forEach(input => {
                        const appId = input.dataset.appId;
                        const newUrl = input.value.trim();
                        if (newUrl) {
                            if (!character.peekScreenSettings.customIcons) {
                                character.peekScreenSettings.customIcons = {};
                            }
                            character.peekScreenSettings.customIcons[appId] = newUrl;
                        } else {
                            if (character.peekScreenSettings.customIcons) {
                                delete character.peekScreenSettings.customIcons[appId];
                            }
                        }
                    });

                    // Save unlock avatar
                    character.peekScreenSettings.unlockAvatar = document.getElementById('peek-unlock-avatar-url').value.trim();
                    
                    const contextInput = document.getElementById('peek-context-limit');
    let limit = parseInt(contextInput.value);
    
    // 验证数据：如果是NaN则设为50，限制最大500，最小0
    if (isNaN(limit)) limit = 50;
    if (limit > 500) limit = 500;
    if (limit < 0) limit = 0;
    
    character.peekScreenSettings.contextLimit = limit;

                    await saveData();
                    renderPeekScreen(); // Re-render to apply all changes
                    showToast('已保存！');
                    peekWallpaperModal.classList.remove('visible');
                });

                // Add collapsible functionality
                peekWallpaperModal.addEventListener('click', (e) => {
                    const header = e.target.closest('.collapsible-header');
                    if (header) {
                        header.parentElement.classList.toggle('open');
                    }
                });

                const peekMessagesScreen = document.getElementById('peek-messages-screen');
                peekMessagesScreen.addEventListener('click', (e) => {
                    const chatItem = e.target.closest('.chat-item');
                    if (chatItem) {
                        const partnerName = chatItem.dataset.name;
                        const cachedData = peekContentCache.messages;
                        if (cachedData && cachedData.conversations) {
                            const conversation = cachedData.conversations.find(c => c.partnerName === partnerName);
                            if (conversation) {
                                renderPeekConversation(conversation.history, conversation.partnerName);
                                switchScreen('peek-conversation-screen');
                            } else {
                                showToast('找不到对话记录');
                            }
                        }
                    } else if (e.target.closest('.action-btn')) {
                        generateAndRenderPeekContent('messages', { forceRefresh: true });
                    }
                });

                const peekConversationScreen = document.getElementById('peek-conversation-screen');
                peekConversationScreen.addEventListener('click', (e) => {
                    if (e.target.closest('.action-btn')) {
                        generateAndRenderPeekContent('messages', { forceRefresh: true });
                    }
                });

                // 为相册刷新按钮添加事件监听
                const refreshAlbumBtn = document.getElementById('refresh-album-btn');
                if (refreshAlbumBtn) {
                    refreshAlbumBtn.addEventListener('click', () => generateAndRenderPeekContent('album', { forceRefresh: true }));
                }
                
                const refreshStepsBtn = document.getElementById('refresh-steps-btn');
    if (refreshStepsBtn) {
        refreshStepsBtn.addEventListener('click', () => generateAndRenderPeekContent('steps', { forceRefresh: true }));
    }

                // 为照片详情模态框添加关闭事件
                const photoModal = document.getElementById('peek-photo-modal');
                if (photoModal) {
                    photoModal.addEventListener('click', (e) => {
                        if (e.target === photoModal) {
                            photoModal.classList.remove('visible');
                        }
                    });
                }
            }

            function renderPeekAlbum(photos) {
                const screen = document.getElementById('peek-album-screen');
                const grid = screen.querySelector('.album-grid');
                grid.innerHTML = ''; // Clear previous content

                if (!photos || photos.length === 0) {
                    grid.innerHTML = '<p class="placeholder-text">正在生成相册内容...</p>';
                    return;
                }

                photos.forEach(photo => {
                    const photoEl = document.createElement('div');
                    photoEl.className = 'album-photo';
                    photoEl.dataset.imageDescription = photo.imageDescription;
                    photoEl.dataset.description = photo.description;

                    const img = document.createElement('img');
                    img.src = 'https://i.postimg.cc/1tH6ds9g/1752301200490.jpg'; // 使用一个静态占位图
                    img.alt = "相册照片";
                    photoEl.appendChild(img);

                    if (photo.type === 'video') {
                        const videoIndicator = document.createElement('div');
                        videoIndicator.className = 'video-indicator';
                        videoIndicator.innerHTML = `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"></path></svg>`;
                        photoEl.appendChild(videoIndicator);
                    }

                    photoEl.addEventListener('click', () => {
                        const modal = document.getElementById('peek-photo-modal');
                        const imgContainer = document.getElementById('peek-photo-image-container');
                        const descriptionEl = document.getElementById('peek-photo-description');

                        // 将AI生成的图片文字描述展示出来，而不是真的图片
                        imgContainer.innerHTML = `<div style="padding: 20px; text-align: left; color: #555; font-size: 16px; line-height: 1.6; height: 100%; overflow-y: auto;">${photo.imageDescription}</div>`;
                        // 显示角色对照片的批注
                        descriptionEl.textContent = `批注：${photo.description}`;

                        modal.classList.add('visible');
                    });

                    grid.appendChild(photoEl);
                });
            }

            function renderPeekUnlock(data) {
                const screen = document.getElementById('peek-unlock-screen');
                if (!screen) return;

                // Handle loading/empty state
                if (!data) {
                    screen.innerHTML = `
                    <header class="app-header">
                        <button class="back-btn" data-target="peek-screen">‹</button>
                        <div class="title-container"><h1 class="title">...</h1></div>
                        <button class="action-btn">···</button>
                    </header>
                    <main class="content"><p class="placeholder-text">正在生成小号内容...</p></main>
                `;
                    return;
                }

                const { nickname, handle, bio, posts } = data;
                const character = db.characters.find(c => c.id === currentChatId);
                const peekSettings = character?.peekScreenSettings || { unlockAvatar: '' };
                const fixedAvatar = peekSettings.unlockAvatar || 'https://i.postimg.cc/SNwL1XwR/chan-11.png';

                // Random numbers for stats
                const randomFollowers = (Math.random() * 5 + 1).toFixed(1) + 'k';
                const randomFollowing = Math.floor(Math.random() * 500) + 50;

                let postsHtml = '';
                if (posts && posts.length > 0) {
                    posts.forEach(post => {
                        const randomComments = Math.floor(Math.random() * 100);
                        const randomLikes = Math.floor(Math.random() * 500);
                        postsHtml += `
                        <div class="unlock-post-card">
                            <div class="unlock-post-card-header">
                                <img src="${fixedAvatar}" alt="Profile Avatar">
                                <div class="unlock-post-card-author-info">
                                    <span class="username">${nickname}</span>
                                    <span class="timestamp">${post.timestamp}</span>
                                </div>
                            </div>
                            <div class="unlock-post-card-content">
                                ${post.content.replace(/\n/g, '<br>')}
                            </div>
                            <div class="unlock-post-card-actions">
                                <div class="action"><svg viewBox="0 0 24 24"><path d="M18,16.08C17.24,16.08 16.56,16.38 16.04,16.85L8.91,12.7C8.96,12.47 9,12.24 9,12C9,11.76 8.96,11.53 8.91,11.3L16.04,7.15C16.56,7.62 17.24,7.92 18,7.92C19.66,7.92 21,6.58 21,5C21,3.42 19.66,2 18,2C16.34,2 15,3.42 15,5C15,5.24 15.04,5.47 15.09,5.7L7.96,9.85C7.44,9.38 6.76,9.08 6,9.08C4.34,9.08 3,10.42 3,12C3,13.58 4.34,14.92 6,14.92C6.76,14.92 7.44,14.62 7.96,14.15L15.09,18.3C15.04,18.53 15,18.76 15,19C15,20.58 16.34,22 18,22C19.66,22 21,20.58 21,19C21,17.42 19.66,16.08 18,16.08Z"></path></svg> <span>分享</span></div>
                                <div class="action"><svg viewBox="0 0 24 24"><path d="M20,2H4C2.9,0,2,0.9,2,2v18l4-4h14c1.1,0,2-0.9,2-2V4C22,2.9,21.1,2,20,2z M18,14H6v-2h12V14z M18,11H6V9h12V11z M18,8H6V6h12V8z"></path></svg> <span>${randomComments}</span></div>
                                <div class="action"><svg viewBox="0 0 24 24"><path d="M12,21.35L10.55,20.03C5.4,15.36,2,12.27,2,8.5C2,5.42,4.42,3,7.5,3c1.74,0,3.41,0.81,4.5,2.09C13.09,3.81,14.76,3,16.5,3C19.58,3,22,5.42,22,8.5c0,3.78-3.4,6.86-8.55,11.54L12,21.35z"></path></svg> <span>${randomLikes}</span></div>
                            </div>
                        </div>
                    `;
                    });
                }

                screen.innerHTML = `
                <header class="app-header">
                    <button class="back-btn" data-target="peek-screen">‹</button>
                    <div class="title-container">
                        <h1 class="title">${nickname}</h1>
                    </div>
                    <button class="action-btn" id="refresh-unlock-btn"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"></path></svg></button>
                </header>
                <main class="content">
                    <div class="unlock-profile-header">
                        <img src="${fixedAvatar}" alt="Profile Avatar" class="unlock-profile-avatar">
                        <div class="unlock-profile-info">
                            <h2 class="unlock-profile-username">${nickname}</h2>
                            <p class="unlock-profile-handle">${handle}</p>
                        </div>
                    </div>
                    <div class="unlock-profile-bio">
                        <p>${bio.replace(/\n/g, '<br>')}</p>
                    </div>
                    <div class="unlock-profile-stats">
                        <div class="unlock-profile-stat">
                            <span class="count">${posts.length}</span>
                            <span class="label">帖子</span>
                        </div>
                        <div class="unlock-profile-stat">
                            <span class="count">${randomFollowers}</span>
                            <span class="label">粉丝</span>
                        </div>
                        <div class="unlock-profile-stat">
                            <span class="count">${randomFollowing}</span>
                            <span class="label">关注</span>
                        </div>
                    </div>
                    <div class="unlock-post-feed">
                        ${postsHtml}
                    </div>
                </main>
            `;

                // Add event listener for the new refresh button
                screen.querySelector('#refresh-unlock-btn').addEventListener('click', () => {
                    generateAndRenderPeekContent('unlock', { forceRefresh: true });
                });
            }

            function renderPeekConversation(history, partnerName) {
                const titleEl = document.getElementById('peek-conversation-title');
                const messageAreaEl = document.getElementById('peek-message-area');

                titleEl.textContent = partnerName;
                messageAreaEl.innerHTML = '';

                if (!history || history.length === 0) {
                    messageAreaEl.innerHTML = '<p class="placeholder-text">正在生成对话...</p>';
                    return;
                }

                history.forEach(msg => {
                    const isSentByChar = msg.sender === 'char'; // 'char' is the character whose phone we are peeking
                    const wrapper = document.createElement('div');
                    wrapper.className = `message-wrapper ${isSentByChar ? 'sent' : 'received'}`;

                    const bubbleRow = document.createElement('div');
                    bubbleRow.className = 'message-bubble-row';

                    const bubble = document.createElement('div');
                    bubble.className = `message-bubble ${isSentByChar ? 'sent' : 'received'}`;
                    bubble.textContent = msg.content;

                    if (isSentByChar) {
                        bubbleRow.appendChild(bubble);
                    } else {
                        const avatar = document.createElement('img');
                        avatar.className = 'message-avatar';
                        avatar.src = 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg';
                        bubbleRow.appendChild(avatar);
                        bubbleRow.appendChild(bubble);
                    }

                    wrapper.appendChild(bubbleRow);
                    messageAreaEl.appendChild(wrapper);
                });
                messageAreaEl.scrollTop = messageAreaEl.scrollHeight;
            }

            function renderPeekScreen() {
                const peekScreen = document.getElementById('peek-screen');
                const contentArea = peekScreen.querySelector('main.content');

                // Set content
                contentArea.innerHTML = `
                <div class="time-widget">
                    <div class="time" id="peek-time-display"></div>
                    <div class="date" id="peek-date-display"></div>
                </div>
                <div class="app-grid"></div>
            `;

                const character = db.characters.find(c => c.id === currentChatId);
                const peekSettings = character?.peekScreenSettings || { wallpaper: '', customIcons: {} };

                // Apply wallpaper to the parent screen element
                const wallpaper = peekSettings.wallpaper;
                if (wallpaper) {
                    peekScreen.style.backgroundImage = `url(${wallpaper})`;
                } else {
                    peekScreen.style.backgroundImage = `url(${db.wallpaper})`; // Fallback to global wallpaper
                }
                peekScreen.style.backgroundSize = 'cover';
                peekScreen.style.backgroundPosition = 'center';

                // Render the 6 specific, non-functional icons
                const appGrid = contentArea.querySelector('.app-grid');
                Object.keys(peekScreenApps).forEach(id => {
                    const iconData = peekScreenApps[id];
                    const iconEl = document.createElement('a');
                    iconEl.href = '#';
                    iconEl.className = 'app-icon';
                    iconEl.dataset.peekAppId = id;
                    const customIconUrl = peekSettings.customIcons?.[id];
                    const iconUrl = customIconUrl || iconData.url;
                    iconEl.innerHTML = `
                    <img src="${iconUrl}" alt="${iconData.name}" class="icon-img">
                    <span class="app-name">${iconData.name}</span>
                `;
                    iconEl.addEventListener('click', (e) => {
                        e.preventDefault();
                        generateAndRenderPeekContent(id);
                    });
                    appGrid.appendChild(iconEl);
                });

                // Call updateClock to immediately populate the time
                updateClock();
            }

            function renderPeekChatList(conversations = []) {
                const container = document.getElementById('peek-chat-list-container');
                container.innerHTML = '';

                if (!conversations || conversations.length === 0) {
                    // This case is handled by the loading/error message in generateAndRenderPeekContent
                    return;
                }

                // Use a pool of default avatars
                conversations.forEach((convo) => {
                    const history = convo.history || [];
                    const lastMessage = history.length > 0 ? history[history.length - 1] : null;
                    const lastMessageText = lastMessage ? (lastMessage.content || '').replace(/\[.*?的消息：([\s\S]+)\]/, '$1') : '...';

                    const li = document.createElement('li');
                    li.className = 'list-item chat-item';
                    // Use partnerName as the unique identifier for clicking
                    li.dataset.name = convo.partnerName;

                    const avatarUrl = 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg';

                    li.innerHTML = `
                    <img src="${avatarUrl}" alt="${convo.partnerName}" class="chat-avatar">
                    <div class="item-details">
                        <div class="item-details-row"><div class="item-name">${convo.partnerName}</div></div>
                        <div class="item-preview-wrapper">
                            <div class="item-preview">${lastMessageText}</div>
                        </div>
                    </div>`;
                    container.appendChild(li);
                });
            }

            function renderMemosList(memos) {
                const screen = document.getElementById('peek-memos-screen');
                let listHtml = '';
                if (!memos || memos.length === 0) {
                    listHtml = '<p class="placeholder-text">正在生成备忘录...</p>';
                } else {
                    memos.forEach(memo => {
                        const firstLine = memo.content.split('\n')[0];
                        listHtml += `
                        <li class="memo-item" data-id="${memo.id}">
                            <h3 class="memo-item-title">${memo.title}</h3>
                            <p class="memo-item-preview">${firstLine}</p>
                        </li>
                    `;
                    });
                }

                screen.innerHTML = `
                <header class="app-header">
                    <button class="back-btn" data-target="peek-screen">‹</button>
                    <div class="title-container"><h1 class="title">备忘录</h1></div>
                    <button class="action-btn"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"></path></svg></button>
                </header>
                <main class="content"><ul id="peek-memos-list">${listHtml}</ul></main>
            `;

                screen.querySelector('.action-btn').addEventListener('click', () => {
                    generateAndRenderPeekContent('memos', { forceRefresh: true });
                });

                screen.querySelectorAll('.memo-item').forEach(item => {
                    item.addEventListener('click', () => {
                        // FIX: Correctly access the 'memos' array within the cached object.
                        const memo = peekContentCache.memos?.memos?.find(m => m.id === item.dataset.id);
                        if (memo) {
                            renderMemoDetail(memo);
                            switchScreen('peek-memo-detail-screen');
                        }
                    });
                });
            }

            function renderMemoDetail(memo) {
                const screen = document.getElementById('peek-memo-detail-screen');
                if (!memo) return;
                const contentHtml = memo.content.replace(/\n/g, '<br>');
                screen.innerHTML = `
                <header class="app-header">
                    <button class="back-btn" data-target="peek-memos-screen">‹</button>
                    <div class="title-container"><h1 class="title">${memo.title}</h1></div>
                    <button class="action-btn"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"></path></svg></button>
                </header>
                <main class="content" style="padding: 20px; line-height: 1.6;">${contentHtml}</main>
            `;
            }

            function renderPeekCart(items) {
                const screen = document.getElementById('peek-cart-screen');
                let itemsHtml = '';
                let totalPrice = 0;

                if (!items || items.length === 0) {
                    itemsHtml = '<p class="placeholder-text">正在生成购物车内容...</p>';
                } else {
                    items.forEach(item => {
                        itemsHtml += `
                        <li class="cart-item" data-id="${item.id}">
                            <img src="https://i.postimg.cc/wMbSMvR9/export202509181930036600.png" class="cart-item-image" alt="${item.title}">
                            <div class="cart-item-details">
                                <h3 class="cart-item-title">${item.title}</h3>
                                <p class="cart-item-spec">规格：${item.spec}</p>
                                <p class="cart-item-price">¥${item.price}</p>
                            </div>
                        </li>
                    `;
                        totalPrice += parseFloat(item.price);
                    });
                }

                screen.innerHTML = `
               <header class="app-header">
                   <button class="back-btn" data-target="peek-screen">‹</button>
                   <div class="title-container"><h1 class="title">购物车</h1></div>
                   <button class="action-btn"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"></path></svg></button>
               </header>
               <main class="content"><ul class="cart-item-list">${itemsHtml}</ul></main>
               <footer class="cart-footer">
                   <div class="cart-total-price">
                       <span class="label">合计：</span>¥${totalPrice.toFixed(2)}
                   </div>
                   <button class="checkout-btn">结算</button>
               </footer>
           `;

                screen.querySelector('.action-btn').addEventListener('click', () => {
                    generateAndRenderPeekContent('cart', { forceRefresh: true });
                });
                screen.querySelector('.checkout-btn').addEventListener('click', () => {
                    showToast('功能开发中');
                });
            }

            function renderPeekTransferStation(entries) {
                const screen = document.getElementById('peek-transfer-station-screen');
                let messagesHtml = '';

                if (!entries || entries.length === 0) {
                    messagesHtml = '<p class="placeholder-text">正在生成中转站内容...</p>';
                } else {
                    entries.forEach(entry => {
                        // Each entry is a message from the character to themselves.
                        // We'll render it as a 'sent' message bubble.
                        messagesHtml += `
                        <div class="message-wrapper sent">
                            <div class="message-bubble-row">
                                <div class="message-bubble sent" style="background-color: #98E165; color: #000;">
                                    ${entry}
                                </div>
                            </div>
                        </div>
                    `;
                    });
                }

                screen.innerHTML = `
               <header class="app-header">
                   <button class="back-btn" data-target="peek-screen">‹</button>
                   <div class="title-container">
                       <h1 class="title">文件传输助手</h1>
                   </div>
                   <button class="action-btn">
                       <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"></path></svg>
                   </button>
               </header>
               <main class="content">
                   <div class="message-area" style="padding: 10px;">
                        ${messagesHtml}
                   </div>
                   <div class="transfer-station-input-area">
                       <div class="fake-input"></div>
                       <button class="plus-btn"></button>
                   </div>
               </main>
           `;

                screen.querySelector('.action-btn').addEventListener('click', () => {
                    generateAndRenderPeekContent('transfer', { forceRefresh: true });
                });

                const messageArea = screen.querySelector('.message-area');
                if (messageArea) {
                    messageArea.scrollTop = messageArea.scrollHeight;
                }
            }

            function renderPeekBrowser(historyItems) {
                const screen = document.getElementById('peek-browser-screen');
                let itemsHtml = '';
                if (!historyItems || historyItems.length === 0) {
                    itemsHtml = '<p class="placeholder-text">正在生成浏览记录...</p>';
                } else {
                    historyItems.forEach(item => {
                        itemsHtml += `
                        <li class="browser-history-item">
                            <h3 class="history-item-title">${item.title}</h3>
                            <p class="history-item-url">${item.url}</p>
                            <div class="history-item-annotation">${item.annotation}</div>
                        </li>
                    `;
                    });
                }

                screen.innerHTML = `
              <header class="app-header">
                  <button class="back-btn" data-target="peek-screen">‹</button>
                  <div class="title-container"><h1 class="title">浏览器</h1></div>
                  <button class="action-btn"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"></path></svg></button>
              </header>
              <main class="content"><ul class="browser-history-list">${itemsHtml}</ul></main>
          `;
                screen.querySelector('.action-btn').addEventListener('click', () => {
                    generateAndRenderPeekContent('browser', { forceRefresh: true });
                });
            }

            function renderPeekDrafts(draft) {
                const screen = document.getElementById('peek-drafts-screen');
                let draftTo = '...';
                let draftContent = '<p class="placeholder-text">正在生成草稿...</p>';

                if (draft) {
                    draftTo = draft.to;
                    draftContent = draft.content;
                }

                screen.innerHTML = `
               <header class="app-header">
                   <button class="back-btn" data-target="peek-screen">‹</button>
                   <div class="title-container"><h1 class="title">草稿箱</h1></div>
                   <button class="action-btn"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"></path></svg></button>
               </header>
               <main class="content">
                   <div class="draft-paper">
                       <div class="draft-to">To: ${draftTo}</div>
                       <div class="draft-content">${draftContent}</div>
                   </div>
               </main>
           `;
                screen.querySelector('.action-btn').addEventListener('click', () => {
                    generateAndRenderPeekContent('drafts', { forceRefresh: true });
                });
            }
            
                                    function renderPeekSteps(data) {
                const screen = document.getElementById('peek-steps-screen');
                const char = db.characters.find(c => c.id === currentChatId);
                if (!char) return; // 如果找不到角色，则不渲染

                const avatarEl = screen.querySelector('#steps-char-avatar');
                const nameEl = screen.querySelector('#steps-char-name');
                const currentStepsEl = screen.querySelector('#steps-current-count');
                const goalStepsEl = screen.querySelector('.steps-label');
                const progressRingEl = screen.querySelector('#steps-progress-ring');
                const trackListEl = screen.querySelector('#activity-track-list');
                const annotationEl = screen.querySelector('#steps-annotation-content');

                // 无论AI数据是否返回，都先渲染固定信息
                avatarEl.src = char.avatar;
                nameEl.textContent = char.realName;
                goalStepsEl.textContent = '/ 6000 步';

                if (!data) {
                    // Display loading or empty state for dynamic content
                    currentStepsEl.textContent = '----';
                    trackListEl.innerHTML = '<li class="activity-track-item">正在生成活动轨迹...</li>';
                    annotationEl.textContent = '正在生成角色批注...';
                    progressRingEl.style.setProperty('--steps-percentage', 0);
                    return;
                }

                // 填充AI返回的动态内容
                currentStepsEl.textContent = data.currentSteps;

                const percentage = (data.currentSteps / 6000) * 100;
                progressRingEl.style.setProperty('--steps-percentage', percentage);

                trackListEl.innerHTML = data.trajectory.map(item => `<li class="activity-track-item">${item}</li>`).join('');
                annotationEl.textContent = data.annotation;
            }

            function generatePeekContentPrompt(char, appType, mainChatContext) {
                const appNameMapping = {
                    messages: "消息应用（模拟与他人的对话）",
                    memos: "备忘录应用",
                    cart: "电商平台的购物车",
                    transfer: "文件传输助手（用于记录临时想法、链接等）",
                    browser: "浏览器历史记录",
                    drafts: "邮件或消息的草稿箱"
                };
                const appName = appNameMapping[appType] || appType;

                let prompt = `你正在模拟一个名为 ${char.realName} 的角色的手机内部信息。`;
                prompt += `该角色的核心人设是：${char.persona}。\n`;

                // 新增：获取并注入世界书和用户人设
                const associatedWorldBooks = (char.worldBookIds || []).map(id => db.worldBooks.find(wb => wb.id === id)).filter(Boolean);
                if (associatedWorldBooks.length > 0) {
                    const worldBookContext = associatedWorldBooks.map(wb => `设定名: ${wb.name}\n内容: ${wb.content}`).join('\n\n');
                    prompt += `\n为了更好地理解背景，请参考以下世界观设定：\n---\n${worldBookContext}\n---\n`;
                }
                if (char.myPersona) {
                    prompt += `\n作为参考，我（用户）的人设是：${char.myPersona}\n`;
                }
                // 新增结束

                prompt += `最近，我（姓名为 ${char.myName}）和 ${char.realName} 的对话如下（这是你们关系和当前状态的核心参考）：\n---\n${mainChatContext}\n---\n`;
                prompt += `现在，我正在偷看Ta手机上的“${appName}”。请你基于Ta的人设和我们最近的聊天内容，生成符合该应用场景的、高度相关且富有沉浸感的内容。\n`;
                prompt += `你的输出必须是一个JSON对象，且只包含JSON内容，不要有任何额外的解释或标记。根据应用类型，JSON结构如下：\n`;

                switch (appType) {
                    case 'messages':
                        prompt += `
                    {
                      "conversations": [
                        {
                          "partnerName": "与Ta对话的人的称呼",
                          "history": [
                            { "sender": "char", "content": "${char.realName}发送的消息内容" },
                            { "sender": "partner", "content": "对方发送的消息内容" }
                          ]
                        }
                      ]
                   }
                   请为 ${char.realName} 编造3-5个最近的对话。对话内容需要强烈反映Ta的人设以及和我的聊天上下文。`;
                        break;
                    case 'steps':
                        prompt += `
                    {
                      "currentSteps": 8102,
                      "trajectory": [
                        "08:30 AM - 公司楼下咖啡馆",
                        "10:00 AM - 宠物用品店",
                        "12:00 PM - 附近日料店",
                        "03:00 PM - 回家路上的甜品店",
                        "04:00 PM - 楼下的便利店",
                        "06:30 PM - 健身房"
                      ],
                      "annotation": "角色对自己今天运动情况的批注"
                    }
                    请为 ${char.realName} 生成今天的步数信息。你只需要生成Ta的当前步数(currentSteps)，Ta的6条运动轨迹(trajectory)（禁止照搬示例）以及批注(annotation)。内容需要与Ta的人设和我们的聊天上下文高度相关。`;
                        break;
                    case 'album':
                        prompt += `
                    {
                      "photos": [
                        { "type": "photo", "imageDescription": "对一张照片的详细文字描述，例如：一张傍晚在海边的自拍，背景是橙色的晚霞和归来的渔船。", "description": "角色对这张照片的一句话批注，例如：那天的风很舒服。" },
                        { "type": "video", "imageDescription": "对一段视频的详细文字描述，例如：一段在猫咖撸猫的视频，视频里有一只橘猫在打哈欠。", "description": "角色对这段视频的一句话批注，例如：下次还来这里！" }
                      ]
                    }
                    请为 ${char.realName} 的相册生成5-8个条目（照片或视频）。内容需要与Ta的人设和我们的聊天上下文高度相关。'imageDescription' 是对这张照片/视频的详细文字描述，它将代替真实的图片展示给用户。'description' 是 ${char.realName} 自己对这张照片/视频的一句话批注，会显示在描述下方。`;
                        break;
                    case 'memos':
                        prompt += `
                    {
                      "memos": [
                        { "id": "memo_1", "title": "备忘录标题", "content": "备忘录内容，可以包含换行符\\n" }
                      ]
                    }
                    请生成3-4条备忘录，内容要与Ta的人设和我们的聊天上下文相关。`;
                        break;
                    case 'cart':
                        prompt += `
                    {
                      "items": [
                        { "id": "cart_1", "title": "商品标题", "spec": "商品规格", "price": "25.00" }
                      ]
                    }
                    请生成3-4件商品，这些商品应该反映Ta的兴趣、需求或我们最近聊到的话题。`;
                        break;
                    case 'browser':
                        prompt += `
                    {
                      "history": [
                        { "title": "网页标题", "url": "example.com/path", "annotation": "角色对于这条浏览记录的想法或批注" }
                      ]
                    }
                    请生成3-5条浏览记录。记录本身要符合Ta的人设和我们的聊天上下文，'annotation'字段则要站在角色自己的视角，记录Ta对这条浏览记录的想法或批注。`;
                        break;
                    case 'drafts':
                        prompt += `
                    {
                      "draft": { "to": "${char.myName}", "content": "一封写给我但未发送的草稿内容，可以使用HTML的<span class='strikethrough'></span>标签来表示划掉的文字。" }
                    }
                    请生成一份Ta写给我但犹豫未决、未发送的草稿。内容要深刻、细腻，反映Ta的内心挣扎和与我的关系。`;
                        break;
                    case 'transfer':
                        prompt += `
                   {
                     "entries": [
                       "要记得买牛奶。",
                       "https://example.com/interesting-article",
                       "刚刚那个想法不错，可以深入一下..."
                     ]
                   }
                   请为 ${char.realName} 生成4-7条Ta发送给自己的、简短零碎的消息。这些内容应该像是Ta的临时备忘、灵感闪现或随手保存的链接，要与Ta的人设和我们的聊天上下文相关，但比“备忘录”应用的内容更随意、更口语化。`;
                        break;
                    default:
                        prompt += `{"error": "Unknown app type"}`;
                        break;
                    case 'unlock':
                        prompt += `
                    {
                      "nickname": "角色的微博昵称",
                      "handle": "@角色的微博ID",
                      "bio": "角色的个性签名，可以包含换行符\\n",
                      "posts": [
                        { "timestamp": "2小时前", "content": "第一条微博正文内容，140字以内。" },
                        { "timestamp": "昨天", "content": "第二条微博正文内容。" },
                        { "timestamp": "3天前", "content": "第三条微博正文内容。" }
                      ]
                    }
                    请为 ${char.realName} 生成一个符合其人设的微博小号。你需要生成昵称、ID、个性签名，以及3-4条最近的微博。微博内容要生活化、碎片化，符合小号的风格，并与Ta的人设和我们的聊天上下文高度相关。`;
                        break;
                }
                return prompt;
            }

            async function generateAndRenderPeekContent(appType, options = {}) {
                const { forceRefresh = false } = options;

                if (generatingPeekApps.has(appType)) {
                    showToast('该应用内容正在生成中，请稍候...');
                    return;
                }

                // Check cache first
                if (!forceRefresh && peekContentCache[appType]) {
                    const cachedData = peekContentCache[appType];
                    switch (appType) {
                        case 'messages':
                            renderPeekChatList(cachedData.conversations);
                            switchScreen('peek-messages-screen');
                            break;
                        case 'album':
                            renderPeekAlbum(cachedData.photos);
                            switchScreen('peek-album-screen');
                            break;
                        case 'memos':
                            renderMemosList(cachedData.memos);
                            switchScreen('peek-memos-screen');
                            break;
                        case 'album':
                            renderPeekAlbum(cachedData.photos);
                            switchScreen('peek-album-screen');
                            break;
                        case 'transfer':
                            renderPeekTransferStation(cachedData.entries);
                            switchScreen('peek-transfer-station-screen');
                            break;
                        case 'cart':
                            renderPeekCart(cachedData.items);
                            switchScreen('peek-cart-screen');
                            break;
                        case 'browser':
                            renderPeekBrowser(cachedData.history);
                            switchScreen('peek-browser-screen');
                            break;
                        case 'drafts':
                            renderPeekDrafts(cachedData.draft);
                            switchScreen('peek-drafts-screen');
                            break;
                        case 'steps':
                            renderPeekSteps(cachedData);
                            switchScreen('peek-steps-screen');
                            break;
                        case 'unlock':
                            renderPeekUnlock(cachedData);
                            switchScreen('peek-unlock-screen');
                            break;
                    }
                    return; // Stop execution since we used cache
                }

                const char = db.characters.find(c => c.id === currentChatId);
                if (!char) return showToast('无法找到当前角色');

                const { url, key, model, provider } = db.apiSettings;
                if (!url || !key || !model) {
                    showToast('请先在“api”应用中完成设置！');
                    return switchScreen('api-settings-screen');
                }

                generatingPeekApps.add(appType); // Lock this specific app
                let targetContainer;

                // Show loading state
                switch (appType) {
                    case 'messages':
                        switchScreen('peek-messages-screen');
                        targetContainer = document.getElementById('peek-chat-list-container');
                        targetContainer.innerHTML = '<p class="placeholder-text">正在生成对话列表...</p>';
                        break;
                    case 'album':
                        switchScreen('peek-album-screen');
                        renderPeekAlbum([]); // 渲染空状态，会显示“正在生成...”
                        break;
                    case 'memos':
                        switchScreen('peek-memos-screen');
                        renderMemosList([]); // Render empty state with loading text
                        break;
                    case 'transfer':
                        switchScreen('peek-transfer-station-screen');
                        renderPeekTransferStation([]);
                        break;
                    case 'cart':
                        switchScreen('peek-cart-screen');
                        renderPeekCart([]);
                        break;
                    case 'browser':
                        switchScreen('peek-browser-screen');
                        renderPeekBrowser([]);
                        break;
                    case 'drafts':
                        switchScreen('peek-drafts-screen');
                        renderPeekDrafts(null);
                        break;
                    case 'steps':
                        switchScreen('peek-steps-screen');
                        renderPeekSteps(null); // Render empty state
                        break;
                    case 'unlock':
                        switchScreen('peek-unlock-screen');
                        renderPeekUnlock(null); // Render empty/loading state
                        break;
                    default:
                        showToast('无法打开');
                        generatingPeekApps.delete(appType); // Unlock if app is invalid
                        return;
                }

                try {
                    const peekSettings = char.peekScreenSettings || {};
    // 确保 limit 是个负数（用于 slice 从后往前截取），或者 0
    // 如果 settings 里没有 contextLimit，默认取 50
    const limitCount = (peekSettings.contextLimit !== undefined) ? peekSettings.contextLimit : 50;
                    const mainChatContext = limitCount > 0 
        ? char.history.slice(-limitCount).map(m => m.content).join('\n') 
        : "";
                    const systemPrompt = generatePeekContentPrompt(char, appType, mainChatContext);

                    const requestBody = {
                        model: model,
                        messages: [{ role: 'user', content: systemPrompt }],
                        temperature: 0.8,
                        top_p: 0.9,
                    };

                    const endpoint = `${url}/v1/chat/completions`;
                    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };

                    const response = await fetch(endpoint, { method: 'POST', headers: headers, body: JSON.stringify(requestBody) });
                    if (!response.ok) {
                        const error = new Error(`API Error: ${response.status} ${await response.text()}`);
                        error.response = response;
                        throw error;
                    }

                    const result = await response.json();
                    const contentStr = result.choices[0].message.content;

                    const jsonMatch = contentStr.match(/\{[\s\S]*\}/);
                    if (!jsonMatch) throw new Error("AI响应中未找到有效的JSON对象。");

                    const generatedData = JSON.parse(jsonMatch[0]);

                    // --- NEW: Strict data validation ---
                    let isValid = false;
                    switch (appType) {
                        case 'messages': isValid = generatedData && Array.isArray(generatedData.conversations); break;
                        case 'memos': isValid = generatedData && Array.isArray(generatedData.memos); break;
                        case 'album': isValid = generatedData && Array.isArray(generatedData.photos); break;
                        case 'cart': isValid = generatedData && Array.isArray(generatedData.items); break;
                        case 'transfer': isValid = generatedData && Array.isArray(generatedData.entries); break;
                        case 'browser': isValid = generatedData && Array.isArray(generatedData.history); break;
                        case 'drafts': isValid = generatedData && generatedData.draft; break;
                        case 'steps': isValid = generatedData && generatedData.currentSteps !== undefined; break;
                        case 'unlock': isValid = generatedData && generatedData.nickname && Array.isArray(generatedData.posts); break;
                        default: isValid = false;
                    }

                    if (!isValid) {
                        throw new Error("AI返回的数据格式不符合应用要求。");
                    }
                    // --- END: Strict data validation ---

                    // Store in cache
                    peekContentCache[appType] = generatedData;
                    
  saveData().catch(e => console.error("Peek自动保存失败:", e));                  

                    // Render content based on app type
                    if (appType === 'messages') {
                        renderPeekChatList(generatedData.conversations);
                    } else if (appType === 'memos') {
                        renderMemosList(generatedData.memos);
                    } else if (appType === 'album') {
                        renderPeekAlbum(generatedData.photos);
                    } else if (appType === 'transfer') {
                        renderPeekTransferStation(generatedData.entries);
                    } else if (appType === 'cart') {
                        renderPeekCart(generatedData.items);
                    } else if (appType === 'browser') {
                        renderPeekBrowser(generatedData.history);
                    } else if (appType === 'drafts') {
                        renderPeekDrafts(generatedData.draft);
                    } else if (appType === 'steps') {
                        renderPeekSteps(generatedData);
                    } else if (appType === 'unlock') {
                        renderPeekUnlock(generatedData);
                    }

                } catch (error) {
                    showApiError(error);
                    // Clear cache for this app on failure
                    delete peekContentCache[appType];
                    const errorMessage = "内容生成失败，请刷新重试。";
                    if (appType === 'album') {
                        document.querySelector('#peek-album-screen .album-grid').innerHTML = `<p class="placeholder-text">${errorMessage}</p>`;
                    } else if (appType === 'unlock') {
                        document.getElementById('peek-unlock-screen').innerHTML = `<header class="app-header"><button class="back-btn" data-target="peek-screen">‹</button><div class="title-container"><h1 class="title">错误</h1></div><button class="action-btn">···</button></header><main class="content"><p class="placeholder-text">${errorMessage}</p></main>`;
                    } else if (targetContainer) {
                        targetContainer.innerHTML = `<p class="placeholder-text">${errorMessage}</p>`;
                    }
                } finally {
                    generatingPeekApps.delete(appType); // Release the lock for this specific app
                }
            }

            function renderPeekSettings() {
                const character = db.characters.find(c => c.id === currentChatId);
                if (!character) return;

                const peekSettings = character.peekScreenSettings || { wallpaper: '', customIcons: {}, unlockAvatar: '', contextLimit: 50 };

                // Populate wallpaper
                document.getElementById('peek-wallpaper-url-input').value = peekSettings.wallpaper || '';

                const iconsContainer = document.getElementById('peek-app-icons-settings');
                iconsContainer.innerHTML = '';

                Object.keys(peekScreenApps).forEach(appId => {
                    const app = peekScreenApps[appId];
                    const currentIcon = peekSettings.customIcons?.[appId] || app.url;

                    const itemEl = document.createElement('div');
                    itemEl.className = 'icon-custom-item';
                    itemEl.innerHTML = `
                    <img src="${currentIcon}" alt="${app.name}" class="icon-preview">
                    <div class="icon-details">
                        <p>${app.name}</p>
                        <input type="url" class="form-group" data-app-id="${appId}" placeholder="粘贴新的图标URL" value="${peekSettings.customIcons?.[appId] || ''}">
                    </div>
                    <input type="file" id="peek-icon-upload-${appId}" data-app-id="${appId}" accept="image/*" style="display:none;">
                    <label for="peek-icon-upload-${appId}" class="btn btn-small btn-neutral" style="font-size: 12px;">上传</label>
                `;
                    iconsContainer.appendChild(itemEl);
                });

                // Add event listeners for all new upload buttons
                iconsContainer.querySelectorAll('input[type="file"]').forEach(uploadInput => {
                    uploadInput.addEventListener('change', handlePeekIconUpload);
                });

                // Populate unlock avatar url
                document.getElementById('peek-unlock-avatar-url').value = peekSettings.unlockAvatar || '';
                document.getElementById('peek-context-limit').value = peekSettings.contextLimit !== undefined ? peekSettings.contextLimit : 50;
            }

            async function handlePeekIconUpload(e) {
                const file = e.target.files[0];
                const appId = e.target.dataset.appId;
                if (file && appId) {
                    try {
                        const compressedUrl = await compressImage(file, { quality: 0.8, maxWidth: 120, maxHeight: 120 });
                        const urlInput = document.querySelector(`#peek-app-icons-settings input[data-app-id="${appId}"]`);
                        const previewImg = urlInput.closest('.icon-custom-item').querySelector('.icon-preview');
                        if (urlInput) {
                            urlInput.value = compressedUrl;
                        }
                        if (previewImg) {
                            previewImg.src = compressedUrl;
                        }
                        showToast(`${peekScreenApps[appId].name} 图标已上传并压缩`);
                    } catch (error) {
                        showToast('图标压缩失败，请重试');
                    }
                }
            }
