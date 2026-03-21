// ==========================================
// peek_unlock.js
// 小号渲染、小号生成
// ==========================================

function renderPeekUnlock(data) {
    const screen = document.getElementById('peek-unlock-screen');
    if (!screen) return;

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
    const character = db.characters.find(c => c.id === window.activePeekCharId);
    const peekSettings = character?.peekScreenSettings || { unlockAvatar: '' };
    const fixedAvatar = peekSettings.unlockAvatar || 'https://i.postimg.cc/SNwL1XwR/chan-11.png';

    const randomFollowers = (Math.random() * 5 + 1).toFixed(1) + 'k';
    const randomFollowing = Math.floor(Math.random() * 500) + 50;

    let postsHtml = '';
    if (posts && posts.length > 0) {
        const isEdit = PeekDeleteManager.isEditMode && PeekDeleteManager.currentAppType === 'unlock';

        posts.forEach(post => {
            if (!post.id) post.id = 'post_old_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
            const isSelected = isEdit && PeekDeleteManager.selectedIds.has(post.id);
            const randomComments = Math.floor(Math.random() * 100);
            const randomLikes = Math.floor(Math.random() * 500);
            postsHtml += `
                <div class="unlock-post-card ${isEdit ? 'is-selecting' : ''} ${isSelected ? 'selected' : ''}" data-id="${post.id}" style="position:relative;">
                    ${post.isNew ? '<span class="new-badge" style="position:absolute; top:16px; right:16px;">new!</span>' : ''}
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

    screen.querySelector('#refresh-unlock-btn').addEventListener('click', () => generateAndRenderPeekUnlock({ forceRefresh: true }));

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

    const { url, key, model } = db.apiSettings;
    if (!url || !key || !model) { showToast('请先配置 API！'); return switchScreen('api-settings-screen'); }

    generatingPeekApps.add(appType);
    switchScreen('peek-unlock-screen');
    const hideLoading = showLoadingToast('正在生成神秘小号记录...');

    try {
        const peekSettings = char.peekScreenSettings || {};
        const limitCount = (peekSettings.contextLimit !== undefined) ? peekSettings.contextLimit : 50;
        const mainChatContext = limitCount > 0 ? char.history.slice(-limitCount).map(m => m.content).join('\n') : "";

        const senderName = char.realName || char.name;
        const baseContextPrompt = getPeekBasePromptContext(char, mainChatContext);

        let systemPrompt = `你正在模拟角色 ${char.realName} 的社交媒体（类似微博/X）私密小号。\n`;
        systemPrompt += baseContextPrompt;
        systemPrompt += `
【任务1：小号内容记录】
请为 ${char.realName} 生成一个符合其人设的私密小号。内容要生活化、碎片化，符合小号的风格，并与Ta的人设和最近聊天上下文高度相关。
你需要生成以下信息：
#NICKNAME#: 小号的昵称
#HANDLE#: @开头的ID
#BIO#: 个性签名
接下来，使用 #POST# 标签生成3-4条最近的帖子内容。每条 #POST# 的第一行用方括号包含生成时间（例如[2小时前]），下方是正文（140字以内）。

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
[1小时前]
第一条正文内容
#POST#[昨天]
第二条正文内容
===PROACTIVE_MESSAGES===
#SECRET_CHAT_NIGHT_85%#[23:15|${senderName}的消息:你睡了吗？][23:16|${senderName}的消息:感觉有点丧，不知道该跟谁说...]
`;

        const requestBody = { model: model, messages: [{ role: 'user', content: systemPrompt }], temperature: 0.85 };
        const response = await fetch(`${url}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) throw new Error(`API error: ${response.status}`);
        const result = await response.json();
        const contentStr = result.choices[0].message.content.trim();

        const parts = contentStr.split(/===PROACTIVE_MESSAGES===/i);
        const unlockRawText = parts[0] || '';
        const hitchhikerRawText = parts.length > 1 ? parts[1] : '';

        const nickMatch = unlockRawText.match(/#NICKNAME#\s*([\s\S]*?)(?=#HANDLE#|$)/i);
        const handleMatch = unlockRawText.match(/#HANDLE#\s*([\s\S]*?)(?=#BIO#|$)/i);
        const bioMatch = unlockRawText.match(/#BIO#\s*([\s\S]*?)(?=#POST#|$)/i);

        const postSplits = unlockRawText.split(/#POST#/i).slice(1);
        const parsedPosts = [];

        postSplits.forEach(postStr => {
            const postMatch = postStr.match(/^\s*\[([^\]]+)\]\s*([\s\S]*)$/);
            if (postMatch) {
                parsedPosts.push({
                    id: `post_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                    timestamp: postMatch[1].trim(),
                    content: postMatch[2].trim(),
                    isNew: true
                });
            }
        });

        if (nickMatch && parsedPosts.length > 0) {
            if (!peekContentCache['unlock']) {
                peekContentCache['unlock'] = { nickname: '', handle: '', bio: '', posts: [] };
            }

            peekContentCache['unlock'].nickname = nickMatch[1].trim();
            peekContentCache['unlock'].handle = handleMatch ? handleMatch[1].trim() : '@unknown';
            peekContentCache['unlock'].bio = bioMatch ? bioMatch[1].trim() : '...';
            peekContentCache['unlock'].posts = [...parsedPosts, ...peekContentCache['unlock'].posts];

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
            const screen = document.getElementById('peek-unlock-screen');
            if (screen) {
                screen.innerHTML = `<header class="app-header"><button class="back-btn" data-target="peek-screen">‹</button><div class="title-container"><h1 class="title">错误</h1></div></header><main class="content"><p class="placeholder-text" style="color:#ff4d4f;">内容生成失败，请重试。<br><span style="font-size:12px;">${error.message}</span></p></main>`;
            }
        }
    } finally {
        generatingPeekApps.delete(appType);
        hideLoading();
    }
}
