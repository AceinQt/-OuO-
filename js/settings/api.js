// ============================================================
// api.js  —  API 设置页逻辑（v1.6 重构版）
// ============================================================

// ── 服务商 URL 映射 ──────────────────────────────────────────
const CHAT_PROVIDER_URLS = {
    newapi:   '',
    deepseek: 'https://api.deepseek.com',
    claude:   'https://api.anthropic.com',
    gemini:   'https://generativelanguage.googleapis.com'
};
const EMB_PROVIDER_URLS = {
    newapi: '',
    openai:  'https://api.openai.com',
    gemini:  'https://generativelanguage.googleapis.com'
};

// ── 当前激活的 tab ────────────────────────────────────────────
let _currentApiTab = 'chat';

// ── 脏数据状态（有未保存的更改） ──────────────────────────────
let _chatDirty = false;
let _embDirty  = false;

// ── 暂存预设（新增/复制后尚未写入 db 的预设） ─────────────────
let _stagedPresets = { chat: null, embedding: null };

// ── 当前已加载的预设原始名（用于保存时重命名检测） ─────────────
let _loadedPresetName = { chat: null, embedding: null };

// ============================================================
// 预设 CRUD  （统一存储在 db.apiPresets，用 type 区分）
// ============================================================

/** 获取指定类型的预设列表（旧预设无 type 字段视为 chat） */
function _getPresets(type) {
    return (db.apiPresets || []).filter(p =>
        type === 'chat'
            ? (!p.type || p.type === 'chat')
            : p.type === type
    );
}

/** 读取全部预设（跨类型操作用） */
function _getAllPresets() {
    return db.apiPresets || [];
}

/** 持久化全部预设 */
function _saveAllPresets(arr) {
    db.apiPresets = arr || [];
    saveGlobalKeys(['apiPresets']);
}

// ── 脏数据辅助 ───────────────────────────────────────────────
function _markDirty(type)   { if (type === 'chat') _chatDirty = true;  else _embDirty = true; }
function _clearDirty(type)  { if (type === 'chat') _chatDirty = false; else _embDirty = false; }
function _isDirtyType(type) { return type === 'chat' ? _chatDirty : _embDirty; }

/** 监听表单字段变化 → 标记脏数据（programmatic _setVal 不触发事件，安全） */
function _watchDirty(type, ids) {
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const evt = (el.type === 'checkbox' || el.tagName === 'SELECT') ? 'change' : 'input';
        el.addEventListener(evt, () => _markDirty(type));
    });
}

// ── 全局默认开关状态管理 ──────────────────────────────────────
/**
 * 当同类型预设列表为空时（即将保存的是第一个预设），
 * 强制勾选"全局默认"并禁用开关；否则恢复可交互。
 */
function _updateDefaultToggleState(type) {
    const checkId = type === 'chat' ? 'api-chat-set-default' : 'api-emb-set-default';
    const el = document.getElementById(checkId);
    if (!el) return;
    if (_getPresets(type).length === 0) {
        el.disabled = true;
        el.checked  = true;
    } else {
        el.disabled = false;
    }
}

// ── 生成唯一预设名称 ──────────────────────────────────────────
function _genName(type, base) {
    const taken = _getPresets(type).map(p => p.name);
    let n = 1;
    while (taken.includes(base + n)) n++;
    return base + n;
}

function _genCopyName(type, srcName) {
    const taken = _getPresets(type).map(p => p.name);
    let n = 2;
    while (taken.includes(srcName + n)) n++;
    return srcName + n;
}

// ── 预设名称 input 辅助 ───────────────────────────────────────
function _setPresetNameInput(type, name) {
    const id = type === 'chat' ? 'api-chat-preset-name' : 'api-emb-preset-name';
    _setVal(id, name || '');
}

// ── 填充 Select ──────────────────────────────────────────────
function populateApiSelect(type) {
    const selId = type === 'chat' ? 'api-chat-preset-select' : 'api-emb-preset-select';
    const sel = document.getElementById(selId);
    if (!sel) return;
    const presets = _getPresets(type);
    sel.innerHTML = '<option value="">— 选择预设 —</option>';
    presets.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.name;
        opt.textContent = p.name;
        sel.appendChild(opt);
    });
    // 回显当前 activePreset
    const activeName = type === 'chat'
        ? (db.apiSettings && db.apiSettings.activePreset)
        : (db.embeddingSettings && db.embeddingSettings.activePreset);
    if (activeName) sel.value = activeName;
}

// ── 将预设 data 写入表单字段（纯数据，不改 select/name input） ─
function _applyDataToForm(type, d) {
    if (!d) return;
    if (type === 'chat') {
        _setVal('api-chat-provider', d.provider || 'newapi');
        _setVal('api-chat-url',      d.url || d.apiUrl || '');
        _setVal('api-chat-key',      d.key || d.apiKey || '');
        if (d.model) {
            const m = document.getElementById('api-chat-model');
            if (m) { m.innerHTML = `<option value="${d.model}">${d.model}</option>`; m.value = d.model; }
        }
        _setChecked('api-chat-stream', d.streamEnabled !== false);
        _setChecked('api-chat-compat', !!d.compatibilityModeEnabled);
        _setVal('api-chat-temp', d.temperature !== undefined ? d.temperature : 0.8);
    } else {
        _setVal('api-emb-provider', d.provider || 'newapi');
        _setVal('api-emb-url',      d.url || d.apiUrl || '');
        _setVal('api-emb-key',      d.key || d.apiKey || '');
        if (d.model) {
            const m = document.getElementById('api-emb-model');
            if (m) { m.innerHTML = `<option value="${d.model}">${d.model}</option>`; m.value = d.model; }
        }
    }
}

/** 清空表单字段 */
function _clearFormFields(type) {
    if (type === 'chat') {
        _setVal('api-chat-provider', 'newapi');
        _setVal('api-chat-url',  '');
        _setVal('api-chat-key',  '');
        const m = document.getElementById('api-chat-model');
        if (m) m.innerHTML = '<option value="">请先拉取模型列表</option>';
        _setChecked('api-chat-stream', false);
        _setChecked('api-chat-compat', false);
        _setVal('api-chat-temp', 0.8);
    } else {
        _setVal('api-emb-provider', 'newapi');
        _setVal('api-emb-url',  '');
        _setVal('api-emb-key',  '');
        const m = document.getElementById('api-emb-model');
        if (m) m.innerHTML = '<option value="">请先拉取模型列表</option>';
    }
}

// ── 应用预设到表单（对外接口，含 name input + 默认开关同步） ──
function applyPresetToForm(type, name) {
    const preset = _getPresets(type).find(p => p.name === name);
    if (!preset) return;
    if (preset.data) _applyDataToForm(type, preset.data);
    _setPresetNameInput(type, name);
    // 同步"是否默认"开关
    const activeName = type === 'chat'
        ? (db.apiSettings && db.apiSettings.activePreset)
        : (db.embeddingSettings && db.embeddingSettings.activePreset);
    _setChecked(
        type === 'chat' ? 'api-chat-set-default' : 'api-emb-set-default',
        activeName === name
    );
    // 记录当前加载的原始预设名（用于保存时重命名检测）
    _loadedPresetName[type] = name;
}

// ── 暂存选项（新增/复制后在 Select 中显示，但未写入 db） ───────
function _addStagedOption(type, name) {
    const selId = type === 'chat' ? 'api-chat-preset-select' : 'api-emb-preset-select';
    const sel = document.getElementById(selId);
    if (!sel) return;
    // 先移除旧的暂存项
    Array.from(sel.options).forEach(o => { if (o.dataset.staged) sel.removeChild(o); });
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name + '（未保存）';
    opt.dataset.staged = 'true';
    sel.appendChild(opt);
    sel.value = name;
}

function _removeStagedOption(type) {
    const selId = type === 'chat' ? 'api-chat-preset-select' : 'api-emb-preset-select';
    const sel = document.getElementById(selId);
    if (!sel) return;
    Array.from(sel.options).forEach(o => { if (o.dataset.staged) sel.removeChild(o); });
}

// ============================================================
// 新增 / 复制 / 保存 / 删除
// ============================================================

/** ① 新增空白预设（暂存，需点保存生效） */
async function _addNewPreset(type) {
    if (_isDirtyType(type)) {
        const go = await AppUI.confirm('您还未保存，是否离开页面？', '提示', '离开', '取消');
        if (!go) return;
    }
    const base = type === 'chat' ? 'api预设' : '向量预设';
    const name = _genName(type, base);
    _stagedPresets[type] = { name, type, isNew: true };
    _loadedPresetName[type] = null;         // 新预设无原始名
    _addStagedOption(type, name);
    _clearFormFields(type);
    _setPresetNameInput(type, name);
    _updateDefaultToggleState(type);        // 若是第一个预设则强制锁定为默认
    _markDirty(type);
}

/** ② 复制当前选中预设（暂存，需点保存生效） */
async function _copyPreset(type) {
    if (_isDirtyType(type)) {
        const go = await AppUI.confirm('您还未保存，是否离开页面？', '提示', '离开', '取消');
        if (!go) return;
    }
    const selId = type === 'chat' ? 'api-chat-preset-select' : 'api-emb-preset-select';
    const currentName = _getVal(selId);
    if (!currentName || currentName === '') return showToast('请先选择要复制的预设');
    const src = _getPresets(type).find(p => p.name === currentName);
    if (!src) return showToast('找不到该预设');
    const newName = _genCopyName(type, currentName);
    _stagedPresets[type] = { name: newName, type };
    _addStagedOption(type, newName);
    if (src.data) _applyDataToForm(type, src.data);
    _setPresetNameInput(type, newName);
    _setChecked(type === 'chat' ? 'api-chat-set-default' : 'api-emb-set-default', false);
    
    _loadedPresetName[type] = null; 

    _markDirty(type);
}

/** ③ 保存当前表单到预设（底部保存按钮也委托此函数） */
async function _savePreset(type) {
    const isChat = type === 'chat';
    const nameInputId    = isChat ? 'api-chat-preset-name' : 'api-emb-preset-name';
    const defaultCheckId = isChat ? 'api-chat-set-default' : 'api-emb-set-default';

    const newName = (_getVal(nameInputId) || '').trim();
    if (!newName) return showToast('请填写预设名称后再保存');

    const data = isChat ? _readChatForm() : _readEmbForm();
    if (!data.model) return showToast(isChat ? '请选择模型后保存！' : '请选择向量模型后保存！');

    const setDefault   = _getChecked(defaultCheckId);
    const originalName = _loadedPresetName[type]; // 当前已加载预设的原始名
    const presets      = _getPresets(type);

    // ── 需求2：重命名检测 ─────────────────────────────────────
    const isRename = !!originalName && newName !== originalName;
    if (isRename) {
        // 检查新名是否与其他已有预设重名
        if (presets.some(p => p.name === newName)) {
            await AppUI.alert(`已存在重名预设「${newName}」，请修改名字`);
            return;
        }
    }

    // ── 需求3：全局默认唯一性确认 ────────────────────────────
    const prevActive = isChat
        ? (db.apiSettings && db.apiSettings.activePreset)
        : (db.embeddingSettings && db.embeddingSettings.activePreset);

    // 只在"想设为默认 且 原来已有其他预设是默认 且 当前预设本身不是全局默认"时才 confirm
    const willReplaceDefault = setDefault && prevActive && prevActive !== originalName;
    if (willReplaceDefault) {
        const ok = await AppUI.confirm(
            `已设置全局默认预设为「${prevActive}」，是否替换为「${newName}」？`,
            '替换全局默认', '替换', '取消'
        );
        if (!ok) return;
    }

    // 提交暂存状态：移除"未保存"临时 option
    if (_stagedPresets[type]) {
        _removeStagedOption(type);
        _stagedPresets[type] = null;
    }

    // ── 写入 db.apiPresets ───────────────────────────────────
    const all = _getAllPresets();
    if (isRename) {
        // 删除原条目，追加新名条目
        const oldIdx = all.findIndex(p =>
            p.name === originalName && (p.type === type || (!p.type && type === 'chat'))
        );
        if (oldIdx >= 0) all.splice(oldIdx, 1);
        all.push({ name: newName, type, data });
    } else {
        // 同名覆盖或新增
        const idx = all.findIndex(p =>
            p.name === newName && (p.type === type || (!p.type && type === 'chat'))
        );
        const preset = { name: newName, type, data };
        if (idx >= 0) all[idx] = preset; else all.push(preset);
    }
    _saveAllPresets(all);

    // ── 计算最终 activePreset ────────────────────────────────

    let activePreset;
    if (setDefault) {
        activePreset = newName;                          // 明确设为默认
    } else if (isRename && prevActive === originalName) {
        activePreset = newName;                          // 重命名了当前全局默认，自动跟随
    } else {
        activePreset = prevActive;                       // 不变
    }

    if (isChat) {
      if (setDefault) {
        // 设为默认：用当前数据更新
        window.db.apiSettings = { ...data, activePreset };
      } else {
        // 未设为默认：从 activePreset 预设里读数据，保证 db.apiSettings 内容和 activePreset 一致
          const activeData = activePreset
            ? (_getPresets('chat').find(p => p.name === activePreset)?.data || {})
            : {};
          window.db.apiSettings = { ...activeData, activePreset };
      }
      await saveGlobalKeys(['apiSettings']);
    } else {
      if (setDefault) {
        window.db.embeddingSettings = { ...data, activePreset };
      } else {
        // 未设为默认：从 activePreset 预设里读数据，保证 db.apiSettings 内容和 activePreset 一致
          const activeData = activePreset
            ? (_getPresets('embedding').find(p => p.name === activePreset)?.data || {})
            : {};
          // ★★★ 核心修复：原来这里漏写了对 window.db.embeddingSettings 的赋值，导致存库前内存未更新
          window.db.embeddingSettings = { ...activeData, activePreset };
      }
      await saveGlobalKeys(['embeddingSettings']);
    }


    // 更新已加载名、刷新 Select、同步开关状态
    _loadedPresetName[type] = newName;
    populateApiSelect(type);
    const sel = document.getElementById(isChat ? 'api-chat-preset-select' : 'api-emb-preset-select');
    if (sel) sel.value = newName;
    _setChecked(defaultCheckId, activePreset === newName);
    _updateDefaultToggleState(type);

    _clearDirty(type);
    showToast('预设已保存：' + newName);
}

/** ④ 删除当前选中预设 */
async function _deletePreset(type) {
    const isChat = type === 'chat';

    // 如果有暂存预设，取消暂存即可（未写入 db，无需删除确认）
    if (_stagedPresets[type]) {
        _removeStagedOption(type);
        _stagedPresets[type] = null;
        _setPresetNameInput(type, '');
        const sel = document.getElementById(isChat ? 'api-chat-preset-select' : 'api-emb-preset-select');
        if (sel) sel.value = '';
        _clearDirty(type);
        showToast('已取消新增');
        return;
    }

    const nameInputId = isChat ? 'api-chat-preset-name' : 'api-emb-preset-name';
    const selId       = isChat ? 'api-chat-preset-select' : 'api-emb-preset-select';
    const name = (_getVal(nameInputId) || _getVal(selId)).trim();
    if (!name) return showToast('请先选择要删除的预设');

    const ok = await AppUI.confirm(`确定删除预设「${name}」？`, '删除预设', '删除', '取消');
    if (!ok) return;

    const all = _getAllPresets();
    const idx = all.findIndex(p =>
        p.name === name && (p.type === type || (!p.type && type === 'chat'))
    );
    if (idx >= 0) all.splice(idx, 1);
    _saveAllPresets(all);

    // 若删的是默认预设，清除 activePreset
    if (isChat) {
        if (db.apiSettings && db.apiSettings.activePreset === name) {
            db.apiSettings.activePreset = undefined;
            saveGlobalKeys(['apiSettings']);
        }
    } else {
        if (db.embeddingSettings && db.embeddingSettings.activePreset === name) {
            db.embeddingSettings.activePreset = undefined;
            saveGlobalKeys(['embeddingSettings']);
        }
    }

    populateApiSelect(type);
    _setPresetNameInput(type, '');
    const sel = document.getElementById(isChat ? 'api-chat-preset-select' : 'api-emb-preset-select');
    if (sel) sel.value = '';
    _loadedPresetName[type] = null;
    _updateDefaultToggleState(type);
    _clearDirty(type);
    showToast('预设已删除');
}

// ============================================================
// 数据迁移（旧用户：将裸数据迁移为「用户默认」预设）
// ============================================================
function _migrateOldSettings() {
    let changed = false;
    const all = _getAllPresets();

    // 文字迁移
    const chatPresets = all.filter(p => !p.type || p.type === 'chat');
    if (chatPresets.length === 0 && db.apiSettings &&
        (db.apiSettings.key || db.apiSettings.apiKey || db.apiSettings.url)) {
        const s = db.apiSettings;
        all.push({
            name: '用户默认',
            type: 'chat',
            data: {
                provider:                 s.provider || 'newapi',
                url:                      s.url || s.apiUrl || '',
                key:                      s.key || s.apiKey || '',
                model:                    s.model || '',
                streamEnabled:            s.streamEnabled !== false,
                compatibilityModeEnabled: !!s.compatibilityModeEnabled,
                temperature:              s.temperature !== undefined ? s.temperature : 0.8
            }
        });
        db.apiSettings.activePreset = '用户默认';
        changed = true;
    }

    // 向量迁移
    const embPresets = all.filter(p => p.type === 'embedding');
    if (embPresets.length === 0 && db.embeddingSettings &&
        (db.embeddingSettings.key || db.embeddingSettings.apiKey || db.embeddingSettings.url)) {
        const s = db.embeddingSettings;
        all.push({
            name: '用户默认',
            type: 'embedding',
            data: {
                provider: s.provider || 'newapi',
                url:      s.url || s.apiUrl || '',
                key:      s.key || s.apiKey || '',
                model:    s.model || ''
            }
        });
        db.embeddingSettings.activePreset = '用户默认';
        changed = true;
    }

    if (changed) {
        _saveAllPresets(all);
        saveGlobalKeys(['apiSettings', 'embeddingSettings']);
    }
}

// ============================================================
// 返回按钮未保存守卫
// ============================================================
function _setupBackGuard() {
    const backBtn = document.querySelector('#api-settings-screen .back-btn');
    if (!backBtn) return;
    // 在捕获阶段拦截，确保先于 body 委托代理执行
    backBtn.addEventListener('click', async (e) => {
        const dirty = _chatDirty || _embDirty;
        if (!dirty) return; // 无脏数据，正常冒泡给全局代理
        e.stopPropagation();
        e.preventDefault();
        const leave = await AppUI.confirm('您还未保存，是否离开页面？', '提示', '离开', '取消');
        if (leave) {
            _clearDirty('chat');
            _clearDirty('embedding');
            if (typeof navigateTo === 'function') navigateTo('settings-screen');
        }
    });
}

// ============================================================
// 读取表单
// ============================================================

function _readChatForm() {
    const tempVal = parseFloat(_getVal('api-chat-temp'));
    return {
        provider:                 _getVal('api-chat-provider'),
        url:                      _getVal('api-chat-url'),
        key:                      _getVal('api-chat-key'),
        model:                    _getVal('api-chat-model'),
        streamEnabled:            _getChecked('api-chat-stream'),
        compatibilityModeEnabled: _getChecked('api-chat-compat'),
        // 修复 0 || 0.8 会变成 0.8 的 Bug
        temperature:              isNaN(tempVal) ? 0.8 : tempVal
    };
}

function _readEmbForm() {
    return {
        provider: _getVal('api-emb-provider'),
        url:      _getVal('api-emb-url'),
        key:      _getVal('api-emb-key'),
        model:    _getVal('api-emb-model')
    };
}

// 底部保存按钮对外接口（委托给 _savePreset）
async function saveChatApiSettings() { await _savePreset('chat'); }
async function saveEmbApiSettings()  { await _savePreset('embedding'); }

// ── 导出预设 ─────────────────────────────────────────────────
function exportApiPresets(type) {
    const presets = _getPresets(type);
    if (!presets.length) return showToast('暂无预设可导出');
    const blob = new Blob([JSON.stringify(presets, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `api_${type}_presets.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
}

// ── 导入预设 ─────────────────────────────────────────────────
function importApiPresets(type) {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'application/json';
    inp.onchange = function (e) {
        const f = e.target.files[0]; if (!f) return;
        const r = new FileReader();
        r.onload = async function () {
            try {
                const data = JSON.parse(r.result);
                if (!Array.isArray(data)) return await AppUI.alert('文件格式不正确');
                const all = _getAllPresets();
                data.forEach(p => {
                    p.type = p.type || type;
                    const idx = all.findIndex(x =>
                        x.name === p.name && (x.type === p.type || (!x.type && p.type === 'chat'))
                    );
                    if (idx >= 0) all[idx] = p; else all.push(p);
                });
                _saveAllPresets(all);
                populateApiSelect(type);
                showToast(`已导入 ${data.length} 个预设`);
            } catch (ex) { await AppUI.alert('导入失败：' + ex.message); }
        };
        r.readAsText(f);
    };
    inp.click();
}

// ============================================================
// 拉取模型列表 (已适配自定义 AppUI.prompt 手动输入机制)
// ============================================================
async function fetchModels(tabType) {
    const isChat     = tabType === 'chat';
    const urlId      = isChat ? 'api-chat-url'       : 'api-emb-url';
    const keyId      = isChat ? 'api-chat-key'       : 'api-emb-key';
    const modelId    = isChat ? 'api-chat-model'     : 'api-emb-model';
    const btnId      = isChat ? 'api-chat-fetch-btn' : 'api-emb-fetch-btn';
    const providerId = isChat ? 'api-chat-provider'  : 'api-emb-provider';

    let url        = _getVal(urlId).trim();
    const key      = _getVal(keyId).trim();
    const provider = _getVal(providerId);
    const btn      = document.getElementById(btnId);
    const modelSel = document.getElementById(modelId);

    if (!url || !key) return showToast('请先填写 API 地址和密钥！');
    if (url.endsWith('/')) url = url.slice(0, -1);

    const endpoint = provider === 'gemini'
        ? `${url}/v1beta/models?key=${getRandomValue(key)}`
        : `${url}/v1/models`;
    const headers = provider === 'gemini' ? {} : { Authorization: `Bearer ${key}` };

    btn.classList.add('loading'); 
    btn.disabled = true;

    try {
        const res = await fetch(endpoint, { method: 'GET', headers });
        if (!res.ok) {
            const err = new Error(`网络响应错误: ${res.status}`);
            err.response = res; 
            throw err;
        }
        const json = await res.json();
        let models = [];
        // [修复更新] 移除了正则截断逻辑，强制保留厂商前缀的完整模型名
        if (provider !== 'gemini' && json.data) {
            models = json.data.map(e => e.id);
        } else if (provider === 'gemini' && json.models) {
            models = json.models.map(e => e.name.replace('models/', ''));
        }

        modelSel.innerHTML = '';
        if (models.length > 0) {
            models.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m; opt.textContent = m;
                modelSel.appendChild(opt);
            });
            showToast('模型列表拉取成功！');
        } else {
            throw new Error('接口未返回任何模型数据');
        }
        
        // 成功时恢复按钮状态
        btn.classList.remove('loading'); 
        btn.disabled = false;

    } catch (ex) {
        // 请求失败，在弹窗前先停止 loading 动画
        btn.classList.remove('loading'); 
        btn.disabled = false;

        // 使用你封装的 AppUI.prompt 组件
        const manualModel = await AppUI.prompt(
            `自动拉取失败: ${ex.message}\n企业级接口通常不支持拉取，请直接手动填写。`, 
            "例如: GLM-5.2", // placeholder
            "手动输入模型", // title
            "确定添加",     // confirmText
            "取消"        // cancelText
        );

        if (manualModel && manualModel.trim() !== '') {
            const m = manualModel.trim();
            // 将输入的模型加入下拉菜单并选中
            modelSel.innerHTML = `<option value="${m}">${m}</option>`;
            modelSel.value = m;
            
            // 重要：因为是通过代码修改的值，必须手动触发 change 事件，
            // 让 _watchDirty 监听到，从而触发保存按钮亮起
            modelSel.dispatchEvent(new Event('change', { bubbles: true }));
            
            showToast('已手动添加模型：' + m);
        } else {
            // 用户点击取消或未输入
            if (typeof showApiError === 'function') {
                showApiError(ex);
            } else {
                showToast('拉取失败，且未输入模型');
            }
            modelSel.innerHTML = '<option value="">拉取失败，请重新获取或手动填写</option>';
        }
    }
}

// ============================================================
// 初始化各 Tab
// ============================================================

/** 刷新文字 Tab 的 UI（每次打开页面时调用，不重复绑定事件） */
function _refreshChatTabUI() {
    const s = db.apiSettings || {};
    const activeName = s.activePreset;
    if (activeName) {
        const preset = _getPresets('chat').find(p => p.name === activeName);
        if (preset && preset.data) {
            _applyDataToForm('chat', preset.data);
            _setPresetNameInput('chat', activeName);
        }
        _loadedPresetName.chat = activeName;
    } else {
        _setVal('api-chat-provider', s.provider || 'newapi');
        _setVal('api-chat-url',      s.url || s.apiUrl || '');
        _setVal('api-chat-key',      s.key || s.apiKey || '');
        if (s.model) {
            const m = document.getElementById('api-chat-model');
            if (m) { m.innerHTML = `<option value="${s.model}">${s.model}</option>`; m.value = s.model; }
        }
        _setChecked('api-chat-stream', s.streamEnabled === true);
        _setChecked('api-chat-compat', !!s.compatibilityModeEnabled);
        _setVal('api-chat-temp', s.temperature !== undefined ? s.temperature : 0.8);
        _setPresetNameInput('chat', '未命名预设');
        _loadedPresetName.chat = null;
    }
    populateApiSelect('chat');
    if (activeName) {
        const sel = document.getElementById('api-chat-preset-select');
        if (sel) sel.value = activeName;
        _setChecked('api-chat-set-default', true);
    }
    _updateDefaultToggleState('chat');
}

/** 绑定文字 Tab 的所有事件（仅 init 时调用一次） */
function initChatApiTab() {
    _refreshChatTabUI();

    // 服务商切换 → 自动填 URL
    const providerEl = document.getElementById('api-chat-provider');
    if (providerEl) providerEl.addEventListener('change', () => {
        const autoUrl = CHAT_PROVIDER_URLS[providerEl.value];
        if (autoUrl !== undefined) _setVal('api-chat-url', autoUrl);
    });

    // 拉取模型
    _on('api-chat-fetch-btn', () => fetchModels('chat'));

    // 选择预设 → 应用到表单
    const presetSel = document.getElementById('api-chat-preset-select');
    if (presetSel) presetSel.addEventListener('change', () => {
        if (presetSel.value) {
            applyPresetToForm('chat', presetSel.value); // 内部已更新 _loadedPresetName
        } else {
            _setChecked('api-chat-set-default', false);
            _setPresetNameInput('chat', '');
            _loadedPresetName.chat = null;
        }
        _clearDirty('chat');
        _updateDefaultToggleState('chat');
    });

    // 四个图标按钮
    _on('api-chat-add-preset',  () => _addNewPreset('chat'));
    _on('api-chat-copy-preset', () => _copyPreset('chat'));
    _on('api-chat-save-preset', () => _savePreset('chat'));
    _on('api-chat-del-preset',  () => _deletePreset('chat'));

    // 导入 / 导出
    _on('api-chat-import-preset', () => importApiPresets('chat'));
    _on('api-chat-export-preset', () => exportApiPresets('chat'));

    // 底部保存按钮
    _on('api-chat-save-btn', saveChatApiSettings);

    // 监听表单变化 → 标记脏数据
    _watchDirty('chat', [
        'api-chat-preset-name',
        'api-chat-provider', 'api-chat-url', 'api-chat-key', 'api-chat-model',
        'api-chat-stream', 'api-chat-compat', 'api-chat-temp'
    ]);
}

/** 刷新向量 Tab 的 UI（每次打开页面时调用，不重复绑定事件） */
function _refreshEmbTabUI() {
    const s = db.embeddingSettings || {};
    const activeName = s.activePreset;
    if (activeName) {
        const preset = _getPresets('embedding').find(p => p.name === activeName);
        if (preset && preset.data) {
            _applyDataToForm('embedding', preset.data);
            _setPresetNameInput('embedding', activeName);
        }
        _loadedPresetName.embedding = activeName;
    } else {
        _setVal('api-emb-provider', s.provider || 'newapi');
        _setVal('api-emb-url',      s.url || s.apiUrl || '');
        _setVal('api-emb-key',      s.key || s.apiKey || '');
        if (s.model) {
            const m = document.getElementById('api-emb-model');
            if (m) { m.innerHTML = `<option value="${s.model}">${s.model}</option>`; m.value = s.model; }
        }
        _setPresetNameInput('embedding', '未命名预设');
        _loadedPresetName.embedding = null;
    }
    populateApiSelect('embedding');
    if (activeName) {
        const sel = document.getElementById('api-emb-preset-select');
        if (sel) sel.value = activeName;
        _setChecked('api-emb-set-default', true);
    }
    _updateDefaultToggleState('embedding');
}

/** 绑定向量 Tab 的所有事件（仅 init 时调用一次） */
function initEmbApiTab() {
    _refreshEmbTabUI();

    const providerEl = document.getElementById('api-emb-provider');
    if (providerEl) providerEl.addEventListener('change', () => {
        const autoUrl = EMB_PROVIDER_URLS[providerEl.value];
        if (autoUrl !== undefined) _setVal('api-emb-url', autoUrl);
    });

    _on('api-emb-fetch-btn', () => fetchModels('embedding'));

    const presetSel = document.getElementById('api-emb-preset-select');
    if (presetSel) presetSel.addEventListener('change', () => {
        if (presetSel.value) {
            applyPresetToForm('embedding', presetSel.value); // 内部已更新 _loadedPresetName
        } else {
            _setChecked('api-emb-set-default', false);
            _setPresetNameInput('embedding', '');
            _loadedPresetName.embedding = null;
        }
        _clearDirty('embedding');
        _updateDefaultToggleState('embedding');
    });

    _on('api-emb-add-preset',  () => _addNewPreset('embedding'));
    _on('api-emb-copy-preset', () => _copyPreset('embedding'));
    _on('api-emb-save-preset', () => _savePreset('embedding'));
    _on('api-emb-del-preset',  () => _deletePreset('embedding'));

    _on('api-emb-import-preset', () => importApiPresets('embedding'));
    _on('api-emb-export-preset', () => exportApiPresets('embedding'));

    _on('api-emb-save-btn', saveEmbApiSettings);

    _watchDirty('embedding', [
        'api-emb-preset-name',
        'api-emb-provider', 'api-emb-url', 'api-emb-key', 'api-emb-model'
    ]);
}

// ============================================================
// 主入口：setupApiSettingsApp
// ============================================================
function setupApiSettingsApp() {
    _currentApiTab    = 'chat';
    _chatDirty        = false;
    _embDirty         = false;
    _stagedPresets    = { chat: null, embedding: null };
    _loadedPresetName = { chat: null, embedding: null };

    // 数据迁移（旧用户首次进入）
    _migrateOldSettings();

    // 独立且安全的 Tab 切换逻辑
    const apiScreen = document.getElementById('api-settings-screen');
    if (apiScreen) {
        apiScreen.querySelectorAll('[data-api-tab]').forEach(btn => {
            btn.onclick = (e) => {
                _currentApiTab = btn.dataset.apiTab;
                
                // 1. 切换侧边栏按钮的激活状态
                apiScreen.querySelectorAll('[data-api-tab]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                // 2. 隐藏所有的 API pane (改为新的 .api-tab-pane 类名)
                apiScreen.querySelectorAll('.api-tab-pane').forEach(p => p.classList.remove('active'));
                
                // 3. 显示指定的 pane
                const pane = apiScreen.querySelector(`#api-tab-${_currentApiTab}`);
                if (pane) pane.classList.add('active');
            };
        });
    }

    // 返回守卫
    _setupBackGuard();

    initChatApiTab();
    initEmbApiTab();
}

// ============================================================
// 每次打开 API 页面时调用（重置状态 + 回到文字 Tab + 刷新 UI）
// ============================================================
function openApiSettingsScreen() {
    // 重置脏数据和暂存状态
    _chatDirty        = false;
    _embDirty         = false;
    _stagedPresets    = { chat: null, embedding: null };
    _loadedPresetName = { chat: null, embedding: null };

    // 强制切回文字 Tab
    const apiScreen = document.getElementById('api-settings-screen');
    if (apiScreen) {
        apiScreen.querySelectorAll('[data-api-tab]').forEach(b => b.classList.remove('active'));
        const chatBtn = apiScreen.querySelector('[data-api-tab="chat"]');
        if (chatBtn) chatBtn.classList.add('active');
        apiScreen.querySelectorAll('.api-tab-pane').forEach(p => p.classList.remove('active'));
        const chatPane = apiScreen.querySelector('#api-tab-chat');
        if (chatPane) chatPane.classList.add('active');
        _currentApiTab = 'chat';
    }

    // 两个 Tab 都刷新回全局默认状态
    _refreshChatTabUI();
    _refreshEmbTabUI();
}

// ============================================================
// 工具函数
// ============================================================

function _getVal(id)        { const el = document.getElementById(id); return el ? el.value : ''; }
function _setVal(id, v) { 
    const el = document.getElementById(id); 
    if (el && v !== undefined) {
        el.value = v; 
        // 专门修复：如果设置的是温度滑块，同步更新旁边的数字显示
        if (id === 'api-chat-temp') {
            const span = document.getElementById('chat-temp-val');
            if (span) span.innerText = v;
        }
    } 
}
function _getChecked(id)    { const el = document.getElementById(id); return el ? el.checked : false; }
function _setChecked(id, v) { const el = document.getElementById(id); if (el) el.checked = !!v; }
function _on(id, fn)        { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); }

/** Gemini 多 Key 随机选取 */
function getRandomValue(str) {
    if (str.includes(',')) {
        const arr = str.split(',').map(s => s.trim());
        return arr[Math.floor(Math.random() * arr.length)];
    }
    return str;
}

// ============================================================
// 向后兼容 & 全局暴露
// ============================================================

/** 已合并入 setupApiSettingsApp，保留空函数防止旧调用报错 */
function setupApiPresets() { /* no-op */ }
window.setupApiPresets = setupApiPresets;

/**
 * 供聊天侧边栏刷新 API 预设下拉框使用
 */
window.populateChatApiPresetSelect = function (selectEl) {
    if (!selectEl) return;
    const presets = (db.apiPresets || []).filter(p => !p.type || p.type === 'chat');
    selectEl.innerHTML = '<option value="">全局默认</option>';
    presets.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.name; opt.textContent = p.name;
        selectEl.appendChild(opt);
    });
};