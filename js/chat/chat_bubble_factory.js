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

        wrapper.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (!isInMultiSelectMode) {
                if (typeof createContextMenu === 'function') {
                    createContextMenu([{ label: '删除', action: () => enterMultiSelectMode(id) }], e.clientX, e.clientY);
                }
            }
        });

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
    const invisibleRegex = /\[.*?(?:接收|退回).*?的转账\]|\[.*?更新状态为：.*?\]|\[.*?已接收礼物\]|\[system:.*?\]|\[系统情景通知：.*?\]/;
    if (invisibleRegex.test(content)) {
        return null;
    }

    // 3. 处理其他可见的系统通知
    const timeSkipRegex = /\[system-display:([\s\S]+?)\]/;
    const inviteRegex = /\[(.*?)邀请(.*?)加入了群聊\]/;
    const renameRegex = /\[(.*?)修改群名为：(.*?)\]/;
    const memberRenameRegex = /\[(.*?)修改(.*?)的群昵称为：(.*?)\]/;
    const selfRenameRegex = /\[(.*?)将自己的群昵称修改为：(.*?)\]/;
    const timeSkipMatch = content.match(timeSkipRegex);
    const inviteMatch = content.match(inviteRegex);
    const renameMatch = content.match(renameRegex);
    const memberRenameMatch = content.match(memberRenameRegex);
    const selfRenameMatch = content.match(selfRenameRegex);

    if (timeSkipMatch || inviteMatch || renameMatch || memberRenameMatch || selfRenameMatch) {
        wrapper.className = 'message-wrapper system-notification';
        let bubbleText = '';
        if (timeSkipMatch) bubbleText = timeSkipMatch[1];
        if (inviteMatch) bubbleText = `${inviteMatch[1]}邀请${inviteMatch[2]}加入了群聊`;
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
            const sender = chat.members.find(m => m.id === senderId);
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
    const voiceRegex = /\[(?:.+?)的语音[:：]\s*([\s\S]+?)\]/;
    const photoVideoRegex = /\[(?:.+?)发来的照片\/视频[:：]\s*([\s\S]+?)\]/;
    
    // 转账超级宽容版：允许中英文分号、逗号；允许只写金额不写备注；兼容各种乱加空格
    const privateSentTransferRegex = /\[.*?给你转账[:：]\s*([\d.]+)\s*元(?:[;；,，\s]*(?:备注[:：])?\s*(.*?))?\]/;
    const privateReceivedTransferRegex = /\[.*?的转账[:：]\s*([\d.]+)\s*元(?:[;；,，\s]*(?:备注[:：])?\s*(.*?))?\]/;
    const groupTransferRegex = /\[(.*?)\s*向\s*(.*?)\s*转账[:：]\s*([\d.]+)\s*元(?:[;；,，\s]*(?:备注[:：])?\s*(.*?))?\]/;
    
    const privateGiftRegex = /\[(?:.+?)送来的礼物[:：]\s*([\s\S]+?)\]/;
    const groupGiftRegex = /\[(.*?)\s*向\s*(.*?)\s*送来了礼物[:：]\s*([\s\S]+?)\]/;
    const imageRecogRegex = /\[.*?发来了一张图片[:：]\]/;
    const textRegex = /\[(?:.+?)的消息[:：]\s*([\s\S]+?)\]/;
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
        bubbleElement = document.createElement('div');
        bubbleElement.className = 'voice-bubble';
        bubbleElement.style.backgroundColor = bubbleTheme.bg;
        bubbleElement.style.color = bubbleTheme.text;

        let duration = "0";
        if (typeof calculateVoiceDuration === 'function') {
            duration = calculateVoiceDuration(voiceMatch[1].trim());
        }

        bubbleElement.innerHTML = `<svg class="play-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"></path></svg><svg class="voice-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h2V9H6z"></path><path d="M7 7v10h2V7h-2z"></path><path d="M11 5v14h2V5h-2z"></path><path d="M15 9v6h2V9H6z"></path></svg><span class="duration">${duration}"</span>`;
        const transcriptDiv = document.createElement('div');
        transcriptDiv.className = 'voice-transcript';
        transcriptDiv.textContent = voiceMatch[1].trim();
        wrapper.appendChild(transcriptDiv);
    } else if (photoVideoMatch) {
        bubbleElement = document.createElement('div');
        bubbleElement.className = 'pv-card';
        bubbleElement.innerHTML = `<div class="pv-card-content">${photoVideoMatch[1].trim()}</div><div class="pv-card-image-overlay" style="background-image: url('${isSent ? 'https://i.postimg.cc/L8NFrBrW/1752307494497.jpg' : 'https://i.postimg.cc/1tH6ds9g/1752301200490.jpg'}');"></div><div class="pv-card-footer"><svg viewBox="0 0 24 24"><path d="M4,4H20A2,2 0 0,1 22,6V18A2,2 0 0,1 20,20H4A2,2 0 0,1 2,18V6A2,2 0 0,1 4,4M4,6V18H20V6H4M10,9A1,1 0 0,1 11,10A1,1 0 0,1 10,11A1,1 0 0,1 9,10A1,1 0 0,1 10,9M8,17L11,13L13,15L17,10L20,14V17H8Z"></path></svg><span>照片/视频・点击查看</span></div>`;
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
        bubbleElement.innerHTML = `<img src="${content}" alt="图片消息">`;
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
                    const sender = chat.members.find(m => m.id === quote.senderId);
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
