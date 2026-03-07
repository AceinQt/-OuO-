// --- 分页控制变量 ---
let currentForumPage = 1;
const FORUM_PAGE_SIZE = 15; // 每次加载15条
let isForumLoadingMore = false; // 防止滚动时重复触发
// --- 论坛滚动位置记忆 ---
let savedForumScrollY = 0;
            
                                    // --- 新增：获取匿名名字 (喵叽+4位代号) ---
            function getAnonymousName() {
                const identity = db.forumUserIdentity || {};
                // 获取代号，默认为 0311，确保补足4位
                const code = (identity.anonCode || '0311').toString().padStart(4, '0');
                return `喵叽${code}`;
            }

            // --- 新增：应用用户自定义的正文CSS ---
            function applyCustomPostCss() {
                // 1. 获取用户保存的 CSS
                const identity = db.forumUserIdentity || {};
                const customCss = identity.customDetailCss;

                // 2. 查找 or 创建 style 标签
                let styleTag = document.getElementById('user-post-detail-style');
                if (!styleTag) {
                    styleTag = document.createElement('style');
                    styleTag.id = 'user-post-detail-style';
                    document.head.appendChild(styleTag);
                }

                // 3. 注入样式，限定在 .post-detail-content-body 范围内
                if (customCss && customCss.trim()) {
                    styleTag.textContent = `.post-detail-content-body { ${customCss} }`;
                } else {
                    styleTag.textContent = '';
                }
            }
                        // --- 喵坛新增：底部导航栏逻辑 ---
// --- 喵坛新增：底部导航栏逻辑 ---
function setupBottomNavigation() {
    // 改为选择全局唯一的导航栏
    const nav = document.querySelector('.bottom-tab-bar'); 

    if (nav) {
        nav.addEventListener('click', (e) => {
            // 找到被点击的图标容器
            const tab = e.target.closest('.tab-item');
            if (tab) {
                const targetScreenId = tab.dataset.target;
                
                // 【关键修改】直接调用全局切换函数
                // 这样 utils.js 里的 has-bottom-nav 判断才会生效！
                if (typeof switchScreen === 'function') {
                    switchScreen(targetScreenId);
                } else {
                    console.error("switchScreen 函数未定义");
                }
            }
        });
    }
}



            // --- 新增：“我”页面逻辑 ---
// --- 修改：“我”页面逻辑 (修复头像保存刷新问题 + 整合Tab功能) ---
function setupMePageFeature() {
    // =========================
    // 1. 获取基础 DOM 元素
    // =========================
    const avatarTrigger = document.getElementById('me-avatar-trigger');
    const avatarImg = document.getElementById('me-avatar-img');
    const avatarInputHidden = document.getElementById('me-avatar-input');

    const nicknameInput = document.getElementById('me-nickname-input');
    const anonCodeInput = document.getElementById('me-anon-code-input');
    const realNameInput = document.getElementById('me-realname-input');
    const personaInput = document.getElementById('me-persona-input');
    const customCssInput = document.getElementById('me-custom-css-input');
    
    const loadPersonaBtn = document.getElementById('me-load-persona-btn');
    const saveBtn = document.getElementById('me-save-btn');

    const statPostCount = document.getElementById('stat-post-count');
    const statFavCount = document.getElementById('stat-fav-count');
    const statWatchCount = document.getElementById('stat-watch-count');

    const tabs = document.querySelectorAll('.me-tab-item');
    const tabPanes = document.querySelectorAll('.me-tab-pane');

    // =========================
    // 2. 获取头像弹窗 DOM 元素
    // =========================
    const modal = document.getElementById('me-avatar-modal');
    const modalForm = document.getElementById('me-avatar-form');
    const modalUrlInput = document.getElementById('me-avatar-url-input-modal');
    const modalFileUpload = document.getElementById('me-avatar-file-upload-modal');
    const modalPreview = document.getElementById('me-avatar-preview-modal');

    // =========================
    // 3. 初始化数据加载函数
    // =========================
    function loadMeData() {
        const identity = db.forumUserIdentity || {
            nickname: '新用户',
            avatar: 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg',
            persona: '',
            realName: '',
            anonCode: '0311',
            customDetailCss: ''
        };

        if (nicknameInput) nicknameInput.value = identity.nickname || '';
        if (anonCodeInput) anonCodeInput.value = identity.anonCode || '0311';
        
        const currentAvatar = identity.avatar || 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg';
        if (avatarInputHidden) avatarInputHidden.value = currentAvatar;
        if (avatarImg) avatarImg.src = currentAvatar;

        if (realNameInput) realNameInput.value = identity.realName || '';
        if (personaInput) personaInput.value = identity.persona || '';
        if (customCssInput) customCssInput.value = identity.customDetailCss || '';
        
            const myPosts = (db.forumPosts || []).filter(p => p.isUser || p.username === identity.nickname).length;
    if (statPostCount) statPostCount.textContent = myPosts;
    
    const favCount = (db.favoritePostIds || []).length;
    if (statFavCount) statFavCount.textContent = favCount;
    const watchCount = (db.watchingPostIds || []).length;
    if (statWatchCount) statWatchCount.textContent = watchCount;
    
    }

    // =========================
    // 4. Tab 切换逻辑
    // =========================
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tabPanes.forEach(p => p.classList.remove('active'));

            tab.classList.add('active');
            const targetId = tab.dataset.tab === 'persona' ? 'tab-persona' : 'tab-css';
            const targetPane = document.getElementById(targetId);
            if (targetPane) targetPane.classList.add('active');
        });
    });

    // =========================
    // 5. 头像弹窗逻辑 (✅ 核心修复)
    // =========================
    if (avatarTrigger && modal) {
        // A. 点击头像打开弹窗
        avatarTrigger.addEventListener('click', () => {
            // ✅ 修复1: 每次打开弹窗时重新获取当前头像值
            const currentSrc = avatarInputHidden.value || avatarImg.src;
            
            // 重置弹窗状态
            if (modalPreview) {
                modalPreview.style.backgroundImage = `url("${currentSrc}")`;
                modalPreview.innerHTML = ''; 
            }
            if (modalUrlInput) modalUrlInput.value = '';
            if (modalFileUpload) modalFileUpload.value = '';
            
            modal.classList.add('visible');
        });

        // B. URL 输入实时预览
        if (modalUrlInput) {
            modalUrlInput.addEventListener('input', () => {
                const url = modalUrlInput.value.trim();
                // ✅ 修复2: 每次都重新获取预览元素，确保操作最新DOM
                const preview = document.getElementById('me-avatar-preview-modal');
                if (!preview) return;
                
                if (url) {
                    preview.style.backgroundImage = `url("${url}")`;
                    preview.innerHTML = '';
                } else {
                    preview.style.backgroundImage = 'none';
                    preview.innerHTML = '<span>预览</span>';
                }
            });
        }

        // C. 本地上传预览 (✅ 增强修复)
        if (modalFileUpload) {
            modalFileUpload.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;

                // ✅ 修复3: 实时获取预览元素
                const preview = document.getElementById('me-avatar-preview-modal');
                const urlInput = document.getElementById('me-avatar-url-input-modal');

                if (!preview) {
                    console.error("找不到预览元素");
                    return;
                }

                preview.innerHTML = '<span style="font-size:12px;">处理中...</span>';

                try {
                    let finalUrl = '';

                    // 尝试压缩
                    if (typeof compressImage === 'function') {
                        console.log("正在压缩图片...");
                        finalUrl = await compressImage(file, { 
                            quality: 0.8, 
                            maxWidth: 300, 
                            maxHeight: 300 
                        });
                    } else {
                        // 使用原生 FileReader
                        console.warn("未找到压缩函数，使用原图");
                        finalUrl = await new Promise((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onload = (e) => resolve(e.target.result);
                            reader.onerror = reject;
                            reader.readAsDataURL(file);
                        });
                    }

                    // ✅ 设置预览
                    preview.style.backgroundImage = `url("${finalUrl}")`;
                    preview.innerHTML = '';
                    
                    // 清空URL输入框避免冲突
                    if (urlInput) urlInput.value = '';
                    
                    console.log("✅ 预览设置成功");

                } catch (error) {
                    console.error("图片处理出错:", error);
                    if (typeof showToast === 'function') {
                        showToast('图片读取失败，请重试');
                    }
                    preview.innerHTML = '<span style="color:red;">失败</span>';
                }
            });
        }

        // D. ✅【核心修复】确认更换按钮
        if (modalForm) {
            modalForm.addEventListener('submit', (e) => {
                e.preventDefault(); // 阻止表单提交
                
                // ✅ 修复4: 实时获取预览元素的背景图
                const preview = document.getElementById('me-avatar-preview-modal');
                if (!preview) {
                    console.error("找不到预览元素");
                    return;
                }
                
                const bgImage = preview.style.backgroundImage;
                let newSrc = '';
                
                // 解析 url("...") 字符串
                if (bgImage && bgImage !== 'none') {
                    newSrc = bgImage.replace(/^url\(['"]?/, '').replace(/['"]?\)$/, '');
                }

                if (newSrc) {
                    // ✅ 修复5: 实时获取主页头像元素
                    const mainAvatar = document.getElementById('me-avatar-img');
                    const hiddenInput = document.getElementById('me-avatar-input');
                    
                    // 更新界面显示
                    if (mainAvatar) {
                        mainAvatar.src = newSrc;
                        console.log("✅ 主页头像已更新:", newSrc);
                    }
                    
                    // 更新隐藏input (用于保存到数据库)
                    if (hiddenInput) {
                        hiddenInput.value = newSrc;
                        console.log("✅ 隐藏input已更新");
                    }
                    
                    modal.classList.remove('visible');                    
                    
                } else {
                    if (typeof showToast === 'function') {
                        showToast('请先选择或输入图片');
                    }
                }
            });
        }

        // E. 点击遮罩关闭
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.classList.remove('visible');
        });
    }

    // =========================
    // 6. 读取人设弹窗逻辑
    // =========================
    const loadModal = document.getElementById('forum-load-persona-modal');
    const personaList = document.getElementById('forum-persona-list');
    const confirmLoadBtn = document.getElementById('forum-confirm-persona-load');

    if (loadPersonaBtn) {
        loadPersonaBtn.addEventListener('click', () => {
            const presets = db.userPersonas || [];
            personaList.innerHTML = '';
            if (presets.length === 0) {
                personaList.innerHTML = '<li class="list-item" style="color:#aaa; justify-content:center; padding: 20px;">暂无数据库人设...</li>';
            } else {
                presets.forEach((preset, index) => {
                    const li = document.createElement('li');
                    li.className = 'list-item';
                    li.style.cssText = "display:flex; align-items:center; padding:12px; border-bottom:1px solid #f5f5f5;";
                    li.innerHTML = `
                        <input type="radio" name="forum_persona_select" value="${index}" id="fp_${index}" style="margin-right:15px; transform:scale(1.2);">
                        <label for="fp_${index}" style="display:flex; align-items:center; flex:1; cursor:pointer;">
                            <img src="${preset.avatar}" style="width:40px; height:40px; border-radius:50%; margin-right:12px; object-fit:cover;">
                            <div style="display:flex; flex-direction:column; justify-content:center;">
                                <div style="font-weight:bold; color:#333;">${preset.nickname}</div>
                                <div style="font-size:12px; color:#888;">真名：${preset.realName || '未知'}</div>
                            </div>
                        </label>
                    `;
                    personaList.appendChild(li);
                });
            }
            if (loadModal) loadModal.classList.add('visible');
        });
    }

    if (confirmLoadBtn) {
        confirmLoadBtn.addEventListener('click', () => {
            const checked = personaList.querySelector('input[name="forum_persona_select"]:checked');
            if (checked) {
                const index = parseInt(checked.value);
                const preset = db.userPersonas[index];
                if (preset) {         
                    realNameInput.value = preset.realName || '';
                    personaInput.value = preset.persona || '';
                    if (typeof showToast === 'function') {
                        showToast(`已读取人设：${preset.nickname}`);
                    }
                    if (loadModal) loadModal.classList.remove('visible');
                }
            } else {
                if (typeof showToast === 'function') {
                    showToast("请先选择一项");
                }
            }
        });
    }
    
    if (loadModal) {
        loadModal.addEventListener('click', (e) => {
            if (e.target === loadModal) loadModal.classList.remove('visible');
        });
    }

    // =========================
    // 7. ✅【核心修复】保存所有设置到数据库
    // =========================
    if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
            try {
                // 处理匿名码
                let codeVal = anonCodeInput ? anonCodeInput.value.trim() : '0311';
                if (!codeVal) codeVal = '0311';
                const finalCode = codeVal.toString().padStart(4, '0');

                // ✅ 修复6: 确保从最新的 DOM 元素获取值
                const currentHiddenInput = document.getElementById('me-avatar-input');
                const currentNickname = document.getElementById('me-nickname-input');
                const currentRealName = document.getElementById('me-realname-input');
                const currentPersona = document.getElementById('me-persona-input');
                const currentCss = document.getElementById('me-custom-css-input');

                // 更新内存中的数据
                db.forumUserIdentity = {
                    nickname: currentNickname?.value.trim() || '新用户',
                    avatar: currentHiddenInput?.value.trim() || 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg',
                    persona: currentPersona?.value.trim() || '',
                    realName: currentRealName?.value.trim() || '',
                    anonCode: finalCode,
                    customDetailCss: currentCss?.value || ''
                };

                console.log("📝 准备保存的数据:", db.forumUserIdentity);

                // ✅ 修复7: 调用保存函数
                if (typeof saveData === 'function') {
                    await saveData();
                    console.log("✅ 数据已保存到 IndexedDB");
                } else {
                    console.error("❌ saveData 函数不存在");
                }

                if (typeof showToast === 'function') {
                    showToast('个人设置已保存');
                }
                
                if (anonCodeInput) anonCodeInput.value = finalCode;

                // 重新加载数据刷新统计
                loadMeData();
                
                // 更新其他相关UI
                if (typeof updateReplyAuthorSelect === 'function') {
                    updateReplyAuthorSelect();
                }
                if (typeof applyCustomPostCss === 'function') {
                    applyCustomPostCss();
                }
                
            } catch (error) {
                console.error("❌ 保存失败:", error);
                if (typeof showToast === 'function') {
                    showToast('保存失败: ' + error.message);
                }
            }
        });
    }

    // 初始加载
    loadMeData();
    
    const meScreen = document.getElementById('me-screen'); 

    if (meScreen && !meScreen.dataset.observerAttached) {
        const observer = new MutationObserver((mutations) => {
            for (let mutation of mutations) {
                // 监听 class 变化 (当 class 变成 "screen active" 时)
                if (mutation.attributeName === 'class') {
                    if (meScreen.classList.contains('active')) {
                        console.log("进入了个人主页，自动刷新数据...");
                        loadMeData(); // <--- 关键：进入时重新读取数据库
                    }
                }
            }
        });
        
        // 开始监听
        observer.observe(meScreen, { attributes: true });
        meScreen.dataset.observerAttached = "true"; // 防止重复绑定
    }
}


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
                    const currentBindings = db.forumBindings || { worldBookIds: [], charIds: [], useChatHistory: false, historyLimit: 50 };

                    // --- 设置开关状态及输入框显隐 ---
                    if (historyToggle) {
                        historyToggle.checked = !!currentBindings.useChatHistory;

                        if (historyLimitInput) {
                            // 初始化时的显隐状态
                            setInputVisibility(historyToggle.checked);
                            historyLimitInput.value = currentBindings.historyLimit || 50;
                        }
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

                    // --- 填充角色列表 ---
                    charList.innerHTML = '';
                    if (db.characters.length > 0) {
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
                            userPersonaIds: db.forumBindings ? db.forumBindings.userPersonaIds : [],
                            useChatHistory: useHistory,
                            historyLimit: limit
                        };

                        await saveData();
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


            function renderHotPosts() {
                const container = document.getElementById('hot-posts-section');
                const list = document.getElementById('hot-posts-list');
                if (!container || !list) return;

                if (!db.forumPosts || db.forumPosts.length === 0) {
                    container.style.display = 'none';
                    return;
                }

                const now = Date.now();
                const oneDayAgo = now - 24 * 60 * 60 * 1000;

                const activePosts = db.forumPosts.filter(p => {
                    const postTime = p.timestamp || 0;
                    if (postTime > oneDayAgo) return true;

                    if (p.comments && p.comments.length > 0) {
                        const lastComment = p.comments[p.comments.length - 1];
                        const commentTime = new Date(lastComment.timestamp).getTime();
                        if (!isNaN(commentTime) && commentTime > oneDayAgo) return true;
                    }
                    return false;
                });

                if (activePosts.length === 0) {
                    container.style.display = 'none';
                    return;
                }

                activePosts.sort((a, b) => (b.comments ? b.comments.length : 0) - (a.comments ? a.comments.length : 0));
                const top3 = activePosts.slice(0, 3);

                list.innerHTML = '';
                top3.forEach((post, index) => {
                    const item = document.createElement('div');
                    item.className = 'hot-post-item';
                    item.onclick = () => {
                        const scrollArea = document.getElementById('detail-content-area');
                        if (scrollArea) {
                            savedForumScrollY = scrollArea.scrollTop;
                        }
                        
                        currentSourceScreen = 'forum-screen';
                        renderPostDetail(post);
                        switchScreen('forum-post-detail-screen');
                        const detailContent = document.getElementById('detail-content-area');
                        if (detailContent) detailContent.scrollTop = 0;
                    };

                    const rankClass = `rank-${index + 1}`;
                    const cleanTitle = post.title.replace(/^\[New!\]\s*/, '').replace(/^【新】/, '');
                    // 修改：精确到秒
                    const timeStr = new Date(post.timestamp).toLocaleString();

                    item.innerHTML = `
            <div class="rank-badge ${rankClass}">${index + 1}</div>
            <div class="hot-post-info">
                <div class="hot-post-title">${cleanTitle}</div>
                <div class="hot-post-meta-row">
                    <span>${post.username}</span>
                    <span>评论 ${post.comments ? post.comments.length : 0}</span>
                    <span>${timeStr}</span>
                </div>
            </div>
        `;
                    list.appendChild(item);
                });

                container.style.display = 'block';
            }






            function setupFavoritesFeature() {
                const listContainer = document.getElementById('favorites-list-container');
                const manageBtn = document.getElementById('fav-manage-btn');
                const actionsBar = document.getElementById('fav-manage-actions');
                const deleteBtn = document.getElementById('fav-delete-confirm-btn');
                const tabBtns = document.querySelectorAll('.fav-tab-btn');

                let isManageMode = false;
                let currentFavTab = 'my-fav';

                // 1. Tab 切换逻辑
                tabBtns.forEach(btn => {
                    btn.addEventListener('click', () => {
                        tabBtns.forEach(b => b.classList.remove('active'));
                        btn.classList.add('active');
                        currentFavTab = btn.dataset.tab;

                        if (isManageMode) {
                            if (manageBtn) manageBtn.click();
                        } else {
                            renderFavoritesList();
                        }
                    });
                });

                // 2. 核心渲染函数 (含新样式逻辑)
                window.renderFavoritesList = function () {
                    if (!listContainer) return;
                    listContainer.innerHTML = '';

                    let targetIds = [];
                    let emptyText = '';

                    if (currentFavTab === 'my-fav') {
                        targetIds = db.favoritePostIds || [];
                        emptyText = '暂无收藏内容';
                    } else {
                        targetIds = db.watchingPostIds || [];
                        emptyText = '角色暂无正在关注的帖子';
                    }

                    if (!targetIds || targetIds.length === 0) {
                        listContainer.innerHTML = `<p class="placeholder-text" style="margin-top:50px;">${emptyText}</p>`;
                        return;
                    }

                    const displayIds = [...targetIds].reverse();

                    displayIds.forEach(id => {
                        const post = db.forumPosts.find(p => String(p.id) === String(id));
                        if (!post) return;

                        // --- 创建卡片 ---
                        const card = document.createElement('div');
                        // 添加 custom-check-item 类以支持选中样式过渡
                        card.className = 'fav-post-card custom-check-item';
                        card.style.cursor = 'pointer';

                        // 隐藏的复选框 (保留逻辑功能，但视觉隐藏)
                        const checkbox = document.createElement('input');
                        checkbox.type = 'checkbox';
                        checkbox.className = 'fav-checkbox hidden-checkbox';
                        checkbox.value = id;

                        const contentDiv = document.createElement('div');
                        contentDiv.className = 'fav-post-content';

                        const title = post.title ? post.title.replace(/^\[New!\]\s*/, '').replace(/^【新】/, '') : '无标题';
                        const timeStr = post.timestamp ? new Date(post.timestamp).toLocaleString() : '未知时间';
                        contentDiv.innerHTML = `
                <div class="fav-post-title">${title}</div>
                <div class="fav-post-meta">
                    <span>${post.username || '匿名'}</span>
                    <span>${timeStr}</span>
                </div>
            `;

                        card.appendChild(checkbox);
                        card.appendChild(contentDiv);

                        // --- 点击事件 ---
                        card.onclick = (e) => {
                            if (isManageMode) {
                                // 管理模式：切换选中状态和 UI 样式
                                checkbox.checked = !checkbox.checked;
                                if (checkbox.checked) {
                                    card.classList.add('selected');
                                } else {
                                    card.classList.remove('selected');
                                }
                            } else {
                                // 正常模式：跳转详情
                                currentSourceScreen = 'favorites-screen';
                                renderPostDetail(post);
                                switchScreen('forum-post-detail-screen');
                                const detailContent = document.getElementById('detail-content-area');
                                if (detailContent) detailContent.scrollTop = 0;
                            }
                        };

                        listContainer.appendChild(card);
                    });
                };

                // 3. 切换管理模式逻辑
                const newManageBtn = manageBtn.cloneNode(true);
                manageBtn.parentNode.replaceChild(newManageBtn, manageBtn);

                newManageBtn.addEventListener('click', () => {
                    isManageMode = !isManageMode;

                    if (isManageMode) {
                        listContainer.classList.add('manage-mode');
                        actionsBar.style.display = 'flex';
                        newManageBtn.style.color = '#ff4444';
                    } else {
                        listContainer.classList.remove('manage-mode');
                        actionsBar.style.display = 'none';
                        newManageBtn.style.color = '';
                    }
                    renderFavoritesList();
                });

                // 4. 批量删除逻辑
                const newDeleteBtn = deleteBtn.cloneNode(true);
                deleteBtn.parentNode.replaceChild(newDeleteBtn, deleteBtn);

                newDeleteBtn.addEventListener('click', async () => {
                    const checked = document.querySelectorAll('.fav-checkbox:checked');
                    if (checked.length === 0) return;

                    const actionName = currentFavTab === 'my-fav' ? '取消收藏' : '移除关注';

                    if (await AppUI.confirm(`确定${actionName}这 ${checked.length} 个帖子吗？`, "系统提示", "确认", "取消")) {
                        const idsToRemove = Array.from(checked).map(cb => cb.value);

                        if (currentFavTab === 'my-fav') {
                            db.favoritePostIds = db.favoritePostIds.filter(id => !idsToRemove.includes(id));
                        } else {
                            db.watchingPostIds = db.watchingPostIds.filter(id => !idsToRemove.includes(id));
                        }

                        await saveData();
                        renderFavoritesList();
                        showToast(`已${actionName}`);

                        newManageBtn.click(); // 退出管理模式
                    }
                });

                renderFavoritesList();

                // 自动刷新监听
                const favScreen = document.getElementById('favorites-screen');
                if (favScreen && !favScreen.dataset.observerAttached) {
                    const observer = new MutationObserver((mutations) => {
                        for (let mutation of mutations) {
                            if (mutation.attributeName === 'class') {
                                if (favScreen.classList.contains('active')) {
                                    renderFavoritesList();
                                }
                            }
                        }
                    });
                    observer.observe(favScreen, { attributes: true });
                    favScreen.dataset.observerAttached = "true";
                }
            }


            // --- 修改部分 1：详情页渲染 (统一头像颜色) ---
            function renderPostDetail(post) {
                db.currentViewingPostId = post.id;

                // 设置返回按钮
                const backBtn = document.querySelector('#forum-post-detail-screen .back-btn');
                if (backBtn) {
                    backBtn.dataset.target = currentSourceScreen || 'forum-screen';
                }

                const titleEl = document.getElementById('d-post-title');
                const contentEl = document.getElementById('d-post-content');
                const avatarEl = document.getElementById('d-author-avatar');
                const nameEl = document.getElementById('d-author-name');
                const timeEl = document.getElementById('d-post-time');

                const watchingBtn = document.getElementById('detail-watching-btn');
                const watchingCountEl = document.getElementById('d-like-count');

                const commentListEl = document.getElementById('detail-comment-list');
                const commentHeaderEl = document.querySelector('.comments-header');

                // 星标按钮
                const starBtn = document.getElementById('detail-star-btn');
                if (starBtn) {
                    const isFav = (db.favoritePostIds || []).includes(post.id);
                    if (isFav) starBtn.classList.add('active');
                    else starBtn.classList.remove('active');

                    const newStarBtn = starBtn.cloneNode(true);
                    starBtn.parentNode.replaceChild(newStarBtn, starBtn);

                    newStarBtn.addEventListener('click', async () => {
                        if (!db.favoritePostIds) db.favoritePostIds = [];
                        const index = db.favoritePostIds.indexOf(post.id);
                        if (index === -1) {
                            db.favoritePostIds.push(post.id);
                            newStarBtn.classList.add('active');
                            showToast('已收藏');
                        } else {
                            db.favoritePostIds.splice(index, 1);
                            newStarBtn.classList.remove('active');
                            showToast('已取消收藏');
                        }
                        await saveData();
                        if (typeof renderFavoritesList === 'function') renderFavoritesList();
                    });
                }

                const myIdentity = db.forumUserIdentity || { nickname: '我', avatar: '' };

                // 标题
                let displayTitle = post.title;
                if (displayTitle.startsWith('[New!] ')) displayTitle = displayTitle.substring(7);
                else if (displayTitle.startsWith('【新】')) displayTitle = displayTitle.substring(3);
                titleEl.textContent = displayTitle;

                // 正文
                if (post.content) {
                    contentEl.className = 'post-detail-content-body markdown-content';
                    let raw = post.content || '';
                    raw = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
                    const lines = raw.split('\n');
                    const htmlParts = lines.map(line => {
                        const text = line.trim();
                        if (!text) return '';
                        let html = marked.parse(text);
                        // --- 【核心修复 1】: 强制处理未识别的斜体 ---
                        // 解决 *文字* 紧挨着汉字时不显示斜体的问题
                        // 查找成对的星号，强制替换为 <em> 标签
                        html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

                        // --- 【核心修复 2】: 对话引号高亮 ---
                        // 匹配 “任意内容”，添加高亮样式
                        html = html.replace(/(“[^”]*”)/g, '<span class="inline-quote">$1</span>');
                        return html;
                    });
                    contentEl.innerHTML = htmlParts.join('');
                } else {
                    contentEl.innerHTML = '';
                }

                nameEl.textContent = post.username;
                timeEl.textContent = new Date(post.timestamp || Date.now()).toLocaleString();

                // 在看按钮
                if (watchingCountEl) watchingCountEl.textContent = '在看';

                if (watchingBtn) {
                    if (!db.watchingPostIds) db.watchingPostIds = [];
                    const isWatching = db.watchingPostIds.includes(post.id);

                    if (isWatching) {
                        watchingBtn.classList.add('watching');
                    } else {
                        watchingBtn.classList.remove('watching');
                    }

                    const newWatchingBtn = watchingBtn.cloneNode(true);
                    watchingBtn.parentNode.replaceChild(newWatchingBtn, watchingBtn);

                    const activeBtn = document.getElementById('detail-watching-btn');

                    activeBtn.addEventListener('click', async () => {
                        if (!db.watchingPostIds) db.watchingPostIds = [];
                        const idx = db.watchingPostIds.indexOf(post.id);

                        if (idx === -1) {
                            db.watchingPostIds.push(post.id);
                            activeBtn.classList.add('watching');
                            showToast('已加入“角色在看”列表');
                        } else {
                            db.watchingPostIds.splice(idx, 1);
                            activeBtn.classList.remove('watching');
                            showToast('已移出“角色在看”列表');
                        }
                        await saveData();
                    });
                }

                // 头像
                avatarEl.innerHTML = '';
                avatarEl.style.backgroundColor = '';
                let displayAvatar = post.avatar;
                if (post.isUser || (post.username === myIdentity.nickname && myIdentity.nickname !== '一只喵叽')) {
                    displayAvatar = myIdentity.avatar || 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg';
                }

                if (displayAvatar) {
                    const img = document.createElement('img');
                    img.src = displayAvatar;
                    img.style.width = '100%';
                    img.style.height = '100%';
                    img.style.borderRadius = '50%';
                    img.style.objectFit = 'cover';
                    avatarEl.appendChild(img);
                    avatarEl.style.backgroundColor = 'transparent';
                } else {
                    const firstChar = post.username ? post.username.charAt(0).toUpperCase() : '?';
                    avatarEl.textContent = firstChar;
                    avatarEl.style.backgroundColor = 'var(--primary-color)';
                    avatarEl.style.color = '#FFFFFF';
                }

                // 评论列表
                const commentLen = post.comments ? post.comments.length : 0;
                if (commentHeaderEl) commentHeaderEl.textContent = `全部评论 (${commentLen})`;

                let commentsHtml = '';
                const displayComments = post.comments || [];

                if (displayComments.length > 0) {
                    displayComments.forEach((comment, index) => {
                        const floorNumber = index + 1;
                        const displayTime = comment.timestamp || new Date().toLocaleString();
                        const newTag = comment.isNew ? '<span style="color: #0099FF; font-weight: bold; margin-right: 5px; font-size: 10px;font-style: italic;">New!</span>' : '';

                        let commentDisplayAvatar = comment.avatar;
                        if (comment.isUser || (comment.username === myIdentity.nickname && myIdentity.nickname !== '一只喵叽')) {
                            commentDisplayAvatar = myIdentity.avatar || 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg';
                        }

                        let avatarHtml = '';
                        if (commentDisplayAvatar) {
                            avatarHtml = `<div class="comment-author-avatar" style="background: transparent; overflow: hidden;">
                                <img src="${commentDisplayAvatar}" style="width: 100%; height: 100%; object-fit: cover;">
                              </div>`;
                        } else {
                            const cFirstChar = comment.username ? comment.username.charAt(0).toUpperCase() : '?';
                            avatarHtml = `<div class="comment-author-avatar" style="background-color: var(--accent-color); color: white;">${cFirstChar}</div>`;
                        }

                        commentsHtml += `
              <li class="comment-item">
                  ${avatarHtml}
                  <div class="comment-body">
                      <div class="comment-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 4px;">
                          <div>
                              <span class="comment-author-name">${comment.username}</span>
                          </div>
                          <div class="comment-floor" style="font-size:12px; color:#999;">${newTag}#${floorNumber}</div>
                      </div>
                      <div class="comment-content">${comment.content.replace(/\n/g, '<br>')}</div>
                      <div class="comment-timestamp" style="font-size:11px; color:#aaa; margin-top:4px;">
                        ${displayTime}
                        <span class="comment-delete-btn" data-original-index="${index}">删除</span>
                        <span class="comment-reply-btn" data-username="${comment.username}">回复</span>
                      </div>
                  </div>
              </li>
            `;
                    });
                } else {
                    commentsHtml = '<li style="padding:20px; text-align:center; color:#999;">暂无评论，快来抢沙发吧~</li>';
                }
                commentListEl.innerHTML = commentsHtml;

                // 【新增】应用自定义CSS
                applyCustomPostCss();
            }

            // 代理点击事件处理“回复”
            document.getElementById('detail-comment-list').addEventListener('click', (e) => {
                if (e.target.classList.contains('comment-reply-btn')) {
                    const username = e.target.dataset.username;
                    const input = document.getElementById('reply-content-input');
                    input.value = `回复 @${username}：`;
                    input.focus();
                }
            });


            function getWatchingPostsContext() {
                if (!db.watchingPostIds || db.watchingPostIds.length === 0) return "";

                let context = "\n【角色正在浏览/关注的论坛帖子】\n(注意：这是当前打开的、角色正在手机屏幕上看到的帖子内容，角色可以对此发表看法)\n";

                // 遍历所有在看的帖子 ID
                db.watchingPostIds.forEach((id, index) => {
                    const post = db.forumPosts.find(p => p.id === id);
                    if (post) {
                        const timeStr = new Date(post.timestamp).toLocaleString();
                        context += `\n--- 帖子 ${index + 1} ---\n`;
                        context += `标题：${post.title.replace(/^\[New!\]\s*/, '')}\n`;
                        context += `作者：${post.username}\n`;
                        context += `发布时间：${timeStr}\n`;
                        context += `正文内容：${post.content}\n`;

                        if (post.comments && post.comments.length > 0) {
                            context += `\n评论区：\n`;
                            post.comments.forEach((c, cIdx) => {
                                context += `${cIdx + 1}. ${c.username}: ${c.content}\n`;
                            });
                        } else {
                            context += `\n评论区：暂无评论\n`;
                        }
                        context += `-------------------\n`;
                    }
                });

                return context;
            }


            function setupForumFeature() {
                const refreshBtn = document.getElementById('forum-refresh-btn');
                const createBtn = document.getElementById('forum-create-btn');
                const postsContainer = document.getElementById('forum-posts-container');
                const forumScreen = document.getElementById('forum-screen');

                // 1. 初始化新模块
                setupBottomNavigation();
                setupMePageFeature();
                setupForumBindingFeature();
                setupFavoritesFeature();
                renderHotPosts();

// 修改 JS 选择器
const scrollableArea = document.querySelector('#forum-screen .forum-content-area');
    
    if (scrollableArea) {
        scrollableArea.addEventListener('scroll', () => {
            // 简单的防抖锁
            if (isForumLoadingMore) return;

            // 距离底部 100px 时触发加载
            const threshold = 300;
            const distanceToBottom = scrollableArea.scrollHeight - (scrollableArea.scrollTop + scrollableArea.clientHeight);

            if (distanceToBottom < threshold) {
                const totalPosts = db.forumPosts ? db.forumPosts.length : 0;
                // 如果还有未加载的数据
                if (totalPosts > currentForumPage * FORUM_PAGE_SIZE) {
                    isForumLoadingMore = true;
                    
                    // 模拟一点延迟，或直接加载
                    currentForumPage++; // 页码+1
                    renderForumPosts(db.forumPosts, true); // true = 追加模式
                    
                    // 解锁
                    setTimeout(() => { isForumLoadingMore = false; }, 200);
                }
            }
        });
    }


                // 2. 搜索/刷新按钮
                if (refreshBtn) {
                    refreshBtn.addEventListener('click', () => {
                        handleForumRefresh();
                    });
                }

                // 3. 发帖按钮逻辑
                if (createBtn) {
                    const createModal = document.getElementById('forum-create-post-modal');
                    const confirmCreate = document.getElementById('confirm-create-post-btn');
                    const anonCheckbox = document.getElementById('create-post-is-anon');

                    // 点击“发帖”按钮打开弹窗
                    createBtn.addEventListener('click', () => {
                        document.getElementById('create-post-title').value = '';
                        document.getElementById('create-post-content').value = '';

                        // 默认不勾选匿名
                        if (anonCheckbox) anonCheckbox.checked = false;

                        createModal.classList.add('visible');
                    });

                    // 点击遮罩层关闭
                    createModal.addEventListener('click', (e) => {
                        if (e.target === createModal) {
                            createModal.classList.remove('visible');
                        }
                    });

                    // 确认发送按钮
                    const newConfirmBtn = confirmCreate.cloneNode(true);
                    confirmCreate.parentNode.replaceChild(newConfirmBtn, confirmCreate);

                    newConfirmBtn.addEventListener('click', async () => {
                        const titleInput = document.getElementById('create-post-title').value.trim();
                        const content = document.getElementById('create-post-content').value.trim();

                        // 获取身份
                        const isAnon = anonCheckbox ? anonCheckbox.checked : false;
                        const myIdentity = db.forumUserIdentity || { nickname: '我', avatar: '' };

                        // 【修改】使用 getAnonymousName()
                        const selectedAuthor = isAnon ? getAnonymousName() : (myIdentity.nickname || '我');

                        if (!titleInput || !content) {
                            showToast('标题和内容不能为空');
                            return;
                        }

                        let postAvatar = null;
                        let isUserPost = false;

                        // 如果不是匿名，标记为本人并保存头像
                        if (!isAnon) {
                            postAvatar = myIdentity.avatar || 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg';
                            isUserPost = true;
                        }

                        // 1. 清除旧标记
                        if (db.forumPosts) {
                            db.forumPosts.forEach(p => {
                                if (p.title) {
                                    p.title = p.title.replace(/^\[New!\]\s*/, '').replace(/^【新】/, '');
                                }
                            });
                        } else {
                            db.forumPosts = [];
                        }

                        // 2. 新帖
                        const finalTitle = '[New!] ' + titleInput;

                        const newPost = {
                            id: `post_${Date.now()}_${Math.random()}`,
                            username: selectedAuthor,
                            title: finalTitle,
                            content: content,
                            likeCount: Math.floor(Math.random() * 9000) + 50,
                            comments: [],
                            timestamp: Date.now(),
                            avatar: postAvatar,
                            isUser: isUserPost
                        };

                        db.forumPosts.unshift(newPost);
                        await saveData();
                        renderForumPosts(db.forumPosts);

                        createModal.classList.remove('visible');
                        showToast('发送成功');
                    });
                }

                // 4. 帖子列表点击进入详情
                if (postsContainer) {
                    postsContainer.addEventListener('click', (e) => {
                        const card = e.target.closest('.forum-post-card[data-id]');
                        if (card) {
   // 1. 【新增】保存当前滚动条位置
            const scrollArea = document.querySelector('#forum-screen .forum-content-area');
            if (scrollArea) {
                savedForumScrollY = scrollArea.scrollTop;
            }                         currentSourceScreen = 'forum-screen';
                            const postId = card.dataset.id;
                            const post = db.forumPosts.find(p => p.id === postId);
                            if (post) {
                                renderPostDetail(post);
                                switchScreen('forum-post-detail-screen');
                                const detailContent = document.getElementById('detail-content-area');
                                if (detailContent) {
                                    detailContent.scrollTop = 0;
                                }
                            }
                        }
                    });
                }

                // 5. 观察者
                // --- 找到 setupForumFeature 末尾的 observer 并替换 ---

const observer = new MutationObserver((mutations) => {
    for (let mutation of mutations) {
        if (mutation.attributeName === 'class') {
            const isActive = forumScreen.classList.contains('active');
            
            if (isActive) {
                // 1. 搜索框重置 (保持不变)
                const searchInput = document.getElementById('forum-search-input');
                if (searchInput) searchInput.value = '';

                // 2. 底部导航激活 (保持不变)
                const bottomNav = document.querySelector('.bottom-tab-bar'); 
     if (bottomNav) {
        // 重置所有激活状态
        bottomNav.querySelectorAll('.tab-item').forEach(tab => tab.classList.remove('active'));
        // 激活“发现页”的主页图标
        const discoverTab = bottomNav.querySelector('.tab-item[data-target="forum-screen"]');
        if (discoverTab) discoverTab.classList.add('active');
    }

                // ==========================================
                // 【核心修改逻辑】
                // ==========================================
                const postsContainer = document.getElementById('forum-posts-container');
                const scrollArea = document.querySelector('#forum-screen .forum-content-area');
                
                // 判断当前列表是否有内容（排除 loading 和 占位符）
                const hasContent = postsContainer.children.length > 0 && 
                                   !postsContainer.querySelector('.placeholder-text') &&
                                   !postsContainer.querySelector('.temp-loading');

                if (db.forumPosts && db.forumPosts.length > 0) {
                    if (hasContent) {
                        // A. 如果列表里已经有帖子了（说明是从详情页返回的，或者切了Tab又切回来）
                        //    -> 绝对不要重绘！保留现有的DOM结构（包括你加载的那20页数据）
                        //    -> 仅仅恢复滚动位置
                        if (scrollArea && savedForumScrollY > 0) {
                            // 稍微延迟一点点，确保浏览器切换显示的渲染完成
                            requestAnimationFrame(() => {
                                scrollArea.scrollTop = savedForumScrollY;
                            });
                        }
                    } else {
                        // B. 如果列表是空的（说明是第一次打开，或者被强制刷新过）
                        //    -> 执行初始化渲染 (重置模式)
                        renderForumPosts(db.forumPosts, false);
                        renderHotPosts();
                        
                        // 既然是重新渲染，位置归零
                        if (scrollArea) scrollArea.scrollTop = 0;
                        savedForumScrollY = 0;
                    }
                }
            }
        }
    }
});

                if (forumScreen) {
                    observer.observe(forumScreen, { attributes: true });
                }

                setupDetailScreenEvents();
                
            }






            function setupDetailScreenEvents() {
                // 1. 处理匿名按钮的视觉切换
                const anonTrigger = document.getElementById('reply-anon-trigger');
                const anonCheckbox = document.getElementById('reply-is-anon');

                if (anonTrigger && anonCheckbox) {
                    // 重置状态
                    anonCheckbox.checked = false;
                    anonTrigger.classList.remove('selected');

                    // 使用克隆防止重复绑定
                    const newTrigger = anonTrigger.cloneNode(true);
                    anonTrigger.parentNode.replaceChild(newTrigger, anonTrigger);

                    // 重新获取新节点
                    const currentTrigger = document.getElementById('reply-anon-trigger');
                    // 注意：内部的 input 也被克隆了，需要重新获取
                    const currentCheckbox = currentTrigger.querySelector('input');

                    currentTrigger.addEventListener('click', () => {
                        currentCheckbox.checked = !currentCheckbox.checked;

                        if (currentCheckbox.checked) {
                            currentTrigger.classList.add('selected');
                        } else {
                            currentTrigger.classList.remove('selected');
                        }
                    });
                }

                // 2. 回复发送逻辑
                const submitBtn = document.getElementById('submit-reply-btn');
                const newSubmitBtn = submitBtn.cloneNode(true);
                submitBtn.parentNode.replaceChild(newSubmitBtn, submitBtn);

                newSubmitBtn.addEventListener('click', async () => {
                    const contentInput = document.getElementById('reply-content-input');
                    const content = contentInput.value.trim();
                    const postId = db.currentViewingPostId;

                    if (!postId) return;
                    const post = db.forumPosts.find(p => p.id === postId);
                    if (!post) return;

                    if (!content) {
                        showToast('评论内容不能为空');
                        return;
                    }

                    // 获取匿名状态 (直接查DOM)
                    const isAnon = document.getElementById('reply-is-anon').checked;
                    const myIdentity = db.forumUserIdentity || { nickname: '我', avatar: '' };
                    // 【修改】使用 getAnonymousName()
                    const author = isAnon ? getAnonymousName() : (myIdentity.nickname || '我');

                    if (post.comments) {
                        post.comments.forEach(c => delete c.isNew);
                    } else {
                        post.comments = [];
                    }

                    let commentAvatar = null;
                    let isUserComment = false;

                    if (!isAnon) {
                        commentAvatar = myIdentity.avatar || 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg';
                        isUserComment = true;
                    }

                    const newComment = {
                        username: author,
                        content: content,
                        timestamp: new Date().toLocaleString(),
                        isNew: true,
                        avatar: commentAvatar,
                        isUser: isUserComment
                    };

                    post.comments.push(newComment);
                    await saveData();
                    contentInput.value = '';

                    renderPostDetail(post);

                    const area = document.getElementById('detail-content-area');
                    if (area) area.scrollTop = area.scrollHeight;

                    showToast('回复成功');
                });

                // 3. 评论删除事件
                const listEl = document.getElementById('detail-comment-list');
                listEl.onclick = async (e) => {
                    if (e.target.classList.contains('comment-delete-btn')) {
                        const index = parseInt(e.target.dataset.originalIndex);
                        const postId = db.currentViewingPostId;
                        const post = db.forumPosts.find(p => p.id === postId);

                        if (post && await AppUI.confirm('确定要删除这条评论吗？', "系统提示", "确认", "取消")) {
                            post.comments.splice(index, 1);
                            await saveData();
                            renderPostDetail(post);
                            showToast('评论已删除');
                        }
                    }
                };


const deletePostBtn = document.getElementById('d-delete-btn');
if (deletePostBtn) {
    const newDelBtn = deletePostBtn.cloneNode(true);
    deletePostBtn.parentNode.replaceChild(newDelBtn, deletePostBtn);
    
    newDelBtn.addEventListener('click', async () => {
        const postId = db.currentViewingPostId;
        
        if (!postId) {
            showToast('无法获取帖子ID');
            return;
        }
        
        if (await AppUI.confirm('确定要删除这条帖子吗？', "系统提示", "确认", "取消")) {
            try {
                // ★★★ 1. 先从数据库删除（最重要！）★★★
                await dexieDB.forumPosts.delete(postId);
                
                // 2. 从内存数组中删除
                db.forumPosts = db.forumPosts.filter(p => p.id !== postId);
                
                // 3. 清理收藏和关注
                if (db.favoritePostIds) {
                    db.favoritePostIds = db.favoritePostIds.filter(id => id !== postId);
                }
                if (db.watchingPostIds) {
                    db.watchingPostIds = db.watchingPostIds.filter(id => id !== postId);
                }
                
                // 4. 保存收藏和关注的变化
                await saveData();

                // 5. 清理主页DOM
                const mainContainer = document.getElementById('forum-posts-container');
                if (mainContainer) {
                    const cardToRemove = mainContainer.querySelector(`.forum-post-card[data-id="${postId}"]`);
                    if (cardToRemove) {
                        cardToRemove.remove();
                    }
                }

                // 6. 刷新热帖
                if (typeof renderHotPosts === 'function') {
                    renderHotPosts();
                }

                showToast('帖子已删除');
                switchScreen('forum-screen');
                
            } catch (e) {
                console.error('删除帖子失败:', e);
                showToast('删除失败: ' + e.message);
            }
        }
    });
}

                // 5. AI 生成
                const aiBtn = document.getElementById('detail-ai-btn');
                if (aiBtn) {
                    const newAiBtn = aiBtn.cloneNode(true);
                    aiBtn.parentNode.replaceChild(newAiBtn, aiBtn);
                    newAiBtn.addEventListener('click', () => {
                        const postId = db.currentViewingPostId;
                        const post = db.forumPosts.find(p => p.id === postId);
                        if (post) handleGenerateComments(post);
                    });
                }

                // 6. 分享
                const shareBtn = document.getElementById('detail-share-btn');
                if (shareBtn) {
                    const newShareBtn = shareBtn.cloneNode(true);
                    shareBtn.parentNode.replaceChild(newShareBtn, shareBtn);
                    newShareBtn.addEventListener('click', () => {
                        const postId = db.currentViewingPostId;
                        if (postId) openSharePostModal(postId);
                    });
                }

                // 7. 复制标题和正文
                const copyBtn = document.getElementById('d-copy-btn');
                if (copyBtn) {
                    const newCopyBtn = copyBtn.cloneNode(true);
                    copyBtn.parentNode.replaceChild(newCopyBtn, copyBtn);

                    newCopyBtn.addEventListener('click', () => {
                        const titleEl = document.getElementById('d-post-title');
                        const contentEl = document.getElementById('d-post-content');

                        if (!titleEl || !contentEl) return;

                        const titleText = titleEl.innerText || '';
                        const contentText = contentEl.innerText || '';
                        const textToCopy = `${titleText}\n\n${contentText}`;

                        const handleSuccess = () => {
                            showToast('已复制到剪贴板');
                            newCopyBtn.style.color = 'var(--primary-color)';
                            setTimeout(() => { newCopyBtn.style.color = ''; }, 200);
                        };

                        const handleError = (err) => {
                            console.error('复制出错:', err);
                            showToast('复制失败，请手动复制');
                        };

                        const fallbackCopy = (text) => {
                            try {
                                const textArea = document.createElement("textarea");
                                textArea.value = text;
                                textArea.style.top = "0";
                                textArea.style.left = "0";
                                textArea.style.position = "fixed";
                                textArea.style.opacity = "0";
                                document.body.appendChild(textArea);
                                textArea.focus();
                                textArea.select();
                                const successful = document.execCommand('copy');
                                document.body.removeChild(textArea);
                                if (successful) handleSuccess();
                                else handleError('execCommand failed');
                            } catch (err) {
                                handleError(err);
                            }
                        };

                        if (navigator.clipboard && window.isSecureContext) {
                            navigator.clipboard.writeText(textToCopy)
                                .then(handleSuccess)
                                .catch(() => {
                                    fallbackCopy(textToCopy);
                                });
                        } else {
                            fallbackCopy(textToCopy);
                        }
                    });
                }
            }






            // 辅助函数：更新回复框的 User 选项

            function updateReplyAuthorSelect() {
                const select = document.getElementById('reply-author-select');
                if (!select) return;

                // 清空除了"匿名"以外的选项
                select.innerHTML = '';

                // 1. 匿名选项
                const anon = document.createElement('option');
                anon.value = '喵叽0311';
                anon.textContent = '喵叽0311';
                select.appendChild(anon);

                // 2. “我”的选项
                const myIdentity = db.forumUserIdentity || { nickname: '我' };
                const myName = myIdentity.nickname || '我';

                const opt = document.createElement('option');
                opt.value = myName;
                opt.textContent = myName; // 显示昵称
                opt.selected = true;      // 默认选中
                select.appendChild(opt);
            }

            function setupShareModal() {
                const modal = document.getElementById('share-post-modal');
                const confirmBtn = document.getElementById('confirm-share-btn');
                const charList = document.getElementById('share-char-list');
                const countInput = document.getElementById('share-comment-count-input'); // 获取输入框

                const newBtn = confirmBtn.cloneNode(true);
                confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);

                newBtn.addEventListener('click', async () => {
                    const selectedCharIds = Array.from(charList.querySelectorAll('input:checked')).map(input => input.value);

                    if (selectedCharIds.length === 0) {
                        showToast('请至少选择一个分享对象。');
                        return;
                    }

                    // 获取用户输入的条数
                    let commentCount = 30;
                    if (countInput) {
                        commentCount = parseInt(countInput.value);
                        if (isNaN(commentCount) || commentCount < 0) commentCount = 0;
                    }

                    const postTitle = modal.dataset.postTitle;
                    const postRawContent = modal.dataset.postRawContent || "";
                    // 这里我们需要重新构建 context，因为之前的 dataset 可能只存了部分
                    // 为了确保实时性和自定义条数，最好重新从 DB 读 post
                    const currentPost = db.forumPosts.find(p => p.title.includes(postTitle) || p.content === postRawContent);
                    // 简单的查找方式，实际上 openSharePostModal 应该存 ID
                    // 这里简化逻辑，利用 dataset 里的 ID 更好

                    // 修正：openSharePostModal 需要存 ID
                    // 假设 modal.dataset.postId 存在 (需要在 openSharePostModal 增加一行)

                    let targetPost = currentPost;
                    // 如果上面没找到，尝试模糊匹配

                    let richContext = "";
                    let visibleSnippet = postRawContent.substring(0, 50);
                    if (postRawContent.length > 50) visibleSnippet += "...";

                    if (targetPost) {
                        const postTime = new Date(targetPost.timestamp || Date.now()).toLocaleString();
                        let commentsText = "暂无评论";

                        if (targetPost.comments && targetPost.comments.length > 0) {
                            // --- 关键修改：按顺序切片 ---
                            // 需求：分享评论20-30给角色，角色看到的顺序是20,21...
                            // slice(-N) 获取最后N个。由于数组是按时间push的，所以顺序本身就是旧->新
                            // 直接 slice(-commentCount) 即可保持顺序
                            const sliceCount = commentCount === 0 ? 0 : commentCount;
                            let recentComments = [];
                            if (sliceCount > 0) {
                                recentComments = targetPost.comments.slice(-sliceCount);
                            }

                            commentsText = recentComments.map(c => `${c.username}: ${c.content}`).join('\n');
                        }

                        richContext = `\n\n=== 帖子详情 ===\n发帖人：${targetPost.username}\n发布时间：${postTime}\n\n【完整正文】\n${targetPost.content}\n\n【最新 ${commentCount} 条评论】\n${commentsText}`;
                    } else {
                        richContext = modal.dataset.postRichContext || "";
                    }

                    selectedCharIds.forEach(charId => {
                        const character = db.characters.find(c => c.id === charId);
                        if (character) {
                            const messageContent = `[喵坛分享]标题：${postTitle}\n内容：${visibleSnippet}<span style="display:none;">${richContext}</span>`;

                            const message = {
                                id: `msg_${Date.now()}_${Math.random()}`,
                                role: 'user',
                                content: messageContent,
                                parts: [{ type: 'text', text: messageContent }],
                                timestamp: Date.now()
                            };
                            character.history.push(message);
                        }
                    });

                    await saveData();
                    try { if (typeof renderChatList === 'function') renderChatList(); } catch (e) { }

                    modal.classList.remove('visible');
                    showToast(`成功分享给 ${selectedCharIds.length} 位联系人！`);
                });
            }

            // 完整替换 openSharePostModal 函数
            function openSharePostModal(postId) {
                const post = db.forumPosts.find(p => p.id === postId);
                if (!post) {
                    showToast('找不到该帖子信息。');
                    return;
                }

                const modal = document.getElementById('share-post-modal');
                const charList = document.getElementById('share-char-list');
                const detailsElement = modal.querySelector('details');

                // --- 1. 清理标题中的 [New!] 标记 ---
                let cleanTitle = post.title || "无标题";
                if (cleanTitle.startsWith('[New!] ')) {
                    cleanTitle = cleanTitle.substring(7);
                } else if (cleanTitle.startsWith('【新】')) {
                    cleanTitle = cleanTitle.substring(3);
                }

                // --- 2. 将数据存入 dataset ---
                // 存入清理后的标题
                modal.dataset.postTitle = cleanTitle;

                // 存入原始正文（用于生成卡片上显示的50字摘要）
                modal.dataset.postRawContent = post.content || "";

                // --- 3. 构建完整上下文（隐藏在卡片里，给AI看） ---
                const postTime = new Date(post.timestamp || Date.now()).toLocaleString();
                let commentsText = "";
                if (post.comments && post.comments.length > 0) {
                    // 取最新30条评论，倒序（最新的在前）
                    const recentComments = post.comments.slice(-30).reverse();
                    commentsText = recentComments.map(c => `${c.username}: ${c.content}`).join('\n');
                } else {
                    commentsText = "暂无评论";
                }

                // 组合成AI能读懂的格式
                const richContext = `\n\n=== 帖子详情 (系统后台数据) ===\n发帖人：${post.username}\n发布时间：${postTime}\n\n【完整正文】\n${post.content}\n\n【最新评论】\n${commentsText}`;

                modal.dataset.postRichContext = richContext;

                // --- 4. 渲染分享对象列表 (保持不变) ---
                charList.innerHTML = '';
                if (db.characters.length > 0) {
                    db.characters.forEach(char => {
                        const li = document.createElement('li');
                        li.className = 'binding-list-item';
                        li.innerHTML = `
                <input type="checkbox" id="share-to-${char.id}" value="${char.id}">
                <label for="share-to-${char.id}" style="display: flex; align-items: center; gap: 10px;">
                    <img src="${char.avatar}" alt="${char.remarkName}" style="width: 32px; height: 32px; border-radius: 50%;">
                    ${char.remarkName}
                </label>
            `;
                        charList.appendChild(li);
                    });
                } else {
                    charList.innerHTML = '<li style="color: #888;">暂无可以分享的角色。</li>';
                }

                if (detailsElement) detailsElement.open = false;
                modal.classList.add('visible');
            }


function getForumGenerationContext() {
    let context = "这是一个名叫“喵坛”的社区，以下是背景设定和主要角色信息（仅供你理解世界观和潜台词）。\n";

    // 获取绑定信息
    // 1. 读取 historyLimit，如果没有则默认为 50
    const bindings = db.forumBindings || { worldBookIds: [], charIds: [], useChatHistory: false, historyLimit: 50 };
    
    // 确保它是数字，防止读取出错（兜底逻辑）
    const historyLimit = Number(bindings.historyLimit) || 50; // <--- 新增：获取保存的条数
    
    
    const now = new Date();
    const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
    const currentWeekDay = weekDays[now.getDay()]; 
    const currentTime = `${now.getFullYear()}年${pad(now.getMonth() + 1)}月${pad(now.getDate())}日 星期${currentWeekDay} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

    // --- 1. 预处理：分别提取三种位置的世界书内容 ---
    let wbBefore = "";
    let wbAfter = "";

    if (bindings.worldBookIds && bindings.worldBookIds.length > 0) {
        // 提取 Before
        wbBefore = bindings.worldBookIds
            .map(id => db.worldBooks.find(wb => wb.id === id && wb.position === 'before'))
            .filter(Boolean).map(wb => wb.content).join('\n');
        
        // 提取 After
        wbAfter = bindings.worldBookIds
            .map(id => db.worldBooks.find(wb => wb.id === id && wb.position === 'after'))
            .filter(Boolean).map(wb => wb.content).join('\n');

    }

    // --- 2. 组装顺序：背景 -> 文风 -> 角色 -> After -> 用户 ---

    // (A) 背景设定 (Before)
    if (wbBefore) {
        context += "===== 世界观及背景设定 =====\n";
        context += `${wbBefore}\n\n`;
    }


    // (C) 角色人设 (Characters)
    if (bindings.charIds && bindings.charIds.length > 0) {
        context += "===== 主要角色人设 & 近期动态 =====\n";

        bindings.charIds.forEach(id => {
            const char = db.characters.find(c => c.id === id);
            if (char) {
                context += `--- 角色: ${char.realName} ---\n`;
                context += `人设描述: ${char.persona}\n`;

                if (bindings.useChatHistory) {
                    if (char.history && char.history.length > 0) {
                        const recentHistory = char.history.slice(-historyLimit);
                        const historyStr = recentHistory.map(msg => {
                            const roleLabel = msg.role === 'user' ? 'User' : 'Character';
                            let cleanContent = msg.content;
                            if (typeof cleanContent !== 'string') cleanContent = "[非文本消息]";
                            return `${roleLabel}: ${cleanContent}`;
                        }).join('\n');
                        context += `[近期私聊记录]:\n${historyStr}\n`;
                    } else {
                        context += `[近期私聊记录]: 暂无\n`;
                    }
                } else {
                    context += `[近期私聊记录]: (已关闭记忆关联)\n`;
                }
                context += "\n";
            }
        });
    }



    // (E) 用户人设 (User)
    if (db.forumUserIdentity) {
        context += "===== (用户/User) 的人设 =====\n";
        context += `用户的昵称: ${db.forumUserIdentity.nickname || 'User'}\n`;
        // 如果有真名，加入真名
        if (db.forumUserIdentity.realName) {
            context += `用户的姓名: ${db.forumUserIdentity.realName}\n`;
        }
        if (db.forumUserIdentity.persona) {
            context += `用户的设定: ${db.forumUserIdentity.persona}\n`;
        }
        context += `注意：发帖人或者评论人绝对不是用户/user。\n\n`;
    }

    // (D) 其他事项 (After) - 移动到了角色人设后面
    if (wbAfter) {
        context += "===== 重要事项 =====\n";
        context += `${wbAfter}\n\n`;
    }

    context += `当前日期和时间是${currentTime}\n\n`;

    if (context.length < 50) {
        return `当前日期和时间是${currentTime}，没有提供任何特定的背景设定，请自由发挥。`;
    }

    return context;
}




            // --- 新增：文本解析工具函数 ---
            function parseAIResponseToPost(text) {
                // 1. 提取作者 (新增)
                // 匹配 #AUTHOR# 和 #TITLE# 之间的内容
                const authorMatch = text.match(/#AUTHOR#\s*([\s\S]*?)\s*#TITLE#/i);
                const author = authorMatch ? authorMatch[1].trim() : null;

                // 2. 提取标题
                const titleMatch = text.match(/#TITLE#\s*([\s\S]*?)\s*#CONTENT#/i);
                const title = titleMatch ? titleMatch[1].trim() : "无标题";

                // 3. 提取正文 (匹配到 #COMMENTS# 之前)
                const contentMatch = text.match(/#CONTENT#\s*([\s\S]*?)\s*#COMMENTS#/i);
                const content = contentMatch ? contentMatch[1].trim() : (text.split('#CONTENT#')[1] || "内容解析失败").trim();

                // 4. 提取并解析评论
                const comments = [];
                const commentsBlockMatch = text.match(/#COMMENTS#\s*([\s\S]*)/i);

                if (commentsBlockMatch) {
                    const commentsBlock = commentsBlockMatch[1];
                    const lines = commentsBlock.split('\n');

                    lines.forEach(line => {
                        line = line.trim();
                        if (!line) return;
                        if (line.includes('===SEP===')) return;

                        let colonIndex = line.indexOf(':');
                        if (colonIndex === -1) colonIndex = line.indexOf('：');

                        if (colonIndex > 0) {
                            comments.push({
                                username: line.substring(0, colonIndex).trim(),
                                content: line.substring(colonIndex + 1).trim(),
                                timestamp: "刚刚"
                            });
                        }
                    });
                }

                return { author, title, content, comments };
            }






            // --- 新增：随机趣味网名生成器 ---
            function getRandomNetName() {
                const prefixes = ["迷路", "点心", "木偶", "毛线", "呢喃", "S", "摸鱼", "我才不是", "嘎嘎", "你是", "啊哦", "Q", "机械"];
                const nouns = ["路人", "毛绒绒", "呆呆", "Cat", "喵叽", "星夜", "铲屎官", "咸鱼", "橘子精", "潜水艇", "球球", "宠物", "魔法师"];

                const randomPrefix = prefixes[Math.floor(Math.random() * prefixes.length)];
                const randomNoun = nouns[Math.floor(Math.random() * nouns.length)];

                return randomPrefix + randomNoun;
            }





            async function handleForumRefresh() {
savedForumScrollY = 0;
                const { url, key, model } = db.apiSettings;
                if (!url || !key || !model) {
                    showToast('请先配置API');
                    return;
                }

                const refreshBtn = document.getElementById('forum-refresh-btn');
                const postsContainer = document.getElementById('forum-posts-container');
                const searchInput = document.getElementById('forum-search-input');

                refreshBtn.disabled = true;
                refreshBtn.style.opacity = "0.5";
                refreshBtn.style.cursor = "not-allowed";

                // --- 强制生效版：创建加载容器 ---
                const loadingDiv = document.createElement('div');
                loadingDiv.className = 'temp-loading';

                // 1. 直接设置容器样式：强制 Flex 布局，横向排列，居中，垂直留白
                loadingDiv.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        padding: 20px 10px 0 10px;
        color: #666;
        font-size: 14px;
        width: 100%;
        box-sizing: border-box;
    `;

                // 2. 插入 HTML (包含内联样式的 spinner)
                // 注意：animation 必须依赖上面 CSS 中的 @keyframes spin
                loadingDiv.innerHTML = `
        <div class="spinner" style="
            width: 20px; 
            height: 20px; 
            border: 3px solid rgba(0, 0, 0, 0.1); 
            border-left-color: var(--primary-color); 
            border-radius: 50%; 
            animation: spin 0.8s linear infinite;
            flex-shrink: 0;
        "></div>
        <span>正在刷新最新发帖内容...</span>
    `;

                if (postsContainer.firstChild) {
                    postsContainer.insertBefore(loadingDiv, postsContainer.firstChild);
                } else {
                    postsContainer.appendChild(loadingDiv);
                }

                try {
                    const context = getForumGenerationContext();
                    const keywords = searchInput.value.trim();
// --- 新增：专门获取“写作专用”的世界书 ---
        // 目的：为了强调文风，将其单独提取出来，放在 Prompt 的醒目位置
        const bindings = db.forumBindings || { worldBookIds: [] };
        const worldBooksWriting = (bindings.worldBookIds || [])
            .map(id => db.worldBooks.find(wb => wb.id === id && wb.position === 'writing'))
            .filter(Boolean)
            .map(wb => wb.content)
            .join('\n');
                    const myIdentity = db.forumUserIdentity || { nickname: '我' };
                    const myNickname = myIdentity.nickname || '我';

                    let systemPrompt = `你的角色是“社区模拟器”。请根据背景创作【4-8条】风格各异的新帖子。
背景资料：${context}

【绝对禁止】:AUTHOR和COMMENTS评论者**绝对不能**是【${myNickname}】（user）。

【格式要求】：
严格按照以下格式返回，**每两个帖子之间使用 "===SEP===" 进行分隔**。直接返回文本：

#AUTHOR#
发帖人网名
#TITLE#
帖子1标题
#CONTENT#
帖子1正文内容...
#COMMENTS#
网名A:评论内容
网名B:评论内容
===SEP===
#AUTHOR#
发帖人网名2
#TITLE#
帖子2标题
#CONTENT#
帖子2正文...
#COMMENTS#
网名C:评论内容

其他要求：
1. 随机生成 4 到 8 个AUTHOR不同的帖子。帖子主体语言为CHINESE。每个帖子下生成5-7条评论。
2.发帖人、评论者网名由你编撰。极少数发帖人或评论者想要隐藏身份时，可以选择匿名评论，匿名评论用户名为“喵叽”+论坛随机生成的四位数字。
3. 格式必须包含 #AUTHOR#,#TITLE#, #CONTENT#, #COMMENTS# 这4个标签。
4. **#COMMENTS# 下方直接列出评论**，每行一条，格式为 "网名:评论内容"。不要再加其他标签。

`;


                    if (keywords) {
                        systemPrompt += `\n\n这些帖子必须与关键词【${keywords}】相关。`;
                    }
                    
                    if (worldBooksWriting) {
            systemPrompt += `\n\n【重要：文风与写作指导】\n请严格遵守以下写作风格或格式要求：\n${worldBooksWriting}\n`;
        }

                    const requestBody = {
                        model: model,
                        messages: [{ role: "user", content: systemPrompt }],
                        temperature: 1.0, // 提高创造性
                    };

                    const response = await fetch(`${url}/v1/chat/completions`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
                        body: JSON.stringify(requestBody)
                    });

                    if (!response.ok) throw new Error(`API error: ${response.status}`);

                    const result = await response.json();
                    const contentStr = result.choices[0].message.content;

                    const rawPosts = contentStr.split('===SEP===');
                    const newPostsToAdd = [];

                    // 清除旧帖子的 [New!] 标记
                    if (db.forumPosts && db.forumPosts.length > 0) {
                        db.forumPosts.forEach(p => {
                            if (p.title) {
                                p.title = p.title.replace(/^\[New!\]\s*/, '').replace(/^【新】/, '');
                            }
                        });
                    }

                    rawPosts.forEach(rawText => {
                        if (!rawText.trim()) return;

                        const parsedData = parseAIResponseToPost(rawText);

                        if (parsedData.title && parsedData.title !== "无标题") {
                            const now = Date.now();

                            // 处理评论
                            if (parsedData.comments) {
                                parsedData.comments.forEach((c, idx) => {
                                    const timeOffset = idx * 3000 + Math.random() * 600;
                                    c.timestamp = new Date(now + timeOffset).toLocaleString();
                                    c.isNew = true;
                                    c.isUser = false;
                                    c.avatar = null;

                                    if (c.username === myNickname) c.username = getRandomNetName();
                                    // 过滤掉 AI 可能生成的“喵叽”

                                });
                            }

                            // --- 修改点：使用随机网名生成器作为兜底 ---
                            let authorName = parsedData.author;

                            if (authorName === myNickname) {
                                authorName = getRandomNetName();
                            }

                            const viewCount = Math.floor(Math.random() * 9000) + 50;

                            const newPost = {
                                id: `post_${Date.now()}_${Math.random()}`,
                                username: authorName,
                                title: '[New!] ' + parsedData.title,
                                content: parsedData.content,
                                likeCount: viewCount,
                                comments: parsedData.comments || [],
                                timestamp: Date.now(),
                                isUser: false,
                                avatar: null
                            };
                            newPostsToAdd.push(newPost);
                        }
                    });

                    if (newPostsToAdd.length > 0) {
                        if (!db.forumPosts) db.forumPosts = [];
                        db.forumPosts.unshift(...newPostsToAdd);
                        await saveData();

                        if (loadingDiv && loadingDiv.parentNode) loadingDiv.remove();

                        renderForumPosts(db.forumPosts, false); 
                        renderHotPosts();
                        showToast(`成功刷新 ${newPostsToAdd.length} 条新帖子！`);
                    } else {
                        if (loadingDiv && loadingDiv.parentNode) loadingDiv.remove();
                        showToast('未生成有效内容，请重试');
                    }

                } catch (error) {
                    console.error(error);
                    if (loadingDiv && loadingDiv.parentNode) loadingDiv.remove();
                    showToast('生成失败: ' + error.message);
                } finally {
                    refreshBtn.disabled = false;
                    refreshBtn.style.opacity = "1";
                    refreshBtn.style.cursor = "pointer";
                }
            }







// --- 找到 renderForumPosts 函数并完全替换 ---
function renderForumPosts(posts, isAppend = false) {
    const postsContainer = document.getElementById('forum-posts-container');
    if (!postsContainer) return;

    // 1. 如果不是追加模式（即刷新或首次进入），先清空容器（保留 loading）
    if (!isAppend) {
        currentForumPage = 1; // 重置页码
        // 移除所有非 loading 元素
        Array.from(postsContainer.children).forEach(child => {
            if (!child.classList.contains('temp-loading')) child.remove();
        });
        
        // 滚动条回到顶部
        const contentArea = document.querySelector('#forum-screen .forum-content-area');
        if (contentArea) contentArea.scrollTop = 0;
    }

    if (!posts || posts.length === 0) {
        if (!isAppend && !postsContainer.querySelector('.temp-loading')) {
            postsContainer.innerHTML = '<p class="placeholder-text" style="margin-top: 50px;">暂无帖子。<br>点击刷新按钮加载！</p>';
        }
        return;
    }

    // 2. 计算需要渲染的数据切片
    // 如果是 Append，渲染 (Page-1)*Size 到 Page*Size
    // 如果是 Reset，渲染 0 到 Size
    const startIndex = (currentForumPage - 1) * FORUM_PAGE_SIZE;
    const endIndex = startIndex + FORUM_PAGE_SIZE;
    
    // 截取当前页需要的数据
    const postsToRender = posts.slice(startIndex, endIndex);

    // 3. 渲染切片数据
    postsToRender.forEach(post => {
        const card = document.createElement('div');
        card.className = 'forum-post-card';
        card.dataset.id = post.id;
        
        // 简单的入场动画
        card.style.animation = 'fadeIn 0.3s ease-in-out';

        const timeStr = new Date(post.timestamp || Date.now()).toLocaleString();

        const titleEl = document.createElement('h3');
        titleEl.className = 'post-title';

        if (post.title && post.title.startsWith('[New!] ')) {
            const realTitle = post.title.substring(7);
            titleEl.innerHTML = `<span class="new-badge">New!</span>${realTitle}`;
        } else if (post.title && post.title.startsWith('【新】')) {
            const realTitle = post.title.substring(3);
            titleEl.innerHTML = `<span class="new-badge">New!</span>${realTitle}`;
        } else {
            titleEl.textContent = post.title || '无标题';
        }

        const metaEl = document.createElement('div');
        metaEl.className = 'post-meta-row';

        metaEl.innerHTML = `
            <span>♪ ${post.username}</span>
            <span>${timeStr}</span>
        `;

        card.appendChild(titleEl);
        card.appendChild(metaEl);

        postsContainer.appendChild(card);
    });
    
    // 4. 处理“没有更多”的情况 (可选)
    // if (isAppend && postsToRender.length === 0) {
    //    showToast("到底啦~");
    // }
}

            async function handleGenerateComments(post) {
                const { url, key, model } = db.apiSettings;

                if (!url || !key || !model) {
                    showToast('请先在设置中配置 API 地址、Key 和模型');
                    return;
                }

                const aiBtn = document.getElementById('detail-ai-btn');

                if (aiBtn) {
                    aiBtn.disabled = true;
                    aiBtn.style.opacity = "0.5";
                    aiBtn.style.cursor = "not-allowed";
                }

                const hideLoading = showLoadingToast('正在刷新最新评论...');

                try {
                    const context = getForumGenerationContext();

                    const recentComments = (post.comments || []).slice(-100);
                    const commentsHistoryStr = recentComments.map(c => `${c.username}: ${c.content}`).join('\n');

                    const myIdentity = db.forumUserIdentity || { nickname: '我' };
                    const myNickname = myIdentity.nickname || '我';

                    const systemPrompt = `你是一个论坛网友模拟器。
  论坛的背景世界观：${context}                  
  请为以下帖子追加【10-15条】新评论。
                    
帖子标题：${post.title}
发帖人：${post.username}
帖子完整内容：${post.content}


【已有的评论列表】：
${commentsHistoryStr}

【重要规则】：
1. **身份隔离**：你生成的评论，发表者不能是User（${myNickname}）。
2.评论者网名由你编撰。极少数评论者想要隐藏身份时，可以选择匿名评论，匿名评论的用户名为“喵叽”+论坛随机生成的四位数字。
3. 禁止刷屏：同一个用户名不要评论超过1次。同一个角色发表评论时，使用的网名应保持一致，上下文逻辑应连续。
4.如已有的评论列表存在User（${myNickname}）发表的评论，本次生成的评论中，char或者其他网友应至少发表1条评论回复${myNickname}的最新评论。
5. **直接返回文本**，每行一条，格式必须为 "用户名:评论内容"。`;

                    const requestBody = {
                        model: model,
                        messages: [{ role: "user", content: systemPrompt }],
                        temperature: 1.0
                    };

                    const response = await fetch(`${url}/v1/chat/completions`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
                        body: JSON.stringify(requestBody)
                    });

                    if (!response.ok) {
                        throw new Error(`API 请求失败: ${response.status}`);
                    }

                    const result = await response.json();
                    console.log("API 原始返回结果:", result);
                    // --- 增强的错误检查 ---
                    if (result.error) {
                        throw new Error('API 返回错误: ' + result.error.message);
                    }

                    if (!result.choices || !result.choices[0] || !result.choices[0].message) {
                        throw new Error('API 返回结构异常，未包含 choices');
                    }

                    const contentStr = result.choices[0].message.content;

                    // 检查是否被内容审查拦截 (返回空内容)
                    if (!contentStr || contentStr.trim() === "") {
                        // 检查结束原因
                        const reason = result.choices[0].finish_reason;
                        if (reason === 'content_filter') {
                            throw new Error('生成失败：内容被AI模型的安全过滤器拦截（可能是由于关键词误判）。');
                        }
                        throw new Error('生成失败：AI 返回了空内容。');
                    }

                    const lines = contentStr.split('\n');
                    const newComments = [];

                    let baseTime = Date.now();

                    lines.forEach((line, index) => {
                        line = line.trim();
                        if (!line) return;

                        let colonIndex = line.indexOf(':');
                        if (colonIndex === -1) colonIndex = line.indexOf('：');

                        if (colonIndex > 0) {
                            let name = line.substring(0, colonIndex).trim();
                            const text = line.substring(colonIndex + 1).trim();

                            if (name === myNickname) {
                                name = getRandomNetName();
                            }

                            if (name && text) {
                                newComments.push({
                                    username: name,
                                    content: text,
                                    timestamp: new Date(baseTime + index * 5000).toLocaleString(),
                                    isNew: true,
                                    avatar: null,
                                    isUser: false
                                });
                            }
                        }
                    });

                    if (newComments.length > 0) {
                        if (post.comments) {
                            post.comments.forEach(c => delete c.isNew);
                        } else {
                            post.comments = [];
                        }

                        post.comments = post.comments.concat(newComments);

                        const dbPostIndex = db.forumPosts.findIndex(p => p.id === post.id);
                        if (dbPostIndex !== -1) {
                            db.forumPosts[dbPostIndex] = post;
                            await saveData();

                            renderPostDetail(post);

                            // --- 核心修改：生成评论后立即刷新热帖 ---
                            renderHotPosts();
                            // ------------------------------------

                            const area = document.getElementById('detail-content-area');
                            if (area) area.scrollTop = area.scrollHeight;

                            showToast(`已更新 ${newComments.length} 条评论`);
                        }
                    } else {
                        showToast('AI 没有生成有效的评论格式，请重试');
                    }

                } catch (e) {
                    console.error("生成评论出错:", e);
                    showToast('生成失败: ' + e.message);
                } finally {
                    hideLoading();

                    if (aiBtn) {
                        aiBtn.disabled = false;
                        aiBtn.style.opacity = "1";
                        aiBtn.style.cursor = "pointer";
                    }
                }
            }
