            function setupApiSettingsApp() {
                const e = document.getElementById('api-form'), t = document.getElementById('fetch-models-btn'),
                    a = document.getElementById('api-model'), n = document.getElementById('api-provider'),
                    r = document.getElementById('api-url'), s = document.getElementById('api-key'), c = {
                        newapi: '',
                        deepseek: 'https://api.deepseek.com',
                        claude: 'https://api.anthropic.com',
                        gemini: 'https://generativelanguage.googleapis.com'
                    };
                db.apiSettings && (n.value = db.apiSettings.provider || 'newapi', r.value = db.apiSettings.url || '', s.value = db.apiSettings.key || '', db.apiSettings.model && (a.innerHTML = `<option value="${db.apiSettings.model}">${db.apiSettings.model}</option>`));
                if (db.apiSettings && typeof db.apiSettings.timePerceptionEnabled !== 'undefined') { document.getElementById('time-perception-switch').checked = db.apiSettings.timePerceptionEnabled; }
                if (db.apiSettings && typeof db.apiSettings.streamEnabled !== 'undefined') { document.getElementById('stream-switch').checked = db.apiSettings.streamEnabled; } else { document.getElementById('stream-switch').checked = true; } // 默认开启
                // 在 stream-switch 后面添加
if (db.apiSettings && typeof db.apiSettings.compatibilityModeEnabled !== 'undefined') { 
    document.getElementById('compatibility-mode-switch').checked = db.apiSettings.compatibilityModeEnabled; 
} else { 
    document.getElementById('compatibility-mode-switch').checked = false; // 默认关闭
}

                populateApiSelect();
                n.addEventListener('change', () => {
                    r.value = c[n.value] || ''
                });
                t.addEventListener('click', async () => {
                    let o = r.value.trim();
                    const l = s.value.trim();
                    if (!o || !l) return showToast('请先填写API地址和密钥！');
                    o.endsWith('/') && (o = o.slice(0, -1));
                    const i = 'gemini' === n.value ? `${o}/v1beta/models?key=${getRandomValue(l)}` : `${o}/v1/models`;
                    t.classList.add('loading'), t.disabled = !0;
                    try {
                        const d = 'gemini' === n.value ? {} : { Authorization: `Bearer ${l}` },
                            g = await fetch(i, { method: 'GET', headers: d });
                        if (!g.ok) {
                            const error = new Error(`网络响应错误: ${g.status}`);
                            error.response = g;
                            throw error;
                        }
                        const u = await g.json();
                        let p = [];
                        'gemini' !== n.value && u.data ? p = u.data.map(e => e.id) : 'gemini' === n.value && u.models && (p = u.models.map(e => e.name.replace('models/', ''))), a.innerHTML = '', p.length > 0 ? p.forEach(e => {
                            const t = document.createElement('option');
                            t.value = e, t.textContent = e, a.appendChild(t)
                        }) : a.innerHTML = '<option value="">未找到任何模型</option>', showToast('模型列表拉取成功！')
                    } catch (f) {
                        showApiError(f), a.innerHTML = '<option value="">拉取失败</option>'
                    } finally {
                        t.classList.remove('loading'), t.disabled = !1
                    }
                });
                e.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    if (!a.value) return showToast('请选择模型后保存！');
                    // 在这里，我们把开关的状态也一起保存进去
                    db.apiSettings = {
                        provider: n.value,
                        url: r.value,
                        key: s.value,
                        model: a.value,
                        timePerceptionEnabled: document.getElementById('time-perception-switch').checked,
                        streamEnabled: document.getElementById('stream-switch').checked,
    compatibilityModeEnabled: document.getElementById('compatibility-mode-switch').checked // 新增这一行
                    };
                    await saveGlobalKeys(['apiSettings']);
                    showToast('API设置已保存！')
                })
            }
            
         // gemini如果是多个密钥, 那么随机获取一个
        function getRandomValue(str) {
            // 检查字符串是否包含逗号
            if (str.includes(',')) {
                // 用逗号分隔字符串并移除多余空格
                const arr = str.split(',').map(item => item.trim());
                // 生成随机索引 (0 到 arr.length-1)
                const randomIndex = Math.floor(Math.random() * arr.length);
                // 返回随机元素
                return arr[randomIndex];
            }
            // 没有逗号则直接返回原字符串
            return str;
        }
        
            // ==================================================================================================================
            // ========================================== 1. API 预设管理 (API PRESET MANAGEMENT) ==========================================
            // ==================================================================================================================
            function _getApiPresets() {
                return db.apiPresets || [];
            }
            function _saveApiPresets(arr) {
                db.apiPresets = arr || [];               saveGlobalKeys(['apiPresets']);
            }

            function populateApiSelect() {
                const sel = document.getElementById('api-preset-select');
                if (!sel) return;
                const presets = _getApiPresets();
                sel.innerHTML = '<option value="">— 选择 API 预设 —</option>';
                presets.forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p.name;
                    opt.textContent = p.name;
                    sel.appendChild(opt);
                });
            }

           async function saveCurrentApiAsPreset() {
                const apiKeyEl = document.querySelector('#api-key');
                const apiUrlEl = document.querySelector('#api-url');
                const providerEl = document.querySelector('#api-provider');
                const modelEl = document.querySelector('#api-model');
                


                const data = {
                    apiKey: apiKeyEl ? apiKeyEl.value : '',
                    apiUrl: apiUrlEl ? apiUrlEl.value : '',
                    provider: providerEl ? providerEl.value : '',
                    model: modelEl ? modelEl.value : ''
                };

                let name = await AppUI.prompt('为该 API 预设填写名称：', "会覆盖同名预设", "另存为");
                if (!name) return;
                const presets = _getApiPresets();
                const idx = presets.findIndex(p => p.name === name);
                const preset = { name: name, data: data };
                if (idx >= 0) presets[idx] = preset; else presets.push(preset);
                _saveApiPresets(presets);
                populateApiSelect();
                (window.showToast && showToast('API 预设已保存')) || console.log('API 预设已保存');
            }

            async function applyApiPreset(name) {
                const presets = _getApiPresets();
                const p = presets.find(x => x.name === name);
                if (!p) return (window.showToast && showToast('未找到该预设')) || await AppUI.alert('未找到该预设');
                try {
                    const apiKeyEl = document.querySelector('#api-key');
                    const apiUrlEl = document.querySelector('#api-url');
                    const providerEl = document.querySelector('#api-provider');
                    const modelEl = document.querySelector('#api-model');
                    const compModeEl = document.querySelector('#compatibility-mode-switch');

                    if (apiKeyEl && p.data && typeof p.data.apiKey !== 'undefined') apiKeyEl.value = p.data.apiKey;
                    if (apiUrlEl && p.data && typeof p.data.apiUrl !== 'undefined') apiUrlEl.value = p.data.apiUrl;
                    if (providerEl && p.data && typeof p.data.provider !== 'undefined') providerEl.value = p.data.provider;
                    if (modelEl && p.data && typeof p.data.model !== 'undefined') {
                        modelEl.innerHTML = `<option value="${p.data.model}">${p.data.model}</option>`;
                        modelEl.value = p.data.model;
                    }
                    if (compModeEl && p.data && typeof p.data.compatibilityModeEnabled !== 'undefined') {
    compModeEl.checked = p.data.compatibilityModeEnabled;
}

                    (window.showToast && showToast('已应用 API 预设')) || console.log('已应用 API 预设');
                } catch (e) {
                    console.error('applyApiPreset error', e);
                }
            }

            function openApiManageModal() {
                const modal = document.getElementById('api-presets-modal');
                const list = document.getElementById('api-presets-list');
                if (!modal || !list) return;
                list.innerHTML = '';
                const presets = _getApiPresets();
                if (!presets.length) {
                    list.innerHTML = '<p style="color:#888;margin:6px 0;">暂无预设</p>';
                }
                presets.forEach((p, idx) => {
                    const row = document.createElement('div');
                    row.className = 'list-item';

                    const left = document.createElement('div');
                    left.className = 'list-item-title';
                    left.innerHTML = '<div style="font-weight:600;">' + p.name + '</div><div style="font-size:12px;color:#666;margin-top:4px;">' + (p.data && p.data.provider ? ('提供者：' + p.data.provider) : '') + '</div>';

                    const btns = document.createElement('div');
                    btns.className = 'list-item-btn';


                    const applyBtn = document.createElement('button');
                    applyBtn.className = 'btn';
                    applyBtn.textContent = '应用';
                    applyBtn.onclick = function () { applyApiPreset(p.name); modal.style.display = 'none'; };

                    const renameBtn = document.createElement('button');
                    renameBtn.className = 'btn';
                    renameBtn.textContent = '重命名';
                    renameBtn.onclick = async function () {
                        const newName = await AppUI.prompt('输入新名称：', p.name, "重命名");
                        if (!newName) return;
                        const all = _getApiPresets();
                        all[idx].name = newName;
                        _saveApiPresets(all);
                        openApiManageModal();
                        populateApiSelect();
                    };

                    const delBtn = document.createElement('button');
                    delBtn.className = 'btn';
                    delBtn.textContent = '删除';
                    delBtn.onclick = async function () { if (!await AppUI.confirm('确定删除 "' + p.name + '" ?', "系统提示", "确认", "取消")) return; const all = _getApiPresets(); all.splice(idx, 1); _saveApiPresets(all); openApiManageModal(); populateApiSelect(); };

                    btns.appendChild(applyBtn); btns.appendChild(renameBtn); btns.appendChild(delBtn);

                    row.appendChild(left); row.appendChild(btns);
                    list.appendChild(row);
                });
                modal.style.display = 'flex';
            }

            function exportApiPresets() {
                const presets = _getApiPresets();
                const blob = new Blob([JSON.stringify(presets, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = 'api_presets.json'; document.body.appendChild(a); a.click(); a.remove();
                URL.revokeObjectURL(url);
            }
            function importApiPresets() {
                const inp = document.createElement('input');
                inp.type = 'file';
                inp.accept = 'application/json';
                inp.onchange = function (e) {
                    const f = e.target.files[0];
                    if (!f) return;
                    const r = new FileReader();
                    r.onload = async function () { try { const data = JSON.parse(r.result); if (Array.isArray(data)) { _saveApiPresets(data); populateApiSelect(); openApiManageModal(); } else await AppUI.alert('文件格式不正确'); } catch (e) { await AppUI.alert('导入失败：' + e.message); } };
                    r.readAsText(f);
                };
                inp.click();
            }
            
            
 // api预设管理

function setupApiPresets() {
    const saveBtn = document.getElementById('api-save-preset');
    const manageBtn = document.getElementById('api-manage-presets');
    const applyBtn = document.getElementById('api-apply-preset');
    const select = document.getElementById('api-preset-select');
    const modalClose = document.getElementById('api-close-modal');
    const importBtn = document.getElementById('api-import-presets');
    const exportBtn = document.getElementById('api-export-presets');

    if (saveBtn) saveBtn.addEventListener('click', saveCurrentApiAsPreset);
    if (manageBtn) manageBtn.addEventListener('click', openApiManageModal);
    if (applyBtn) applyBtn.addEventListener('click', async function () { 
        const v = select.value; 
        if (!v) return (window.showToast && showToast('请选择预设')) || await AppUI.alert('请选择预设'); 
        applyApiPreset(v); 
    });
    if (modalClose) modalClose.addEventListener('click', function () { 
        document.getElementById('api-presets-modal').style.display = 'none'; 
    });
    if (importBtn) importBtn.addEventListener('click', importApiPresets);
    if (exportBtn) exportBtn.addEventListener('click', exportApiPresets);
}

// 记得把这个函数暴露给全局，或者在 main.js 里调用它
window.setupApiPresets = setupApiPresets;