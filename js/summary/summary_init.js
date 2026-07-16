// ============================================================
//  summary_init.js
//
//  【职责】记忆/日记功能页面的 UI 初始化与事件绑定。
//
//  v1.6 变更：
//  - 新建弹窗支持三种模式：按消息序号 / 按时间 / 新建空白
//    · 按时间：自动匹配 chat.history 中的序号范围，实时预览
//    · 新建空白：直接入库，不调 AI，楼层范围标记"未知"
//  - 列表滚动触底时自动加载下一分页
//  - 向量面板：删除手动切块按钮（切块由生成总结自动触发）
//  - 向量面板：新增"清除孤立切块"按钮
//
//  依赖：summary_core.js、summary_render.js、summary_list.js、summary_generate.js
// ============================================================


// ============================================================
//  辅助：按时间范围找消息序号
//  注意：消息时间戳字段假设为 m.timestamp（毫秒）
//  若字段名不同（如 m.time、m.createdAt），请同步修改此处
// ============================================================
// [Step S2] 懒加载后 chat.history 只有内存里最近 1500 条，老时间段在数组里根本找不到。
// 改法：LAZY_LOAD 开时走 DB 索引 count，返回全局 1-based 序号；关时保留原逻辑。
// 铁律：这里也不排序，只 count；返回值语义与老版一致（找不到时 -1/-1）。
async function _findRangeByTime(chat, startTs, endTs) {
    if (window.LAZY_LOAD) {
        if (!chat || !window.dexieDB) return { start: -1, end: -1 };
        const chatId = chat.id;
        // 先探一眼该 ts 范围内到底有没有消息（有 → 才有意义算 start/end）
        const inRange = await window.getMessagesByTsRange(chatId, startTs, endTs);
        if (inRange.length === 0) return { start: -1, end: -1 };
        // start = 1 + 该 chat 中 ts < startTs 的消息条数
        //   between 第 5 参数 false = 上界开区间（严格小于 startTs）
        const startCount = await window.dexieDB.messages
            .where('[chatId+timestamp]')
            .between([chatId, Number.NEGATIVE_INFINITY], [chatId, startTs], true, false)
            .count();
        // end = 该 chat 中 ts <= endTs 的消息条数
        const end = await window.dexieDB.messages
            .where('[chatId+timestamp]')
            .between([chatId, Number.NEGATIVE_INFINITY], [chatId, endTs], true, true)
            .count();
        return { start: startCount + 1, end };
    }
    // 非懒加载：原逻辑（保证一键回滚时行为完全不变）
    const history = chat?.history || [];
    let start = -1, end = -1;
    for (let i = 0; i < history.length; i++) {
        const ts = history[i].timestamp;
        if (ts == null) continue;
        if (ts >= startTs && start === -1) start = i + 1; // 转为 1-indexed
        if (ts <= endTs) end = i + 1;
    }
    return { start, end };
}


// ============================================================
//  辅助：实时预览按时间新建的序号范围
// ============================================================
// [Step S2] 时间范围预览：改 async。快速改时间字段时用 seq 号丢弃过期结果，
// 避免"先返回的老查询覆盖新查询"的显示错乱。
let _timeRangePreviewSeq = 0;
async function _updateTimeRangePreview() {
    const sY = parseInt(document.getElementById('time-start-year').value);
    const sM = parseInt(document.getElementById('time-start-month').value);
    const sD = parseInt(document.getElementById('time-start-day').value);
    const sH = parseInt(document.getElementById('time-start-hour').value);
    const eY = parseInt(document.getElementById('time-end-year').value);
    const eM = parseInt(document.getElementById('time-end-month').value);
    const eD = parseInt(document.getElementById('time-end-day').value);
    const eH = parseInt(document.getElementById('time-end-hour').value);

    const resultEl = document.getElementById('time-range-result');
    if (!resultEl) return;
    
    const submitBtn = document.querySelector('#generate-journal-form button[type="submit"]');

    if ([sY, sM, sD, sH, eY, eM, eD, eH].some(isNaN)) {
        resultEl.textContent = '';
        if (submitBtn) { submitBtn.disabled = true; submitBtn.style.background = '#bdbdbd'; }
        return;
    }

    const startTs = new Date(sY, sM - 1, sD, sH, 0, 0, 0).getTime();
    const endTs   = new Date(eY, eM - 1, eD, eH, 59, 59, 999).getTime();

    if (startTs > endTs) {
        resultEl.style.color = 'var(--danger-color, #e74c3c)';
        resultEl.textContent = '⚠ 起始时间不能晚于截止时间';
        if (submitBtn) { submitBtn.disabled = true; submitBtn.style.background = '#bdbdbd'; }
        return;
    }

    const chat = getCurrentChatObject();
    if (!chat) return;

    resultEl.style.color = '#888';
    resultEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 消息统计中...';
    if (submitBtn) { submitBtn.disabled = true; submitBtn.style.background = '#bdbdbd'; }

    // 竞态保护：只有当前这次是最新调用才允许写 DOM
    const mySeq = ++_timeRangePreviewSeq;
    const { start, end } = await _findRangeByTime(chat, startTs, endTs);
    if (mySeq !== _timeRangePreviewSeq) return;

    if (start === -1 || end === -1) {
        resultEl.style.color = 'var(--danger-color, #e74c3c)';
        resultEl.textContent = '⚠ 该时间段内未找到聊天记录';
        if (submitBtn) { submitBtn.disabled = true; submitBtn.style.background = '#bdbdbd'; }
    } else {
        resultEl.style.color = '#888';
        resultEl.textContent = `✓ 对应消息序号：第 ${start} 条 ~ 第 ${end} 条（共 ${end - start + 1} 条）`;
        if (submitBtn) { submitBtn.disabled = false; submitBtn.style.background = '#0099FF'; }
    }
}

// ============================================================
//  辅助：实时预览单日期（日记tab）
// ============================================================
// [Step S2] 单日期预览：同上 async 化 + 竞态保护
let _singleDatePreviewSeq = 0;
async function _updateSingleDatePreview() {
    const sY = parseInt(document.getElementById('time-single-year').value);
    const sM = parseInt(document.getElementById('time-single-month').value);
    const sD = parseInt(document.getElementById('time-single-day').value);
    const resultEl = document.getElementById('time-single-result');
    if (!resultEl) return;
    
    const submitBtn = document.querySelector('#generate-journal-form button[type="submit"]');

    if ([sY, sM, sD].some(isNaN)) { 
        resultEl.textContent = ''; 
        if (submitBtn) { submitBtn.disabled = true; submitBtn.style.background = '#bdbdbd'; }
        return; 
    }

    const startTs = new Date(sY, sM - 1, sD, 0, 0, 0, 0).getTime();
    const endTs   = new Date(sY, sM - 1, sD, 23, 59, 59, 999).getTime();
    const chat = getCurrentChatObject();
    if (!chat) return;

    resultEl.style.color = '#888';
    resultEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 消息统计中...';
    if (submitBtn) { submitBtn.disabled = true; submitBtn.style.background = '#bdbdbd'; }

    const mySeq = ++_singleDatePreviewSeq;
    const { start, end } = await _findRangeByTime(chat, startTs, endTs);
    if (mySeq !== _singleDatePreviewSeq) return;

    if (start === -1 || end === -1) {
        resultEl.style.color = 'var(--danger-color, #e74c3c)';
        resultEl.textContent = '⚠ 该日期内未找到聊天记录';
        if (submitBtn) { submitBtn.disabled = true; submitBtn.style.background = '#bdbdbd'; }
    } else {
        resultEl.style.color = '#888';
        resultEl.textContent = `✓ 对应消息序号：第 ${start} 条 ~ 第 ${end} 条（共 ${end - start + 1} 条）`;
        if (submitBtn) { submitBtn.disabled = false; submitBtn.style.background = '#0099FF'; }
    }
}

// ============================================================
//  辅助：新建空白条目（不调 AI）
//  [v1.7] 简化：无需填写标题/内容，日期默认今天，总结模式自动携带空白块
// ============================================================
async function _createBlankEntry(occurredAt) {
    try {
        const chat = getCurrentChatObject();
        if (!chat) throw new Error('未找到聊天对象');

        // 日期：传入优先，否则今天
        const now = new Date();
        const finalDate = occurredAt ||
            `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

        // 自动生成标题：如 "2026年4月24日"
        const [y, m, d] = finalDate.split('-');
        const autoTitle = `${parseInt(y)}年${parseInt(m)}月${parseInt(d)}日`;

        const summaryId = `mem_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

        const newItem = {
            id:          summaryId,
            range:       { start: '未知', end: '未知' },
            title:       autoTitle,
            content:     '',
            createdAt:   Date.now(),
            occurredAt:  finalDate,
            isFavorited: false
        };

        if (currentMemoryTab === 'summary') {
            // [v1.7] 总结模式：同时创建一个空白块，使条目可立即编辑
            const blankBlock = {
                blockId:         `blk_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                summaryId,
                chunkIndex:      0,
                detailedContent: '',
                summary:         '',
                emotion:         null,
                emotionScore:    0,
                parseSuccess:    true,
                isBlankBlock:    true,   // 标记：向量化时跳过
                messageCount:    0
            };
            newItem.blockIds = [blankBlock.blockId];

            if (!chat.memorySummaries) chat.memorySummaries = [];
            chat.memorySummaries.push(newItem);
            chat.memoryChunks = chat.memoryChunks || [];
            chat.memoryChunks.push(blankBlock);

            // ★ V6：精准保存
            await saveMemoryItem(newItem, currentChatId, 'short');
            await saveChunksToDB([blankBlock]);
        } else {
            if (!chat.memoryJournals) chat.memoryJournals = [];
            chat.memoryJournals.push(newItem);
            await saveMemoryItem(newItem, currentChatId, 'journal');
        }

        renderMemoryScreen();
        showToast('已新建空白记录');
    } catch (error) {
        showToast('创建失败: ' + error.message);
    }
}


// ============================================================
//  主初始化函数
// ============================================================
function setupMemoryJournalScreen() {
    // 1. 获取通用元素
    const generateNewBtn       = document.getElementById('generate-new-journal-btn');
    const generateModal        = document.getElementById('generate-journal-modal');
    const generateForm         = document.getElementById('generate-journal-form');
    const journalListContainer = document.getElementById('journal-list-container');
    const memorySettingsBtn    = document.getElementById('memory-settings-btn');
    const memorySettingsModal  = document.getElementById('memory-settings-modal');
    const worldBookList        = document.getElementById('journal-worldbook-selection-list');
    const saveMemorySettingsBtn = document.getElementById('save-memory-settings-btn');
    const memoryChatApiSelect  = document.getElementById('memory-chat-api-select');
    const memoryEmbApiSelect   = document.getElementById('memory-emb-api-select');
    const tabs                 = document.querySelectorAll('.mem-tab-btn');

    // 侧边栏与长期总结
    const summarySidebar = document.getElementById('summary-sidebar');
    const sidebarItems   = document.querySelectorAll('.summary-sidebar-item');
    const longTermModal  = document.getElementById('generate-long-term-modal');
    const longTermForm   = document.getElementById('generate-long-term-form');
    
    // ── 向量面板按钮绑定 ──
    // 注意：#start-chunk-btn 已从 HTML 删除，切块由生成总结自动触发
    const btnEmbed = document.getElementById('start-embed-btn');
    if (btnEmbed) btnEmbed.addEventListener('click', startEmbedBatch);

    const btnAutoEmbed = document.getElementById('auto-embed-btn');
    if (btnAutoEmbed) btnAutoEmbed.addEventListener('click', toggleAutoEmbed);

    // [v1.6+] 清除孤立切块按钮
    const btnClearOrphan = document.getElementById('clear-orphan-chunks-btn');
    if (btnClearOrphan) btnClearOrphan.addEventListener('click', clearOrphanChunks);

// ── [v1.6+] 向量记忆：统一保存设置 (颗粒度 + 检索设置) ──
    const saveVectorAllBtn = document.getElementById('save-vector-all-settings-btn');
    if (saveVectorAllBtn) {
        saveVectorAllBtn.addEventListener('click', async () => {
            const chat = getCurrentChatObject();
            if (!chat) return;

            // 1. 保存颗粒度
            const rawGranularity = parseInt(document.getElementById('chunk-granularity')?.value);
            chat.chunkGranularity = (!isNaN(rawGranularity) && rawGranularity >= 3) ? Math.min(rawGranularity, 50) : 10;

            // 2. 保存检索参数
            const topK       = parseInt(document.getElementById('vector-top-k')?.value)       || 5;
            const queryTurns = parseInt(document.getElementById('vector-query-turns')?.value) || 2;
            const minScorePct = parseInt(document.getElementById('vector-min-score')?.value);

            chat.vectorTopK       = topK;
            chat.vectorQueryTurns = queryTurns;
            chat.vectorMinScore   = (!isNaN(minScorePct) && minScorePct >= 0) ? minScorePct / 100 : 0.30;

            await saveSingleChat(currentChatId, currentChatType);

            // 提示成功 (已移除多余的 DOM hint 提示)
            showToast('设置已保存');
        });
    }

    // ── 向量记忆启用 checkbox ──
    const vectorEnabledChk = document.getElementById('vector-memory-enabled');
    if (vectorEnabledChk) {
        vectorEnabledChk.addEventListener('change', async () => {
            const chat = getCurrentChatObject();
            if (!chat) return;
            chat.vectorMemoryEnabled = vectorEnabledChk.checked;
            const mainContent = document.getElementById('vector-main-content');
            if (mainContent) mainContent.style.display = vectorEnabledChk.checked ? '' : 'none';
            await saveSingleChat(currentChatId, currentChatType);
        });
    }

    // ── 记忆强化与清理区按钮绑定 ──
    const previewCleanupBtn = document.getElementById('preview-cleanup-btn');
    if (previewCleanupBtn) previewCleanupBtn.addEventListener('click', previewCleanup);

    const confirmCleanupBtn = document.getElementById('confirm-cleanup-btn');
    if (confirmCleanupBtn) confirmCleanupBtn.addEventListener('click', confirmCleanup);

    const resetAccessBtn = document.getElementById('reset-access-btn');
    if (resetAccessBtn) resetAccessBtn.addEventListener('click', resetAccessBoost);

    // 天数输入框变化时实时刷新统计
    const cleanupDaysEl = document.getElementById('cleanup-days-threshold');
    if (cleanupDaysEl) {
        cleanupDaysEl.addEventListener('change', () => {
            const chat = getCurrentChatObject();
            const chunks = chat?.memoryChunks || [];
            const days = parseInt(cleanupDaysEl.value) || 90;
            const candidates = _getCleanupCandidates(chunks, days);
            _renderCleanupStats(candidates, chunks.filter(c => c.embedding).length);
        });
    }

    // 2. 获取详情页特有元素 (Summaries)
    const editSummaryBtn  = document.getElementById('edit-summary-btn');
    const summaryTitleEl  = document.getElementById('summary-detail-title');
    const summaryContentEl = document.getElementById('summary-detail-content');
    const summaryDateInput = document.getElementById('summary-occurred-at');

    // 3. 获取详情页特有元素 (Journals)
    const editJournalBtn    = document.getElementById('edit-journal-btn');
    const journalTitleEl    = document.getElementById('journal-detail-title');
    const journalContentEl  = document.getElementById('journal-detail-content');
    const journalSettingsBtn = document.getElementById('journal-settings-btn');

    // 4. 设置模态框元素
    const journalCssModal  = document.getElementById('journal-css-modal');
    const journalCssForm   = document.getElementById('journal-css-form');
    const journalCssInput  = document.getElementById('journal-css-input');
    const journalFontSelect = document.getElementById('journal-font-select');

    // 5. 新建弹窗 —— 三种模式相关元素
    const newEntryModeSelect  = document.getElementById('new-entry-mode');
    const modePanelByIndex    = document.getElementById('mode-panel-by-index');
    const modePanelByTime     = document.getElementById('mode-panel-by-time');
    const modePanelBlank      = document.getElementById('mode-panel-blank');
    const bothToggleContainer = document.getElementById('generate-both-toggle-container');

    // --- 初始化字体下拉框 ---
    journalFontSelect.innerHTML = '';
    JOURNAL_FONTS.forEach(font => {
        const option = document.createElement('option');
        option.value = font.value;
        option.textContent = font.name;
        journalFontSelect.appendChild(option);
    });

    // ============================================================
    //  Tab 切换逻辑
    // ============================================================
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            if (currentChatType === 'group' && tab.dataset.tab === 'journal') {
                showToast('群聊模式暂不支持角色日记');
                return;
            }
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentMemoryTab = tab.dataset.tab;

            if (currentMemoryTab === 'summary') {
                summarySidebar.classList.remove('hidden');
                if (!currentSummarySubTab) currentSummarySubTab = 'short';
                sidebarItems.forEach(i => {
                    if (i.dataset.sub === currentSummarySubTab) i.classList.add('active');
                    else i.classList.remove('active');
                });
            } else {
                summarySidebar.classList.add('hidden');
            }

            renderMemoryScreen();
        });
    });

    // --- 侧边栏 (Sub Tab) 切换 ---
    sidebarItems.forEach(item => {
        item.addEventListener('click', () => {
            sidebarItems.forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            currentSummarySubTab = item.dataset.sub;
            renderMemoryScreen();
        });
    });

    // ============================================================
    //  新建弹窗 —— 模式 select 切换
    // ============================================================
    newEntryModeSelect.addEventListener('change', () => {
        _applyModePanel(newEntryModeSelect.value);
    });

    /** 根据模式值切换面板显示，并同步"同时生成日记"开关的可见性 */
    function _applyModePanel(mode) {
        modePanelByIndex.style.display = mode === 'by-index' ? '' : 'none';
        modePanelByTime.style.display  = mode === 'by-time'  ? '' : 'none';
        modePanelBlank.style.display   = mode === 'blank'    ? '' : 'none';

        // by-time面板内：总结tab显示完整起止，日记tab显示单日期
        if (mode === 'by-time') {
            const isJournal = currentMemoryTab === 'journal';
            document.getElementById('time-range-full').style.display   = isJournal ? 'none' : '';
            document.getElementById('time-range-single').style.display = isJournal ? '' : 'none';
            
            // 切换到按时间模式时，触发重新校验（控制提交按钮显隐）
            if (isJournal) {
                _updateSingleDatePreview();
            } else {
                _updateTimeRangePreview();
            }
        } else {
            // 切回其他模式时恢复提交按钮可用
            const submitBtn = document.querySelector('#generate-journal-form button[type="submit"]');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.style.background = '#0099FF';
            }
        }

        // 空白模式不支持同时生成日记
        if (mode === 'blank') {
            bothToggleContainer.style.display = 'none';
        } else {
            if (currentMemoryTab === 'summary' && currentChatType !== 'group') {
                bothToggleContainer.style.display = 'flex';
            } else {
                bothToggleContainer.style.display = 'none';
            }
        }
    }

    // --- 按时间面板：时间字段实时预览 ---
    ['time-start-year','time-start-month','time-start-day','time-start-hour',
     'time-end-year',  'time-end-month',  'time-end-day',  'time-end-hour'
    ].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', _updateTimeRangePreview);
    });
    
    ['time-single-year','time-single-month','time-single-day'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', _updateSingleDatePreview);
    });

    // ============================================================
    //  生成按钮逻辑分流（+号）
    // ============================================================
    generateNewBtn.addEventListener('click', async () => {
        if (currentChatType === 'group' && currentMemoryTab === 'journal') {
            showToast('群聊无法生成个人日记');
            return;
        }

        // 长期总结走专属弹窗
        if (currentMemoryTab === 'summary' && currentSummarySubTab === 'long') {
            const now = new Date();
            longTermForm.reset();
            document.getElementById('long-start-year').value = now.getFullYear();
            document.getElementById('long-end-year').value   = now.getFullYear();
            longTermModal.classList.add('visible');
            return;
        }

        // 短期总结 / 日记 —— 立即打开弹窗（加载态），避免点击无反馈
        // [Step S2+] 原实现先 await getMessageCount 再 show 弹窗，点击到弹窗出现有延迟，
        //   用户会以为没点到反复点。改成：先把弹窗弹出来（带 spinner 占位），再异步取数填充。
        const chat = getCurrentChatObject();
        const modalTitle = document.getElementById('generate-modal-title');
        if (currentMemoryTab === 'summary') {
            modalTitle.textContent = '生成短期总结';
        } else {
            modalTitle.textContent = '生成角色日记';
        }

        // 重置弹窗状态
        generateForm.reset();
        newEntryModeSelect.value = 'by-index';
        _applyModePanel('by-index');

        const rangeInfoEl       = document.getElementById('journal-range-info');
        const rangeStartInput   = document.getElementById('journal-range-start');
        const rangeEndInput     = document.getElementById('journal-range-end');
        const timeRangeResult   = document.getElementById('time-range-result');
        const timeSingleResult  = document.getElementById('time-single-result');

        // 按时间面板的默认日期不依赖 DB，先填好（与原逻辑一致）
        const now = new Date();
        const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        document.getElementById('time-start-year').value  = now.getFullYear();
        document.getElementById('time-start-month').value = now.getMonth() + 1;
        document.getElementById('time-start-day').value   = now.getDate();
        document.getElementById('time-start-hour').value  = 0;
        document.getElementById('time-end-year').value    = tomorrow.getFullYear();
        document.getElementById('time-end-month').value   = tomorrow.getMonth() + 1;
        document.getElementById('time-end-day').value     = tomorrow.getDate();
        document.getElementById('time-end-hour').value    = 0;

        // --- 按时间（日记）：今天单日期 ---
        document.getElementById('time-single-year').value  = now.getFullYear();
        document.getElementById('time-single-month').value = now.getMonth() + 1;
        document.getElementById('time-single-day').value   = now.getDate();

        // ★ 把"总消息数/序号范围"区先置为加载态，让用户立刻看到反馈
        if (timeRangeResult)  timeRangeResult.textContent  = '';
        if (timeSingleResult) timeSingleResult.textContent = '';
        if (rangeStartInput)  rangeStartInput.value = '';
        if (rangeEndInput)    rangeEndInput.value   = '';
        if (rangeInfoEl) {
            rangeInfoEl.innerHTML = '<span style="color:#888;"><i class="fas fa-spinner fa-spin"></i> 加载记忆中...</span>';
        }

        // ★ 立即显示弹窗（此时仍是加载态），用户不再觉得"没点到"
        generateModal.classList.add('visible');
        
        // ★ 预加载期间将提交按钮置灰，防止用户手速太快提交默认值
        const submitBtn = generateForm.querySelector('button[type="submit"]');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.style.background = '#bdbdbd'; }

        // ★ 再异步取真实总数（懒加载下走 DB count，原 chat.history.length 只有 1500）
        const totalMessages = chat
            ? (window.LAZY_LOAD ? await window.getMessageCount(chat.id) : chat.history.length)
            : 0;

        if (rangeInfoEl) rangeInfoEl.textContent = `当前聊天总消息数: ${totalMessages}`;

        // --- 按消息序号：默认填入"未总结"的起止范围（依赖 totalMessages，故放这） ---
        if (chat && totalMessages > 0) {
            const existingItems = currentMemoryTab === 'summary'
                ? (chat.memorySummaries || [])
                : (chat.memoryJournals  || []);
            let maxEnd = 0;
            existingItems.forEach(item => {
                const e = typeof item.range?.end === 'number' ? item.range.end : parseInt(item.range?.end);
                if (!isNaN(e) && e > maxEnd) maxEnd = e;
            });
            if (rangeStartInput) rangeStartInput.value = maxEnd > 0 && maxEnd < totalMessages ? maxEnd + 1 : 1;
            if (rangeEndInput)   rangeEndInput.value   = totalMessages;
        } else {
            if (rangeStartInput) rangeStartInput.value = 1;
            if (rangeEndInput)   rangeEndInput.value   = 0;
        }
        
        // 恢复按钮正常可点
        if (submitBtn) { submitBtn.disabled = false; submitBtn.style.background = '#0099FF'; }
    });

    // ============================================================
    //  提交生成表单（三路分流）
    // ============================================================
    generateForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const submitBtn = generateForm.querySelector('button[type="submit"]');
        const originalBtnText = submitBtn ? submitBtn.textContent : '';
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.style.background = '#bdbdbd';
            submitBtn.textContent = '查询中...';
        }
        
        const restoreSubmitBtn = () => {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.style.background = '#0099FF';
                submitBtn.textContent = originalBtnText;
            }
        };

        const mode = newEntryModeSelect.value;

        try {
            // ----- 模式①：按消息序号 -----
            if (mode === 'by-index') {
                const start = parseInt(document.getElementById('journal-range-start').value);
                const end   = parseInt(document.getElementById('journal-range-end').value);
                const generateBoth = (
                    currentMemoryTab === 'summary' &&
                    document.getElementById('generate-both-switch').checked &&
                    currentChatType !== 'group'
                );

                if (isNaN(start) || isNaN(end) || start <= 0 || end < start) {
                    showToast('请输入有效的起止范围');
                    restoreSubmitBtn();
                    return;
                }
                generateModal.classList.remove('visible');
                restoreSubmitBtn();
                await generateMemoryContent(start, end, generateBoth);

            // ----- 模式②：按时间 -----
            } else if (mode === 'by-time') {
                const isJournal = currentMemoryTab === 'journal';
                let startTs, endTs, occurredAtOverride;

                if (isJournal) {
                    // 日记：单日期
                    const sY = parseInt(document.getElementById('time-single-year').value);
                    const sM = parseInt(document.getElementById('time-single-month').value);
                    const sD = parseInt(document.getElementById('time-single-day').value);
                    if ([sY, sM, sD].some(isNaN)) { showToast('请填写日期'); restoreSubmitBtn(); return; }
                    startTs = new Date(sY, sM - 1, sD, 0, 0, 0, 0).getTime();
                    endTs   = new Date(sY, sM - 1, sD, 23, 59, 59, 999).getTime();
                    occurredAtOverride = `${sY}-${pad(sM)}-${pad(sD)}`;
                } else {
                    // 总结：完整起止
                    const sY = parseInt(document.getElementById('time-start-year').value);
                    const sM = parseInt(document.getElementById('time-start-month').value);
                    const sD = parseInt(document.getElementById('time-start-day').value);
                    const sH = parseInt(document.getElementById('time-start-hour').value);
                    const eY = parseInt(document.getElementById('time-end-year').value);
                    const eM = parseInt(document.getElementById('time-end-month').value);
                    const eD = parseInt(document.getElementById('time-end-day').value);
                    const eH = parseInt(document.getElementById('time-end-hour').value);
                    if ([sY, sM, sD, sH, eY, eM, eD, eH].some(isNaN)) { showToast('请填写完整的起止时间'); restoreSubmitBtn(); return; }
                    startTs = new Date(sY, sM - 1, sD, sH, 0, 0, 0).getTime();
                    endTs   = new Date(eY, eM - 1, eD, eH, 59, 59, 999).getTime();
                    occurredAtOverride = `${sY}-${pad(sM)}-${pad(sD)}`;
                    if (startTs > endTs) { showToast('起始时间不能晚于截止时间'); restoreSubmitBtn(); return; }
                }

                const chat = getCurrentChatObject();
                // [Step S2] async 化，DB 走全局查询
                const { start, end } = await _findRangeByTime(chat, startTs, endTs);
                if (start === -1 || end === -1) { showToast('该时间段内未找到聊天记录'); restoreSubmitBtn(); return; }

                const generateBoth = (
                    currentMemoryTab === 'summary' &&
                    document.getElementById('generate-both-switch').checked &&
                    currentChatType !== 'group'
                );
                generateModal.classList.remove('visible');
                restoreSubmitBtn();
                await generateMemoryContent(start, end, generateBoth, occurredAtOverride);

            // ----- 模式③：新建空白 -----
            } else if (mode === 'blank') {
                const bY = parseInt(document.getElementById('blank-year').value);
                const bM = parseInt(document.getElementById('blank-month').value);
                const bD = parseInt(document.getElementById('blank-day').value);

                // 日期留空则默认今天
                const now2 = new Date();
                const y = isNaN(bY) ? now2.getFullYear() : bY;
                const m = isNaN(bM) ? now2.getMonth() + 1 : bM;
                const d = isNaN(bD) ? now2.getDate() : bD;
                const occurredAt = `${y}-${pad(m)}-${pad(d)}`;

                generateModal.classList.remove('visible');
                restoreSubmitBtn();
                await _createBlankEntry(occurredAt);
            }
        } catch (err) {
            console.error(err);
            showToast('处理异常: ' + err.message);
            restoreSubmitBtn();
        }
    });

    // ============================================================
    //  提交生成表单（长期总结）
    // ============================================================
    longTermForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const submitBtn = longTermForm.querySelector('button[type="submit"]');
        const originalBtnText = submitBtn ? submitBtn.textContent : '';
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.style.background = '#bdbdbd';
            submitBtn.textContent = '查询中...';
        }
        
        const restoreSubmitBtn = () => {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.style.background = '#0099FF';
                submitBtn.textContent = originalBtnText;
            }
        };

        const sY = pad(document.getElementById('long-start-year').value);
        const sM = pad(document.getElementById('long-start-month').value);
        const sD = pad(document.getElementById('long-start-day').value);

        const eY = pad(document.getElementById('long-end-year').value);
        const eM = pad(document.getElementById('long-end-month').value);
        const eD = pad(document.getElementById('long-end-day').value);

        const startDateStr = `${sY}-${sM}-${sD}`;
        const endDateStr   = `${eY}-${eM}-${eD}`;

        if (startDateStr > endDateStr) {
            showToast('开始日期不能晚于结束日期');
            restoreSubmitBtn();
            return;
        }
        longTermModal.classList.remove('visible');
        restoreSubmitBtn();
        await generateLongTermSummaryContent(startDateStr, endDateStr);
    });

    // ============================================================
    //  设置弹窗（世界书 + API预设）
    // ============================================================
    memorySettingsBtn.addEventListener('click', () => {
        const chat = getCurrentChatObject();
        if (!chat) return;

        document.getElementById('memory-settings-modal-title').textContent =
            currentMemoryTab === 'summary' ? '总结设置' : '日记设置';

        // 世界书列表
        const currentBoundIds = currentMemoryTab === 'summary'
            ? (chat.summaryWorldBookIds || [])
            : (chat.journalWorldBookIds || []);
        renderCategorizedWorldBookList(worldBookList, db.worldBooks, currentBoundIds, 'journal-wb-select');

        // 文字API下拉
        const chatPresets = (db.apiPresets || []).filter(p => !p.type || p.type === 'chat');
        memoryChatApiSelect.innerHTML = '<option value="">全局默认</option>';
        chatPresets.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.name; opt.textContent = p.name;
            memoryChatApiSelect.appendChild(opt);
        });
        memoryChatApiSelect.value = (currentMemoryTab === 'summary'
            ? chat.summaryApiPreset : chat.journalApiPreset) || '';

        // 向量API下拉
        const embPresets = (db.apiPresets || []).filter(p => p.type === 'embedding');
        memoryEmbApiSelect.innerHTML = '<option value="">全局默认</option>';
        embPresets.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.name; opt.textContent = p.name;
            memoryEmbApiSelect.appendChild(opt);
        });
        memoryEmbApiSelect.value = (currentMemoryTab === 'summary'
            ? chat.summaryEmbApiPreset : chat.journalEmbApiPreset) || '';

        memorySettingsModal.classList.add('visible');
    });

    saveMemorySettingsBtn.addEventListener('click', async () => {
        const chat = getCurrentChatObject();
        if (!chat) return;
        const selectedIds = Array.from(worldBookList.querySelectorAll('.item-checkbox:checked'))
            .map(el => el.value);
        if (currentMemoryTab === 'summary') {
            chat.summaryWorldBookIds = selectedIds;
            chat.summaryApiPreset    = memoryChatApiSelect.value || null;
            chat.summaryEmbApiPreset = memoryEmbApiSelect.value  || null;
            showToast('总结设置已保存');
        } else {
            chat.journalWorldBookIds = selectedIds;
            chat.journalApiPreset    = memoryChatApiSelect.value || null;
            chat.journalEmbApiPreset = memoryEmbApiSelect.value  || null;
            showToast('日记设置已保存');
        }
        await saveSingleChat(currentChatId, currentChatType);
        memorySettingsModal.classList.remove('visible');
    });

    // ============================================================
    //  列表事件委托（删除 / 收藏 / 进入详情）
    // ============================================================
    journalListContainer.addEventListener('click', async (e) => {
        const target = e.target;
        const card   = target.closest('.journal-card');
        if (!card) return;

        const id   = card.dataset.id;
        const chat = getCurrentChatObject();
        if (!chat) return;

        let targetArrayName = 'memoryJournals';
        if (currentMemoryTab === 'summary') {
            if (currentSummarySubTab === 'long') targetArrayName = 'longTermSummaries';
            else targetArrayName = 'memorySummaries';
        }

        if (!chat[targetArrayName]) chat[targetArrayName] = [];

        const item = chat[targetArrayName].find(j => j.id === id);
        if (!item) return;

        // 删除
        if (target.closest('.delete-journal-btn')) {
            if (await AppUI.confirm('确定要删除这条记录吗？', '系统提示', '确认', '取消')) {
                chat[targetArrayName] = chat[targetArrayName].filter(j => j.id !== id);
                // ★ V6：精准删除 memories 表中的条目
                await deleteMemoryItem(id);
                renderMemoryScreen();
                showToast('已删除');
            }
            return;
        }

        // 收藏
        if (target.closest('.favorite-journal-btn')) {
            item.isFavorited = !item.isFavorited;
            // ★ V6：精准更新 memories 表中的收藏状态
            const memType = targetArrayName === 'longTermSummaries' ? 'long' : targetArrayName === 'memorySummaries' ? 'short' : 'journal';
            await saveMemoryItem(item, currentChatId, memType);
            target.closest('.favorite-journal-btn').classList.toggle('favorited', item.isFavorited);
            showToast(item.isFavorited ? '已收藏' : '已取消收藏');
            return;
        }

        // 进入详情
        openMemoryDetail(item);
    });

    // ============================================================
    //  滚动分页：列表容器滚动到底时追加下一页
    // ============================================================
    const contentPane = document.querySelector('#memory-journal-screen .content');
    if (contentPane) {
        contentPane.addEventListener('scroll', () => {
            const SCROLL_THRESHOLD = 150;
            if (contentPane.scrollTop + contentPane.clientHeight >= contentPane.scrollHeight - SCROLL_THRESHOLD) {
                const totalPages = Math.ceil(_memorySortedItems.length / MEMORY_PAGE_SIZE);
                if (_memoryCurrentPage < totalPages) {
                    _memoryCurrentPage++;
                    _appendMemoryPage();
                }
            }
        });
    }

    // ============================================================
    //  总结详情页编辑（长期总结仍可用；短期总结改为卡片内联编辑，此按钮已从 HTML 移除）
    // ============================================================
    if (editSummaryBtn) editSummaryBtn.addEventListener('click', async () => {
        const isEditing = summaryTitleEl.getAttribute('contenteditable') === 'true';
        if (isEditing) {
            // 保存
            const chat = getCurrentChatObject();
            let item;
            if (currentSummarySubTab === 'long') item = chat.longTermSummaries.find(j => j.id === currentJournalDetailId);
            else item = chat.memorySummaries.find(j => j.id === currentJournalDetailId);

            if (item) {
                item.title     = summaryTitleEl.textContent.trim();
                item.content   = summaryContentEl.innerText;
                item.occurredAt = summaryDateInput.value.trim();

                // ★ V6：精准更新 memories 表
                const memType = currentSummarySubTab === 'long' ? 'long' : 'short';
                await saveMemoryItem(item, currentChatId, memType);
                showToast('保存成功');
                renderMemoryScreen();
            }

            // 退出编辑 UI
            summaryTitleEl.setAttribute('contenteditable', 'false');
            summaryContentEl.setAttribute('contenteditable', 'false');
            summaryTitleEl.style.border   = 'none';
            summaryContentEl.style.border = 'none';
            summaryDateInput.readOnly     = true;
            summaryDateInput.style.borderBottom = '1px dashed #ccc';

            renderSimpleText(item.content, summaryContentEl);
            editSummaryBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18,2.9 17.35,2.9 16.96,3.29L15.13,5.12L18.88,8.87M3,17.25V21H6.75L17.81,9.94L14.06,6.19L3,17.25Z" /></svg>`;
        } else {
            // 进入编辑
            const chat = getCurrentChatObject();
            let item;
            if (currentSummarySubTab === 'long') item = chat.longTermSummaries.find(j => j.id === currentJournalDetailId);
            else item = chat.memorySummaries.find(j => j.id === currentJournalDetailId);
            if (item) summaryContentEl.innerText = item.content;

            summaryTitleEl.setAttribute('contenteditable', 'true');
            summaryContentEl.setAttribute('contenteditable', 'true');
            summaryTitleEl.style.border   = '1px dashed #ccc';
            summaryContentEl.style.border = '1px dashed #ccc';
            if (currentSummarySubTab !== 'long') {
                summaryDateInput.readOnly = false;
                summaryDateInput.style.borderBottom = '1px solid var(--primary-color)';
            }
            editSummaryBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9,16.17L4.83,12L3.41,13.41L9,19L21,7L19.59,5.59L9,16.17Z" /></svg>`;
        }
    }); // end if (editSummaryBtn)

    // ============================================================
    //  日记详情页编辑
    // ============================================================
    editJournalBtn.addEventListener('click', async () => {
        const yearInput  = document.getElementById('journal-date-year');
        const monthInput = document.getElementById('journal-date-month');
        const dayInput   = document.getElementById('journal-date-day');

        const isEditing = journalTitleEl.getAttribute('contenteditable') === 'true';

        if (isEditing) {
            // 保存
            const character = db.characters.find(c => c.id === currentChatId);
            const item      = character.memoryJournals.find(j => j.id === currentJournalDetailId);

            if (item) {
                const cleanTitle   = journalTitleEl.textContent.trim();
                const cleanContent = journalContentEl.innerText;

                item.title   = cleanTitle;
                item.content = cleanContent;

                const y = pad(yearInput.value);
                const m = pad(monthInput.value);
                const d = pad(dayInput.value);
                item.occurredAt = `${y}-${m}-${d}`;

                // ★ V6：精准更新 memories 表
                await saveMemoryItem(item, currentChatId, 'journal');
                showToast('保存成功');
                renderMemoryScreen();

                journalTitleEl.textContent = cleanTitle;
            }

            // 退出编辑
            journalTitleEl.setAttribute('contenteditable', 'false');
            journalContentEl.setAttribute('contenteditable', 'false');
            journalTitleEl.removeAttribute('style');
            journalTitleEl.style.border = '1px solid transparent';

            renderJournalMarkdown(item.content, journalContentEl);
            journalContentEl.className = 'journal-paper-content';

            yearInput.readOnly  = true;
            monthInput.readOnly = true;
            dayInput.readOnly   = true;

            editJournalBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18,2.9 17.35,2.9 16.96,3.29L15.13,5.12L18.88,8.87M3,17.25V21H6.75L17.81,9.94L14.06,6.19L3,17.25Z" /></svg>`;
        } else {
            // 进入编辑
            const character = db.characters.find(c => c.id === currentChatId);
            const item      = character.memoryJournals.find(j => j.id === currentJournalDetailId);

            journalContentEl.innerText    = item.content;
            journalContentEl.className    = 'journal-markdown-content';
            journalContentEl.setAttribute('contenteditable', 'true');

            journalTitleEl.setAttribute('contenteditable', 'true');
            journalTitleEl.style.border = '1px dashed #999';

            yearInput.readOnly  = false;
            monthInput.readOnly = false;
            dayInput.readOnly   = false;

            editJournalBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9,16.17L4.83,12L3.41,13.41L9,19L21,7L19.59,5.59L9,16.17Z" /></svg>`;
        }
    });

    // ============================================================
    //  日记设置（CSS & Font）
    // ============================================================
    journalSettingsBtn.addEventListener('click', () => {
        const character = db.characters.find(c => c.id === currentChatId);
        if (!character) return;

        journalCssInput.value   = character.customJournalCss || '';
        journalFontSelect.value = character.journalFontUrl   || '';
        journalCssModal.classList.add('visible');
    });

    journalCssForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const character = db.characters.find(c => c.id === currentChatId);
        if (!character) return;

        const cssContent = journalCssInput.value.trim();
        const fontUrl    = journalFontSelect.value;

        character.customJournalCss = cssContent;
        character.journalFontUrl   = fontUrl;

        await saveSingleChat(currentChatId, currentChatType);

        const styleTag = document.getElementById('dynamic-journal-style');
        if (styleTag) styleTag.textContent = cssContent;
        applyJournalFont(fontUrl);

        journalCssModal.classList.remove('visible');
        showToast('设置已保存');
    });
}
