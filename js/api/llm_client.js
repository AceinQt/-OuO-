// llm_client.js — 文本 LLM 调用统一适配层
// =====================================================
// 普通文本调用走 callLLM()；聊天/识图保留各自的组装或渲染逻辑，
// 但发送前必须走 buildLLMRequest()，不能绕过共享的端点、鉴权和 Flex 处理。
//
// 为什么需要这一层：
//   · Gemini 原生格式和 OpenAI 格式的端点、请求体字段、流式协议、响应结构全都不同；
//   · 新版 vertex-proxy 只提供 Gemini 原生端点，没有 /v1/chat/completions；
//   · 原先 9 个模块各写一份 SSE 解析，同一个 bug 要修 9 遍。
//
// 调用 callLLM 时只提供 OpenAI 形状的 messages，转换由本文件负责。
//
// provider 的差异收在 buildLLMRequestTarget()（端点+鉴权+Vertex Flex 头）、
// buildLLMRequest()（发送前统一处理请求体）和 llmIsGeminiShape()（解析形状）。

// ── Gemini 请求体统一用 camelCase，兼容现有代理 ───────────────
// 现有 Go 代理只认 systemInstruction / inlineData / mimeType 的结构体 tag，
// snake_case 曾让世界书/人设被静默丢弃；这是代理限制，不是 Google 的命名限制。
// Google 官方 REST 的 Flex 示例用 service_tier，API 参考/JS SDK 用 serviceTier，
// ProtoJSON 接受驼峰和原始 proto 字段名。本站仍统一驼峰，不同时发送两份字段。

/** OpenAI 形状的 messages → Gemini 的 { contents, systemInstruction } */
function _toGeminiPayload(messages) {
    const systemTexts = [];
    const contents = [];

    for (const msg of messages || []) {
        if (msg.role === 'system') {
            // Gemini 没有 system 轮次，全部并入 systemInstruction
            if (typeof msg.content === 'string') systemTexts.push(msg.content);
            continue;
        }

        const role = (msg.role === 'assistant' || msg.role === 'model') ? 'model' : 'user';
        let parts;

        if (Array.isArray(msg.content)) {
            // vision 格式：[{type:'text'}, {type:'image_url'}]
            parts = msg.content.map(p => {
                if (p.type === 'text') return { text: p.text };
                if (p.type === 'image_url') {
                    const raw = p.image_url?.url || '';
                    const m = raw.match(/^data:([^;]+);base64,(.*)$/);
                    return m ? { inlineData: { mimeType: m[1], data: m[2] } } : null;
                }
                if (p.inlineData || p.inline_data) {
                    const d = p.inlineData || p.inline_data;
                    return { inlineData: { mimeType: d.mimeType || d.mime_type, data: d.data } };
                }
                if (typeof p.text === 'string') return { text: p.text };
                return null;
            }).filter(Boolean);
        } else {
            parts = [{ text: String(msg.content ?? '') }];
        }

        if (parts.length) contents.push({ role, parts });
    }

    return { contents, systemInstruction: systemTexts.join('\n\n') };
}

// ── 从预设/配置对象里归一化出 url / key / model / provider ──────
// 各模块的取配置逻辑口径不一（url vs apiUrl、key vs apiKey），统一在这里兜。
function normalizeLLMConfig(cfg) {
    cfg = cfg || {};
    let url = (cfg.url || cfg.apiUrl || '').trim();
    if (url.endsWith('/')) url = url.slice(0, -1);
    return {
        url,
        key: (cfg.key || cfg.apiKey || '').trim(),
        model: cfg.model || '',
        provider: cfg.provider || 'newapi',
        projectId: String(cfg.projectId || '').trim(),
        flexEnabled: !!cfg.flexEnabled,
        temperature: cfg.temperature,
        streamEnabled: cfg.streamEnabled !== false
    };
}

/** 多 key 轮询：utils.js 里的 getRandomValue，缺失时退化为原值 */
function _pickKey(key) {
    return (typeof getRandomValue === 'function') ? getRandomValue(key) : key;
}

// ── provider 形状 ───────────────────────────────────────────
// vertexExpress（Google Agent Platform / Vertex AI Express Mode）与 Gemini 共用
// contents / generationConfig 和响应解析，但鉴权、端点及 Flex 的控制方式不同：
//   端点  https://aiplatform.googleapis.com/v1/{modelPath}:{action}
//   鉴权  请求头 x-goog-api-key（不是 gemini 那种 ?key=）
//   Flex  Vertex 走请求头，Gemini 走顶层 serviceTier（见共享请求构造函数）。
// 所以 _readSSE / _extractNonStream / _extractFinishReason 的 isGemini
// 对它同样为 true，那三个函数不需要任何改动。
//
// Express Mode 的 REST 面只有 countTokens / generateContent /
// streamGenerateContent —— 没有 embedding，也没有 /v1/chat/completions，
// 列模型端点要 OAuth 而不是 API Key（所以拉不到模型清单，见下）。

/**
 * Express 可用模型的**内置种子清单**。列模型端点拉不动，只能先内置一份。
 * 注意这不再是唯一来源：每条 API 预设自带 modelList，用户可以在
 * 「API 设置 → 选择模型」右边那个方块按钮里自己编辑（见 api_settings.js 的
 * editModelList）。这里只负责给新预设一个起点，以及点「拉取模型」时并进去。
 * 所以这份清单过期了不影响用户加新模型，不用急着跟着 Google 更新。
 */
const VERTEX_EXPRESS_MODELS = [
    'gemini-3.7-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.1-pro-preview',
    'gemini-3.1-flash-lite',
    'gemini-3.1-flash-image',
    'gemini-3-pro-image',
    'gemini-3-flash-preview',
    'gemini-2.5-pro',
    'gemini-2.5-flash'
];

/** 请求体/响应体是不是 Gemini 原生形状（gemini 和 vertexExpress 共用一套解析） */
function llmIsGeminiShape(provider) {
    return provider === 'gemini' || provider === 'vertexExpress';
}

/**
 * vertexExpress 的 model 段。
 *
 * 留空 Project ID → 裸模型名 `publishers/google/models/{model}`，
 *   此时区域由 Google 后端自行路由，**可能落到不提供该模型的区域并 404**
 *   （实测：gemini-2.5-pro 被路由到 asia-southeast1 → 404 not found）。
 * 填了 Project ID → `projects/{pid}/locations/global/publishers/google/models/{model}`，
 *   区域由我们钉定。多数 Gemini 模型只在 global 提供，所以固定 global。
 *
 * 拿不到项目 ID 就退回裸模型名，绝不拼出半截路径。
 */
function _vertexExpressModelPath(cfg) {
    const model = cfg.model || '';
    // 调用方已自带完整路径时尊重它
    if (/^(projects|publishers|models)\//.test(model)) return model;

    // 一个人通常只有一个 Express 项目，所以没在本预设填就回落到全局设置那份
    let projectId = cfg.projectId;
    if (!projectId) {
        try {
            projectId = String(
                (typeof db !== 'undefined' && db && db.apiSettings && db.apiSettings.projectId) || ''
            ).trim();
        } catch (e) { projectId = ''; }
    }

    if (!projectId) {
        console.warn('[LLM] Vertex Express 未填 Project ID，区域由 Google 后端自选，'
            + '部分模型可能 404（在 API 设置里填 Project ID 即可钉定 global）');
        return `publishers/google/models/${model}`;
    }
    return `projects/${projectId}/locations/global/publishers/google/models/${model}`;
}

/**
 * 端点 + 鉴权头的唯一来源 —— 加新 provider 只改这个函数。
 * 内部已做多 key 轮询，调用方传原始（可能逗号分隔的）key 即可。
 *
 * @param {object} cfg 已过 normalizeLLMConfig 的配置（或含同名字段的裸对象）
 * @param {object} [o] { stream }
 * @returns {{endpoint: string, headers: object, isGeminiShape: boolean}}
 */
function buildLLMRequestTarget(cfg, o = {}) {
    cfg = cfg || {};
    const provider = cfg.provider || 'newapi';
    const model = cfg.model || '';
    const key = _pickKey(cfg.key || '');
    const stream = !!o.stream;
    let url = String(cfg.url || '').trim();
    if (url.endsWith('/')) url = url.slice(0, -1);

    const isGeminiShape = llmIsGeminiShape(provider);
    const action = stream ? 'streamGenerateContent' : 'generateContent';

    if (provider === 'vertexExpress') {
        // 从 gemini 预设切过来时 URL 里常残留 /v1beta，会拼出坏路径，这里削掉。
        // 只在本分支做，对 gemini 零影响。
        const base = url.replace(/\/v1(beta)?$/, '');
        const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': key };
        // Vertex Flex PayGo 的官方调用契约是请求头，不靠 body 字段猜测路由。
        // shared 绕过 Provisioned Throughput，第二个头指定 flex：只用 Flex，
        // 不在失败后偷偷切 Standard。关闭时两个头都缺席，不改变默认计费路径。
        // https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/flex-paygo
        if (cfg.flexEnabled) {
            headers['X-Vertex-AI-LLM-Request-Type'] = 'shared';
            headers['X-Vertex-AI-LLM-Shared-Request-Type'] = 'flex';
        }
        // 注意：这条路径里没有 query，所以 alt=sse 前面是问号而不是 &
        return {
            endpoint: `${base}/v1/${_vertexExpressModelPath(cfg)}:${action}`
                + (stream ? '?alt=sse' : ''),
            headers,
            isGeminiShape
        };
    }

    if (provider === 'gemini') {
        return {
            endpoint: `${url}/v1beta/models/${model}:${action}?key=${encodeURIComponent(key)}`
                + (stream ? '&alt=sse' : ''),
            headers: { 'Content-Type': 'application/json' },
            isGeminiShape
        };
    }

    return {
        endpoint: `${url}/v1/chat/completions`,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        isGeminiShape
    };
}

// ── 发送前的共享入口（含 Flex）───────────────────────────────
// 聊天/识图自己组装 body，曾经只借 buildLLMRequestTarget，绕过 callLLM 后
// Flex 就完全漏了。所有文本 generateContent 请求都从这里取最终 body 和 headers。
// Gemini 顶层 serviceTier 与 contents 同级，不在 generationConfig 内：
//   https://ai.google.dev/api/generate-content
//   https://ai.google.dev/gemini-api/docs/generate-content/flex-inference
// 2026-10-16 核对的 googleapis/js-genai（0e9031d2）确实在 Mldev/Vertex
// 两个转换器里都向顶层写 serviceTier；但 SDK 会发 ≠ Vertex 后端会按它计费。
// 旧实现由此推断“不需要 Vertex 请求头”是不充分的，现按官方 Flex PayGo 文档
// 分流：Gemini 用 body，Vertex 只用上面两个头，避免靠未验证的双写“保险”。
// mock 测试只证明参数；Vertex 是否走 Flex 看 usageMetadata.trafficType
// 是否为 ON_DEMAND_FLEX。AI Studio 可观察 x-gemini-service-tier，但浏览器/代理
// 不暴露响应头时 null 不是失败证据；仍须结合实际响应/用量验证，不能承诺代理透传。
function buildLLMRequest(cfg, body, o = {}) {
    const target = buildLLMRequestTarget(cfg, o);
    if (cfg?.provider === 'gemini' && cfg.flexEnabled) {
        body = { ...body, serviceTier: 'flex' };
    }
    return { ...target, body };
}

// Flex 排队可能以分钟计；已有自动超时至少给 10 分钟，不给普通请求增加等待，
// 也不把原本无超时的主聊天改成自动中止。调用方的 signal/手动取消仍优先。
// 只按 provider 判断：中转站即使模型名含 gemini，也不冒充 Google 原生接口。
function getLLMTimeout(cfg, timeout) {
    if (cfg?.flexEnabled && llmIsGeminiShape(cfg.provider)
        && Number.isFinite(timeout) && timeout > 0) {
        return Math.max(timeout, 600000);
    }
    return timeout;
}

// ── SSE 解析 ────────────────────────────────────────────────
// 两家的流式都是 SSE，差别只在每个事件的 JSON 结构。
// 注意：必须按空行切事件、跨 chunk 保留残余，不能按 '\n' 逐行 JSON.parse ——
// 一个 JSON 可能被 TCP 切在中间，逐行解析会静默丢字。
async function _readSSE(response, isGemini, onChunk, meta) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let full = '', buffer = '', raw = '';

    const emit = (delta) => {
        if (!delta) return;
        full += delta;
        if (onChunk) onChunk(delta, full);
    };

    // Gemini：思考是 parts 里带 thought:true 的一项，内容同样在 text 字段，
    // 必须按 part 判断丢弃，否则思考过程会混进正文。
    const collectGemini = (json) => {
        for (const p of json.candidates?.[0]?.content?.parts || []) {
            if (p.thought) continue;
            if (typeof p.text === 'string') emit(p.text);
        }
    };

    const noteFinish = (json) => {
        if (!meta) return;
        const r = _extractFinishReason(json, isGemini);
        if (r) meta.finishReason = r;
    };

    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        raw += chunk;
        buffer += chunk;

        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop();   // 末尾可能是半个事件，留到下一轮
        for (const ev of events) {
            // 一个事件可能有多行 data:，拼起来才是完整 JSON
            const data = ev.split(/\r?\n/)
                .filter(l => l.startsWith('data:'))
                .map(l => l.slice(5).trim())
                .join('');
            if (!data || data === '[DONE]') continue;
            try {
                const json = JSON.parse(data);
                noteFinish(json);
                if (isGemini) collectGemini(json);
                else emit(json.choices?.[0]?.delta?.content || '');
            } catch (e) { /* 半包或非 JSON，忽略 */ }
        }
    }

    // 兜底：旧版代理的 :streamGenerateContent 不发 SSE，返回一个 JSON 数组
    if (isGemini && !full && raw.trim()) {
        try {
            const arr = JSON.parse(raw.trim());
            (Array.isArray(arr) ? arr : [arr]).forEach(j => { noteFinish(j); collectGemini(j); });
        } catch (e) {
            const re = /"text":\s*"((?:[^"\\]|\\.)*)"/g;
            let m;
            while ((m = re.exec(raw)) !== null) {
                try { emit(JSON.parse(`"${m[1]}"`)); } catch (_) { emit(m[1]); }
            }
        }
    }

    return full;
}

/** 非流式响应 → 文本。Gemini 同样要跳过 thought part 并拼接所有 text。 */
function _extractNonStream(json, isGemini) {
    if (isGemini) {
        return (json.candidates?.[0]?.content?.parts || [])
            .filter(p => !p.thought && typeof p.text === 'string')
            .map(p => p.text).join('');
    }
    return json.choices?.[0]?.message?.content || '';
}

/** 两家的"为什么停下来"字段名不同，统一成 OpenAI 的口径供上层判断内容审查 */
function _extractFinishReason(json, isGemini) {
    if (isGemini) {
        const r = json.candidates?.[0]?.finishReason;
        if (!r) return null;
        // SAFETY / BLOCKLIST / PROHIBITED_CONTENT 都是被拦，归一成 content_filter
        if (/SAFETY|BLOCK|PROHIBITED|RECITATION/i.test(r)) return 'content_filter';
        if (r === 'MAX_TOKENS') return 'length';
        if (r === 'STOP') return 'stop';
        return r;
    }
    return json.choices?.[0]?.finish_reason || null;
}

// ── 主入口 ──────────────────────────────────────────────────
/**
 * 调一次文本 LLM，返回完整文本。
 *
 * @param {object}   opts
 * @param {object}   opts.cfg          预设对象（含 url/key/model/provider/temperature/streamEnabled）
 * @param {Array}    opts.messages     OpenAI 形状的 messages，system 轮次会自动转成 systemInstruction
 * @param {number}   [opts.temperature] 覆盖 cfg 里的温度
 * @param {boolean}  [opts.stream]     覆盖 cfg.streamEnabled；有 onChunk 时默认走流式
 * @param {Function} [opts.onChunk]    (delta, accumulated) 实时回调，仅流式有效
 * @param {AbortSignal} [opts.signal]
 * @param {number}   [opts.timeout]    毫秒；未传 signal 时内部建 AbortController，Google Flex 至少 10 分钟
 * @param {object}   [opts.extraBody]  合并进请求体（OpenAI 分支）或 generationConfig（Gemini 分支）
 * @param {object}   [opts.meta]       传一个空对象进来，返回后可读 meta.finishReason
 *                                     （'content_filter' / 'length' / 'stop' / null，两家已归一）
 * @returns {Promise<string>} 完整文本
 */
async function callLLM(opts = {}) {
    const cfg = normalizeLLMConfig(opts.cfg);
    const { url, model } = cfg;
    if (!url || !cfg.key || !model) throw new Error('API 未配置完整（缺少地址、密钥或模型）');

    const stream = opts.stream !== undefined
        ? !!opts.stream
        : (typeof opts.onChunk === 'function' ? true : cfg.streamEnabled);
    const temperature = opts.temperature !== undefined
        ? opts.temperature
        : (cfg.temperature !== undefined ? cfg.temperature : 0.8);

    // 请求体保留调用方的生成参数，发送前统一补齐端点、鉴权和 Flex。
    const isGeminiShape = llmIsGeminiShape(cfg.provider);
    let body;
    if (isGeminiShape) {
        const { contents, systemInstruction } = _toGeminiPayload(opts.messages);
        body = {
            contents,
            generationConfig: { temperature, ...(opts.extraBody?.generationConfig || {}) }
        };
        if (systemInstruction) body.systemInstruction = { parts: [{ text: systemInstruction }] };
    } else {
        body = { model, messages: opts.messages, temperature, stream, ...(opts.extraBody || {}) };
    }

    const request = buildLLMRequest(cfg, body, { stream });

    // 构造成功后再开计时器，避免构造异常留下未清理的 timer。
    let signal = opts.signal, timer = null;
    if (!signal && opts.timeout) {
        const ac = new AbortController();
        timer = setTimeout(() => ac.abort(), getLLMTimeout(cfg, opts.timeout));
        signal = ac.signal;
    }

    try {
        const response = await fetch(request.endpoint, {
            method: 'POST',
            headers: request.headers,
            body: JSON.stringify(request.body),
            signal
        });

        if (!response.ok) {
            const detail = await response.text().catch(() => '');
            const err = new Error(`API Error: ${response.status}${detail ? ' ' + detail.slice(0, 200) : ''}`);
            err.response = response;
            err.status = response.status;
            throw err;
        }

        if (stream) return await _readSSE(response, isGeminiShape, opts.onChunk, opts.meta);
        const json = await response.json();
        if (opts.meta) opts.meta.finishReason = _extractFinishReason(json, isGeminiShape);
        return _extractNonStream(json, isGeminiShape);
    } finally {
        if (timer) clearTimeout(timer);
    }
}
