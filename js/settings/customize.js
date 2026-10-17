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
    const iconOrder = ['chat-list-screen', 'world-book-screen', 'forum-screen', 'settings-screen', 'study-screen','rpg-title-screen'];
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


            



            





            

            // ★ 这个 <style> 标签**不在 index.html 里**，必须自己建。
            //   原先这里是「找不到就静默返回」，而全项目没有任何地方创建过
            //   #global-css-style —— 于是 db.globalCss 能存、能存预设、能进备份，
            //   就是永远不上页面，「立即应用」点了毫无反应。
            //   建出来 append 到 head 末尾，排在 index.html 那条 main.css 的 <link>
            //   之后，所以同权重时用户的规则赢（和 chat_settings.js 注入气泡 CSS 同一套路）。
            function applyGlobalCss(css) {
                let styleElement = document.getElementById('global-css-style');
                if (!styleElement) {
                    styleElement = document.createElement('style');
                    styleElement.id = 'global-css-style';
                    document.head.appendChild(styleElement);
                }
                // 用 textContent 而不是 innerHTML：CSS 里的 > 和 & 不该被当 HTML 解析
                styleElement.textContent = css || '';
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