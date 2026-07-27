// forum_me_page.js - Me page: avatar / nickname / persona / anon-code / custom CSS editing & saving

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

        // 人设绑定：记录当前论坛身份来源的 user 人设 ID（读取人设后未保存的临时值在此重置）
        window._forumMeBindPersonaId = identity.boundPersonaId || null;
        
    // ★ [论坛懒加载 F5] 懒加载下内存只有窗口，发帖数走 DB 流式统计（先显示…再异步回填）
    if (window.LAZY_FORUM && window.countMyForumPosts) {
        if (statPostCount) {
            statPostCount.textContent = '…';
            window.countMyForumPosts(identity.nickname)
                .then(n => { if (statPostCount) statPostCount.textContent = n; })
                .catch(e => {
                    console.error('❌ 发帖数统计失败，回退内存窗口:', e);
                    if (statPostCount) statPostCount.textContent = (db.forumPosts || []).filter(p => p.isUser || p.username === identity.nickname).length;
                });
        }
    } else {
            const myPosts = (db.forumPosts || []).filter(p => p.isUser || p.username === identity.nickname).length;
    if (statPostCount) statPostCount.textContent = myPosts;
    }
    
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
                    // 记录绑定的人设 ID，保存后 user 人设改动会同步到论坛
                    window._forumMeBindPersonaId = preset.id || null;
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

                // 处理人设绑定：手动改过内容视为脱离绑定，避免之后被 user 人设覆盖
                let bindId = window._forumMeBindPersonaId || null;
                if (bindId) {
                    const boundPreset = (db.userPersonas || []).find(p => p.id === bindId);
                    if (!boundPreset ||
                        (currentRealName?.value.trim() || '') !== (boundPreset.realName || '').trim() ||
                        (currentPersona?.value.trim() || '') !== (boundPreset.persona || '').trim()) {
                        bindId = null;
                        window._forumMeBindPersonaId = null;
                    }
                }

                // 更新内存中的数据
                db.forumUserIdentity = {
                    nickname: currentNickname?.value.trim() || '新用户',
                    avatar: currentHiddenInput?.value.trim() || 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg',
                    persona: currentPersona?.value.trim() || '',
                    realName: currentRealName?.value.trim() || '',
                    anonCode: finalCode,
                    customDetailCss: currentCss?.value || '',
                    boundPersonaId: bindId
                };                

                // ✅ 修复7: 调用保存函数
                if (typeof saveForumMeta === 'function') {
    await saveForumMeta();
    console.log("✅ 论坛设置已精准保存");
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
