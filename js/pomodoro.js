            function setupPomodoroSettings() {
                const settingsBtn = document.getElementById('pomodoro-focus-settings-btn');
                const settingsSidebar = document.getElementById('pomodoro-settings-sidebar');
                const settingsForm = document.getElementById('pomodoro-settings-form');
                const focusBgUpload = document.getElementById('pomodoro-focus-bg-upload');
                const taskCardBgUpload = document.getElementById('pomodoro-task-card-bg-upload');

                settingsBtn?.addEventListener('click', () => {
                    if (currentPomodoroTask) {
                        currentPomodoroSettingsContext = currentPomodoroTask.settings;
                        loadSettingsToPomodoroSidebar(currentPomodoroSettingsContext);
                        settingsSidebar.classList.add('open');
                    } else {
                        showToast('没有正在进行的专注任务');
                    }
                });

                settingsForm?.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    if (currentPomodoroSettingsContext) {
                        await savePomodoroSettingsFromSidebar(currentPomodoroSettingsContext);
                    }
                    settingsSidebar.classList.remove('open');
                });

                focusBgUpload?.addEventListener('change', async (e) => {
                    const file = e.target.files[0];
                    if (file && currentPomodoroSettingsContext) {
                        try {
                            const compressedUrl = await compressImage(file, { quality: 0.85, maxWidth: 1080, maxHeight: 1920 });
                            document.getElementById('pomodoro-focus-bg-url').value = compressedUrl;
                            currentPomodoroSettingsContext.focusBackground = compressedUrl;
                            applyPomodoroBackgrounds();
                            showToast('专注背景已更新，请保存设置');
                        } catch (error) {
                            showToast('背景压缩失败');
                        }
                    }
                });

                taskCardBgUpload?.addEventListener('change', async (e) => {
                    const file = e.target.files[0];
                    if (file && currentPomodoroSettingsContext) {
                        try {
                            const compressedUrl = await compressImage(file, { quality: 0.8, maxWidth: 800, maxHeight: 800 });
                            // 将上传的图片URL保存到当前任务的独立设置中
                            currentPomodoroSettingsContext.taskCardBackground = compressedUrl;
                            // 同时更新输入框的值，以便保存时能正确写入
                            document.getElementById('pomodoro-task-card-bg-url').value = compressedUrl;
                            showToast('卡片背景已更新，请保存设置');
                        } catch (error) {
                            showToast('背景压缩失败');
                        }
                    }
                });
            }

            function loadSettingsToPomodoroSidebar(settings) {
                const charSelect = document.getElementById('pomodoro-char-select');
                const userPersonaSelect = document.getElementById('pomodoro-user-persona-select');

                charSelect.innerHTML = '<option value="">不绑定</option>';
                db.characters.forEach(char => {
                    const option = document.createElement('option');
                    option.value = char.id;
                    option.textContent = char.remarkName;
                    if (settings.boundCharId === char.id) {
                        option.selected = true;
                    }
                    charSelect.appendChild(option);
                });

                userPersonaSelect.innerHTML = '<option value="">默认</option>';
                (db.userPersonas || []).forEach(preset => {
                    const option = document.createElement('option');
                    option.value = preset.nickname; 
    option.textContent = preset.nickname;
        if (settings.userPersona === preset.nickname) {
        option.selected = true;
    }
                    userPersonaSelect.appendChild(option);
                });

                document.getElementById('pomodoro-encouragement-minutes').value = settings.encouragementMinutes || 25;
                document.getElementById('pomodoro-poke-limit').value = settings.pokeLimit || 5;
                document.getElementById('pomodoro-focus-bg-url').value = settings.focusBackground || '';
                document.getElementById('pomodoro-task-card-bg-url').value = settings.taskCardBackground || '';
            }

            async function savePomodoroSettingsFromSidebar(settings) {
                const oldCharId = settings.boundCharId;
                const newCharId = document.getElementById('pomodoro-char-select').value;

                settings.boundCharId = newCharId;
                settings.userPersona = document.getElementById('pomodoro-user-persona-select').value;
                settings.encouragementMinutes = parseInt(document.getElementById('pomodoro-encouragement-minutes').value, 10) || 25;
                settings.pokeLimit = parseInt(document.getElementById('pomodoro-poke-limit').value, 10) || 5;
                settings.focusBackground = document.getElementById('pomodoro-focus-bg-url').value.trim();
                settings.taskCardBackground = document.getElementById('pomodoro-task-card-bg-url').value.trim();

                await savePomodoroData();
                applyPomodoroBackgrounds();

                // Update avatar in focus screen if it's active
                const focusAvatarEl = document.querySelector('#pomodoro-focus-screen .focus-avatar');
                if (settings.boundCharId) {
                    const boundChar = db.characters.find(c => c.id === settings.boundCharId);
                    if (boundChar && focusAvatarEl) {
                        focusAvatarEl.src = boundChar.avatar;
                    }
                } else if (focusAvatarEl) {
                    focusAvatarEl.src = 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg'; // Fallback
                }

                // 新增：如果更换了角色，则清空对话框
                if (oldCharId !== newCharId) {
                    const focusMessageBubble = document.querySelector('#pomodoro-focus-screen .focus-message-bubble');
                    if (focusMessageBubble) {
                        focusMessageBubble.classList.remove('visible');
                        focusMessageBubble.querySelector('p').textContent = '';
                    }
                }

                showToast('专注设置已保存');
            }

            function applyPomodoroBackgrounds() {
                const focusScreen = document.getElementById('pomodoro-focus-screen');

                // Apply focus screen background from the CURRENT task if it exists
                if (currentPomodoroTask && currentPomodoroTask.settings.focusBackground) {
                    focusScreen.style.backgroundImage = `url(${currentPomodoroTask.settings.focusBackground})`;
                    focusScreen.style.backgroundSize = 'cover';
                    focusScreen.style.backgroundPosition = 'center';
                } else {
                    focusScreen.style.backgroundImage = 'none';
                }

            }

            function setupPomodoroGlobalSettings() {
                const settingsBtn = document.getElementById('pomodoro-settings-btn');
                const sidebar = document.getElementById('pomodoro-global-settings-sidebar');
                const linkBtn = document.getElementById('link-global-pomodoro-world-book-btn');
                const modal = document.getElementById('global-pomodoro-world-book-selection-modal');
                const selectionList = document.getElementById('global-pomodoro-world-book-selection-list');
                const saveBtn = document.getElementById('save-global-pomodoro-world-book-selection-btn');

                settingsBtn?.addEventListener('click', () => {
                    sidebar.classList.add('open');
                });

                linkBtn?.addEventListener('click', () => {
                    if (!db.pomodoroSettings) {
                        db.pomodoroSettings = { globalWorldBookIds: [] };
                    }
                    const selectedIds = db.pomodoroSettings.globalWorldBookIds || [];
                    renderCategorizedWorldBookList(selectionList, db.worldBooks, selectedIds, 'global-pomodoro-wb-select');
                    modal.classList.add('visible');
                });

                saveBtn?.addEventListener('click', async () => {
                    const selectedIds = Array.from(selectionList.querySelectorAll('.item-checkbox:checked')).map(input => input.value);
                    if (!db.pomodoroSettings) {
                        db.pomodoroSettings = {};
                    }
                    db.pomodoroSettings.globalWorldBookIds = selectedIds;
                    await saveGlobalKeys(['pomodoroSettings']);
                    modal.classList.remove('visible');
                    showToast('全局专注世界书已更新');
                });
            }
            
                        
                                                function renderPomodoroTasks() {
                const taskListContainer = document.getElementById('pomodoro-task-list');
                const placeholder = document.getElementById('pomodoro-no-tasks-placeholder');
                if (!taskListContainer || !placeholder) return;

                taskListContainer.innerHTML = ''; // Clear existing tasks

                if (!db.pomodoroTasks || db.pomodoroTasks.length === 0) {
                    placeholder.style.display = 'block';
                    taskListContainer.style.display = 'none';
                    return;
                }

                placeholder.style.display = 'none';
                taskListContainer.style.display = 'flex';

                db.pomodoroTasks.forEach(task => {
                    const wrapper = document.createElement('div');
                    wrapper.className = 'task-card-wrapper';
                    wrapper.dataset.id = task.id;

                    const pomodorosText = task.mode === 'countdown' ? `倒计时模式` : '正计时模式';
                    const durationText = task.mode === 'countdown' ? `${task.duration}分钟` : '';

                    // 只使用任务自己的背景设置
                    const backgroundUrl = task.settings?.taskCardBackground;
                    let styleAttr = '';
                    let textStyle = '';

                    if (backgroundUrl) {
                        styleAttr = `style="background-image: url(${backgroundUrl}); background-size: cover; background-position: center;"`;
                        // 当有背景图时，让文字变白并增加阴影以提高可读性
                        textStyle = `style="color: white; text-shadow: 0 1px 3px rgba(0,0,0,0.5);"`;
                    }

                    wrapper.innerHTML = `
                    <div class="task-card" ${styleAttr}>
                        <div class="task-card-info">
                            <h4 class="task-card-title" ${textStyle}>${DOMPurify.sanitize(task.name)}</h4>
                            <p class="task-card-details" ${textStyle}>${pomodorosText} ${durationText}</p>
                        </div>
                        <button class="task-card-start-btn">开始</button>
                    </div>
                    <button class="task-card-delete-btn">删除</button>
                `;
                    taskListContainer.appendChild(wrapper);
                });
            }

            function setupPomodoroApp() {
                const createTaskBtn = document.getElementById('pomodoro-create-task-btn');
                const createModal = document.getElementById('pomodoro-create-modal');
                const createForm = document.getElementById('pomodoro-create-form');
                const modeRadios = document.querySelectorAll('input[name="pomodoro-mode"]');
                const durationOptions = document.getElementById('pomodoro-duration-options');
                const durationPills = durationOptions.querySelectorAll('.duration-pill');
                const customDurationInput = document.getElementById('pomodoro-custom-duration-input');

                // Focus Screen elements
                const focusScreen = document.getElementById('pomodoro-focus-screen');
                const focusTitleEl = focusScreen.querySelector('.focus-task-title');
                const focusTimerEl = focusScreen.querySelector('.focus-timer-display');
                const focusModeEl = focusScreen.querySelector('.focus-timer-mode');
                const startBtn = document.getElementById('pomodoro-start-btn');
                const pauseBtn = document.getElementById('pomodoro-pause-btn');
                const giveUpBtn = document.getElementById('pomodoro-giveup-btn');
                const focusAvatar = focusScreen.querySelector('.focus-avatar');
                const focusMessageBubble = focusScreen.querySelector('.focus-message-bubble');

                if (focusAvatar && focusMessageBubble) {
                    focusAvatar.addEventListener('click', () => {
                        // "Poke" feature logic
                        if (isPomodoroPaused || !pomodoroInterval || !currentPomodoroTask) return;

                        pomodoroIsInterrupted = true;
                        pomodoroPokeCount++;

                        const pokeLimit = currentPomodoroTask.settings.pokeLimit || 5;

                        if (pomodoroPokeCount > pokeLimit) {
                            showTypewriterMessage(focusMessageBubble.querySelector('p'), '传讯次数已经到达上限啦，请再专心一点吧宝宝^^');
                        } else {
                            getPomodoroAiReply('poke');
                        }
                    });
                }


                // --- Timer Core Logic ---
                function updateTimerDisplay() {
                    const hours = Math.floor(pomodoroRemainingSeconds / 3600);
                    const minutes = Math.floor((pomodoroRemainingSeconds % 3600) / 60);
                    const seconds = pomodoroRemainingSeconds % 60;

                    if (pomodoroRemainingSeconds >= 3600) {
                        focusTimerEl.textContent = `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
                    } else {
                        focusTimerEl.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
                    }
                }

                function updateTotalFocusedTimeDisplay() {
                    const totalMinutes = Math.floor(pomodoroCurrentSessionSeconds / 60);
                    const totalTimeEl = document.getElementById('pomodoro-total-focused-time');
                    if (totalTimeEl) {
                        totalTimeEl.textContent = `已专注 ${totalMinutes} 分钟`;
                    }
                }

                function stopTimer() {
                    clearInterval(pomodoroInterval);
                    pomodoroInterval = null;
                    isPomodoroPaused = true;
                    startBtn.style.display = 'inline-flex';
                    pauseBtn.style.display = 'none';
                }

                function startTimer() {
                    if (pomodoroInterval) return; // Already running

                    // NEW: Check for resume from a paused state
                    if (isPomodoroPaused && pomodoroCurrentSessionSeconds > 0) {
                        getPomodoroAiReply('resume');
                    }

                    isPomodoroPaused = false;
                    pomodoroIsInterrupted = false; // Also reset this flag on resume
                    startBtn.style.display = 'none';
                    pauseBtn.style.display = 'inline-flex';

                    pomodoroInterval = setInterval(() => {
                        if (currentPomodoroTask.mode === 'countdown') {
                            pomodoroRemainingSeconds--;
                        } else { // stopwatch
                            pomodoroRemainingSeconds++;
                        }
                        pomodoroCurrentSessionSeconds++;
                        updateTimerDisplay();
                        updateTotalFocusedTimeDisplay();

                        // Check for encouragement
                        if (currentPomodoroTask && currentPomodoroTask.settings) {
                            const encouragementMinutes = currentPomodoroTask.settings.encouragementMinutes || 25;
                            if (pomodoroCurrentSessionSeconds > 0 && (pomodoroCurrentSessionSeconds % (encouragementMinutes * 60)) === 0 && !pomodoroIsInterrupted) {
                                getPomodoroAiReply('encouragement');
                            }
                        }

                        if (currentPomodoroTask.mode === 'countdown' && pomodoroRemainingSeconds <= 0) {
                            stopTimer();
                            handlePomodoroCompletion();
                        }
                    }, 1000);
                }

                function pauseTimer() {
                    pomodoroIsInterrupted = true; // Pausing counts as an interruption
                    isPomodoroPaused = true;
                    clearInterval(pomodoroInterval);
                    pomodoroInterval = null;
                    startBtn.style.display = 'inline-flex';
                    pauseBtn.style.display = 'none';
                }

                // --- Event Listeners for Controls ---
                startBtn.addEventListener('click', startTimer);
                pauseBtn.addEventListener('click', pauseTimer);
                giveUpBtn.addEventListener('click', async () => {
                    if (await AppUI.confirm('确定要放弃当前任务吗？', "系统提示", "确认", "取消")) {
                        stopTimer();
                        currentPomodoroTask = null;
                        switchScreen('pomodoro-screen');
                    }
                });

                // Certificate modal listeners
                const certModal = document.getElementById('pomodoro-certificate-modal');
                const forwardCertBtn = document.getElementById('forward-certificate-btn');
                const closeCertBtn = document.getElementById('close-certificate-btn');

                forwardCertBtn.addEventListener('click', async () => {
                    const taskName = document.getElementById('cert-task-name').textContent;
                    const duration = document.getElementById('cert-duration').textContent;
                    const pokeCount = document.getElementById('cert-poke-count').textContent;
                    const chat = db.characters.find(c => c.id === currentPomodoroTask.settings.boundCharId);

                    if (chat) {
                        const messageContent = `[专注记录] 任务：${taskName}，时长：${duration}，期间与 ${chat.realName} 互动 ${pokeCount} 次。`;
                        const message = {
                            id: `msg_pomodoro_${Date.now()}`,
                            role: 'user',
                            content: messageContent,
                            parts: [{ type: 'text', text: messageContent }],
                            timestamp: Date.now(),
                            senderId: 'user_me'
                        };
                        chat.history.push(message);
                        await saveSingleChat(chat.id, 'private');
                        await saveMessageToDB(message, chat.id, 'private');
                        showToast('已转发到聊天框！');
                        renderChatList();
                    }
                    certModal.classList.remove('visible');
                    switchScreen('pomodoro-screen');
                });

                closeCertBtn.addEventListener('click', () => {
                    certModal.classList.remove('visible');
                    switchScreen('pomodoro-screen');
                });


                function handlePomodoroCompletion() {
                    const certModal = document.getElementById('pomodoro-certificate-modal');
                    document.getElementById('cert-task-name').textContent = currentPomodoroTask.name;
                    const totalMinutes = Math.floor(pomodoroCurrentSessionSeconds / 60);
                    document.getElementById('cert-duration').textContent = `${totalMinutes} 分钟`;
                    document.getElementById('cert-poke-count').textContent = pomodoroPokeCount;

                    // 新增：清空并隐藏对话框
                    const focusMessageBubble = document.querySelector('#pomodoro-focus-screen .focus-message-bubble');
                    if (focusMessageBubble) {
                        focusMessageBubble.classList.remove('visible');
                        focusMessageBubble.querySelector('p').textContent = '';
                    }

                    // No longer call AI for completion
                    certModal.classList.add('visible');
                }

                function showPomodoroTypingIndicator(element) {
                    element.innerHTML = '对方正在输入中<span class="typing-dots"><span>.</span><span>.</span><span>.</span></span>';
                }

                function showTypewriterMessage(element, text) {
                    let i = 0;
                    element.innerHTML = ''; // Clear previous content
                    const typingInterval = setInterval(() => {
                        if (i < text.length) {
                            element.textContent += text.charAt(i);
                            i++;
                        } else {
                            clearInterval(typingInterval);
                        }
                    }, 50);
                }

                async function getPomodoroAiReply(promptType) {
                    const focusMessageBubble = document.querySelector('.focus-message-bubble');
                    const messageP = focusMessageBubble.querySelector('p');
                    const settings = currentPomodoroTask.settings;
                    const character = db.characters.find(c => c.id === settings.boundCharId);

                    if (!character) {
                        focusMessageBubble.classList.remove('visible');
                        return;
                    }

                    const userPersonaObj = (db.userPersonas || []).find(p => p.nickname === settings.userPersona);
// 【修改点5】获取 persona 字段
const userPersona = userPersonaObj ? userPersonaObj.persona : '一个普通人';
const userName = userPersonaObj ? userPersonaObj.realName : '我'; 
const userNick = userPersonaObj ? userPersonaObj.nickname : '一个普通人'; // ✅ 新增：获取用户名

                    let prompt;
                    const totalMinutes = Math.floor(pomodoroCurrentSessionSeconds / 60);
                    const remainingMinutes = Math.round(pomodoroRemainingSeconds / 60);
                    const taskName = currentPomodoroTask.name;

                    switch (promptType) {
                        case 'encouragement':
                            if (currentPomodoroTask.mode === 'countdown') {
                                prompt = `你正在扮演[${character.realName}]。${userName}正在进行专注任务“${taskName}”，已连续专注了[${totalMinutes}]分钟，还剩下大约[${remainingMinutes}]分钟。请根据你的人设、任务内容和剩余时间，以鼓励为目的，给${userName}发送一条文字消息。`;
                            } else { // stopwatch
                                prompt = `你正在扮演[${character.realName}]。${userName}正在进行专注任务“${taskName}”，已经连续专注了[${totalMinutes}]分钟。请根据你的人设和任务内容，以鼓励为目的，给${userName}发送一条文字消息。`;
                            }
                            break;
                        case 'poke':
                            if (currentPomodoroTask.mode === 'countdown') {
                                prompt = `你正在扮演[${character.realName}]。${userName}在进行专注任务“${taskName}”时，专注了[${totalMinutes}]分钟（还剩下大约[${remainingMinutes}]分钟），忍不住第${pomodoroPokeCount}次戳了戳你的头像。请根据你的人设、任务内容和剩余时间，给${userName}回复一条文字消息。`;
                            } else { // stopwatch
                                prompt = `你正在扮演[${character.realName}]。${userName}在进行专注任务“${taskName}”时，已经连续专注了[${totalMinutes}]分钟，这时忍不住第${pomodoroPokeCount}次戳了戳你的头像。请根据你的人设和任务内容，给${userName}回复一条文字消息。`;
                            }
                            break;
                        case 'resume':
                            prompt = `你正在扮演[${character.realName}]。${userName}正在进行专注任务“${taskName}”，刚刚暂停了任务后又重新开始了。请根据你的人设，给${userName}回复一条文字消息。`;
                            break;
                    }

                    // NEW: Add session history context
                    if (pomodoroSessionHistory && pomodoroSessionHistory.length > 0) {
                        const charName = character.realName || '角色';
                        const historyContext = pomodoroSessionHistory.map(item => {
                            if (item.type === 'user') {
                                return `[${userNick}的消息：(执行操作: ${item.content})]`;
                            } else {
                                return `[${charName}的消息：${item.content}]`;
                            }
                        }).join('\n');
                        prompt += `\n\n【本次专注期间的简短互动历史】\n${historyContext}\n\n请基于以上历史，继续你的下一句回应。`;
                    }

                    focusMessageBubble.classList.add('visible');
                    showPomodoroTypingIndicator(messageP);

                    try {
                        const { url, key, model } = db.apiSettings;
                        if (!url || !key || !model) {
                            messageP.textContent = 'API未配置，无法获取回应。';
                            return;
                        }

                        // --- NEW: Construct system prompt with world books ---
                        const globalWorldBookIds = db.pomodoroSettings?.globalWorldBookIds || [];
                        const globalWorldBooksBefore = globalWorldBookIds
                            .map(id => db.worldBooks.find(wb => wb.id === id && wb.position === 'before'))
                            .filter(Boolean)
                            .map(wb => wb.content)
                            .join('\n\n');
                        const globalWorldBooksAfter = globalWorldBookIds
                            .map(id => db.worldBooks.find(wb => wb.id === id && wb.position === 'after'))
                            .filter(Boolean)
                            .map(wb => wb.content)
                            .join('\n\n');

                        let systemPromptContent = `你正在扮演角色。你的名字是${character.realName}。`;
                        if (globalWorldBooksBefore) {
                            systemPromptContent += `\n\n【全局世界观设定】\n${globalWorldBooksBefore}`;
                        }
                        systemPromptContent += `\n\n【你的角色设定】\n人设: ${character.persona}`;
                        if (globalWorldBooksAfter) {
                            systemPromptContent += `\n\n【补充设定】\n${globalWorldBooksAfter}`;
                        }
                        systemPromptContent += `\n\n【我的角色设定】\n我的名字是${userName}，人设是：${userPersona}。`;
                        // --- END NEW ---

                        const response = await fetch(`${url}/v1/chat/completions`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${key}`
                            },
                            body: JSON.stringify({
                                model: model,
                                messages: [
                                    { role: 'system', content: systemPromptContent },
                                    { role: 'user', content: prompt }
                                ],
                                temperature: 0.8
                            })
                        });

                        if (!response.ok) {
                            throw new Error('API请求失败');
                        }

                        const result = await response.json();
                        const reply = result.choices[0].message.content;

                        // NEW: Add user action and AI reply to session history
                        pomodoroSessionHistory.push({ type: 'user', content: promptType });
                        pomodoroSessionHistory.push({ type: 'ai', content: reply });
                        // Keep history short, e.g., last 4 pairs
                        if (pomodoroSessionHistory.length > 8) {
                            pomodoroSessionHistory.splice(0, 2);
                        }

                        showTypewriterMessage(messageP, reply);

                        // If the reply was for a 'poke', start a timer to reset the interruption flag.
                        if (promptType === 'poke') {
                            setTimeout(() => {
                                pomodoroIsInterrupted = false;
                            }, 10000); // 10 seconds
                        }

                    } catch (error) {
                        console.error('获取AI回应失败:', error);
                        messageP.textContent = '获取回应失败，请检查网络或API设置。';
                    }
                }


                // Show create task modal
                if (createTaskBtn) {
                    createTaskBtn.addEventListener('click', () => {
                        // Reset form to default state on open
                        createForm.reset();
                        durationOptions.classList.add('visible');
                        durationPills.forEach(p => p.classList.remove('active'));
                        if (durationPills.length > 0) {
                            durationPills[0].classList.add('active');
                        }
                        customDurationInput.style.display = 'none';
                        document.getElementById('mode-countdown').checked = true;
                        document.getElementById('mode-stopwatch').checked = false;

                        createModal.classList.add('visible');
                    });
                }

                // Handle mode change (countdown vs stopwatch)
                modeRadios.forEach(radio => {
                    radio.addEventListener('change', () => {
                        if (radio.value === 'countdown') {
                            durationOptions.classList.add('visible');
                        } else {
                            durationOptions.classList.remove('visible');
                        }
                    });
                });

                // Handle duration pill selection
                durationPills.forEach(pill => {
                    pill.addEventListener('click', () => {
                        durationPills.forEach(p => p.classList.remove('active'));
                        pill.classList.add('active');
                        if (pill.dataset.duration === 'custom') {
                            customDurationInput.style.display = 'block';
                            customDurationInput.focus();
                        } else {
                            customDurationInput.style.display = 'none';
                        }
                    });
                });

                // Handle form submission
                if (createForm) {
                    createForm.addEventListener('submit', async (e) => {
                        e.preventDefault();
                        const taskName = document.getElementById('pomodoro-task-name').value.trim();
                        if (!taskName) {
                            showToast('请输入任务名称');
                            return;
                        }

                        const mode = document.querySelector('input[name="pomodoro-mode"]:checked').value;
                        let duration = 0;

                        if (mode === 'countdown') {
                            const activePill = durationOptions.querySelector('.duration-pill.active');
                            if (activePill.dataset.duration === 'custom') {
                                duration = parseInt(customDurationInput.value, 10);
                                if (isNaN(duration) || duration <= 0) {
                                    showToast('请输入有效的自定义分钟数');
                                    return;
                                }
                            } else {
                                duration = parseInt(activePill.dataset.duration, 10);
                            }
                        }

                        const newTask = {
                            id: `pomodoro_${Date.now()}`,
                            name: taskName,
                            mode: mode,
                            duration: duration,
                            status: 'pending',
                            // 为每个任务创建独立的设置副本
                            // 为每个任务创建独立的设置副本，但确保背景是空的
                            settings: {
                                ...JSON.parse(JSON.stringify(db.pomodoroSettings)),
                                focusBackground: '',
                                taskCardBackground: ''
                            }
                        };

                        if (!db.pomodoroTasks) {
                            db.pomodoroTasks = [];
                        }
                        db.pomodoroTasks.push(newTask);
                        await savePomodoroData();

                        showToast(`任务 "${taskName}" 已创建`);
                        renderPomodoroTasks();

                        createModal.classList.remove('visible');
                    });
                }

                const screen = document.getElementById('pomodoro-screen');
                if (screen) {
                    const observer = new MutationObserver(() => {
                        if (screen.classList.contains('active')) {
                            renderPomodoroTasks();
                        }
                    });
                    observer.observe(screen, { attributes: true, attributeFilter: ['class'] });
                }

                const taskListContainer = document.getElementById('pomodoro-task-list');

                // --- Swipe to delete logic ---
                let touchStartX = 0;
                let touchCurrentX = 0;
                let swipedCardWrapper = null;
                let isDragging = false;
                const swipeThreshold = 50; // Min pixels to trigger swipe

                const handleSwipeStart = (x, target) => {
                    touchStartX = x;
                    isDragging = true;
                    // Close any other swiped card
                    const targetWrapper = target.closest('.task-card-wrapper');
                    if (swipedCardWrapper && swipedCardWrapper !== targetWrapper) {
                        swipedCardWrapper.classList.remove('is-swiped');
                        swipedCardWrapper = null;
                    }
                };

                const handleSwipeMove = (x, target) => {
                    if (!isDragging) return;
                    const cardWrapper = target.closest('.task-card-wrapper');
                    if (!cardWrapper) return;

                    touchCurrentX = x;
                    const deltaX = touchCurrentX - touchStartX;

                    // Only allow left swipe
                    if (deltaX < 0) {
                        // Prevent over-swiping
                        const distance = Math.max(deltaX, -80);
                        cardWrapper.querySelector('.task-card').style.transform = `translateX(${distance}px)`;
                    }
                };

                const handleSwipeEnd = (target) => {
                    if (!isDragging) return;
                    isDragging = false;

                    const cardWrapper = target.closest('.task-card-wrapper');
                    if (!cardWrapper) return;

                    const card = cardWrapper.querySelector('.task-card');
                    const deltaX = touchCurrentX - touchStartX;

                    // Reset inline style
                    card.style.transform = '';

                    if (deltaX < -swipeThreshold) {
                        cardWrapper.classList.add('is-swiped');
                        swipedCardWrapper = cardWrapper;
                    } else {
                        cardWrapper.classList.remove('is-swiped');
                        if (swipedCardWrapper === cardWrapper) {
                            swipedCardWrapper = null;
                        }
                    }

                    // Reset positions
                    touchStartX = 0;
                    touchCurrentX = 0;
                };

                taskListContainer.addEventListener('touchstart', (e) => {
                    handleSwipeStart(e.touches[0].clientX, e.target);
                }, { passive: true });

                taskListContainer.addEventListener('touchmove', (e) => {
                    handleSwipeMove(e.touches[0].clientX, e.target);
                }, { passive: true });

                taskListContainer.addEventListener('touchend', (e) => {
                    handleSwipeEnd(e.target);
                });

                // Mouse events for desktop
                taskListContainer.addEventListener('mousedown', (e) => {
                    if (e.target.closest('.task-card-start-btn') || e.target.closest('.task-card-delete-btn')) return;
                    handleSwipeStart(e.clientX, e.target);
                });

                taskListContainer.addEventListener('mousemove', (e) => {
                    handleSwipeMove(e.clientX, e.target);
                });

                taskListContainer.addEventListener('mouseup', (e) => {
                    handleSwipeEnd(e.target);
                });

                taskListContainer.addEventListener('mouseleave', (e) => {
                    if (isDragging) {
                        handleSwipeEnd(e.target);
                    }
                });


                // --- Click handling for start and delete ---
                if (taskListContainer) {
                    taskListContainer.addEventListener('click', async (e) => {
                        const startBtn = e.target.closest('.task-card-start-btn');
                        const deleteBtn = e.target.closest('.task-card-delete-btn');
                        const cardWrapper = e.target.closest('.task-card-wrapper');

                        if (deleteBtn && cardWrapper) {
                            const taskId = cardWrapper.dataset.id;
                            if (await AppUI.confirm('确定要删除这个任务吗？', "系统提示", "确认", "取消")) {
                                db.pomodoroTasks = db.pomodoroTasks.filter(t => t.id !== taskId);
                                await savePomodoroData();
                                renderPomodoroTasks();
                                showToast('任务已删除');
                            }
                        } else if (startBtn && cardWrapper) {
                            const taskId = cardWrapper.dataset.id;
                            const task = db.pomodoroTasks.find(t => t.id === taskId);

                            if (task) {
                                // --- Start Focus Session ---
                                currentPomodoroTask = task;
                                stopTimer(); // Ensure any previous timer is stopped
                                pomodoroCurrentSessionSeconds = 0; // Reset session timer
                                pomodoroPokeCount = 0; // Reset poke count
                                pomodoroIsInterrupted = false; // Reset interruption flag
                                pomodoroSessionHistory = []; // NEW: Reset session history

                                // 新增：清空并隐藏对话框
                                const focusMessageBubble = document.querySelector('#pomodoro-focus-screen .focus-message-bubble');
                                if (focusMessageBubble) {
                                    focusMessageBubble.classList.remove('visible');
                                    focusMessageBubble.querySelector('p').textContent = '';
                                }

                                focusTitleEl.textContent = task.name;
                                focusModeEl.textContent = task.mode === 'countdown' ? '倒计时' : '正计时';

                                if (task.mode === 'countdown') {
                                    pomodoroRemainingSeconds = task.duration * 60;
                                } else {
                                    pomodoroRemainingSeconds = 0;
                                }

                                updateTimerDisplay();
                                updateTotalFocusedTimeDisplay(); // Update display to show 0

                                // NEW: Update avatar based on bound character
                                const focusAvatarEl = document.querySelector('#pomodoro-focus-screen .focus-avatar');
                                if (task.settings && task.settings.boundCharId) {
                                    const boundChar = db.characters.find(c => c.id === task.settings.boundCharId);
                                    if (boundChar && focusAvatarEl) {
                                        focusAvatarEl.src = boundChar.avatar;
                                    } else if (focusAvatarEl) {
                                        focusAvatarEl.src = 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg'; // Fallback
                                    }
                                } else if (focusAvatarEl) {
                                    focusAvatarEl.src = 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg'; // Fallback
                                }
                                // END NEW

                                applyPomodoroBackgrounds(); // Apply backgrounds when starting a task
                                // Timer is now started from the focus screen, not automatically.
                                switchScreen('pomodoro-focus-screen');
                            }
                        } else if (cardWrapper && !cardWrapper.classList.contains('is-swiped')) {
                            // If a non-swiped card is clicked, close any open one
                            if (swipedCardWrapper) {
                                swipedCardWrapper.classList.remove('is-swiped');
                                swipedCardWrapper = null;
                            }
                        }
                    });
                }
            }
            
 window.applyPomodoroBackgrounds=applyPomodoroBackgrounds;