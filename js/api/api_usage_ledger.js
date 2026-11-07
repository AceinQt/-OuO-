// API 调用账本：只保存用量与单价，不保存密钥、提示词、回复或媒体内容。
// 请求开始立即落盘，响应结束只更新原行；清除后在飞请求不能把旧记录复活。
const ApiUsageLedger = (() => {
    let writes = Promise.resolve();
    const listeners = new Set();
    const number = value => {
        if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
        const n = Number(value);
        return Number.isFinite(n) && n >= 0 ? n : null;
    };
    const rate = value => number(value) ?? 0;
    const rates = raw => ({ input: rate(raw?.input), output: rate(raw?.output), cache: rate(raw?.cache) });
    function normalizePricing(raw) {
        return { standard: rates(raw?.standard), flex: rates(raw?.flex) };
    }
    function table() {
        const t = window.dexieDB?.apiCallLogs;
        if (!t) throw new Error('API 调用记录数据库尚未就绪');
        return t;
    }
    function changed() {
        listeners.forEach(fn => { try { fn(); } catch (e) { console.warn('[API账本] 刷新失败', e); } });
    }
    function enqueue(fn) {
        const task = writes.then(fn);
        writes = task.catch(() => {});
        return task;
    }
    function safeWrite(fn) {
        return enqueue(fn).catch(e => { console.warn('[API账本] 记录未能保存', e); });
    }
    function localDate(value = Date.now()) {
        const d = new Date(value);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    function dateRange(first, last) {
        const parse = s => {
            const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
            if (!m) throw new Error('请选择完整日期');
            const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
            if (localDate(d) !== s) throw new Error('日期无效');
            return d;
        };
        const start = parse(first), end = parse(last);
        if (start > end) throw new Error('开始日期不能晚于结束日期');
        end.setDate(end.getDate() + 1); // 本地自然日，不能按固定 24 小时跳过夏令时。
        return { start: start.getTime(), end: end.getTime() };
    }
    // 按实际调用入口分类，不按服务商或名称里某个字猜测：识图、通话回复和偷看相册仍属于文字 API。
    // 旧记录无需迁移；这些 feature 由各入口固定传入，未知名称沿用文字类兜底。
    function callType(row) {
        if (['向量检索', '记忆向量化'].includes(row.feature)) return 'embedding';
        if (['图片生成', '图片生成测试'].includes(row.feature)) return 'image';
        if (['语音合成', '语音试听'].includes(row.feature)) return 'voice';
        return 'text';
    }
    // 已知入口固定列出，没在当前范围调用过的功能也能选；历史游标再补旧版和导入记录的名字。
    const knownFeatures = Object.freeze([
        '聊天回复', '群聊回复', '后台定时回复', '通话回复', '线下回复',
        '总结', '日记', '长期记忆', '重解析记忆', '主动消息预生成', '识图', '分享补全',
        '学习互动', '学习出题', '学习解析', '学习批改', '章节总结', '共读', '番茄互动', '论坛生成',
        '游戏生成', '游戏角色生成', '游戏台词生成', '游戏剧情生成',
        '偷看生成', ...['浏览器', '相册', '购物车', '草稿箱', '消息', '小号', '备忘录', '步数', '中转站'].map(name => `偷看${name}生成`),
        '偷看消息续写', '偷看批量生成', '向量检索', '记忆向量化',
        '图片生成', '图片生成测试', '语音合成', '语音试听', '文本生成', 'API 调用', '未标注功能'
    ]);
    function featureName(row) {
        return typeof row.feature === 'string' && row.feature.trim() ? row.feature : '未标注功能';
    }
    async function listFeatures() {
        const features = new Set(knownFeatures);
        await writes;
        await table().toCollection().each(row => { features.add(featureName(row)); });
        return [...features];
    }
    function collection(start, end, { types, features } = {}) {
        const range = table().where('timestamp').between(start, end, true, false);
        const typeSet = Array.isArray(types) ? new Set(types) : null;
        const featureSet = Array.isArray(features) ? new Set(features) : null;
        // 筛选必须先于 offset/limit；省略维度表示不限，空数组则一条都不匹配，不能误变成全删。
        return typeSet || featureSet ? range.filter(row => (!typeSet || typeSet.has(callType(row)))
            && (!featureSet || featureSet.has(featureName(row)))) : range;
    }
    async function queryRange(start, end, { offset = 0, limit = 100, types, features } = {}) {
        await writes;
        return collection(start, end, { types, features }).reverse().offset(Math.max(0, offset)).limit(Math.max(1, Math.min(limit, 500))).toArray();
    }
    async function eachRange(start, end, visitor, { types, features } = {}) {
        await writes;
        return collection(start, end, { types, features }).reverse().each(visitor);
    }
    async function summarizeRange(start, end, { types, features } = {}) {
        const summary = { total: 0, count: 0, unknown: 0, cached: 0 };
        await eachRange(start, end, row => {
            summary.count++;
            // 命中率按请求条数而非 token 比值：缓存读取大于零便算命中一次，费用未知也不移出分母。
            if (typeof row.cacheTokens === 'number' && Number.isFinite(row.cacheTokens) && row.cacheTokens > 0) summary.cached++;
            if (row.estimatedCost === null || !Number.isFinite(row.estimatedCost)) summary.unknown++;
            else summary.total += row.estimatedCost;
        }, { types, features });
        return summary;
    }
    async function clearRange(start, end, { types, features } = {}) {
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= end) throw new Error('清除日期范围无效');
        const options = {};
        if (Array.isArray(types)) options.types = [...types];
        if (Array.isArray(features)) options.features = [...features];
        // 立即排入同一写队列，不在任务内调用会等待 writes 的查询，避免自等待。
        // 已排队的 add 先落盘再删；收尾仅 update 不 upsert，范围外和后续新请求不受影响。
        return enqueue(async () => {
            const deleted = await collection(start, end, options).delete();
            changed();
            return deleted;
        });
    }
    async function clear() {
        await enqueue(async () => { await table().clear(); changed(); });
    }
    function tier(raw) {
        if (typeof raw !== 'string') return null;
        if (/^(flex|on_demand_flex)$/i.test(raw)) return 'flex';
        if (/^(standard|default|on_demand)$/i.test(raw)) return 'standard';
        return null;
    }
    function start({ cfg = {}, feature = 'API 调用', protocol, requestBody = {}, requestedTier } = {}) {
        const pricing = normalizePricing(cfg.usagePricing);
        const shape = protocol || (['gemini', 'vertexExpress'].includes(cfg.provider) ? 'gemini' : 'openai');
        const requested = tier(requestedTier || requestBody.serviceTier || requestBody.service_tier)
            || (cfg.flexEnabled && ['gemini', 'vertexExpress', 'newapi'].includes(cfg.provider) ? 'flex' : 'standard');
        const row = {
            id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `api-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            timestamp: Date.now(), finishedAt: null, feature: String(feature).slice(0, 120),
            presetName: String(cfg.presetName || cfg.name || '').slice(0, 200),
            provider: String(cfg.provider || '').slice(0, 80), model: String(cfg.model || '').slice(0, 200), actualModel: '',
            httpStatus: null, errorStatus: null, outcome: 'pending',
            inputTokens: null, outputTokens: null, cacheTokens: null, thinkingTokens: null,
            usageComplete: false, estimatedCost: null, requestedTier: requested, observedTier: '', tierConfirmed: false,
            rateSnapshot: pricing
        };
        let finished = false, inserted = false;
        const pendingRow = { ...row };
        const initial = safeWrite(async () => { await table().add(pendingRow); inserted = true; changed(); });
        // 快照不是增量：多帧上报总量只能更新字段，绝不能逐帧相加。
        let nativeOutput = null, nativeThinking = 0;
        let independentCacheUsage = false, independentInput = null, independentCache = 0, independentWrite = 0;
        function setCount(key, value) { const n = number(value); if (n !== null) row[key] = n; }
        function usage(json) {
            if (!json || typeof json !== 'object') return;
            if (Array.isArray(json)) { json.forEach(usage); return; }
            if (typeof json.model === 'string') row.actualModel = json.model.slice(0, 200);
            if (typeof json.modelVersion === 'string') row.actualModel = json.modelVersion.slice(0, 200);
            const u = json.usageMetadata || json.usage_metadata || json.usage;
            const observed = json.serviceTier || json.service_tier || u?.trafficType || u?.traffic_type || u?.vertex_traffic_type;
            if (typeof observed === 'string' && observed) {
                row.observedTier = observed.slice(0, 80);
                row.tierConfirmed = tier(observed) !== null;
            }
            if (!u || typeof u !== 'object') return;
            if (json.usageMetadata || json.usage_metadata || shape === 'gemini') {
                setCount('inputTokens', u.promptTokenCount ?? u.prompt_token_count);
                const output = number(u.candidatesTokenCount ?? u.candidates_token_count);
                const thinking = number(u.thoughtsTokenCount ?? u.thoughts_token_count);
                if (output !== null) nativeOutput = output;
                if (thinking !== null) nativeThinking = thinking;
                if (nativeOutput !== null) row.outputTokens = nativeOutput + nativeThinking;
                else if (shape === 'embedding') row.outputTokens = 0;
                row.thinkingTokens = nativeThinking;
                setCount('cacheTokens', u.cachedContentTokenCount ?? u.cached_content_token_count ?? row.cacheTokens ?? 0);
            } else if (independentCacheUsage || ('input_tokens' in u && !('prompt_tokens' in u)
                && ('cache_read_input_tokens' in u || 'cache_creation_input_tokens' in u))) {
                // 只有独立缓存字段才能识别这种口径；OpenAI 生图的 input_tokens 已含缓存，不能加两次。
                // 一旦识别便保持口径，后续帧省略缓存仍保留前值，显式零可以覆盖。
                // 仅兼容响应中已出现的用量形状，不新增 Anthropic 原生请求协议。
                independentCacheUsage = true;
                const input = number(u.input_tokens), cache = number(u.cache_read_input_tokens);
                const write = number(u.cache_creation_input_tokens);
                if (input !== null) independentInput = input;
                if (cache !== null) independentCache = cache;
                if (write !== null) independentWrite = write;
                if (independentInput !== null) row.inputTokens = independentInput + independentCache + independentWrite;
                setCount('outputTokens', u.output_tokens);
                row.cacheTokens = independentCache;
                // 缓存写入有独立溢价，本版三项费率无法精确估算，不能伪装免费。
                row.cacheWriteTokens = independentWrite;
            } else {
                setCount('inputTokens', u.prompt_tokens ?? u.input_tokens ?? (shape === 'embedding' ? u.total_tokens : undefined));
                setCount('outputTokens', u.completion_tokens ?? u.output_tokens ?? (shape === 'embedding' ? 0 : undefined));
                // OpenAI/DeepSeek 的缓存均是输入子集；省略保留前值，显式零仍可覆盖。
                setCount('cacheTokens', u.prompt_tokens_details?.cached_tokens ?? u.input_tokens_details?.cached_tokens
                    ?? u.prompt_cache_hit_tokens ?? u.cached_tokens ?? row.cacheTokens ?? 0);
                setCount('thinkingTokens', u.completion_tokens_details?.reasoning_tokens);
                // 标准 OpenAI completion 已含 reasoning；旧 Vertex 网关未部署修补时口径不同。
                if (u.vertex_traffic_type && u.vertex_usage_version !== 2 && row.thinkingTokens > 0) row.legacyVertexUsage = true;
            }
        }
        function response(res) {
            if (Number.isInteger(res?.status)) row.httpStatus = res.status;
            // 仅采集浏览器实际可读的响应头；CORS 未暴露时不能当作已确认。
            const observed = res?.headers?.get?.('x-gemini-service-tier');
            if (typeof observed === 'string' && observed) {
                row.observedTier = observed.slice(0, 80);
                row.tierConfirmed = tier(observed) !== null;
            }
        }
        async function finish(error = null) {
            if (finished) return;
            finished = true;
            row.finishedAt = Date.now();
            row.outcome = error ? (error.name === 'AbortError' ? 'cancelled' : 'error') : 'success';
            // 服务商业务 code 常是六位数，不能挡住后面的真实 HTTP 状态；逐个筛有效状态。
            const errorStatus = [error?.status, error?.code, error?.response?.status]
                .map(number).find(value => Number.isInteger(value) && value >= 100 && value <= 599);
            if (errorStatus !== undefined) row.errorStatus = errorStatus;
            // 取消或读流失败后只有中途快照，上游最终账单不可见；保留 token，但费用未知。
            const incomplete = error && (error.name === 'AbortError' || row.errorStatus === null);
            row.usageComplete = !incomplete && row.inputTokens !== null && row.outputTokens !== null && row.cacheTokens !== null
                && row.cacheTokens <= row.inputTokens && !row.cacheWriteTokens && !row.legacyVertexUsage;
            if (row.usageComplete) {
                const applied = tier(row.observedTier) || row.requestedTier;
                const p = pricing[applied];
                row.appliedTier = applied;
                row.estimatedCost = ((row.inputTokens - row.cacheTokens) * p.input + row.outputTokens * p.output + row.cacheTokens * p.cache) / 1000000;
                if (!Number.isFinite(row.estimatedCost)) row.estimatedCost = null;
            }
            await initial;
            if (inserted) await safeWrite(async () => { await table().update(row.id, row); changed(); });
        }
        return { id: row.id, response, usage, finish };
    }
    function csvCell(value) {
        let text = value === null || value === undefined ? '' : String(value);
        if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
        return '"' + text.replace(/"/g, '""') + '"';
    }
    // 恢复只接收白名单元数据；旧备份缺调用记录时不触碰本机历史。
    async function importRecord(raw) {
        if (!raw || typeof raw.id !== 'string' || !raw.id || !Number.isFinite(raw.timestamp) || raw.timestamp < 0) return false;
        const row = { id: raw.id.slice(0, 200), timestamp: raw.timestamp };
        ['feature', 'presetName', 'provider', 'model', 'actualModel', 'outcome', 'requestedTier', 'observedTier', 'appliedTier'].forEach(k => {
            row[k] = typeof raw[k] === 'string' ? raw[k].slice(0, 200) : '';
        });
        ['finishedAt', 'httpStatus', 'errorStatus', 'inputTokens', 'outputTokens', 'cacheTokens', 'thinkingTokens', 'estimatedCost'].forEach(k => { row[k] = number(raw[k]); });
        row.rateSnapshot = normalizePricing(raw.rateSnapshot);
        row.usageComplete = raw.usageComplete === true;
        row.tierConfirmed = raw.tierConfirmed === true;
        if (!row.usageComplete) row.estimatedCost = null;
        await enqueue(async () => {
            // 同一条以本地记录为准，旧备份不能把已完成记录覆盖成 pending。
            if (!await table().get(row.id)) await table().add(row);
            changed();
        });
        return true;
    }
    return { normalizePricing, localDate, dateRange, featureName, knownFeatures, listFeatures,
        queryRange, eachRange, summarizeRange, clearRange, clear, start, csvCell, importRecord,
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        async storageSize() { let size = 0; await writes; await table().toCollection().each(row => { size += JSON.stringify(row).length; }); return size; },
        async flush() { await writes; }
    };
})();
window.ApiUsageLedger = ApiUsageLedger;
function beginApiUsage(context) { return ApiUsageLedger.start(context); }
