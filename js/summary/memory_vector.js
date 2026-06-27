// ============================================================
//  memory_vector.js
//
//  【职责】向量化记忆的 embedding 处理与面板统计。
//
//  v1.6 变更：
//  - 切块逻辑移至 summary_generate.js，本文件不再负责切块
//  - 进度展示改为消息维度："已向量化 XXX / XXX 条消息"
//  - 无块时显示："请先生成总结以创建记忆块"
//  - 向量化目标改为 chunk.summary（而非原文）
//  - startChunking() 保留为空壳，避免旧引用报错
//
//  包含：
//  - startEmbedBatch()      取未向量化的chunk，调embedding API，存结果
//  - renderVectorStats()    刷新面板统计文字（含清理区统计）
//  - previewCleanup()       预览可清理的 chunk 数量
//  - confirmCleanup()       执行清理（仅删 embedding，保留文字）
//  - resetAccessBoost()     重置所有 chunk 的访问强化计数
// ============================================================

const EMBED_BATCH = 10;   // 每次处理多少个chunk

// 自动向量化状态变量
let _isAutoEmbedding = false;

// ====== 向量化专属的后台保活音频 ======
let _embedBgAudio = null;
const _embedSilentWav = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";


// ── [v1.6] 切块职责已转移到 summary_generate.js ──────────────
// 此函数保留为空壳，避免 summary_init.js 的旧绑定报错。
// HTML 中的 #start-chunk-btn 可以直接删除或隐藏。
async function startChunking() {
    showToast('切块现在由「生成总结」自动完成，无需手动触发 (ง •̀_•́)ง');
}


// ── 刷新面板统计 ──────────────────────────────────────────
function renderVectorStats() {
    const chat   = getCurrentChatObject();
    const chunks = chat?.memoryChunks || [];

    const chunkStatsEl  = document.getElementById('chunk-stats-text');
    const vectorStatsEl = document.getElementById('vector-stats-text');
    const embedBtn      = document.getElementById('start-embed-btn');
    const autoEmbedBtn  = document.getElementById('auto-embed-btn');
    const enabledChk    = document.getElementById('vector-memory-enabled');
    const mainContent   = document.getElementById('vector-main-content');
    if (enabledChk)  enabledChk.checked         = !!chat?.vectorMemoryEnabled;
    if (mainContent) mainContent.style.display   = chat?.vectorMemoryEnabled ? '' : 'none';

    // ── 同步检索设置输入框 ──
    const topKEl       = document.getElementById('vector-top-k');
    const queryTurnsEl = document.getElementById('vector-query-turns');
    const minScoreEl   = document.getElementById('vector-min-score');
    if (topKEl)       topKEl.value       = chat?.vectorTopK       || 5;
    if (queryTurnsEl) queryTurnsEl.value = chat?.vectorQueryTurns || 2;
    if (minScoreEl)   minScoreEl.value   =
        chat?.vectorMinScore != null ? Math.round(chat.vectorMinScore * 100) : 30;

    // [v1.6+] minScore 上限提示：> 45 时摘要层（0.45阈值以下）永远触达不到
    const minScoreHint = document.getElementById('vector-min-score-hint');
    if (minScoreHint) {
        const curMin = chat?.vectorMinScore != null ? chat.vectorMinScore : 0.30;
        minScoreHint.textContent = curMin > 0.45
            ? '⚠ 超过 45 时摘要检索层将永远不触发，建议设在 30~45'
            : '';
    }

    // [v1.6+] 将 queryTurns 的说明标签改为更准确的文案
    const queryTurnsLabel = queryTurnsEl
        && queryTurnsEl.closest('label, .setting-row')
        && queryTurnsEl.closest('label, .setting-row').querySelector('.setting-label, label span, span');
    if (queryTurnsLabel && !queryTurnsLabel.dataset.relabeled) {
        queryTurnsLabel.textContent      = '短消息fallback轮数';
        queryTurnsLabel.dataset.relabeled = '1';
    }

    const granularityEl = document.getElementById('chunk-granularity');
    if (granularityEl) granularityEl.value = chat?.chunkGranularity || 10;

    if (!chunkStatsEl || !vectorStatsEl) return;

    // ── [v1.6] 无块时：提示先生成总结 ──
    if (chunks.length === 0) {
        chunkStatsEl.textContent  = '请先生成总结以创建记忆块';
        vectorStatsEl.textContent = '——';
        if (embedBtn)     embedBtn.disabled     = true;
        if (autoEmbedBtn) autoEmbedBtn.disabled = true;
        _renderCleanupStats([], 0);
        return;
    }

// ── [v1.6] 进度展示：消息维度 ──

// ★ activeChunks：只统计实际可向量化的块（有摘要 + 非空白块 + 未被清理）
// 与 startEmbedBatch 的 pending 过滤条件对齐
const activeChunks = chunks.filter(
    c => !c.excludeFromEmbed && !c.isBlankBlock && !!c.summary
);

// ★ excludedCnt 只计"已手动清理"的块，不把无摘要块混进去
const excludedCnt    = chunks.filter(c => c.excludeFromEmbed).length;

const totalMsgs      = activeChunks.reduce((s, c) => s + (c.messageCount || 0), 0);
const vectorizedMsgs = activeChunks.filter(c => c.embedding)
                                   .reduce((s, c) => s + (c.messageCount || 0), 0);
const vectorizedCnt  = activeChunks.filter(c => c.embedding).length;

chunkStatsEl.textContent  = `共 ${activeChunks.length} 段（${totalMsgs} 条消息）`
    + (excludedCnt > 0 ? `，另有 ${excludedCnt} 段已清理` : '');
vectorStatsEl.textContent = `已向量化 ${vectorizedMsgs} / ${totalMsgs} 条消息（${vectorizedCnt} 段）`;

// ★ 全完成的判断也要对齐：0段时也视为全完成（无需向量化）
const isAllDone = activeChunks.length === 0 || (vectorizedCnt >= activeChunks.length);

    if (embedBtn)     embedBtn.disabled     = isAllDone || _isAutoEmbedding;
    if (autoEmbedBtn) autoEmbedBtn.disabled = isAllDone;

    // ── 刷新清理区统计 ──
    const cleanupDaysEl = document.getElementById('cleanup-days-threshold');
    const days          = cleanupDaysEl ? (parseInt(cleanupDaysEl.value) || 90) : 90;
    const candidates    = _getCleanupCandidates(chunks, days);
    _renderCleanupStats(candidates, vectorizedCnt);
}

// ── 获取可清理的 chunk 列表 ──────────────────────────────
function _getCleanupCandidates(chunks, daysThreshold) {
    const now         = Date.now();
    const thresholdMs = daysThreshold * 24 * 60 * 60 * 1000;
    return chunks.filter(c => {
        if (!c.embedding) return false;
        const chunkAge  = now - (c.endTime || 0);
        const accessAge = now - (c.lastAccessTime || 0);
        return chunkAge >= thresholdMs && accessAge >= thresholdMs;
    });
}

// ── 刷新清理区 UI 统计文字 ────────────────────────────────
function _renderCleanupStats(candidates, totalVectorized) {
    const statsEl = document.getElementById('cleanup-stats-text');
    if (!statsEl) return;
    if (totalVectorized === 0) {
        statsEl.textContent = '暂无向量化记忆';
        return;
    }
    if (candidates.length === 0) {
        statsEl.textContent = '目前没有符合条件的记忆可清理';
    } else {
        // 直接简明扼要显示符合条件的段数
        statsEl.textContent = `共 ${candidates.length} 段符合条件`;
    }
}

// ── 查询（原预览）：仅刷新统计文字 ────────────────────────
function previewCleanup() {
    const chat   = getCurrentChatObject();
    const chunks = chat?.memoryChunks || [];
    const cleanupDaysEl = document.getElementById('cleanup-days-threshold');
    const days   = cleanupDaysEl ? (parseInt(cleanupDaysEl.value) || 90) : 90;

    if (isNaN(days) || days < 1) {
        showToast('请输入有效的天数');
        return;
    }

    const candidates = _getCleanupCandidates(chunks, days);
    _renderCleanupStats(candidates, chunks.filter(c => c.embedding).length);
    showToast('查询完成');
}

// ── 执行清理：移除符合条件的 chunk 的 embedding ──────────
async function confirmCleanup() {
    const chat   = getCurrentChatObject();
    const chunks = chat?.memoryChunks || [];
    const cleanupDaysEl = document.getElementById('cleanup-days-threshold');
    const days   = cleanupDaysEl ? (parseInt(cleanupDaysEl.value) || 90) : 90;

    const candidates = _getCleanupCandidates(chunks, days);
    if (candidates.length === 0) {
        showToast('没有符合条件的记忆可清理');
        return;
    }

    const confirmed = await AppUI.confirm(
        `确认清理`,
        `将移除 ${candidates.length} 段旧记忆的向量数据（文字内容保留，可重新向量化）。\n\n此操作不可撤销，确定继续？`
    );
    if (!confirmed) return;

    candidates.forEach(c => {
    delete c.embedding;
    delete c.accessCount;
    delete c.lastAccessTime;
    c.excludeFromEmbed = true;   // ← 新增
});

    await saveChunksToDB(candidates);
renderVectorStats();

// 如果当前正在看某个总结详情，刷新块列表
const contentEl = document.getElementById('summary-detail-content');
const chat2     = getCurrentChatObject();
if (contentEl && chat2 && currentJournalDetailId) {
    const currentItem = (chat2.memorySummaries || []).find(s => s.id === currentJournalDetailId);
    if (currentItem?.blockIds?.length > 0) {
        _renderSummaryBlocks(currentItem, contentEl, chat2);
    }
}

    showToast(`已清理 ${candidates.length} 段旧记忆向量`);
}

// ── 重置访问强化：清零所有 chunk 的 accessCount ──────────
async function resetAccessBoost() {
    const chat        = getCurrentChatObject();
    const chunks      = chat?.memoryChunks || [];
    const withAccess  = chunks.filter(c => c.accessCount > 0);

    if (withAccess.length === 0) {
        showToast('没有需要重置的强化记录');
        return;
    }

    const confirmed = await AppUI.confirm(
        `重置记忆强化`,
        `将清除所有 ${withAccess.length} 段记忆的访问强化记录，各段记忆的排序权重将恢复为初始值。\n\n确定继续？`
    );
    if (!confirmed) return;

    withAccess.forEach(c => {
        c.accessCount    = 0;
        c.lastAccessTime = 0;
    });

    await saveChunksToDB(withAccess);

    const hint = document.getElementById('cleanup-hint');
    if (hint) {
        hint.textContent = `✓ 已重置 ${withAccess.length} 段的强化记录`;
        setTimeout(() => { if (hint) hint.textContent = ''; }, 3000);
    }
    showToast('记忆强化已重置');
}


// ── Embedding API 调用 ────────────────────────────────────
async function callEmbeddingApi(text, chat) {
    const presetField = 'summaryEmbApiPreset';
    const presetName  = chat && chat[presetField];
    
    let apiConfig = null;

    // 1. 优先用角色绑定的 embedding 预设
    if (presetName) {
        const preset = (db.apiPresets || []).find(
            p => p.name === presetName && p.type === 'embedding'
        );
        if (preset && preset.data) apiConfig = preset.data;
    }

    // 2. fallback：全局默认 embedding 预设（db.embeddingSettings.activePreset）
    if (!apiConfig) {
        const globalEmbName = db.embeddingSettings?.activePreset;
        if (globalEmbName) {
            const preset = (db.apiPresets || []).find(
                p => p.name === globalEmbName && p.type === 'embedding'
            );
            if (preset && preset.data) apiConfig = preset.data;
        }
    }

    // 3. 还没找到 → 报错，不 fallback 到文字 API
    if (!apiConfig) throw new Error('未配置 Embedding API，请在记忆设置或 API 设置中添加向量预设');

    // URL 归一化：去掉尾部多余的 /v1，统一由下方拼接
    const { key, model } = apiConfig;
    const url = (apiConfig.url || '').replace(/\/v\d+\/?$/, '');
    if (!url || !key || !model) throw new Error('Embedding API 配置不完整');

    // 判断 provider
    const provider = url.includes('generativelanguage.googleapis.com') ? 'gemini' : 'openai';

    let fetchUrl, body;
    if (provider === 'gemini') {
        fetchUrl = `${url}/v1beta/models/${model}:embedContent?key=${key}`;
        body     = { model: `models/${model}`, content: { parts: [{ text }] } };
    } else {
        fetchUrl = `${url}/v1/embeddings`;
        body = { model, input: Array.isArray(text) ? text : [text] };
    }
    
    console.log('[Embed] fetchUrl:', fetchUrl, '| text length:', text.length);

    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 30000);

    try {
        const res = await fetch(fetchUrl, {
            method:  'POST',
            headers: provider === 'gemini'
                ? { 'Content-Type': 'application/json' }
                : { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body:    JSON.stringify(body),
            signal:  controller.signal,
        });

        clearTimeout(timeoutId);

        if (!res.ok) {
    let errStr = `HTTP ${res.status}`;
    try {
        const errJson = await res.json();
        console.log('[Embed] 错误响应完整内容:', JSON.stringify(errJson)); // 加这行
        errStr = errJson.error?.message || errJson.detail || errJson.message || errStr;
    } catch(e){}
    throw new Error(errStr);
}

        const result = await res.json();

        if (provider === 'gemini') {
            if (!result.embedding || !result.embedding.values) throw new Error('Gemini API 返回格式异常');
            return result.embedding.values;
        } else {
            if (!result.data || !result.data[0] || !result.data[0].embedding) throw new Error('API 返回格式异常');
            return result.data[0].embedding;
        }

    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            throw new Error('网络请求超时 (被系统挂起或网络差)');
        }
        throw error;
    }
}


// ── 向量化下一批 ──────────────────────────────────────────
async function startEmbedBatch() {
    const progressEl = document.getElementById('embed-progress-text');
    const chat       = getCurrentChatObject();
    if (!chat?.memoryChunks) return false;

    const pending = chat.memoryChunks.filter(c => !c.embedding && !c.excludeFromEmbed && !!c.summary);
    if (pending.length === 0) {
        if (progressEl) progressEl.textContent = '已全部完成';
        return true;
    }

    const batch = pending.slice(0, EMBED_BATCH);
    if (progressEl) progressEl.textContent = `处理中 0 / ${batch.length}…`;

    let hasError = false;
    for (let i = 0; i < batch.length; i++) {
        const chunk = batch[i];
        try {
            // 跳过空白块（用户手动新建，尚未填写内容）
            if (chunk.isBlankBlock) {
                continue;
            }
            // [v1.6] 优先向量化 summary 字段；无 summary（解析失败的块）时跳过
            if (!chunk.summary) {
                if (progressEl) progressEl.textContent = `跳过片段 ${i + 1}（摘要未生成，请先二次调用）`;
                continue;
            }
            const vec    = await callEmbeddingApi(chunk.summary, chat);
            chunk.embedding = vec;
        } catch (e) {
        console.error('[Embed] 失败详情:', e, chunk); // ← 加这行
            if (progressEl) progressEl.textContent = `第 ${i + 1} 段失败：${e.message}`;
            hasError = true;
            break;
        }
        if (progressEl) progressEl.textContent = `处理中 ${i + 1} / ${batch.length}…`;
    }

    const processed = batch.filter(c => c.embedding);
    if (processed.length > 0) await saveChunksToDB(processed);

    if (!hasError) {
        if (progressEl) progressEl.textContent = `本批完成，剩余 ${pending.length - batch.length} 段未处理`;
    }

    renderVectorStats();
    return !hasError;
}

// ── 自动定时向量化控制逻辑 ──────────────────────────────────────────
function stopAutoEmbed() {
    _isAutoEmbedding = false;

    const btn = document.getElementById('auto-embed-btn');
    if (btn) {
        btn.textContent          = '自动向量化';
        btn.style.backgroundColor = '';
    }
    const progressEl = document.getElementById('embed-progress-text');
    if (progressEl && progressEl.textContent.includes('等待')) {
        progressEl.textContent = '已停止自动向量化';
    }
    renderVectorStats();
    stopEmbedKeepAlive();
}

async function toggleAutoEmbed() {
    if (_isAutoEmbedding) {
        stopAutoEmbed();
    } else {
        _isAutoEmbedding = true;
        const btn = document.getElementById('auto-embed-btn');
        if (btn) {
            btn.textContent          = '停止自动处理';
            btn.style.backgroundColor = 'var(--danger-color, #e74c3c)';
        }
        renderVectorStats();
        startEmbedKeepAlive();
        await executeAutoEmbed();
    }
}

// ── 音频心跳驱动的防休眠倒计时 ───────────────────────────────
async function audioAwareCountdown(seconds, textTemplate) {
    const progressEl = document.getElementById('embed-progress-text');
    const endTime    = Date.now() + seconds * 1000;

    return new Promise(resolve => {
        let lastSec = -1;

        const checkFn = () => {
            if (!_isAutoEmbedding) {
                cleanup();
                resolve(false);
                return;
            }

            const now    = Date.now();
            const remain = Math.max(0, Math.ceil((endTime - now) / 1000));

            if (remain !== lastSec) {
                lastSec = remain;
                if (progressEl) progressEl.textContent = textTemplate.replace('%s', remain);
            }

            if (now >= endTime) {
                cleanup();
                resolve(true);
            }
        };

        const timerId    = setInterval(checkFn, 500);
        const onTimeUpdate = () => checkFn();
        if (_embedBgAudio) _embedBgAudio.addEventListener('timeupdate', onTimeUpdate);

        const cleanup = () => {
            clearInterval(timerId);
            if (_embedBgAudio) _embedBgAudio.removeEventListener('timeupdate', onTimeUpdate);
        };

        checkFn();
    });
}

async function executeAutoEmbed() {
    if (!_isAutoEmbedding) return;

    const success = await startEmbedBatch();

    if (!_isAutoEmbedding) return;

    if (success === false) {
        const continueRun = await audioAwareCountdown(10, '网络波动或超时，%s 秒后自动重试...');
        if (continueRun) executeAutoEmbed();
        return;
    }

    const chat = getCurrentChatObject();
    if (!chat?.memoryChunks) { stopAutoEmbed(); return; }

    const pending = chat.memoryChunks.filter(c => !c.embedding && c.summary && !c.excludeFromEmbed);
    if (pending.length === 0) {
        stopAutoEmbed();
        const progressEl = document.getElementById('embed-progress-text');
        if (progressEl) progressEl.textContent = '自动向量化已全部完成！';
        return;
    }

    if (_isAutoEmbedding) {
        const intervalEl  = document.getElementById('auto-embed-interval');
        let intervalSec   = intervalEl ? parseInt(intervalEl.value, 10) : 3;
        if (isNaN(intervalSec) || intervalSec < 1) intervalSec = 1;

        const continueRun = await audioAwareCountdown(intervalSec, '等待 %s 秒后处理下一批...');
        if (continueRun) executeAutoEmbed();
    }
}

// ── 向量化后台保活控制 ──────────────────────────────────────────
function startEmbedKeepAlive() {
    if (!_embedBgAudio) {
        _embedBgAudio = new Audio(_embedSilentWav);
        _embedBgAudio.loop = true;
        _embedBgAudio.volume = 1;
        _embedBgAudio.setAttribute('playsinline', '');
        _embedBgAudio.setAttribute('webkit-playsinline', '');
    }
    _embedBgAudio.play().then(() => {
        console.log("[Vector] 自动向量化保活音频已启动，支持后台运行");
    }).catch(err => {
        console.log("[Vector] 自动向量化保活音频启动失败:", err);
    });
}

function stopEmbedKeepAlive() {
    if (_embedBgAudio && !_embedBgAudio.paused) {
        _embedBgAudio.pause();
        _embedBgAudio.currentTime = 0;
        console.log("[Vector] 自动向量化保活音频已停止");
    }
}
