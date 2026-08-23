// ============================================================
// chat_weather_context.js — 聊天里的天气：注入文案 + 侧栏设置桥
// ============================================================
// 只做"聊天要不要说天气、怎么说"这件事。凭据、额度、和风接口路径全在
// js/api/weather_api.js，本文件不出现 API Host、鉴权头名和 URL 路径。
//
// 消费方：
//   · chat_ai_service.js  → getWeatherPromptContext(chat)
//   · chat_settings.js / group_settings.js → openWeatherSettingDialog / formatWeatherSettingLabel
//
// 依赖：js/api/weather_api.js 必须先加载（_normalizeWeatherSettings / _reserveWeatherQuota /
//       fetchQWeatherNow / fetchQWeatherHourly24）。
// ============================================================

// ---- 聊天/群聊侧栏的天气行：数据与文案（侧栏只显示文案，具体设置走 AppUI.form 弹窗）----

/** 弹窗地点下拉的选项数据 */
function getWeatherLocationOptions() {
    const settings = _normalizeWeatherSettings(db.weatherSettings);
    return [
        { value: 'off', label: '不开启' },
        { value: 'inherit', label: '跟随全局默认' },
        ...settings.locationPresets.map(preset => ({ value: `preset:${preset.id}`, label: preset.name }))
    ];
}

/** 聊天字段 → 下拉 value */
function toWeatherSelectValue(mode, presetId = '') {
    const settings = _normalizeWeatherSettings(db.weatherSettings);
    if (mode === 'preset' && settings.locationPresets.some(p => p.id === presetId)) return `preset:${presetId}`;
    return mode === 'inherit' ? 'inherit' : 'off';
}

/** 下拉 value → 聊天字段 */
function parseWeatherSelectValue(value) {
    const raw = value || 'off';
    if (raw.startsWith('preset:')) return { weatherMode: 'preset', weatherLocationPresetId: raw.slice('preset:'.length) };
    if (raw === 'inherit') return { weatherMode: 'inherit', weatherLocationPresetId: '' };
    return { weatherMode: 'off', weatherLocationPresetId: '' };
}

/** 侧栏那一行的显示文案：不开启 / 辉城 / 辉城 · 含预报 */
function formatWeatherSettingLabel(mode, presetId = '', forecastEnabled = false) {
    if (!mode || mode === 'off') return '不开启';
    const settings = _normalizeWeatherSettings(db.weatherSettings);
    let name;
    if (mode === 'preset') {
        const preset = settings.locationPresets.find(p => p.id === presetId);
        name = preset ? preset.name : '地点已删除';
    } else {
        const preset = settings.locationPresets.find(p => p.id === settings.defaultLocationPresetId);
        name = preset ? `跟随全局（${preset.name}）` : '跟随全局默认';
    }
    return forecastEnabled ? `${name} · 含预报` : name;
}

/**
 * 弹出天气设置弹窗（地点 + 是否含 24h 预报）。
 * @param {object} current { weatherMode, weatherLocationPresetId, weatherForecastEnabled }
 * @returns {Promise<object|null>} 同结构的新值；取消返回 null
 */
async function openWeatherSettingDialog(current = {}) {
    const settings = _normalizeWeatherSettings(db.weatherSettings);
    if (!settings.locationPresets.length) {
        await AppUI.alert('还没有可用的天气地点。请先到「API 设置 → 天气」里填好 Host / Key 并添加地点预设。', '天气未配置');
        return null;
    }
    const result = await AppUI.form([
        {
            type: 'select', key: 'location', label: '天气地点',
            options: getWeatherLocationOptions(),
            value: toWeatherSelectValue(current.weatherMode, current.weatherLocationPresetId)
        },
        {
            type: 'switch', key: 'forecast', label: '加入 24 小时预报',
            value: !!current.weatherForecastEnabled
        }
    ], { title: '天气设置', confirmText: '确定' });

    if (!result) return null;
    return {
        ...parseWeatherSelectValue(result.location),
        weatherForecastEnabled: !!result.forecast
    };
}

// ============================================================
// 聊天运行时天气上下文（按聊天触发，地点级缓存，不写聊天历史）
// ============================================================

// 预报缓存：locationId -> { fetchedAt, payload }。实况不缓存（每次都拉）。
const _weatherForecastCache = new Map();
const WEATHER_FORECAST_TTL_MS = 60 * 60 * 1000; // 1 小时，写死不给 UI

// 天气变化增量：`chatId::locationId` -> { category, text, at, fromText, left }
// 只存内存、不落库：刷新丢失的代价仅是少说一次"雨停了"，不值得动 chat schema 和备份白名单。
const _weatherLastSeen = new Map();
const WEATHER_DELTA_TTL_MS = 6 * 60 * 60 * 1000; // 上次观测在 6h 内才算"刚变化"
const WEATHER_DELTA_REPEAT = 2;                  // 转变句连带几次注入（旋钮）

// 条件注入阈值（可按需调整）
const WEATHER_INJECT_RULES = {
    humidityLow: 30,   // 湿度 ≤ 30% 视为干燥才注入
    humidityHigh: 70,  // 湿度 ≥ 70% 视为潮湿才注入
    windScale: 6,      // 风力 ≥ 6 级才注入
    precipMin: 0,      // 降水量 > 0 才注入
    visMax: 5,         // 能见度 ≤ 5km 才注入
    tempDiff: 5,       // 与"明天此时"温差 ≥ 5℃ 才提醒（不与 24h 全局极值比，理由见 _buildWeatherAlerts）
    popMin: 60,        // 降水概率 ≥ 60% 视为可能降雨
    maxAlerts: 3,      // 天气提醒最多注入条数
    samePhaseSamples: 3 // 取预报末尾 N 个点（≈明天同一钟点）求均值，平滑单点抖动
};

/** 解析某个聊天应使用的地点预设；返回 null 表示该聊天不注入天气 */
function _resolveWeatherPresetForChat(chat) {
    if (!chat || !chat.weatherMode || chat.weatherMode === 'off') return null;
    const settings = _normalizeWeatherSettings(db.weatherSettings);
    if (!settings.apiHost || !settings.apiKey) return null;

    let preset = null;
    if (chat.weatherMode === 'preset') {
        preset = settings.locationPresets.find(p => p.id === chat.weatherLocationPresetId);
    } else {
        preset = settings.locationPresets.find(p => p.id === settings.defaultLocationPresetId);
    }
    return (preset && preset.locationId) ? { settings, preset } : null;
}

/**
 * 组装注入文本：城市名用预设名；部分指标仅在达到阈值时出现。
 * prevText 非空时把"刚从 X 转为 Y"并进首句 —— 给模型的是**变化**而不是状态。
 * 历史消息里没有时间戳，旧天气在模型眼里永不过期，只给状态它会顺着上文继续演旧天气。
 */
function _formatWeatherPromptText(now, presetName, prevText = '') {
    const parts = [];
    const temp = now.temp === undefined ? '未知' : `${now.temp}℃`;
    parts.push(prevText
        ? `${presetName}的天气刚从${prevText}转为${now.text || '未知'}，目前温度${temp}`
        : `${presetName}目前的天气是${now.text || '未知'}，温度${temp}`);

    const humidity = parseInt(now.humidity, 10);
    if (!isNaN(humidity) && (humidity <= WEATHER_INJECT_RULES.humidityLow || humidity >= WEATHER_INJECT_RULES.humidityHigh)) {
        parts.push(`湿度${humidity}%`);
    }
    const windScale = parseInt(now.windScale, 10);
    if (!isNaN(windScale) && windScale >= WEATHER_INJECT_RULES.windScale) {
        parts.push(`${now.windDir || '未知风向'}${windScale}级风`);
    }
    const precip = parseFloat(now.precip);
    if (!isNaN(precip) && precip > WEATHER_INJECT_RULES.precipMin) {
        parts.push(`降水量${now.precip}mm`);
    }
    const vis = parseFloat(now.vis);
    if (!isNaN(vis) && vis <= WEATHER_INJECT_RULES.visMax) {
        parts.push(`能见度${now.vis}km`);
    }
    return parts.join('，');
}

/** 天气文字归类：同类之间的变化不提醒（如晴转多云），跨类才提醒 */
function _weatherCategory(text) {
    const t = String(text || '');
    if (t.includes('雷')) return '雷';
    if (t.includes('雨') || t.includes('雹')) return '雨';
    if (t.includes('雪')) return '雪';
    if (t.includes('雾') || t.includes('霾')) return '雾';
    if (t.includes('台风') || t.includes('飓风')) return '台风';
    if (t.includes('沙') || t.includes('尘')) return '沙尘';
    return 'normal';
}

/** 风力字段可能是 "6" 或 "3-4"，取最大等级 */
function _parseWindScale(value) {
    const nums = String(value || '').match(/\d+/g);
    return nums ? Math.max(...nums.map(Number)) : NaN;
}

/** 未来小时数（按 fxTime 与当前时间差取整） */
function _hoursAhead(fxTime) {
    const t = Date.parse(String(fxTime || '').replace(' ', 'T'));
    if (isNaN(t)) return null;
    return Math.max(1, Math.round((t - Date.now()) / 3600000));
}

/** 对比实时与 24h 预报，只生成“明显变化”的提醒 */
function _buildWeatherAlerts(now, hourly, presetName) {
    if (!Array.isArray(hourly) || !hourly.length) return [];
    const events = [];

    // 1. 天气转变（跨类别），取最早一次
    const currentCategory = _weatherCategory(now.text);
    const transition = hourly.find(h => _weatherCategory(h.text) !== currentCategory && _weatherCategory(h.text) !== 'normal');
    if (transition) {
        const hours = _hoursAhead(transition.fxTime);
        let text = `约${hours === null ? '数' : hours}小时后${presetName}天气转为${transition.text}`;
        const precip = parseFloat(transition.precip);
        const pop = parseInt(transition.pop, 10);
        if (!isNaN(precip) && precip > 0) text += `，预计降雨量${transition.precip}mm`;
        else if (!isNaN(pop) && pop >= WEATHER_INJECT_RULES.popMin) text += `，降水概率${pop}%`;
        events.push({ hours: hours === null ? 999 : hours, text });
    }

    // 2. 明显升温 / 降温：与"明天此时"比，**不能**与 24h 全局极值比。
    //    24h 窗口必然跨一个夜晚，夏天昼夜温差 7-10℃ 是常态，用全局 min/max 会让 tempDiff:5
    //    天天误报"即将降温" —— 那是昼夜节律，不是天气过程。模型读到后会说"忍一下马上降温了"，
    //    而实际明天白天照样 38℃。取预报末尾几个点（≈+22~24h，同一钟点）求均值后比较，
    //    节律自动抵消；真正持续的冷暖空气（明天此时确实低 8℃）照样报得出来。
    const currentTemp = parseFloat(now.temp);
    if (!isNaN(currentTemp)) {
        const tailTemps = hourly.slice(-WEATHER_INJECT_RULES.samePhaseSamples)
            .map(h => parseFloat(h.temp)).filter(t => !isNaN(t));
        if (tailTemps.length) {
            const samePhaseTemp = Math.round(tailTemps.reduce((sum, t) => sum + t, 0) / tailTemps.length);
            const diff = samePhaseTemp - currentTemp;
            // hours 用真实的 24（原来是 998 哨兵值），让"3 小时后转雨"这类近期事件排在前面
            if (diff >= WEATHER_INJECT_RULES.tempDiff) {
                events.push({ hours: 24, text: `明天此时${presetName}约${samePhaseTemp}℃，较当前${currentTemp}℃明显升温` });
            } else if (-diff >= WEATHER_INJECT_RULES.tempDiff) {
                events.push({ hours: 24, text: `明天此时${presetName}约${samePhaseTemp}℃，较当前${currentTemp}℃明显降温` });
            }
        }
    }

    // 3. 大风（当前未达阈值、未来达到阈值），取最早一次
    const currentWind = _parseWindScale(now.windScale);
    if (!(currentWind >= WEATHER_INJECT_RULES.windScale)) {
        const windy = hourly.find(h => _parseWindScale(h.windScale) >= WEATHER_INJECT_RULES.windScale);
        if (windy) {
            const hours = _hoursAhead(windy.fxTime);
            events.push({ hours: hours === null ? 999 : hours, text: `约${hours === null ? '数' : hours}小时后${presetName}将有${windy.windDir || ''}${windy.windScale}级大风` });
        }
    }

    // 4. 无天气转变但降水概率高：可能下雨
    if (!transition && _weatherCategory(now.text) !== '雨') {
        const pops = hourly.map(h => parseInt(h.pop, 10)).filter(p => !isNaN(p));
        if (pops.length && Math.max(...pops) >= WEATHER_INJECT_RULES.popMin) {
            events.push({ hours: 999, text: `未来24小时内${presetName}有降雨可能（降水概率最高${Math.max(...pops)}%）` });
        }
    }

    events.sort((a, b) => a.hours - b.hours);
    return events.slice(0, WEATHER_INJECT_RULES.maxAlerts).map(e => e.text);
}

/**
 * 记录并比对该聊天上次读到的天气类别，返回要并进首句的"变化前天气"文字（无变化返 ''）。
 * - key 带 locationId：换地点预设时不该误报"从雨转晴"。
 * - 只认跨类别变化（沿用 _weatherCategory 的口径，晴↔多云不报）。
 * - 说完一次不够：AI 那一轮未必用得上，所以连带 WEATHER_DELTA_REPEAT 次注入。
 * - 必须在拿到**有效实况**之后才调用，失败路径不能污染基线。
 */
function _computeWeatherDelta(chat, locationId, now) {
    const key = `${(chat && chat.id) || 'unknown'}::${locationId}`;
    const category = _weatherCategory(now.text);
    const text = now.text || '未知';
    const stamp = Date.now();
    const prev = _weatherLastSeen.get(key);
    // at 记的是"上次观测时刻"，每轮都刷新；TTL 防的是隔了很久回来——那时的 prev 已经不配叫"刚"
    const save = (fromText, left) => {
        _weatherLastSeen.set(key, { category, text, at: stamp, fromText, left });
        return fromText;
    };

    if (!prev) return save('', 0);
    const fresh = (stamp - prev.at) <= WEATHER_DELTA_TTL_MS;
    if (prev.category !== category) {
        return fresh ? save(prev.text, WEATHER_DELTA_REPEAT - 1) : save('', 0);
    }
    if (prev.left > 0 && fresh) return save(prev.fromText, prev.left - 1);
    return save('', 0);
}

/**
 * 获取某聊天的天气句子（纯句子，不带方括号块、不带收尾句、不带句号）。
 * 例：「辉城目前的天气是小雨，温度18℃，湿度85%」
 * 排版与"不要主动提及天气"这类约束由 private_prompt.js 那边跟时间一起说。
 * 仅在用户触发该聊天 AI 回复时调用；失败/未配置/关闭时返回空字符串，绝不影响正常回复。
 */
async function getWeatherPromptContext(chat) {
    const resolved = _resolveWeatherPresetForChat(chat);
    if (!resolved) return '';
    const { settings, preset } = resolved;
    // 预报按聊天开关，默认关（undefined 视为 false）：预报会诱导 AI 主动提"看天气预报"
    const forecastEnabled = !!chat.weatherForecastEnabled;

    // 额度硬刹车：本次要发几个请求先算清楚，超了就一个都不发（和风超额只会给你发账单，不会报错）
    const forecastCached = (() => {
        const cached = _weatherForecastCache.get(preset.locationId);
        return !!(cached && (Date.now() - cached.fetchedAt) < WEATHER_FORECAST_TTL_MS);
    })();
    const plannedRequests = 1 + (forecastEnabled && !forecastCached ? 1 : 0);
    // 每轮回复都会走这里，所以到限的提示当天只弹一次
    if (!await _reserveWeatherQuota(plannedRequests, { oncePerDay: true })) return '';

    // 实况每次都拉：天气只进 systemPrompt 不进 history，模型每轮无状态、看不到上一轮读数，
    // 所以"缓存能保剧情连贯"不成立，缓存只会让角色读到过时天气。
    const fetchNow = (async () => {
        try {
            const body = await fetchQWeatherNow(settings.apiHost, settings.apiKey, preset.locationId);
            return body.now ? body : null;
        } catch (error) {
            console.warn('天气获取失败，本次不注入：', error);
            return null;
        }
    })();

    // 预报走独立缓存，TTL 写死 1 小时：24h 预报本身不按分钟变，反复拉是白发请求（和风按请求计费）
    const fetchForecast = (async () => {
        if (!forecastEnabled) return null;
        const cached = _weatherForecastCache.get(preset.locationId);
        if (cached && (Date.now() - cached.fetchedAt) < WEATHER_FORECAST_TTL_MS) return cached.payload;
        try {
            const body = await fetchQWeatherHourly24(settings.apiHost, settings.apiKey, preset.locationId);
            if (!Array.isArray(body.hourly)) return null;
            _weatherForecastCache.set(preset.locationId, { fetchedAt: Date.now(), payload: body });
            return body;
        } catch (error) {
            console.warn('天气预报获取失败，本次仅注入实况：', error);
            return null;
        }
    })();

    const [nowPayload, hourlyPayload] = await Promise.all([fetchNow, fetchForecast]);
    if (!nowPayload) return '';

    // 纯句子拼装：不要用方括号块（本项目里 [xxx] 是输出格式保留语法），也不加收尾句
    const prevText = _computeWeatherDelta(chat, preset.locationId, nowPayload.now);
    const parts = [_formatWeatherPromptText(nowPayload.now, preset.name, prevText)];
    if (forecastEnabled && hourlyPayload && hourlyPayload.hourly) {
        const alerts = _buildWeatherAlerts(nowPayload.now, hourlyPayload.hourly, preset.name);
        if (alerts.length) parts.push(alerts.join('；'));
    }
    return parts.join('；');
}
