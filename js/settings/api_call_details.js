// ============================================================
// API 调用明细：账本负责查询与计价，页面只读快照，不重新套用当前预设单价。
// setup 由 main.js 调一次；进入时订阅，离开即退订并废弃仍在飞的查询。
// ============================================================
const _API_USAGE_PAGE_SIZE = 100;
const _API_USAGE_TYPES = ['text', 'embedding', 'image', 'voice'];
const _API_USAGE_TYPE_LABELS = { text: '文字api', embedding: '向量api', image: '图像api', voice: '语音api' };
let _apiUsageDetailsSetup = false;
let _apiUsageDetailsActive = false;
let _apiUsageDetailsSequence = 0;
let _apiUsageDetailsLoaded = 0;
let _apiUsageDetailsCount = 0;
let _apiUsageDetailsLoading = false;
let _apiUsageDetailsResetPending = false;
let _apiUsageDetailsTypes = ['text'];
// null 表示不限功能，不保存一份会漏掉未来新功能的“全选数组”。
let _apiUsageDetailsFeatures = null;
let _apiUsageDraftFeatures = null;
let _apiUsageFilterSequence = 0;
let _apiUsageFeatureLoading = false;
const _apiUsageFeatureInputs = new Map();
let _apiUsageDetailsUnsubscribe = null;
let _apiUsageExporting = false;
let _apiUsageClearing = false;

// 页面说明注册在模块内，弹窗与问号行为统一交给 utils.js 的 AppHelp。
if (window.AppHelp) window.AppHelp.register('apiUsage', {
    page: {
        title: 'API 调用明细说明',
        content: '仅统计本浏览器调用，按调用时单价估算，并非服务商账单；代理内部重试、其他设备和断流后的最终用量不可见。缺失费用显示 —，不按 0 计算，也不计入额度合计。\n\n'
            + '缓存命中率 = 报告缓存读取大于 0 的调用条数 ÷ 所选范围的总调用条数，不是缓存 token 占输入 token 的比例。每次请求最多计一次命中；未返回缓存用量的调用不计作命中，但仍在总调用次数中。没有调用时显示 0.00%。\n\n'
            + '起、止日期均按本地自然日统计，包含结束日期当天。筛选弹窗包含调用 API 类型和功能两个可折叠维度，类型初始展开且只选文字api，功能初始折叠且全选；标题前的复选框全选或取消本组，点标题展开或折叠，功能列表不随类型删减。组内多选，两个维度取交集；勾选只是草稿，点确定后才同步更新顶部统计和表格。识图、通话回复仍是文字调用，图像api是生图，语音api是语音合成。\n\n'
            + '表格能放下时自动铺满可用区域，放不下时保持紧凑列间距并左右滚动，向下滑动到末尾自动加载更多。日期与时间分两行，其他数字不换行；档位独立显示普通、flex 或未确认，只有响应确认才标注普通或 flex。模型在末列，只显示名称且最多两行，超出部分省略，完整名称保留在提示和 CSV 中；列表和顶部合计均显示三位小数，但合计仍按原始精度计算，CSV 保留详细结果和费用精度。错误在列表简写为“错误”。导出和导出左侧的清除按钮都作用于当前日期与两个筛选维度的全部匹配记录，不限已加载行。清除不可恢复，必须输入「确认清除」。想清空全部明细，请扩大日期范围并将 API 类型和功能都全选；仅扩大日期不会清掉未选类型或功能。'
    }
});

function _apiUsageElement(id) { return document.getElementById(id); }

/** 费用最多展示十位小数并裁掉末尾零；缺值绝不能 Number(null) 变成零。 */
function _formatApiUsageCost(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '—';
    // toFixed 对极大数返回科学计数法，不能裁掉指数末尾的零（1e+30 会误成 1e+3）。
    if (value >= 1e21) return String(value);
    return value.toFixed(10).replace(/\.?0+$/, '') || '0';
}

// 列表与顶部合计只在展示时保留三位小数，不能回写账本或拿逐行显示值求和；计算与 CSV 保留原精度。
function _formatApiUsageTableCost(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '—';
    return value.toFixed(3);
}

function _formatApiUsageTokens(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? String(value) : '—';
}

function _formatApiUsageTime(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '—';
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function _apiUsageResult(record, { compact = false } = {}) {
    const cancelled = ['aborted', 'cancelled', 'canceled'].includes(record.outcome);
    // 列表只显示短标签；HTTP 200 内业务失败也算错误，主动取消仍保留取消状态。
    if (compact && !cancelled && (['error', 'failed'].includes(record.outcome)
        || (record.errorStatus != null && record.errorStatus !== '') || record.httpStatus >= 400)) return '错误';
    if (compact && cancelled) return '已取消';
    const labels = { success: '成功', error: '失败', failed: '失败', aborted: '已取消', cancelled: '已取消', canceled: '已取消', pending: '进行中' };
    const label = labels[record.outcome] || record.outcome || '—';
    if (record.errorStatus != null && record.errorStatus !== '') {
        return `${record.errorStatus}${record.httpStatus != null && record.httpStatus !== record.errorStatus ? `（HTTP ${record.httpStatus}）` : ''} · ${label}`;
    }
    if (record.httpStatus != null) return record.outcome === 'success' ? String(record.httpStatus) : `${record.httpStatus} · ${label}`;
    return record.outcome === 'error' ? '网络/响应错误' : label;
}

/** 表格和 CSV 共用列顺序；紧凑格式只用于列表，导出保留单行时间、详细结果和费用精度。 */
function _apiUsageRowValues(record, { compact = false } = {}) {
    const time = _formatApiUsageTime(record.timestamp);
    return [
        compact ? time.replace(' ', '\n') : time, window.ApiUsageLedger.featureName(record),
        _apiUsageResult(record, { compact }), _formatApiUsageTokens(record.inputTokens),
        _formatApiUsageTokens(record.outputTokens), _formatApiUsageTokens(record.cacheTokens),
        compact ? _formatApiUsageTableCost(record.estimatedCost) : _formatApiUsageCost(record.estimatedCost),
        _apiUsageTierLabel(record), record.actualModel || record.model || '—'
    ];
}

function _apiUsageModelDetails(record) {
    const parts = [record.actualModel || record.model || '—', record.presetName && `预设：${record.presetName}`, record.provider && `服务商：${record.provider}`];
    if (record.actualModel && record.model && record.actualModel !== record.model) parts.push(`请求模型：${record.model}`);
    return parts.filter(Boolean).join('\n');
}

function _apiUsageObservedTier(record) {
    const observed = record.observedTier || '';
    return /^(flex|on_demand_flex)$/i.test(observed) ? 'flex'
        : /^(standard|default|on_demand)$/i.test(observed) ? 'standard' : null;
}

function _apiUsageTierLabel(record) {
    // 配置与估算用的 appliedTier 不等于响应确认；旧备份缺费用档位时优先读响应证据。
    if (!record.tierConfirmed) return '未确认';
    const confirmed = _apiUsageObservedTier(record) || record.appliedTier;
    return confirmed === 'flex' ? 'flex' : confirmed === 'standard' ? '普通' : '未确认';
}

function _apiUsageTierNote(record) {
    // 未知费用和旧备份也可能没 appliedTier，仍要优先按已识别的响应档位说明，不能误用请求 Flex。
    const applied = _apiUsageObservedTier(record) || record.appliedTier || record.requestedTier;
    if (_apiUsageTierLabel(record) === '未确认') return `档位未确认，按${applied === 'flex' ? ' Flex' : '普通'}配置估算`;
    return applied === 'flex' ? 'Flex 已确认' : '普通档位已确认';
}

function _apiUsageRenderRows(rows, emptyText = '所选日期与筛选条件暂无调用记录', append = false) {
    const body = _apiUsageElement('api-usage-table-body');
    if (!body) return;
    if (!append) body.replaceChildren();
    if (!rows.length) {
        if (append) return;
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 9;
        td.className = 'api-usage-empty';
        td.textContent = emptyText;
        tr.appendChild(td);
        body.appendChild(tr);
        return;
    }
    const fragment = document.createDocumentFragment();
    rows.forEach(record => {
        const tr = document.createElement('tr');
        _apiUsageRowValues(record, { compact: true }).forEach((value, column) => {
            const td = document.createElement('td');
            // 时间用纯文本换行，不拼 HTML；模型和历史功能名也保持 textContent 写入。
            td.textContent = value;
            if (column === 2) td.title = _apiUsageResult(record);
            if (column === 6) td.title = _formatApiUsageCost(record.estimatedCost);
            if (column === 7) td.title = [record.requestedTier && `请求档位：${record.requestedTier}`,
                record.observedTier && `响应档位：${record.observedTier}`, _apiUsageTierNote(record)].filter(Boolean).join('\n');
            if (column === 8) {
                td.title = _apiUsageModelDetails(record);
                // 两行省略放在内层 span，不改变 td 的表格布局；完整模型名仍保留在提示和 CSV 中。
                td.textContent = '';
                const model = document.createElement('span');
                model.className = 'api-usage-model-name';
                model.textContent = value;
                td.appendChild(model);
            }
            tr.appendChild(td);
        });
        fragment.appendChild(tr);
    });
    body.appendChild(fragment);
}

// 所有读取和删除共享这份快照，避免分页、导出或确认等待期间漏掉某个筛选维度。
function _apiUsageSelectedOptions() {
    const options = { types: [..._apiUsageDetailsTypes] };
    if (_apiUsageDetailsFeatures !== null) options.features = [..._apiUsageDetailsFeatures];
    return options;
}

function _apiUsageSelectedRange() {
    const ledger = window.ApiUsageLedger;
    if (!ledger) throw new Error('调用账本尚未加载');
    return ledger.dateRange(_apiUsageElement('api-usage-start-date').value, _apiUsageElement('api-usage-end-date').value);
}

/** 汇总始终覆盖日期、类型与功能交集的全部记录，不能拿已加载的那一批计算命中率。 */
function _apiUsageRenderSummary(summary) {
    _apiUsageElement('api-usage-total').textContent = _formatApiUsageTableCost(summary.total);
    _apiUsageElement('api-usage-count').textContent = `调用 ${summary.count} 次`;
    _apiUsageElement('api-usage-cached-count').textContent = `命中缓存 ${summary.cached} 次`;
    const ratio = summary.count ? summary.cached / summary.count : 0;
    const percent = Math.min(100, Math.max(0, ratio * 100));
    const hero = _apiUsageElement('api-usage-cache-rate');
    // 固定保留两位小数；整数与小数分开写入，让小数和百分号保持小字号。
    const formatted = percent.toFixed(2);
    const [integer, fraction] = formatted.split('.');
    _apiUsageElement('api-usage-cache-integer').textContent = integer;
    _apiUsageElement('api-usage-cache-fraction').textContent = `.${fraction}%`;
    hero.style.setProperty('--api-cache-percent', `${percent}%`);
    hero.setAttribute('aria-label', `缓存命中率 ${formatted}%，${summary.count} 次调用中有 ${summary.cached} 次报告命中`);
}

function _apiUsageUpdateLoadStatus() {
    _apiUsageElement('api-usage-status').textContent = _apiUsageDetailsCount === 0 ? ''
        : _apiUsageDetailsLoaded < _apiUsageDetailsCount ? '向下滑动加载更多' : '已显示全部记录';
}

async function _refreshApiCallDetails({ resetPage = false } = {}) {
    if (!_apiUsageDetailsActive) return;
    const sequence = ++_apiUsageDetailsSequence;
    const scroll = _apiUsageElement('api-usage-table-scroll');
    // 筛选重置必须持续到最新一轮读取结束；期间账本通知会换查询序号，不能恢复旧范围的深度与位置。
    if (resetPage) _apiUsageDetailsResetPending = true;
    const resetting = _apiUsageDetailsResetPending;
    const scrollTop = resetting ? 0 : scroll.scrollTop;
    // 普通实时更新保留已展开的深度与滚动位置；每次仍只向数据库取一百条，不把整表搬进内存。
    const wanted = resetting ? _API_USAGE_PAGE_SIZE : Math.max(_API_USAGE_PAGE_SIZE, _apiUsageDetailsLoaded);
    _apiUsageDetailsLoading = true;
    const status = _apiUsageElement('api-usage-status');
    status.textContent = '正在读取调用记录…';
    try {
        const range = _apiUsageSelectedRange();
        const ledger = window.ApiUsageLedger;
        const options = _apiUsageSelectedOptions();
        const [firstRows, summary] = await Promise.all([
            ledger.queryRange(range.start, range.end, { ...options, offset: 0, limit: _API_USAGE_PAGE_SIZE }),
            ledger.summarizeRange(range.start, range.end, options)
        ]);
        if (!_apiUsageDetailsActive || sequence !== _apiUsageDetailsSequence) return;
        const rows = [...firstRows];
        while (rows.length < Math.min(wanted, summary.count) && rows.length % _API_USAGE_PAGE_SIZE === 0) {
            const batch = await ledger.queryRange(range.start, range.end, { ...options, offset: rows.length, limit: _API_USAGE_PAGE_SIZE });
            if (!_apiUsageDetailsActive || sequence !== _apiUsageDetailsSequence) return;
            rows.push(...batch);
            if (batch.length < _API_USAGE_PAGE_SIZE) break;
        }
        _apiUsageDetailsCount = summary.count;
        _apiUsageDetailsLoaded = rows.length;
        _apiUsageRenderSummary(summary);
        _apiUsageRenderRows(rows);
        scroll.scrollTop = scrollTop;
        _apiUsageUpdateLoadStatus();
    } catch (error) {
        if (!_apiUsageDetailsActive || sequence !== _apiUsageDetailsSequence) return;
        _apiUsageDetailsCount = 0;
        _apiUsageDetailsLoaded = 0;
        _apiUsageRenderSummary({ total: null, count: 0, cached: 0 });
        status.textContent = `无法读取：${error.message || error}`;
        _apiUsageRenderRows([], '请检查日期范围后重试');
    } finally {
        if (sequence === _apiUsageDetailsSequence) {
            _apiUsageDetailsLoading = false;
            _apiUsageDetailsResetPending = false;
        }
    }
}

async function _loadMoreApiCallDetails() {
    if (!_apiUsageDetailsActive || _apiUsageDetailsLoading || _apiUsageDetailsLoaded >= _apiUsageDetailsCount) return;
    const scroll = _apiUsageElement('api-usage-table-scroll');
    // 隐藏滚动容器的几何读数全是零，且离开后的 scroll 事件可能迟到；不能把它当成已滑到底。
    if (scroll.clientHeight <= 0 || scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight > 160) return;
    const sequence = _apiUsageDetailsSequence;
    _apiUsageDetailsLoading = true;
    const status = _apiUsageElement('api-usage-status');
    status.textContent = '正在加载更多…';
    try {
        const range = _apiUsageSelectedRange();
        const rows = await window.ApiUsageLedger.queryRange(range.start, range.end, {
            ..._apiUsageSelectedOptions(), offset: _apiUsageDetailsLoaded, limit: _API_USAGE_PAGE_SIZE
        });
        if (!_apiUsageDetailsActive || sequence !== _apiUsageDetailsSequence) return;
        _apiUsageRenderRows(rows, undefined, true);
        _apiUsageDetailsLoaded += rows.length;
        if (rows.length < _API_USAGE_PAGE_SIZE) _apiUsageDetailsCount = _apiUsageDetailsLoaded;
        _apiUsageUpdateLoadStatus();
    } catch (error) {
        if (!_apiUsageDetailsActive || sequence !== _apiUsageDetailsSequence) return;
        status.textContent = `加载失败，继续滑动重试：${error.message || error}`;
    } finally {
        if (sequence === _apiUsageDetailsSequence) _apiUsageDetailsLoading = false;
    }
}

async function _exportApiCallDetails() {
    if (_apiUsageExporting) return;
    const button = _apiUsageElement('api-usage-export-btn');
    _apiUsageExporting = true;
    button.disabled = true;
    try {
        const range = _apiUsageSelectedRange();
        const options = _apiUsageSelectedOptions();
        const ledger = window.ApiUsageLedger;
        if (typeof saveAudioBlobAsFile !== 'function') throw new Error('当前浏览器不支持文件保存');
        // 导出用游标逐条写 CSV，不通过分页查询攒整份记录，更不调用 toArray。
        // csvCell 同时负责引号、换行和公式保护；BOM 让表格软件正确识别中文。
        const headers = ['时间', '功能', '结果', '输入', '输出', '缓存', '费用（预估）', '档位', '模型'];
        const chunks = ['﻿', headers.map(ledger.csvCell).join(','), '\r\n'];
        await ledger.eachRange(range.start, range.end, record => {
            chunks.push(_apiUsageRowValues(record).map(ledger.csvCell).join(',') + '\r\n');
        }, options);
        const blob = new Blob(chunks, { type: 'text/csv;charset=utf-8' });
        const start = ledger.localDate(range.start);
        const end = ledger.localDate(range.end - 1);
        // 复用项目唯一文件保存入口，保留 iOS 系统分享面板，不另写 a.download。
        await saveAudioBlobAsFile(blob, `API调用明细_${start}_${end}.csv`);
    } catch (error) {
        showToast(`导出失败：${error.message || error}`);
    } finally {
        _apiUsageExporting = false;
        button.disabled = false;
    }
}

async function _clearApiCallDetails() {
    if (_apiUsageClearing) return;
    const button = _apiUsageElement('api-usage-clear-btn');
    _apiUsageClearing = true;
    button.disabled = true;
    try {
        // 点击时捕获条件而非已加载行；确认期间改变日期或筛选，也只清除这份范围。
        const ledger = window.ApiUsageLedger;
        const range = _apiUsageSelectedRange();
        const options = _apiUsageSelectedOptions();
        const summary = await ledger.summarizeRange(range.start, range.end, options);
        if (!_apiUsageDetailsActive) return;
        if (!summary.count) { showToast('当前查询范围没有可清除的记录'); return; }
        const types = options.types.map(type => _API_USAGE_TYPE_LABELS[type]).join('、');
        const features = options.features ? options.features.join('、') : '全部功能';
        const answer = await AppUI.prompt(
            `将清除 ${ledger.localDate(range.start)} 至 ${ledger.localDate(range.end - 1)} 的查询结果。\nAPI 类型：${types}\n功能：${features}\n当前匹配 ${summary.count} 条，包含尚未加载的记录；确认期间新增的匹配记录也在清除范围内。此操作不可恢复。请输入「确认清除」继续。`,
            '确认清除', '清除当前查询结果', '清除', '取消'
        );
        // 必须逐字匹配，不 trim、不将普通确认视为授权。
        if (answer !== '确认清除' || !_apiUsageDetailsActive) return;
        const deleted = await ledger.clearRange(range.start, range.end, options);
        await _refreshApiCallDetails({ resetPage: true });
        showToast(`已清除 ${deleted} 条 API 调用明细`);
    } catch (error) {
        showToast(`清除失败：${error.message || error}`);
    } finally {
        _apiUsageClearing = false;
        button.disabled = false;
    }
}

function _apiUsageFilterIsOpen() {
    return _apiUsageElement('api-usage-filter-modal').classList.contains('visible');
}

function _apiUsageSyncTypesAll() {
    const count = _API_USAGE_TYPES.filter(type => _apiUsageElement(`api-usage-type-${type}`).checked).length;
    const all = _apiUsageElement('api-usage-types-all');
    all.checked = count === _API_USAGE_TYPES.length;
    all.indeterminate = count > 0 && !all.checked;
}

function _apiUsageSyncFeaturesAll() {
    const inputs = [..._apiUsageFeatureInputs.values()];
    const count = inputs.filter(input => input.checked).length;
    const all = _apiUsageElement('api-usage-features-all');
    all.checked = _apiUsageDraftFeatures === null || (inputs.length > 0 && count === inputs.length);
    all.indeterminate = count > 0 && !all.checked;
}

function _apiUsageAppendFeatures(features) {
    const list = _apiUsageElement('api-usage-feature-list');
    features.forEach(feature => {
        if (_apiUsageFeatureInputs.has(feature)) return;
        const li = document.createElement('li');
        li.className = 'world-book-select-item';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.className = 'item-checkbox';
        // 功能名可能来自导入记录，用序号生成 ID，名字只写 textContent，不拼 HTML 或选择器。
        input.id = `api-usage-feature-${_apiUsageFeatureInputs.size}`;
        input.value = feature;
        input.checked = _apiUsageDraftFeatures === null || _apiUsageDraftFeatures.has(feature);
        const label = document.createElement('label');
        label.htmlFor = input.id;
        label.textContent = feature;
        li.appendChild(input);
        li.appendChild(label);
        list.appendChild(li);
        _apiUsageFeatureInputs.set(feature, input);
    });
    _apiUsageSyncFeaturesAll();
}

async function _apiUsageOpenFilter() {
    const sequence = ++_apiUsageFilterSequence;
    const modal = _apiUsageElement('api-usage-filter-modal');
    _API_USAGE_TYPES.forEach(type => { _apiUsageElement(`api-usage-type-${type}`).checked = _apiUsageDetailsTypes.includes(type); });
    _apiUsageDraftFeatures = _apiUsageDetailsFeatures === null ? null : new Set(_apiUsageDetailsFeatures);
    _apiUsageFeatureInputs.clear();
    _apiUsageElement('api-usage-feature-list').replaceChildren();
    _apiUsageElement('api-usage-type-group').open = true;
    _apiUsageElement('api-usage-feature-group').open = false;
    _apiUsageSyncTypesAll();
    const ledger = window.ApiUsageLedger;
    _apiUsageAppendFeatures([...new Set([...(ledger?.knownFeatures || []), ...(_apiUsageDetailsFeatures || [])])]);
    const status = _apiUsageElement('api-usage-feature-status');
    const apply = _apiUsageElement('api-usage-filter-apply-btn');
    _apiUsageFeatureLoading = true;
    status.textContent = '正在补充历史功能…';
    apply.disabled = true;
    modal.classList.add('visible');
    _apiUsageElement('api-usage-type-text').focus();
    try {
        const features = await ledger.listFeatures();
        // 通用遮罩和系统返回只移除 visible；旧扫描不能重开弹窗，也不能覆盖下一轮草稿。
        if (!_apiUsageDetailsActive || sequence !== _apiUsageFilterSequence || !_apiUsageFilterIsOpen()) return;
        _apiUsageAppendFeatures(features);
        status.textContent = '';
    } catch (error) {
        if (!_apiUsageDetailsActive || sequence !== _apiUsageFilterSequence || !_apiUsageFilterIsOpen()) return;
        status.textContent = `历史功能读取失败，可按已知功能筛选：${error.message || error}`;
    } finally {
        if (sequence === _apiUsageFilterSequence) {
            _apiUsageFeatureLoading = false;
            apply.disabled = false;
        }
    }
}

function _apiUsageCloseFilter({ focus = true } = {}) {
    ++_apiUsageFilterSequence;
    _apiUsageFeatureLoading = false;
    _apiUsageElement('api-usage-filter-modal').classList.remove('visible');
    if (focus && _apiUsageDetailsActive) _apiUsageElement('api-usage-filter-btn').focus();
}

function _apiUsageApplyFilter() {
    if (!_apiUsageDetailsActive || !_apiUsageFilterIsOpen() || _apiUsageFeatureLoading) return;
    _apiUsageDetailsTypes = _API_USAGE_TYPES.filter(type => _apiUsageElement(`api-usage-type-${type}`).checked);
    const selected = [..._apiUsageFeatureInputs].filter(([, input]) => input.checked).map(([feature]) => feature);
    _apiUsageDetailsFeatures = _apiUsageDraftFeatures === null
        || (selected.length > 0 && selected.length === _apiUsageFeatureInputs.size) ? null : selected;
    _apiUsageCloseFilter();
    _refreshApiCallDetails({ resetPage: true });
}

function _enterApiCallDetails() {
    if (_apiUsageDetailsActive) return;
    _apiUsageDetailsActive = true;
    const ledger = window.ApiUsageLedger;
    const start = _apiUsageElement('api-usage-start-date');
    const end = _apiUsageElement('api-usage-end-date');
    if (ledger && !start.value && !end.value) start.value = end.value = ledger.localDate();
    if (ledger) _apiUsageDetailsUnsubscribe = ledger.subscribe(() => {
        if (_apiUsageDetailsActive) _refreshApiCallDetails();
    });
    _refreshApiCallDetails({ resetPage: true });
}

function _leaveApiCallDetails() {
    _apiUsageDetailsActive = false;
    ++_apiUsageDetailsSequence;
    _apiUsageDetailsLoading = false;
    _apiUsageCloseFilter({ focus: false });
    if (_apiUsageDetailsUnsubscribe) _apiUsageDetailsUnsubscribe();
    _apiUsageDetailsUnsubscribe = null;
}

function setupApiCallDetails() {
    if (_apiUsageDetailsSetup || !_apiUsageElement('api-call-details-screen')) return;
    _apiUsageDetailsSetup = true;
    ['api-usage-start-date', 'api-usage-end-date'].forEach(id => {
        _apiUsageElement(id).addEventListener('change', () => _refreshApiCallDetails({ resetPage: true }));
    });
    _apiUsageElement('api-usage-table-scroll').addEventListener('scroll', _loadMoreApiCallDetails, { passive: true });
    _API_USAGE_TYPES.forEach(type => {
        _apiUsageElement(`api-usage-type-${type}`).addEventListener('change', _apiUsageSyncTypesAll);
    });
    // 全选框放在分组标题前；阻止点击冒泡，但保留原生勾选行为，不连带展开或折叠。
    ['api-usage-types-all', 'api-usage-features-all'].forEach(id => {
        _apiUsageElement(id).addEventListener('click', event => event.stopPropagation());
    });
    _apiUsageElement('api-usage-types-all').addEventListener('change', event => {
        _API_USAGE_TYPES.forEach(type => { _apiUsageElement(`api-usage-type-${type}`).checked = event.target.checked; });
        _apiUsageSyncTypesAll();
    });
    _apiUsageElement('api-usage-features-all').addEventListener('change', event => {
        _apiUsageDraftFeatures = event.target.checked ? null : new Set();
        _apiUsageFeatureInputs.forEach(input => { input.checked = event.target.checked; });
        _apiUsageSyncFeaturesAll();
    });
    // 动态条目仅在列表上委托一次监听，重复开窗不新增绑定；草稿与已生效条件分开。
    _apiUsageElement('api-usage-feature-list').addEventListener('change', event => {
        const input = event.target;
        if (_apiUsageFeatureInputs.get(input.value) !== input) return;
        if (_apiUsageDraftFeatures === null) _apiUsageDraftFeatures = new Set(_apiUsageFeatureInputs.keys());
        if (input.checked) _apiUsageDraftFeatures.add(input.value);
        else _apiUsageDraftFeatures.delete(input.value);
        const selected = [..._apiUsageFeatureInputs].filter(([, checkbox]) => checkbox.checked).map(([feature]) => feature);
        if (selected.length === _apiUsageFeatureInputs.size) _apiUsageDraftFeatures = null;
        _apiUsageSyncFeaturesAll();
    });
    _apiUsageElement('api-usage-filter-btn').addEventListener('click', _apiUsageOpenFilter);
    _apiUsageElement('api-usage-filter-cancel-btn').addEventListener('click', () => _apiUsageCloseFilter());
    _apiUsageElement('api-usage-filter-apply-btn').addEventListener('click', _apiUsageApplyFilter);
    const modal = _apiUsageElement('api-usage-filter-modal');
    modal.addEventListener('click', event => { if (event.target === modal) _apiUsageCloseFilter(); });
    modal.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        _apiUsageCloseFilter();
    });
    _apiUsageElement('api-usage-export-btn').addEventListener('click', _exportApiCallDetails);
    _apiUsageElement('api-usage-clear-btn').addEventListener('click', _clearApiCallDetails);
    // 钩子集中注册，不用 MutationObserver，也不从脚本加载阶段擅自打开页面。
    window._screenEnterHooks = window._screenEnterHooks || {};
    window._screenLeaveHooks = window._screenLeaveHooks || {};
    const previousEnter = window._screenEnterHooks['api-call-details-screen'];
    const previousLeave = window._screenLeaveHooks['api-call-details-screen'];
    window._screenEnterHooks['api-call-details-screen'] = () => {
        if (previousEnter) previousEnter();
        _enterApiCallDetails();
    };
    window._screenLeaveHooks['api-call-details-screen'] = target => {
        _leaveApiCallDetails();
        if (previousLeave) previousLeave(target);
    };
}
