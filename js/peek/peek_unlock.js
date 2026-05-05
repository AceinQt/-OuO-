// ==========================================
// peek_unlock.js
// 小号渲染、小号生成与事件设置
// ==========================================

// 将绝对时间戳转换为相对时间，随着渲染自动更新
function formatRelativeTime(timestamp) {
    if (timestamp === 0) return '很久以前';
    if (!timestamp) return '刚刚';
    
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    
    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes}分钟前`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}小时前`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}天前`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}个月前`;
    return `${Math.floor(months / 12)}年前`;
}

function renderPeekUnlock(data) {
    const screen = document.getElementById('peek-unlock-screen');
    if (!screen) return;

    const placeholder = document.getElementById('unlock-placeholder');
    const contentArea = document.getElementById('unlock-content-area');
    const headerTitle = document.getElementById('unlock-header-title');

    // 处理加载/空状态 (仅在完全没数据时显示骨架屏)
    if (!data) {
        if (placeholder) placeholder.style.display = 'block';
        if (contentArea) contentArea.style.display = 'none';
        return;
    }

    if (placeholder) placeholder.style.display = 'none';
    if (contentArea) contentArea.style.display = 'block';

    const character = db.characters.find(c => c.id === window.activePeekCharId);
    const peekSettings = character?.peekScreenSettings || {};
    
    // 如果有固定昵称和固定ID设置，则强制覆盖
    const nickname = peekSettings.unlockFixedNickname || data.nickname || '小号';
    const handle = peekSettings.unlockFixedHandle || data.handle || '@unknown';
    const bio = data.bio || '';
    const posts = data.posts ||[];
    
    const fixedAvatar = peekSettings.unlockAvatar || 'https://i.postimg.cc/SNwL1XwR/chan-11.png';

    if (headerTitle) headerTitle.innerText = nickname;

    // 填充静态页面内容
    document.getElementById('unlock-profile-avatar').src = fixedAvatar;
    document.getElementById('unlock-profile-username').innerText = nickname;
    document.getElementById('unlock-profile-handle').innerText = handle;
    document.getElementById('unlock-profile-bio-text').innerHTML = bio.replace(/\n/g, '<br>');

    document.getElementById('unlock-stat-posts').innerText = posts.length;
    
    // 随机缓存粉丝数
    if (!data.randomFollowers) {
        data.randomFollowers = (Math.random() * 5 + 1).toFixed(1) + 'k';
        data.randomFollowing = Math.floor(Math.random() * 500) + 50;
    }
    document.getElementById('unlock-stat-followers').innerText = data.randomFollowers;
    document.getElementById('unlock-stat-following').innerText = data.randomFollowing;

    const feed = document.getElementById('unlock-post-feed');
    const isEdit = PeekDeleteManager.isEditMode && PeekDeleteManager.currentAppType === 'unlock';

    let postsHtml = '';
    
    // 兼容旧数据补全时间，0代表没有时间戳的遗留老数据
    const sortedPosts = [...posts].map(post => {
        if (post.absoluteTime === undefined || post.absoluteTime === null) {
            post.absoluteTime = 0; 
        }
        return post;
    }).sort((a, b) => b.absoluteTime - a.absoluteTime);

    sortedPosts.forEach(post => {
        if (!post.id) post.id = 'post_old_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        const isSelected = isEdit && PeekDeleteManager.selectedIds.has(post.id);
        
        // 缓存随机交互数避免重渲染跳动
        if (post.randomComments === undefined) post.randomComments = Math.floor(Math.random() * 100);
        if (post.randomLikes === undefined) post.randomLikes = Math.floor(Math.random() * 500);

        // 使用相对时间方法动态渲染
        let timeDisplay = formatRelativeTime(post.absoluteTime);

        postsHtml += `
            <div class="unlock-post-card ${isEdit ? 'is-selecting' : ''} ${isSelected ? 'selected' : ''}" data-id="${post.id}" style="position:relative;">
                ${post.isNew ? '<span class="new-badge" style="position:absolute; top:16px; right:16px;">new!</span>' : ''}
                <div class="unlock-post-card-header">
                    <img src="${fixedAvatar}" alt="Profile Avatar">
                    <div class="unlock-post-card-author-info">
                        <span class="username">${nickname}</span>
                        <span class="timestamp">${timeDisplay}</span>
                    </div>
                </div>
                <div class="unlock-post-card-content">
                    ${post.content.replace(/\n/g, '<br>')}
                </div>
                <div class="unlock-post-card-actions">
                    <div class="action"><svg viewBox="0 0 24 24"><path d="M18,16.08C17.24,16.08 16.56,16.38 16.04,16.85L8.91,12.7C8.96,12.47 9,12.24 9,12C9,11.76 8.96,11.53 8.91,11.3L16.04,7.15C16.56,7.62 17.24,7.92 18,7.92C19.66,7.92 21,6.58 21,5C21,3.42 19.66,2 18,2C16.34,2 15,3.42 15,5C15,5.24 15.04,5.47 15.09,5.7L7.96,9.85C7.44,9.38 6.76,9.08 6,9.08C4.34,9.08 3,10.42 3,12C3,13.58 4.34,14.92 6,14.92C6.76,14.92 7.44,14.62 7.96,14.15L15.09,18.3C15.04,18.53 15,18.76 15,19C15,20.58 16.34,22 18,22C19.66,22 21,20.58 21,19C21,17.42 19.66,16.08 18,16.08Z"></path></svg> <span>分享</span></div>
                    <div class="action"><svg viewBox="0 0 24 24"><path d="M20,2H4C2.9,0,2,0.9,2,2v18l4-4h14c1.1,0,2-0.9,2-2V4C22,2.9,21.1,2,20,2z M18,14H6v-2h12V14z M18,11H6V9h12V11z M18,8H6V6h12V8z"></path></svg> <span>${post.randomComments}</span></div>
                    <div class="action"><svg viewBox="0 0 24 24"><path d="M12,21.35L10.55,20.03C5.4,15.36,2,12.27,2,8.5C2,5.42,4.42,3,7.5,3c1.74,0,3.41,0.81,4.5,2.09C13.09,3.81,14.76,3,16.5,3C19.58,3,22,5.42,22,8.5c0,3.78-3.4,6.86-8.55,11.54L12,21.35z"></path></svg> <span>${post.randomLikes}</span></div>
                </div>
            </div>
        `;
    });

    if (feed) feed.innerHTML = postsHtml;

    // 清除新红点
    let hasNewUnlock = false;
    if (data && data.posts) {
        data.posts.forEach(post => {
            if (post.isNew) { post.isNew = false; hasNewUnlock = true; }
        });
        if (hasNewUnlock) savePeekData(window.activePeekCharId);
    }
}

async function generateAndRenderPeekUnlock(options = {}) {
    const appType = 'unlock';
    const { forceRefresh = false } = options;

    if (generatingPeekApps.has(appType)) { showToast('小号内容正在生成中，请稍候...'); return; }

    if (!forceRefresh && peekContentCache[appType]) {
        renderPeekUnlock(peekContentCache[appType]);
        switchScreen('peek-unlock-screen');
        return;
    }

    const char = db.characters.find(c => c.id === window.activePeekCharId);
    if (!char) return showToast('无法找到当前角色');

    const { url, key, model, streamEnabled, temperature } = getPeekApiConfig(window.activePeekCharId);
    if (!url || !key || !model) { showToast('请先配置 API！'); return switchScreen('api-settings-screen'); }

    generatingPeekApps.add(appType);
    switchScreen('peek-unlock-screen');
    
    // 如果从来没生成过内容，才展示骨架屏占位
    if (!peekContentCache[appType]) {
        renderPeekUnlock(null); 
    }

    const hideLoading = showLoadingToast('正在生成神秘小号记录...');

    try {
        const peekSettings = char.peekScreenSettings || {};
        const limitCount = (peekSettings.contextLimit !== undefined) ? peekSettings.contextLimit : 50;
        const mainChatContext = limitCount > 0 ? historyToPlainText(char.history.slice(-limitCount)) : "";

        const senderName = char.realName || char.name;
        const baseContextPrompt = getPeekBasePromptContext(char, mainChatContext);

        // 确定距离上次更新的时长，用以辅助AI产生时间概念
        const now = Date.now();
        const lastGenTime = (peekContentCache['unlock'] && peekContentCache['unlock'].lastGenTime) ? peekContentCache['unlock'].lastGenTime : (now - 3 * 24 * 3600 * 1000);
        const hoursSinceLast = Math.max(1, Math.floor((now - lastGenTime) / 3600000));
        let timeText = hoursSinceLast > 72 ? '几天' : `约 ${hoursSinceLast} 小时`;

        let systemPrompt = `你正在模拟角色 ${char.realName} 的社交媒体（类似微博/X）私密小号。\n`;
        systemPrompt += baseContextPrompt;
        systemPrompt += `
【任务1：小号内容记录】
请为 ${char.realName} 生成一个符合其人设的私密小号。内容要生活化、碎片化，符合小号的风格，并与Ta的人设和最近聊天上下文高度相关。
本次需要你补充近期（距离上次更新已过去 ${timeText}）产生的新帖子。

请注意：
1. 请生成 3-4 条最近的帖子内容。
2. 帖子必须按照**时间倒序**输出（最上面的 #POST# 是最新发布的，最下面的相对较早）。
3. 帖子之间的时间和内容逻辑必须符合客观常识！例如：如果下面的一条是准备睡觉，上面最新的一条就不能是刚吃晚餐这种时间倒流的逻辑。
4. 每条 #POST# 的第一行用方括号包含生成时间（必须写成距离现在的相对时间，例如[15分钟前]、[2小时前]、[昨天]等），下方是正文（140字以内）。

你需要生成以下信息：
#NICKNAME#: 小号的昵称
#HANDLE#: @开头的ID
#BIO#: 个性签名
#POST#: 帖子列表（按照时间倒序，最新的在最前）

【任务2：话题分享】
小号内容往往是私密的，预测一下，在未来的某个时间，${senderName}也许会"不小心"或者以暗示的方式，把小号里表达的某一种情绪/状态，通过日常聊天的口吻发给${char.myName}寻求安慰或产生互动。
`;
        systemPrompt += getPeekProactiveFormatPrompt(char);
        systemPrompt += `
请严格按照以下标签文本格式输出。在所有内容结束后，使用 ===PROACTIVE_MESSAGES=== 分割，再输出主动消息。

输出格式示例：
#NICKNAME#
角色的小号昵称
#HANDLE#
@角色的小号ID
#BIO#
角色的个性签名，可以包含换行符
#POST#
[15分钟前]
第一条正文内容（最新）
#POST#
[2小时前]
第二条正文内容（较早）
===PROACTIVE_MESSAGES===
#SECRET_CHAT_NIGHT_85%#[23:15|${senderName}的消息:你睡了吗？][23:16|${senderName}的消息:感觉有点丧，不知道该跟谁说...]
`;

        const contentStr = await callPeekApi({ url, key, model, messages: [{ role: 'user', content: systemPrompt }], temperature, streamEnabled });

        const parts = contentStr.split(/===PROACTIVE_MESSAGES===/i);
        const unlockRawText = parts[0] || '';
        const hitchhikerRawText = parts.length > 1 ? parts[1] : '';

        const nickMatch = unlockRawText.match(/#NICKNAME#\s*([\s\S]*?)(?=#HANDLE#|$)/i);
        const handleMatch = unlockRawText.match(/#HANDLE#\s*([\s\S]*?)(?=#BIO#|$)/i);
        const bioMatch = unlockRawText.match(/#BIO#\s*([\s\S]*?)(?=#POST#|$)/i);

        const postSplits = unlockRawText.split(/#POST#/i).slice(1);
        const parsedPosts = [];

        // 尝试从AI给的tag(如[15分钟前])里提取或换算真实的相对时间戳
        function parseTimeTag(tag, lastTime, currentTime) {
            let offset = 0;
            if (/刚/.test(tag)) offset = 1 * 60 * 1000;
            else if (/(半小时|30分钟)/.test(tag)) offset = 30 * 60 * 1000;
            else if (/分钟/.test(tag)) {
                let m = tag.match(/(\d+)/);
                if (m) offset = parseInt(m[1]) * 60 * 1000;
            } else if (/小时/.test(tag)) {
                let m = tag.match(/(\d+)/);
                if (m) offset = parseInt(m[1]) * 3600 * 1000;
            } else if (/天/.test(tag)) {
                let m = tag.match(/(\d+)/);
                if (m) offset = parseInt(m[1]) * 24 * 3600 * 1000;
            } else if (/昨天/.test(tag)) {
                offset = 24 * 3600 * 1000;
            } else if (/前天/.test(tag)) {
                offset = 48 * 3600 * 1000;
            }
            
            if (offset > 0) {
                let t = currentTime - offset;
                // 防止时间跳脱到比上次生成还要早太多的荒谬区间，稍微钳制一下
                if (t < lastTime) t = lastTime + Math.random() * ((currentTime - lastTime) || 3600000) * 0.5;
                return t;
            }
            // 解析失败的保底机制：取上次生成时间和现在的中间随机
            return Math.floor(lastTime + Math.random() * (currentTime - lastTime));
        }

        let lastParsedTime = now; // 用于时间倒流保护

        postSplits.forEach(postStr => {
            const postMatch = postStr.match(/^\s*\[([^\]]+)\]\s*([\s\S]*)$/);
            const contentText = postMatch ? postMatch[2].trim() : postStr.trim();
            if (contentText) {
                const timeTag = postMatch ? postMatch[1].trim() : '';
                let absoluteTime = parseTimeTag(timeTag, lastGenTime, now);
                
                // 时间逻辑保护机制：AI是倒序输出，因此当前循环到的帖子必须比前一个帖子"更老"。
                // 否则就属于AI逻辑错误，我们直接介入纠偏，强制扣除时间。
                if (absoluteTime >= lastParsedTime) {
                    absoluteTime = lastParsedTime - Math.floor(Math.random() * 60000 + 60000); // 强制比上一个老1到2分钟
                }
                lastParsedTime = absoluteTime;

                parsedPosts.push({
                    id: `post_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                    timestamp: timeTag,
                    absoluteTime: absoluteTime,
                    content: contentText,
                    isNew: true
                });
            }
        });

        if (nickMatch && parsedPosts.length > 0) {
            if (!peekContentCache['unlock']) {
                peekContentCache['unlock'] = { nickname: '', handle: '', bio: '', posts:[] };
            }

            peekContentCache['unlock'].nickname = nickMatch[1].trim();
            peekContentCache['unlock'].handle = handleMatch ? handleMatch[1].trim() : '@unknown';
            peekContentCache['unlock'].bio = bioMatch ? bioMatch[1].trim() : '...';
            // 将新帖子拼接到原数组最前面
            peekContentCache['unlock'].posts = [...parsedPosts, ...peekContentCache['unlock'].posts];
            peekContentCache['unlock'].lastGenTime = now; // 记录本次生成时间

            savePeekData(char.id).catch(e => console.error("Peek自动保存失败:", e));
            renderPeekUnlock(peekContentCache['unlock']);
        } else {
            throw new Error("解析小号内容失败，未找到对应标签。");
        }

        if (hitchhikerRawText.trim()) {
            parseAndSavePeekProactiveHitchhiker(char, hitchhikerRawText);
            saveSingleChat(char.id, 'private').catch(e => console.error(e));
        }

    } catch (error) {
        console.error(error);
        showApiError(error);
        if (peekContentCache['unlock']?.posts?.length > 0) {
            renderPeekUnlock(peekContentCache['unlock']);
            if (typeof showToast === 'function') showToast('刷新失败: ' + error.message);
        } else {
            const placeholder = document.getElementById('unlock-placeholder');
            if (placeholder) {
                placeholder.innerHTML = `<span style="color:#ff4d4f;">内容生成失败，请重试。<br><span style="font-size:12px;">${error.message}</span></span>`;
                placeholder.style.display = 'block';
            }
        }
    } finally {
        generatingPeekApps.delete(appType);
        hideLoading();
    }
}

// 供 peek_core.js 初始化时调用，挂载静态页面的事件
// 供 peek_core.js 初始化时调用，挂载静态页面的事件
function initPeekUnlock() {
    const refreshBtn = document.getElementById('refresh-unlock-btn');
    if (refreshBtn) {
        // 先替换自身避免重复绑定
        const newRefreshBtn = refreshBtn.cloneNode(true);
        refreshBtn.parentNode.replaceChild(newRefreshBtn, refreshBtn);
        newRefreshBtn.addEventListener('click', () => generateAndRenderPeekUnlock({ forceRefresh: true }));
    }

    const settingsBtn = document.getElementById('unlock-settings-btn');
    const settingsModal = document.getElementById('peek-unlock-settings-modal');
    const avatarInput = document.getElementById('peek-unlock-avatar');
    const avatarPreview = document.getElementById('peek-unlock-avatar-preview');
    const avatarUpload = document.getElementById('peek-unlock-avatar-upload');
    
    // 绑定弹窗打开与数据回显
    if (settingsBtn && settingsModal) {
        const newSettingsBtn = settingsBtn.cloneNode(true);
        settingsBtn.parentNode.replaceChild(newSettingsBtn, settingsBtn);
        newSettingsBtn.addEventListener('click', () => {
            const character = db.characters.find(c => c.id === window.activePeekCharId);
            const peekSettings = character?.peekScreenSettings || {};
            
            // 数据回显与预览图更新
            const currentAvatar = peekSettings.unlockAvatar || '';
            if(avatarInput) avatarInput.value = currentAvatar;
            if(avatarPreview) avatarPreview.src = currentAvatar || 'https://i.postimg.cc/SNwL1XwR/chan-11.png';
            
            document.getElementById('peek-unlock-fixed-nickname').value = peekSettings.unlockFixedNickname || '';
            document.getElementById('peek-unlock-fixed-handle').value = peekSettings.unlockFixedHandle || '';
            
            settingsModal.classList.add('visible');
        });
    }

    // 绑定输入框变化实时更新预览图
    if (avatarInput && avatarPreview) {
        avatarInput.addEventListener('input', () => {
            avatarPreview.src = avatarInput.value.trim() || 'https://i.postimg.cc/SNwL1XwR/chan-11.png';
        });
    }

    // 绑定本地图片上传与压缩转换
    if (avatarUpload) {
        const newAvatarUpload = avatarUpload.cloneNode(true);
        avatarUpload.parentNode.replaceChild(newAvatarUpload, avatarUpload);
        newAvatarUpload.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            let hideLoading = null;
            try {
                if (typeof showLoadingToast === 'function') {
                    hideLoading = showLoadingToast('正在处理头像...');
                }
                
                // 调用 utils.js 里的压缩方法，限制小尺寸防止Base64撑爆存储
                const base64Data = await compressImage(file, { maxWidth: 300, maxHeight: 300, quality: 0.8 });
                
                if(avatarInput) avatarInput.value = base64Data;
                if(avatarPreview) avatarPreview.src = base64Data;
                
            } catch (error) {
                console.error("头像处理失败", error);
                if (typeof showToast === 'function') showToast("图片处理失败");
            } finally {
                e.target.value = ''; // 清空选择器，允许二次重传同一张图
                if (hideLoading) hideLoading();
            }
        });
    }

    const closeBtn = document.getElementById('close-unlock-settings-btn');
    if (closeBtn) {
        const newCloseBtn = closeBtn.cloneNode(true);
        closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);
        newCloseBtn.addEventListener('click', () => {
            document.getElementById('peek-unlock-settings-modal').classList.remove('visible');
        });
    }

    const saveBtn = document.getElementById('save-unlock-settings-btn');
    if (saveBtn) {
        const newSaveBtn = saveBtn.cloneNode(true);
        saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
        newSaveBtn.addEventListener('click', async () => {
            const character = db.characters.find(c => c.id === window.activePeekCharId);
            if (!character) {
                if(typeof showToast === 'function') showToast('未找到当前角色');
                return;
            }

            if (!character.peekScreenSettings) {
                character.peekScreenSettings = {};
            }

            character.peekScreenSettings.unlockAvatar = document.getElementById('peek-unlock-avatar').value.trim();
            character.peekScreenSettings.unlockFixedNickname = document.getElementById('peek-unlock-fixed-nickname').value.trim();
            
            let handle = document.getElementById('peek-unlock-fixed-handle').value.trim();
            if (handle && !handle.startsWith('@')) handle = '@' + handle;
            character.peekScreenSettings.unlockFixedHandle = handle;

            await saveSingleChat(window.activePeekCharId, 'private');
            
            document.getElementById('peek-unlock-settings-modal').classList.remove('visible');
            
            // 保存后重新渲染应用更改
            if (peekContentCache['unlock']) {
                renderPeekUnlock(peekContentCache['unlock']);
            }
            if(typeof showToast === 'function') showToast('小号设置已保存');
        });
    }
}