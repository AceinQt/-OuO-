// --- js/settings/customize.js ---



function setupCustomizeApp() {
    customizeForm.addEventListener('input', async (e) => {
        const target = e.target;
        // 处理应用图标
        if (target.dataset.iconId) { 
            const iconId = target.dataset.iconId;
            const newUrl = target.value.trim();
            const previewImg = document.getElementById(`icon-preview-${iconId}`);
            if (newUrl) {
                if (!db.customIcons) db.customIcons = {};
                db.customIcons[iconId] = newUrl;
                if (previewImg) previewImg.src = newUrl;
            }
        // 处理小部件
        } else if (target.dataset.widgetPart) {
            const part = target.dataset.widgetPart;
            const prop = target.dataset.widgetProp;
            const newValue = target.value.trim();
            if (prop) db.homeWidgetSettings[part][prop] = newValue;
            else db.homeWidgetSettings[part] = newValue;
        }
        await saveGlobalKeys(['customIcons', 'homeWidgetSettings']);
        setupHomeScreen(); // 实时刷新主页
    });

    customizeForm.addEventListener('click', async (e) => {
        // 重置图标
        if (e.target.matches('.reset-icon-btn')) {
            const iconId = e.target.dataset.id;
            if (db.customIcons) delete db.customIcons[iconId];
            await saveGlobalKeys(['customIcons']);
            renderCustomizeForm();
            setupHomeScreen();
            showToast('图标已重置');
        }
        // 重置小部件
        if (e.target.matches('#reset-widget-btn')) {
            if (await AppUI.confirm('确定要将小部件恢复为默认设置吗？', "系统提示", "确认", "取消")) {
                db.homeWidgetSettings = JSON.parse(JSON.stringify(defaultWidgetSettings));
                await saveGlobalKeys(['homeWidgetSettings']);
                renderCustomizeForm();
                setupHomeScreen();
                showToast('小部件已恢复默认');
            }
        }
        // 复制 CSS 代码
        if (e.target.classList.contains('copy-css-btn')) {
            const codeBlock = e.target.closest('.css-template-card').querySelector('code');
            if (codeBlock) {
                navigator.clipboard.writeText(codeBlock.textContent.trim())
                    .then(() => showToast('代码已复制！'))
                    .catch(err => showToast('复制失败: ' + err));
            }
        }
    });

    // 处理图片上传
    customizeForm.addEventListener('change', async (e) => {
        if (e.target.matches('.widget-upload-input')) {
            const file = e.target.files[0];
            if (!file) return;
            const widgetPart = e.target.dataset.widgetTarget;
            const widgetProp = e.target.dataset.widgetProp;
            try {
                const compressedUrl = await compressImage(file, { quality: 0.8, maxWidth: 400, maxHeight: 400 });
                let targetInput = widgetProp 
                    ? document.getElementById(`widget-input-${widgetPart}-${widgetProp}`) 
                    : document.getElementById(`widget-input-${widgetPart}`);
                
                if (targetInput) {
                    targetInput.value = compressedUrl;
                    targetInput.dispatchEvent(new Event('input', { bubbles: true }));
                    showToast('图片已上传');
                }
            } catch (error) {
                showToast('图片压缩失败');
            } finally {
                e.target.value = null;
            }
        }
    });
}

function renderCustomizeForm() {
    customizeForm.innerHTML = ''; 
    const iconOrder = ['chat-list-screen', 'world-book-screen', 'forum-screen', 'settings-screen', 'pomodoro-screen','rpg-title-screen'];
    let iconsContentHTML = '';

    iconOrder.forEach(id => {
        const item = defaultIcons[id];
        const name = item.name;
        const defaultUrl = item.url;
        const customUrl = db.customIcons && db.customIcons[id];
        let iconDisplayHTML = '';

        if (customUrl) {
            iconDisplayHTML = `<img src="${customUrl}" alt="${name}" class="icon-preview" id="icon-preview-${id}">`;
        } else if (item.svgCode) {
            iconDisplayHTML = item.svgCode.replace('class="icon-img"', 'class="icon-preview"');
        } else {
            iconDisplayHTML = `<img src="${defaultUrl}" alt="${name}" class="icon-preview" id="icon-preview-${id}">`;
        }

        iconsContentHTML += `
        <div class="icon-custom-item">
            ${iconDisplayHTML}
            <div class="icon-details">
                <p>${name || '模式切换'}</p>
                <input type="url" class="form-group" placeholder="粘贴新的图标URL" value="${customUrl || ''}" data-icon-id="${id}">
            </div>
            <button type="button" class="reset-icon-btn" data-id="${id}">重置</button>
        </div>`;
    });

    const iconsSectionHTML = `
    <div class="collapsible-section">
        <div class="collapsible-header"><h4>应用图标</h4><span class="collapsible-arrow">▼</span></div>
        <div class="collapsible-content">${iconsContentHTML}</div>
    </div>`;
    customizeForm.insertAdjacentHTML('beforeend', iconsSectionHTML);

    const widgetSectionHTML = `
    <div class="collapsible-section">
        <div class="collapsible-header"><h4>主页小部件</h4><span class="collapsible-arrow">▼</span></div>
        <div class="collapsible-content">
            <p style="font-size: 14px; color: #666; text-align: center;">主屏幕小组件可点击编辑，失焦自动保存。<br>点击中央圆圈可更换图片。</p>
            <div style="display: flex; justify-content: flex-end; margin-bottom: 20px;">
                 <button type="button" id="reset-widget-btn" class="btn btn-neutral btn-small">恢复默认</button>
            </div>
        </div>
    </div>`;
    customizeForm.insertAdjacentHTML('beforeend', widgetSectionHTML);

    const globalCssSectionHTML = `
    <div class="collapsible-section">
        <div class="collapsible-header"><h4>全局CSS美化</h4><span class="collapsible-arrow">▼</span></div>
        <div class="collapsible-content">
            <div class="form-group">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                    <label for="global-beautification-css" style="font-weight: bold;">全局美化CSS代码</label>
                    <button type="button" id="apply-global-css-now-btn" class="btn btn-primary btn-small">立即应用</button>
                </div>
                <textarea id="global-beautification-css" class="form-group" rows="8" placeholder="在此输入CSS代码... 您的创造力没有边界！"></textarea>
                    </div>
                    <div class="panel panel-sm" style="padding:12px;border-radius:10px;border:1px solid var(--border-color,#e8e8ef);background:var(--panel-bg,#fff);box-shadow:var(--panel-shadow,0 4px 12px rgba(20,20,30,0.04));margin:10px 0;">
                        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
                            <label for="global-css-preset-select" style="width:auto;color:var(--muted,#667);font-size:13px; font-weight: bold;">全局样式预设库</label>
                            <select id="global-css-preset-select" style="flex:1;padding:8px 10px;border-radius:8px;border:1px solid var(--input-border,#e6e6ea);background:var(--input-bg,#fff);font-size:14px;"><option value="">-- 选择预设 --</option></select>
                        </div>
                        <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;justify-content: flex-end;">
                            <button type="button" id="global-css-apply-btn" class="btn btn-primary" style="padding:7px 10px;border-radius:8px;">应用预设</button>
                            <button type="button" id="global-css-save-btn" class="btn" style="padding:7px 10px;border-radius:8px;">存为预设</button>
                            <button type="button" id="global-css-manage-btn" class="btn" style="padding:7px 10px;border-radius:8px;">管理</button>
                        </div>
                    </div>
                    <!-- CSS模板模块开始 -->
                    <div class="css-template-module" style="margin-top: 20px; border-top: 1px solid #DAF0FC; padding-top: 15px;">
                        <h5 style="font-size: 1em; color: var(--secondary-color); margin-bottom: 15px;">部分拓展css美化功能代码</h5>
                        <div class="css-template-list" style="display: flex; flex-direction: column; gap: 15px;">
                            
                            <!-- 模板1：底部功能栏简洁模式 -->
                            <div class="css-template-card" style="background: #fff; border: 1px solid #eee; border-radius: 10px; padding: 15px; box-shadow: 0 2px 8px rgba(130, 170, 200, 0.05);">
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                                    <h6 style="margin: 0; font-size: 1em; color: #333;">底部功能栏简洁模式代码</h6>
                                    <button type="button" class="btn btn-secondary btn-small copy-css-btn">复制</button>
                                </div>
                                <pre style="background: #f5f5f5; padding: 10px; border-radius: 8px; white-space: pre-wrap; word-wrap: break-word; font-size: 12px; max-height: 150px; overflow-y: auto;"><code>/* 步骤一：重新定位和调整输入框区域 (无变动) */
.message-input-area {
  position: relative !important;
  padding-left: 50px !important;
}
/* 步骤二：将功能栏(#sticker-bar)改造成一个看不见的、悬浮的容器 (无变动) */
#sticker-bar {
  position: absolute !important;
  bottom: 8px !important;
  left: 8px !important;
  z-index: 10 !important;
  width: 40px !important;
  height: 44px !important;
  background: transparent !important;
  border: none !important;
  border-radius: 10px;
  box-shadow: none !important;
  transition: all 0.25s ease-out !important;
}

/* 步骤三：创建我们的“虚拟”扳机键（“+”号） (无变动) */
#sticker-bar::before,
#sticker-bar::after {
  content: '' !important;
  position: absolute !important;
  top: 50% !important;
  left: 50% !important;
  width: 20px !important;
  height: 2px !important;
  background-color: transparent !important;
  border-radius: 1px !important;
  transition: transform 0.25s ease-out !important;
}

/* 步骤四：将两条线组合成一个“+”号 (无变动) */
#sticker-bar::before {
  transform: translate(-50%, -50%) rotate(0deg) !important;
}
#sticker-bar::after {
  transform: translate(-50%, -50%) rotate(90deg) !important;
}

/* 步骤五：当悬停时，让“+”号旋转成“×” (无变动) */
#sticker-bar:hover::before {
  transform: translate(-50%, -50%) rotate(135deg) !important;
}
#sticker-bar:hover::after {
  transform: translate(-50%, -50%) rotate(45deg) !important;
}

/* 步骤六：默认隐藏所有真实的功能按钮 (无变动) */
#sticker-bar .sticker-bar-btn {
  display: none !important;
}

/* 步骤七：当悬停时，展开面板并显示所有按钮 (核心修改) */
#sticker-bar:hover {
  display: grid !important;
  grid-template-columns: repeat(2, 1fr) !important;
  gap: 8px !important;
  width: 120px !important;
  height: auto !important;
  padding: 10px !important;
  /* --- 优化点 1: 拉开距离 --- */
  /* 将向上偏移量从 60px 增加到 85px，为手指留出安全区 */
  bottom: 85px !important; 
  border-radius: 18px !important;
  background-color: rgba(255, 255, 255, 0.9) !important;
  backdrop-filter: blur(10px) !important;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1) !important;
}

/* 修改后 */
@keyframes fadeInButtons {
  to {
    opacity: 1;
    transform: translateY(0);
    /* --- 核心优化：动画结束时才允许按钮被点击 --- */
    pointer-events: auto;
  }
}

/* 步骤八：设置展开后面板里按钮的样式 (核心修改) */
#sticker-bar:hover .sticker-bar-btn {
  display: flex !important;
  width: auto !important;
  padding: 5px !important;
  border-radius: 10px;
  background-color: rgba(240, 240, 240, 0.8);
  
  /* --- 核心优化：初始状态下按钮不可点击 --- */
  pointer-events: none; 

  opacity: 0; 
  transform: translateY(5px); 
  animation: fadeInButtons 0.2s ease-out 0.1s forwards !important;
}

/* 步骤九：当面板展开时，隐藏掉我们用伪元素画的“+”/“x”号 (无变动) */
#sticker-bar:hover::before,
#sticker-bar:hover::after {
  display: none !important;
}

/* 步骤一：为扳机键设置背景图，这将成为你的新图标 */
#sticker-bar {
  background-image: url('https://i.postimg.cc/9QZd6mhp/ji-lichan-110.png') !important;
  background-size: 28px 22px !important;
  background-repeat: no-repeat !important;
  background-position: center !important;
}

/* 步骤二：强制隐藏掉原来用伪元素画的“+”号，解决重叠问题 */
#sticker-bar::before,
#sticker-bar::after {
  display: none !important;
}

/* 步骤三：当面板展开时，隐藏背景图，避免它出现在展开的面板上 */
#sticker-bar:hover {
  background-image: none !important;
}</code></pre>
                            </div>

                            <!-- 模板2：隐藏聊天顶栏线 -->
                            <div class="css-template-card" style="background: #fff; border: 1px solid #eee; border-radius: 10px; padding: 15px; box-shadow: 0 2px 8px rgba(130, 170, 200, 0.05);">
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                                    <h6 style="margin: 0; font-size: 1em; color: #333;">隐藏聊天顶栏线</h6>
                                    <button type="button" class="btn btn-secondary btn-small copy-css-btn">复制</button>
                                </div>
                                <pre style="background: #f5f5f5; padding: 10px; border-radius: 8px; white-space: pre-wrap; word-wrap: break-word; font-size: 12px; max-height: 150px; overflow-y: auto;"><code>/* --- 3. 进入聊天界面-顶部栏的底部那条线的隐藏 --- */
#chat-room-screen .app-header {
    border-bottom: none !important;
}</code></pre>
                            </div>
                            <!-- 模板3：透明底表情包无气泡 -->
                            <div class="css-template-card" style="background: #fff; border: 1px solid #eee; border-radius: 10px; padding: 15px; box-shadow: 0 2px 8px rgba(130, 170, 200, 0.05);">
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                                    <h6 style="margin: 0; font-size: 1em; color: #333;">表情包无气泡背景</h6>
                                    <button type="button" class="btn btn-secondary btn-small copy-css-btn">复制</button>
                                </div>
                                <pre style="background: #f5f5f5; padding: 10px; border-radius: 8px; white-space: pre-wrap; word-wrap: break-word; font-size: 12px; max-height: 150px; overflow-y: auto;"><code>/* 1. 表情包消息容器（外层）背景全透明 */
.message-wrapper:has(.image-bubble) {
  background-color: transparent; /* 完全透明背景 */
}

/* 2. 表情包气泡（内层）背景全透明（避免默认白色/浅色背景） */
.image-bubble {
  background-color: transparent !important; /* 强制覆盖默认样式 */
  box-shadow: none; /* 可选：移除气泡阴影，让透明更彻底 */
  padding: 0; /* 可选：清除内边距，避免多余透明区域 */
  max-width: 95px !important;
  max-height: 95px !important;
}</code></pre>
                            </div>
                            <!-- 模板4：透明底表情包无气泡 -->
                            <div class="css-template-card" style="background: #fff; border: 1px solid #eee; border-radius: 10px; padding: 15px; box-shadow: 0 2px 8px rgba(130, 170, 200, 0.05);">
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                                    <h6 style="margin: 0; font-size: 1em; color: #333;">隐藏头像</h6>
                                    <button type="button" class="btn btn-secondary btn-small copy-css-btn">复制</button>
                                </div>
                                <pre style="background: #f5f5f5; padding: 10px; border-radius: 8px; white-space: pre-wrap; word-wrap: break-word; font-size: 12px; max-height: 150px; overflow-y: auto;"><code>/* --- 隐藏聊天界面的所有头像和时间戳 --- */
.message-info {
    display: none !important;
}

/* --- 修正语音和翻译气泡的边距 --- */
.voice-transcript, .translation-text {
    margin-left: 8px !important;
    margin-right: 8px !important;
}

/* 确保发送方的语音/翻译气泡仍然正确对齐 */
.message-wrapper.sent .voice-transcript,
.message-wrapper.sent .translation-text {
    align-self: flex-end;
    margin-left: auto !important;
}</code></pre>
                            </div>

                        </div>
                    </div>
                    <!-- CSS模板模块结束 -->
                </div>
            </div>
            `;
    customizeForm.insertAdjacentHTML('beforeend', globalCssSectionHTML);



              // 填充预设下拉框
                populateGlobalCssPresetSelect();

                // --- 新增：为所有折叠标题添加一个点击事件监听器 ---
                customizeForm.querySelectorAll('.collapsible-header').forEach(header => {
                    header.addEventListener('click', () => {
                        header.parentElement.classList.toggle('open');
                    });
                });

                // 重新绑定之前已有的事件监听器
                const globalCssTextarea = document.getElementById('global-beautification-css');
                if (globalCssTextarea) {
                    globalCssTextarea.value = db.globalCss || '';
                }

  
                const applyGlobalCssNowBtn = document.getElementById('apply-global-css-now-btn');
                if (applyGlobalCssNowBtn) {
                    applyGlobalCssNowBtn.addEventListener('click', async () => {
                        const newCss = globalCssTextarea.value;
                        db.globalCss = newCss;
                        applyGlobalCss(newCss);
                        await saveGlobalKeys(['globalCss']);
                        showToast('全局样式已应用');
                    });
                }
                const globalCssApplyBtn = document.getElementById('global-css-apply-btn');
                if (globalCssApplyBtn) {
                    globalCssApplyBtn.addEventListener('click', () => {
                        const select = document.getElementById('global-css-preset-select');
                        const presetName = select.value;
                        if (!presetName) return showToast('请选择一个预设');
                        const preset = db.globalCssPresets.find(p => p.name === presetName);
                        if (preset) {
                            globalCssTextarea.value = preset.css;
                            db.globalCss = preset.css;
                            applyGlobalCss(preset.css);
                            saveGlobalKeys(['globalCss']);
                            showToast('全局CSS预设已应用');
                        }
                    });
                }
                const globalCssSaveBtn = document.getElementById('global-css-save-btn');
                if (globalCssSaveBtn) {
                    globalCssSaveBtn.addEventListener('click', async () => {
                        const css = globalCssTextarea.value.trim();
                        if (!css) return showToast('CSS内容为空，无法保存');
                        const name = await AppUI.prompt('请输入此预设的名称:', "同名将覆盖", "另存为");
                        if (!name) return;
                        if (!db.globalCssPresets) db.globalCssPresets = [];
                        const existingIndex = db.globalCssPresets.findIndex(p => p.name === name);
                        if (existingIndex > -1) {
                            db.globalCssPresets[existingIndex].css = css;
                        } else {
                            db.globalCssPresets.push({ name, css });
                        }
                         saveGlobalKeys(['globalCssPresets']);
                        populateGlobalCssPresetSelect();
                        showToast('全局CSS预设已保存');
                    });
                }
                const globalCssManageBtn = document.getElementById('global-css-manage-btn');
                if (globalCssManageBtn) {
                    globalCssManageBtn.addEventListener('click', openGlobalCssManageModal);
                }
            }


            



            





            

            function applyGlobalCss(css) {
                const styleElement = document.getElementById('global-css-style');
                if (styleElement) {
                    styleElement.innerHTML = css || '';
                }
            }

            function populateGlobalCssPresetSelect() {
                const select = document.getElementById('global-css-preset-select');
                if (!select) return;
                select.innerHTML = '<option value="">— 选择预设 —</option>';
                (db.globalCssPresets || []).forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p.name;
                    opt.textContent = p.name;
                    select.appendChild(opt);
                });
            }

            function openGlobalCssManageModal() {
                const modal = document.getElementById('global-css-presets-modal');
                const list = document.getElementById('global-css-presets-list');
                if (!modal || !list) return;
                list.innerHTML = '';
                const presets = db.globalCssPresets || [];
                if (!presets.length) list.innerHTML = '<p style="color:#888;margin:6px 0;">暂无预设</p>';

                presets.forEach((p, idx) => {
                    const row = document.createElement('div');
                    row.className = 'list-item';
                    

                    const nameDiv = document.createElement('div');
                    nameDiv.className = 'list-item-title';
                    nameDiv.textContent = p.name;            
                    row.appendChild(nameDiv);

                    const btnWrap = document.createElement('div');
                    btnWrap.className = 'list-item-btn';
                    

                    const renameBtn = document.createElement('button');
                    renameBtn.className = 'btn';                   
                    renameBtn.textContent = '重命名';
                    renameBtn.onclick = async function () {
                        const newName = await AppUI.prompt('输入新名称：', p.name, "重命名");
                        if (!newName || newName === p.name) return;
                        db.globalCssPresets[idx].name = newName;
                        saveGlobalKeys(['globalCssPresets']);
                        openGlobalCssManageModal();
                        populateGlobalCssPresetSelect();
                    };

                    const delBtn = document.createElement('button');
                    delBtn.className = 'btn btn-danger';
                    delBtn.textContent = '删除';
                    delBtn.onclick = async function () {
                        if (!await AppUI.confirm('确定删除预设 "' + p.name + '" ?', "系统提示", "确认", "取消")) return;
                        db.globalCssPresets.splice(idx, 1);
                        saveGlobalKeys(['globalCssPresets']);
                        openGlobalCssManageModal();
                        populateGlobalCssPresetSelect();
                    };

                    btnWrap.appendChild(renameBtn);
                    btnWrap.appendChild(delBtn);
                    row.appendChild(btnWrap);
                    list.appendChild(row);
                });
                modal.style.display = 'flex';
            }

function setupGlobalCssPresetsListeners() {
    const closeBtn = document.getElementById('global-css-close-modal');
    if(closeBtn) closeBtn.onclick = () => document.getElementById('global-css-presets-modal').style.display = 'none';
}

window.applyGlobalCss=applyGlobalCss;