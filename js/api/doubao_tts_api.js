// ============================================================
// doubao_tts_api.js — 豆包「音频生成」API 层（凭据 / 请求 / 响应归一化 / 按秒配额）
// ============================================================
// 这一层只管"怎么跟火山说话"和"今天还能合成几秒"，不认识任何页面，也不认识聊天。
// 两个消费方：
//   · js/settings/api_settings.js  → 语音设置 tab（填 Key、试听、显示今日用量）
//   · js/chat/chat_voice_service.js → 语音消息合成（三层存储状态机的"合成"那一步）
// 依赖方向单向：settings → api、chat → api，两个消费方互不依赖。
//
// 接口：POST https://openspeech.bytedance.com/api/v3/tts/create   （model: seed-audio-1.0）
// 文档：https://www.volcengine.com/docs/6561/2550782
//
// ★ 鉴权走 query string ?api_key=，不走文档写的 X-Api-Key 头。
//   原因：该端点支持 CORS，但 Access-Control-Allow-Headers 是固定白名单，里面没有
//   X-Api-Key —— 用头的话浏览器预检就过不去。实测 ?api_key= 走的是同一条鉴权路径
//   （dummy key 两种写法都回 45000010 Invalid X-Api-Key，报错完全一致）。
//   代价：key 会出现在 URL 里可能被中间日志记录。但它本来就明文存在本机 IndexedDB，
//   风险等级一致，且换成代理就得引入一个我们不控制的中间服务。
//
// ★ 计费按 original_duration 秒，且合成前拿不到真实时长，所以配额是"预扣 + 校正"两段：
//   先按字数估一个秒数扣掉，请求回来后用 original_duration 补上差额。
//   不这么做的话，并发两条会各自判一次上限、一起放过超额的那次。
//
// 对外符号（全局函数，classic script 无模块化，靠命名约定区分归属）：
//   DOUBAO_TTS_ENDPOINT / DOUBAO_TTS_MODEL / DOUBAO_TTS_MAX_TEXT_CHARS
//   DOUBAO_TTS_FORMAT / DOUBAO_TTS_SAMPLE_RATE / DOUBAO_TTS_CONCURRENCY
//   DOUBAO_TTS_MIME_TYPE / DOUBAO_TTS_TIMEOUT_MS
//   VOICE_PROVIDERS / voiceProviderLabel
//   _normalizeVoiceSettings / _normalizeVoicePreset / _newVoicePresetId / getVoicePreset
//   VOICE_PRESET_OFF / getVoicePresetOptions / resolveVoicePreset
//   _voiceTodayKey / _readVoiceQuota / _addVoiceUsage / _reserveVoiceQuota
//   onVoiceUsageChange
//   _buildVoiceTextPrompt / estimateVoiceSeconds
//   synthesizeVoice
// ============================================================

const DOUBAO_TTS_ENDPOINT = 'https://openspeech.bytedance.com/api/v3/tts/create';
const DOUBAO_TTS_MODEL = 'seed-audio-1.0';

// 文档正文写的是 3000，但错误码表里的实例是
// `text_prompt length 3961 exceeds maximum of 2048` —— 服务端实际按 2048 卡。
// 这是整个 text_prompt（描述 + 台词），不只是台词本身。
const DOUBAO_TTS_MAX_PROMPT_CHARS = 2048;

// 留给"台词"的上限。text_prompt 还要装声音描述，所以比上面小一截；
// 真正的裁剪判据是拼完之后的总长（见 _buildVoiceTextPrompt）。
const DOUBAO_TTS_MAX_TEXT_CHARS = 500;

// ★ 以下三项刻意定死成常量，不做成设置项。
//   理由：普通用户没法判断这些该填什么，而每多一个可填字段就多一批我从没测过的组合。
//   定死等于把测试面积缩到一条路。真需要可配的那天再往外暴露，不用现在预留。
//
//   mp3   —— 体积最小，全平台 <audio> 都认
//   24000 —— 实测这个值 5.615 秒音频 45KB（约 64kbps），人声够用。
//            再往上只是让 IndexedDB 和归档仓库变胖，16000 会明显发闷。
//   并发 2 —— 一次合成要 20 秒以上，且并发不缩短单次耗时，开大只是一起变慢。
const DOUBAO_TTS_FORMAT = 'mp3';
const DOUBAO_TTS_SAMPLE_RATE = 24000;
const DOUBAO_TTS_CONCURRENCY = 2;
const DOUBAO_TTS_MIME_TYPE = 'audio/mpeg';

// ★ 超时必须给得很宽：实测合成 2.75 秒音频花了 23.3 秒，官方 cURL 示例自己写的是
//   --max-time 300。按常规 10~15 秒设会把几乎所有请求都掐死。
const DOUBAO_TTS_TIMEOUT_MS = 180000;

// 服务端单次输出上限 120 秒，超了会被截断而不是报错
const DOUBAO_TTS_MAX_DURATION = 120;

// 目前只有豆包。预设自己带 provider 字段，所以将来加 minimax / 本地 TTS
// 只是往这里加一条 + 加一个 API 模块，已有预设的数据不用迁移。
const VOICE_PROVIDERS = [
    { value: 'doubao', label: '豆包' }
];

/** 服务商 → 中文名，用于预设列表的显示文案（`小雨 · 豆包`） */
function voiceProviderLabel(value) {
    const hit = VOICE_PROVIDERS.find(p => p.value === value);
    return hit ? hit.label : (value || '未知');
}

// ============================================================
// 配置归一化
// ============================================================

function _newVoicePresetId() {
    return `voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 归一化单条音色预设。
 * ★ 预设自带 provider —— 服务商是预设的属性，不是全局开关。这样一个角色用豆包、
 *   另一个用 minimax 可以并存，角色档案只认预设 id，压根不用知道背后是谁。
 */
function _normalizeVoicePreset(raw) {
    const p = raw || {};
    const r = p.rates || {};
    const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));
    const provider = VOICE_PROVIDERS.some(x => x.value === p.provider) ? p.provider : 'doubao';
    return {
        id: p.id || _newVoicePresetId(),
        name: p.name || '未命名音色',
        provider,
        speakerId: String(p.speakerId || '').trim(),
        description: String(p.description || '').trim(),
        rates: {
            // 取值范围来自音频生成接口文档，超范围服务端会直接报参数错
            speech: clampInt(r.speech, -50, 100),
            loudness: clampInt(r.loudness, -50, 100),
            pitch: clampInt(r.pitch, -12, 12)
        }
    };
}

/**
 * 把 db.voiceSettings 归一化成一个字段齐全、类型正确的对象。
 * 所有读配置的地方都要过这一层，别直接摸 db.voiceSettings —— 那可能是 undefined，
 * 也可能是上个版本留下的半截结构。
 *
 * ★ 注意这里没有 format / sampleRate / concurrency —— 它们是常量（见文件顶部）。
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

    const presets = Array.isArray(source.voicePresets)
        ? source.voicePresets.filter(p => p && (p.id || p.speakerId)).map(_normalizeVoicePreset)
        : [];
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
        //   enabled 默认开 —— 配好 Key 和音色就能直接用，不用再想起来回侧边栏开一次。
        //     它开着但没配 Key / 没建预设时不会产生任何请求，所以默认开是安全的。
        //   autoSynthesize 默认关 —— 自动合成会在消息一到达就产生费用。装好就默默开始
        //     计费是不能接受的，让用户主动开。默认值要偏保守那一边。
        enabled: source.enabled !== false,
        autoSynthesize: !!source.autoSynthesize,

        // model / endpoint 落库是为了将来换代不用改老数据，UI 上不暴露
        model: source.model || DOUBAO_TTS_MODEL,
        endpoint: source.endpoint || DOUBAO_TTS_ENDPOINT,
        apiKey: source.apiKey || '',

        voicePresets: presets,

        maxTextChars: Math.min(
            posInt(source.maxTextChars, 120),
            DOUBAO_TTS_MAX_TEXT_CHARS
        ),

        // 0 = 不限制。豆包是免费额度用完就报错，不像和风那样直接发账单，
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

/**
 * 按 id 取音色预设。
 * ★ 没有"传空回落默认"这回事 —— 不存在全局默认音色（原因见 _normalizeVoiceSettings）。
 * @returns {object|null} 归一化后的预设，找不到返回 null（调用方一律先判空）
 */
function getVoicePreset(presetId, settings) {
    const wanted = String(presetId || '').trim();
    if (!wanted || wanted === VOICE_PRESET_OFF) return null;
    const config = _normalizeVoiceSettings(settings || db.voiceSettings);
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
    const config = _normalizeVoiceSettings(settings || db.voiceSettings);
    return [
        { value: VOICE_PRESET_OFF, label: '不使用语音' },
        ...config.voicePresets.map(p => ({
            value: p.id,
            label: `${p.name} · ${voiceProviderLabel(p.provider)}`
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
// 按秒配额：火山超额不会拒绝请求，直接发账单，本地计数器是唯一防线
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
    const settings = _normalizeVoiceSettings(db.voiceSettings);
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
 * ★ 所有真会打到火山的地方都必须走这里，漏一处计数就不准。
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

// ============================================================
// text_prompt 拼装
// ============================================================
// ★ 这是整个方案里唯一需要靠经验调参的地方，所以拼法只在这个函数里出现一次。
//
// 实测（Phase 0 探针）：
//   一位中青年女性，嗓音清冷偏低，语速偏慢，用平静的语气说道："今天风好大，你出门记得多穿一件。"
// 模型**说出**了引号里那句话，没有把整段描述当文章朗读。所以有效结构是
//   ｛声音描述｝说道："｛台词｝"
// 描述为空时退化成裸文本（文档说 text_prompt 可以只是"待合成的文本内容"）。
//
// ⚠️ 这里绝不碰任何聊天提示词模板。语气只来自角色档案里那段固定描述，
//    private_prompt.js / group_prompt.js 一个字都不改。

const VOICE_PROMPT_CONNECTOR = '说道：';
const VOICE_PROMPT_QUOTE_OPEN = '\u201C';   // “
const VOICE_PROMPT_QUOTE_CLOSE = '\u201D';  // ”

/**
 * 把「声音描述」和「台词」拼成一条 text_prompt。
 * @param {string} text        要说出来的那句话
 * @param {string} description 角色档案里的自然语言声音描述，可空
 * @returns {{prompt: string, truncated: boolean}}
 */
function _buildVoiceTextPrompt(text, description) {
    const line = String(text || '').trim()
        // 台词里如果自带同款引号，会和外层引号撞车让模型分不清边界，换成书名号式的方括号引号
        .replace(/[\u201C\u201D]/g, m => (m === VOICE_PROMPT_QUOTE_OPEN ? '\u300C' : '\u300D'));
    const desc = String(description || '').trim()
        // 描述末尾常见句读会让"…。说道："读起来断裂，去掉
        .replace(/[。，、；：,.;:\s]+$/, '');

    if (!line) return { prompt: '', truncated: false };

    let prompt = desc
        ? `${desc}${VOICE_PROMPT_CONNECTOR}${VOICE_PROMPT_QUOTE_OPEN}${line}${VOICE_PROMPT_QUOTE_CLOSE}`
        : line;

    // 兜底裁剪：描述可以写得很长，加上台词有可能顶破 2048。
    // 宁可截描述也不截台词 —— 台词被截会说半句话，描述被截只是语气弱一点。
    let truncated = false;
    if (prompt.length > DOUBAO_TTS_MAX_PROMPT_CHARS) {
        truncated = true;
        const overhead = VOICE_PROMPT_CONNECTOR.length + 2 + line.length;
        const room = DOUBAO_TTS_MAX_PROMPT_CHARS - overhead;
        prompt = room > 0
            ? `${desc.slice(0, room)}${VOICE_PROMPT_CONNECTOR}` +
              `${VOICE_PROMPT_QUOTE_OPEN}${line}${VOICE_PROMPT_QUOTE_CLOSE}`
            : line.slice(0, DOUBAO_TTS_MAX_PROMPT_CHARS);
    }
    return { prompt, truncated };
}

/**
 * 音色档案指纹：把"所有会影响输出音频的参数"压成一个规范字符串。
 * 上层（chat_voice_service）拿它参与算 voiceKey —— 改了音色/描述/语速，指纹变、
 * key 变、自动重新合成，不需要任何显式的缓存失效逻辑。
 * ★ 只收录真会进请求体的字段。多收（比如 enabled）会让无关的开关动作把缓存全冲掉。
 */
// 注：这里原先有个 _voiceProfileFingerprint（把音色 ID/描述/语速等压成指纹），
//     曾用于算语音缓存键。已删除 —— 缓存键改成只认预设 id 了，理由见
//     js/chat/chat_voice_store.js 的 computeVoiceKey：语音是又贵又慢的资源，
//     调一下语速就让已付费的音频作废重合成是浪费。别再把它加回来。

// 预扣用的估算系数（字/秒）。刻意压得很低 —— 这个数只能偏保守，不能偏乐观。
//
// 实测数据点（同一个音色、同一句台词量级，时长差了 2.2 倍）：
//   16 字 → 2.7481 秒（5.82 字/秒）
//   15 字 → 5.6150 秒（2.67 字/秒）
// 字数根本不是个好的预测器：声音描述里写没写"语速偏慢"、模型即兴加的停顿和呼吸，
// 都会成倍改变时长。所以别试图估准，只保证不估低。
//
// ★ 保守估算几乎不花成本：预扣之后马上就用 original_duration 校正回来，
//   落库的计数始终是准的。多估的那部分只占用一次请求的时间（20 秒上下），
//   唯一的副作用是贴着上限时会稍微提前拦一次。拿这个换"绝不因为估低而漏账单"，划算。
const DOUBAO_TTS_CHARS_PER_SECOND = 2;

/**
 * 按字数估合成秒数，供配额预扣用。请求回来后会用 original_duration 校正，
 * 所以这里唯一的要求是"宁高不低"。
 */
function estimateVoiceSeconds(text) {
    const len = String(text || '').trim().length;
    if (!len) return 0;
    return Math.min(
        DOUBAO_TTS_MAX_DURATION,
        Math.max(1, Math.ceil(len / DOUBAO_TTS_CHARS_PER_SECOND))
    );
}

// ============================================================
// 错误处理：把错误码转成能直接摆给用户看的话
// ============================================================

// 文档：https://www.volcengine.com/docs/6561/2534853
// retry=true 的是"再打一次可能就好了"，供上层的重试队列判断；
// 其余都是要人去改配置或改内容的，重试只会白花钱。
const DOUBAO_TTS_ERRORS = {
    45000000: { msg: '请求被网关拒绝，可能是并发超限或请求体过大', retry: true },
    45000010: { msg: 'API Key 无效。请确认它来自语音技术控制台的「API Key 管理」，而不是方舟/ModelArk 的 Key —— 那个不能用于语音接口' },
    45000030: { msg: '账号没有「音频生成」服务的权限。去语音技术控制台开通该服务（它和「语音合成大模型」是两个独立商品，开了后者不等于开了前者）' },
    45001001: { msg: '请求参数不合法' },
    45001104: { msg: '声纹检测未通过' },
    45001115: { msg: '音色 ID 不存在。预置音色请核对拼写，复刻音色请确认 S_xxx 已训练完成（状态 2 或 4）' },
    45001116: { msg: '提示词过长。缩短角色的声音描述，或降低单条语音的最长字数' },
    45001125: { msg: '文本没通过内容审核' },
    45001127: { msg: '音频没通过内容审核' },
    55001309: { msg: '火山内部合成失败', retry: true },
    55001310: { msg: '合成出的音频没通过安全审核', retry: true },
    55001311: { msg: '合成出的音频没通过声纹检查', retry: true }
};

/**
 * 造一个带附加信息的 Error。message 已是可直接展示的文案。
 * @param {object} extra retryable / quotaBlocked / code / logid
 */
function _voiceError(message, extra = {}) {
    const error = new Error(message);
    Object.assign(error, { retryable: false }, extra);
    return error;
}

/** 业务错误码 → 人话。未收录的码原样带上，方便对着文档查 */
function _describeDoubaoTtsError(code, rawMessage, logid) {
    const known = DOUBAO_TTS_ERRORS[Number(code)];
    const tail = logid ? `（Logid ${logid}）` : '';
    if (known) {
        return _voiceError(`${known.msg}${tail}`, {
            code, retryable: !!known.retry, logid, rawMessage
        });
    }
    const detail = String(rawMessage || '').trim();
    return _voiceError(
        `语音合成失败（错误码 ${code}${detail ? `：${detail}` : ''}）${tail}`,
        { code, retryable: false, logid, rawMessage }
    );
}

// ============================================================
// 响应归一化：audio(base64) 和 url 两种形态都要能拿到字节
// ============================================================

/**
 * 从响应体里取出音频字节。
 * ★ 实测该接口 audio 和 url 都会给，所以优先 audio —— 省一次请求，
 *   也不用操心 url 那 2 小时的有效期。url 分支是防御性的：万一哪天服务端
 *   对长音频只给 url，这里能自动兜住（探针已验证那个 url 可跨源读取）。
 */
async function _extractVoiceAudio(payload) {
    const mime = DOUBAO_TTS_MIME_TYPE;

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
// 主入口
// ============================================================

/** 没有 crypto.randomUUID 的兜底：明文 http 局域网调试下它是 undefined（要 secure context） */
function _voiceRequestId() {
    if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

/**
 * 合成一段语音。这是本模块唯一会真的打到火山的函数。
 *
 * 内部按顺序做：闸门检查 → 配额预扣 → 发请求 → 用 original_duration 校正配额 → 取字节。
 * 配额在这里面扣，调用方不要自己再扣一遍。
 *
 * @param {object}  args
 * @param {string}  args.text     要说出来的那句话（不含描述）
 * @param {object}  args.profile  角色音色档案 { speakerId, description, rates:{pitch,speech,loudness} }
 * @param {object} [args.settings] 覆盖 db.voiceSettings，给设置页"改了还没保存就试听"用
 * @param {boolean}[args.quotaOncePerDay] 超额提示当天只弹一次（后台自动合成传 true）
 * @param {AbortSignal} [args.signal] 外部取消信号，会和内部超时叠加
 *
 * @returns {Promise<{bytes: Uint8Array, mime: string, format: string,
 *                    duration: number, originalDuration: number,
 *                    source: 'audio'|'url', logid: string, prompt: string}>}
 * @throws {Error} message 已是可直接展示的文案。附加字段：
 *                 quotaBlocked=true → 超额被拦（上层应静默放弃，不要报错打扰用户）
 *                 retryable=true    → 值得重试
 *                 code / logid      → 排查用
 */
async function synthesizeVoice({ text, profile, settings, quotaOncePerDay = false, signal } = {}) {
    const config = _normalizeVoiceSettings(settings || db.voiceSettings);
    const voice = profile || {};

    // ── 闸门：这些都不该走到发请求那一步 ──────────────────────────
    if (!config.apiKey) throw _voiceError('还没填语音合成的 API Key');
    const speakerId = String(voice.speakerId || '').trim();
    if (!speakerId) throw _voiceError('这个角色还没设置音色 ID');

    const { prompt, truncated } = _buildVoiceTextPrompt(text, voice.description);
    if (!prompt) throw _voiceError('没有可合成的文本');
    if (truncated) console.warn('[语音] 声音描述过长已被裁剪，台词完整保留');

    // ── 配额预扣 ────────────────────────────────────────────────
    const estimate = estimateVoiceSeconds(text);
    const passed = await _reserveVoiceQuota(estimate, { oncePerDay: quotaOncePerDay });
    if (!passed) {
        throw _voiceError('已达今日语音合成上限', { quotaBlocked: true });
    }

    const rates = voice.rates || {};
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));
    const body = {
        model: config.model || DOUBAO_TTS_MODEL,
        text_prompt: prompt,
        references: [{ speaker: speakerId }],
        audio_config: {
            format: DOUBAO_TTS_FORMAT,
            sample_rate: DOUBAO_TTS_SAMPLE_RATE,
            speech_rate: clamp(rates.speech, -50, 100),
            loudness_rate: clamp(rates.loudness, -50, 100),
            pitch_rate: clamp(rates.pitch, -12, 12)
        }
    };

    const endpoint = `${config.endpoint || DOUBAO_TTS_ENDPOINT}`
        + `?api_key=${encodeURIComponent(config.apiKey)}`;

    // 内部超时 + 外部取消。项目里其余 fetch 都没有超时保护，这一层不重复那个坑：
    // 一个挂起的请求在移动网络下能永远卡住上层的合成队列。
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOUBAO_TTS_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    if (signal) {
        if (signal.aborted) controller.abort();
        else signal.addEventListener('abort', onAbort, { once: true });
    }

    let response;
    try {
        response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                // ★ 只有这两个头。X-Api-Key 不在 CORS 白名单里，所以 key 走 query。
                //   X-Api-Request-Id 在白名单里（已实测），带上是为了出问题时能对 logid。
                'Content-Type': 'application/json',
                'X-Api-Request-Id': _voiceRequestId()
            },
            body: JSON.stringify(body),
            signal: controller.signal
        });
    } catch (error) {
        // 预扣的秒数退回来 —— 请求没发出去就没产生账单
        await _addVoiceUsage(-estimate);
        if (error.name === 'AbortError') {
            const external = signal && signal.aborted;
            throw _voiceError(
                external ? '语音合成已取消'
                         : `语音合成超时（超过 ${Math.round(DOUBAO_TTS_TIMEOUT_MS / 1000)} 秒）`,
                { retryable: !external, aborted: true }
            );
        }
        throw _voiceError(`连接语音服务失败：${error.message}`, { retryable: true });
    } finally {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
    }

    const logid = response.headers.get('X-Tt-Logid') || '';

    let payload = null;
    try {
        payload = await response.json();
    } catch (_) { /* 下面按 HTTP 状态处理 */ }

    if (payload && payload.code && Number(payload.code) !== 0) {
        // 业务报错 → 按火山的口径，请求已经处理过了，预扣不退
        throw _describeDoubaoTtsError(payload.code, payload.message, logid);
    }
    if (!response.ok) {
        await _addVoiceUsage(-estimate);
        throw _voiceError(
            `语音合成失败（HTTP ${response.status}）${logid ? `（Logid ${logid}）` : ''}`,
            { retryable: response.status >= 500, logid }
        );
    }
    if (!payload) throw _voiceError('语音服务返回了无法解析的内容', { retryable: true, logid });

    // ── 配额校正：真实账单是 original_duration ──────────────────
    const originalDuration = Number(payload.original_duration) || 0;
    const duration = Number(payload.duration) || originalDuration;
    if (originalDuration > 0) await _addVoiceUsage(originalDuration - estimate);

    const audio = await _extractVoiceAudio(payload);

    return {
        bytes: audio.bytes,
        mime: audio.mime,
        source: audio.source,
        format: DOUBAO_TTS_FORMAT,
        duration,
        originalDuration,
        logid,
        prompt
    };
}
