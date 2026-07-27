// --- chat_feature.js --- 
             const voiceMessageBtn = document.getElementById('voice-message-btn'),
                sendVoiceModal = document.getElementById('send-voice-modal'),
                sendVoiceForm = document.getElementById('send-voice-form'),
                voiceTextInput = document.getElementById('voice-text-input'),
                voiceDurationPreview = document.getElementById('voice-duration-preview');
            const photoVideoBtn = document.getElementById('photo-video-btn'),
                sendPvModal = document.getElementById('send-pv-modal'),
                sendPvForm = document.getElementById('send-pv-form'),
                pvTextInput = document.getElementById('pv-text-input');
            const imageRecognitionBtn = document.getElementById('image-recognition-btn'),
                imageUploadInput = document.getElementById('image-upload-input');
            const walletBtn = document.getElementById('wallet-btn'),
                sendTransferModal = document.getElementById('send-transfer-modal'),
                sendTransferForm = document.getElementById('send-transfer-form'),
                transferAmountInput = document.getElementById('transfer-amount-input'),
                transferRemarkInput = document.getElementById('transfer-remark-input');
            const receiveTransferActionSheet = document.getElementById('receive-transfer-actionsheet'),
                acceptTransferBtn = document.getElementById('accept-transfer-btn'),
                returnTransferBtn = document.getElementById('return-transfer-btn');
            const sendGiftModal = document.getElementById('send-gift-modal'),
                sendGiftForm = document.getElementById('send-gift-form'),
                giftDescriptionInput = document.getElementById('gift-description-input');
            const timeSkipModal = document.getElementById('time-skip-modal'),
                timeSkipForm = document.getElementById('time-skip-form'),
                timeSkipInput = document.getElementById('time-skip-input');     


            function calculateVoiceDuration(text) {
                return Math.max(1, Math.min(60, Math.ceil(text.length / 3.5)));
            }  
            
             async function sendImageForRecognition(base64Data) {
                if (!base64Data || isGenerating) return;
                const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
                const myName = (currentChatType === 'private') ? chat.myName : chat.me.realName;
                await processTimePerception(chat, currentChatId, currentChatType);
                const textPrompt = `[${myName}发来了一张图片：]`;
                const message = {
                    id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
                    role: 'user',
                    content: base64Data,
                    parts: [{ type: 'text', text: textPrompt }, { type: 'image', data: base64Data }],
                    timestamp: Date.now(),
                };
                if (currentChatType === 'group') {
                    message.senderId = 'user_me';
                }
                chat.history.push(message);
                addMessageBubble(message, currentChatId, currentChatType);
                await saveMessageToDB(message, currentChatId, currentChatType);
                await saveSingleChat(currentChatId, currentChatType);
                renderChatList();
            }                            
                                                     

            // ==========================================
            // 图片转文字描述（省 token）
            // 长按图片消息 →「转化为文字」→ 额外调一次识图 API 拿描述
            // → 成功后才把原图换成文字消息；失败零副作用，原图完好
            // 转化后 parts 只剩 text，上下文里不再是一张图，而是一小段文字
            // ==========================================

            // 正在转化中的消息 ID：防止重复点击，长按菜单里据此置灰
            const _convertingMsgIds = new Set();

            const VISION_DESCRIBE_PROMPT = '请用中文客观描述这张照片里实际可见的主要内容。只陈述你看得见的【主要】内容，忽略模糊背景中不重要的人、事、物，除非你觉得他们很重要才补充描述。不需要升华和分析。直接输出描述本身，不要任何前缀、引号或Markdown。';

            // 清洗模型返回的描述：
            // 1) 必须剥掉方括号和换行，否则会打断 [xx发来的照片/视频：...] 的气泡正则
            // 2) 模型（尤其 gemini）爱在结尾加一句"整体体现了温馨的氛围"，这里把这类
            //    纯抒情的收尾句砍掉；只砍结尾、且必须留下至少一句正文，避免误伤
            function _sanitizeVisionDesc(raw) {
                let text = (raw || '').replace(/[\[\]]/g, '').replace(/\s+/g, ' ').trim();
                if (!text) return '';

                const FILLER_HEAD = /^(整体|整个画面|整张|画面|构图|色调|光线|背景|气氛|氛围|给人|让人|使人|体现|展现|呈现出|营造|传达|流露|散发|充满|洋溢)/;
                const FILLER_TAIL = /(氛围|感觉|感受|气息|意境|情绪|温馨|惬意|美好|宁静|治愈|舒适|愉悦|轻松)/;

                // 按句号/感叹号/问号切句，保留分隔符
                const parts = text.match(/[^。！？!?]+[。！？!?]?/g) || [text];
                while (parts.length > 1) {
                    const last = parts[parts.length - 1].trim();
                    if (FILLER_HEAD.test(last) && FILLER_TAIL.test(last)) {
                        parts.pop();
                    } else {
                        break;
                    }
                }
                return parts.join('').trim().replace(/[，,、]$/, '');
            }

            // 取消息发送者的显示名（私聊/群聊、我方/对方）
            function _resolveMsgSenderName(chat, message, chatType) {
                if (message.role === 'user') {
                    return (chatType === 'private') ? chat.myName : chat.me.realName;
                }
                if (chatType === 'private') {
                    return chat.realName || chat.name;
                }
                const sender = findGroupMemberById(chat, message.senderId);
                return sender ? sender.groupNickname : (chat.name || '未知成员');
            }

            // 取识图 API 配置
            // 优先级：全局识图设置 > 该聊天自己的 API 预设 > 全局默认
            // 注意是「全局优先」：一旦在侧栏指定了识图API，所有聊天的转化都走它
            function _getVisionApiConfig(chat) {
                const _pick = (d) => ({
                    url:      d.url || d.apiUrl || '',
                    key:      d.key || d.apiKey || '',
                    model:    d.model || '',
                    provider: d.provider || 'newapi'
                });
                const _findPreset = (name) => (db.apiPresets || [])
                    .filter(p => !p.type || p.type === 'chat')
                    .find(p => p.name === name);

                const visionPresetName = (db.globalVisionSettings || {}).apiPreset || '';
                if (visionPresetName) {
                    const preset = _findPreset(visionPresetName);
                    if (preset && preset.data) return _pick(preset.data);
                }
                if (chat && chat.chatApiPreset) {
                    const preset = _findPreset(chat.chatApiPreset);
                    if (preset && preset.data) return _pick(preset.data);
                }
                return _pick(db.apiSettings || {});
            }

            // 调识图 API，返回图片的文字描述（非流式，60秒超时）
            async function requestImageDescription(dataUrl, chat) {
                const { url, key, model, provider } = _getVisionApiConfig(chat);
                if (!url || !key || !model) throw new Error('识图API未配置完整');

                const _key = (typeof getRandomValue === 'function') ? getRandomValue(key) : key;
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 60000);

                try {
                    let endpoint, headers, body;

                    if (provider === 'gemini') {
                        let mimeType = 'image/jpeg';
                        let data = dataUrl;
                        const match = dataUrl.match(/^data:(image\/(\w+));base64,(.*)$/);
                        if (match) { mimeType = match[1]; data = match[3]; }

                        endpoint = `${url}/v1beta/models/${model}:generateContent?key=${_key}`;
                        headers = { 'Content-Type': 'application/json' };
                        body = {
                            contents: [{
                                role: 'user',
                                parts: [
                                    { text: VISION_DESCRIBE_PROMPT },
                                    { inline_data: { mime_type: mimeType, data: data } }
                                ]
                            }],
                            generationConfig: { temperature: 0.4 }
                        };
                    } else {
                        endpoint = `${url}/v1/chat/completions`;
                        headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${_key}` };
                        body = {
                            model: model,
                            stream: false,
                            temperature: 0.4,
                            messages: [{
                                role: 'user',
                                content: [
                                    { type: 'text', text: VISION_DESCRIBE_PROMPT },
                                    { type: 'image_url', image_url: { url: dataUrl } }
                                ]
                            }]
                        };
                    }

                    const response = await fetch(endpoint, {
                        method: 'POST',
                        headers: headers,
                        body: JSON.stringify(body),
                        signal: controller.signal
                    });

                    if (!response.ok) {
                        let detail = '';
                        try { detail = ((await response.text()) || '').slice(0, 120); } catch (e) {}
                        throw new Error(`API ${response.status}${detail ? ' ' + detail : ''}`);
                    }

                    const json = await response.json();
                    return (provider === 'gemini')
                        ? (json.candidates?.[0]?.content?.parts?.[0]?.text || '')
                        : (json.choices?.[0]?.message?.content || '');
                } catch (err) {
                    if (err.name === 'AbortError') throw new Error('请求超时（60秒）');
                    throw err;
                } finally {
                    clearTimeout(timer);
                }
            }

            // 挂上/取下图片气泡的「转化中」遮罩
            // 每次都按 id 重新查 DOM：等待期间可能已重绘，旧引用会失效
            function _setImageConvertingUI(messageId, isConverting) {
                const bubble = document.querySelector(`.message-wrapper[data-id="${messageId}"] .image-bubble`);
                if (bubble) bubble.classList.toggle('converting', isConverting);
            }

            // 主流程：把一条图片消息转化成文字描述
            async function convertImageMessageToText(messageId) {
                if (_convertingMsgIds.has(messageId)) { showToast('该图片正在转化中'); return; }

                const chat = (currentChatType === 'private')
                    ? db.characters.find(c => c.id === currentChatId)
                    : db.groups.find(g => g.id === currentChatId);
                if (!chat) return;

                const message = chat.history.find(m => m.id === messageId);
                if (!message) return;

                const imagePart = (message.parts || []).find(p => p.type === 'image');
                if (!imagePart || !imagePart.data) { showToast('这条消息里没有图片'); return; }

                const confirmMsg = '转化后将删除原图，只保留AI生成的文字描述，且无法还原。但这张图将不再占用上下文额度。\n\n确定继续吗？';
                const confirmed = (typeof AppUI !== 'undefined' && AppUI.confirm)
                    ? await AppUI.confirm(confirmMsg, '转化为文字', '确定', '取消')
                    : confirm(confirmMsg);
                if (!confirmed) return;

                // 记住发起时的会话，防止用户中途切走后把结果写错地方
                const targetChatId = currentChatId;
                const targetChatType = currentChatType;

                _convertingMsgIds.add(messageId);
                _setImageConvertingUI(messageId, true);

                try {
                    const raw = await requestImageDescription(imagePart.data, chat);
                    const desc = _sanitizeVisionDesc(raw);
                    if (!desc) throw new Error('返回内容为空');

                    const senderName = _resolveMsgSenderName(chat, message, targetChatType);

                    // ★ 写数据是最后一步：上面任何一步失败，原图都分毫未动
                    const newContent = `[${senderName}发来的照片/视频：${desc}]`;
                    message.content = newContent;
                    message.parts = [{ type: 'text', text: newContent }];

                    await saveMessageToDB(message, targetChatId, targetChatType);
                    await saveSingleChat(targetChatId, targetChatType);
                    renderChatList();

                    // 原地换气泡（还在同一个聊天室时才动 DOM）
                    if (currentChatId === targetChatId && currentChatType === targetChatType) {
                        const oldBubble = document.querySelector(`.message-wrapper[data-id="${messageId}"]`);
                        const newBubble = createMessageBubbleElement(message);
                        if (oldBubble && newBubble) oldBubble.replaceWith(newBubble);
                    }

                    showToast('已转化为文字');
                } catch (err) {
                    console.error('图片转化失败:', err);
                    showToast('转化失败：' + (err.message || '未知错误'));
                } finally {
                    _convertingMsgIds.delete(messageId);
                    _setImageConvertingUI(messageId, false);
                }
            }

            // ==========================================
            // 批量清理：把当前聊天里所有图片一次性转成文字描述
            // 入口在聊天设置侧栏（私聊/群聊共用这一个函数）
            // ==========================================
            async function cleanupChatImages() {
                const chatId = currentChatId;
                const chatType = currentChatType;
                const chat = (chatType === 'private')
                    ? db.characters.find(c => c.id === chatId)
                    : db.groups.find(g => g.id === chatId);
                if (!chat) return;

                // 收起侧栏
                const sidebarId = (chatType === 'private') ? 'chat-settings-sidebar' : 'group-settings-sidebar';
                document.getElementById(sidebarId)?.classList.remove('open');

                // 1. 先弹窗给即时反馈，再在弹窗里异步扫库统计
                //    （扫库要遍历整个会话，几百毫秒的空窗会让人以为没点到而反复点）
                const ids = [];
                let ok;
                try {
                    ok = await AppUI.confirmPending(
                        '正在统计图片数量…',
                        async () => {
                            // ★ 绝不能用 .toArray()：那会把该聊天所有 base64 一次性读进内存
                            await dexieDB.messages.where('chatId').equals(chatId).each(m => {
                                if (m && Array.isArray(m.parts) && m.parts.some(p => p.type === 'image')) {
                                    ids.push(m.id);
                                }
                            });
                            if (!ids.length) return null;   // 没图片：弹窗自动关闭

                            // 粗估耗时：每张约 3 秒，3 个并发
                            const estSec = Math.ceil(ids.length * 3 / 3);
                            const estText = (estSec < 60) ? `${estSec} 秒` : `${Math.ceil(estSec / 60)} 分钟`;
                            return `共找到 ${ids.length} 张图片。\n将逐张调用识图API转成文字描述，原图会被删除且无法还原。预计耗时 ${estText} 左右，中途可以随时停止。\n\n确定开始吗？`;
                        },
                        { title: '清理图片', confirmText: '开始', cancelText: '取消' }
                    );
                } catch (e) {
                    console.error('扫描图片失败:', e);
                    showToast('扫描失败：' + (e.message || '未知错误'));
                    return;
                }

                if (ok === null) {
                    await AppUI.alert('这个聊天里没有需要转化的图片。', '清理图片');
                    return;
                }
                if (!ok) return;

                const bar = AppUI.progress(`已完成 0 / ${ids.length}`, { title: '清理图片', stopText: '停止' });
                let done = 0, failed = 0;

                // 单张转化：读库 → 调API → 写回（写库仍是最后一步，失败不动原图）
                const convertOne = async (id) => {
                    const row = await dexieDB.messages.get(id);
                    if (!row) return;
                    const imagePart = (row.parts || []).find(p => p.type === 'image');
                    if (!imagePart || !imagePart.data) return;

                    const desc = _sanitizeVisionDesc(await requestImageDescription(imagePart.data, chat));
                    if (!desc) throw new Error('返回内容为空');

                    const newContent = `[${_resolveMsgSenderName(chat, row, chatType)}发来的照片/视频：${desc}]`;
                    row.content = newContent;
                    row.parts = [{ type: 'text', text: newContent }];
                    await dexieDB.messages.put(row);   // row 自带 chatId/chatType

                    // 同步内存里的那份（懒加载下两者是不同对象）
                    const memMsg = (chat.history || []).find(m => m.id === id);
                    if (memMsg) {
                        memMsg.content = newContent;
                        memMsg.parts = [{ type: 'text', text: newContent }];
                    }
                };

                // 2. 并发 3 个 worker 消费同一个游标，停止后不再领新任务
                let cursor = 0;
                const worker = async () => {
                    while (true) {
                        if (bar.isStopped()) return;
                        const i = cursor++;
                        if (i >= ids.length) return;
                        try {
                            await convertOne(ids[i]);
                            done++;
                        } catch (e) {
                            failed++;
                            console.error('批量转化失败:', ids[i], e);
                        }
                        bar.update(`已完成 ${done} / ${ids.length}${failed ? `（失败 ${failed}）` : ''}`);
                    }
                };

                await Promise.all(Array.from({ length: Math.min(3, ids.length) }, worker));
                const stoppedEarly = (done + failed) < ids.length;

                bar.close();

                // 3. 收尾：有成功的才落盘刷新
                if (done > 0) {
                    await saveSingleChat(chatId, chatType);
                    if (currentChatId === chatId && currentChatType === chatType) {
                        renderMessages(false, false);
                    }
                    renderChatList();
                }

                await AppUI.alert(
                    `${stoppedEarly ? '已停止。\n' : ''}成功转化 ${done} 张${failed ? `，失败 ${failed} 张（原图保留，可稍后重试）` : ''}。`,
                    '清理图片'
                );
            }

            window.convertImageMessageToText = convertImageMessageToText;
            window.isImageConverting = (id) => _convertingMsgIds.has(id);
            window.cleanupChatImages = cleanupChatImages;

            async function sendMyVoiceMessage(text) {
                if (!text) return;
                sendVoiceModal.classList.remove('visible');
                await new Promise(resolve => setTimeout(resolve, 100));
                const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
                const myName = (currentChatType === 'private') ? chat.myName : chat.me.realName;
                await processTimePerception(chat, currentChatId, currentChatType);
                const content = `[${myName}的语音：${text}]`;
                const message = {
                    id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
                    role: 'user',
                    content: content,
                    parts: [{ type: 'text', text: content }],
                    timestamp: Date.now()
                };
                if (currentChatType === 'group') {
                    message.senderId = 'user_me';
                }
                chat.history.push(message);
                addMessageBubble(message, currentChatId, currentChatType);
                await saveMessageToDB(message, currentChatId, currentChatType);
                await saveSingleChat(currentChatId, currentChatType);
                renderChatList();
            }
            
             async function sendMyPhotoVideo(text) {
                if (!text) return;
                sendPvModal.classList.remove('visible');
                await new Promise(resolve => setTimeout(resolve, 100));
                const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
                const myName = (currentChatType === 'private') ? chat.myName : chat.me.realName;
                await processTimePerception(chat, currentChatId, currentChatType);
                const content = `[${myName}发来的照片\/视频：${text}]`;
                const message = {
                    id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
                    role: 'user',
                    content: content,
                    parts: [{ type: 'text', text: content }],
                    timestamp: Date.now()
                };
                if (currentChatType === 'group') {
                    message.senderId = 'user_me';
                }
                chat.history.push(message);
                addMessageBubble(message, currentChatId, currentChatType);
                await saveMessageToDB(message, currentChatId, currentChatType);
                await saveSingleChat(currentChatId, currentChatType);
                renderChatList();
            }                           


            async function sendMyTransfer(amount, remark) {
                sendTransferModal.classList.remove('visible');
                await new Promise(resolve => setTimeout(resolve, 100));
                const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
                await processTimePerception(chat, currentChatId, currentChatType);
                if (currentChatType === 'private') {
                    const content = `[${chat.myName}给你转账：${amount}元；备注：${remark}]`;
                    const message = {
                        id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
                        role: 'user',
                        content: content,
                        parts: [{ type: 'text', text: content }],
                        timestamp: Date.now(),
                        transferStatus: 'pending'
                    };
                    chat.history.push(message);
                    addMessageBubble(message, currentChatId, currentChatType);
  await saveMessageToDB(message, currentChatId, currentChatType);                  
                } else { // Group chat
                let msgs =[];
        currentGroupAction.recipients.forEach(recipientId => {
                        const recipient = chat.members.find(m => m.id === recipientId);
                        if (recipient) {
                            const content = `[${chat.me.realName} 向 ${recipient.realName} 转账：${amount}元；备注：${remark}]`;
                            const message = {
                                id: `msg_${Date.now()}_${recipientId}_${Math.random().toString(36).substr(2, 6)}`, 
                                role: 'user',
                                content: content,
                                parts: [{ type: 'text', text: content }],
                                timestamp: Date.now(),
                                senderId: 'user_me'
                            };
                            chat.history.push(message);
                            addMessageBubble(message, currentChatId, currentChatType);
                            msgs.push(message); 
                        }
                    });
                    await saveMessagesToDB(msgs, currentChatId, currentChatType);
                }
                await saveSingleChat(currentChatId, currentChatType);
                renderChatList();
            }

            async function sendMyGift(description) {
                if (!description) return;
                sendGiftModal.classList.remove('visible');
                await new Promise(resolve => setTimeout(resolve, 100));
                const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
                await processTimePerception(chat, currentChatId, currentChatType);

                if (currentChatType === 'private') {
                    const content = `[${chat.myName}送来的礼物：${description}]`;
                    const message = {
                        id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
                        role: 'user',
                        content: content,
                        parts: [{ type: 'text', text: content }],
                        timestamp: Date.now(),
                        giftStatus: 'sent'
                    };
                    chat.history.push(message);
                    addMessageBubble(message, currentChatId, currentChatType);
                    await saveMessageToDB(message, currentChatId, currentChatType);
                } else { // Group chat
                    let msgs =[];
        currentGroupAction.recipients.forEach(recipientId => {
                        const recipient = chat.members.find(m => m.id === recipientId);
                        if (recipient) {
                            const content = `[${chat.me.realName} 向 ${recipient.realName} 送来了礼物：${description}]`;
                            const message = {
                                id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
                                role: 'user',
                                content: content,
                                parts: [{ type: 'text', text: content }],
                                timestamp: Date.now(),
                                senderId: 'user_me'
                            };
                            chat.history.push(message);
                            addMessageBubble(message, currentChatId, currentChatType);
                            msgs.push(message); 
                        }
                    });
                    await saveMessagesToDB(msgs, currentChatId, currentChatType);
                }
                await saveSingleChat(currentChatId, currentChatType);
                renderChatList();
            }

            // --- NEW: Time Skip System ---
            function setupTimeSkipSystem() {

                timeSkipModal.addEventListener('click', (e) => {
                    if (e.target === timeSkipModal) timeSkipModal.classList.remove('visible');
                });
                timeSkipForm.addEventListener('submit', (e) => {
                    e.preventDefault();
                    sendTimeSkipMessage(timeSkipInput.value.trim());
                });
            }

            async function sendTimeSkipMessage(text) {
    if (!text) return;
    timeSkipModal.classList.remove('visible');
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
    if (!chat) return;

    await processTimePerception(chat, currentChatId, currentChatType);

    const now = Date.now();

    // 1. UI 展示消息 (保持不变，用 system-display 是为了触发你的CSS样式)
    const visualMessage = {
        id: `msg_visual_${now}_${Math.random().toString(36).substr(2, 6)}`, 
        role: 'system',
        content: `[system-display:${text}]`, // 这里保留 system-display 是为了前端渲染样式，反正是给用户看的，不给AI看
        parts: [],
        timestamp: now,
        isAiIgnore: true // AI 看不到这条
    };

    // 2. AI 上下文消息 (修改这里！)
    // 去掉 system，改为更自然的描述标签
    const contextContent = `[剧情旁白：${text}]`; 
    
    const contextMessage = {
        id: `msg_context_${now}_${Math.random().toString(36).substr(2, 6)}`, 
        role: 'user', // 既然是用户写的旁白，用 user 角色最合适
        content: contextContent,
        parts: [{ type: 'text', text: contextContent }],
        timestamp: now,
        isHidden: true // 用户界面不显示这条
    };

    if (currentChatType === 'group') {
        contextMessage.senderId = 'user_me';
        visualMessage.senderId = 'user_me';
    }

    chat.history.push(visualMessage, contextMessage);
    addMessageBubble(visualMessage, currentChatId, currentChatType);
    await saveMessagesToDB([visualMessage, contextMessage], currentChatId, currentChatType);
    await saveSingleChat(currentChatId, currentChatType);
    // renderChatList(); // 不需要调用
}

              function setupVoiceMessageSystem() {
                voiceMessageBtn.addEventListener('click', () => {
                    sendVoiceForm.reset();
                    voiceDurationPreview.textContent = '0"';
                    sendVoiceModal.classList.add('visible');
                });
                sendVoiceForm.addEventListener('submit', (e) => {
                    e.preventDefault();
                    sendMyVoiceMessage(voiceTextInput.value.trim());
                });
            }

            function setupPhotoVideoSystem() {
                photoVideoBtn.addEventListener('click', () => {
                    sendPvForm.reset();
                    sendPvModal.classList.add('visible');
                });
                sendPvForm.addEventListener('submit', (e) => {
                    e.preventDefault();
                    sendMyPhotoVideo(pvTextInput.value.trim());
                });
            }

            function setupWalletSystem() {
                walletBtn.addEventListener('click', () => {
                    if (currentChatType === 'private') {
                        sendTransferForm.reset();
                        sendTransferModal.classList.add('visible');
                    } else if (currentChatType === 'group') {
                        currentGroupAction.type = 'transfer';
                        renderGroupRecipientSelectionList('转账给');
                        groupRecipientSelectionModal.classList.add('visible');
                    }
                });
                sendTransferForm.addEventListener('submit', (e) => {
                    e.preventDefault();
                    const amount = transferAmountInput.value;
                    const remark = transferRemarkInput.value.trim();
                    if (amount > 0) {
                        sendMyTransfer(amount, remark);
                    } else {
                        showToast('请输入有效的金额');
                    }
                });
                acceptTransferBtn.addEventListener('click', () => respondToTransfer('received'));
                returnTransferBtn.addEventListener('click', () => respondToTransfer('returned'));
            }

            function handleReceivedTransferClick(messageId) {
                currentTransferMessageId = messageId;
                receiveTransferActionSheet.classList.add('visible');
            }

            async function respondToTransfer(action) {
                if (!currentTransferMessageId) return;
                const character = db.characters.find(c => c.id === currentChatId);
                const message = character.history.find(m => m.id === currentTransferMessageId);
                if (message) {
                    message.transferStatus = action;
                    const cardOnScreen = messageArea.querySelector(`.message-wrapper[data-id="${currentTransferMessageId}"] .transfer-card`);
                    if (cardOnScreen) {
                        cardOnScreen.classList.remove('received', 'returned');
                        cardOnScreen.classList.add(action);
                        cardOnScreen.querySelector('.transfer-status').textContent = action === 'received' ? '已收款' : '已退回';
                        cardOnScreen.style.cursor = 'default';
                    }
                    let contextMessageContent = (action === 'received') ? `[${character.myName}接收${character.realName}的转账]` : `[${character.myName}退回${character.realName}的转账]`;
                    const contextMessage = {
                        id: `msg_${Date.now()}`,
                        role: 'user',
                        content: contextMessageContent,
                        parts: [{ type: 'text', text: contextMessageContent }],
                        timestamp: Date.now()
                    };
                    character.history.push(contextMessage);
                    await saveMessageToDB(message, currentChatId, currentChatType); // ★ (状态更新)
        await saveMessageToDB(contextMessage, currentChatId, currentChatType); // ★ (系统通知)
                    await saveSingleChat(currentChatId, currentChatType);
                    renderChatList();
                }
                receiveTransferActionSheet.classList.remove('visible');
                currentTransferMessageId = null;
            }

            function setupGiftSystem() {

                sendGiftForm.addEventListener('submit', (e) => {
                    e.preventDefault();
                    sendMyGift(giftDescriptionInput.value.trim());
                });
            }
            
             // --- Other Sub-systems Setup (Stickers, Voice, etc.) ---
            function setupImageRecognition() {
                imageRecognitionBtn.addEventListener('click', () => {
                    imageUploadInput.click();
                });
                imageUploadInput.addEventListener('change', async (e) => {
                    const file = e.target.files[0];
                    if (file) {
                        try {
                            const compressedUrl = await compressImage(file, {
                                quality: 0.8,
                                maxWidth: 1024,
                                maxHeight: 1024
                            });
                            sendImageForRecognition(compressedUrl);
                        } catch (error) {
                            console.error('Image compression failed:', error);
                            showToast('图片处理失败，请重试');
                        } finally {
                            e.target.value = null;
                        }
                    }
                });
            }          
            
             // 🌟 缓存当前聊道的消息总数：openDeleteChunkModal 已查过并显示给用户，
             // submit（点"下一步"）时直接复用，避免重复 await DB count 造成停顿
             let cachedChunkTotal = null;

             async function openDeleteChunkModal() {
                const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
                if (!chat) {
                    showToast('当前没有聊天记录可删除');
                    return;
                }
                // 先弹窗给即时反馈，再异步计算真实总数（懒加载下 chat.history 只有内存窗口，必须走 DB count）
                const rangeInfo = document.getElementById('delete-chunk-range-info');
                document.getElementById('delete-chunk-form').reset();
                rangeInfo.textContent = '正在统计消息总数...';
                document.getElementById('delete-chunk-modal').classList.add('visible');

                let totalMessages;
                if (window.LAZY_LOAD && typeof window.getMessageCount === 'function') {
                    try { totalMessages = await window.getMessageCount(chat.id); }
                    catch (e) { totalMessages = chat.history ? chat.history.length : 0; }
                } else {
                    totalMessages = chat.history ? chat.history.length : 0;
                }

                if (!totalMessages) {
                    document.getElementById('delete-chunk-modal').classList.remove('visible');
                    showToast('当前没有聊天记录可删除');
                    return;
                }
                // 缓存供 submit 直接复用，避免点"下一步"时再查一次 DB count
                cachedChunkTotal = { chatId: chat.id, total: totalMessages };
                rangeInfo.textContent = `当前聊天总消息数: ${totalMessages}`;
            }

            function setupDeleteHistoryChunk() {
                const deleteChunkForm = document.getElementById('delete-chunk-form');
                const confirmBtn = document.getElementById('confirm-delete-chunk-btn');
                const cancelBtn = document.getElementById('cancel-delete-chunk-btn');
                const deleteChunkModal = document.getElementById('delete-chunk-modal');
                const confirmModal = document.getElementById('delete-chunk-confirm-modal');
                const previewBox = document.getElementById('delete-chunk-preview');

                // 🌟 修复1：在这里提前声明 messagesToDelete，让下面两个步骤都能共享这个变量
                let startRange, endRange, messagesToDelete;

                deleteChunkForm.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);

                    // 🌟 复用打开输入框时已查好的总数，避免点"下一步"时重复 await DB count 造成停顿
                    let totalMessages;
                    if (cachedChunkTotal && cachedChunkTotal.chatId === chat.id) {
                        totalMessages = cachedChunkTotal.total;
                    } else if (window.LAZY_LOAD && typeof window.getMessageCount === 'function') {
                        try { totalMessages = await window.getMessageCount(chat.id); }
                        catch (err) { totalMessages = chat.history.length; }
                    } else {
                        totalMessages = chat.history.length;
                    }

                    startRange = parseInt(document.getElementById('delete-range-start').value);
                    endRange = parseInt(document.getElementById('delete-range-end').value);

                    if (isNaN(startRange) || isNaN(endRange) || startRange <= 0 || endRange < startRange || endRange > totalMessages) {
                        showToast('请输入有效的起止范围');
                        return;
                    }

                    // 🌟 先立刻弹出确认框并显示加载态，避免预览查询较慢时用户以为卡住/没点到
                    messagesToDelete = null;
                    previewBox.innerHTML = `<p style="text-align: center; color: #999; margin: 5px 0;">读取预览中…</p>`;
                    confirmBtn.disabled = true;
                    confirmBtn.style.opacity = '0.5';
                    confirmBtn.style.cursor = 'not-allowed';
                    deleteChunkModal.classList.remove('visible');
                    confirmModal.classList.add('visible');

                    // 记录本次加载对应的范围，用于防止用户快速重复操作时旧结果覆盖新结果
                    const reqStart = startRange, reqEnd = endRange;

                    // 取要删除的消息：懒加载走 DB 全局序号（老范围可能不在内存窗口内），否则内存 slice
                    let loaded;
                    try {
                        if (window.LAZY_LOAD && typeof window.getMessagesByGlobalRange === 'function') {
                            try { loaded = await window.getMessagesByGlobalRange(chat.id, startRange, endRange); }
                            catch (err) { loaded = chat.history.slice(startRange - 1, endRange); }
                        } else {
                            loaded = chat.history.slice(startRange - 1, endRange);
                        }
                    } catch (err) {
                        loaded = null;
                    }

                    // 确认框已被关闭，或用户又发起了新的范围请求，则丢弃这次结果
                    if (!confirmModal.classList.contains('visible') || reqStart !== startRange || reqEnd !== endRange) {
                        return;
                    }

                    if (!loaded) {
                        previewBox.innerHTML = `<p style="text-align: center; color: #e74c3c; margin: 5px 0;">预览加载失败，请关闭后重试</p>`;
                        return;
                    }

                    messagesToDelete = loaded;

                    // --- NEW PREVIEW LOGIC ---
                    let previewHtml = '';
                    const totalToDelete = messagesToDelete.length;

                    if (totalToDelete <= 4) {
                        // If 4 or fewer messages, show all of them
                        previewHtml = messagesToDelete.map(msg => {
                            const contentMatch = msg.content.match(/\[.*?的消息：([\s\S]+)\]/);
                            const text = contentMatch ? contentMatch[1] : msg.content;
                            return `<p>${msg.role === 'user' ? '我' : chat.remarkName || '对方'}: ${text.substring(0, 50)}...</p>`;
                        }).join('');
                    } else {
                        // If more than 4, show first 2, ellipsis, and last 2
                        const firstTwo = messagesToDelete.slice(0, 2);
                        const lastTwo = messagesToDelete.slice(-2);

                        const firstTwoHtml = firstTwo.map(msg => {
                            const contentMatch = msg.content.match(/\[.*?的消息：([\s\S]+)\]/);
                            const text = contentMatch ? contentMatch[1] : msg.content;
                            return `<p>${msg.role === 'user' ? '我' : chat.remarkName || '对方'}: ${text.substring(0, 50)}...</p>`;
                        }).join('');

                        const lastTwoHtml = lastTwo.map(msg => {
                            const contentMatch = msg.content.match(/\[.*?的消息：([\s\S]+)\]/);
                            const text = contentMatch ? contentMatch[1] : msg.content;
                            return `<p>${msg.role === 'user' ? '我' : chat.remarkName || '对方'}: ${text.substring(0, 50)}...</p>`;
                        }).join('');

                        previewHtml = `${firstTwoHtml}<p style="text-align: center; color: #999; margin: 5px 0;">...</p>${lastTwoHtml}`;
                    }
                    previewBox.innerHTML = previewHtml;

                    // 预览就绪，恢复确认按钮
                    confirmBtn.disabled = false;
                    confirmBtn.style.opacity = '';
                    confirmBtn.style.cursor = '';
                });

                confirmBtn.addEventListener('click', async () => {
                    // 预览尚未加载完成（按钮理论上已置灰），保险起见直接忽略
                    if (!messagesToDelete) return;
                    const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
                    const idsToDelete = messagesToDelete.map(m => m.id);
                    const count = idsToDelete.length;

                    // 先删 DB，再按 id 从内存窗口剔除命中的
                    //（懒加载下 chat.history 只是最近窗口，按全局 index splice 会删错，必须按 id 过滤）
                    await deleteMessagesFromDB(idsToDelete);
                    const delSet = new Set(idsToDelete);
                    chat.history = chat.history.filter(m => !delSet.has(m.id));
                    await saveSingleChat(currentChatId, currentChatType);

                    confirmModal.classList.remove('visible');
                    // 删除后总数已变，作废旧缓存，下次打开重新统计
                    cachedChunkTotal = null;
                    showToast(`已成功删除 ${count} 条消息`);
                    currentPage = 1;
                    renderMessages(false, true);
                    renderChatList();
                });

                cancelBtn.addEventListener('click', () => {
                    confirmModal.classList.remove('visible');
                    // 复位按钮状态，避免下次残留置灰
                    confirmBtn.disabled = false;
                    confirmBtn.style.opacity = '';
                    confirmBtn.style.cursor = '';
                });
            }                               