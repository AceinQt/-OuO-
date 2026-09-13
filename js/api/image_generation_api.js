// ============================================================
// image_generation_api.js — 图像生成 API 层（凭据 / 请求 / 响应归一化）
// ============================================================
// 这一层只管"怎么跟生图服务商说话"，不认识任何页面，也不认识聊天。
// 消费方：
//   · js/settings/api_settings.js  → 图像设置 tab（填 Key、测试生成）
//   · js/chat/...                 → 未来可能加入的聊天侧调用
//
// 对外符号：
//   IMAGE_PROVIDERS / imageProviderLabel / IMAGE_PRESET_OFF
//   _normalizeImageSettings / _normalizeImagePreset / _newImagePresetId
//   getImagePreset / getImagePresetOptions / resolveImagePreset / resolveImagePresetForChat
//   imageMimeExtension / imageAspectRatioText / composeImagePrompt
//   generateImage
// ============================================================

const IMAGE_GENERATION_SLOW_WARNING_MS = 120000;

// 预留了服务商体系，将来加 NanoBanana 直接往这里加枚举
const IMAGE_PROVIDERS = [
    { value: 'openai', label: 'OpenAI 兼容' },
    { value: 'vertexExpress', label: 'Vertex Express（Google 直连）' },
    { value: 'nai', label: 'NovelAI（原生协议）' }
];

function imageProviderLabel(value) {
    const hit = IMAGE_PROVIDERS.find(p => p.value === value);
    return hit ? hit.label : (value || '未知');
}

// 聊天身上 imageApiPresetId 表示"不开启生图"的值。
// ★ 与音色的 VOICE_PRESET_OFF 同一套路：用显式哨兵而不是空串，因为 <select> 拿到的
//   空值和"字段压根没写过"在 JS 里几乎分不开，混起来必然出 bug。
//   预设 id 形如 img-<时间戳>-<随机>，不会撞。
// ★ 这也是**默认值** —— 没设过的聊天一律不生图。生图是要花钱的调用，
//   绝不能因为"全局配了个默认预设"就替用户默默付费。
const IMAGE_PRESET_OFF = 'off';

// ============================================================
// 配置归一化
// ============================================================

function _newImagePresetId() {
    return `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 归一化单条生图预设（支持从老版本全局配置继承 url/key） */
function _normalizeImagePreset(raw, legacyConfig) {
    const p = raw || {};
    const provider = IMAGE_PROVIDERS.some(x => x.value === p.provider) ? p.provider : 'openai';
    const legacy = legacyConfig || {};

    return {
        id: String(p.id || _newImagePresetId()).trim(),
        name: String(p.name || '未命名生图预设').trim() || '未命名生图预设',
        provider: provider,
        // 只有旧数据缺字段时才继承旧全局值；显式空字符串不会借用别的凭据。
        apiUrl: p.apiUrl !== undefined ? String(p.apiUrl).trim() : String(legacy.apiUrl || '').trim(),
        apiKey: p.apiKey !== undefined ? String(p.apiKey).trim() : String(legacy.apiKey || '').trim(),
        // 下面是 OpenAI 体系常用参数
        model: String(p.model || 'dall-e-3').trim(),
        size: String(p.size || '1024x1024').trim(),
        quality: String(p.quality || 'standard').trim(),
        style: String(p.style || 'vivid').trim(),
        // 仅 vertexExpress 用：留空则区域由 Google 后端自选（部分模型会 404），
        // 填了就钉定 projects/{id}/locations/global/...。没在本预设填时，
        // _vertexExpressImageModelPath 会回落到文本 API 设置里那份 Project ID。
        projectId: String(p.projectId || '').trim(),
        // 预留给未来其他服务商的扩展参数可继续在此添加
    };
}

/** 归一化全局生图配置 */
function _normalizeImageSettings(raw) {
    const source = raw || {};
    const legacyConfig = {
        apiUrl: String(source.apiUrl || '').trim(),
        apiKey: String(source.apiKey || '').trim()
    };
    const usedIds = new Set();
    const presets = [];

    if (Array.isArray(source.imagePresets)) {
        source.imagePresets.filter(p => p && typeof p === 'object').forEach(rawPreset => {
            const preset = _normalizeImagePreset(rawPreset, legacyConfig);
            if (!preset.id || usedIds.has(preset.id)) preset.id = _newImagePresetId();
            usedIds.add(preset.id);
            presets.push(preset);
        });
    }

    // 兼容只有旧全局 URL/Key、还没有预设数组的用户。
    if (!presets.length && (legacyConfig.apiUrl || legacyConfig.apiKey)) {
        const legacyPreset = _normalizeImagePreset({ name: '用户默认' }, legacyConfig);
        usedIds.add(legacyPreset.id);
        presets.push(legacyPreset);
    }

    const requestedDefaultId = String(source.defaultPresetId || '').trim();
    const defaultPresetId = presets.some(p => p.id === requestedDefaultId)
        ? requestedDefaultId
        : ((!Array.isArray(source.imagePresets) || source.imagePresets.length === 0) && presets.length === 1
            ? presets[0].id
            : '');

    const rawCacheLimit = Number(source.localCacheLimitMB);
    const localCacheLimitMB = Number.isFinite(rawCacheLimit) && rawCacheLimit >= 0
        ? rawCacheLimit
        : 10;

    return {
        // 旧字段仅供迁移；新调用必须使用预设自己的 URL/Key。
        apiUrl: legacyConfig.apiUrl,
        apiKey: legacyConfig.apiKey,
        imagePresets: presets,
        defaultPresetId: defaultPresetId,
        // 0 明确表示关闭浏览器本地图片缓存；旧数据缺字段时默认 10 MB。
        localCacheLimitMB
    };
}

function _getImageSettingsSource(settings) {
    if (settings) return settings;
    if (typeof db !== 'undefined' && db && db.imageSettings) return db.imageSettings;
    return {};
}

/** 按 id 精确取预设；空值或找不到时返回 null，不自动回退。 */
function getImagePreset(presetId, settings) {
    const wanted = String(presetId || '').trim();
    if (!wanted) return null;
    const config = _normalizeImageSettings(_getImageSettingsSource(settings));
    return config.imagePresets.find(p => p.id === wanted) || null;
}

/**
 * 私聊/群聊共用的选项数据，只提供数据，不操作 DOM。
 * 第一项固定是"不开启"，它同时是默认选中项。
 * ★ 刻意不提供"全局默认"这一档：见 IMAGE_PRESET_OFF 的注释，
 *   没设过的聊天必须是不生图，而不是悄悄借用全局默认去花钱。
 */
function getImagePresetOptions(settings) {
    const config = _normalizeImageSettings(_getImageSettingsSource(settings));
    return [
        { value: IMAGE_PRESET_OFF, label: '不开启' },
        ...config.imagePresets.map(p => ({
            value: p.id,
            label: `${p.name} · ${imageProviderLabel(p.provider)}`
        }))
    ];
}

/**
 * 指定预设有效就使用，否则回退到明确设置的全局默认；仍无可用项则返回 null。
 * 只服务于设置页（试生成、默认预设标注）；聊天侧一律走 resolveImagePresetForChat。
 */
function resolveImagePreset(presetId, settings) {
    const config = _normalizeImageSettings(_getImageSettingsSource(settings));
    const wanted = String(presetId || '').trim();
    if (wanted) {
        const selected = config.imagePresets.find(p => p.id === wanted);
        if (selected) return selected;
    }
    return config.imagePresets.find(p => p.id === config.defaultPresetId) || null;
}

/**
 * 私聊角色和群聊对象都使用同一个 imageApiPresetId 字段。
 * 'off'、空值、以及指向已删预设的悬空 id 一律视为不开启，**不回退全局默认**。
 */
function resolveImagePresetForChat(chat, settings) {
    const wanted = String((chat && chat.imageApiPresetId) || '').trim();
    if (!wanted || wanted === IMAGE_PRESET_OFF) return null;
    return getImagePreset(wanted, settings);
}

/** 由 size 反推画面比例文本（1024x1024 → 1:1，1792x1024 → 7:4）。 */
function imageAspectRatioText(size) {
    const match = String(size || '').match(/^(\d+)\s*[x×]\s*(\d+)$/i);
    if (!match) return '';
    const w = parseInt(match[1], 10);
    const h = parseInt(match[2], 10);
    if (!w || !h) return '';
    const gcd = (a, b) => (b ? gcd(b, a % b) : a);
    const divisor = gcd(w, h) || 1;
    return `${w / divisor}:${h / divisor}`;
}

/**
 * 拼最终提示词：画面描述 + 风格 + 画面比例。
 * ★ 比例既写进 prompt 又保留 size 参数，是刻意的双保险：有些模型（如 Gemini 系）
 *   会忽略 size 固定输出 16:9，只有把比例写进提示词才拗得回来；
 *   而老实听 size 的模型多这一句也不会被带偏。
 *
 * ★ NAI 是唯一的例外，三处都不一样，因为它吃的是 danbooru tag 而不是自然语言：
 *   · 分隔符必须半角 ', '。全角 '，' 在 NAI 那边不是 tag 分隔符，
 *     会被当成词本身的一部分，等于把两个 tag 粘成一个不存在的词。
 *   · **绝不能**追加「画面比例 X:Y」。NAI 的尺寸走 width/height 参数
 *     （见 _naiDimensions），这句中文进了提示词就是一个真 tag，会参与作画。
 *   · 画风/画师串放**最前面**。官方 tutorial-artstyles 建议风格 tag 靠前，
 *     且 V3 及以下还有"越靠前越强"的位置权重；其他服务商仍是描述在前。
 */
function composeImagePrompt(description, { stylePrompt = '', size = '', provider = '' } = {}) {
    const desc = String(description || '').trim();
    const style = String(stylePrompt || '').trim();

    if (provider === 'nai') return [style, desc].filter(Boolean).join(', ');

    const parts = [desc];
    if (style) parts.push(style);
    const ratio = imageAspectRatioText(size);
    if (ratio) parts.push(`画面比例 ${ratio}`);
    return parts.filter(Boolean).join('，');
}

// ============================================================
// 具体服务商的请求实现
// ============================================================

function imageMimeExtension(mime) {
    const normalized = String(mime || '').toLowerCase().split(';')[0].trim();
    const extensions = {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/jpg': 'jpg',
        'image/webp': 'webp',
        'image/gif': 'gif',
        'image/avif': 'avif',
        'image/bmp': 'bmp'
    };
    return extensions[normalized] || 'img';
}

function _normalizeImageMime(mime) {
    const normalized = String(mime || '').toLowerCase().split(';')[0].trim();
    return normalized === 'image/jpg' ? 'image/jpeg' : normalized;
}

function _detectImageMime(bytes, declaredMime) {
    if (bytes.length >= 8 &&
        bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
        bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
        return 'image/png';
    }
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        return 'image/jpeg';
    }
    if (bytes.length >= 6) {
        const gif = String.fromCharCode(...bytes.slice(0, 6));
        if (gif === 'GIF87a' || gif === 'GIF89a') return 'image/gif';
    }
    if (bytes.length >= 12) {
        const riff = String.fromCharCode(...bytes.slice(0, 4));
        const webp = String.fromCharCode(...bytes.slice(8, 12));
        if (riff === 'RIFF' && webp === 'WEBP') return 'image/webp';
    }
    if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp';

    const normalizedDeclared = _normalizeImageMime(declaredMime);
    return normalizedDeclared.startsWith('image/') ? normalizedDeclared : '';
}

function _validateImageBytes(bytes, declaredMime) {
    const normalizedBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
    if (!normalizedBytes.byteLength) throw new Error('接口返回了空图片');

    const mime = _detectImageMime(normalizedBytes, declaredMime);
    if (!mime) throw new Error('接口返回的内容不是可识别的图片');
    if (mime === 'image/svg+xml') throw new Error('暂不接受 SVG 生图结果，请让接口返回 PNG、JPEG 或 WebP');
    return { bytes: normalizedBytes, mime };
}

function _decodeBase64Image(rawBase64, fallbackMime = 'image/png') {
    let encoded = String(rawBase64 || '').trim();
    let declaredMime = fallbackMime;
    const dataUriMatch = encoded.match(/^data:([^;,]+);base64,([\s\S]+)$/i);
    if (dataUriMatch) {
        declaredMime = dataUriMatch[1];
        encoded = dataUriMatch[2];
    }

    encoded = encoded.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/');
    if (!encoded) throw new Error('接口返回了空的 Base64 图片');
    const padding = encoded.length % 4;
    if (padding) encoded += '='.repeat(4 - padding);

    let binary;
    try {
        binary = atob(encoded);
    } catch (_) {
        throw new Error('接口返回的 Base64 图片无法解析');
    }

    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return _validateImageBytes(bytes, declaredMime);
}

async function _downloadGeneratedImage(url, signal) {
    const targetUrl = String(url || '').trim();
    if (!targetUrl) throw new Error('接口没有返回可下载的图片地址');
    if (targetUrl.startsWith('data:')) {
        const decoded = _decodeBase64Image(targetUrl);
        return { ...decoded, source: 'url' };
    }

    let response;
    try {
        response = await fetch(targetUrl, { signal });
    } catch (error) {
        if (error && error.name === 'AbortError') throw error;
        throw new Error('图片已经生成，但浏览器无法下载中转站返回的临时链接。请检查该中转站是否允许跨域下载（CORS）');
    }

    if (!response.ok) {
        throw new Error(`图片已经生成，但下载临时链接失败（HTTP ${response.status}）`);
    }

    let buffer;
    try {
        buffer = await response.arrayBuffer();
    } catch (error) {
        if (error && error.name === 'AbortError') throw error;
        throw new Error(`读取生成图片失败：${error.message || '未知错误'}`);
    }

    const validated = _validateImageBytes(new Uint8Array(buffer), response.headers.get('content-type'));
    return { ...validated, source: 'url' };
}

async function _readImageApiError(response) {
    let text = '';
    try { text = await response.text(); } catch (_) {}
    if (!text) return '';
    try {
        const data = JSON.parse(text);
        return String(data?.error?.message || data?.message || data?.detail || '').trim();
    } catch (_) {
        return text.trim().slice(0, 300);
    }
}

function _buildOpenAIImageEndpoint(apiUrl) {
    let endpoint = String(apiUrl || 'https://api.openai.com').trim().replace(/\/+$/, '');
    if (!endpoint) endpoint = 'https://api.openai.com';
    if (endpoint.endsWith('/images/generations')) return endpoint;
    return /\/v\d+$/.test(endpoint)
        ? `${endpoint}/images/generations`
        : `${endpoint}/v1/images/generations`;
}

/** 同一个 base 推 /chat/completions；已经指到 images/generations 的地址要先摘掉。 */
function _buildOpenAIChatEndpoint(apiUrl) {
    let endpoint = String(apiUrl || 'https://api.openai.com').trim().replace(/\/+$/, '');
    if (!endpoint) endpoint = 'https://api.openai.com';
    if (endpoint.endsWith('/chat/completions')) return endpoint;
    endpoint = endpoint.replace(/\/images\/(generations|edits)$/, '');
    return /\/v\d+$/.test(endpoint)
        ? `${endpoint}/chat/completions`
        : `${endpoint}/v1/chat/completions`;
}

// ============================================================
// Vertex Express（Google 直连）
// ============================================================
// 为什么值得单独走一条路：生图模型（gemini-3-pro-image 等）本来就在 Express
// 的 generateContent 面上，中间垫一层 OpenAI 协议的中转/代理只会多一个坏掉的环节
// —— 图片要先转成 markdown data URI、再被这边正则捞回来，中途任何一环空手
// 就变成"没返回图片"。直连则是原生 inlineData，一步到位。
//
// 端点与鉴权和文本层完全一致（见 llm_client.js 的 buildLLMRequestTarget）：
//   端点  https://aiplatform.googleapis.com/v1/{modelPath}:generateContent
//   鉴权  请求头 x-goog-api-key
// 差别只在请求体要多两样东西：generationConfig.responseModalities 必须含 IMAGE
// （不给就只回文字），以及 imageConfig 决定分辨率与比例。

/** Vertex Express 生图端点。base 里残留的 /v1、/v1beta 要削掉，否则拼出坏路径。 */
function _buildVertexImageEndpoint(apiUrl, modelPath) {
    let base = String(apiUrl || 'https://aiplatform.googleapis.com').trim().replace(/\/+$/, '');
    if (!base) base = 'https://aiplatform.googleapis.com';
    base = base.replace(/\/v1(beta)?$/, '');
    return `${base}/v1/${modelPath}:generateContent`;
}

/**
 * 模型资源路径。逻辑与文本层的 _vertexExpressModelPath 完全相同（区域必须钉定，
 * 留空会被 Google 后端路由到不提供该模型的区域并 404），所以能复用就复用；
 * 单元测试里本文件是单独加载的，拿不到那个函数时走下面的本地实现。
 */
function _vertexExpressImageModelPath(preset) {
    const model = String((preset && preset.model) || '').trim();
    if (/^(projects|publishers|models)\//.test(model)) return model;

    if (typeof _vertexExpressModelPath === 'function') {
        return _vertexExpressModelPath({ model, projectId: preset && preset.projectId });
    }

    let projectId = String((preset && preset.projectId) || '').trim();
    if (!projectId) {
        try {
            projectId = String(
                (typeof db !== 'undefined' && db && db.apiSettings && db.apiSettings.projectId) || ''
            ).trim();
        } catch (e) { projectId = ''; }
    }
    return projectId
        ? `projects/${projectId}/locations/global/publishers/google/models/${model}`
        : `publishers/google/models/${model}`;
}

// Gemini 生图只认这几个比例，给别的值会 400。UI 里那个 size 下拉是按 DALL-E
// 的像素尺寸做的（1792x1024 算出来是 7:4，不在表里），所以按数值取最接近的一档，
// 而不是要求用户填出合法比例。
const _VERTEX_IMAGE_RATIOS = [
    ['1:1', 1], ['3:2', 1.5], ['2:3', 2 / 3], ['3:4', 0.75], ['4:3', 4 / 3],
    ['4:5', 0.8], ['5:4', 1.25], ['9:16', 0.5625], ['16:9', 16 / 9], ['21:9', 21 / 9]
];

/** 像素尺寸 → 最接近的合法 Gemini 比例；认不出尺寸就返回空（交给模型自己决定）。 */
function _vertexAspectRatio(size) {
    const match = String(size || '').match(/^(\d+)\s*[x×]\s*(\d+)$/i);
    if (!match) return '';
    const w = parseInt(match[1], 10);
    const h = parseInt(match[2], 10);
    if (!w || !h) return '';
    const target = w / h;
    let best = '';
    let bestDelta = Infinity;
    _VERTEX_IMAGE_RATIOS.forEach(([label, value]) => {
        const delta = Math.abs(value - target);
        if (delta < bestDelta) { bestDelta = delta; best = label; }
    });
    return best;
}

/**
 * 像素尺寸 → imageSize 档位。
 * 刻意只用 1K / 2K 两档：512 只有 flash-image 支持（pro-image 会 400），
 * 4K 又贵又慢；这两档所有生图模型都收，永远不会因为档位不合法而失败。
 */
function _vertexImageSize(size) {
    const match = String(size || '').match(/^(\d+)\s*[x×]\s*(\d+)$/i);
    if (!match) return '1K';
    const longSide = Math.max(parseInt(match[1], 10) || 0, parseInt(match[2], 10) || 0);
    return longSide > 1280 ? '2K' : '1K';
}


// 一眼能认出是图片的 base64 头部：PNG iVBOR / JPEG /9j/ / GIF R0lGOD / WEBP UklGR
const _IMAGE_BASE64_PREFIX = /^(iVBOR|\/9j\/|R0lGOD|UklGR)/;

// 这些键名摆明了就是装图片的，值是字符串时直接当 base64 收下。
// 其他键上的长字符串要过更严的门槛（见下方 minBase64Length），免得把模型
// 吐的大段文字误当图片去解码。
const _IMAGE_BEARING_KEYS = new Set(['b64_json', 'data']);

/**
 * 在 chat/completions 的响应里捞图片。
 *
 * ★ 为什么要"递归乱翻"而不是照某个字段名直取：这条路上跑的全是第三方中转站，
 *   同一个 Banana 模型，A 站塞在 message.images[].image_url.url，B 站塞在
 *   message.content 的 markdown 里，C 站学 Gemini 原生放 inlineData.data。
 *   写死任何一种，换个站就抓瞎。所以按"长得像图片"来找，而不是按位置找。
 *
 * ★ 顺带也是安全边界：只认 data:image/、http(s) 图片链接、和 base64 图片头，
 *   别的字符串一律不碰。真解码了还有 _validateImageBytes 查文件头兜底。
 *
 * @param {boolean} [trusted] 当前值来自 _IMAGE_BEARING_KEYS，放宽长度门槛
 * @returns {{kind: 'dataUrl'|'url'|'base64', value: string}|null}
 */
function _findImageInChatResponse(node, depth = 0, trusted = false) {
    if (node == null || depth > 8) return null;

    if (typeof node === 'string') {
        const s = node.trim();
        if (!s) return null;
        if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(s)) return { kind: 'dataUrl', value: s };
        // markdown 图片 ![](...) —— 有的站直接把图塞进正文
        const md = s.match(/!\[[^\]]*\]\((data:image\/[^)\s]+|https?:\/\/[^)\s]+)\)/i);
        if (md) return { kind: md[1].startsWith('data:') ? 'dataUrl' : 'url', value: md[1] };
        if (/^https?:\/\//i.test(s) && /\.(png|jpe?g|webp|gif|avif)(\?|#|$)/i.test(s)) {
            return { kind: 'url', value: s };
        }
        // base64 图片：必须有图片文件头，且不含空白。
        // 明确装图片的键不看长度（小图也是图）；其他键要求够长，避免误判文字。
        const minBase64Length = trusted ? 0 : 512;
        if (s.length > minBase64Length && !/\s/.test(s) && _IMAGE_BASE64_PREFIX.test(s)) {
            return { kind: 'base64', value: s };
        }
        return null;
    }

    if (Array.isArray(node)) {
        for (const item of node) {
            const hit = _findImageInChatResponse(item, depth + 1, trusted);
            if (hit) return hit;
        }
        return null;
    }

    if (typeof node === 'object') {
        // 先看最可能的几个键，命中率高且能避免被同级的长文本带偏
        const preferred = ['b64_json', 'data', 'url', 'image_url', 'inlineData', 'inline_data',
            'images', 'image', 'content', 'parts', 'message', 'choices'];
        for (const key of preferred) {
            if (node[key] !== undefined) {
                const hit = _findImageInChatResponse(node[key], depth + 1, _IMAGE_BEARING_KEYS.has(key));
                if (hit) return hit;
            }
        }
        for (const [key, value] of Object.entries(node)) {
            if (preferred.includes(key)) continue;
            const hit = _findImageInChatResponse(value, depth + 1, _IMAGE_BEARING_KEYS.has(key));
            if (hit) return hit;
        }
    }
    return null;
}

/** 从响应里挖一段人类能看懂的文字，用于"没返回图片"时的报错。 */
function _extractChatText(payload) {
    const choice = payload && Array.isArray(payload.choices) ? payload.choices[0] : null;
    const content = choice && choice.message && choice.message.content;
    if (typeof content === 'string') return content.trim().slice(0, 200);
    if (Array.isArray(content)) {
        const text = content
            .map(part => (part && typeof part.text === 'string' ? part.text : ''))
            .filter(Boolean).join(' ').trim();
        if (text) return text.slice(0, 200);
    }
    return '';
}

/**
 * 走 chat/completions 的生图：**唯一能带参考图的路**。
 *
 * 背景（2026-08 实测企鹅小站 api.penguinsama.com）：
 *   · /v1/images/generations 存在，但那是纯文生图端点，请求体里没有放图片的位置；
 *   · /v1/images/edits 直接 404，中转站没实现；
 *   · /v1/chat/completions 存在 —— Banana / Gemini 系是多模态模型，
 *     图文一起塞进 messages 就能回图。
 * 站方文档原话也对得上：「普通模式支持文字与参考图；开启 openai 格式时使用纯文字生图」，
 * 那个"普通模式"就是这条 chat 路。
 */
async function _generateChatImage(apiUrl, apiKey, preset, prompt, referenceImage, signal) {
    const endpoint = _buildOpenAIChatEndpoint(apiUrl);
    const reference = String(referenceImage || '').trim();

    const content = [{ type: 'text', text: prompt }];
    if (reference) content.push({ type: 'image_url', image_url: { url: reference } });

    let response;
    try {
        response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: preset.model,
                messages: [{ role: 'user', content }]
            }),
            signal
        });
    } catch (error) {
        if (error && error.name === 'AbortError') throw error;
        throw new Error(`连接生图接口失败：${error.message || '网络错误'}`);
    }

    if (!response.ok) {
        const detail = await _readImageApiError(response);
        if (response.status === 404) {
            throw new Error(`HTTP 404：该接口地址没有开放对话式生图（${endpoint}），参考图用不了。请去掉参考图，或换一个支持的渠道${detail ? `：${detail}` : ''}`);
        }
        throw new Error(`HTTP ${response.status}${detail ? `：${detail}` : ''}`);
    }

    let payloadData;
    try {
        payloadData = await response.json();
    } catch (_) {
        throw new Error('接口返回格式异常：响应不是有效 JSON');
    }

    const found = _findImageInChatResponse(payloadData);
    if (!found) {
        // 把响应结构打进控制台：换了中转站、格式没见过时靠这个定位
        console.warn('[图片] 对话式生图没找到图片，响应结构：', payloadData);
        const text = _extractChatText(payloadData);
        throw new Error(
            `模型「${preset.model}」没有返回图片${text ? `，它回的是文字：${text}` : ''}。`
            + '带参考图需要多模态生图模型（如 Nano Banana、Gemini 系），纯文生图模型（dall-e、Flux 等）用不了参考图'
        );
    }

    if (found.kind === 'url') return _downloadGeneratedImage(found.value, signal);
    const decoded = _decodeBase64Image(found.value, 'image/png');
    return { ...decoded, source: found.kind === 'dataUrl' ? 'url' : 'b64_json' };
}

/**
 * OpenAI 格式图像生成请求
 * 支持 DALL-E 2, DALL-E 3，以及部分中转站封装的 Midjourney 等。
 */
async function _generateOpenAIImage(apiUrl, apiKey, preset, prompt, signal) {
    const endpoint = _buildOpenAIImageEndpoint(apiUrl);
    const payload = {
        model: preset.model,
        prompt: prompt,
        n: 1,
        size: preset.size
    };
    
    // DALL-E 3 专属参数 (仅当模型名字包含 dall-e-3 时才传，防止其它模型报错)
    if (preset.model.toLowerCase().includes('dall-e-3')) {
        if (preset.quality) payload.quality = preset.quality;
        if (preset.style) payload.style = preset.style;
    }

    let response;
    try {
        response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(payload),
            signal
        });
    } catch (error) {
        if (error && error.name === 'AbortError') throw error;
        throw new Error(`连接生图接口失败：${error.message || '网络错误'}`);
    }

    if (!response.ok) {
        const detail = await _readImageApiError(response);
        throw new Error(`HTTP ${response.status}${detail ? `：${detail}` : ''}`);
    }

    let payloadData;
    try {
        payloadData = await response.json();
    } catch (_) {
        throw new Error('接口返回格式异常：响应不是有效 JSON');
    }

    const firstImage = payloadData && Array.isArray(payloadData.data) ? payloadData.data[0] : null;
    if (!firstImage || (!firstImage.url && !firstImage.b64_json)) {
        throw new Error('接口返回格式异常，未找到图片数据');
    }

    if (firstImage.b64_json) {
        const decoded = _decodeBase64Image(firstImage.b64_json, 'image/png');
        return { ...decoded, source: 'b64_json' };
    }
    return _downloadGeneratedImage(firstImage.url, signal);
}

/**
 * Vertex Express 生图：Gemini 原生 generateContent，图片以 inlineData 回来。
 * 参考图直接作为一个 inlineData part 塞进同一轮 user 消息 —— 原生形状本来就支持，
 * 不像 OpenAI 那边要为了带图另开一条 chat/completions 的路。
 */
async function _generateVertexImage(apiUrl, apiKey, preset, prompt, referenceImage, signal) {
    const modelPath = _vertexExpressImageModelPath(preset);
    const endpoint = _buildVertexImageEndpoint(apiUrl, modelPath);

    const parts = [{ text: prompt }];
    const reference = String(referenceImage || '').trim();
    if (reference) {
        const m = reference.match(/^data:([^;]+);base64,([\s\S]+)$/);
        if (m) parts.push({ inlineData: { mimeType: m[1], data: m[2] } });
    }

    // responseModalities 必须含 IMAGE，否则模型只回文字。
    const generationConfig = {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: { imageSize: _vertexImageSize(preset.size) }
    };
    const aspectRatio = _vertexAspectRatio(preset.size);
    if (aspectRatio) generationConfig.imageConfig.aspectRatio = aspectRatio;

    let response;
    try {
        response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': apiKey
            },
            body: JSON.stringify({
                contents: [{ role: 'user', parts }],
                generationConfig
            }),
            signal
        });
    } catch (error) {
        if (error && error.name === 'AbortError') throw error;
        throw new Error(`连接生图接口失败：${error.message || '网络错误'}`);
    }

    if (!response.ok) {
        const detail = await _readImageApiError(response);
        if (response.status === 404) {
            throw new Error(
                `HTTP 404：Google 说找不到模型「${preset.model}」（${modelPath}）。`
                + '通常是模型名写错，或者没填 Project ID 导致区域被后端随便挑'
                + `${detail ? `：${detail}` : ''}`
            );
        }
        throw new Error(`HTTP ${response.status}${detail ? `：${detail}` : ''}`);
    }

    let payloadData;
    try {
        payloadData = await response.json();
    } catch (_) {
        throw new Error('接口返回格式异常：响应不是有效 JSON');
    }

    const found = _findVertexInlineImage(payloadData);
    if (found) return { ..._decodeBase64Image(found.data, found.mimeType), source: 'b64_json' };

    // 没图时把原因说清楚。生图被安全过滤器拦掉的典型形状就是
    // parts 整个空掉、只留一个 finishReason，什么文字都没有。
    console.warn('[图片] Vertex 生图没找到图片，响应结构：', payloadData);
    const candidate = payloadData && Array.isArray(payloadData.candidates) ? payloadData.candidates[0] : null;
    const finishReason = String((candidate && candidate.finishReason) || '').trim();
    const blockReason = String(
        (payloadData && payloadData.promptFeedback && payloadData.promptFeedback.blockReason) || ''
    ).trim();
    const text = _extractVertexText(candidate);

    if (/SAFETY|PROHIBITED|BLOCKLIST|SPII|RECITATION/i.test(`${finishReason} ${blockReason}`)) {
        throw new Error(
            `这张图被 Google 的内容安全策略拦下了（${finishReason || blockReason}），模型没有出图。`
            + '换个说法或改掉敏感描述再试'
        );
    }
    throw new Error(
        `模型「${preset.model}」没有返回图片`
        + (text ? `，它回的是文字：${text}` : '')
        + (finishReason ? `（结束原因 ${finishReason}）` : '')
        + '。请确认这是生图模型（名字里带 image，如 gemini-3-pro-image）'
    );
}

/** 在 Gemini 原生响应里找第一个 inlineData 图片。 */
function _findVertexInlineImage(payload) {
    const candidates = payload && Array.isArray(payload.candidates) ? payload.candidates : [];
    for (const candidate of candidates) {
        const parts = candidate && candidate.content && Array.isArray(candidate.content.parts)
            ? candidate.content.parts
            : [];
        for (const part of parts) {
            const inline = part && (part.inlineData || part.inline_data);
            if (!inline) continue;
            const data = String(inline.data || '').trim();
            const mimeType = String(inline.mimeType || inline.mime_type || 'image/png').trim();
            if (data && /^image\//i.test(mimeType)) return { data, mimeType };
        }
    }
    return null;
}

/** 从 Gemini 原生响应里挖一段人类能看懂的文字，用于"没返回图片"时的报错。 */
function _extractVertexText(candidate) {
    const parts = candidate && candidate.content && Array.isArray(candidate.content.parts)
        ? candidate.content.parts
        : [];
    const text = parts
        .filter(p => p && p.thought !== true)
        .map(p => (p && typeof p.text === 'string' ? p.text : ''))
        .filter(Boolean)
        .join(' ')
        .trim();
    return text.slice(0, 200);
}

function _createImageRequestScope(parentSignal, slowAfterMs, onSlow) {
    const controller = new AbortController();
    const slowWarningDelay = Number(slowAfterMs) > 0 ? Number(slowAfterMs) : IMAGE_GENERATION_SLOW_WARNING_MS;
    let parentAborted = false;

    const abortFromParent = () => {
        parentAborted = true;
        controller.abort();
    };
    if (parentSignal) {
        if (parentSignal.aborted) abortFromParent();
        else parentSignal.addEventListener('abort', abortFromParent, { once: true });
    }

    const timer = setTimeout(() => {
        if (controller.signal.aborted || typeof onSlow !== 'function') return;
        try {
            const callbackResult = onSlow({ elapsedMs: slowWarningDelay });
            if (callbackResult && typeof callbackResult.catch === 'function') callbackResult.catch(() => {});
        } catch (_) {}
    }, slowWarningDelay);

    return {
        signal: controller.signal,
        slowWarningDelay,
        wasParentAborted: () => parentAborted,
        cleanup: () => {
            clearTimeout(timer);
            if (parentSignal) parentSignal.removeEventListener('abort', abortFromParent);
        }
    };
}

// ============================================================
// NovelAI 原生协议
// ============================================================
// 官方端点 POST {base}/ai/generate-image，Authorization: Bearer pst-xxx。
// 中转站（如 penguinsama）转发的是同一套原生协议——它们的
// /v1/images/generations 是 404，别指望 OpenAI 兼容那条路。
// 参数名以 image.novelai.net/docs/doc.json（NAI 自己的线上 Swagger）为准。

const NAI_DIMENSION_MIN = 64;
const NAI_DIMENSION_MAX = 1600;
const NAI_DEFAULT_DIMENSIONS = { width: 832, height: 1216 };

function _buildNaiImageEndpoint(apiUrl) {
    const base = String(apiUrl || '').trim().replace(/\/+$/, '');
    if (!base) throw new Error('NovelAI 生图需要填写 API 地址');
    // 用户填站点根（https://api.example.com）或完整端点
    // （https://api.example.com/ai/generate-image）都认，省得为这个来回试
    if (/\/ai\/generate-image(-stream)?$/i.test(base)) return base;
    return `${base}/ai/generate-image`;
}

/** '832x1216' → {width, height}。NAI 的尺寸是自由整数，但必须是 64 的倍数。 */
function _naiDimensions(size) {
    const match = String(size || '').match(/^(\d+)\s*[x×]\s*(\d+)$/i);
    if (!match) return { ...NAI_DEFAULT_DIMENSIONS };
    const snap = value => Math.min(
        NAI_DIMENSION_MAX,
        Math.max(NAI_DIMENSION_MIN, Math.round(Number(value) / 64) * 64)
    );
    return { width: snap(match[1]), height: snap(match[2]) };
}

/**
 * ucPreset 是"内置负面词预设"的下标，而**下标含义按模型族变**：
 *   V5 Full/Curated、V4.5 Full: 0 heavy, 1 light, 2 furryFocus, 3 humanFocus, 4 none
 *   V4.5 Curated:               0 heavy, 1 light, 2 humanFocus, 3 none
 *   V4 Full/Curated:            0 heavy, 1 light, 2 none
 *   V3:                         0 heavy, 1 light, 2 humanFocus, 3 none
 * 同一个 2，在 V4.5 Full 是 furryFocus、在 V4 是 none。这种旋钮给用户看必然出事，
 * 所以刻意不暴露：一律送该模型族的 none，负面词**全部**由用户那个框提供，
 * 界面上永远是纯文本，不存在跨模型歧义。下标越界时 NAI 会退回 "lowres"，影响有限。
 */
function _naiNonePresetIndex(model) {
    const m = String(model || '').toLowerCase();
    if (/nai-diffusion-5/.test(m)) return 4;
    if (/nai-diffusion-4-5-full/.test(m)) return 4;
    if (/nai-diffusion-4-5-curated/.test(m)) return 3;
    if (/nai-diffusion-4-/.test(m)) return 2;
    return 3;
}

/**
 * 每次请求换一个种子。
 *
 * ★ 官方 spec 里 seed 标的是可选，但中转站会照 schema 逐字段校验，**缺了就报
 *   「seed 必须是 0-9007199254740992 的整数」的 400**（实机撞过：
 *   novel.nekoprompt.top + nai-diffusion-4-5-full）。所以这个字段必须显式送，
 *   不能指望服务端补默认值。
 * ★ 只取 32 位：官方网页端也是这个量级，远在上限内，不会碰到 Number 精度边界。
 *   种子随机性没有安全含义，crypto 拿不到就用 Math.random —— 明文 http
 *   局域网调试下 crypto 可能不可用（和 tts_api 那个 randomUUID 兜底同一个原因）。
 */
function _naiRandomSeed() {
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        return crypto.getRandomValues(new Uint32Array(1))[0];
    }
    return Math.floor(Math.random() * 4294967296);
}

/** NAI 的状态码有专门含义，直接翻成人话，省得用户对着裸 HTTP 码猜。 */
function _naiStatusHint(status) {
    if (status === 401) return '（API Key 无效或已过期，NovelAI 用的是 pst- 开头的持久令牌）';
    if (status === 402) return '（账户 Anlas 不足）';
    if (status === 429) return '（并发超限：NovelAI 同时只允许一个生图请求，稍等再试）';
    if (status === 400) return '（请求参数被拒，多半是模型名写错了）';
    return '';
}

// ============================================================
// NAI 内置负面词预设（Undesired Content）
// ============================================================
// 逐字抄自 docs.novelai.net/en/image/undesiredcontent/，**按模型族不同**。
//
// ★ 这里存的是**文本**，不是 ucPreset 下标。下标那条路已经在
//   _naiNonePresetIndex 上面解释过为什么不能给用户看（同一个 2 在不同族是
//   完全不同的预设）。UI 上是「一键填入」按钮：填进去就是普通文本，
//   用户随时能改、能删、能加自己的词，界面上永远不存在歧义。
// ★ humanFocus 多数族就是 heavy 加一截人体相关的词，所以用 humanFocusExtra
//   拼出来，不重复抄一遍；v45curated 的那条官方写法不一样，单独给全文。
const NAI_UC_PRESETS = {
    v5: {
        heavy: 'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page',
        light: 'lowres, bad hands, bad anatomy, artistic error, sepia, white haze, worst quality, very displeasing, jpeg artifacts, 0::ai-generated::',
        humanFocusExtra: ', @_@, mismatched pupils, glowing eyes, bad anatomy'
    },
    v45full: {
        heavy: 'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page',
        light: 'lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page',
        humanFocusExtra: ', @_@, mismatched pupils, glowing eyes, bad anatomy'
    },
    v45curated: {
        heavy: 'blurry, lowres, upscaled, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, negative space, blank page',
        light: 'blurry, lowres, upscaled, artistic error, scan artifacts, jpeg artifacts, logo, too many watermarks, negative space, blank page',
        humanFocus: 'blurry, lowres, upscaled, artistic error, film grain, scan artifacts, bad anatomy, bad hands, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, @_@, mismatched pupils, glowing eyes, negative space, blank page'
    },
    v4full: {
        heavy: 'blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, multiple views, logo, too many watermarks',
        light: 'blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing'
    },
    v4curated: {
        heavy: 'blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, logo, dated, signature, multiple views, gigantic breasts',
        light: 'blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, logo, dated, signature'
    },
    v3: {
        heavy: 'lowres, {bad}, error, fewer, extra, missing, worst quality, jpeg artifacts, bad quality, watermark, unfinished, displeasing, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract]',
        light: 'lowres, jpeg artifacts, worst quality, watermark, blurry, very displeasing',
        humanFocusExtra: ', bad anatomy, bad hands, @_@, mismatched pupils, heart-shaped pupils, glowing eyes'
    },
    furry3: {
        heavy: '{{worst quality}}, [displeasing], {unusual pupils}, guide lines, {{unfinished}}, {bad}, url, artist name, {{tall image}}, mosaic, {sketch page}, comic panel, impact (font), [dated], {logo}, ych, {what}, {where is your god now}, {distorted text}, repeated text, {floating head}, {1994}, {widescreen}, absolutely everyone, sequence, {compression artifacts}, hard translated, {cropped}, {commissioner name}, unknown text, high contrast',
        light: '{worst quality}, guide lines, unfinished, bad, url, tall image, widescreen, compression artifacts, unknown text'
    }
};

function _naiUcFamily(model) {
    const m = String(model || '').toLowerCase();
    if (/nai-diffusion-5/.test(m)) return 'v5';
    if (/nai-diffusion-4-5-full/.test(m)) return 'v45full';
    if (/nai-diffusion-4-5-curated/.test(m)) return 'v45curated';
    if (/nai-diffusion-4-curated/.test(m)) return 'v4curated';
    if (/nai-diffusion-4-/.test(m)) return 'v4full';
    if (/furry/.test(m)) return 'furry3';
    return 'v3';
}

/**
 * 取某个模型对应的内置负面词原文。
 * @param {string} model NAI 模型 ID
 * @param {'heavy'|'light'|'humanFocus'} kind
 * @returns {string} 取不到时返回空串（调用方据此不改动用户已填的内容）
 */
function naiUcPresetText(model, kind = 'heavy') {
    const family = NAI_UC_PRESETS[_naiUcFamily(model)];
    if (!family) return '';
    if (kind === 'humanFocus') {
        if (family.humanFocus) return family.humanFocus;
        // 这个族没有 Human Focus 档（V4 那两个就没有），退回 heavy 而不是给空
        return family.humanFocusExtra ? `${family.heavy}${family.humanFocusExtra}` : family.heavy;
    }
    return family[kind] || family.heavy || '';
}

/** 这个服务商认不认负面提示词。UI 靠它决定要不要把那个框标成"不支持"。 */
function imageProviderSupportsNegativePrompt(provider) {
    return provider === 'nai';
}

/**
 * 从 ZIP 里取出第一个文件的字节。
 *
 * NAI 原生端点默认回 ZIP，送了 Accept: application/json 才给 base64——但
 * 中转站不一定转发这个头，所以这条兜底路必须在。
 *
 * ★ 走中央目录（EOCD → central directory → local header）而不是直接读第一个
 *   local header：流式产生的 ZIP 会把 compressed size 留成 0、真实长度写进
 *   data descriptor，只读 local header 会拿到长度 0、解出空图。
 * ★ 不写死内部文件名：官方 spec 里 image_format 是 png/webp 枚举，扩展名会变，
 *   社区客户端也一律枚举 namelist 而不假设名字。
 */
async function _unzipFirstImage(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u16 = offset => view.getUint16(offset, true);
    const u32 = offset => view.getUint32(offset, true);

    // EOCD 签名 PK\x05\x06。从尾部往前找，注释段最长 65535
    let eocd = -1;
    for (let i = bytes.byteLength - 22; i >= 0 && i >= bytes.byteLength - 65557; i--) {
        if (u32(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('生图接口返回的压缩包已损坏（找不到 ZIP 结尾记录）');
    if (u16(eocd + 10) === 0) throw new Error('生图接口返回的压缩包里没有文件');

    const central = u32(eocd + 16);
    if (u32(central) !== 0x02014b50) throw new Error('生图接口返回的压缩包已损坏（中央目录异常）');
    const method = u16(central + 10);
    const compressedSize = u32(central + 20);
    const localOffset = u32(central + 42);

    if (u32(localOffset) !== 0x04034b50) throw new Error('生图接口返回的压缩包已损坏（文件头异常）');
    const dataStart = localOffset + 30 + u16(localOffset + 26) + u16(localOffset + 28);
    const raw = bytes.subarray(dataStart, dataStart + compressedSize);

    if (method === 0) return raw;    // stored：本来就是原字节
    if (method !== 8) throw new Error(`生图接口返回了不支持的压缩方式（method ${method}）`);
    if (typeof DecompressionStream !== 'function') {
        throw new Error('当前浏览器不支持解压生图结果，请换用能返回 JSON 的中转站');
    }
    const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * NovelAI 生图。提示词已由 composeImagePrompt 按 NAI 规则拼好（半角逗号、
 * 画风在前、不带画面比例）。
 */
async function _generateNaiImage(apiUrl, apiKey, preset, prompt, negativePrompt, signal) {
    const endpoint = _buildNaiImageEndpoint(apiUrl);
    const { width, height } = _naiDimensions(preset.size);
    const uc = String(negativePrompt || '').trim();

    const payload = {
        input: prompt,
        model: preset.model,
        action: 'generate',
        parameters: {
            params_version: 3,
            width, height,
            scale: 5,
            steps: 23,
            n_samples: 1,
            // 必送，理由见 _naiRandomSeed
            seed: _naiRandomSeed(),
            sampler: 'k_euler_ancestral',
            // V4 以上不支持 native，统一用 karras
            noise_schedule: 'karras',
            cfg_rescale: 0,
            ucPreset: _naiNonePresetIndex(preset.model),
            // 质量 tag 交给「画面风格」那个框，不让服务端偷偷往提示词里塞东西
            qualityToggle: false,
            // ★ 正负提示词都要写两份：扁平字段 + V4 以上的结构化字段。
            //   抓包的真实网页请求两处都带；只填扁平那个的话，V4 以上会把
            //   负面词弱化甚至忽略，表现成"我填了负面词但没生效"——
            //   最难排查的那类坑（和语音那个"调完参数听不出变化"同一个形状），
            //   别省这几行。
            negative_prompt: uc,
            v4_prompt: {
                caption: { base_caption: prompt, char_captions: [] },
                use_coords: false,
                use_order: true
            },
            v4_negative_prompt: {
                caption: { base_caption: uc, char_captions: [] },
                legacy_uc: false
            }
        }
    };

    let response;
    try {
        response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                // 官方 spec 里这个端点的 produces 是 [application/zip, application/json]，
                // 送这个头就能直接拿 base64、省掉解压。中转站不一定转发，所以下面留了 ZIP 兜底。
                'Accept': 'application/json'
            },
            body: JSON.stringify(payload),
            signal
        });
    } catch (error) {
        if (error && error.name === 'AbortError') throw error;
        throw new Error(`连接 NovelAI 生图接口失败：${error.message || '网络错误'}`);
    }

    if (!response.ok) {
        const detail = await _readImageApiError(response);
        throw new Error(`HTTP ${response.status}${detail ? `：${detail}` : ''}${_naiStatusHint(response.status)}`);
    }

    let bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.byteLength) throw new Error('NovelAI 接口返回了空响应');

    // ★ 认内容不认响应头：中转站的 content-type 经常缺失或写错，
    //   和 _findImageInChatResponse 一个路数——只看字节长什么样。
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {           // 'PK' → ZIP
        bytes = await _unzipFirstImage(bytes);
        return { ..._validateImageBytes(bytes, 'image/png'), source: 'zip' };
    }
    if (bytes[0] === 0x7b) {                                 // '{'  → JSON
        let parsed;
        try {
            parsed = JSON.parse(new TextDecoder().decode(bytes));
        } catch (_) {
            throw new Error('NovelAI 接口返回格式异常：响应不是有效 JSON');
        }
        const first = parsed && Array.isArray(parsed.images) ? parsed.images[0] : null;
        const base64 = first && (first.image || first.b64_json);
        if (!base64) throw new Error('NovelAI 接口返回格式异常，未找到图片数据');
        return { ..._decodeBase64Image(base64, 'image/png'), source: 'b64_json' };
    }
    // 已经是裸图片字节（有些中转站直接回 PNG）
    return { ..._validateImageBytes(bytes, 'image/png'), source: 'b64_json' };
}

// ============================================================
// 主入口
// ============================================================

/**
 * 统一生图入口，根据预设的 provider 路由到不同的请求函数。
 *
 * @param {object} args
 * @param {string} args.prompt    画面描述（文字模型写出来的那段）
 * @param {object} [args.preset]  当前选中的生图预设；省略时解析全局默认
 * @param {string} [args.stylePrompt] 该聊天的风格文本（如"写实风格"），拼进 prompt
 * @param {string} [args.negativePrompt] 该聊天的负面提示词。**只有 provider 'nai' 会真的发送**
 *   （NAI 原生协议里它是一等字段）。OpenAI 的 images/generations 和 Vertex 的
 *   generateContent 都没有负面字段，而把"不要出现X"拼进正面提示词对 DALL-E 是
 *   出了名的反效果（经常反倒把 X 画出来），所以那两条路一律忽略、绝不偷偷拼。
 * @param {string} [args.referenceImage] 参考图 dataURL。**给了就自动改走对话式生图**
 *   （/chat/completions），因为 images/generations 请求体里没有放图片的位置。
 *   不给则照旧走 images/generations —— 原有行为一行不动。
 *   NAI 那条路不支持参考图（图生图是另一套 action:'img2img' 参数），会直接报错而不是静默忽略。
 * @param {object} [args.settings] 覆盖 db.imageSettings (给设置页试听用)
 * @param {AbortSignal} [args.signal] 外部取消信号
 * @param {number} [args.slowAfterMs] 慢请求提醒阈值，默认 120 秒；提醒后请求继续运行
 * @param {(info: {elapsedMs: number}) => void|Promise<void>} [args.onSlow] 超过提醒阈值时调用
 * @returns {Promise<{bytes: Uint8Array, mime: string, source: 'b64_json'|'url'|'zip'}>}
 */
async function generateImage({ prompt, preset, stylePrompt, negativePrompt, referenceImage, settings, signal, slowAfterMs, onSlow } = {}) {
    const promptText = String(prompt || '').trim();
    if (!promptText) throw new Error('提示词不能为空');

    const config = _normalizeImageSettings(_getImageSettingsSource(settings));
    const imagePreset = preset
        ? _normalizeImagePreset(preset, config)
        : (config.imagePresets.find(p => p.id === config.defaultPresetId) || null);

    if (!imagePreset) throw new Error('尚未设置全局默认生图预设');
    if (!imagePreset.apiKey) throw new Error(`生图预设「${imagePreset.name}」尚未配置 API Key`);
    if (!imagePreset.model) throw new Error(`生图预设「${imagePreset.name}」尚未配置模型`);

    // 风格与比例在这里并入提示词；size 参数照旧发送，双保险见 composeImagePrompt。
    // NAI 的拼法完全不同（半角逗号、画风在前、不带比例），所以要把 provider 传进去。
    const finalPrompt = composeImagePrompt(promptText, {
        stylePrompt,
        size: imagePreset.size,
        provider: imagePreset.provider
    });

    // 有没有参考图决定走哪条路。刻意不做成开关：参考图框本身就是开关，
    // 设了就生效、清掉就还原，不额外引入"开着但没图 / 有图但没开"这两种别扭状态。
    const reference = String(referenceImage || '').trim();

    const requestScope = _createImageRequestScope(signal, slowAfterMs, onSlow);
    try {
        switch (imagePreset.provider) {
            // Vertex 原生只有一条路：参考图就是同一轮消息里多一个 inlineData part，
            // 不需要像 OpenAI 那样按"有没有参考图"分流到两个不同端点。
            case 'vertexExpress':
                return await _generateVertexImage(
                    imagePreset.apiUrl,
                    imagePreset.apiKey,
                    imagePreset,
                    finalPrompt,
                    reference,
                    requestScope.signal
                );

            case 'openai':
                return reference
                    ? await _generateChatImage(
                        imagePreset.apiUrl,
                        imagePreset.apiKey,
                        imagePreset,
                        finalPrompt,
                        reference,
                        requestScope.signal
                    )
                    : await _generateOpenAIImage(
                        imagePreset.apiUrl,
                        imagePreset.apiKey,
                        imagePreset,
                        finalPrompt,
                        requestScope.signal
                    );

            case 'nai':
                // 参考图不走这条路：NAI 的图生图是 action:'img2img' 加一整套
                // strength/noise 参数，和这里的 text2image 不是一个东西，
                // 没实现就明说，别让用户以为设了参考图却被静默忽略。
                if (reference) {
                    throw new Error('NovelAI 预设暂不支持参考图，请先清空该聊天的参考图');
                }
                return await _generateNaiImage(
                    imagePreset.apiUrl,
                    imagePreset.apiKey,
                    imagePreset,
                    finalPrompt,
                    negativePrompt,
                    requestScope.signal
                );

            default:
                throw new Error(`暂不支持的生图服务商: ${imagePreset.provider}`);
        }
    } catch (error) {
        if (requestScope.wasParentAborted() || (signal && signal.aborted)) {
            const aborted = new Error('生图请求已取消');
            aborted.name = 'AbortError';
            throw aborted;
        }
        throw error;
    } finally {
        requestScope.cleanup();
    }
}
