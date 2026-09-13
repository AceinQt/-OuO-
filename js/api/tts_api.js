// ============================================================
// tts_api.js — 语音合成 API 层（凭据 / 请求 / 响应归一化 / 按秒配额）
// ============================================================
// 这一层只管"怎么跟服务商说话"和"今天还能合成几秒"，不认识任何页面，也不认识聊天。
// 两个消费方：
//   · js/settings/api_settings.js  → 语音设置 tab（管预设、试听、显示今日用量）
//   · js/chat/chat_voice_service.js → 语音消息合成（三层存储状态机的"合成"那一步）
// 依赖方向单向：settings → api、chat → api，两个消费方互不依赖。
//
// ★ 凭据按预设隔离，和生图预设同一套路（见 image_generation_api.js）。
//   apiUrl / apiKey / model 都在**单条预设**里，不是全局共用一份。
//   这样一个角色用豆包、另一个用 MiniMax、甚至同一家两把不同的 Key 可以并存，
//   角色档案只认预设 id，压根不用知道背后是谁。
//   旧版把 Key 定死成全局字段，_normalizeVoiceSettings 会把它继承给缺 Key 的预设。
//
// ── 支持的服务商 ────────────────────────────────────────────
// doubao  ── 火山「音频生成」 POST {apiUrl}/api/v3/tts/create  （model: seed-audio-1.0）
//            文档：https://www.volcengine.com/docs/6561/2550782
//            ★ 鉴权走 query string ?api_key=，不走文档写的 X-Api-Key 头。
//              原因：该端点支持 CORS，但 Access-Control-Allow-Headers 是固定白名单，
//              里面没有 X-Api-Key —— 用头的话浏览器预检就过不去。实测 ?api_key=
//              走的是同一条鉴权路径（dummy key 两种写法都回 45000010，报错完全一致）。
//            ★ 计费按 original_duration 秒。
//
// minimax ── POST {apiUrl}/v1/t2a_v2  （model: speech-2.8-hd 等）
//            鉴权 Authorization: Bearer。该域名的 Access-Control-Allow-Headers 里
//            有 Authorization（已实测 OPTIONS 预检 200），所以能直接从浏览器打。
//            国内 https://api.minimaxi.com，海外 https://api.minimax.io（多个 i 的是国内）。
//            ★ Group ID 是**可选**的：实测国内端点不带它也走同一条鉴权路径
//              （带与不带，dummy key 都回 1004），所以做成选填。填了就拼 ?GroupId=，
//              留空就不拼 —— 有些第三方接入/中转要求带上。
//            ★ 音频回的是 **hex 字符串**（output_format: 'hex'），不是 base64。
//            ★ 业务错误码在 base_resp.status_code 里，且 HTTP 状态仍是 200 ——
//              必须先看 base_resp 再看 HTTP，否则鉴权失败会被当成"成功但没音频"。
//            ★ 计费按字符数，但接口回 extra_info.audio_length（毫秒），折成秒记账。
//
// ★ 配额是"预扣 + 校正"两段：先按字数估一个秒数扣掉，请求回来后用真实时长补上差额。
//   不这么做的话，并发两条会各自判一次上限、一起放过超额的那次。
//
// ★ 有语速和音调，**没有**声音描述和音量。
//   描述那套是往 text_prompt 里拌自然语言，收益不稳定，还会挤占台词的字数上限；
//   语气改由「语音语气要求」注入给语言模型（按角色存，见 chat_voice_settings.js），
//   那是文字层的事，不该在 TTS 这层补。
//   音调一度也被删掉，但克隆音色的基频常常差那么一点点，只有语速补不回来 ——
//   这是唯一能把它掰正的旋钮，所以加回来了。音量仍然不给：播放端的系统音量
//   就能解决，多一个旋钮只多一批没测过的组合。
//
// 对外符号（全局函数，classic script 无模块化，靠命名约定区分归属）：
//   TTS_PROVIDERS / ttsProviderLabel / ttsProviderDef
//   VOICE_FORMAT / VOICE_SAMPLE_RATE / VOICE_CONCURRENCY / VOICE_MIME_TYPE
//   VOICE_TIMEOUT_MS / VOICE_MAX_TEXT_CHARS
//   _normalizeVoiceSettings / _normalizeVoicePreset / _newVoicePresetId / getVoicePreset
//   VOICE_PRESET_OFF / getVoicePresetOptions / resolveVoicePreset / voicePresetReady
//   _voiceTodayKey / _readVoiceQuota / _addVoiceUsage / _reserveVoiceQuota
//   onVoiceUsageChange / estimateVoiceSeconds
//   synthesizeVoice
// ============================================================

// ★ 以下几项刻意定死成常量，不做成设置项。
//   理由：普通用户没法判断这些该填什么，而每多一个可填字段就多一批没测过的组合。
//   定死等于把测试面积缩到一条路。真需要可配的那天再往外暴露，不用现在预留。
//
//   mp3   —— 体积最小，全平台 <audio> 都认，两家都支持
//   24000 —— 实测豆包这个值 5.615 秒音频 45KB（约 64kbps），人声够用。
//            再往上只是让 IndexedDB 和归档仓库变胖，16000 会明显发闷。
//            MiniMax 支持的采样率里也有 24000。
//   并发 2 —— 一次合成要 20 秒以上（豆包），且并发不缩短单次耗时，开大只是一起变慢。
const VOICE_FORMAT = 'mp3';
const VOICE_SAMPLE_RATE = 24000;
const VOICE_CONCURRENCY = 2;
const VOICE_MIME_TYPE = 'audio/mpeg';

// ★ 超时必须给得很宽：实测豆包合成 2.75 秒音频花了 23.3 秒，官方 cURL 示例自己写的是
//   --max-time 300。按常规 10~15 秒设会把几乎所有请求都掐死。
const VOICE_TIMEOUT_MS = 180000;

// 留给"台词"的上限。取两家里更严的那个：豆包整个 text_prompt 卡 2048
// （文档正文写 3000，但错误码表的实例是 `text_prompt length 3961 exceeds maximum of 2048`），
// MiniMax 单次 10000 字符。500 是够用且远离两家上限的值。
const VOICE_MAX_TEXT_CHARS = 500;

// 单次输出时长上界。豆包 120 秒（超了会被截断而不是报错），MiniMax 没有等价限制，
// 统一按这个数夹估算值 —— 它只影响预扣的上界，真实账单以响应里的时长为准。
const VOICE_MAX_DURATION = 120;

// ============================================================
// 服务商表：加一家只改这里 + 给它写一个 _synthesizeXxx
// ============================================================
// value        预设里落库的 provider 值，别改（已有数据认它）
// label        UI 显示名
// defaultUrl   服务商的 API 地址。切服务商时**自动填进输入框**（同文字 API 那边），
//              用户可以改成中转地址；预设里存空值时读取也回落到它
// defaultModel 新建预设时预填的模型
// models       模型下拉的选项；空数组 = 这家不给选模型（豆包只有一个模型）
// needsGroupId true = 显示「Group ID」那一行（只有 MiniMax 有这个概念）
// speed        语速字段的取值范围与默认值。两家口径完全不同：
//              豆包 speech_rate 是整数百分比偏移（0 = 原速）；
//              MiniMax speed 是倍率（1 = 原速）。
//              ★ 所以语速按**服务商各自的刻度**存进预设，不归一化成统一刻度 ——
//                统一刻度就得来回换算，换算有取整误差，而且用户看到的数字
//                对不上官方文档，反而更难填。
// pitch        音调。两家**恰好**同刻度（整数半音，-12~12，0 = 不变），
//              但仍各写一份 —— 靠"恰好相同"来省一份配置，等哪天有一家不同了
//              就会静默发出越界值。字段名不同：豆包 audio_config.pitch_rate，
//              MiniMax voice_setting.pitch。
const TTS_PROVIDERS = [
    {
        value: 'doubao',
        label: '豆包',
        defaultUrl: 'https://openspeech.bytedance.com',
        defaultModel: 'seed-audio-1.0',
        models: [],
        needsGroupId: false,
        speed: { min: -50, max: 100, step: 5, default: 0, integer: true },
        pitch: { min: -12, max: 12, step: 1, default: 0, integer: true }
    },
    {
        value: 'minimax',
        label: 'MiniMax',
        // 国内是 api.minimaxi.com（多一个 i），海外是 api.minimax.io。
        // 两个域名的 CORS 预检都实测过，都放行 Authorization 头。
        defaultUrl: 'https://api.minimaxi.com',
        defaultModel: 'speech-2.8-hd',
        models: ['speech-2.8-hd', 'speech-2.8-turbo', 'speech-2.6-hd', 'speech-2.6-turbo'],
        needsGroupId: true,
        speed: { min: 0.5, max: 2, step: 0.1, default: 1, integer: false },
        pitch: { min: -12, max: 12, step: 1, default: 0, integer: true }
    }
];

/** 服务商定义；未知值一律当豆包（历史数据里没有 provider 字段的就是它） */
function ttsProviderDef(value) {
    return TTS_PROVIDERS.find(p => p.value === value) || TTS_PROVIDERS[0];
}

/** 服务商 → 中文名，用于预设列表的显示文案（`小雨 · 豆包`） */
function ttsProviderLabel(value) {
    const hit = TTS_PROVIDERS.find(p => p.value === value);
    return hit ? hit.label : (value || '未知');
}

// ============================================================
// 配置归一化
// ============================================================

function _newVoicePresetId() {
    return `voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 把一个数值旋钮夹进本服务商的刻度里。
 *
 * ★ 空串必须单独判掉，不能只靠 Number.isFinite —— Number('') 是 0（有限），
 *   会让"没填"被当成 0 倍速然后夹成 MiniMax 的下限 0.5。
 *
 * @param {*} raw      表单/库里读到的原始值，可能是空串、undefined、非数字
 * @param {object} spec { min, max, default, integer } 来自 TTS_PROVIDERS
 */
function _clampVoiceKnob(raw, spec) {
    let value = (raw === undefined || raw === null || raw === '') ? NaN : Number(raw);
    if (!Number.isFinite(value)) value = spec.default;
    value = Math.max(spec.min, Math.min(spec.max, value));
    // 倍率留两位小数，避免 0.1 步进累出 0.7000000000000001 这种值发给服务端
    return spec.integer ? Math.round(value) : Math.round(value * 100) / 100;
}

/**
 * 归一化单条音色预设。
 *
 * ★ 预设自带 provider + apiUrl + apiKey + model —— 服务商和凭据都是预设的属性，
 *   不是全局开关。同生图预设（_normalizeImagePreset）。
 * ★ 第二个参数只在**迁移旧数据**时用：老版本 Key 存在 db.voiceSettings.apiKey，
 *   预设自己没有这个字段，此时借用全局那份。显式空字符串不会借用。
 *
 * @param {object} raw
 * @param {object} [legacyConfig] { apiKey } 老版本的全局凭据
 */
function _normalizeVoicePreset(raw, legacyConfig) {
    const p = raw || {};
    const legacy = legacyConfig || {};
    const provider = TTS_PROVIDERS.some(x => x.value === p.provider) ? p.provider : 'doubao';
    const def = ttsProviderDef(provider);

    // 语速和音调都夹到**本服务商**的范围里，默认值也来自它（语速两家刻度不同）。
    // ★ rates.{speech,pitch} 是老字段（那时候语速/音调/音量三件套装在 rates 里）。
    //   它们和新的 speed / pitch 同刻度，所以能原样搬过来 —— 不搬的话老用户
    //   调好的值会静默归零。音量（rates.loudness）没有对应字段，就是丢掉。
    const rawSpeed = p.speed !== undefined ? p.speed : (p.rates || {}).speech;
    const rawPitch = p.pitch !== undefined ? p.pitch : (p.rates || {}).pitch;

    return {
        id: String(p.id || _newVoicePresetId()).trim(),
        name: String(p.name || '未命名音色').trim() || '未命名音色',
        provider,
        // 留空则用服务商默认地址 —— 存空值而不是存默认值，这样将来改默认地址
        // 老预设会跟着变，不用逐条迁移。
        apiUrl: String(p.apiUrl || '').trim(),
        apiKey: p.apiKey !== undefined
            ? String(p.apiKey).trim()
            : String(legacy.apiKey || '').trim(),
        model: String(p.model || def.defaultModel).trim() || def.defaultModel,
        speakerId: String(p.speakerId || '').trim(),
        // MiniMax 账户下的 GroupId（控制台「账户信息」里那个 19 位数字）。
        // ★ 实测国内 api.minimaxi.com 的 t2a_v2 **不带它也能过鉴权**（带与不带
        //   都回同一个 1004），所以这里不当必填。但有些部署/中转要求把它拼在
        //   query 上（不少第三方接入文档也这么写），填了就带上，留空就不带。
        groupId: String(p.groupId || '').trim(),
        speed: _clampVoiceKnob(rawSpeed, def.speed),
        pitch: _clampVoiceKnob(rawPitch, def.pitch)
    };
}

/** 这条预设配齐了没（能不能真的发请求）。UI 和自动合成闸门共用这一个判据 */
function voicePresetReady(preset) {
    return !!(preset && preset.apiKey && preset.speakerId);
}

/**
 * 把 db.voiceSettings 归一化成一个字段齐全、类型正确的对象。
 * 所有读配置的地方都要过这一层，别直接摸 db.voiceSettings —— 那可能是 undefined，
 * 也可能是上个版本留下的半截结构。
 *
 * ★ 注意这里没有 format / sampleRate / concurrency —— 它们是常量（见文件顶部）。
 * ★ 也没有 model / endpoint —— 凭据和端点都下沉到单条预设里了。顶层保留的
 *   `apiKey` 只是**迁移用的遗留字段**：老版本 Key 存在这儿，会被喂给缺 Key 的预设。
 *   新代码一律读预设自己的 apiKey，别再往这个字段写新值。
 * ★ 也没有 cloud —— 归档仓库挪去 db.githubBindings.voice 了，因为仓库是可被
 *   备份/语音/图像共用的资源，不该当成语音的私有字段。
 */
function _normalizeVoiceSettings(raw) {
    const source = raw || {};
    const posInt = (value, fallback) => {
        const n = Math.floor(Number(value));
        return n > 0 ? n : fallback;
    };
    // posInt 把 0 和负数都当"没填"回落到默认值，这对有下限的字段是错的：
    // 用户填 0 是有意图的（"别缓存"），应该给他最接近的可行值，而不是无声跳回默认。
    // 只有真的没填或填了非数字才回落默认。
    const intWithFloor = (value, fallback, floor) => {
        if (value === undefined || value === null || value === '') return fallback;
        const n = Math.floor(Number(value));
        return Number.isFinite(n) ? Math.max(floor, n) : fallback;
    };

    // 老版本的全局 Key，只喂给"自己没有 apiKey 字段"的预设（见 _normalizeVoicePreset）
    const legacyConfig = { apiKey: String(source.apiKey || '').trim() };

    const usedIds = new Set();
    const presets = [];
    if (Array.isArray(source.voicePresets)) {
        source.voicePresets
            .filter(p => p && typeof p === 'object' && (p.id || p.speakerId))
            .forEach(rawPreset => {
                const preset = _normalizeVoicePreset(rawPreset, legacyConfig);
                if (!preset.id || usedIds.has(preset.id)) preset.id = _newVoicePresetId();
                usedIds.add(preset.id);
                presets.push(preset);
            });
    }

    // ★ 刻意没有"全局默认音色"这个概念。
    //   语音跟文字 API 不一样：文字 API 不配就整个功能不能用，所以必须有个默认；
    //   而语音天生有"不使用"这个合法状态。有默认值只会带来一种后果 ——
    //   用户没给某个角色选音色，点播放（而点播放是必然的，要看文字内容就得点）
    //   却听到一个自己没选过的声音，甚至不知道这个角色被打开了语音。
    //   所以角色不选就是不出声，想用自然会去选。
    return {
        // 总闸和自动合成由 chat-list 侧边栏那个弹窗编辑，不在 API tab 里。
        // 但数据还是放这一个键 —— UI 在哪不决定数据在哪，两边都用展开合并写回就不会互相冲掉。
        //
        // ★ 两个默认值方向相反，都是有意的：
        //   enabled 默认开 —— 配好预设就能直接用，不用再想起来回侧边栏开一次。
        //     它开着但没建预设时不会产生任何请求，所以默认开是安全的。
        //   autoSynthesize 默认关 —— 自动合成会在消息一到达就产生费用。装好就默默开始
        //     计费是不能接受的，让用户主动开。默认值要偏保守那一边。
        enabled: source.enabled !== false,
        autoSynthesize: !!source.autoSynthesize,

        // 遗留字段，仅供上面的迁移逻辑读
        apiKey: legacyConfig.apiKey,

        voicePresets: presets,

        maxTextChars: Math.min(
            posInt(source.maxTextChars, 120),
            VOICE_MAX_TEXT_CHARS
        ),

        // 0 = 不限制。两家都是额度用完就报错，不像和风那样直接发账单，
        // 所以硬闸门默认关着。留着它是为了兜住"我自己写的 bug 导致反复重合成"
        // 这类安静烧额度的故障 —— 数字不对劲时填个上限就能立刻刹住。
        dailySecondLimit: Number(source.dailySecondLimit) > 0
            ? Math.floor(Number(source.dailySecondLimit)) : 0,
        dailySecondUsed: Number(source.dailySecondUsed) > 0
            ? Number(source.dailySecondUsed) : 0,
        dailyCountDate: source.dailyCountDate || '',

        // 默认 10MB。手机浏览器的 IndexedDB 配额是全 app 共享的，缓存开大有可能
        // 把配额挤爆导致消息写入失败 —— 用可再生的缓存挤掉不可再生的聊天记录，不划算。
        // 下限 1MB：归档关闭时缓存是唯一副本，填 0 会让语音合成完还没点播放就被淘汰。
        cacheLimitMB: intWithFloor(source.cacheLimitMB, 10, 1)
    };
}

/** db 可能还没就绪（测试环境、或 loadData 之前），统一在这里兜住 */
function _voiceSettingsSource(settings) {
    if (settings) return settings;
    if (typeof db !== 'undefined' && db && db.voiceSettings) return db.voiceSettings;
    return {};
}

/**
 * 按 id 取音色预设。
 * ★ 没有"传空回落默认"这回事 —— 不存在全局默认音色（原因见 _normalizeVoiceSettings）。
 * @returns {object|null} 归一化后的预设，找不到返回 null（调用方一律先判空）
 */
function getVoicePreset(presetId, settings) {
    const wanted = String(presetId || '').trim();
    if (!wanted || wanted === VOICE_PRESET_OFF) return null;
    const config = _normalizeVoiceSettings(_voiceSettingsSource(settings));
    return config.voicePresets.find(p => p.id === wanted) || null;
}

// 角色身上 voicePresetId 表示"不使用语音"的值。
// ★ 用显式哨兵而不是空串，因为 <select> 拿到的空值和字段压根不存在在 JS 里
//   几乎分不开，混起来必然出 bug。预设 id 形如 voice-<时间戳>-<随机>，不会撞。
// ★ 这也是**默认值** —— 没设过音色的角色就是不出声。
const VOICE_PRESET_OFF = 'off';

/**
 * 音色下拉的选项数据。只给数据不碰 DOM —— 私聊侧栏、群成员编辑等多处都要用，
 * 各自渲染，但"有哪些选项、怎么标注"只在这里定义一次。
 * 第一项固定是"不使用语音"，它同时是默认选中项。
 * @returns {Array<{value: string, label: string}>}
 */
function getVoicePresetOptions(settings) {
    const config = _normalizeVoiceSettings(_voiceSettingsSource(settings));
    return [
        { value: VOICE_PRESET_OFF, label: '不使用语音' },
        ...config.voicePresets.map(p => ({
            value: p.id,
            label: `${p.name} · ${ttsProviderLabel(p.provider)}`
        }))
    ];
}

/**
 * 把角色身上存的 voicePresetId 解析成真正要用的预设。
 *
 * 两态：
 *   字段不存在 / 'off' / 空 → 不给这个角色配音（这是默认）
 *   '<预设 id>'             → 用指定的那个；预设被删掉了也当没有
 *
 * @returns {object|null} null = 这个角色不该出语音
 */
function resolveVoicePreset(voicePresetId, settings) {
    return getVoicePreset(voicePresetId, settings);
}

// ============================================================
// 按秒配额：超额不会拒绝请求，本地计数器是唯一防线
// ============================================================

/** 本地日期 YYYY-MM-DD（不管哪个时区，0 点到 0 点总是 24 小时） */
function _voiceTodayKey() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// 当天已经提示过上限的日期，避免每条语音消息都弹一次
let _voiceLimitToastDate = '';

// 用量变化订阅者。这一层不认识任何 DOM：设置页要显示"今日已用 N 秒"就自己来登记，
// 页面不在（比如后台自动合成时记的账）就没人被通知，不需要写 if (!el) return 这种越层判断。
const _voiceUsageListeners = [];

/**
 * 登记用量变化回调（设置页在 initVoiceApiTab 里注册一次）。
 * @param {Function} fn 无参回调，异常会被吞掉并打 warn，不影响记账主流程
 */
function onVoiceUsageChange(fn) {
    if (typeof fn === 'function') _voiceUsageListeners.push(fn);
}

function _emitVoiceUsageChange() {
    _voiceUsageListeners.forEach(fn => {
        try { fn(); } catch (error) { console.warn('语音用量回调执行失败：', error); }
    });
}

/** 读当日额度状态；日期对不上视为已归零（真正落库在 _addVoiceUsage） */
function _readVoiceQuota() {
    const settings = _normalizeVoiceSettings(_voiceSettingsSource());
    const today = _voiceTodayKey();
    return {
        today,
        limit: settings.dailySecondLimit,
        used: settings.dailyCountDate === today ? settings.dailySecondUsed : 0
    };
}

/**
 * 记账并落库；跨日在这里一并归零。
 * @param {number} seconds 可以是负数（预扣估多了要退回来），总量下限夹到 0
 */
async function _addVoiceUsage(seconds) {
    if (!seconds) return;
    const { today, used } = _readVoiceQuota();
    db.voiceSettings = {
        ...(db.voiceSettings || {}),
        dailySecondUsed: Math.max(0, Math.round((used + seconds) * 100) / 100),
        dailyCountDate: today
    };
    try {
        await saveGlobalKeys(['voiceSettings']);
    } catch (error) {
        console.warn('语音用量落库失败：', error);
    }
    _emitVoiceUsageChange();
}

/**
 * 发合成请求前的统一闸门：超额直接拦下，没超就预扣 seconds 秒。
 * ★ 所有真会打到服务商的地方都必须走这里，漏一处计数就不准。
 * @param {number} seconds 本次估计会产生多少秒音频
 * @param {object} opts oncePerDay=true 时当天只提示一次（给后台自动合成用，
 *                      它每条语音消息都会走，不能每次都弹）
 * @returns {Promise<boolean>} false = 已超额，调用方应直接放弃
 */
async function _reserveVoiceQuota(seconds, { oncePerDay = false } = {}) {
    const quota = _readVoiceQuota();
    // 上限 0 = 不限制。仍然记账 —— 计数器是"反复重合成"这类安静故障的唯一可见信号，
    // 关掉闸门不等于关掉仪表盘。
    if (quota.limit <= 0) {
        await _addVoiceUsage(seconds);
        return true;
    }
    if (quota.used + seconds > quota.limit) {
        if (!oncePerDay || _voiceLimitToastDate !== quota.today) {
            if (oncePerDay) _voiceLimitToastDate = quota.today;
            showToast(`语音合成已达今日上限（${quota.limit} 秒），今天不再合成`);
        }
        return false;
    }
    // 预扣：请求一旦发出就已经计入账单，哪怕它失败了
    await _addVoiceUsage(seconds);
    return true;
}

// 预扣用的估算系数（字/秒）。刻意压得很低 —— 这个数只能偏保守，不能偏乐观。
//
// 实测数据点（豆包，同一个音色、同一句台词量级，时长差了 2.2 倍）：
//   16 字 → 2.7481 秒（5.82 字/秒）
//   15 字 → 5.6150 秒（2.67 字/秒）
// 字数根本不是个好的预测器：模型即兴加的停顿和呼吸都会成倍改变时长。
// 所以别试图估准，只保证不估低。
//
// ★ 保守估算几乎不花成本：预扣之后马上就用响应里的真实时长校正回来，
//   落库的计数始终是准的。多估的那部分只占用一次请求的时间（20 秒上下），
//   唯一的副作用是贴着上限时会稍微提前拦一次。拿这个换"绝不因为估低而漏账单"，划算。
const VOICE_CHARS_PER_SECOND = 2;

/**
 * 按字数估合成秒数，供配额预扣用。请求回来后会用真实时长校正，
 * 所以这里唯一的要求是"宁高不低"。
 */
function estimateVoiceSeconds(text) {
    const len = String(text || '').trim().length;
    if (!len) return 0;
    return Math.min(
        VOICE_MAX_DURATION,
        Math.max(1, Math.ceil(len / VOICE_CHARS_PER_SECOND))
    );
}

// ============================================================
// 错误处理：把错误码转成能直接摆给用户看的话
// ============================================================

/**
 * 造一个带附加信息的 Error。message 已是可直接展示的文案。
 * @param {object} extra 常用附加字段：
 *   retryable    再打一次可能就好了，供上层的重试队列判断
 *   quotaBlocked 被本地配额拦下，上层应静默放弃
 *   billed=false 服务端没受理，预扣的秒数要退回来
 *   code / logid 排查用
 */
function _voiceError(message, extra = {}) {
    const error = new Error(message);
    Object.assign(error, { retryable: false }, extra);
    return error;
}

// 豆包文档：https://www.volcengine.com/docs/6561/2534853
// retry=true 的是"再打一次可能就好了"；其余都是要人去改配置或改内容的，
// 重试只会白花钱。
const DOUBAO_TTS_ERRORS = {
    45000000: { msg: '请求被网关拒绝，可能是并发超限或请求体过大', retry: true },
    45000010: { msg: 'API Key 无效。请确认它来自语音技术控制台的「API Key 管理」，而不是方舟/ModelArk 的 Key —— 那个不能用于语音接口' },
    45000030: { msg: '账号没有「音频生成」服务的权限。去语音技术控制台开通该服务（它和「语音合成大模型」是两个独立商品，开了后者不等于开了前者）' },
    45001001: { msg: '请求参数不合法' },
    45001104: { msg: '声纹检测未通过' },
    45001115: { msg: '音色 ID 不存在。预置音色请核对拼写，复刻音色请确认 S_xxx 已训练完成（状态 2 或 4）' },
    45001116: { msg: '文本过长。降低单条语音的最长字数' },
    45001125: { msg: '文本没通过内容审核' },
    45001127: { msg: '音频没通过内容审核' },
    55001309: { msg: '火山内部合成失败', retry: true },
    55001310: { msg: '合成出的音频没通过安全审核', retry: true },
    55001311: { msg: '合成出的音频没通过声纹检查', retry: true }
};

// MiniMax 的业务错误码在 base_resp.status_code 里（0 = 成功）。
// 实测：dummy key → 1004 "login fail: Please carry the API secret key..."
const MINIMAX_TTS_ERRORS = {
    1000: { msg: 'MiniMax 内部未知错误', retry: true },
    1001: { msg: 'MiniMax 服务端超时', retry: true },
    1002: { msg: '触发限流（同一把 Key 并发太多），稍后再试', retry: true },
    1004: { msg: 'API Key 无效或已过期。到 MiniMax 开放平台「账户管理 > 接口密钥」重新复制，注意别带首尾空格' },
    1008: { msg: '账户余额不足。去 MiniMax 控制台充值，或确认赠送额度还没过期' },
    1013: { msg: '服务内部错误，通常是参数组合不被支持' },
    1026: { msg: '文本没通过内容审核' },
    1027: { msg: '合成出的音频没通过内容审核' },
    1039: { msg: '触发 TPM 限流，稍后再试', retry: true },
    2013: { msg: '请求参数不合法。先核对音色 ID 和模型名（模型名用连字符，例如 speech-2.8-hd）' },
    2039: { msg: '音色 ID 不存在，或它不属于这个账号' }
};

/**
 * 业务错误码 → 人话。未收录的码原样带上，方便对着文档查。
 * ★ 两家共用这一个函数：它们的差异只有"码表"和"请求 id 叫什么"，
 *   各写一份只会让两边的文案格式慢慢漂移。
 */
function _describeTtsError(table, code, rawMessage, requestId, idLabel) {
    const known = table[Number(code)];
    const tail = requestId ? `（${idLabel} ${requestId}）` : '';
    if (known) {
        return _voiceError(`${known.msg}${tail}`, {
            code, retryable: !!known.retry, logid: requestId, rawMessage
        });
    }
    const detail = String(rawMessage || '').trim();
    return _voiceError(
        `语音合成失败（错误码 ${code}${detail ? `：${detail}` : ''}）${tail}`,
        { code, retryable: false, logid: requestId, rawMessage }
    );
}

// ============================================================
// 字节解码
// ============================================================

/**
 * hex 字符串 → 字节。MiniMax 的 t2a_v2 用 output_format: 'hex' 回音频。
 * ★ 为什么用 hex 而不是让它回 url：url 有有效期，还多一次跨源请求；
 *   hex 是纯 ASCII、没有 base64 那种 padding 分歧，长度翻倍但这个体量无所谓。
 */
function _hexToBytes(hex) {
    const clean = String(hex || '').trim();
    if (!clean || clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) {
        throw _voiceError('音频数据不是合法的 hex 字符串', { retryable: true });
    }
    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
}

/**
 * 从豆包响应体里取出音频字节。
 * ★ 实测该接口 audio 和 url 都会给，所以优先 audio —— 省一次请求，
 *   也不用操心 url 那 2 小时的有效期。url 分支是防御性的：万一哪天服务端
 *   对长音频只给 url，这里能自动兜住（探针已验证那个 url 可跨源读取）。
 */
async function _extractDoubaoAudio(payload) {
    const mime = VOICE_MIME_TYPE;

    if (typeof payload.audio === 'string' && payload.audio) {
        // base64ToBytes 在 js/core/utils.js —— 上传下载也要用，放 core 避免各写一份
        return { bytes: base64ToBytes(payload.audio), mime, source: 'audio' };
    }

    if (typeof payload.url === 'string' && payload.url) {
        let response;
        try {
            response = await fetch(payload.url);
        } catch (error) {
            throw _voiceError(`音频地址读取失败：${error.message}`, { retryable: true });
        }
        if (!response.ok) {
            throw _voiceError(`音频地址返回 HTTP ${response.status}`, { retryable: true });
        }
        const buffer = await response.arrayBuffer();
        return {
            bytes: new Uint8Array(buffer),
            mime: response.headers.get('Content-Type') || mime,
            source: 'url'
        };
    }

    throw _voiceError('响应里既没有 audio 也没有 url，拿不到音频');
}

// ============================================================
// 端点拼装
// ============================================================

/** 去掉尾斜杠；预设留空则回落到服务商默认地址 */
function _voiceBaseUrl(preset) {
    const raw = String(preset.apiUrl || '').trim().replace(/\/+$/, '');
    return raw || ttsProviderDef(preset.provider).defaultUrl;
}

/**
 * 豆包端点。用户可能只填域名，也可能把整条路径都贴进来，两种都认。
 * ★ 鉴权拼在 query 里（原因见文件头的 CORS 说明）。
 *   代价：key 会出现在 URL 里可能被中间日志记录。但它本来就明文存在本机 IndexedDB，
 *   风险等级一致，且换成代理就得引入一个我们不控制的中间服务。
 */
function _buildDoubaoEndpoint(preset) {
    let base = _voiceBaseUrl(preset);
    if (!/\/api\/v3\/tts\/create$/.test(base)) base = `${base}/api/v3/tts/create`;
    return `${base}?api_key=${encodeURIComponent(preset.apiKey)}`;
}

/**
 * MiniMax 端点。填 `https://api.minimaxi.com`、带 `/v1`、或整条路径都认。
 *
 * ★ 必须先把 query 摘开再判路径后缀 —— 用户贴过来的地址可能自带 `?tag=a`，
 *   直接对整串做 `/\/t2a_v2$/` 匹配会判不中，然后在 query 后面再接一段路径，
 *   拼出 `...t2a_v2?tag=a/v1/t2a_v2` 这种烂 URL。
 * ★ 填了 Group ID 就拼上 `GroupId=`。实测官方端点不带它也能过鉴权，
 *   但不少第三方接入（和部分中转）要求带上，所以填了就带、留空就不带。
 */
function _buildMinimaxEndpoint(preset) {
    const raw = _voiceBaseUrl(preset);
    const cut = raw.indexOf('?');
    const path = (cut >= 0 ? raw.slice(0, cut) : raw).replace(/\/+$/, '');
    const query = cut >= 0 ? raw.slice(cut + 1) : '';

    let endpoint;
    if (/\/t2a_v2$/.test(path)) endpoint = path;
    else if (/\/v\d+$/.test(path)) endpoint = `${path}/t2a_v2`;
    else endpoint = `${path}/v1/t2a_v2`;

    const params = [];
    if (query) params.push(query);
    if (preset.groupId) params.push(`GroupId=${encodeURIComponent(preset.groupId)}`);
    return params.length ? `${endpoint}?${params.join('&')}` : endpoint;
}

// ============================================================
// 各服务商的合成实现
// ============================================================
// 两个 _synthesizeXxx 的契约完全一致，加一家照这个形状再写一个：
//   入参 (preset, text, fetchOptions)
//   出参 { bytes, mime, source, duration, logid }   duration 单位秒，拿不到给 0
//   出错抛 _voiceError（message 可直接展示；服务端没受理的带 billed:false）
// 配额、超时、取消都在外层 synthesizeVoice 里统一处理，这两个函数不管。

async function _synthesizeDoubao(preset, text, fetchOptions) {
    const body = {
        model: preset.model || ttsProviderDef('doubao').defaultModel,
        // ★ 只发台词。原先这里会把「声音描述」拌成 `{描述}说道："{台词}"`，
        //   已经去掉 —— 语气改由「语音语气要求」注入给语言模型，不在 TTS 这层拌。
        text_prompt: text,
        references: [{ speaker: preset.speakerId }],
        audio_config: {
            format: VOICE_FORMAT,
            sample_rate: VOICE_SAMPLE_RATE,
            speech_rate: preset.speed
        }
    };
    // 音调 0 = 不变，此时整个字段不发 —— 让"没调过音调"的请求和加这个功能之前
    // 逐字节一致，免得某个音色对 pitch_rate:0 和缺省的处理有细微差别。
    if (preset.pitch) body.audio_config.pitch_rate = preset.pitch;

    let response;
    try {
        response = await fetch(_buildDoubaoEndpoint(preset), {
            method: 'POST',
            headers: {
                // ★ 只有这两个头。X-Api-Key 不在 CORS 白名单里，所以 key 走 query。
                //   X-Api-Request-Id 在白名单里（已实测），带上是为了出问题时能对 logid。
                'Content-Type': 'application/json',
                'X-Api-Request-Id': _voiceRequestId()
            },
            body: JSON.stringify(body),
            ...fetchOptions
        });
    } catch (error) {
        throw _voiceError(`连接语音服务失败：${error.message}`,
            { retryable: true, billed: false, cause: error });
    }

    const logid = response.headers.get('X-Tt-Logid') || '';

    let payload = null;
    try {
        payload = await response.json();
    } catch (_) { /* 下面按 HTTP 状态处理 */ }

    if (payload && payload.code && Number(payload.code) !== 0) {
        // 业务报错 → 按火山的口径，请求已经处理过了，预扣不退
        throw _describeTtsError(DOUBAO_TTS_ERRORS, payload.code, payload.message, logid, 'Logid');
    }
    if (!response.ok) {
        throw _voiceError(
            `语音合成失败（HTTP ${response.status}）${logid ? `（Logid ${logid}）` : ''}`,
            { retryable: response.status >= 500, logid, billed: false }
        );
    }
    if (!payload) throw _voiceError('语音服务返回了无法解析的内容', { retryable: true, logid });

    const audio = await _extractDoubaoAudio(payload);
    return {
        bytes: audio.bytes,
        mime: audio.mime,
        source: audio.source,
        // 账单按 original_duration 走；duration 是最终音频长度（受语速影响）
        duration: Number(payload.original_duration) || Number(payload.duration) || 0,
        logid
    };
}

async function _synthesizeMinimax(preset, text, fetchOptions) {
    const body = {
        model: preset.model || ttsProviderDef('minimax').defaultModel,
        text,
        stream: false,
        voice_setting: {
            voice_id: preset.speakerId,
            speed: preset.speed
        },
        audio_setting: {
            sample_rate: VOICE_SAMPLE_RATE,
            format: VOICE_FORMAT,
            channel: 1
        },
        // ★ 刻意不发 emotion：speech-2.8 系列会自己按文本匹配情绪，
        //   手填一个固定值反而会把每句话都压成同一种语气。
        // ★ 也不发 language_boost：缺省就是 auto（按文本自动判断）。
        output_format: 'hex'
    };
    // 同豆包：音调 0 就整个字段不发，保持和加这个功能之前一致
    if (preset.pitch) body.voice_setting.pitch = preset.pitch;

    let response;
    try {
        response = await fetch(_buildMinimaxEndpoint(preset), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                // Authorization 在 MiniMax 的 CORS 白名单里（已实测预检 200），
                // 所以这家能规规矩矩用请求头，不用像豆包那样把 key 塞进 query。
                'Authorization': `Bearer ${preset.apiKey}`
            },
            body: JSON.stringify(body),
            ...fetchOptions
        });
    } catch (error) {
        throw _voiceError(`连接语音服务失败：${error.message}`,
            { retryable: true, billed: false, cause: error });
    }

    const traceId = response.headers.get('Trace-Id') || '';

    let payload = null;
    try {
        payload = await response.json();
    } catch (_) { /* 下面按 HTTP 状态处理 */ }

    // ★ 必须先看 base_resp 再看 HTTP 状态：MiniMax 把业务错误也放在 HTTP 200 里，
    //   反过来判断的话鉴权失败会被当成"成功但没音频"，报错完全指错方向。
    const baseResp = (payload && payload.base_resp) || null;
    if (baseResp && Number(baseResp.status_code) !== 0) {
        throw _describeTtsError(MINIMAX_TTS_ERRORS,
            baseResp.status_code, baseResp.status_msg, traceId, 'Trace');
    }
    if (!response.ok) {
        throw _voiceError(
            `语音合成失败（HTTP ${response.status}）${traceId ? `（Trace ${traceId}）` : ''}`,
            { retryable: response.status >= 500, logid: traceId, billed: false }
        );
    }
    if (!payload) {
        throw _voiceError('语音服务返回了无法解析的内容', { retryable: true, logid: traceId });
    }

    const audioHex = payload.data && payload.data.audio;
    if (!audioHex) {
        throw _voiceError('响应里没有音频数据', { retryable: true, logid: traceId });
    }

    // audio_length 是毫秒。MiniMax 其实按字符计费，但本地配额是秒制（豆包定的），
    // 统一折成秒记账 —— 这个计数器的作用是"发现异常烧量"，不是复现账单。
    const audioLength = Number((payload.extra_info || {}).audio_length);
    const duration = audioLength > 0 ? Math.round(audioLength / 10) / 100 : 0;

    return {
        bytes: _hexToBytes(audioHex),
        mime: VOICE_MIME_TYPE,
        source: 'audio',
        duration,
        logid: traceId
    };
}

const _VOICE_SYNTHESIZERS = {
    doubao: _synthesizeDoubao,
    minimax: _synthesizeMinimax
};

// ============================================================
// 主入口
// ============================================================

/** 没有 crypto.randomUUID 的兜底：明文 http 局域网调试下它是 undefined（要 secure context） */
function _voiceRequestId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

/**
 * 合成一段语音。这是本模块唯一会真的打到服务商的函数。
 *
 * 内部按顺序做：闸门检查 → 配额预扣 → 按 provider 分派请求 → 用真实时长校正配额。
 * 配额在这里面扣，调用方不要自己再扣一遍。
 *
 * @param {object}  args
 * @param {string}  args.text     要说出来的那句话
 * @param {object}  args.profile  音色预设 { provider, apiUrl, apiKey, model, speakerId, speed, pitch }
 *                                ★ 凭据来自预设本身，不再读任何全局 Key
 * @param {object} [args.settings] 老数据迁移用（预设缺 apiKey 时借它的顶层 apiKey）
 * @param {boolean}[args.quotaOncePerDay] 超额提示当天只弹一次（后台自动合成传 true）
 * @param {AbortSignal} [args.signal] 外部取消信号，会和内部超时叠加
 *
 * @returns {Promise<{bytes: Uint8Array, mime: string, format: string,
 *                    duration: number, originalDuration: number,
 *                    source: string, logid: string, prompt: string}>}
 * @throws {Error} message 已是可直接展示的文案。附加字段：
 *                 quotaBlocked=true → 超额被拦（上层应静默放弃，不要报错打扰用户）
 *                 retryable=true    → 值得重试
 *                 code / logid      → 排查用
 */
async function synthesizeVoice({ text, profile, settings, quotaOncePerDay = false, signal } = {}) {
    // ★ 再归一化一遍：试听路径传进来的是"表单上还没保存"的预设，可能有越界的语速/音调
    //   或缺字段。settings 只用于把老数据的全局 Key 补给缺 Key 的预设。
    const preset = _normalizeVoicePreset(profile || {},
        settings ? { apiKey: String(settings.apiKey || '').trim() } : undefined);

    // ── 闸门：这些都不该走到发请求那一步 ──────────────────────────
    const synthesize = _VOICE_SYNTHESIZERS[preset.provider];
    if (!synthesize) throw _voiceError(`不认识的语音服务商：${preset.provider}`);
    if (!preset.apiKey) throw _voiceError(`音色预设「${preset.name}」还没填 API Key`);
    if (!preset.speakerId) throw _voiceError(`音色预设「${preset.name}」还没填音色 ID`);

    const line = String(text || '').trim();
    if (!line) throw _voiceError('没有可合成的文本');

    // ── 配额预扣 ────────────────────────────────────────────────
    const estimate = estimateVoiceSeconds(line);
    const passed = await _reserveVoiceQuota(estimate, { oncePerDay: quotaOncePerDay });
    if (!passed) {
        throw _voiceError('已达今日语音合成上限', { quotaBlocked: true });
    }

    // 内部超时 + 外部取消。项目里其余 fetch 都没有超时保护，这一层不重复那个坑：
    // 一个挂起的请求在移动网络下能永远卡住上层的合成队列。
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VOICE_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    if (signal) {
        if (signal.aborted) controller.abort();
        else signal.addEventListener('abort', onAbort, { once: true });
    }

    let result;
    try {
        result = await synthesize(preset, line, { signal: controller.signal });
    } catch (error) {
        // 服务端没受理就没产生账单，预扣退回来（billed:false 由各 _synthesizeXxx 标注）。
        // 已被受理的业务错误不退 —— 那笔钱已经花了。
        if (error.billed === false) await _addVoiceUsage(-estimate);

        if (error.cause && error.cause.name === 'AbortError') {
            const external = signal && signal.aborted;
            throw _voiceError(
                external ? '语音合成已取消'
                         : `语音合成超时（超过 ${Math.round(VOICE_TIMEOUT_MS / 1000)} 秒）`,
                { retryable: !external, aborted: true }
            );
        }
        throw error;
    } finally {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
    }

    // ── 配额校正：真实账单以响应里的时长为准 ────────────────────
    if (result.duration > 0) await _addVoiceUsage(result.duration - estimate);

    return {
        bytes: result.bytes,
        mime: result.mime || VOICE_MIME_TYPE,
        source: result.source || 'audio',
        format: VOICE_FORMAT,
        duration: result.duration,
        // originalDuration 是老字段名，试听和播放器都读它，保留以免改一串调用点
        originalDuration: result.duration,
        logid: result.logid || '',
        // 发给服务商的就是台词本身（不再拼描述）。留着这个字段是因为试听结果里
        // 会显示它，让用户确认"发过去的确实是这句"。
        prompt: line
    };
}
