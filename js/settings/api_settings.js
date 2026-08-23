// ============================================================
// api_settings.js  —  API 设置页逻辑（v1.7 描述符驱动）
// ============================================================
// 每类 API 的差异全部收在 API_TAB_DEFS 里：元素 id 前缀、落库的 db 键、
// 字段清单、服务商预填 URL。下面的 CRUD / 表单读写 / 事件绑定全由描述符驱动，
// 不再出现 isChat ? 'api-chat-x' : 'api-emb-x' 这类二选一分支。
// 加一类 API（语音 / 图像）＝ API_TAB_DEFS 加一条 + index.html 加一个 pane，
// 逻辑代码不用动。
//
// 例外：天气 tab 不是"服务商 + URL + Key + 模型"这个形状（它是 Host + Key + 地点预设），
//       所以它保留自己的 init/refresh，见本文件下半部分。
//
// 对外入口（main.js 依赖，勿改名）：
//   setupApiSettingsApp / openApiSettingsScreen / setupApiPresets
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

// ============================================================
// 描述符表：加新 API 类型只改这里
// ============================================================
// tab 级：
//   type             预设在 db.apiPresets 里的 type 值
//   idPrefix         元素 id 前缀，完整 id = `${idPrefix}-${后缀}`
//   dbKey            "全局默认那份配置"落在 db 的哪个键
//   nameBase         新增预设时的默认名前缀
//   modelRequiredMsg 未选模型时的提示语
//   providerUrls     服务商 → 自动填入的 URL
// 字段级（fields）：
//   key         预设 data 里的字段名
//   id          元素 id 后缀（省略则用 key）
//   kind        text | check | range | modelSelect，决定读写用哪种 DOM 操作
//   blank       "新增空白预设"时填的值
//   get(src)    从预设 data 或裸 db 配置里取值（含旧字段名兼容与默认值）
//   getLegacy(src)  仅当"没有 activePreset、直接读裸 db 配置"这条路径口径不同才需要写
//   onSet(v)    写入后的附带副作用
const API_TAB_DEFS = {
    chat: {
        type: 'chat',
        idPrefix: 'api-chat',
        dbKey: 'apiSettings',
        nameBase: 'api预设',
        modelRequiredMsg: '请选择模型后保存！',
        providerUrls: CHAT_PROVIDER_URLS,
        fields: [
            { key: 'provider', kind: 'text',        blank: 'newapi', get: s => s.provider || 'newapi' },
            { key: 'url',      kind: 'text',        blank: '',       get: s => s.url || s.apiUrl || '' },
            { key: 'key',      kind: 'text',        blank: '',       get: s => s.key || s.apiKey || '' },
            { key: 'model',    kind: 'modelSelect', blank: '',       get: s => s.model || '' },
            {
                key: 'streamEnabled', id: 'stream', kind: 'check', blank: false,
                get: s => s.streamEnabled !== false,
                // ★ 如实保留原有的口径不一致：读预设时"缺字段＝开启"，
                //   读裸 db 配置时"缺字段＝关闭"。大概是历史遗留，要统一就把这行删掉。
                getLegacy: s => s.streamEnabled === true
            },
            {
                key: 'compatibilityModeEnabled', id: 'compat', kind: 'check', blank: false,
                get: s => !!s.compatibilityModeEnabled
            },
            {
                key: 'temperature', id: 'temp', kind: 'range', blank: 0.8,
                get: s => s.temperature !== undefined ? s.temperature : 0.8,
                // 滑块旁边那个数字的 id 不带 api- 前缀，属于这个字段自己的事
                onSet: v => { const span = document.getElementById('chat-temp-val'); if (span) span.innerText = v; }
            }
        ]
    },
    embedding: {
        type: 'embedding',
        idPrefix: 'api-emb',
        dbKey: 'embeddingSettings',
        nameBase: '向量预设',
        modelRequiredMsg: '请选择向量模型后保存！',
        providerUrls: EMB_PROVIDER_URLS,
        fields: [
            { key: 'provider', kind: 'text',        blank: 'newapi', get: s => s.provider || 'newapi' },
            { key: 'url',      kind: 'text',        blank: '',       get: s => s.url || s.apiUrl || '' },
            { key: 'key',      kind: 'text',        blank: '',       get: s => s.key || s.apiKey || '' },
            { key: 'model',    kind: 'modelSelect', blank: '',       get: s => s.model || '' }
        ]
    }
};

const API_TAB_TYPES = Object.keys(API_TAB_DEFS);

/** 取描述符；未知类型返回 null（调用方一律先判空） */
function _apiDef(type) {
    return API_TAB_DEFS[type] || null;
}

/** 拼元素 id */
function _apiId(def, suffix) {
    return `${def.idPrefix}-${suffix}`;
}

/** 字段对应的元素 id */
function _apiFieldId(def, f) {
    return _apiId(def, f.id || f.key);
}

/** 该类型当前的全局默认预设名 */
function _activePresetName(def) {
    const s = db[def.dbKey];
    return s && s.activePreset;
}

// ── 当前激活的 tab ────────────────────────────────────────────
let _currentApiTab = 'chat';

// ── 每个 tab 的编辑态：脏数据 / 暂存预设 / 已加载预设原始名 ──────
// 按 tab 名存成字典，加类型时不用再各处补一行。
// 天气 / 语音 tab 不走预设引擎，但它们也要脏数据标记，所以额外带两个键。
const _API_STATE_KEYS = [...API_TAB_TYPES, 'weather', 'voice', 'image'];
let _apiDirty            = {};
let _stagedPresets    = {};
let _loadedPresetName = {};

function _resetApiTabState() {
    _apiDirty            = {};
    _stagedPresets    = {};
    _loadedPresetName = {};
    _API_STATE_KEYS.forEach(k => {
        _apiDirty[k]            = false;
        _stagedPresets[k]    = null;
        _loadedPresetName[k] = null;
    });
}
_resetApiTabState();

// ============================================================
// 预设 CRUD  （统一存储在 db.apiPresets，用 type 区分）
// ============================================================

/** 某条预设是否属于该类型（旧预设无 type 字段视为 chat） */
function _isPresetOfType(p, type) {
    return type === 'chat' ? (!p.type || p.type === 'chat') : p.type === type;
}

/** 获取指定类型的预设列表 */
function _getPresets(type) {
    return (db.apiPresets || []).filter(p => _isPresetOfType(p, type));
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
function _markDirty(type)   { _apiDirty[type] = true; }
function _clearDirty(type)  { _apiDirty[type] = false; }
function _isDirtyType(type) { return !!_apiDirty[type]; }
function _hasAnyDirty()     { return Object.values(_apiDirty).some(Boolean); }

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
    const def = _apiDef(type);
    if (!def) return;
    const el = document.getElementById(_apiId(def, 'set-default'));
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
    const def = _apiDef(type);
    if (def) _setVal(_apiId(def, 'preset-name'), name || '');
}

// ── 填充 Select ──────────────────────────────────────────────
function populateApiSelect(type) {
    const def = _apiDef(type);
    if (!def) return;
    const sel = document.getElementById(_apiId(def, 'preset-select'));
    if (!sel) return;
    sel.innerHTML = '<option value="">— 选择预设 —</option>';
    _getPresets(type).forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.name;
        opt.textContent = p.name;
        sel.appendChild(opt);
    });
    // 回显当前 activePreset
    const activeName = _activePresetName(def);
    if (activeName) sel.value = activeName;
}

// ============================================================
// 表单 ↔ 预设 data（全部按描述符字段走）
// ============================================================

/** 读单个字段 */
function _readApiField(def, f) {
    const id = _apiFieldId(def, f);
    if (f.kind === 'check') return _getChecked(id);
    if (f.kind === 'range') {
        // 用 isNaN 判而不是 ||：温度 0 是合法值，0 || 0.8 会变成 0.8
        const n = parseFloat(_getVal(id));
        return isNaN(n) ? f.blank : n;
    }
    return _getVal(id);
}

/** 写单个字段 */
function _writeApiField(def, f, value) {
    const id = _apiFieldId(def, f);
    if (f.kind === 'check') { _setChecked(id, value); return; }
    if (f.kind === 'modelSelect') {
        // 模型下拉的选项是拉取来的，这里只塞一个当前值；没值就别动它
        if (!value) return;
        const el = document.getElementById(id);
        if (el) {
            el.innerHTML = `<option value="${value}">${value}</option>`;
            el.value = value;
        }
        return;
    }
    _setVal(id, value);
    if (f.onSet && value !== undefined) f.onSet(value);
}

/** 读整个表单 → 一份预设 data */
function _readApiForm(type) {
    const def = _apiDef(type);
    if (!def) return {};
    const data = {};
    def.fields.forEach(f => { data[f.key] = _readApiField(def, f); });
    return data;
}

/** 从任意来源（预设 data 或裸 db 配置）整理出一份完整 data */
function _apiDataFromSource(def, src) {
    const data = {};
    def.fields.forEach(f => { data[f.key] = f.get(src || {}); });
    return data;
}

/**
 * 把数据写进表单字段（纯数据，不动 select / name input）
 * @param {boolean} legacy true = 来源是裸 db 配置（无 activePreset 的回落路径），
 *                         写了 getLegacy 的字段按那个口径取值
 */
function _applyDataToForm(type, src, { legacy = false } = {}) {
    if (!src) return;
    const def = _apiDef(type);
    if (!def) return;
    def.fields.forEach(f => {
        const get = (legacy && f.getLegacy) ? f.getLegacy : f.get;
        _writeApiField(def, f, get(src));
    });
}

/** 清空表单字段 */
function _clearFormFields(type) {
    const def = _apiDef(type);
    if (!def) return;
    def.fields.forEach(f => {
        if (f.kind === 'modelSelect') {
            const el = document.getElementById(_apiFieldId(def, f));
            if (el) el.innerHTML = '<option value="">请先拉取模型列表</option>';
            return;
        }
        _writeApiField(def, f, f.blank);
    });
}

// ── 应用预设到表单（对外接口，含 name input + 默认开关同步） ──
function applyPresetToForm(type, name) {
    const def = _apiDef(type);
    if (!def) return;
    const preset = _getPresets(type).find(p => p.name === name);
    if (!preset) return;
    if (preset.data) _applyDataToForm(type, preset.data);
    _setPresetNameInput(type, name);
    // 同步"是否默认"开关
    _setChecked(_apiId(def, 'set-default'), _activePresetName(def) === name);
    // 记录当前加载的原始预设名（用于保存时重命名检测）
    _loadedPresetName[type] = name;
}

// ── 暂存选项（新增/复制后在 Select 中显示，但未写入 db） ───────
function _addStagedOption(type, name) {
    const def = _apiDef(type);
    if (!def) return;
    const sel = document.getElementById(_apiId(def, 'preset-select'));
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
    const def = _apiDef(type);
    if (!def) return;
    const sel = document.getElementById(_apiId(def, 'preset-select'));
    if (!sel) return;
    Array.from(sel.options).forEach(o => { if (o.dataset.staged) sel.removeChild(o); });
}

// ============================================================
// 新增 / 复制 / 保存 / 删除
// ============================================================

/** ① 新增空白预设（暂存，需点保存生效） */
async function _addNewPreset(type) {
    const def = _apiDef(type);
    if (!def) return;
    if (_isDirtyType(type)) {
        const go = await AppUI.confirm('您还未保存，是否离开页面？', '提示', '离开', '取消');
        if (!go) return;
    }
    const name = _genName(type, def.nameBase);
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
    const def = _apiDef(type);
    if (!def) return;
    if (_isDirtyType(type)) {
        const go = await AppUI.confirm('您还未保存，是否离开页面？', '提示', '离开', '取消');
        if (!go) return;
    }
    const currentName = _getVal(_apiId(def, 'preset-select'));
    if (!currentName) return showToast('请先选择要复制的预设');
    const src = _getPresets(type).find(p => p.name === currentName);
    if (!src) return showToast('找不到该预设');

    const newName = _genCopyName(type, currentName);
    _stagedPresets[type] = { name: newName, type };
    _addStagedOption(type, newName);
    if (src.data) _applyDataToForm(type, src.data);
    _setPresetNameInput(type, newName);
    _setChecked(_apiId(def, 'set-default'), false);
    _loadedPresetName[type] = null;
    _markDirty(type);
}

/** ③ 保存当前表单到预设（底部保存按钮也委托此函数） */
async function _savePreset(type) {
    const def = _apiDef(type);
    if (!def) return;

    const newName = (_getVal(_apiId(def, 'preset-name')) || '').trim();
    if (!newName) return showToast('请填写预设名称后再保存');

    const data = _readApiForm(type);
    if (!data.model) return showToast(def.modelRequiredMsg);

    const setDefault   = _getChecked(_apiId(def, 'set-default'));
    const originalName = _loadedPresetName[type];   // 当前已加载预设的原始名
    const presets      = _getPresets(type);

    // ── 重命名检测：新名不能撞上其它已有预设 ──────────────────
    const isRename = !!originalName && newName !== originalName;
    if (isRename && presets.some(p => p.name === newName)) {
        await AppUI.alert(`已存在重名预设「${newName}」，请修改名字`);
        return;
    }

    // ── 全局默认唯一性确认 ────────────────────────────────────
    // 只在"想设为默认 且 原来已有别的预设是默认"时才问
    const prevActive = _activePresetName(def);
    if (setDefault && prevActive && prevActive !== originalName) {
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
        const oldIdx = all.findIndex(p => p.name === originalName && _isPresetOfType(p, type));
        if (oldIdx >= 0) all.splice(oldIdx, 1);
        all.push({ name: newName, type, data });
    } else {
        // 同名覆盖或新增
        const idx = all.findIndex(p => p.name === newName && _isPresetOfType(p, type));
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

    // db[dbKey] 的内容必须和 activePreset 指向的预设一致：设为默认就用当前表单数据，
    // 否则从那条预设回读。（原先这里是 chat / embedding 两段几乎一样的分支，
    // embedding 那段曾漏写赋值，导致落库前内存没更新 —— 合成一份就不会再有这种偏差。）
    const effective = setDefault
        ? data
        : (activePreset ? (_getPresets(type).find(p => p.name === activePreset)?.data || {}) : {});
    window.db[def.dbKey] = { ...effective, activePreset };
    await saveGlobalKeys([def.dbKey]);

    // 更新已加载名、刷新 Select、同步开关状态
    _loadedPresetName[type] = newName;
    populateApiSelect(type);
    const sel = document.getElementById(_apiId(def, 'preset-select'));
    if (sel) sel.value = newName;
    _setChecked(_apiId(def, 'set-default'), activePreset === newName);
    _updateDefaultToggleState(type);

    _clearDirty(type);
    showToast('预设已保存：' + newName);
}

/** ④ 删除当前选中预设 */
async function _deletePreset(type) {
    const def = _apiDef(type);
    if (!def) return;
    const selId = _apiId(def, 'preset-select');

    // 有暂存预设：取消暂存即可（未写入 db，无需删除确认）
    if (_stagedPresets[type]) {
        _removeStagedOption(type);
        _stagedPresets[type] = null;
        _setPresetNameInput(type, '');
        const stagedSel = document.getElementById(selId);
        if (stagedSel) stagedSel.value = '';
        _clearDirty(type);
        showToast('已取消新增');
        return;
    }

    const name = (_getVal(_apiId(def, 'preset-name')) || _getVal(selId)).trim();
    if (!name) return showToast('请先选择要删除的预设');

    const ok = await AppUI.confirm(`确定删除预设「${name}」？`, '删除预设', '删除', '取消');
    if (!ok) return;

    const all = _getAllPresets();
    const idx = all.findIndex(p => p.name === name && _isPresetOfType(p, type));
    if (idx >= 0) all.splice(idx, 1);
    _saveAllPresets(all);

    // 若删的是默认预设，清除 activePreset
    if (db[def.dbKey] && db[def.dbKey].activePreset === name) {
        db[def.dbKey].activePreset = undefined;
        saveGlobalKeys([def.dbKey]);
    }

    populateApiSelect(type);
    _setPresetNameInput(type, '');
    const sel = document.getElementById(selId);
    if (sel) sel.value = '';
    _loadedPresetName[type] = null;
    _updateDefaultToggleState(type);
    _clearDirty(type);
    showToast('预设已删除');
}

// ============================================================
// 数据迁移（旧用户：把裸 db 配置转成一条「用户默认」预设）
// ============================================================
function _migrateOldSettings() {
    let changed = false;
    const all = _getAllPresets();

    API_TAB_TYPES.forEach(type => {
        const def = API_TAB_DEFS[type];
        // 已经有该类型的预设就不迁；注意 all 与 db.apiPresets 可能是同一个数组，
        // 所以这里从 all 上判断，别用 _getPresets（那样读的是可能已被本轮 push 过的库）
        if (all.some(p => _isPresetOfType(p, type))) return;
        const s = db[def.dbKey];
        if (!s || !(s.key || s.apiKey || s.url)) return;
        all.push({ name: '用户默认', type, data: _apiDataFromSource(def, s) });
        s.activePreset = '用户默认';
        changed = true;
    });

    if (changed) {
        _saveAllPresets(all);
        saveGlobalKeys(API_TAB_TYPES.map(t => API_TAB_DEFS[t].dbKey));
    }
}

// ============================================================
// 返回按钮未保存守卫
// ============================================================
function _setupBackGuard() {
    const backBtn = document.querySelector('#api-settings-screen .back-btn');
    if (!backBtn) return;
    // 监听挂在按钮自己身上，冒泡时先于 body 上的委托代理执行
    backBtn.addEventListener('click', async (e) => {
        if (!_hasAnyDirty()) {
            _clearImagePreview({ abortRequest: true, clearResult: true });
            return;   // 无脏数据，正常冒泡给全局代理
        }
        e.stopPropagation();
        e.preventDefault();
        const leave = await AppUI.confirm('您还未保存，是否离开页面？', '提示', '离开', '取消');
        if (leave) {
            _API_STATE_KEYS.forEach(_clearDirty);
            _clearImagePreview({ abortRequest: true, clearResult: true });
            if (typeof navigateTo === 'function') navigateTo('settings-screen');
        }
    });
}

// ============================================================
// 导入 / 导出预设
// ============================================================

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
                    const idx = all.findIndex(x => x.name === p.name && _isPresetOfType(x, p.type));
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
async function fetchModels(type) {
    const def = _apiDef(type);
    if (!def) return;

    let url        = _getVal(_apiId(def, 'url')).trim();
    const key      = _getVal(_apiId(def, 'key')).trim();
    const provider = _getVal(_apiId(def, 'provider'));
    const btn      = document.getElementById(_apiId(def, 'fetch-btn'));
    const modelSel = document.getElementById(_apiId(def, 'model'));

    if (!url || !key) return showToast('请先填写 API 地址和密钥！');
    if (url.endsWith('/')) url = url.slice(0, -1);

    let endpoint;
    if (provider === 'gemini') {
        endpoint = `${url}/v1beta/models?key=${getRandomValue(key)}`;
    } else {
        // 智能判断：如果 url 已经以 /v1, /v2, /v3 等结尾，则直接追加 /models
        if (/\/v\d+$/.test(url)) {
            endpoint = `${url}/models`;
        } else {
            endpoint = `${url}/v1/models`;
        }
    }
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
// 天气 API 设置 Tab（和风天气）
// ============================================================
// 凭据校验、配置归一化、额度记账、和风请求都在 js/api/weather_api.js，
// 本段只管这个 tab 的表单与地点预设编辑。聊天里怎么用天气见
// js/chat/chat_weather_context.js —— 两边都只依赖 api 层，互不依赖。

let _weatherDraft = null;
let _weatherLoadedPresetId = '';

/** 天气 Tab 上的"今日已用 N / 上限 M 次"（由 api 层的用量回调驱动） */
function _refreshWeatherUsageUI() {
    const el = document.getElementById('api-weather-usage-display');
    if (!el) return;
    const { limit, count } = _readWeatherQuota();
    el.textContent = `今日已用 ${count} / 上限 ${limit} 次`;
    el.classList.toggle('is-over-limit', count >= limit);
}

function _getWeatherCurrentLocation() {
    const locationSelect = document.getElementById('api-weather-location-select');
    const selectedOption = locationSelect && locationSelect.selectedIndex >= 0
        ? locationSelect.options[locationSelect.selectedIndex] : null;
    return {
        locationQuery: _getVal('api-weather-city').trim(),
        locationId: locationSelect ? locationSelect.value : '',
        locationName: selectedOption && selectedOption.value ? selectedOption.textContent : ''
    };
}

function _readWeatherForm() {
    const dailyLimit = parseInt(_getVal('api-weather-daily-limit'), 10);
    // 计数器不是表单字段，从现有配置原样带过去——否则保存天气 Tab 会把当天用量清零
    const quota = _readWeatherQuota();
    return {
        enabled: true,
        provider: 'qweather',
        apiHost: _normalizeQWeatherHost(_getVal('api-weather-host')),
        apiKey: _getVal('api-weather-key').trim(),
        locationPresets: (_weatherDraft && _weatherDraft.locationPresets) || [],
        defaultLocationPresetId: (_weatherDraft && _weatherDraft.defaultLocationPresetId) || '',
        dailyLimit: dailyLimit > 0 ? dailyLimit : 800,
        dailyCount: quota.count,
        dailyCountDate: quota.today
    };
}

function _populateWeatherPresetSelect(selectedId) {
    const select = document.getElementById('api-weather-preset-select');
    if (!select || !_weatherDraft) return;
    select.innerHTML = '<option value="">— 选择地点预设 —</option>';
    _weatherDraft.locationPresets.forEach(preset => {
        const option = document.createElement('option');
        option.value = preset.id;
        option.textContent = preset.name;
        select.appendChild(option);
    });
    select.value = selectedId || _weatherLoadedPresetId || _weatherDraft.defaultLocationPresetId || '';
}

function _setWeatherLocationSelect(location) {
    const select = document.getElementById('api-weather-location-select');
    if (!select) return;
    if (!location || !location.locationId) {
        select.innerHTML = '<option value="">请先查询地点</option>';
        return;
    }
    const label = location.locationName || `${location.locationQuery || '已保存地点'}（${location.locationId}）`;
    select.innerHTML = '';
    const option = document.createElement('option');
    option.value = location.locationId;
    option.textContent = label;
    select.appendChild(option);
}

function _applyWeatherPresetToForm(presetId) {
    const preset = _weatherDraft && _weatherDraft.locationPresets.find(p => p.id === presetId);
    _weatherLoadedPresetId = preset ? preset.id : '';
    _setVal('api-weather-preset-name', preset ? preset.name : '');
    _setChecked('api-weather-set-default', !!preset && preset.id === _weatherDraft.defaultLocationPresetId);
    _setVal('api-weather-city', preset ? (preset.locationQuery || preset.locationName) : '');
    _setWeatherLocationSelect(preset);
    _populateWeatherPresetSelect(_weatherLoadedPresetId);
}

function _syncWeatherPresetFromForm() {
    if (!_weatherDraft) return;
    const location = _getWeatherCurrentLocation();

    // 表单里已选中地点但还没有挂到任何预设：自动创建预设（例如首个地点直接查询后保存）
    if (!_weatherLoadedPresetId && location.locationId) {
        const preset = {
            id: _newWeatherPresetId(),
            name: _getVal('api-weather-preset-name').trim() || location.locationName || location.locationQuery || '默认地点',
            locationId: location.locationId,
            locationName: location.locationName,
            locationQuery: location.locationQuery
        };
        _weatherDraft.locationPresets.push(preset);
        _weatherLoadedPresetId = preset.id;
        if (!_weatherDraft.defaultLocationPresetId || _getChecked('api-weather-set-default')) {
            _weatherDraft.defaultLocationPresetId = preset.id;
        }
        _populateWeatherPresetSelect(preset.id);
        _setVal('api-weather-preset-name', preset.name);
        _setChecked('api-weather-set-default', preset.id === _weatherDraft.defaultLocationPresetId);
        return;
    }

    const preset = _weatherDraft.locationPresets.find(p => p.id === _weatherLoadedPresetId);
    if (!preset) return;
    preset.name = _getVal('api-weather-preset-name').trim() || preset.name;
    preset.locationQuery = location.locationQuery;
    preset.locationId = location.locationId;
    preset.locationName = location.locationName;
    if (_getChecked('api-weather-set-default')) _weatherDraft.defaultLocationPresetId = preset.id;
    else if (_weatherDraft.defaultLocationPresetId === preset.id && _weatherDraft.locationPresets.length > 1) {
        _weatherDraft.defaultLocationPresetId = _weatherDraft.locationPresets.find(p => p.id !== preset.id).id;
    }
}

function _refreshWeatherTabUI() {
    _weatherDraft = _normalizeWeatherSettings(db.weatherSettings);
    _setVal('api-weather-provider', 'qweather');
    _setVal('api-weather-host', _weatherDraft.apiHost);
    _setVal('api-weather-key', _weatherDraft.apiKey);
    _setVal('api-weather-daily-limit', _weatherDraft.dailyLimit);
    _refreshWeatherUsageUI();
    _applyWeatherPresetToForm(_weatherDraft.defaultLocationPresetId || (_weatherDraft.locationPresets[0] || {}).id);
    _setWeatherTestResult('', false, true);
    _clearDirty('weather');
}

function exportWeatherPresets() {
    _syncWeatherPresetFromForm();
    const presets = (_weatherDraft && _weatherDraft.locationPresets) || [];
    if (!presets.length) return showToast('暂无地点预设可导出');
    const blob = new Blob([JSON.stringify(presets, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'api_weather_location_presets.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

function importWeatherPresets() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = function (event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async function () {
            try {
                const data = JSON.parse(reader.result);
                if (!Array.isArray(data)) return await AppUI.alert('文件格式不正确');
                _syncWeatherPresetFromForm();
                let count = 0;
                data.forEach(item => {
                    const normalized = _normalizeWeatherSettings({ locationPresets: [item] }).locationPresets[0];
                    if (!normalized || !normalized.locationId) return;
                    normalized.id = _newWeatherPresetId();
                    const taken = _weatherDraft.locationPresets.map(p => p.name);
                    if (taken.includes(normalized.name)) {
                        let suffix = 2;
                        let name = `${normalized.name}${suffix}`;
                        while (taken.includes(name)) name = `${normalized.name}${++suffix}`;
                        normalized.name = name;
                    }
                    _weatherDraft.locationPresets.push(normalized);
                    count++;
                });
                if (!count) return await AppUI.alert('文件中没有可用的地点预设');
                if (!_weatherDraft.defaultLocationPresetId) {
                    _weatherDraft.defaultLocationPresetId = _weatherDraft.locationPresets[0].id;
                }
                _applyWeatherPresetToForm(_weatherDraft.locationPresets[_weatherDraft.locationPresets.length - 1].id);
                _markDirty('weather');
                showToast(`已导入 ${count} 个地点预设，请保存天气配置`);
            } catch (error) {
                await AppUI.alert('导入失败：' + error.message);
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

function _addWeatherPreset(copyCurrent = false) {
    _syncWeatherPresetFromForm();
    const source = copyCurrent && _weatherDraft.locationPresets.find(p => p.id === _weatherLoadedPresetId);
    const baseName = source ? source.name : '地点预设';
    const taken = _weatherDraft.locationPresets.map(p => p.name);
    let suffix = source ? 2 : 1;
    let name = `${baseName}${suffix}`;
    while (taken.includes(name)) name = `${baseName}${++suffix}`;
    const preset = source
        ? { ...source, id: _newWeatherPresetId(), name }
        : { id: _newWeatherPresetId(), name, locationId: '', locationName: '', locationQuery: '' };
    _weatherDraft.locationPresets.push(preset);
    if (!_weatherDraft.defaultLocationPresetId) _weatherDraft.defaultLocationPresetId = preset.id;
    _applyWeatherPresetToForm(preset.id);
    _markDirty('weather');
}

async function _deleteWeatherPreset() {
    if (!_weatherLoadedPresetId) return showToast('请先选择要删除的地点预设');
    const preset = _weatherDraft.locationPresets.find(p => p.id === _weatherLoadedPresetId);
    if (!preset) return;
    const ok = await AppUI.confirm(`确定删除地点预设「${preset.name}」？`, '删除地点预设', '删除', '取消');
    if (!ok) return;
    _weatherDraft.locationPresets = _weatherDraft.locationPresets.filter(p => p.id !== preset.id);
    if (_weatherDraft.defaultLocationPresetId === preset.id) {
        _weatherDraft.defaultLocationPresetId = (_weatherDraft.locationPresets[0] || {}).id || '';
    }
    _applyWeatherPresetToForm(_weatherDraft.defaultLocationPresetId || (_weatherDraft.locationPresets[0] || {}).id);
    _markDirty('weather');
}

async function saveWeatherApiSettings() {
    _syncWeatherPresetFromForm();
    const settings = _readWeatherForm();
    if (!_isValidQWeatherHost(settings.apiHost)) return showToast('请填写控制台提供的专属 API Host');
    if (!settings.apiKey) return showToast('请填写 API Key');
    if (!settings.locationPresets.some(p => p.locationId)) return showToast('请至少查询并保存一个地点预设');
    if (!settings.defaultLocationPresetId) return showToast('请设置一个全局默认地点');

    window.db.weatherSettings = settings;
    _weatherDraft = _normalizeWeatherSettings(settings);
    await saveGlobalKeys(['weatherSettings']);
    _clearDirty('weather');
    showToast('和风天气配置已保存');
}

function _setWeatherButtonLoading(id, loading) {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.classList.toggle('loading', !!loading);
    btn.disabled = !!loading;
}

function _setWeatherTestResult(message, isError = false, hidden = false) {
    const result = document.getElementById('api-weather-test-result');
    if (!result) return;
    result.textContent = message || '';
    result.hidden = !!hidden;
    result.classList.toggle('is-error', !!isError);
}

function _formatWeatherLocation(item) {
    const parts = [item.name, item.adm2, item.adm1, item.country].filter(Boolean);
    return parts.filter((part, index) => parts.indexOf(part) === index).join(' · ');
}

async function searchWeatherLocations() {
    const apiHost = _normalizeQWeatherHost(_getVal('api-weather-host'));
    const apiKey = _getVal('api-weather-key').trim();
    const query = _getVal('api-weather-city').trim();
    if (!_isValidQWeatherHost(apiHost)) return showToast('请先填写正确的专属 API Host');
    if (!apiKey || !query) return showToast('请先填写 API Key 和城市或地区');
    // GeoAPI 查询同样是一次计费请求
    if (!await _reserveWeatherQuota(1)) return;

    const select = document.getElementById('api-weather-location-select');
    _setWeatherButtonLoading('api-weather-search-btn', true);
    _setWeatherTestResult('', false, true);

    try {
        const payload = await fetchQWeatherCityLookup(apiHost, apiKey, query);
        const locations = Array.isArray(payload.location) ? payload.location : [];
        if (locations.length === 0) throw new Error('未找到匹配地点，请尝试更完整的区县名称');

        select.innerHTML = '<option value="">请选择正确地点</option>';
        locations.forEach(item => {
            const locationId = String(item.id || '').trim();
            if (!locationId) return;
            const option = document.createElement('option');
            option.value = locationId;
            option.textContent = _formatWeatherLocation(item);
            select.appendChild(option);
        });
        if (select.options.length === 1) throw new Error('查询结果缺少可用的 LocationID');

        showToast(`找到 ${select.options.length - 1} 个地点，请选择`);
    } catch (error) {
        if (select) select.innerHTML = '<option value="">地点查询失败</option>';
        _setWeatherTestResult(`地点查询失败：${error.message}`, true);
    } finally {
        _setWeatherButtonLoading('api-weather-search-btn', false);
    }
}

function _applySelectedWeatherLocation() {
    const select = document.getElementById('api-weather-location-select');
    if (!select || !select.value) return;
    _setWeatherTestResult('', false, true);
    _markDirty('weather');
}

function _formatCurrentWeather(payload, configuredName) {
    const now = payload.now || {};
    return [
        `地点：${configuredName || '已配置地点'}`,
        `观测时间：${now.obsTime || '未知'}`,
        `天气：${now.text || '未知'}`,
        `温度：${now.temp === undefined ? '未知' : `${now.temp}℃`}`,
        `体感：${now.feelsLike === undefined ? '未知' : `${now.feelsLike}℃`}`,
        `湿度：${now.humidity === undefined ? '未知' : `${now.humidity}%`}`,
        `风：${now.windDir || '未知'} ${now.windScale === undefined ? '' : `${now.windScale}级`} ${now.windSpeed === undefined ? '' : `${now.windSpeed} km/h`}`.trim(),
        `降水量：${now.precip === undefined ? '未知' : `${now.precip} mm`}`,
        `气压：${now.pressure === undefined ? '未知' : `${now.pressure} hPa`}`,
        `能见度：${now.vis === undefined ? '未知' : `${now.vis} km`}`,
        `云量：${now.cloud === undefined ? '未知' : `${now.cloud}%`}`,
        `露点：${now.dew === undefined ? '未知' : `${now.dew}℃`}`
    ].join('\n');
}

async function testWeatherApi() {
    const settings = _readWeatherForm();
    const location = _getWeatherCurrentLocation();
    if (!_isValidQWeatherHost(settings.apiHost)) return showToast('请先填写正确的专属 API Host');
    if (!settings.apiKey) return showToast('请先填写 API Key');
    if (!location.locationId) return showToast('请先查询并选择本次测试地点');
    // 测试也是一次真实请求，同样计数、同样受上限约束
    if (!await _reserveWeatherQuota(1)) return;

    _setWeatherButtonLoading('api-weather-test-btn', true);
    _setWeatherTestResult('正在获取实况天气…');

    try {
        const payload = await fetchQWeatherNow(settings.apiHost, settings.apiKey, location.locationId);
        if (!payload.now) throw new Error('接口未返回实况数据');
        _setWeatherTestResult(_formatCurrentWeather(payload, location.locationName || location.locationQuery));
    } catch (error) {
        _setWeatherTestResult(`实况测试失败：${error.message}`, true);
    } finally {
        _setWeatherButtonLoading('api-weather-test-btn', false);
    }
}

function initWeatherApiTab() {
    _refreshWeatherTabUI();
    // 用量显示交给 api 层通知：聊天里记的账也能让这一行跟着变，
    // 而 api 层不需要知道"设置页有个 span"（原先是 _addWeatherUsage 直接戳 DOM）
    onWeatherUsageChange(_refreshWeatherUsageUI);
    _on('api-weather-search-btn', searchWeatherLocations);
    _on('api-weather-test-btn', testWeatherApi);
    _on('api-weather-save-btn', saveWeatherApiSettings);
    _on('api-weather-add-preset', () => _addWeatherPreset(false));
    _on('api-weather-copy-preset', () => _addWeatherPreset(true));
    _on('api-weather-del-preset', _deleteWeatherPreset);
    _on('api-weather-import-preset', importWeatherPresets);
    _on('api-weather-export-preset', exportWeatherPresets);

    const presetSelect = document.getElementById('api-weather-preset-select');
    if (presetSelect) presetSelect.addEventListener('change', () => {
        _syncWeatherPresetFromForm();
        _applyWeatherPresetToForm(presetSelect.value);
        _clearDirty('weather');
    });

    const locationSelect = document.getElementById('api-weather-location-select');
    if (locationSelect) locationSelect.addEventListener('change', _applySelectedWeatherLocation);

    const cityInput = document.getElementById('api-weather-city');
    if (cityInput) cityInput.addEventListener('input', () => {
        if (!locationSelect || !locationSelect.value) return;
        locationSelect.innerHTML = '<option value="">城市已修改，请重新查询地点</option>';
        _setWeatherTestResult('', false, true);
    });

    _watchDirty('weather', [
        'api-weather-provider', 'api-weather-host', 'api-weather-key',
        'api-weather-preset-name', 'api-weather-set-default', 'api-weather-city',
        'api-weather-location-select', 'api-weather-daily-limit'
    ]);
}

// ============================================================
// 语音 API 设置 Tab（豆包音频生成）
// ============================================================
// 凭据、请求、错误码转人话、按秒配额记账都在 js/api/doubao_tts_api.js，
// 本段只管这个 tab 的表单读写和试听。聊天里怎么用语音见
// js/chat/chat_voice_service.js —— 两边都只依赖 api 层，互不依赖。
//
// 这个 tab 不走 API_TAB_DEFS 那套预设引擎（那是给"URL + Key + 模型"三件套设计的），
// 但它自己有一套音色预设，形状和天气的地点预设一模一样，所以照天气那份手写。
//
// ★ 音频格式 / 采样率 / 并发不在这里 —— 它们是 doubao_tts_api.js 里的常量。
// ★ 总开关和「收到就自动合成」不在这里 —— 在聊天列表侧边栏的语音弹窗里。
//   但它们的数据同样存在 db.voiceSettings，所以 _readVoiceForm 必须把这两个字段
//   从现有配置原样带过去，否则保存这个 tab 会把总开关关掉。
// ★ 归档仓库不在这里 —— 在设置页的「GitHub 仓库」screen（db.githubBindings.voice）。

let _voiceDraft = null;
let _voiceLoadedPresetId = '';

/** 语音 Tab 上的今日用量（由 api 层的用量回调驱动） */
function _refreshVoiceUsageUI() {
    const el = document.getElementById('api-voice-usage-display');
    if (!el) return;
    const { limit, used } = _readVoiceQuota();
    // 秒数是小数，显示取一位；配额本身按 0.01 秒记账，这里只是好看
    el.textContent = limit > 0
        ? `今日已用 ${used.toFixed(1)} / 上限 ${limit} 秒`
        : `今日已用 ${used.toFixed(1)} 秒（未设上限）`;
    el.classList.toggle('is-over-limit', limit > 0 && used >= limit);
}

/**
 * 把表单读成一份完整配置。
 * ★ 这四个字段不是本 tab 的表单项，必须从现有配置原样带过去，否则一保存就被清掉：
 *   dailySecondUsed / dailyCountDate（用量计数器，清零则配额形同虚设）
 *   enabled / autoSynthesize（归聊天列表那个弹窗管，清掉等于悄悄把语音关了）
 */
function _readVoiceForm() {
    const quota = _readVoiceQuota();
    const current = _normalizeVoiceSettings(db.voiceSettings);
    return _normalizeVoiceSettings({
        enabled: current.enabled,
        autoSynthesize: current.autoSynthesize,
        apiKey: _getVal('api-voice-key').trim(),
        maxTextChars: parseInt(_getVal('api-voice-max-chars'), 10),
        dailySecondLimit: parseInt(_getVal('api-voice-daily-limit'), 10),
        cacheLimitMB: parseInt(_getVal('api-voice-cache-limit'), 10),
        dailySecondUsed: quota.used,
        dailyCountDate: quota.used > 0 ? quota.today : '',
        voicePresets: (_voiceDraft && _voiceDraft.voicePresets) || []
    });
}

// ── 音色预设 ─────────────────────────────────────────────────

function _populateVoiceProviderSelect() {
    const select = document.getElementById('api-voice-provider');
    if (!select || select.options.length) return;   // 只填一次
    VOICE_PROVIDERS.forEach(p => {
        const option = document.createElement('option');
        option.value = p.value;
        option.textContent = p.label;
        select.appendChild(option);
    });
}

function _populateVoicePresetSelect(selectedId) {
    const select = document.getElementById('api-voice-preset-select');
    if (!select || !_voiceDraft) return;
    select.innerHTML = '<option value="">— 选择音色预设 —</option>';
    _voiceDraft.voicePresets.forEach(preset => {
        const option = document.createElement('option');
        option.value = preset.id;
        // 带上服务商，否则一堆预设分不清哪个是哪家的
        option.textContent = `${preset.name} · ${voiceProviderLabel(preset.provider)}`;
        select.appendChild(option);
    });
    select.value = selectedId || _voiceLoadedPresetId || (_voiceDraft.voicePresets[0] || {}).id || '';
}

function _applyVoicePresetToForm(presetId) {
    const preset = _voiceDraft && _voiceDraft.voicePresets.find(p => p.id === presetId);
    _voiceLoadedPresetId = preset ? preset.id : '';
    _setVal('api-voice-preset-name', preset ? preset.name : '');
    _setVal('api-voice-provider', preset ? preset.provider : 'doubao');
    _setVal('api-voice-speaker', preset ? preset.speakerId : '');
    _setVal('api-voice-desc', preset ? preset.description : '');
    _setVal('api-voice-rate-speech', preset ? preset.rates.speech : 0);
    _setVal('api-voice-rate-pitch', preset ? preset.rates.pitch : 0);
    _setVal('api-voice-rate-loudness', preset ? preset.rates.loudness : 0);
    _populateVoicePresetSelect(_voiceLoadedPresetId);
}

/** 从表单读出当前正在编辑的那条预设（不落库，只是取值） */
function _readVoicePresetFromForm() {
    return _normalizeVoicePreset({
        id: _voiceLoadedPresetId,
        name: _getVal('api-voice-preset-name').trim(),
        provider: _getVal('api-voice-provider'),
        speakerId: _getVal('api-voice-speaker').trim(),
        description: _getVal('api-voice-desc').trim(),
        rates: {
            speech: parseInt(_getVal('api-voice-rate-speech'), 10),
            pitch: parseInt(_getVal('api-voice-rate-pitch'), 10),
            loudness: parseInt(_getVal('api-voice-rate-loudness'), 10)
        }
    });
}

/**
 * 把表单上的编辑写回草稿。切换预设、新增、删除、保存前都要先调它，
 * 否则用户改完某条预设直接切走，改动就丢了。
 */
function _syncVoicePresetFromForm() {
    if (!_voiceDraft) return;
    const edited = _readVoicePresetFromForm();

    // 表单里填了音色但还没挂到任何预设：自动建一条（第一次用的时候会走到这儿）
    if (!_voiceLoadedPresetId && edited.speakerId) {
        const preset = { ...edited, id: _newVoicePresetId(), name: edited.name || '音色预设1' };
        _voiceDraft.voicePresets.push(preset);
        _voiceLoadedPresetId = preset.id;
        _populateVoicePresetSelect(preset.id);
        _setVal('api-voice-preset-name', preset.name);
        return;
    }

    const index = _voiceDraft.voicePresets.findIndex(p => p.id === _voiceLoadedPresetId);
    if (index < 0) return;
    const old = _voiceDraft.voicePresets[index];
    _voiceDraft.voicePresets[index] = { ...edited, name: edited.name || old.name };
}

function _addVoicePreset(copyCurrent = false) {
    _syncVoicePresetFromForm();
    const source = copyCurrent && _voiceDraft.voicePresets.find(p => p.id === _voiceLoadedPresetId);
    const baseName = source ? source.name : '音色预设';
    const taken = _voiceDraft.voicePresets.map(p => p.name);
    let suffix = source ? 2 : 1;
    let name = `${baseName}${suffix}`;
    while (taken.includes(name)) name = `${baseName}${++suffix}`;
    const preset = source
        ? { ...source, id: _newVoicePresetId(), name }
        : _normalizeVoicePreset({ id: _newVoicePresetId(), name });
    _voiceDraft.voicePresets.push(preset);
    _applyVoicePresetToForm(preset.id);
    _markDirty('voice');
}

async function _deleteVoicePreset() {
    if (!_voiceLoadedPresetId) return showToast('请先选择要删除的音色预设');
    const preset = _voiceDraft.voicePresets.find(p => p.id === _voiceLoadedPresetId);
    if (!preset) return;

    // 有角色正在用这条预设的话，删了就直接不出声了（没有默认音色可以退回）—— 先说清楚
    // 群成员里没关联角色的那些音色存在成员自己身上，也要数进来
    let inUse = (db.characters || []).filter(c => c && c.voicePresetId === preset.id).length;
    (db.groups || []).forEach(g => {
        (g.members || []).forEach(m => {
            if (m && !m.originalCharId && m.voicePresetId === preset.id) inUse++;
        });
    });
    const warn = inUse
        ? `\n\n有 ${inUse} 个角色/成员正在使用它，删除后他们将不再出语音。`
        : '';
    const ok = await AppUI.confirm(
        `确定删除音色预设「${preset.name}」？${warn}`, '删除音色预设', '删除', '取消');
    if (!ok) return;

    _voiceDraft.voicePresets = _voiceDraft.voicePresets.filter(p => p.id !== preset.id);
    _applyVoicePresetToForm((_voiceDraft.voicePresets[0] || {}).id);
    _markDirty('voice');
}

function exportVoicePresets() {
    _syncVoicePresetFromForm();
    const presets = (_voiceDraft && _voiceDraft.voicePresets) || [];
    if (!presets.length) return showToast('暂无音色预设可导出');
    const blob = new Blob([JSON.stringify(presets, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'api_voice_presets.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

function importVoicePresets() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = function (event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async function () {
            try {
                const data = JSON.parse(reader.result);
                if (!Array.isArray(data)) return await AppUI.alert('文件格式不正确');
                _syncVoicePresetFromForm();
                let count = 0;
                data.forEach(item => {
                    const normalized = _normalizeVoicePreset(item);
                    if (!normalized.speakerId) return;   // 没音色 ID 的条目没意义
                    normalized.id = _newVoicePresetId();
                    const taken = _voiceDraft.voicePresets.map(p => p.name);
                    if (taken.includes(normalized.name)) {
                        let suffix = 2;
                        let name = `${normalized.name}${suffix}`;
                        while (taken.includes(name)) name = `${normalized.name}${++suffix}`;
                        normalized.name = name;
                    }
                    _voiceDraft.voicePresets.push(normalized);
                    count++;
                });
                if (!count) return await AppUI.alert('文件中没有可用的音色预设');
                _applyVoicePresetToForm(
                    _voiceDraft.voicePresets[_voiceDraft.voicePresets.length - 1].id);
                _markDirty('voice');
                showToast(`已导入 ${count} 个音色预设，请保存语音配置`);
            } catch (error) {
                await AppUI.alert('导入失败：' + error.message);
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

/** 把已保存配置铺回表单（每次打开页面调用） */
function _refreshVoiceTabUI() {
    _voiceDraft = _normalizeVoiceSettings(db.voiceSettings);
    _populateVoiceProviderSelect();
    _setVal('api-voice-key', _voiceDraft.apiKey);
    _setVal('api-voice-max-chars', _voiceDraft.maxTextChars);
    _setVal('api-voice-daily-limit', _voiceDraft.dailySecondLimit);
    _setVal('api-voice-cache-limit', _voiceDraft.cacheLimitMB);
    _refreshVoiceUsageUI();
    _applyVoicePresetToForm((_voiceDraft.voicePresets[0] || {}).id);
    _setVoiceTestResult('', false, true);
    _clearDirty('voice');
}

function _setVoiceButtonLoading(id, loading) {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.classList.toggle('loading', loading);
    btn.disabled = loading;
}

function _setVoiceTestResult(message, isError = false, hidden = false) {
    const el = document.getElementById('api-voice-test-result');
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('is-error', !!isError);
    el.hidden = !!hidden || !message;
}

// 上一次试听生成的 blob URL。必须留着句柄，不然每试听一次就漏一个 URL，
// 页面不刷新的话这些 blob 永远不会被回收。
let _voicePreviewUrl = '';

function _clearVoicePreviewAudio() {
    const player = document.getElementById('api-voice-preview-player');
    if (player) {
        player.pause();
        player.removeAttribute('src');
        player.hidden = true;
    }
    if (_voicePreviewUrl) {
        URL.revokeObjectURL(_voicePreviewUrl);
        _voicePreviewUrl = '';
    }
}

/**
 * 试听。用表单里的草稿配置发请求（不要求先保存），这样改完参数能立刻听效果。
 * ★ 这是一次真实合成，同样计入配额、同样受上限约束 —— 走 synthesizeVoice
 *   内部那道闸门，这里不自己扣。
 */
async function previewVoiceSynthesis() {
    const settings = _readVoiceForm();
    // 试听用表单上正在编辑的那条预设，不要求先保存，改完立刻能听
    const preset = _readVoicePresetFromForm();
    const text = _getVal('api-voice-preview-text').trim();

    if (!settings.apiKey) return showToast('请先填写语音 API Key');
    if (!preset.speakerId) return showToast('请先填写音色 ID');
    if (!text) return showToast('请先填写试听文本');

    _clearVoicePreviewAudio();
    _setVoiceButtonLoading('api-voice-preview-btn', true);
    _setVoiceTestResult('正在合成，一次要 20 秒以上，请稍等…');

    try {
        const result = await synthesizeVoice({ text, profile: preset, settings });

        const kb = (result.bytes.byteLength / 1024).toFixed(1);
        _setVoiceTestResult(
            `合成成功：${result.originalDuration.toFixed(2)} 秒 / ${kb} KB\n` +
            `实际发给模型的提示词：\n${result.prompt}`
        );

        _voicePreviewUrl = URL.createObjectURL(new Blob([result.bytes], { type: result.mime }));
        const player = document.getElementById('api-voice-preview-player');
        if (player) {
            player.src = _voicePreviewUrl;
            player.hidden = false;
            player.play().catch(() => { /* 浏览器拦了自动播放就让用户自己点 */ });
        }
    } catch (error) {
        // 超额被拦时 api 层已经弹过 toast 了，这里只补一行说明，不重复报错
        _setVoiceTestResult(
            error.quotaBlocked ? '已达今日合成上限，试听取消' : error.message,
            true
        );
    } finally {
        _setVoiceButtonLoading('api-voice-preview-btn', false);
    }
}

async function saveVoiceApiSettings() {
    _syncVoicePresetFromForm();
    const settings = _readVoiceForm();

    if (!settings.apiKey) return showToast('请填写语音 API Key');
    // 允许零预设保存（用户可能只想先把 Key 存下来），但有预设就必须填音色 ID，
    // 否则会存下一条永远合成失败的预设，而失败要等到聊天里才暴露
    const broken = settings.voicePresets.filter(p => !p.speakerId);
    if (broken.length) {
        return showToast(`音色预设「${broken[0].name}」还没填音色 ID`);
    }

    db.voiceSettings = settings;
    _voiceDraft = _normalizeVoiceSettings(settings);
    await saveGlobalKeys(['voiceSettings']);
    _refreshVoiceUsageUI();
    _clearDirty('voice');
    // 填了 Key / 建了预设都会改变聊天列表侧边栏那一行的状态文案（"缺 API Key" → "自动合成"）
    if (typeof refreshChatSidebarVoiceDisplay === 'function') refreshChatSidebarVoiceDisplay();
    showToast('语音配置已保存');
}

function initVoiceApiTab() {
    _refreshVoiceTabUI();
    // 用量显示交给 api 层通知：聊天里后台自动合成记的账也能让这一行跟着变，
    // 而 api 层不需要知道"设置页有个 span"
    onVoiceUsageChange(_refreshVoiceUsageUI);
    _on('api-voice-preview-btn', previewVoiceSynthesis);
    _on('api-voice-save-btn', saveVoiceApiSettings);
    _on('api-voice-add-preset', () => _addVoicePreset(false));
    _on('api-voice-copy-preset', () => _addVoicePreset(true));
    _on('api-voice-del-preset', _deleteVoicePreset);
    _on('api-voice-import-preset', importVoicePresets);
    _on('api-voice-export-preset', exportVoicePresets);

    // 切预设前先把当前编辑写回草稿，否则改完直接切走改动就丢了
    const presetSelect = document.getElementById('api-voice-preset-select');
    if (presetSelect) presetSelect.addEventListener('change', () => {
        _syncVoicePresetFromForm();
        _applyVoicePresetToForm(presetSelect.value);
        _clearVoicePreviewAudio();
        _setVoiceTestResult('', false, true);
        _clearDirty('voice');
    });

    _watchDirty('voice', [
        'api-voice-key', 'api-voice-preset-name',
        'api-voice-provider', 'api-voice-speaker', 'api-voice-desc',
        'api-voice-rate-speech', 'api-voice-rate-pitch', 'api-voice-rate-loudness',
        'api-voice-max-chars', 'api-voice-daily-limit', 'api-voice-cache-limit'
    ]);
}

// ============================================================
// 图像 API 设置 Tab (UI 交互及表单读写)
// ============================================================

let _imageDraft = null;
let _imageLoadedPresetId = '';
let _currentPreviewImage = null;
let _imagePreviewAbortController = null;

function _setImageDownloadEnabled(enabled) {
    const btn = document.getElementById('api-image-download-btn');
    if (!btn) return;
    btn.disabled = !enabled;
    btn.classList.toggle('btn-neutral', !enabled);
    btn.classList.toggle('btn-secondary', !!enabled);
}

/**
 * 生成中状态切换。下载与取消共用同一个槽位（生成中没有新图可下载，
 * 没在生成也不需要取消，二者永远不会同时出现）：
 *   生成中：测试生成转圈禁用，下载换成取消（立即可点，不等慢请求提醒）
 *   平时  ：测试生成可用，取消换回下载
 */
function _setImageGenerating(generating) {
    const previewBtn  = document.getElementById('api-image-preview-btn');
    const downloadBtn = document.getElementById('api-image-download-btn');
    const cancelBtn   = document.getElementById('api-image-cancel-btn');
    if (previewBtn) {
        previewBtn.classList.toggle('loading', !!generating);
        previewBtn.disabled = !!generating;
    }
    if (downloadBtn) downloadBtn.hidden = !!generating;
    if (cancelBtn) {
        cancelBtn.hidden = !generating;
        cancelBtn.disabled = !generating;
    }
}

function _clearImagePreview({ abortRequest = false, clearResult = false } = {}) {
    if (abortRequest && _imagePreviewAbortController) {
        _imagePreviewAbortController.abort();
        _imagePreviewAbortController = null;
    }
    if (_currentPreviewImage && _currentPreviewImage.objectUrl) {
        URL.revokeObjectURL(_currentPreviewImage.objectUrl);
    }
    _currentPreviewImage = null;

    const img = document.getElementById('api-image-preview-img');
    const container = document.getElementById('api-image-preview-container');
    if (img) img.removeAttribute('src');
    if (container) container.hidden = true;
    _setImageDownloadEnabled(false);
    _setImageGenerating(false);
    if (clearResult) _setImageTestResult('', false, true);
}

function _updateImageDefaultToggle() {
    const toggle = document.getElementById('api-image-set-default');
    if (!toggle) return;
    const hasPreset = !!(_imageDraft && _imageLoadedPresetId &&
        _imageDraft.imagePresets.some(p => p.id === _imageLoadedPresetId));
    toggle.disabled = !hasPreset;
    toggle.checked = hasPreset && _imageDraft.defaultPresetId === _imageLoadedPresetId;
}

function _uniqueImagePresetName(rawName, takenNames) {
    const base = String(rawName || '生图预设').trim() || '生图预设';
    const taken = takenNames instanceof Set ? takenNames : new Set(takenNames || []);
    if (!taken.has(base)) return base;
    let suffix = 2;
    while (taken.has(`${base}${suffix}`)) suffix++;
    return `${base}${suffix}`;
}

function _populateImageProviderSelect() {
    const select = document.getElementById('api-image-provider');
    if (!select || select.options.length) return; 
    IMAGE_PROVIDERS.forEach(p => {
        const option = document.createElement('option');
        option.value = p.value;
        option.textContent = p.label;
        select.appendChild(option);
    });
}

function _populateImagePresetSelect(selectedId) {
    const select = document.getElementById('api-image-preset-select');
    if (!select || !_imageDraft) return;
    select.innerHTML = '<option value="">— 选择生图预设 —</option>';
    _imageDraft.imagePresets.forEach(preset => {
        const option = document.createElement('option');
        option.value = preset.id;
        const defaultLabel = preset.id === _imageDraft.defaultPresetId ? ' · 全局默认' : '';
        option.textContent = `${preset.name} · ${imageProviderLabel(preset.provider)}${defaultLabel}`;
        select.appendChild(option);
    });
    select.value = selectedId || _imageLoadedPresetId || _imageDraft.defaultPresetId || '';
}

/**
 * 模型下拉框写入值：值不在现有选项里时补一个 option 再选中。
 * （旧代码是文本框，直接 _setVal；换成 select 后必须保证选项存在，否则 value 会被吞掉）
 */
function _setImageModelSelectValue(model) {
    const sel = document.getElementById('api-image-model');
    if (!sel) return;
    const value = String(model || '').trim();
    if (!value) {
        sel.innerHTML = '<option value="">请先拉取模型列表</option>';
        return;
    }
    if (!Array.from(sel.options).some(o => o.value === value)) {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = value;
        sel.appendChild(opt);
    }
    sel.value = value;
}

function _applyImagePresetToForm(presetId) {
    const preset = _imageDraft && _imageDraft.imagePresets.find(p => p.id === presetId);
    _imageLoadedPresetId = preset ? preset.id : '';

    _setVal('api-image-preset-name', preset ? preset.name : '');
    const providerEl = document.getElementById('api-image-provider');
    if (providerEl) providerEl.value = preset ? preset.provider : 'openai';

    // API URL 和 Key 直接从预设里读出，赋给表单
    _setVal('api-image-url', preset ? preset.apiUrl : '');
    _setVal('api-image-key', preset ? preset.apiKey : '');

    _setImageModelSelectValue(preset ? preset.model : 'dall-e-3');
    _setVal('api-image-size', preset ? preset.size : '1024x1024');
    _setVal('api-image-quality', preset ? preset.quality : 'standard');
    _setVal('api-image-style', preset ? preset.style : 'vivid');

    _updateImageDefaultToggle();
    _populateImagePresetSelect(_imageLoadedPresetId);
}

function _readImagePresetFromForm() {
    return _normalizeImagePreset({
        id: _imageLoadedPresetId,
        name: _getVal('api-image-preset-name').trim(),
        provider: _getVal('api-image-provider') || 'openai',
        // URL 和 Key 一并保存进预设里
        apiUrl: _getVal('api-image-url').trim(),
        apiKey: _getVal('api-image-key').trim(),
        model: _getVal('api-image-model').trim(),
        size: _getVal('api-image-size'),
        quality: _getVal('api-image-quality'),
        style: _getVal('api-image-style')
    });
}

function _syncImagePresetFromForm({ createIfMissing = false } = {}) {
    if (!_imageDraft) return;
    const edited = _readImagePresetFromForm();

    // 空白页只有在明确保存时才自动建立第一条，避免“新增预设”一次产生两条。
    if (!_imageLoadedPresetId && createIfMissing && edited.model) {
        const preset = { ...edited, id: _newImagePresetId(), name: edited.name || '默认生图' };
        _imageDraft.imagePresets.push(preset);
        _imageLoadedPresetId = preset.id;
        _populateImagePresetSelect(preset.id);
        _setVal('api-image-preset-name', preset.name);
        _updateImageDefaultToggle();
        return;
    }

    const index = _imageDraft.imagePresets.findIndex(p => p.id === _imageLoadedPresetId);
    if (index < 0) return;
    _imageDraft.imagePresets[index] = { ...edited, name: edited.name || _imageDraft.imagePresets[index].name };
    if (_getChecked('api-image-set-default')) {
        _imageDraft.defaultPresetId = _imageLoadedPresetId;
    } else if (_imageDraft.defaultPresetId === _imageLoadedPresetId) {
        _imageDraft.defaultPresetId = '';
    }
}

function _addImagePreset(copyCurrent = false) {
    _syncImagePresetFromForm();
    const source = copyCurrent && _imageDraft.imagePresets.find(p => p.id === _imageLoadedPresetId);
    const baseName = source ? source.name : '生图预设';
    const name = _uniqueImagePresetName(baseName, _imageDraft.imagePresets.map(p => p.name));
    
    const preset = source 
        ? { ...source, id: _newImagePresetId(), name }
        : _normalizeImagePreset({ id: _newImagePresetId(), name });
        
    _imageDraft.imagePresets.push(preset);
    _applyImagePresetToForm(preset.id);
    _markDirty('image');
}

async function _deleteImagePreset() {
    if (!_imageLoadedPresetId) return showToast('请先选择要删除的预设');
    const preset = _imageDraft.imagePresets.find(p => p.id === _imageLoadedPresetId);
    if (!preset) return;
    
    const defaultWarning = _imageDraft.defaultPresetId === preset.id
        ? '\n\n它当前是全局默认，删除后全局默认将清空。'
        : '';
    const ok = await AppUI.confirm(`确定删除预设「${preset.name}」？${defaultWarning}`, '删除预设', '删除', '取消');
    if (!ok) return;

    _imageDraft.imagePresets = _imageDraft.imagePresets.filter(p => p.id !== preset.id);
    if (_imageDraft.defaultPresetId === preset.id) _imageDraft.defaultPresetId = '';
    _applyImagePresetToForm((_imageDraft.imagePresets[0] || {}).id);
    _markDirty('image');
}

function _refreshImageTabUI() {
    _clearImagePreview({ abortRequest: true, clearResult: true });
    _imageDraft = _normalizeImageSettings(db.imageSettings);
    _populateImageProviderSelect(); 
    _setVal('api-image-cache-limit', _imageDraft.localCacheLimitMB);
    // 不再从根节点加载 url 和 key，交给 _applyImagePresetToForm 按预设填充
    _applyImagePresetToForm(_imageDraft.defaultPresetId || (_imageDraft.imagePresets[0] || {}).id);

    _clearDirty('image');
}

function _setImageTestResult(message, isError = false, hidden = false) {
    const el = document.getElementById('api-image-test-result');
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('is-error', !!isError);
    el.hidden = !!hidden || !message;
}

/**
 * 拉取生图模型列表（OpenAI 兼容的 /models 端点），逻辑对齐文字 tab 的 fetchModels：
 * 成功填充下拉框；失败弹 AppUI.prompt 允许手动填写。
 * 注意：预设里已选的模型即使不在拉取结果中也保留并维持选中，
 *       防止"拉一次列表"就把当前预设的模型悄悄换成了列表第一项。
 */
async function fetchImageModels() {
    let url = _getVal('api-image-url').trim();
    const key = _getVal('api-image-key').trim();
    const btn = document.getElementById('api-image-fetch-btn');
    const modelSel = document.getElementById('api-image-model');

    if (!url || !key) return showToast('请先填写 API 地址和密钥！');
    if (url.endsWith('/')) url = url.slice(0, -1);

    // 与文字 tab 同一套规则：URL 已带 /vN 就直接拼 /models，否则补 /v1
    const endpoint = /\/v\d+$/.test(url) ? `${url}/models` : `${url}/v1/models`;

    btn.classList.add('loading');
    btn.disabled = true;

    try {
        const res = await fetch(endpoint, { method: 'GET', headers: { Authorization: `Bearer ${key}` } });
        if (!res.ok) {
            const err = new Error(`网络响应错误: ${res.status}`);
            err.response = res;
            throw err;
        }
        const json = await res.json();
        const models = Array.isArray(json.data) ? json.data.map(e => e.id).filter(Boolean) : [];
        if (!models.length) throw new Error('接口未返回任何模型数据');

        const current = modelSel.value;
        if (current && !models.includes(current)) models.push(current);
        modelSel.innerHTML = '';
        models.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m; opt.textContent = m;
            modelSel.appendChild(opt);
        });
        if (current) modelSel.value = current;
        showToast('模型列表拉取成功！');

        btn.classList.remove('loading');
        btn.disabled = false;

    } catch (ex) {
        btn.classList.remove('loading');
        btn.disabled = false;

        const manualModel = await AppUI.prompt(
            `自动拉取失败: ${ex.message}\n企业级接口通常不支持拉取，请直接手动填写。`,
            '例如: dall-e-3',   // placeholder
            '手动输入模型',      // title
            '确定添加',          // confirmText
            '取消'              // cancelText
        );

        if (manualModel && manualModel.trim() !== '') {
            const m = manualModel.trim();
            modelSel.innerHTML = '';
            const opt = document.createElement('option');
            opt.value = m; opt.textContent = m;
            modelSel.appendChild(opt);
            modelSel.value = m;

            // 代码改值不触发事件，手动 dispatch 让 _watchDirty 点亮保存按钮
            modelSel.dispatchEvent(new Event('change', { bubbles: true }));
            showToast('已手动添加模型：' + m);
        } else {
            if (typeof showApiError === 'function') {
                showApiError(ex);
            } else {
                showToast('拉取失败，且未输入模型');
            }
            modelSel.innerHTML = '<option value="">拉取失败，请重新获取或手动填写</option>';
        }
    }
}

/** 测试预览（委托到底层 API，UI 层只管显示 loading 和图片） */
async function previewImageGeneration() {
    _syncImagePresetFromForm();
    const preset = _readImagePresetFromForm();
    const prompt = _getVal('api-image-preview-text').trim();

    if (!preset.apiKey) return showToast('请填写生图 API Key');
    if (!preset.model) return showToast('请填写模型名称');
    if (!prompt) return showToast('请输入测试提示词');

    const imgContainer = document.getElementById('api-image-preview-container');
    const imgEl = document.getElementById('api-image-preview-img');

    _clearImagePreview({ abortRequest: true, clearResult: false });
    const requestController = new AbortController();
    _imagePreviewAbortController = requestController;

    // 生成一开始就把下载槽位换成取消，不用等慢请求提醒才出现
    _setImageGenerating(true);

    _setImageTestResult('正在生成图像，通常需要 10~30 秒，请稍候...');
    imgContainer.hidden = true;

    try {
        const result = await generateImage({
            prompt: prompt,
            preset: preset,
            signal: requestController.signal,
            slowAfterMs: 120000,
            onSlow: ({ elapsedMs }) => {
                if (_imagePreviewAbortController !== requestController || requestController.signal.aborted) return;
                const seconds = Math.round(elapsedMs / 1000);
                _setImageTestResult(`已经等待 ${seconds} 秒，接口可能仍在处理。你可以继续等待，也可以点击“取消生成”。`);
            }
        });

        // 如果用户已经离开图像页，旧请求即使晚到也不能重新改写预览。
        if (_imagePreviewAbortController !== requestController || requestController.signal.aborted) return;
        const objectUrl = URL.createObjectURL(new Blob([result.bytes], { type: result.mime }));
        _currentPreviewImage = { objectUrl, bytes: result.bytes, mime: result.mime };

        _setImageTestResult('生成成功！');
        imgEl.src = objectUrl;
        imgContainer.hidden = false;
        _setImageDownloadEnabled(true);

    } catch (error) {
        const stillCurrent = _imagePreviewAbortController === requestController;
        if (stillCurrent && error && error.name !== 'AbortError') {
            _setImageTestResult(`生图失败: ${error.message}`, true);
        }
    } finally {
        if (_imagePreviewAbortController === requestController) {
            _imagePreviewAbortController = null;
            _setImageGenerating(false);
        }
    }
}

async function saveImageApiSettings() {
    _syncImagePresetFromForm({ createIfMissing: true });
    
    if (!_imageDraft.imagePresets.length && _getVal('api-image-model')) {
        _addImagePreset(false);
    }

    const legacySettings = db.imageSettings || {};
    const normalizedPresets = _imageDraft.imagePresets.map(p => _normalizeImagePreset(p));
    const defaultPresetId = normalizedPresets.some(p => p.id === _imageDraft.defaultPresetId)
        ? _imageDraft.defaultPresetId
        : '';

    const finalSettings = {
        // 旧字段只原样保留作兼容，不再随着当前编辑预设漂移。
        apiUrl: String(legacySettings.apiUrl || '').trim(),
        apiKey: String(legacySettings.apiKey || '').trim(),
        imagePresets: normalizedPresets,
        defaultPresetId,
        localCacheLimitMB: (() => {
            const raw = _getVal('api-image-cache-limit').trim();
            if (!raw) return Number(_imageDraft.localCacheLimitMB) >= 0 ? Number(_imageDraft.localCacheLimitMB) : 10;
            const value = Number(raw);
            return Number.isFinite(value) && value >= 0 ? value : 10;
        })()
    };

    // 检查是否所有预设都没填 Key
    if (!normalizedPresets.some(p => p.apiKey)) return showToast('请至少为一个预设填写 API Key');

    db.imageSettings = finalSettings;
    await saveGlobalKeys(['imageSettings']);
    if (typeof enforceImageCacheLimit === 'function') {
        await enforceImageCacheLimit(finalSettings.localCacheLimitMB);
    }
    _imageDraft = _normalizeImageSettings(finalSettings);
    _applyImagePresetToForm(_imageLoadedPresetId || (_imageDraft.imagePresets[0] || {}).id);
    _clearDirty('image');
    showToast(defaultPresetId ? '图像配置已保存' : '图像配置已保存，但尚未设置全局默认');
}

function initImageApiTab() {
    _refreshImageTabUI();

    _on('api-image-fetch-btn', fetchImageModels);
    _on('api-image-preview-btn', previewImageGeneration);
    _on('api-image-cancel-btn', () => {
        const controller = _imagePreviewAbortController;
        if (!controller) return;
        _setImageTestResult('已取消生图请求。');
        controller.abort();
    });
    _on('api-image-download-btn', () => {
        if (!_currentPreviewImage) return;
        const a = document.createElement('a');
        a.href = _currentPreviewImage.objectUrl;
        a.download = `生成图片_${Date.now()}.${imageMimeExtension(_currentPreviewImage.mime)}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
    });
    _on('api-image-save-btn', saveImageApiSettings);
    _on('api-image-add-preset', () => _addImagePreset(false));
    _on('api-image-copy-preset', () => _addImagePreset(true));
    _on('api-image-del-preset', _deleteImagePreset);

    // 极简版导入导出
    _on('api-image-export-preset', async () => {
        _syncImagePresetFromForm();
        if (!_imageDraft.imagePresets.length) return showToast('无预设可导出');
        const confirmed = await AppUI.confirm(
            '导出的预设文件会包含 API Key。请只保存在可信设备上，不要公开分享。',
            '导出预设',
            '继续导出',
            '取消'
        );
        if (!confirmed) return;
        const blob = new Blob([JSON.stringify(_imageDraft.imagePresets, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'api_image_presets.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    });
    
    _on('api-image-import-preset', () => {
        const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json';
        inp.onchange = (e) => {
            const f = e.target.files[0]; if (!f) return;
            const r = new FileReader();
            r.onload = () => {
                try {
                    const data = JSON.parse(r.result);
                    if (!Array.isArray(data)) throw new Error('格式不对');
                    const takenNames = new Set(_imageDraft.imagePresets.map(p => p.name));
                    let imported = 0;
                    data.filter(p => p && typeof p === 'object').forEach(rawPreset => {
                        const normalized = _normalizeImagePreset({ ...rawPreset, id: _newImagePresetId() });
                        normalized.name = _uniqueImagePresetName(normalized.name, takenNames);
                        takenNames.add(normalized.name);
                        _imageDraft.imagePresets.push(normalized);
                        imported++;
                    });
                    if (!imported) throw new Error('文件中没有可用的生图预设');
                    _applyImagePresetToForm(_imageDraft.imagePresets[_imageDraft.imagePresets.length - 1].id);
                    _markDirty('image');
                    showToast(`已导入 ${imported} 个生图预设，请保存图像配置`);
                } catch(ex) { AppUI.alert('导入失败: ' + ex.message); }
            }; r.readAsText(f);
        }; inp.click();
    });

    const presetSelect = document.getElementById('api-image-preset-select');
    if (presetSelect) presetSelect.addEventListener('change', () => {
        _syncImagePresetFromForm();
        _applyImagePresetToForm(presetSelect.value);
        _clearImagePreview({ abortRequest: true, clearResult: true });
    });

    // ★ 新增：监听服务商切换，自动填充对应的默认 URL
    const providerSelect = document.getElementById('api-image-provider');
    if (providerSelect) providerSelect.addEventListener('change', () => {
        const urlInput = document.getElementById('api-image-url');
        if (urlInput && !urlInput.value.trim()) {
            if (providerSelect.value === 'openai') {
                urlInput.value = 'https://api.openai.com';
            }

            // 触发脏数据标记
            urlInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
    });

    // 监控表单改动，点亮底部的未保存提示
    _watchDirty('image', [
        'api-image-url', 'api-image-key', 'api-image-preset-name', 'api-image-set-default', 'api-image-provider',
        'api-image-model', 'api-image-size', 'api-image-quality', 'api-image-style', 'api-image-cache-limit'
    ]);

    window.addEventListener('pagehide', () => {
        _clearImagePreview({ abortRequest: true, clearResult: false });
    });
}

// ============================================================
// Tab 刷新 / 事件绑定（chat、embedding…… 共用同一套）
// ============================================================

/** 刷新某个 tab 的 UI（每次打开页面时调用，不重复绑定事件） */
function _refreshApiTabUI(type) {
    const def = _apiDef(type);
    if (!def) return;
    const s = db[def.dbKey] || {};
    const activeName = s.activePreset;

    if (activeName) {
        const preset = _getPresets(type).find(p => p.name === activeName);
        if (preset && preset.data) {
            _applyDataToForm(type, preset.data);
            _setPresetNameInput(type, activeName);
        }
        _loadedPresetName[type] = activeName;
    } else {
        // 没有 activePreset：回落到裸 db 配置（老用户或全新安装）
        _applyDataToForm(type, s, { legacy: true });
        _setPresetNameInput(type, '未命名预设');
        _loadedPresetName[type] = null;
    }

    populateApiSelect(type);
    if (activeName) {
        const sel = document.getElementById(_apiId(def, 'preset-select'));
        if (sel) sel.value = activeName;
        _setChecked(_apiId(def, 'set-default'), true);
    }
    _updateDefaultToggleState(type);
}

/** 绑定某个 tab 的所有事件（仅 init 时调用一次） */
function _initApiTab(type) {
    const def = _apiDef(type);
    if (!def) return;
    _refreshApiTabUI(type);

    // 服务商切换 → 自动填 URL
    const providerEl = document.getElementById(_apiId(def, 'provider'));
    if (providerEl) providerEl.addEventListener('change', () => {
        const autoUrl = def.providerUrls[providerEl.value];
        if (autoUrl !== undefined) _setVal(_apiId(def, 'url'), autoUrl);
    });

    // 拉取模型
    _on(_apiId(def, 'fetch-btn'), () => fetchModels(type));

    // 选择预设 → 应用到表单
    const presetSel = document.getElementById(_apiId(def, 'preset-select'));
    if (presetSel) presetSel.addEventListener('change', () => {
        if (presetSel.value) {
            applyPresetToForm(type, presetSel.value);   // 内部已更新 _loadedPresetName
        } else {
            _setChecked(_apiId(def, 'set-default'), false);
            _setPresetNameInput(type, '');
            _loadedPresetName[type] = null;
        }
        _clearDirty(type);
        _updateDefaultToggleState(type);
    });

    // 预设管理图标按钮（save-preset 目前 HTML 里没这个按钮，_on 会自动跳过）
    _on(_apiId(def, 'add-preset'),  () => _addNewPreset(type));
    _on(_apiId(def, 'copy-preset'), () => _copyPreset(type));
    _on(_apiId(def, 'save-preset'), () => _savePreset(type));
    _on(_apiId(def, 'del-preset'),  () => _deletePreset(type));

    // 导入 / 导出
    _on(_apiId(def, 'import-preset'), () => importApiPresets(type));
    _on(_apiId(def, 'export-preset'), () => exportApiPresets(type));

    // 底部保存按钮
    _on(_apiId(def, 'save-btn'), () => _savePreset(type));

    // 监听表单变化 → 标记脏数据
    _watchDirty(type, [
        _apiId(def, 'preset-name'),
        ...def.fields.map(f => _apiFieldId(def, f))
    ]);
}

// ============================================================
// Tab 切换
// ============================================================

/** 切到指定 tab（侧栏按钮高亮 + pane 显隐） */
function _activateApiTab(name) {
    const apiScreen = document.getElementById('api-settings-screen');
    if (!apiScreen) return;

    if (_currentApiTab === 'image' && name !== 'image') {
        _clearImagePreview({ abortRequest: true, clearResult: true });
    }

    // 1. 切换侧边栏按钮的激活状态
    apiScreen.querySelectorAll('[data-api-tab]').forEach(b => b.classList.remove('active'));
    const btn = apiScreen.querySelector(`[data-api-tab="${name}"]`);
    if (btn) btn.classList.add('active');

    // 2. 隐藏所有 pane，再显示目标 pane
    apiScreen.querySelectorAll('.api-tab-pane').forEach(p => p.classList.remove('active'));
    const pane = apiScreen.querySelector(`#api-tab-${name}`);
    if (pane) pane.classList.add('active');

    _currentApiTab = name;
}

function _setupApiTabSwitching() {
    const apiScreen = document.getElementById('api-settings-screen');
    if (!apiScreen) return;
    apiScreen.querySelectorAll('[data-api-tab]').forEach(btn => {
        btn.onclick = () => _activateApiTab(btn.dataset.apiTab);
    });
}

// ============================================================
// 主入口：setupApiSettingsApp
// ============================================================
function setupApiSettingsApp() {
    _currentApiTab = 'chat';
    _resetApiTabState();

    // 数据迁移（旧用户首次进入）
    _migrateOldSettings();

    _setupApiTabSwitching();
    _setupBackGuard();

    API_TAB_TYPES.forEach(_initApiTab);
    initWeatherApiTab();               // 天气 tab 形状不同，走自己的一套
    initVoiceApiTab();                 // 语音 tab 同理
    initImageApiTab();
}

// ============================================================
// 每次打开 API 页面时调用（重置状态 + 回到文字 Tab + 刷新 UI）
// ============================================================
function openApiSettingsScreen() {
    // 重置脏数据和暂存状态
    _resetApiTabState();

    // 强制切回文字 Tab
    _activateApiTab('chat');

    // 各 Tab 都刷新回已保存状态
    API_TAB_TYPES.forEach(_refreshApiTabUI);
    _refreshWeatherTabUI();
    _refreshVoiceTabUI();
    // 上次留在播放器里的试听音频跟着页面一起清掉，顺手回收 blob URL
    _refreshImageTabUI();
    _clearVoicePreviewAudio();
}

// ============================================================
// 工具函数
// ============================================================

function _getVal(id)        { const el = document.getElementById(id); return el ? el.value : ''; }
function _setVal(id, v)     { const el = document.getElementById(id); if (el && v !== undefined) el.value = v; }
function _getChecked(id)    { const el = document.getElementById(id); return el ? el.checked : false; }
function _setChecked(id, v) { const el = document.getElementById(id); if (el) el.checked = !!v; }
function _on(id, fn)        { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); }

// 注：温度滑块旁边数字的同步，原先硬编码在 _setVal 里（判断 id === 'api-chat-temp'），
//     现在挂在 chat 描述符 temperature 字段的 onSet 上，通用函数不用再认识具体 id。
// 注：getRandomValue（多 Key 随机选取）已移到 js/core/utils.js —— 它跟设置页无关，
//     聊天发请求时也要用，留在这里等于让 chat 层依赖 settings 层。

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
