// ==========================================
// ai_service.js - 核心 AI 处理层
// ==========================================
let callAbortController = null;   // ← 新增：通话请求中止器

function getMixedContent(responseData) {
    const results =[];
    let i = 0;

    while (i < responseData.length) {
        const nextTagStart = responseData.indexOf('<', i);
        const nextBracketStart = responseData.indexOf('[', i);

        // Find the start of the next special block
        let firstSpecialIndex = -1;
        if (nextTagStart !== -1 && nextBracketStart !== -1) {
            firstSpecialIndex = Math.min(nextTagStart, nextBracketStart);
        } else {
            firstSpecialIndex = Math.max(nextTagStart, nextBracketStart);
        }

        // If no special blocks left, the rest is plain text
        if (firstSpecialIndex === -1) {
            const text = responseData.substring(i).trim();
            if (text) results.push({ type: 'text', content: `[unknown的消息：${text}]` });
            break;
        }

        // If there's plain text before the special block, add it
        if (firstSpecialIndex > i) {
            const text = responseData.substring(i, firstSpecialIndex).trim();
            if (text) results.push({ type: 'text', content: `[unknown的消息：${text}]` });
        }

        i = firstSpecialIndex;

        // Process the block
        if (responseData[i] === '<') {
            // Potential HTML block
            const tagMatch = responseData.substring(i).match(/^<([a-zA-Z0-9]+)/);
            if (tagMatch) {
                const tagName = tagMatch[1];
                let openCount = 0;
                let searchIndex = i;
                let blockEnd = -1;

                // Find the end of the outermost tag
                while (searchIndex < responseData.length) {
                    const openTagPos = responseData.indexOf('<' + tagName, searchIndex);
                    const closeTagPos = responseData.indexOf('</' + tagName, searchIndex);

                    if (openTagPos !== -1 && (closeTagPos === -1 || openTagPos < closeTagPos)) {
                        openCount++;
                        searchIndex = openTagPos + 1;
                    } else if (closeTagPos !== -1) {
                        openCount--;
                        searchIndex = closeTagPos + 1;
                        if (openCount === 0) {
                            blockEnd = closeTagPos + `</${tagName}>`.length;
                            break;
                        }
                    } else {
                        break; // Malformed, no closing tag
                    }
                }

                if (blockEnd !== -1) {
                    const htmlBlock = responseData.substring(i, blockEnd);
                    const charMatch = htmlBlock.match(/<[a-z][a-z0-9]*\s+char="([^"]*)"/i);
                    const char = charMatch ? charMatch[1] : null;
                    results.push({ type: 'html', char: char, content: htmlBlock });
                    i = blockEnd;
                    continue;
                }
            }
        }

        if (responseData[i] === '[') {
            // Potential [...] block
            const endBracket = responseData.indexOf(']', i);
            if (endBracket !== -1) {
                const text = responseData.substring(i, endBracket + 1);
                results.push({ type: 'text', content: text });
                i = endBracket + 1;
                continue;
            }
        }

        // If we got here, it was a false alarm (e.g., a lone '<' or '[').
        // Treat it as plain text and move on.
        const nextSpecial1 = responseData.indexOf('<', i + 1);
        const nextSpecial2 = responseData.indexOf('[', i + 1);
        let endOfText = -1;
        if (nextSpecial1 !== -1 && nextSpecial2 !== -1) {
            endOfText = Math.min(nextSpecial1, nextSpecial2);
        } else {
            endOfText = Math.max(nextSpecial1, nextSpecial2);
        }
        if (endOfText === -1) {
            endOfText = responseData.length;
        }
        const text = responseData.substring(i, endOfText).trim();
        if (text) results.push({ type: 'text', content: `[unknown的消息：${text}]` });
        i = endOfText;
    }
    return results;
}

// ========================================== 
// 错误处理翻译官 (修复后：提取到全局)
// ==========================================
function getFriendlyErrorMessage(error) {
    if (error.name === 'AbortError') return '请求超时了，请检查您的网络或稍后再试。';
    if (error instanceof SyntaxError) return '服务器返回的数据格式不对，建议您点击“重回”按钮再试一次。';
    if (error.response) {
        const status = error.response.status;
        switch (status) {
            case 429: return '您点的太快啦，请稍等一下再试。';
            case 504: return '服务器有点忙，响应不过来了，请稍后再试。';
            case 500: return '服务器内部出错了，他们应该正在修复。';
            case 401: return 'API密钥好像不对或者过期了，请检查一下设置。';
            case 404: return '请求的API地址找不到了，请检查一下设置。';
            default: return `服务器返回了一个错误 (代码: ${status})，请稍后再试。`;
        }
    }
    if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
        return '网络连接好像出问题了，请检查一下网络。';
    }
    return `发生了一个未知错误：${error.message}`;
}

function showApiError(error) {
    console.error("API Error Detected:", error);
    const friendlyMessage = getFriendlyErrorMessage(error);
    showToast(friendlyMessage);
}

// ==========================================
// 辅助函数：计算打字机延迟
// ==========================================
function calculateTypingDelay(text, isFirstMessage) {
    const baseDelay = isFirstMessage ? 500 : 1500;
    const msPerChar = 60;
    let delay = baseDelay + (text.length * msPerChar);
    return Math.min(delay, 3000); // 最大延迟不超过3秒
}

// ==========================================
// 处理 AI 回复内容解析与渲染
// ==========================================
async function handleAiReplyContent(fullResponse, chat, targetChatId, targetChatType) {
    if (!fullResponse) {
    showToast('AI返回了空内容，可能被截断或拦截了');
    console.error("AI返回了空内容，可能被截断或拦截了"); 
    return;
}   
    console.log("🟢 开始处理 AI 回复:", fullResponse.substring(0, 50) + "..."); 
    // ★ 记录本次通话会话ID，用于挂断后中止生成
    const capturedCallSessionId = (targetChatType === 'private' && chat?.currentCallSessionId)
        ? chat.currentCallSessionId : null;
    let newMessagesForDB = [];
    try {        
        let cleanResponse = fullResponse;
        cleanResponse = cleanResponse.replace(/^```\w*\s*$/gm, '');
        cleanResponse = cleanResponse.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();


        const contentSplitRegex = /###\s*🎭\s*(?:正文|思考).*/i;
        if (contentSplitRegex.test(cleanResponse)) {
            const parts = cleanResponse.split(contentSplitRegex);
            if (parts.length > 1) {
                console.log("🧠 AI 导演侧写 (已隐藏):", parts[0].trim());
                cleanResponse = parts[1];
            }
        } else if (cleanResponse.includes('### 🧠')) {
            console.warn("⚠️ 检测到思考过程但未找到正文标记");
        }

        cleanResponse = cleanResponse.trim();

        // ======== 👇 终极修复：全局最高优先级拦截挂断指令 👇 ========
        let shouldHangup = false;
        if (chat.callMode) {
            // 不管 AI 把指令藏在开头、中间还是末尾，只要匹配到就触发
            const hangupMatch = cleanResponse.match(/\[[^\[\]]*挂断了通话\]/);
            if (hangupMatch) {
                shouldHangup = true;
                // 将挂断指令及它后面的废话全部一刀切掉，防止被渲染成气泡
                cleanResponse = cleanResponse.substring(0, hangupMatch.index).trim();
                console.log("☎️ 检测到 AI 挂断指令，已提前抹除并准备挂断。");
            }
        }
        
        // 如果 AI 这一轮除了输出挂断指令外，一句话都没说，直接执行挂断并返回
        if (shouldHangup && !cleanResponse) {
            if (typeof clearCallUserArea === 'function') clearCallUserArea();
            if (typeof aiHangupCall === 'function') await aiHangupCall();
            return;
        }
        // ======== 👆 修复结束 👆 ========

        if (targetChatType === 'private' && (chat.offlineModeEnabled || chat.callMode === 'video')) {
            let processed = cleanResponse;
            processed = processed.replace(/\r\n/g, '\n');
            processed = processed.replace(/([^\n])\s*(\[.*?[:：])/g, '$1\n$2');
            processed = processed.replace(/^```\w*\s*$/gm, '');
            processed = processed.replace(/^#+\s+.*$/gm, '');
            processed = processed.replace(/\]\s*\[/g, ']\n[');
            processed = processed.replace(/([^\n])\s*(>>>)/g, '$1\n$2');
            
            const lines = processed.split('\n');
            let isFirstLine = true;

            for (let line of lines) {
                line = line.trim();
                
                if (!line || line === '[' || line === ']' || line === '[]' || line === '][') continue;
                if (/^[\d]+\.\s/.test(line)) continue;
                if (line.includes('意图：') || line.includes('情绪：') || line.includes('锚点：')) continue;
                if (line.includes('问题：') || line.includes('优点：')) continue;

                const cleanTextForCalc = line.replace('>>>', '').replace(/\[.*?\]/g, '');
                const delay = calculateTypingDelay(cleanTextForCalc, isFirstLine);
                await new Promise(r => setTimeout(r, delay));
                
                // ★ 挂断中止：通话期间若会话已结束则停止继续生成
                if (capturedCallSessionId && chat.currentCallSessionId !== capturedCallSessionId) return;
                isFirstLine = false;

                const statusRegex = /\[?.*?更新状态为[:：](.*?)(?:\]|$)/;
                const statusMatch = line.match(statusRegex);
                if (statusMatch) {
                    let newStatus = statusMatch[1].trim().replace(/[\])]+$/, '').trim();
                    if (newStatus) {
                        chat.status = newStatus;
                        const statusTextEl = document.getElementById('chat-room-status-text');
                        if (statusTextEl) statusTextEl.textContent = chat.status;
                        if(typeof renderCharacters === 'function') renderCharacters();

                        const statusMsg = {
                            id: `msg_status_${Date.now()}_${Math.random()}`,
                            role: 'assistant',
                            content: line,
                            parts: [{ type: 'text', text: line }],
                            timestamp: Date.now()
                        };
                        if (chat.currentCallSessionId) statusMsg.callSessionId = chat.currentCallSessionId;
                        chat.history.push(statusMsg);
                        newMessagesForDB.push(statusMsg);
                        continue;
                    }
                }

                let messageContent = "";
                if (line.startsWith('>>>')) {
                    let speech = line.substring(3).trim();
                    speech = speech.replace(/\]+$/, '');
                    speech = speech.replace(/^["'「『""'']+/, '').replace(/["'」』""'']+$/, '');
                    messageContent = `[${chat.realName}的消息：${speech}]`;
                } 
                else if (/^\[.*?的消息：[\s\S]+?\]$/.test(line)) {
                    const match = line.match(/^\[.*?的消息：([\s\S]+?)\]$/);
                    let speech = match ? match[1] : line;
                    speech = speech.replace(/\]+$/, '');
                    speech = speech.replace(/^["'「『""'']+/, '').replace(/["'」』""'']+$/, '');
                    messageContent = `[${chat.realName}的消息：${speech}]`;
                } 
                else {           
                    let rawText = line.trim();
                    if (rawText.includes('[system-narration:')) {
                        rawText = rawText.replace(/\[system-narration:/g, '');
                    }
                    rawText = rawText.replace(/\[.*?的消息：/g, '');
                    rawText = rawText.replace(/\]+$/, '');
                    
                    if (rawText.startsWith('[system-narration:') && rawText.endsWith(']')) {
                        rawText = rawText.replace(/^\[system-narration:/, '').replace(/\]$/, '');
                    }
                    if (/^\[(user-narration|system-narration|user|model|assistant)[:：]?\s*\]?$/.test(rawText)) {
                        continue; 
                    }
                    if (rawText === '[]' || rawText === '[:]' || rawText === '()' || !rawText) {
                        continue;
                    }
                    messageContent = `[system-narration:${rawText}]`;
                }

                const message = {
                    id: `msg_${Date.now()}_${Math.random()}`,
                    role: 'assistant',
                    content: messageContent,
                    parts:[{ type: 'text', text: messageContent }],
                    timestamp: Date.now()
                };
                if (chat.currentCallSessionId) message.callSessionId = chat.currentCallSessionId;
                chat.history.push(message);
                addMessageBubble(message, targetChatId, targetChatType);
                if (chat.callMode === 'video' && typeof appendCallNarration === 'function') {
                    const narrationMatch = messageContent.match(/^\[system-narration:([\s\S]+?)\]$/);
                    const dialogueMatch = messageContent.match(/\[.*?的消息：([\s\S]+?)\]$/);
                    if (narrationMatch) {
                        appendCallNarration(narrationMatch[1]);
                    } else if (dialogueMatch) {
                        appendCallDialogue(dialogueMatch[1]);
                    }
                }
                newMessagesForDB.push(message);
            }
        } else {
            let processedResponse = cleanResponse;
            processedResponse = processedResponse.replace(/\]\s*\[/g, ']\n[');
            processedResponse = processedResponse.replace(/([^\n>])\s*\[(?!system-narration|system-display)/g, '$1\n[');
            processedResponse = processedResponse.replace(/\]\s*([^\n<])/g, ']\n$1');

            const trimmedResponse = processedResponse.trim();
            let messages;

            if (trimmedResponse.startsWith('<') && trimmedResponse.endsWith('>')) {
                messages =[{ type: 'html', content: trimmedResponse }];
            } else {
                messages = getMixedContent(processedResponse).filter(item => item.content.trim() !== '');
            }

            let isFirstMsg = true;

            for (const item of messages) {
                let textLen = item.content.replace(/\[.*?：/g, '').replace(/\]/g, '').length;
                if (textLen < 5) textLen = 5;
                const delay = calculateTypingDelay('x'.repeat(textLen), isFirstMsg);
                await new Promise(resolve => setTimeout(resolve, delay));
                
                // ★ 挂断中止
                if (capturedCallSessionId && chat.currentCallSessionId !== capturedCallSessionId) return;
                isFirstMsg = false;

                const aiWithdrawRegex = /\[(.*?)撤回了上一条消息：([\s\S]*?)\]/;
                const withdrawMatch = item.content.match(aiWithdrawRegex);
                if (withdrawMatch) {
                    const characterName = withdrawMatch[1];
                    const originalContent = withdrawMatch[2];
                    let lastAssistantMessageIndex = -1;
                    for (let i = chat.history.length - 1; i >= 0; i--) {
                        if (chat.history[i].role === 'assistant' && !chat.history[i].isWithdrawn) {
                            lastAssistantMessageIndex = i;
                            break;
                        }
                    }
                    if (lastAssistantMessageIndex !== -1) {
                        const messageToWithdraw = chat.history[lastAssistantMessageIndex];
                        messageToWithdraw.isWithdrawn = true;
                        const cleanContentMatch = messageToWithdraw.content.match(/\[.*?的消息：([\s\S]+?)\]/);
                        messageToWithdraw.originalContent = cleanContentMatch ? cleanContentMatch[1] : messageToWithdraw.content;
                        messageToWithdraw.content = `[system: ${characterName} withdrew a message. Original: ${originalContent}]`;
                        renderMessages(false, true);
                        await saveMessageToDB(messageToWithdraw, targetChatId, targetChatType);     
                    }                    
                    continue;
                }

                if (targetChatType === 'private') {
                    const character = chat;
// --- 来电邀请检测 ---
                    const incomingCallRegex = /\[.*?发起了(语音|视频)通话邀请\]/;
                    const incomingCallMatch = item.content.match(incomingCallRegex);
                    if (incomingCallMatch && !chat.callMode) {
                        const callType = incomingCallMatch[1] === '语音' ? 'voice' : 'video';
                        const typeName = incomingCallMatch[1] + '通话';
                        const preSessionId = `call_${Date.now()}`;
                        chat.currentCallSessionId = preSessionId;

                        const displayContent = `[system-display: ${chat.remarkName || chat.realName} 邀请你${typeName}]`;
                        const displayMsg = {
                            id: `msg_incoming_call_${Date.now()}_${Math.random()}`,
                            role: 'system',
                            content: displayContent,
                            parts: [],
                            timestamp: Date.now(),
                            isAiIgnore: true,
                            callSessionId: preSessionId 
                        };
                        chat.history.push(displayMsg);
                        newMessagesForDB.push(displayMsg);
                        addMessageBubble(displayMsg, targetChatId, targetChatType);

                        if (typeof showIncomingCall === 'function') {
                            showIncomingCall(callType, chat);
                        }
                        break;
                    }
                    // --- 来电检测结束 ---

                    const standardMsgMatch = item.content.match(/\[(.*?)的消息：([\s\S]+?)\]/);
                    const aiQuoteRegex = /\[.*?引用["“](.*?)["”]并回复[:：]([\s\S]*?)\]/;
                    const aiQuoteMatch = item.content.match(aiQuoteRegex);

                    if (standardMsgMatch) {
                        const contentText = standardMsgMatch[2];
                        const fixedContent = `[${character.realName}的消息：${contentText}]`;
                        const message = {
                            id: `msg_${Date.now()}_${Math.random()}`,
                            role: 'assistant',
                            content: fixedContent,
                            parts: [{ type: 'text', text: fixedContent }],
                            timestamp: Date.now(),
                        };
                        if (chat.currentCallSessionId) message.callSessionId = chat.currentCallSessionId;
                        chat.history.push(message);
                        addMessageBubble(message, targetChatId, targetChatType);
                        if (chat.callMode && typeof appendCallDialogue === 'function') {
                            const match = fixedContent.match(/\[.*?的消息：([\s\S]+?)\]$/);
                            if (match) appendCallDialogue(match[1]);
                        }
                        newMessagesForDB.push(message);

                    } else if (aiQuoteMatch) {
                        const quotedText = aiQuoteMatch[1];
                        const replyText = aiQuoteMatch[2];
                        const originalMessage = chat.history.slice().reverse().find(m => {
                            if (m.role === 'user') {
                                const userMessageMatch = m.content.match(/\[.*?的消息：([\s\S]+?)\]/);
                                const userMessageText = userMessageMatch ? userMessageMatch[1] : m.content;
                                return userMessageText.trim() === quotedText.trim();
                            }
                            return false;
                        });

                        const message = {
                            id: `msg_${Date.now()}_${Math.random()}`,
                            role: 'assistant',
                            content: `[${character.realName}的消息：${replyText}]`,
                            parts: [{ type: 'text', text: `[${character.realName}的消息：${replyText}]` }],
                            timestamp: Date.now(),
                        };

                        if (originalMessage) {
                            message.quote = {
                                messageId: originalMessage.id,
                                senderId: 'user_me',
                                content: quotedText
                            };
                        }
                        if (chat.currentCallSessionId) message.callSessionId = chat.currentCallSessionId;
                        chat.history.push(message);
                        newMessagesForDB.push(message); 
                        addMessageBubble(message, targetChatId, targetChatType);

                    } else {
                        const statusRegex = /\[?.*?更新状态为[:：](.*?)(?:\]|$)/;
                        const statusMatch = item.content.match(statusRegex);
                        if (statusMatch) {
                            let newStatus = statusMatch[1].trim().replace(/[\])]+$/, '').trim();
                            if (newStatus) {
                                chat.status = newStatus;
                                const statusTextEl = document.getElementById('chat-room-status-text');
                                if (statusTextEl) statusTextEl.textContent = newStatus;
                                if(typeof renderCharacters === 'function') renderCharacters();
                            }
                        }
                        const receivedTransferRegex = /\[.*?的转账：.*?元；备注：.*?\]/;
                        const giftRegex = /\[.*?送来的礼物：.*?\]/;
                        
                        const message = {
                            id: `msg_${Date.now()}_${Math.random()}`,
                            role: 'assistant',
                            content: item.content.trim(),
                            parts:[{ type: item.type, text: item.content.trim() }],
                            timestamp: Date.now(),
                        };

                        if (receivedTransferRegex.test(message.content)) {
                            message.transferStatus = 'pending';
                        } else if (giftRegex.test(message.content)) {
                            message.giftStatus = 'sent';
                        }
                        if (chat.currentCallSessionId) message.callSessionId = chat.currentCallSessionId;
                        chat.history.push(message);
                        newMessagesForDB.push(message);
                        addMessageBubble(message, targetChatId, targetChatType);
                    }
                } 
                else if (targetChatType === 'group') {
                    const group = chat;
                    const standardRegex = /\[(.*?)((?:的消息|的语音|的表情包|发送的表情包|发来的照片\/视频))[:：]/;
                    const quoteRegex = /\[(.*?)引用["“](.*?)["”]并回复[:：]([\s\S]*?)\]/;

                    const quoteMatch = item.content.match(quoteRegex);
                    const standardMatch = item.content.match(standardRegex);

                    if (quoteMatch) {
                        const senderName = quoteMatch[1];
                        const quotedText = quoteMatch[2]; 
                        const replyText = quoteMatch[3];  

                        const sender = group.members.find(m => (m.realName === senderName || m.groupNickname === senderName));
                        
                        if (sender) {
                            const originalMessage = group.history.slice().reverse().find(m => {
                                let contentText = m.content;
                                const textMatch = m.content.match(/\[.*?的消息：([\s\S]+?)\]/);
                                if (textMatch) contentText = textMatch[1];
                                return contentText.trim().includes(quotedText.trim());
                            });

                            const messageContent = `[${sender.realName}的消息：${replyText}]`; 
                            const message = {
                                id: `msg_${Date.now()}_${Math.random()}`,
                                role: 'assistant',
                                content: messageContent,
                                parts: [{ type: 'text', text: messageContent }],
                                timestamp: Date.now(),
                                senderId: sender.id
                            };

                            if (originalMessage) {
                                message.quote = {
                                    messageId: originalMessage.id,
                                    senderId: originalMessage.senderId || 'unknown',
                                    content: quotedText
                                };
                            }

                            group.history.push(message);
                            addMessageBubble(message, targetChatId, targetChatType);
                            newMessagesForDB.push(message); 
                        }
                    } 
                    else if (standardMatch || item.char) {
                        const senderName = item.char || (standardMatch[1]);
                        const sender = group.members.find(m => (m.realName === senderName || m.groupNickname === senderName));
                        
                        if (sender) {
                            const message = {
                                id: `msg_${Date.now()}_${Math.random()}`,
                                role: 'assistant',
                                content: item.content.trim(),
                                parts:[{ type: item.type, text: item.content.trim() }],
                                timestamp: Date.now(),
                                senderId: sender.id
                            };
                            group.history.push(message);
                            addMessageBubble(message, targetChatId, targetChatType);
                            newMessagesForDB.push(message);
                        }
                    }
                }
            } 
        } 

        // 等待 AI 的打字机动画全走完（话都说出口了），我们再关断电话
        if (shouldHangup) {
            // 停顿 2.5 秒，让用户有充足的时间看清最后那句话
            await new Promise(resolve => setTimeout(resolve, 2000)); 
            
            if (typeof aiHangupCall === 'function') {
                await aiHangupCall();
            }
        }

        if (targetChatType === 'private' && chat.callMode && chat.callConnected === false && !chat.isIncomingCall && typeof onCallConnected === 'function') {
            onCallConnected();
        }

        // 清空用户区（AI 回复完成）
        if (targetChatType === 'private' && chat.callMode && typeof clearCallUserArea === 'function') {
            clearCallUserArea();
        }
        
        await saveMessagesToDB(newMessagesForDB, targetChatId, targetChatType);
        await saveSingleChat(targetChatId, targetChatType);
        renderChatList();

        // Step 2：若此刻在后台，弹系统通知（标题=角色名，内部已判权限/开关/可见性）
        if (window.NotifyCenter) {
            NotifyCenter.notifyMessages(chat, targetChatType, newMessagesForDB);
        }

    } catch (error) {
        console.error("🔴 处理 AI 回复时发生错误:", error);
    }
}

// ==========================================
// 触发 AI 请求 (Fetch 逻辑)
// ==========================================
// 修改函数签名，增加 isBackground = false
// 修改函数签名，增加第四个参数 proactiveApiPresetName
async function getAiReply(chatId, chatType, isBackground = false, proactiveApiPresetName = null) {
    // 【核心新增】：如果后台触发时，用户恰好在这个聊天室里盯着看，直接转为"前台处理"
    const isCurrentChat = (typeof currentChatId !== 'undefined' && currentChatId === chatId && currentChatType === chatType);
    if (isCurrentChat) {
        isBackground = false; 
    }

    if (isGenerating && !isBackground) return;

    // 👇 【核心修复 1】：必须先获取 chat 对象，再往下执行读取操作
    const chat = (chatType === 'private') ? db.characters.find(c => c.id === chatId) : db.groups.find(g => g.id === chatId);
    if (!chat) return;

    // ==========================================
    // 🌟 API 配置优先级核心逻辑重构
    // 优先级：主动消息专用预设 > 聊天室自定义预设 > 全局默认
    // ==========================================
    let effectiveApiSettings = db.apiSettings || {};
    const _overrideName = proactiveApiPresetName || chat.chatApiPreset || null;
    
    if (_overrideName) {
        const _preset = (db.apiPresets || []).find(x =>
            x.name === _overrideName && (!x.type || x.type === 'chat')
        );
        if (_preset && _preset.data) {
            // 合并：预设覆盖全局
            effectiveApiSettings = { ...db.apiSettings, ..._preset.data };
        }
    }
    
    const { url, key, model, provider } = effectiveApiSettings;
    const streamEnabled = effectiveApiSettings.streamEnabled ?? true; 
    
    if (!url || !key || !model) {
        if (!isBackground) {
            showToast('请先在"api"应用中完成设置！');
            switchScreen('api-settings-screen');
        }
        return;
    }
    
    // 只有在前台处理时，才修改 UI 和 锁定发信状态
    if (!isBackground) {
        isGenerating = true;
        if (chatType === 'private' && chat.callMode) {
            document.getElementById('call-switch-btn')?.setAttribute('disabled', '');
            document.getElementById('call-mic-btn')?.setAttribute('disabled', '');
        }
        if (chatType === 'private' && chat.callMode && typeof clearCallDialogue === 'function') {
            clearCallDialogue();
        }
        
        // ★ 通话中AI回复：头像光晕
        if (chatType === 'private' && chat.callMode) {
            document.getElementById('call-identity')?.classList.add('ai-generating');
        }
        getReplyBtn.disabled = true;
        regenerateBtn.disabled = true;
        const typingName = chatType === 'private' ? chat.remarkName : chat.name;
        
let actionStatusText = '正在输入中...';
if (chatType === 'private' && chat.offlineModeEnabled) {
    actionStatusText = '正在行动中...';
} else if (chatType === 'private' && chat.callMode) {
    actionStatusText = '通话中...';
}
        typingIndicator.textContent = `"${typingName}"${actionStatusText}`;
        typingIndicator.style.display = 'block';
        messageArea.scrollTop = messageArea.scrollHeight;
    }
    
    let retrievedContext = '';
    if (chat.vectorMemoryEnabled) {
        retrievedContext = await buildRetrievedMemoryContext(
            chat.history || [],
            chat
        );
    }
    
    try {
        let systemPrompt, requestBody;
        const isCompatibilityMode = effectiveApiSettings.compatibilityModeEnabled || false; 
        if (chatType === 'private') {
            systemPrompt = generatePrivateSystemPrompt(chat, retrievedContext);
        } else {
            systemPrompt = generateGroupSystemPrompt(chat, retrievedContext);
}

        let rawHistory = chat.history.slice(-chat.maxMemory);
        const historySlice = rawHistory.filter(msg => {
            if (msg.isAiIgnore) return false;
            return true;
        });

        let offlineReinforcement = null;
if (chatType === 'private' && chat.offlineModeEnabled) {
            const worldBooksWriting = (chat.worldBookIds ||[]).map(id => db.worldBooks.find(wb => wb.id === id && wb.position === 'writing')).filter(Boolean).map(wb => wb.content).join(''); 
            offlineReinforcement = `[🛑 严格执行以下写作手册]
## 1. 🧠 动笔前的快速自问（100字以内，无需输出，心底自问）
1.  **人设**：**往上看一眼双方最后的互动内容**，根据${chat.realName}的人设，他/她现在会是什么心境？
2.  **回应**：${chat.myName}说的话，重点是哪个词？${chat.realName}该回应哪个点？
3.  **意图**：${chat.myName}这句话/行为，${chat.realName}会怎么理解？会觉得是试探、关心、还是随口一说？
4.  **时间**：现在是什么季节？是几点？
5.  **查重**：上一轮回复里是不是已经描写过${chat.realName}的声音、眼神，或者周围的环境？如果有，这一轮**绝对禁止**再次描写这些内容。

## 2. ✍️ 写作六大原则
${worldBooksWriting ? `1. **文风第一**：严格遵循【写作风格】设定：${worldBooksWriting}` : ''}
2. **人设为本**：${chat.realName}的反应必须符合他/她的设定
3. **拒绝"网文味"和"古早言情土味"**：
   - **严禁**使用"邪魅一笑"、"宠溺"、"彻底沦陷"、"命都给你"、"揉进骨血"等廉价网文词汇。
   - 保持文字的**现实逻辑**。真实的人不会立刻承认自己"输了"或"栽了"，不会直接投降。
4. **逻辑严密**：物理动作连续，物品去向明确，时间流逝合理。
5. **渐进变化**：${chat.realName}的情绪和情境的转变要合理，避免过度煽情
6. **拒绝冗余和重复**：
   - **严禁**连续两轮使用相同的比喻和形容词，如果想不到新的，就不要使用，改成白描。
   - 除非环境和角色状态变化，否则**绝对不要**反复描写同一个环境和状态。

## 3. 📤 强制输出格式
1. **叙事与对话**：聚焦${chat.realName}，自由混合描写（第三人称）和对话（只有${chat.realName}嘴巴说出口的话行首必须加 \`>>>\`，且不加引号）。
2. **心理活动**：${chat.realName}内心独白或一闪而过的念头，请用**单星号**包裹。
   - 格式：\`*心里的想法*\`
3. **状态速写（频繁更新）**：
   - 格式：\`[${chat.realName}更新状态为：动作或心情速写]\`
4. **人称**：全文使用"他/她"或"${chat.realName}"指代主角，使用"你"指代${chat.myName}，绝不使用"我"。

**输出示例**：
\`\`\`
${chat.realName}愣了一下，指尖无意识地摩挲着杯沿。
*明明是她先提出来的，现在却装作无事发生？*
他的视线落在桌角的咖啡渍上，没有抬头看你。
>>> ...嗯，也没什么要紧的。[${chat.realName}更新状态为：垂眸掩饰情绪]
\`\`\`

## 4.🛑 **动笔前的自我灵魂拷问**：
1. **人设校验**：回到最上方，重新浏览一遍**👤 角色档案**，问自己：这个反应符合${chat.realName}的性格吗？如果不符合，调整到符合为止。
2. **禁词检查**：如果不幸写出了网文的油腻土味，例如"宠溺"、"我栽了"、"彻底输了"等字眼，**请立刻将其删除**，并改写为一个具体的、无言的动作。

现在，根据下方${chat.myName}的最新动态开始创作。深呼吸，回想一下${chat.realName}的人设，然后自然地续写接下来的剧情。\n\n`;
        }
        
        // 视频通话写作手册（在 chat_feature_call.js 的 generateCallVideoReinforcement 中独立配置）
let callReinforcement = null;
if (chatType === 'private' && chat.callMode === 'video') {
    callReinforcement = typeof generateCallVideoReinforcement === 'function'
        ? generateCallVideoReinforcement(chat)
        : null;
}

// 两者互斥，取其一作为本次请求的写作手册注入
const activeReinforcement = offlineReinforcement || callReinforcement;

        if (provider === 'gemini') {
            const contents = historySlice.map(msg => {
                const role = (msg.role === 'assistant' || msg.role === 'model') ? 'model' : 'user';
                let parts;
                
                if (msg.parts && msg.parts.length > 0) {
     parts = msg.parts.map(p => {
        if (p.type === 'text' || p.type === 'html') {
            let text = p.text; 
            if (!chat.offlineModeEnabled && !chat.callMode) {
                text = text.replace(/\[system-narration:([\s\S]*?)\]/g, '$1');
            }
            if (chat.offlineModeEnabled && role === 'user') {
                text = text.replace(/的消息：/g, '说：');
            }
            return { text: text };
                        } else if (p.type === 'image') {
                            let mimeType = 'image/jpeg';
                            let data = p.data;
                            const match = p.data.match(/^data:(image\/(\w+));base64,(.*)$/);
                            if (match) {
                                mimeType = match[1];
                                data = match[3];
                            }
                            return { inline_data: { mime_type: mimeType, data: data } };
                        }
                        return null;
                    }).filter(p => p);
                } else {
                    parts = [{ text: processingContent }];
                }
                return { role, parts };
}).filter(c => c.parts && c.parts.length > 0 && c.parts.some(p => p.text?.trim() || p.inline_data));
            
            if (activeReinforcement){
                let targetIndex = -1;
                for (let i = contents.length - 1; i >= 0; i--) {
                    if (contents[i].role === 'user') {
                        targetIndex = i;
                    } else {
                        break; 
                    }
                }

                if (targetIndex !== -1) {
                    const targetMsg = contents[targetIndex];
                    const injectionText = `${activeReinforcement}`; 
                    
                    if (targetMsg.parts && targetMsg.parts.length > 0) {
                        const textPart = targetMsg.parts.find(p => p.text);
                        if (textPart) {
                            textPart.text = `${injectionText}\n\n==========\n${chat.myName}最新动态：\n${textPart.text}`;
                        } else {
                            targetMsg.parts.unshift({ text: injectionText });
                        }
                    } else {
                        targetMsg.parts = [{ text: injectionText }];
                    }
                } else {
                    contents.push({ role: 'user', parts: [{ text: activeReinforcement }] });
                }
            }

            requestBody = {
    contents: contents,
    system_instruction: { parts: [{ text: systemPrompt }] },
    generationConfig: {
        temperature: effectiveApiSettings.temperature !== undefined ? effectiveApiSettings.temperature : 0.8
    }
};
        }
        else {
            let apiMessages = [{ role: 'system', content: systemPrompt }];
            
            historySlice.forEach(msg => {
                let content;
                if (msg.role === 'user' && msg.quote) {
                     const replyTextMatch = msg.content.match(/\[.*?[:：]([\s\S]+?)\]/); 
                     const replyText = replyTextMatch ? replyTextMatch[1] : msg.content;
                     content = `[${chat.myName}引用"${msg.quote.content}"并回复：${replyText}]`;
                } else {
                    if (msg.parts && msg.parts.length > 0) {
                        const hasImage = msg.parts.some(p => p.type === 'image');

                        if (hasImage) {
                            // 有图片时才使用数组格式（vision格式），支持图文混合
                            content = msg.parts.map(p => {
                                if (p.type === 'text' || p.type === 'html') {
                                    let text = p.text;
                                    if (chat.offlineModeEnabled && msg.role === 'user') {
                                        text = text.replace(/的消息：/g, '说：');
                                    }
                                    return { type: 'text', text: text };
                                } else if (p.type === 'image') {
                                    return { type: 'image_url', image_url: { url: p.data } };
                                }
                                return null;
                            }).filter(p => p);
                        } else {
                            // 没有图片时，始终拼接成纯字符串，兼容所有API
                            content = msg.parts.map(p => {
    if (p.type === 'text' || p.type === 'html') {
        let text = p.text;
        if (!chat.offlineModeEnabled && !chat.callMode) {
            text = text.replace(/\[system-narration:([\s\S]*?)\]/g, '$1');
        }
        if (chat.offlineModeEnabled && msg.role === 'user') {
            text = text.replace(/的消息：/g, '说：');
        }
        return text;
    }
                                return '';
                            }).join('').trim();
                        }
                    } else {
                        content = msg.content;
                    }
                }

                // 跳过 content 为空的消息，避免部分 API 返回 400
                const isEmpty = content === null || content === undefined ||
                    (typeof content === 'string' && content.trim() === '') ||
                    (Array.isArray(content) && content.length === 0);
                if (!isEmpty) {
                    apiMessages.push({ role: msg.role, content: content });
                }
            });

            if (activeReinforcement) {
                let insertIndex = apiMessages.length;
                for (let i = apiMessages.length - 1; i >= 0; i--) {
                    if (apiMessages[i].role === 'user') {
                        insertIndex = i;
                    } else {
                        break; 
                    }
                }
                const instructionMsg = { role: 'system', content: activeReinforcement };
                apiMessages.splice(insertIndex, 0, instructionMsg);
            }

            const _temp = effectiveApiSettings.temperature !== undefined ? effectiveApiSettings.temperature : 0.8;
requestBody = { model: model, messages: apiMessages, stream: streamEnabled, temperature: _temp };
        }

        const endpoint = (provider === 'gemini') ? `${url}/v1beta/models/${model}:streamGenerateContent?key=${getRandomValue(key)}` : `${url}/v1/chat/completions`;
        const headers = (provider === 'gemini') ? { 'Content-Type': 'application/json' } : {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`
        };
        
        callAbortController = new AbortController();          // ← 每次请求前重置
const response = await fetch(endpoint, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(requestBody),
    signal: callAbortController.signal                // ← 挂载信号
});
        if (!response.ok) {
            const error = new Error(`API Error: ${response.status} ${await response.text()}`);
            error.response = response;
            throw error;
        }

        if (streamEnabled) {
            await processStream(response, chat, provider, chatId, chatType);
        } else {
            const result = await response.json();
            let fullResponse = "";
            if (provider === 'gemini') {
                fullResponse = result.candidates?.[0]?.content?.parts?.[0]?.text || "";
            } else {
                fullResponse = result.choices[0].message.content || "";
            }
            await handleAiReplyContent(fullResponse, chat, chatId, chatType);
        }

    } catch (error) {
    if (error.name === 'AbortError') {
        // 通话已挂断，fetch 被主动中止，静默处理即可
    } else if (!isBackground) {
        showApiError(error);
        if (chatType === 'private' && chat && chat.callMode && !chat.callConnected
            && typeof endCallAiFailure === 'function') {
            endCallAiFailure();
        }
    } else {
        console.error("[Timer后台固定模式错误]", error);
    }
}finally {
        // 同样，只有前台处理时，才解开 UI
        if (!isBackground) {
            isGenerating = false;
            document.getElementById('call-switch-btn')?.removeAttribute('disabled');
document.getElementById('call-mic-btn')?.removeAttribute('disabled');
            getReplyBtn.disabled = false;
            regenerateBtn.disabled = false;
            typingIndicator.style.display = 'none';
            // ★ 移除通话光晕
            document.getElementById('call-identity')?.classList.remove('ai-generating');
        }
    }
}

// ==========================================
// 处理流式输出 (Stream)
// ==========================================
async function processStream(response, chat, apiType, targetChatId, targetChatType) {
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let fullResponse = "", accumulatedChunk = "";
    for (; ;) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulatedChunk += decoder.decode(value, { stream: true });
        if (apiType === "openai" || apiType === "deepseek" || apiType === "claude" || apiType === "newapi") {
            const parts = accumulatedChunk.split("\n\n");
            accumulatedChunk = parts.pop();
            for (const part of parts) {
                if (part.startsWith("data: ")) {
                    const data = part.substring(6);
                    if (data.trim() !== "[DONE]") {
                        try {
                            fullResponse += JSON.parse(data).choices[0].delta?.content || "";
                        } catch (e) { /* ignore */ }
                    }
                }
            }
        }
    }

    if (apiType === "gemini") {
        try {
            const textRegex = /"text":\s*"((?:[^"\\]|\\.)*)"/g;
            let match;
            fullResponse = ""; 
            while ((match = textRegex.exec(accumulatedChunk)) !== null) {
                let contentText = match[1];
                try {
                    contentText = JSON.parse(`"${contentText}"`); 
                } catch (e) { /* ignore */ }
                fullResponse += contentText;
            }
        } catch (e) {
            console.error("Error parsing Gemini stream:", e);
        }
    }
    await handleAiReplyContent(fullResponse, chat, targetChatId, targetChatType);
}

// ==========================================
// 重新生成回复功能
// ==========================================
async function handleRegenerate() {
    if (isGenerating) return;

    const chat = (currentChatType === 'private')
        ? db.characters.find(c => c.id === currentChatId)
        : db.groups.find(g => g.id === currentChatId);

    if (!chat || !chat.history || chat.history.length === 0) {
        showToast('没有可供重新生成的内容。');
        return;
    }

    let lastInputIndex = -1;
    for (let i = chat.history.length - 1; i >= 0; i--) {
        if (chat.history[i].role !== 'assistant' && chat.history[i].role !== 'model') {
            lastInputIndex = i;
            break;
        }
    }

    if (lastInputIndex === -1 || lastInputIndex === chat.history.length - 1) {
        showToast('AI尚未回复，无法重新生成。');
        return;
    }

    const originalLength = chat.history.length;
    const removedMessages = chat.history.splice(lastInputIndex + 1);

    if (chat.history.length === originalLength) {
        showToast('未找到AI的回复，无法重新生成。');
        return;
    }

    if (currentChatType === 'private') {
        const statusRegex = /更新状态为[:：](.*?)(?:\]|$)/;
        
        let statusWasChangedInDeletedMsg = false;
        for (const removedMsg of removedMessages) {
            if (statusRegex.test(removedMsg.content)) {
                statusWasChangedInDeletedMsg = true;
                break;
            }
        }

        if (statusWasChangedInDeletedMsg) {
            let foundStatus = false;
            for (let i = chat.history.length - 1; i >= 0; i--) {
    const msg = chat.history[i];

    // ★ 只追溯 AI 自己写的状态，不能被用户状态通知误导
    if (msg.role !== 'assistant' && msg.role !== 'model') continue;  // ← 新增

    const match = msg.content.match(statusRegex);
    if (match) {
        let newStatus = match[1].trim().replace(/[\])]+$/, '').trim();
        if (newStatus) {
            chat.status = newStatus;
            foundStatus = true;
            break;
        }
    }
}
        }

        const statusTextEl = document.getElementById('chat-room-status-text');
        if (statusTextEl) statusTextEl.textContent = chat.status;
                        if(typeof renderCharacters === 'function') renderCharacters();
    }
await deleteMessagesFromDB(removedMessages.map(m=>m.id));
    await saveSingleChat(currentChatId, currentChatType);
    currentPage = 1; 
    renderMessages(false, true); 
    await getAiReply(currentChatId, currentChatType);
}