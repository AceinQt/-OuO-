            // --- 线下模式 ---
            async function openOfflineModeSettings() {
                if (currentChatType !== 'private') {
                    showToast('线下模式仅支持单人聊天');
                    return;
                }
                const chat = db.characters.find(c => c.id === currentChatId);
                if (!chat) return;

                const wasEnabled = chat.offlineModeEnabled;
                const isNowEnabled = !wasEnabled; // 直接取反

                // 使用专用的 AppUI.confirm 替代原生 confirm
                const confirmMsg = isNowEnabled 
                    ? '确定要开启线下模式吗？\n开启后将进入面对面互动模式。' 
                    : '确定要关闭线下模式吗？\n关闭后将恢复正常的手机聊天。';

                const isConfirmed = await AppUI.confirm(confirmMsg, "模式切换");
                
                if (!isConfirmed) {
                    return; // 用户点击取消则中断
                }

                // 确认后更新数据
                chat.offlineModeEnabled = isNowEnabled;
                const now = Date.now();

                // =======================================================
                // 情况 1: 退出线下模式
                // =======================================================
                if (wasEnabled && !isNowEnabled) {
                    const endInstruction = `[system: 面对面情节结束。切换回手机聊天模式。恢复使用[${chat.realName}的消息：...] 格式。]`;
                    const instructionMsg = {
                        id: `msg_ins_off_${now}`,
                        role: 'user', 
                        content: endInstruction,
                        parts:[{ type: 'text', text: endInstruction }],
                        timestamp: now,
                        isHidden: true
                    };
                    chat.history.push(instructionMsg);

                    const displayMsg = {
                        id: `msg_vis_off_${now}`,
                        role: 'system',
                        content: `[system-display: 已退出线下模式]`,
                        parts:[],
                        timestamp: now + 1,
                        isAiIgnore: true 
                    };
                    chat.history.push(displayMsg);
                    addMessageBubble(displayMsg, currentChatId, currentChatType);
                    await saveMessagesToDB([instructionMsg, displayMsg], currentChatId, currentChatType); 
                }
                // =======================================================
                // 情况 2: 进入线下模式
                // =======================================================
                else if (!wasEnabled && isNowEnabled) {
                    const startInstruction = `[system: 场景切换：从现在开始，${chat.realName}与用户进行【面对面】互动。请根据人设直接描写动作和语言。]`;
                    const instructionMsg = {
                        id: `msg_ins_on_${now}`,
                        role: 'user', 
                        content: startInstruction,
                        parts:[{ type: 'text', text: startInstruction }],
                        timestamp: now,
                        isHidden: true 
                    };
                    chat.history.push(instructionMsg);

                    const displayMsg = {
                        id: `msg_vis_on_${now}`,
                        role: 'system',
                        content: `[system-display: 已开启线下模式]`,
                        parts:[],
                        timestamp: now + 1,
                        isAiIgnore: true 
                    };
                    chat.history.push(displayMsg);
                    addMessageBubble(displayMsg, currentChatId, currentChatType);
                    await saveMessagesToDB([instructionMsg, displayMsg], currentChatId, currentChatType);
                }

                await saveSingleChat(currentChatId, currentChatType);

                // 更新界面按钮状态和顶部呼吸灯
                updateOfflineModeUI(chat.offlineModeEnabled);
                
                const offlineBtn = document.querySelector('.expansion-item[data-action="offline-mode-settings"]');
                if (offlineBtn) {
                    if (chat.offlineModeEnabled) offlineBtn.classList.add('active');
                    else offlineBtn.classList.remove('active');
                }

                showToast(chat.offlineModeEnabled ? '线下模式已开启' : '线下模式已关闭');
            }

            function applyOfflineNarrationCss(chatId, css) {
                const styleId = `offline-narration-style-${chatId}`;
                let styleElement = document.getElementById(styleId);

                if (css && css.trim()) {
                    if (!styleElement) {
                        styleElement = document.createElement('style');
                        styleElement.id = styleId;
                        document.head.appendChild(styleElement);
                    }
                    // 限制作用域在当前聊天室
                    const scopedCss = `#chat-room-screen.chat-active-${chatId} ${css}`;
                    styleElement.textContent = scopedCss;
                } else {
                    if (styleElement) styleElement.remove();
                }
            }


            // 统一控制线下模式的 UI 状态（按钮禁用 + 状态灯颜色）
            function updateOfflineModeUI(isOffline) {
                // 1. 处理顶部状态灯 (Requirement 4)
                const indicator = document.querySelector('.online-indicator');
                if (indicator) {
                    // 线下模式为粉色(#FF69B4)，线上模式恢复默认绿色(var(--online-status-color))
                    indicator.style.backgroundColor = isOffline ? 'var(--primary-color)' : 'var(--online-status-color)';

                }

                // 2. 处理 Sticker Bar 按钮 (Requirement 3)
                // 需要禁用的按钮 ID 列表
                const buttonsToDisable = [
                    'voice-message-btn',       // 语音
                    'photo-video-btn',         // 照片/视频
                    'image-recognition-btn',   // 发送图片/识图
                    'sticker-toggle-btn',       // 表情包
                    'wallet-btn'               // --- 新增：转账/钱包按钮 ---
                ];

                buttonsToDisable.forEach(btnId => {
                    const btn = document.getElementById(btnId);
                    if (btn) {
                        btn.disabled = isOffline; // true则禁用，false则启用
                        // 禁用时禁止点击事件，防止触发 ripple 动画或弹窗
                        btn.style.pointerEvents = isOffline ? 'none' : 'auto';
                    }
                });
            }