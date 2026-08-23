// ============================================================
// weather_api.js — 和风天气 API 层（凭据 / 归一化 / 额度 / 请求）
// ============================================================
// 这一层只管"怎么跟和风说话"和"还能说几句"，不认识任何页面，也不认识聊天。
// 两个消费方：
//   · js/settings/api_settings.js  → 天气设置 tab（填 Host/Key、查地点、测实况）
//   · js/chat/chat_weather_context.js → 聊天注入（取实况/预报）
// 依赖方向单向：settings → api、chat → api，两个消费方互不依赖。
//
// 对外符号（全局函数，classic script 无模块化，靠命名约定区分归属）：
//   QWEATHER_API_HOST_PATTERN / _normalizeQWeatherHost / _isValidQWeatherHost
//   _newWeatherPresetId / _normalizeWeatherSettings
//   _weatherTodayKey / _readWeatherQuota / _addWeatherUsage / _reserveWeatherQuota
//   onWeatherUsageChange
//   _readWeatherApiError
//   fetchQWeatherNow / fetchQWeatherHourly24 / fetchQWeatherCityLookup
// ============================================================

// 和风控制台会给每个账号分配专属 API Host，不是公共域名，所以这里校验的是形状而非固定值
const QWEATHER_API_HOST_PATTERN = /^https:\/\/(?:[a-z0-9-]+\.)+qweatherapi\.com$/i;

function _normalizeQWeatherHost(value) {
    return String(value || '').trim().replace(/\/+$/, '');
}

function _isValidQWeatherHost(value) {
    return QWEATHER_API_HOST_PATTERN.test(_normalizeQWeatherHost(value));
}

// ============================================================
// 配置归一化
// ============================================================

function _newWeatherPresetId() {
    return `weather-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function _normalizeWeatherSettings(raw) {
    const source = raw || {};
    const presets = Array.isArray(source.locationPresets) ? source.locationPresets
        .filter(p => p && p.locationId)
        .map(p => ({
            id: p.id || _newWeatherPresetId(),
            name: p.name || p.locationName || p.locationQuery || '未命名地点',
            locationId: String(p.locationId),
            locationName: p.locationName || p.name || p.locationQuery || '',
            locationQuery: p.locationQuery || ''
        })) : [];

    // 兼容单地点旧配置：首次进入并保存时迁移为一个地点预设。
    if (!presets.length && source.locationId) {
        presets.push({
            id: _newWeatherPresetId(),
            name: source.locationName || source.locationQuery || '默认地点',
            locationId: String(source.locationId),
            locationName: source.locationName || source.locationQuery || '',
            locationQuery: source.locationQuery || ''
        });
    }

    const defaultId = presets.some(p => p.id === source.defaultLocationPresetId)
        ? source.defaultLocationPresetId
        : (presets[0] ? presets[0].id : '');
    return {
        enabled: !!source.enabled,
        provider: 'qweather',
        apiHost: source.apiHost || '',
        apiKey: source.apiKey || '',
        // 注：旧配置里的 cacheMinutes 已废弃（实况改成每次都拉），读到也直接忽略，不再写回
        locationPresets: presets,
        defaultLocationPresetId: defaultId,
        dailyLimit: Number(source.dailyLimit) > 0 ? Math.floor(Number(source.dailyLimit)) : 800,
        dailyCount: Number(source.dailyCount) > 0 ? Math.floor(Number(source.dailyCount)) : 0,
        dailyCountDate: source.dailyCountDate || ''
    };
}

// ============================================================
// 额度计数器：和风超额不返回 402/429，直接发账单，本地计数器是唯一防线
// ============================================================

/** 本地日期 YYYY-MM-DD（不管哪个时区，0 点到 0 点总是 24 小时） */
function _weatherTodayKey() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// 当天已经提示过上限的日期，避免每条回复都弹一次
let _weatherLimitToastDate = '';

// 用量变化订阅者。这一层不认识任何 DOM：设置页要显示"今日已用 N"就自己来登记，
// 页面不在（比如聊天时记的账）就没人被通知，不需要写 if (!el) return 这种越层判断。
const _weatherUsageListeners = [];

/**
 * 登记用量变化回调（设置页在 initWeatherApiTab 里注册一次）。
 * @param {Function} fn 无参回调，异常会被吞掉并打 warn，不影响记账主流程
 */
function onWeatherUsageChange(fn) {
    if (typeof fn === 'function') _weatherUsageListeners.push(fn);
}

function _emitWeatherUsageChange() {
    _weatherUsageListeners.forEach(fn => {
        try { fn(); } catch (error) { console.warn('天气用量回调执行失败：', error); }
    });
}

/** 读当日额度状态；日期对不上视为已归零（真正落库在 _addWeatherUsage） */
function _readWeatherQuota() {
    const settings = _normalizeWeatherSettings(db.weatherSettings);
    const today = _weatherTodayKey();
    return {
        today,
        limit: settings.dailyLimit,
        count: settings.dailyCountDate === today ? settings.dailyCount : 0
    };
}

/** 记账并落库；跨日在这里一并归零 */
async function _addWeatherUsage(times) {
    if (!times) return;
    const { today, count } = _readWeatherQuota();
    db.weatherSettings = { ...(db.weatherSettings || {}), dailyCount: count + times, dailyCountDate: today };
    try {
        await saveGlobalKeys(['weatherSettings']);
    } catch (error) {
        console.warn('天气用量落库失败：', error);
    }
    _emitWeatherUsageChange();
}

/**
 * 发和风请求前的统一闸门：超额直接拦下，没超就预扣 times 次。
 * ★ 所有真会打到和风的地方都必须走这里（聊天注入、地点查询、实况测试），漏一处计数就不准。
 * @param {number} times 本次准备发几个请求
 * @param {object} opts  oncePerDay=true 时当天只提示一次（给每轮回复都会走的聊天注入用）
 * @returns {Promise<boolean>} false = 已超额，调用方应直接放弃
 */
async function _reserveWeatherQuota(times, { oncePerDay = false } = {}) {
    const quota = _readWeatherQuota();
    if (quota.count + times > quota.limit) {
        if (!oncePerDay || _weatherLimitToastDate !== quota.today) {
            if (oncePerDay) _weatherLimitToastDate = quota.today;
            showToast(`天气请求已达今日上限（${quota.limit} 次），今天不再发请求`);
        }
        return false;
    }
    // 预扣：请求一旦发出就已经计入账单，哪怕它失败了
    await _addWeatherUsage(times);
    return true;
}

// ============================================================
// 请求封装（和风天气 API v7 / GeoAPI v2）
// ============================================================

/** HTTP 层错误转可直接展示的文案 */
async function _readWeatherApiError(response) {
    let detail = '';
    try {
        const text = (await response.text()).trim();
        if (text) {
            try {
                const body = JSON.parse(text);
                detail = body.message || body.code || text;
            } catch (_) {
                detail = text;
            }
        }
    } catch (_) { /* ignore */ }
    return `请求失败（HTTP ${response.status}）${detail ? `：${detail}` : ''}`;
}

/**
 * 和风请求统一入口：拼 host、鉴权头、查询串，HTTP 与业务 code 都不对就 throw。
 * ★ 鉴权头名（X-QW-Api-Key）和接口路径只出现在这个文件里，调用方不需要知道。
 * ★ 不在这里扣额度：额度是"本次动作准备发几个请求"的账，得由调用方一次性预扣
 *   （见 _reserveWeatherQuota），否则并发两个请求会各自判一次上限、放过超额的那次。
 * @throws {Error} message 已是可直接展示的文案
 */
async function _qweatherRequest(path, { host, key, params }) {
    const endpoint = `${_normalizeQWeatherHost(host)}${path}?${new URLSearchParams(params).toString()}`;
    const response = await fetch(endpoint, {
        method: 'GET',
        headers: { Accept: 'application/json', 'X-QW-Api-Key': key }
    });
    if (!response.ok) throw new Error(await _readWeatherApiError(response));
    const payload = await response.json();
    if (payload.code !== '200') throw new Error(`和风天气状态码：${payload.code || '未知'}`);
    return payload;
}

/** 实况天气；payload.now 为观测数据 */
function fetchQWeatherNow(host, key, locationId) {
    return _qweatherRequest('/v7/weather/now', {
        host, key, params: { location: locationId, lang: 'zh' }
    });
}

/** 24 小时逐小时预报；payload.hourly 为数组 */
function fetchQWeatherHourly24(host, key, locationId) {
    return _qweatherRequest('/v7/weather/24h', {
        host, key, params: { location: locationId, lang: 'zh' }
    });
}

/** 城市/地区检索；payload.location 为候选数组 */
function fetchQWeatherCityLookup(host, key, query) {
    return _qweatherRequest('/geo/v2/city/lookup', {
        host, key, params: { location: query, range: 'cn', number: '20', lang: 'zh' }
    });
}
