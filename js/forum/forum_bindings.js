// forum_bindings.js - 世界设定绑定：世界书/角色/聊天记录关联、API预设选择

            function setupForumBindingFeature() {
                const worldBookList = document.getElementById('forum-worldbook-list');
                const charList = document.getElementById('forum-char-list');
                const saveBtn = document.getElementById('world-save-btn');

                // 获取关联记忆相关的 DOM
                let historyToggle = document.getElementById('world-use-history-toggle');
                const historyLimitInput = document.getElementById('world-history-limit');

                // 获取跳转按钮
                const jumpBtn = document.getElementById('jump-to-wb-edit-btn');

                const tabs = document.querySelectorAll('.world-sidebar-btn');
                const panes = document.querySelectorAll('.world-tab-pane');

                // 1. Tab 切换逻辑
                tabs.forEach(tab => {
                    const newTab = tab.cloneNode(true);
                    tab.parentNode.replaceChild(newTab, tab);

                    newTab.addEventListener('click', () => {
                        document.querySelectorAll('.world-sidebar-btn').forEach(t => t.classList.remove('active'));
                        newTab.classList.add('active');

                        const targetId = newTab.dataset.tab === 'wb' ? 'world-tab-wb' : 'world-tab-char';
                        panes.forEach(pane => pane.classList.remove('active'));
                        document.getElementById(targetId).classList.add('active');
                    });
                });

                // 2. 跳转按钮逻辑
                if (jumpBtn) {
                    const newJumpBtn = jumpBtn.cloneNode(true);
                    jumpBtn.parentNode.replaceChild(newJumpBtn, jumpBtn);

                    newJumpBtn.addEventListener('click', () => {
                        showToast('已前往“世界书”页面');
                        if (typeof renderWorldBookList === 'function') {
                            renderWorldBookList();
                        }
                        switchScreen('world-book-screen');
                    });
                }

                // 辅助函数：控制输入框的“视觉显隐”
                const setInputVisibility = (visible) => {
                    if (!historyLimitInput) return;
                    if (visible) {
                        // 显示：完全不透明，允许鼠标交互
                        historyLimitInput.style.opacity = '1';
                        historyLimitInput.style.pointerEvents = 'auto';
                    } else {
                        // 隐藏：完全透明，禁止鼠标交互（占位但不响应）
                        historyLimitInput.style.opacity = '0';
                        historyLimitInput.style.pointerEvents = 'none';
                    }
                };

                // 3. 记忆开关监听逻辑
                if (historyToggle) {
                    const newToggle = historyToggle.cloneNode(true);
                    historyToggle.parentNode.replaceChild(newToggle, historyToggle);
                    historyToggle = newToggle; // 更新引用

                    newToggle.addEventListener('change', (e) => {
                        // 使用新逻辑控制显隐
                        setInputVisibility(e.target.checked);
                    });
                }

                // 4. 定义渲染列表函数
                function renderWorldPageList() {
                    if (!worldBookList || !charList) return;

                    // 获取当前数据
                    const currentBindings = db.forumBindings || { worldBookIds: [], charIds: [], groupIds: [], useChatHistory: false, historyLimit: 50 };

                    // --- 设置开关状态及输入框显隐 ---
                    if (historyToggle) {
                        historyToggle.checked = !!currentBindings.useChatHistory;

                        if (historyLimitInput) {
                            // 初始化时的显隐状态
                            setInputVisibility(historyToggle.checked);
                            historyLimitInput.value = currentBindings.historyLimit || 50;
                        }
                    }
                    
                    const forumApiSel = document.getElementById('forum-api-preset-select');
if (forumApiSel && typeof window.populateChatApiPresetSelect === 'function') {
    window.populateChatApiPresetSelect(forumApiSel);
    forumApiSel.value = currentBindings.apiPresetName || '';
}

                    // --- 填充世界书列表 ---
                    worldBookList.innerHTML = '';
                    if (typeof renderCategorizedWorldBookList === 'function') {
                        renderCategorizedWorldBookList(worldBookList, db.worldBooks, currentBindings.worldBookIds, 'wb-bind');
                    } else {
                        db.worldBooks.forEach(wb => {
                            const li = document.createElement('li');
                            li.className = 'binding-list-item';
                            const isChecked = currentBindings.worldBookIds.includes(wb.id);
                            li.innerHTML = `
                    <input type="checkbox" class="item-checkbox" id="wb-bind-${wb.id}" value="${wb.id}" ${isChecked ? 'checked' : ''}>
                    <label for="wb-bind-${wb.id}">${wb.name}</label>
                `;
                            worldBookList.appendChild(li);
                        });
                    }

                    // --- 填充角色 & 群聊混合列表 ---
                    charList.innerHTML = '';
                    const groups = db.groups || [];
                    if (db.characters.length > 0 || groups.length > 0) {
                        db.characters.forEach(char => {
                            const isChecked = currentBindings.charIds.includes(char.id);
                            const li = document.createElement('li');
                            li.className = 'binding-list-item';
                            li.innerHTML = `
                    <input type="checkbox" class="char-checkbox" id="char-bind-${char.id}" value="${char.id}" ${isChecked ? 'checked' : ''}>
                    <label for="char-bind-${char.id}" style="display: flex; align-items: center;">
                        <img src="${char.avatar}" style="width: 24px; height: 24px; border-radius: 50%; margin-right: 8px; object-fit:cover;">
                        ${char.remarkName}
                    </label>
                `;
                            charList.appendChild(li);
                        });

                        const boundGroupIds = currentBindings.groupIds || [];
                        groups.forEach(group => {
                            const isChecked = boundGroupIds.includes(group.id);
                            const li = document.createElement('li');
                            li.className = 'binding-list-item';
                            li.innerHTML = `
                    <input type="checkbox" class="group-checkbox" id="group-bind-${group.id}" value="${group.id}" ${isChecked ? 'checked' : ''}>
                    <label for="group-bind-${group.id}" style="display: flex; align-items: center;">
                        <img src="${group.avatar}" style="width: 24px; height: 24px; border-radius: 50%; margin-right: 8px; object-fit:cover;">
                        ${group.name}<span style="font-size:11px; color:#999; margin-left:5px;">[群聊]</span>
                    </label>
                `;
                            charList.appendChild(li);
                        });
                    } else {
                        charList.innerHTML = '<li style="padding:10px; color:#999; font-size:14px;">暂无角色</li>';
                    }
                }

                // 5. 保存按钮逻辑
                if (saveBtn) {
                    const newSaveBtn = saveBtn.cloneNode(true);
                    saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);

                    newSaveBtn.addEventListener('click', async () => {
                        const currentToggle = document.getElementById('world-use-history-toggle');
                        const currentLimitInput = document.getElementById('world-history-limit');

                        const selectedWorldBookIds = Array.from(worldBookList.querySelectorAll('.item-checkbox:checked')).map(input => input.value);
                        const selectedCharIds = Array.from(charList.querySelectorAll('.char-checkbox:checked')).map(input => input.value);
                        const selectedGroupIds = Array.from(charList.querySelectorAll('.group-checkbox:checked')).map(input => input.value);

                        const useHistory = currentToggle ? currentToggle.checked : false;

                        let limit = 50;
                        if (currentLimitInput) {
                            limit = parseInt(currentLimitInput.value);
                            if (isNaN(limit)) limit = 50;
                            if (limit > 500) {
                                limit = 500;
                                currentLimitInput.value = 500;
                                showToast('关联条数最大限制为500');
                            }
                        }

                        db.forumBindings = {
    worldBookIds: selectedWorldBookIds,
    charIds: selectedCharIds,
    groupIds: selectedGroupIds,
    userPersonaIds: db.forumBindings ? db.forumBindings.userPersonaIds : [],
    useChatHistory: useHistory,
    historyLimit: limit,
    apiPresetName: (document.getElementById('forum-api-preset-select') || {}).value || ''
};

await saveForumMeta();
showToast('世界设定已保存');
                    });
                }

                window.refreshWorldPageList = renderWorldPageList;
                renderWorldPageList();

                const worldScreen = document.getElementById('world-screen');
                if (worldScreen && !worldScreen.dataset.observerAttached) {
                    const observer = new MutationObserver((mutations) => {
                        for (let mutation of mutations) {
                            if (mutation.attributeName === 'class') {
                                if (worldScreen.classList.contains('active')) {
                                    renderWorldPageList();
                                }
                            }
                        }
                    });
                    observer.observe(worldScreen, { attributes: true });
                    worldScreen.dataset.observerAttached = "true";
                }
            }

