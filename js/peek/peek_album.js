// ==========================================
// peek_album.js
// 相册渲染、相册生成
// ==========================================

function renderPeekAlbum(photos) {
    const screen = document.getElementById('peek-album-screen');
    const grid = screen.querySelector('.album-grid');
    grid.innerHTML = '';

    if (!photos || photos.length === 0) {
        grid.innerHTML = '<p class="placeholder-text">正在生成相册内容...</p>';
        return;
    }

    const isEdit = PeekDeleteManager.isEditMode && PeekDeleteManager.currentAppType === 'album';

    photos.forEach(photo => {
        if (!photo.id) photo.id = 'album_old_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        const isSelected = isEdit && PeekDeleteManager.selectedIds.has(photo.id);
        const photoEl = document.createElement('div');
        photoEl.className = `album-photo ${isEdit ? 'is-selecting' : ''} ${isSelected ? 'selected' : ''}`;
        photoEl.dataset.id = photo.id;
        photoEl.dataset.imageDescription = photo.imageDescription;
        photoEl.dataset.description = photo.description;

        const img = document.createElement('img');
        img.src = 'https://i.postimg.cc/1tH6ds9g/1752301200490.jpg';
        img.alt = "相册照片";
        photoEl.appendChild(img);

        if (photo.type === 'video') {
            const videoIndicator = document.createElement('div');
            videoIndicator.className = 'video-indicator';
            videoIndicator.innerHTML = `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"></path></svg>`;
            photoEl.appendChild(videoIndicator);
        }

        if (photo.isNew) {
            const badge = document.createElement('span');
            badge.className = 'new-badge';
            badge.textContent = 'new!';
            badge.style.position = 'absolute';
            badge.style.top = '5px';
            badge.style.right = '5px';
            badge.style.zIndex = '10';
            badge.style.backgroundColor = 'rgba(255, 255, 255, 0.8)';
            badge.style.borderRadius = '4px';
            photoEl.appendChild(badge);
        }

        photoEl.addEventListener('click', () => {
            if (PeekDeleteManager.isEditMode) return;
            if (photo.isNew) {
                photo.isNew = false;
                savePeekData(window.activePeekCharId);
                const badge = photoEl.querySelector('.new-badge');
                if (badge) badge.remove();
            }
            const modal = document.getElementById('peek-photo-modal');
            const imgContainer = document.getElementById('peek-photo-image-container');
            const descriptionEl = document.getElementById('peek-photo-description');
            imgContainer.innerHTML = `<div style="padding: 20px; text-align: left; color: #555; font-size: 16px; line-height: 1.6; height: 100%; overflow-y: auto;">${photo.imageDescription}</div>`;
            descriptionEl.textContent = `批注：${photo.description}`;
            modal.classList.add('visible');
        });

        grid.appendChild(photoEl);
    });
}

async function generateAndRenderPeekAlbum(options = {}) {
    const appType = 'album';
    const { forceRefresh = false } = options;

    if (generatingPeekApps.has(appType)) { showToast('相册内容正在生成中，请稍候...'); return; }

    if (!forceRefresh && peekContentCache[appType]) {
        renderPeekAlbum(peekContentCache[appType].photos);
        switchScreen('peek-album-screen');
        return;
    }

    const char = db.characters.find(c => c.id === window.activePeekCharId);
    if (!char) return showToast('无法找到当前角色');

    const { url, key, model } = db.apiSettings;
    if (!url || !key || !model) { showToast('请先配置 API！'); return switchScreen('api-settings-screen'); }

    generatingPeekApps.add(appType);
    switchScreen('peek-album-screen');
    const hideLoading = showLoadingToast('正在读取相册数据...');

    try {
        const peekSettings = char.peekScreenSettings || {};
        const limitCount = (peekSettings.contextLimit !== undefined) ? peekSettings.contextLimit : 50;
        const mainChatContext = limitCount > 0 ? char.history.slice(-limitCount).map(m => m.content).join('\n') : "";

        const senderName = char.realName || char.name;
        const baseContextPrompt = getPeekBasePromptContext(char, mainChatContext);

        let systemPrompt = `你正在模拟角色 ${char.realName} 的手机相册。\n`;
        systemPrompt += baseContextPrompt;
        systemPrompt += `
【任务1：相册数据】
请为 ${char.realName} 的手机相册生成5-8个Ta拍摄的照片或视频。内容需要与Ta的人设和最近聊天上下文内容高度相关。'IMAGE_DESC' 是对这张照片/视频的详细文字描述，它将代替真实的图片展示给用户。'ANNOTATION' 是 ${char.realName} 自己对这张照片/视频的批注，会显示在描述下方。

【任务2：话题分享】
在相册内容生成完毕后，请从你刚刚生成的相册内容中挑选1个你认为最适合分享给${char.myName}的条目。
预测一下，在未来的某个时间，${senderName}会主动把这张照片/视频发给${char.myName}，并开启话题。
`;
        systemPrompt += getPeekProactiveFormatPrompt(char);
        systemPrompt += `
请严格按照以下标签文本格式输出，**相册条目之间使用 ===SEP=== 分隔**。在相册结束后，使用 ===PROACTIVE_MESSAGES=== 分割，再输出主动消息。

输出格式示例：
#TYPE#
photo
#IMAGE_DESC#
一张傍晚在海边的自拍，背景是橙色的晚霞和归来的渔船。
#ANNOTATION#
那天的风很舒服。
===SEP===
#TYPE#
video
#IMAGE_DESC#
一段在猫咖撸猫的视频，视频里有一只橘猫在打哈欠。
#ANNOTATION#
下次还来这里！
===PROACTIVE_MESSAGES===
#SECRET_CHAT_AFTERNOON_85%#[15:15|${senderName}发来的照片/视频:详细描述][15:16|${senderName}的消息:翻相册看到这张，觉得挺好看的，发给你看看。]
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
        const albumRawText = parts[0] || '';
        const hitchhikerRawText = parts.length > 1 ? parts[1] : '';

        const rawPhotos = albumRawText.split('===SEP===');
        const parsedPhotos = [];

        rawPhotos.forEach(rawText => {
            if (!rawText.trim()) return;
            const typeMatch = rawText.match(/#TYPE#\s*([\s\S]*?)(?=#IMAGE_DESC#|$)/);
            const descMatch = rawText.match(/#IMAGE_DESC#\s*([\s\S]*?)(?=#ANNOTATION#|$)/);
            const annoMatch = rawText.match(/#ANNOTATION#\s*([\s\S]*?)(?=(?:===SEP===|$))/);

            if (typeMatch && descMatch) {
                parsedPhotos.push({
                    id: `album_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                    type: typeMatch[1].trim() === 'video' ? 'video' : 'photo',
                    imageDescription: descMatch[1].trim(),
                    description: annoMatch ? annoMatch[1].trim() : '无批注',
                    isNew: true
                });
            }
        });

        if (parsedPhotos.length > 0) {
            if (!peekContentCache['album']) peekContentCache['album'] = { photos: [] };
            peekContentCache['album'].photos = [...parsedPhotos, ...peekContentCache['album'].photos];
            savePeekData(char.id).catch(e => console.error("Peek自动保存失败:", e));
            renderPeekAlbum(peekContentCache['album'].photos);
        } else {
            throw new Error("解析相册内容失败，未找到对应标签。");
        }

        if (hitchhikerRawText.trim()) {
            parseAndSavePeekProactiveHitchhiker(char, hitchhikerRawText);
            saveSingleChat(char.id, 'private').catch(e => console.error(e));
        }

    } catch (error) {
        console.error(error);
        showApiError(error);
        if (peekContentCache['album']?.photos?.length > 0) {
            renderPeekAlbum(peekContentCache['album'].photos);
            if (typeof showToast === 'function') showToast('刷新失败: ' + error.message);
        } else {
            document.querySelector('#peek-album-screen .album-grid').innerHTML = `<p class="placeholder-text">内容生成失败，请重试。<br><span style="font-size:12px;color:#999;">${error.message}</span></p>`;
        }
    } finally {
        generatingPeekApps.delete(appType);
        hideLoading();
    }
}
