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

                // 顶部那句「勾选后请点击右上角保存」只对角色/世界书两个勾选列表成立，
                // 「管理」Tab 里没有复选框，挂着会误导
                const tipEl = document.getElementById('world-content-tips');
                const syncTip = (tabName) => {
                    if (tipEl) tipEl.style.display = (tabName === 'admin') ? 'none' : '';
                };

                // 1. Tab 切换逻辑
                tabs.forEach(tab => {
                    const newTab = tab.cloneNode(true);
                    tab.parentNode.replaceChild(newTab, tab);

                    newTab.addEventListener('click', () => {
                        document.querySelectorAll('.world-sidebar-btn').forEach(t => t.classList.remove('active'));
                        newTab.classList.add('active');

                        // data-tab 直接映射到 world-tab-xxx，加 Tab 只要加 DOM，别再回来堆三元
                        const targetId = `world-tab-${newTab.dataset.tab}`;
                        panes.forEach(pane => pane.classList.remove('active'));
                        const targetPane = document.getElementById(targetId);
                        if (targetPane) targetPane.classList.add('active');

                        syncTip(newTab.dataset.tab);
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

                    // 重进页面时上次停在哪个 Tab 是保留的，提示语要跟着那个 Tab 走
                    const activeTab = document.querySelector('.world-sidebar-btn.active');
                    syncTip(activeTab ? activeTab.dataset.tab : 'char');

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

                    // 「管理」Tab 的正文 CSS（DOM 在 world-tab-admin，逻辑在 forum_admin.js）
                    if (typeof loadForumAdminPane === 'function') loadForumAdminPane();

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

// 「管理」Tab 的正文 CSS 也归这个保存按钮（写进 db.forumUserIdentity，
// 跟 forumBindings 同属 saveForumMeta 的白名单，一次落盘）
if (typeof saveForumAdminPane === 'function') saveForumAdminPane();

await saveForumMeta();
showToast('世界设定已保存');
                    });
                }

                window.refreshWorldPageList = renderWorldPageList;
                renderWorldPageList();

                const worldScreen = document.getElementById('world-screen');
                if (worldScreen && !worldScreen.dataset.observerAttached) {
                    // ★ 只在「不活跃 → 活跃」这一次跳变时重绘。
                    //   switchScreen 一次会产生好几条 class 变更记录（先给所有 .screen 去 active，
                    //   再给目标加 active），旧写法是「每条记录都重绘一次」，一次进页面能跑五六遍
                    //   renderWorldPageList —— 而它每遍都 charList.innerHTML='' 再把每个角色/群的
                    //   base64 头像重新塞进 DOM（几十 KB 一张，浏览器要重新解码），这就是
                    //   「点世界栏目有点延迟」的主因。记住上次状态，跳变才干活。
                    let wasActive = worldScreen.classList.contains('active');
                    const observer = new MutationObserver(() => {
                        const isActive = worldScreen.classList.contains('active');
                        if (isActive === wasActive) return;   // 同一次切换的其余记录，直接丢
                        wasActive = isActive;
                        if (isActive) renderWorldPageList();
                    });
                    observer.observe(worldScreen, { attributes: true, attributeFilter: ['class'] });
                    worldScreen.dataset.observerAttached = "true";
                }
            }

