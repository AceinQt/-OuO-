// ==========================================
// chat_bubble_factory.js - 专门负责生成聊天气泡的 DOM 元素
// ==========================================

function createMessageBubbleElement(message) {
    const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
    const { role, content, timestamp, id, transferStatus, giftStatus, stickerData, senderId, quote, isWithdrawn, originalContent } = message;


    // ==========================================
    // 【新增：时间分割线拦截】放在最前面！
    // ==========================================
    if (content === '[time-divider]') {
        const dividerWrapper = document.createElement('div');
        // 依然保留 message-wrapper，保证不会破坏原本基于这个 class 的多选/长按等功能
        dividerWrapper.className = 'message-wrapper time-divider-wrapper'; 
        dividerWrapper.dataset.id = id;
        
        // 利用 formatSmartTime 动态算出要显示的文本（比如：昨天 12:01）
        // formatSmartTime 函数写在 chat_room.js 里即可
        let timeText = '';
        if (typeof formatSmartTime === 'function') {
            timeText = formatSmartTime(timestamp);
        } else {
            // 兜底：如果忘了加 formatSmartTime 函数，就显示普通的时:分
            const d = new Date(timestamp);
            timeText = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
        }

        dividerWrapper.innerHTML = `<div class="chat-time-divider">${timeText}</div>`;
        return dividerWrapper; // 提前结束，不渲染头像和气泡
    }
    // --- 渲染旁白气泡 (支持 Markdown) ---
    const narrationRegex = /\[system-narration:([\s\S]+?)\]/;
    const narrationMatch = content.match(narrationRegex);

    if (narrationMatch) {
        let text = narrationMatch[1].trim();
        text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');

        const wrapper = document.createElement('div');
        wrapper.dataset.id = id;
        wrapper.className = 'message-wrapper system-notification narration-wrapper';

        const bubble = document.createElement('div');
        bubble.className = 'narration-bubble markdown-content';

        const htmlContent = marked.parse(text, { breaks: true });
        bubble.innerHTML = DOMPurify.sanitize(htmlContent);

        wrapper.appendChild(bubble);

        return wrapper;
    }

    // --- 双语模式判断逻辑 ---
    const isBilingualMode = chat.bilingualModeEnabled;
    let bilingualMatch = null;
    if (isBilingualMode && role === 'assistant') {
        const contentMatch = content.match(/^\[.*?的消息：([\s\S]+)\]$/);
        if (contentMatch) {
            const mainText = contentMatch[1].trim();
            const lastCloseParen = Math.max(mainText.lastIndexOf(')'), mainText.lastIndexOf('）'));
            if (lastCloseParen > -1) {
                const lastOpenParen = Math.max(
                    mainText.lastIndexOf('(', lastCloseParen),
                    mainText.lastIndexOf('（', lastCloseParen)
                );
                if (lastOpenParen > -1) {
                    const chineseText = mainText.substring(lastOpenParen + 1, lastCloseParen).trim();
                    const foreignText = mainText.substring(0, lastOpenParen).trim();
                    if (foreignText && chineseText) {
                        bilingualMatch = [null, foreignText, chineseText];
                    }
                }
            }
        }
    }

    if (bilingualMatch) {
        const foreignText = bilingualMatch[1].trim();
        const chineseText = bilingualMatch[2].trim();
        const wrapper = document.createElement('div');
        wrapper.dataset.id = id;
        wrapper.className = 'message-wrapper received';

        const bubbleRow = document.createElement('div');
        bubbleRow.className = 'message-bubble-row';

        const avatarUrl = chat.avatar;
        const timeString = `${pad(new Date(timestamp).getHours())}:${pad(new Date(timestamp).getMinutes())}`;

        const bubbleElement = document.createElement('div');
        bubbleElement.className = 'message-bubble received bilingual-bubble';
        bubbleElement.innerHTML = `<span>${DOMPurify.sanitize(foreignText)}</span>`;

        const themeKey = chat.theme || 'white_blue';
        const theme = colorThemes[themeKey] || colorThemes['white_blue'];
        const bubbleTheme = theme.received;
        bubbleElement.style.backgroundColor = bubbleTheme.bg;
        bubbleElement.style.color = bubbleTheme.text;

        const translationDiv = document.createElement('div');
        translationDiv.className = 'translation-text';
        translationDiv.textContent = chineseText;

        bubbleRow.innerHTML = `<div class="message-info"><img src="${avatarUrl}" class="message-avatar"><span class="message-time">${timeString}</span></div>`;
        bubbleRow.appendChild(bubbleElement);
        wrapper.appendChild(bubbleRow);
        wrapper.appendChild(translationDiv);
        return wrapper;
    }

    // --- 普通消息逻辑 ---
    const wrapper = document.createElement('div');
    wrapper.dataset.id = id;

    // 1. 【优先判断】如果是撤回状态
    if (isWithdrawn) {
        wrapper.className = 'message-wrapper system-notification';
        const withdrawnText = (role === 'user') ? '你撤回了一条消息' : `${chat.remarkName || chat.name}撤回了一条消息`;

        let contentToShow = '';
        if (originalContent) {
            contentToShow = originalContent;
        } else {
            const match = content.match(/Original: ([\s\S]+?)\]/);
            contentToShow = match ? match[1] : content;
        }
        contentToShow = contentToShow.replace(/\[.*?的消息：([\s\S]+?)\]/, '$1');

        wrapper.innerHTML = `<div><span class="withdrawn-message">${withdrawnText}</span></div><div class="withdrawn-content">${DOMPurify.sanitize(contentToShow)}</div>`;

        const withdrawnMessageSpan = wrapper.querySelector('.withdrawn-message');
        if (withdrawnMessageSpan) {
            withdrawnMessageSpan.addEventListener('click', () => {
                const withdrawnContent = wrapper.querySelector('.withdrawn-content');
                if (withdrawnContent && withdrawnContent.textContent.trim()) {
                    withdrawnContent.classList.toggle('active');
                }
            });
        }
        return wrapper;
    }

    // 2. 【之后判断】不可见消息正则
    const invisibleRegex = /\[.*?(?:接收|退回).*?的转账\]|\[.*?更新状态为：.*?\]|\[.*?已接收礼物\]|\[system:[\s\S]*?\]|\[系统情景通知：.*?\]/;
    if (invisibleRegex.test(content)) {
        return null;
    }

    // 3. 处理其他可见的系统通知
    const timeSkipRegex = /\[system-display:([\s\S]+?)\]/;
    const inviteRegex = /\[(.*?)邀请(.*?)加入了群聊\]/;
    const removeRegex = /\[(.*?)将(.*?)移出了群聊\]/;
    const renameRegex = /\[(.*?)修改群名为：(.*?)\]/;
    const memberRenameRegex = /\[(.*?)修改(.*?)的群昵称为：(.*?)\]/;
    const selfRenameRegex = /\[(.*?)将自己的群昵称修改为：(.*?)\]/;
    const timeSkipMatch = content.match(timeSkipRegex);
    const inviteMatch = content.match(inviteRegex);
    const removeMatch = content.match(removeRegex);
    const renameMatch = content.match(renameRegex);
    const memberRenameMatch = content.match(memberRenameRegex);
    const selfRenameMatch = content.match(selfRenameRegex);

    if (timeSkipMatch || inviteMatch || removeMatch || renameMatch || memberRenameMatch || selfRenameMatch) {
        wrapper.className = 'message-wrapper system-notification';
        let bubbleText = '';
        if (timeSkipMatch) bubbleText = timeSkipMatch[1];
        if (inviteMatch) bubbleText = `${inviteMatch[1]}邀请${inviteMatch[2]}加入了群聊`;
        if (removeMatch) bubbleText = `${removeMatch[1]}将${removeMatch[2]}移出了群聊`;
        if (renameMatch) bubbleText = `${renameMatch[1]}修改群名为"${renameMatch[2]}"`;
        if (memberRenameMatch) bubbleText = `${memberRenameMatch[1]}将${memberRenameMatch[2]}的群昵称修改为"${memberRenameMatch[3]}"`;
        if (selfRenameMatch) bubbleText = `${selfRenameMatch[1]}将自己的群昵称修改为"${selfRenameMatch[2]}"`;
        wrapper.innerHTML = `<div class="system-notification-bubble">${bubbleText}</div>`;
        return wrapper;
    }

    const isSent = (role === 'user');
    let avatarUrl, bubbleTheme, senderNickname = '';
    const themeKey = chat.theme || 'white_blue';
    const theme = colorThemes[themeKey] || colorThemes['white_blue'];
    let messageSenderId = isSent ? 'user_me' : senderId;

    if (isSent) {
        avatarUrl = (currentChatType === 'private') ? chat.myAvatar : chat.me.avatar;
        bubbleTheme = theme.sent;
    } else {
        if (currentChatType === 'private') {
            avatarUrl = chat.avatar;
        } else {
            const sender = findGroupMemberById(chat, senderId);
            if (sender) {
                avatarUrl = sender.avatar;
                senderNickname = sender.groupNickname;
            } else {
                avatarUrl = 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg';
            }
        }
        bubbleTheme = theme.received;
    }

    const timeString = `${pad(new Date(timestamp).getHours())}:${pad(new Date(timestamp).getMinutes())}`;
    wrapper.className = `message-wrapper ${isSent ? 'sent' : 'received'}`;

    if (currentChatType === 'group' && !isSent) {
        wrapper.classList.add('group-message');
    }

    const bubbleRow = document.createElement('div');
    bubbleRow.className = 'message-bubble-row';
    let bubbleElement;

    const urlRegex = /^(https?:\/\/[^\s]+\.(?:jpg|jpeg|png|gif|webp|bmp|svg)|data:image\/[a-z]+;base64,)/i;
    
    // 兼容全角和半角冒号，兼容前后空格
    const unifiedStickerRegex = /\[(.*?)的表情包[:：]\s*(.*?)\]/;
    const legacyReceivedStickerRegex = /\[(?:.+?)发送的表情包[:：]\s*([\s\S]+?)\]/i;
    // ★ 语音正则统一取 js/chat/chat_voice_service.js 里那一份 ——
    //   这里原先另写了一份，两处各写必然漂移：改了一处忘了另一处，就会出现
    //   "气泡画成语音条但合成层不认"或者反过来的鬼故事。
    //   service 万一没加载上就退回内联的同一个模式，不让气泡直接崩。
    const voiceRegex = typeof VOICE_MESSAGE_REGEX !== 'undefined'
        ? VOICE_MESSAGE_REGEX
        : /\[(?:.+?)的语音[:：]\s*([\s\S]+?)\]/;
    const photoVideoRegex = /\[(?:.+?)发来的照片\/视频[:：]\s*([\s\S]+?)\]/;
    
    // 转账超级宽容版：允许中英文分号、逗号；允许只写金额不写备注；兼容各种乱加空格
    const privateSentTransferRegex = /\[.*?给你转账[:：]\s*([\d.]+)\s*元(?:[;；,，\s]*(?:备注[:：])?\s*(.*?))?\]/;
    const privateReceivedTransferRegex = /\[.*?的转账[:：]\s*([\d.]+)\s*元(?:[;；,，\s]*(?:备注[:：])?\s*(.*?))?\]/;
    const groupTransferRegex = /\[(.*?)\s*向\s*(.*?)\s*转账[:：]\s*([\d.]+)\s*元(?:[;；,，\s]*(?:备注[:：])?\s*(.*?))?\]/;
    
    const privateGiftRegex = /\[(?:.+?)送来的礼物[:：]\s*([\s\S]+?)\]/;
    const groupGiftRegex = /\[(.*?)\s*向\s*(.*?)\s*送来了礼物[:：]\s*([\s\S]+?)\]/;
    const imageRecogRegex = /\[.*?发来了一张图片[:：]\]/;
    const textRegex = /\[(?:.+?)的消息[:：]\s*([\s\S]+?)\]/;
    // 位置：先整体抓 body，再在分支里按「；地址：」拆成地点名 + 详细地址（地址选填）
    // 发送者名里禁冒号，免得正文提到「发送了位置：」的普通消息被这条抢走（本分支在 textRegex 之前）
    const locationRegex = /\[(?:[^\[\]：:]+?)发送了位置[:：]\s*([\s\S]+?)\]/;
    const pomodoroRecordRegex = /\[专注记录\]\s*任务：([\s\S]+?)，时长：([\s\S]+?)，期间与 .*? 互动 (\d+)\s*次。/;

    const pomodoroMatch = content.match(pomodoroRecordRegex);
    const unifiedStickerMatch = content.match(unifiedStickerRegex);
    const legacyReceivedStickerMatch = content.match(legacyReceivedStickerRegex);
    const voiceMatch = content.match(voiceRegex);
    const photoVideoMatch = content.match(photoVideoRegex);
    const privateSentTransferMatch = content.match(privateSentTransferRegex);
    const privateReceivedTransferMatch = content.match(privateReceivedTransferRegex);
    const groupTransferMatch = content.match(groupTransferRegex);
    const privateGiftMatch = content.match(privateGiftRegex);
    const groupGiftMatch = content.match(groupGiftRegex);
    const imageRecogMatch = content.match(imageRecogRegex);
    const textMatch = content.match(textRegex);
    const locationMatch = content.match(locationRegex);

    if (pomodoroMatch) {
        const taskName = pomodoroMatch[1];
        const duration = pomodoroMatch[2];
        const pokeCount = pomodoroMatch[3];
        bubbleElement = document.createElement('div');
        bubbleElement.className = 'pomodoro-record-card';
        bubbleElement.innerHTML = `<img src="https://i.postimg.cc/sgdS9khZ/chan-122.png" class="pomodoro-record-icon" alt="pomodoro complete"><div class="pomodoro-record-body"><p class="task-name">${taskName}</p></div>`;
        const detailsDiv = document.createElement('div');
        detailsDiv.className = 'pomodoro-record-details';
        detailsDiv.innerHTML = `<p><strong>任务名称:</strong> ${taskName}</p><p><strong>专注时长:</strong> ${duration}</p><p><strong>"戳一戳"次数:</strong> ${pokeCount}</p>`;
        wrapper.appendChild(detailsDiv);
        bubbleElement.addEventListener('click', () => {
            detailsDiv.classList.toggle('active');
        });
    } else if (unifiedStickerMatch || legacyReceivedStickerMatch) {
        let stickerSrc = '';
        let stickerName = '未知表情';

        if (legacyReceivedStickerMatch && !isSent) {
            stickerSrc = legacyReceivedStickerMatch[1].trim();
            if (!stickerSrc.startsWith('http')) stickerSrc = 'https://i.postimg.cc/' + stickerSrc.split('/').pop();
        } else if (unifiedStickerMatch) {
            stickerName = unifiedStickerMatch[2].trim();
            const s = db.myStickers.find(x => x.name === stickerName);
            if (s) {
                stickerSrc = s.data;
            } else if (isSent && stickerData) {
                stickerSrc = stickerData;
            }
        }

        bubbleElement = document.createElement('div');
        if (stickerSrc) {
            bubbleElement.className = 'sticker-bubble';
            bubbleElement.innerHTML = `<img src="${stickerSrc}" alt="${stickerName}" style="min-width: 100px; min-height: 100px; aspect-ratio: 1/1; object-fit: contain;">`;
        } else {
            bubbleElement.className = `message-bubble ${isSent ? 'sent' : 'received'}`;
            bubbleElement.style.backgroundColor = bubbleTheme.bg;
            bubbleElement.style.color = bubbleTheme.text;
            bubbleElement.innerHTML = `[表情包：${stickerName}]`;
        }
    } else if (privateGiftMatch || groupGiftMatch) {
        const match = privateGiftMatch || groupGiftMatch;
        bubbleElement = document.createElement('div');
        bubbleElement.className = 'gift-card';
        if (giftStatus === 'received') {
            bubbleElement.classList.add('received');
        }
        let giftText;
        if (groupGiftMatch) {
            const from = groupGiftMatch[1];
            const to = groupGiftMatch[2];
            giftText = isSent ? `你送给 ${to} 的礼物` : `${from} 送给 ${to} 的礼物`;
        } else {
            giftText = isSent ? '您有一份礼物～' : '您有一份礼物～';
        }
        bubbleElement.innerHTML = `<img src="https://i.postimg.cc/rp0Yg31K/chan-75.png" alt="gift" class="gift-card-icon"><div class="gift-card-text">${giftText}</div><div class="gift-card-received-stamp">已查收</div>`;
        const description = groupGiftMatch ? groupGiftMatch[3].trim() : match[1].trim();
        const descriptionDiv = document.createElement('div');
        descriptionDiv.className = 'gift-card-description';
        descriptionDiv.textContent = description;
        wrapper.appendChild(descriptionDiv);
    } else if (content.startsWith('[喵坛分享]')) {
        const forumShareRegex = /\[喵坛分享\]标题：([\s\S]+?)\n内容：([\s\S]+)/;
        const forumShareMatch = content.match(forumShareRegex);

        if (forumShareMatch) {
            const title = forumShareMatch[1].trim();
            const fullContent = forumShareMatch[2].trim();
            let displaySummary = fullContent.substring(0, 50);
            if (fullContent.length > 50) {
                displaySummary += '...';
            }

            bubbleElement = document.createElement('div');
            bubbleElement.className = 'forum-share-card';
            bubbleElement.innerHTML = `
                <div class="forum-share-header">
                    <svg viewBox="0 0 24 24"><path d="M21,3H3A2,2 0 0,0 1,5V19A2,2 0 0,0 3,21H21A2,2 0 0,0 23,19V5A2,2 0 0,0 21,3M21,19H3V5H21V19M8,11H16V9H8V11M8,15H13V13H8V15Z" /></svg>
                    <span>来自喵坛的分享</span>
                </div>
                <div class="forum-share-content">
                    <div class="forum-share-title">${title}</div>
                    <div class="forum-share-summary">${displaySummary}</div>
                </div>`;
        }
    } else if (voiceMatch) {
        const voiceText = voiceMatch[1].trim();
        bubbleElement = document.createElement('div');
        bubbleElement.className = 'voice-bubble';
        bubbleElement.style.backgroundColor = bubbleTheme.bg;
        bubbleElement.style.color = bubbleTheme.text;

        // 合成前只能按字数估个占位（实测同字数时长能差一倍），
        // 真的播过一次之后播放器会用 original_duration 替掉它
        let duration = "0";
        if (typeof calculateVoiceDuration === 'function') {
            duration = calculateVoiceDuration(voiceText);
        }

        // 播放器要靠这几个 data 属性找回原文和归属，别删
        bubbleElement.dataset.voiceRaw = content || '';
        bubbleElement.dataset.voiceMsgId = id || '';
        bubbleElement.dataset.voiceChatId = currentChatId || '';
        bubbleElement.dataset.voiceState = 'idle';

        // ★ 播放键是真的 <button>：能聚焦、能键盘触发、有 aria-label。
        //   原先只是个静态三角 SVG，点整个气泡才有反应。
        //   波形改用 CSS 竖条 —— 原来那个 SVG 有两条 path 写错了（H6 应为 H15/H3），
        //   实际只画得出两条竖线。竖条同时兼任播放进度条。
        bubbleElement.innerHTML =
            `<button type="button" class="voice-play-btn" data-voice-state="idle"`
            + ` aria-label="播放语音（首次需要合成，约 20 秒）">`
            + `<svg class="vp-icon-play" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>`
            + `<svg class="vp-icon-stop" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1.5"/></svg>`
            + `<svg class="vp-icon-fail" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 7v6"/><path d="M12 16.5v.5"/></svg>`
            + `<span class="vp-spinner" aria-hidden="true"></span>`
            + `</button>`
            + `<span class="voice-wave" aria-hidden="true">`
            + '<i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i>'
            + `</span>`
            + `<span class="duration">${duration}"</span>`;

        const transcriptDiv = document.createElement('div');
        transcriptDiv.className = 'voice-transcript';
        transcriptDiv.textContent = voiceText;
        wrapper.appendChild(transcriptDiv);

        // ★ 已有音频的话把按钮标成"可播"。放在这里而不是各个渲染入口 ——
        //   createMessageBubbleElement 有 7 个调用点，逐个接必然漏一两个。
        //   不 await：只查缓存不发请求，慢一点也不该拖住气泡创建。
        if (typeof refreshVoiceBubbleState === 'function') {
            refreshVoiceBubbleState(bubbleElement, chat, currentChatType, senderId)
                .catch(() => {});
        }
    } else if (photoVideoMatch) {
        bubbleElement = document.createElement('div');
        bubbleElement.className = 'pv-card';
        const hasImageMedia = typeof isImageMediaMessage === 'function'
            ? isImageMediaMessage(message)
            : !!(message && message.media && message.media.kind === 'image');

        const description = document.createElement('div');
        description.className = 'pv-card-content';
        description.textContent = photoVideoMatch[1].trim();

        const overlay = document.createElement('div');
        overlay.className = 'pv-card-image-overlay';
        overlay.style.backgroundImage = `url("${isSent ? 'https://i.postimg.cc/L8NFrBrW/1752307494497.jpg' : 'https://i.postimg.cc/1tH6ds9g/1752301200490.jpg'}")`;

        const footer = document.createElement('div');
        footer.className = 'pv-card-footer';
        const coverIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        coverIcon.setAttribute('viewBox', '0 0 24 24');
        coverIcon.setAttribute('aria-hidden', 'true');
        const coverPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        coverPath.setAttribute('d', 'M4,4H20A2,2 0 0,1 22,6V18A2,2 0 0,1 20,20H4A2,2 0 0,1 2,18V6A2,2 0 0,1 4,4M4,6V18H20V6H4M10,9A1,1 0 0,1 11,10A1,1 0 0,1 10,11A1,1 0 0,1 9,10A1,1 0 0,1 10,9M8,17L11,13L13,15L17,10L20,14V17H8Z');
        coverIcon.appendChild(coverPath);
        const media = hasImageMedia && typeof normalizeImageMedia === 'function'
            ? normalizeImageMedia(message.media)
            : (hasImageMedia ? message.media : null);
        const livePending = !!(media && media.state === 'pending'
            && typeof isImageGenerationPending === 'function'
            && isImageGenerationPending(message.id, typeof currentChatId !== 'undefined' ? currentChatId : ''));
        const footerText = document.createElement('span');
        footerText.textContent = !hasImageMedia
            ? '照片/视频・点击查看'
            : livePending
                ? '正在生成图片・点击查看描述'
                : media && media.state === 'pending'
                    ? '生成已中断・点击重试'
                : media && media.state === 'failed'
                    ? '生成失败・点击查看描述'
                    : '图片加载中・点击查看描述';
        footer.append(coverIcon, footerText);

        const generateButton = document.createElement('button');
        generateButton.type = 'button';
        generateButton.className = 'pv-card-generate';
        generateButton.title = media && (media.state === 'failed' || media.state === 'pending') ? '重试生成图片' : '生成图片';
        generateButton.setAttribute('aria-label', generateButton.title);
        generateButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3Z"/><path d="m19 14 .7 2.3L22 17l-2.3.7L19 20l-.7-2.3L16 17l2.3-.7L19 14Z"/></svg>';
        generateButton.hidden = hasImageMedia && (!media || livePending || media.state === 'ready');
        generateButton.addEventListener('click', async event => {
            event.preventDefault();
            event.stopPropagation();
            if (typeof generateImageForMessage !== 'function') {
                if (typeof showToast === 'function') showToast('图片生成功能尚未加载');
                return;
            }
            generateButton.disabled = true;
            try {
                await generateImageForMessage(message, {
                    chatId: typeof currentChatId !== 'undefined' ? currentChatId : '',
                    chatType: typeof currentChatType !== 'undefined' ? currentChatType : ''
                });
            } catch (error) {
                if (typeof showToast === 'function') showToast(error.message || '图片生成失败');
            } finally {
                generateButton.disabled = false;
            }
        });
        footer.appendChild(generateButton);

        if (hasImageMedia) {
            // 右上角放大按钮：真实图片加载成功后才出现，点击打开图片查看器
            const zoomButton = document.createElement('button');
            zoomButton.type = 'button';
            zoomButton.className = 'image-zoom-btn';
            zoomButton.title = '查看大图';
            zoomButton.setAttribute('aria-label', '查看大图');
            zoomButton.hidden = true;
            zoomButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>';
            zoomButton.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                const src = overlay.dataset.imageObjectUrl;
                if (src && typeof openImageViewer === 'function') openImageViewer(message, src);
            });
            bubbleElement.appendChild(zoomButton);
            bubbleElement.dataset.imageMedia = 'true';
            bubbleElement._imageGenerateButton = generateButton;
            bubbleElement._imageFooterText = footerText;
            bubbleElement._imageHydrationToken = Symbol('image-card');
            const token = bubbleElement._imageHydrationToken;
            Promise.resolve().then(async () => {
                try {
                    const result = await readImageMessageBytes(message);
                    if (bubbleElement._imageHydrationToken !== token) return;
                    if (bubbleElement.ownerDocument && bubbleElement.ownerDocument.body && !bubbleElement.ownerDocument.body.contains(bubbleElement)) return;
                    if (!result || !result.bytes) {
                        footerText.textContent = livePending
                            ? '正在生成图片・点击查看描述'
                            : media && media.state === 'pending'
                                ? '生成已中断・点击重试'
                            : media && media.state === 'failed'
                                ? '生成失败・点击查看描述'
                                : '图片暂不可用・点击查看描述';
                        generateButton.hidden = !!(livePending || media && media.source === 'uploaded');
                        bubbleElement.classList.add('pv-card-unavailable');
                        return;
                    }
                    const objectUrl = createImageObjectUrl(
                        result.bytes,
                        result.mime,
                        message.media && message.media.localCacheKey
                    );
                    if (!objectUrl) return;
                    overlay.style.backgroundImage = `url("${objectUrl}")`;
                    overlay.dataset.imageObjectUrl = objectUrl;
                    overlay.classList.remove('is-placeholder');
                    footerText.textContent = '照片/视频・点击查看';
                    generateButton.hidden = true;
                    zoomButton.hidden = false;
                    bubbleElement.classList.add('pv-card-real-image');
                    // 卡片默认是 1:1 占位；读到真实图片后按比例撑高，保证完整显示不裁剪
                    // （overlay 是 cover，容器比例等于图片比例时 cover 即完整铺满）
                    const probe = new Image();
                    probe.onload = () => {
                        if (bubbleElement._imageHydrationToken !== token) return;
                        if (probe.naturalWidth > 0 && probe.naturalHeight > 0) {
                            bubbleElement.style.aspectRatio = `${probe.naturalWidth} / ${probe.naturalHeight}`;
                        }
                    };
                    probe.src = objectUrl;
                } catch (error) {
                    footerText.textContent = error.code === 'image-repo-missing'
                        ? '图片仓库不可用・点击查看描述'
                        : '图片加载失败・点击查看描述';
                    generateButton.hidden = !!(media && media.source === 'uploaded');
                    bubbleElement.classList.add('pv-card-unavailable');
                }
            });
        }
        bubbleElement.append(description, overlay, footer);
    } else if (locationMatch) {
        const body = locationMatch[1].trim();
        const sepIndex = body.indexOf('；地址：');
        const locName = sepIndex === -1 ? body : body.slice(0, sepIndex).trim();
        const locAddress = sepIndex === -1 ? '' : body.slice(sepIndex + 4).trim();

        bubbleElement = document.createElement('div');
        bubbleElement.className = 'location-card';
        bubbleElement.innerHTML = `<div class="location-card-map"><svg class="location-card-pin" viewBox="0 0 24 24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 0 1 9.5 9 2.5 2.5 0 0 1 12 6.5 2.5 2.5 0 0 1 14.5 9a2.5 2.5 0 0 1-2.5 2.5z"/></svg></div><div class="location-card-info"><p class="location-card-name"></p>${locAddress ? '<p class="location-card-address"></p>' : ''}</div>`;
        bubbleElement.querySelector('.location-card-name').textContent = locName;
        if (locAddress) bubbleElement.querySelector('.location-card-address').textContent = locAddress;
    } else if (privateSentTransferMatch || privateReceivedTransferMatch || groupTransferMatch) {
        const isSentTransfer = !!privateSentTransferMatch || (groupTransferMatch && isSent);
        const match = privateSentTransferMatch || privateReceivedTransferMatch || groupTransferMatch;
        let amount, remarkText, titleText;
        if (groupTransferMatch) {
            const from = groupTransferMatch[1];
            const to = groupTransferMatch[2];
            amount = parseFloat(groupTransferMatch[3]).toFixed(2);
            remarkText = groupTransferMatch[4] || '';
            titleText = isSent ? `向 ${to} 转账` : `${from} 向你转账`;
        } else {
            amount = parseFloat(match[1]).toFixed(2);
            remarkText = match[2] || '';
            titleText = isSentTransfer ? '给你转账' : '转账';
        }
        bubbleElement = document.createElement('div');
        bubbleElement.className = `transfer-card ${isSentTransfer ? 'sent-transfer' : 'received-transfer'}`;
        let statusText = isSentTransfer ? '待查收' : '转账给你';
        if (groupTransferMatch && !isSent) statusText = '转账给Ta';
        if (transferStatus === 'received') {
            statusText = '已收款';
            bubbleElement.classList.add('received');
        } else if (transferStatus === 'returned') {
            statusText = '已退回';
            bubbleElement.classList.add('returned');
        }
        if ((transferStatus !== 'pending' && currentChatType === 'private') || currentChatType === 'group') {
            bubbleElement.style.cursor = 'default';
        }
        const remarkHTML = remarkText ? `<p class="transfer-remark">${remarkText}</p>` : '';
        bubbleElement.innerHTML = `<div class="overlay"></div><div class="transfer-content"><p class="transfer-title">${titleText}</p><p class="transfer-amount">¥${amount}</p>${remarkHTML}<p class="transfer-status">${statusText}</p></div>`;
    } else if (imageRecogMatch || urlRegex.test(content)) {
        bubbleElement = document.createElement('div');
        bubbleElement.className = 'image-bubble';
        const legacyImage = document.createElement('img');
        const imagePart = Array.isArray(message.parts) && message.parts.find(p => p && p.type === 'image' && p.data);
        legacyImage.src = imagePart ? imagePart.data : content;
        legacyImage.alt = '图片消息';
        bubbleElement.appendChild(legacyImage);
        // 右上角放大按钮：点击查看大图（下载挪进查看器弹窗里）
        const legacyZoom = document.createElement('button');
        legacyZoom.type = 'button';
        legacyZoom.className = 'image-zoom-btn';
        legacyZoom.title = '查看大图';
        legacyZoom.setAttribute('aria-label', '查看大图');
        legacyZoom.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>';
        legacyZoom.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            if (legacyImage.src && typeof openImageViewer === 'function') openImageViewer(message, legacyImage.src);
        });
        bubbleElement.appendChild(legacyZoom);

        // 右下角转文字按钮：和 pv-card 的生图按钮同一个位置，两种图片气泡的
        // "右下角动作键"就统一了。只有真的带 base64 的图片能转 —— 纯 URL 图片
        // 走的是同一个分支但没有 parts，convert 那边也拿不到数据。
        if (imagePart && typeof convertImageMessageToText === 'function') {
            const ocrButton = document.createElement('button');
            ocrButton.type = 'button';
            ocrButton.className = 'image-ocr-btn';
            ocrButton.title = '转文字';
            ocrButton.setAttribute('aria-label', '转文字');
            ocrButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 8V6a2 2 0 0 1 2-2h2"/><path d="M16 4h2a2 2 0 0 1 2 2v2"/><path d="M20 16v2a2 2 0 0 1-2 2h-2"/><path d="M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M9 9h6"/><path d="M12 9v6"/></svg>';
            ocrButton.addEventListener('click', event => {
                event.preventDefault();
                // 多选模式下不吞事件：交给 chat_room 的委托去勾选这条消息。
                // 转文字不可逆，误触的代价比"少一次转化"大得多。
                if (typeof isInMultiSelectMode !== 'undefined' && isInMultiSelectMode) return;
                event.stopPropagation();
                if (typeof isImageConverting === 'function' && isImageConverting(message.id)) {
                    if (typeof showToast === 'function') showToast('该图片正在转化中');
                    return;
                }
                convertImageMessageToText(message.id);
            });
            bubbleElement.appendChild(ocrButton);
        }
    } else if (textMatch) {
        bubbleElement = document.createElement('div');
        bubbleElement.className = `message-bubble ${isSent ? 'sent' : 'received'}`;
        let userText = textMatch[1].trim().replace(/\[发送时间:.*?\]/g, '').trim();
        bubbleElement.innerHTML = DOMPurify.sanitize(userText);
        bubbleElement.style.backgroundColor = bubbleTheme.bg;
        bubbleElement.style.color = bubbleTheme.text;
    } else if (message && Array.isArray(message.parts) && message.parts.length > 0 && message.parts[0].type === 'html') {
        bubbleElement = document.createElement('div');
        bubbleElement.className = `message-bubble ${isSent ? 'sent' : 'received'}`;
        bubbleElement.innerHTML = DOMPurify.sanitize(message.parts[0].text, { ADD_TAGS: ['style'], ADD_ATTR: ['style'] });
    } else {
        bubbleElement = document.createElement('div');
        bubbleElement.className = `message-bubble ${isSent ? 'sent' : 'received'}`;
        let displayedContent = content;
        const plainTextMatch = content.match(/^\[.*?：([\s\S]*)\]$/);
        if (plainTextMatch && plainTextMatch[1]) {
            displayedContent = plainTextMatch[1].trim();
        }
        displayedContent = displayedContent.replace(/\[发送时间:.*?\]/g, '').trim();
        bubbleElement.innerHTML = DOMPurify.sanitize(displayedContent);
        bubbleElement.style.backgroundColor = bubbleTheme.bg;
        bubbleElement.style.color = bubbleTheme.text;
    }

    // --- 组装结构 ---
    const avatarImg = document.createElement('img');
    avatarImg.src = avatarUrl;
    avatarImg.className = 'message-avatar';

    const contentCol = document.createElement('div');
    contentCol.className = 'message-content-col';

    const metaRow = document.createElement('div');
    metaRow.className = 'message-meta-info';

    if (currentChatType === 'group') {
        let displayName = '';
        let roleText = '';
        let roleClass = '';

        if (isSent) {
            displayName = chat.me.groupNickname || chat.me.nickname || chat.me.realName || '我';
            roleText = '群主';
            roleClass = 'owner';
        } else {
            displayName = senderNickname || '未知成员';
            roleText = '群成员';
            roleClass = 'member';
        }

        const roleBadge = document.createElement('span');
        roleBadge.className = `role-badge ${roleClass}`;
        roleBadge.textContent = roleText;
        metaRow.appendChild(roleBadge);

        const nameSpan = document.createElement('span');
        nameSpan.className = 'group-nickname';
        nameSpan.textContent = displayName;
        metaRow.appendChild(nameSpan);

        const timeSpan = document.createElement('span');
        timeSpan.className = 'message-time';
        timeSpan.textContent = timeString;
        metaRow.appendChild(timeSpan);

        contentCol.appendChild(metaRow);
    }

    if (bubbleElement) {
        if (quote) {
            let quotedSenderName = '';
            if (quote.senderId === 'user_me') {
                quotedSenderName = (currentChatType === 'private') ? chat.myNickname : chat.me.nickname;
            } else {
                if (currentChatType === 'private') {
                    quotedSenderName = chat.remarkName;
                } else {
                    const sender = findGroupMemberById(chat, quote.senderId);
                    quotedSenderName = sender ? sender.groupNickname : '未知成员';
                }
            }
            const quoteDiv = document.createElement('div');
            quoteDiv.className = 'quoted-message';
            const sanitizedQuotedText = DOMPurify.sanitize(quote.content, { ALLOWED_TAGS: [] });
            quoteDiv.innerHTML = `<span class="quoted-sender">${quotedSenderName}：</span><p class="quoted-text">${sanitizedQuotedText}</p>`;
            bubbleElement.prepend(quoteDiv);
        }
        contentCol.appendChild(bubbleElement);
    }

    // --- 最终组装 bubbleRow ---
    bubbleRow.innerHTML = '';
    bubbleRow.appendChild(avatarImg);
    bubbleRow.appendChild(contentCol);

    wrapper.prepend(bubbleRow);
    return wrapper;
}

// ==========================================
// 折叠通话气泡
// ==========================================
function createCollapsedCallBubble(sessionId, sessionMsgs, isSentByUser) {
    // 从消息内容提取通话类型和时长
    const endMsg = sessionMsgs.find(m =>
        m.content.includes('通话结束') || m.content.includes('通话中断'));
    const startMsg = sessionMsgs.find(m => m.content.includes('通话开始'));

    let callType = '语音通话';
    const typeMatch = (endMsg || startMsg)?.content.match(/视频通话|语音通话/);
    if (typeMatch) callType = typeMatch[0];

    let durationStr = '';
    if (endMsg) {
        const durMatch = endMsg.content.match(/·\s*([\d:]+)/);
        if (durMatch) durationStr = ' · ' + durMatch[1];
    }

    const iconSvg = callType === '视频通话' 
        ? `<svg viewBox="0 0 24 24" fill="none" width="18" height="18" xmlns="http://www.w3.org/2000/svg">
<path d="M16 10L18.5768 8.45392C19.3699 7.97803 19.7665 7.74009 20.0928 7.77051C20.3773 7.79703 20.6369 7.944 20.806 8.17433C21 8.43848 21 8.90095 21 9.8259V14.1741C21 15.099 21 15.5615 20.806 15.8257C20.6369 16.056 20.3773 16.203 20.0928 16.2295C19.7665 16.2599 19.3699 16.022 18.5768 15.5461L16 14M6.2 18H12.8C13.9201 18 14.4802 18 14.908 17.782C15.2843 17.5903 15.5903 17.2843 15.782 16.908C16 16.4802 16 15.9201 16 14.8V9.2C16 8.0799 16 7.51984 15.782 7.09202C15.5903 6.71569 15.2843 6.40973 14.908 6.21799C14.4802 6 13.9201 6 12.8 6H6.2C5.0799 6 4.51984 6 4.09202 6.21799C3.71569 6.40973 3.40973 6.71569 3.21799 7.09202C3 7.51984 3 8.07989 3 9.2V14.8C3 15.9201 3 16.4802 3.21799 16.908C3.40973 17.2843 3.71569 17.5903 4.09202 17.782C4.51984 18 5.07989 18 6.2 18Z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`
        : `<svg width="18px" height="18px"
     viewBox="-4 -4 32 32"
     fill="none"
     xmlns="http://www.w3.org/2000/svg">

  <g transform="rotate(135 12 12)">
    <path d="M21.97 18.33C21.97 18.69 21.89 19.06 21.72 19.42C21.55 19.78 21.33 20.12 21.04 20.44C20.55 20.98 20.01 21.37 19.4 21.62C18.8 21.87 18.15 22 17.45 22C16.43 22 15.34 21.76 14.19 21.27C13.04 20.78 11.89 20.12 10.75 19.29C9.6 18.45 8.51 17.52 7.47 16.49C6.44 15.45 5.51 14.36 4.68 13.22C3.86 12.08 3.2 10.94 2.72 9.81C2.24 8.67 2 7.58 2 6.54C2 5.86 2.12 5.21 2.36 4.61C2.6 4 2.98 3.44 3.51 2.94C4.15 2.31 4.85 2 5.59 2C5.87 2 6.15 2.06 6.4 2.18C6.66 2.3 6.89 2.48 7.07 2.74L9.39 6.01C9.57 6.26 9.7 6.49 9.79 6.71C9.88 6.92 9.93 7.13 9.93 7.32C9.93 7.56 9.86 7.8 9.72 8.03C9.59 8.26 9.4 8.5 9.16 8.74L8.4 9.53C8.29 9.64 8.24 9.77 8.24 9.93C8.24 10.01 8.25 10.08 8.27 10.16C8.3 10.24 8.33 10.3 8.35 10.36C8.53 10.69 8.84 11.12 9.28 11.64C9.73 12.16 10.21 12.69 10.73 13.22C11.27 13.75 11.79 14.24 12.32 14.69C12.84 15.13 13.27 15.43 13.61 15.61C13.66 15.63 13.72 15.66 13.79 15.69C13.87 15.72 13.95 15.73 14.04 15.73C14.21 15.73 14.34 15.67 14.45 15.56L15.21 14.81C15.46 14.56 15.7 14.37 15.93 14.25C16.16 14.11 16.39 14.04 16.64 14.04C16.83 14.04 17.03 14.08 17.25 14.17C17.47 14.26 17.7 14.39 17.95 14.56L21.26 16.91C21.52 17.09 21.7 17.3 21.81 17.55C21.91 17.8 21.97 18.05 21.97 18.33Z"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-miterlimit="10"/>
  </g>
</svg>`;
    const summaryText = `<span>${callType}${durationStr}</span>`;

    const chat = (currentChatType === 'private')
        ? db.characters.find(c => c.id === currentChatId) : null;

    const wrapper = document.createElement('div');
    wrapper.className = `message-wrapper ${isSentByUser ? 'sent' : 'received'} collapsed-call-bubble`;
    wrapper.dataset.callSessionId = sessionId;

    // --- bubble row (复用现有布局) ---
    const bubbleRow = document.createElement('div');
    bubbleRow.className = 'message-bubble-row';

    const avatarImg = document.createElement('img');
    avatarImg.src = isSentByUser ? (chat?.myAvatar || '') : (chat?.avatar || '');
    avatarImg.className = 'message-avatar';

    const themeKey = chat?.theme || 'white_blue';
    const theme = (typeof colorThemes !== 'undefined' && colorThemes[themeKey]) || {};
    const bubbleTheme = isSentByUser ? (theme.sent || {}) : (theme.received || {});

    const contentCol = document.createElement('div');
    contentCol.className = 'message-content-col';

    const bubble = document.createElement('div');
    bubble.className = `message-bubble ${isSentByUser ? 'sent' : 'received'} call-summary-bubble`;
    bubble.innerHTML = `${iconSvg}${summaryText}`;
    if (bubbleTheme.bg) bubble.style.backgroundColor = bubbleTheme.bg;
    if (bubbleTheme.text) bubble.style.color = bubbleTheme.text;

    // --- 展开按钮 ---
    const expandBtn = document.createElement('button');
    expandBtn.className = 'call-expand-btn';
    expandBtn.title = '展开通话记录';
    expandBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
        <path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z"/>
    </svg>`;
    expandBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const ok = await AppUI.confirm('展开通话期间的聊天记录？', '通话记录','展开','取消');
        if (ok) expandCallSession(sessionId, wrapper);
    });

    const bubbleAndBtnWrap = document.createElement('div');
    bubbleAndBtnWrap.className = 'call-bubble-and-btn-wrap';
    if (isSentByUser) {
        bubbleAndBtnWrap.classList.add('sent');
    }

    bubbleAndBtnWrap.appendChild(bubble);
    bubbleAndBtnWrap.appendChild(expandBtn);

    contentCol.appendChild(bubbleAndBtnWrap);
    bubbleRow.appendChild(avatarImg);
    bubbleRow.appendChild(contentCol);
    wrapper.appendChild(bubbleRow);

    return wrapper;
}
