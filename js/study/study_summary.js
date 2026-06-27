// study_summary.js — 阅读模块：书本章节总结功能
// 平行于 summary 系列，专为书本内容设计（不含日记/向量，后续可扩展）
// 依赖：database.js (saveBookSummaryItem / deleteBookSummaryItem)
//       study_db.js  (getAllStudyBooks / getStudySettings)
//       study_bookshelf.js（window._study.state.reader.toc / .pages）

// ══════════════════════════════════════════════════════════════
// 运行时状态
// ══════════════════════════════════════════════════════════════
let _bsBookId       = null;     // 当前查看的书 ID
// ① _bsSubTab 已移除（只有章节总结，不再需要分栏）
let _bsSortedItems  = [];       // 排序后的完整列表（供分页）
let _bsCurrentPage  = 1;
let _bsIsGenerating = false;
const _BS_PAGE_SIZE = 15;

// ══════════════════════════════════════════════════════════════
// 工具：获取当前书对象
// ══════════════════════════════════════════════════════════════
function _getBsBook() {
    return (getAllStudyBooks() || db.studyBooks || []).find(b => b.id === _bsBookId);
}

// ══════════════════════════════════════════════════════════════
// 入口：从阅读器底部菜单打开
// ══════════════════════════════════════════════════════════════
window.studyOpenBookSummary = function (book) {
    if (!book?.id) return;
    _bsBookId = book.id;
    switchScreen('study-book-summary-screen');
    requestAnimationFrame(() => {
        _bsEnsureListeners();
        studyRenderBookSummaryScreen();
    });
};

// ══════════════════════════════════════════════════════════════
// 列表渲染
// ══════════════════════════════════════════════════════════════
window.studyRenderBookSummaryScreen = function () {
    const book = _getBsBook();
    if (!book) return;

    // ① 不再更新书名（header 已改为静态"笔记"）

    const container   = document.getElementById('bs-list-container');
    const placeholder = document.getElementById('bs-placeholder');
    if (!container) return;
    container.innerHTML = '';

    // ① 始终使用章节总结，不再区分 short/long
    const items = book.memorySummaries || [];

    if (!items.length) {
        if (placeholder) {
            placeholder.style.display = '';
            const p = placeholder.querySelector('p');
            if (p) p.textContent = '还没有章节总结哦~';
        }
        _bsSortedItems = [];
        return;
    }
    if (placeholder) placeholder.style.display = 'none';

    // 倒序排列（新的在前）
    _bsSortedItems = [...items].sort((a, b) =>
        (b.createdAt || 0) - (a.createdAt || 0)
    );
    _bsCurrentPage = 1;
    _bsAppendPage();
};

function _bsAppendPage() {
    const container = document.getElementById('bs-list-container');
    if (!container) return;

    const startIdx = (_bsCurrentPage - 1) * _BS_PAGE_SIZE;
    const slice    = _bsSortedItems.slice(startIdx, startIdx + _BS_PAGE_SIZE);
    if (!slice.length) return;

    slice.forEach(item => {
        const li = document.createElement('li');
        li.className      = 'journal-card summary-card';
        li.dataset.itemId = item.id;

        // ① 去掉 isLong 分支，dateStr 统一取 occurredAt 日期部分
        const dateStr = (item.occurredAt || '').split(' ')[0];
        const preview = (item.content || '').replace(/\n/g, ' ').slice(0, 60);

        li.innerHTML = `
            <div class="journal-card-header">
                <div class="journal-card-title">${_escHtml(item.chapterRange || item.title || '（无标题）')}</div>
            </div>
            <div class="journal-card-meta">${_escHtml(dateStr)}</div>
            <div class="journal-card-preview">${_escHtml(preview)}${preview.length >= 60 ? '…' : ''}</div>`;

        li.addEventListener('click', () => _bsOpenDetail(item));
        container.appendChild(li);
    });

    _bsCurrentPage++;
}

// ══════════════════════════════════════════════════════════════
// 详情页
// ══════════════════════════════════════════════════════════════
function _bsOpenDetail(item) {
    const screen = document.getElementById('study-book-summary-detail-screen');
    if (!screen) return;

    // 打开新条目时确保退出上一次的编辑模式
    _bsExitEditMode(screen);

    screen._currentItem = item;

    const titleEl = document.getElementById('bs-detail-title');
    if (titleEl) titleEl.textContent = item.chapterRange || item.title || '（无标题）';

    const dateEl = document.getElementById('bs-detail-date');
    if (dateEl) dateEl.value = item.occurredAt || item.startDate || '';

    _bsRenderDetailContent(item.content || '');

    if (!screen._bsDetailBound) {
        screen._bsDetailBound = true;
        _bsBindDetailEvents(screen);
    }

    switchScreen('study-book-summary-detail-screen');
}

// ── 渲染详情正文（view 模式用）──────────────────────────────
function _bsRenderDetailContent(content) {
    const contentEl = document.getElementById('bs-detail-content');
    if (!contentEl) return;
    contentEl.innerHTML = '';
    if (typeof marked !== 'undefined') {
        contentEl.innerHTML = marked.parse(content);
    } else {
        const p = document.createElement('p');
        p.style.whiteSpace = 'pre-wrap';
        p.textContent = content;
        contentEl.appendChild(p);
    }
}

// ── 退出编辑模式（切屏 / 打开新条目时调用）────────────────
function _bsExitEditMode(screen) {
    if (!screen._bsIsEditing) return;
    screen._bsIsEditing = false;
    const contentEl  = document.getElementById('bs-detail-content');
    const textareaEl = document.getElementById('bs-detail-content-textarea');
    if (contentEl)  contentEl.style.display  = '';
    if (textareaEl) textareaEl.style.display = 'none';
    _bsSetEditBtnMode(false);
}

// ── 切换编辑按钮图标（铅笔 ↔ 对勾）────────────────────────
function _bsSetEditBtnMode(isEditing) {
    const btn = document.getElementById('bs-detail-edit-btn');
    if (!btn) return;
    const icon = btn.querySelector('svg');
    if (!icon) return;
    if (isEditing) {
        // 对勾：保存
        icon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" fill="none" stroke="currentColor" stroke-width="2" d="M5 13l4 4L19 7"/>';
        btn.title = '保存';
    } else {
        // 铅笔：编辑
        icon.innerHTML = '<path fill="currentColor" d="M20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18,2.9 17.35,2.9 16.96,3.29L15.13,5.12L18.88,8.87M3,17.25V21H6.75L17.81,9.94L14.06,6.19L3,17.25Z" />';
        btn.title = '编辑';
    }
}

function _bsBindDetailEvents(screen) {
    // ② 编辑 / 保存
    document.getElementById('bs-detail-edit-btn')?.addEventListener('click', async () => {
        const item = screen._currentItem;
        if (!item) return;

        if (screen._bsIsEditing) {
            // ── 保存 ──────────────────────────────────────────
            const textareaEl = document.getElementById('bs-detail-content-textarea');
            const newContent = textareaEl?.value ?? '';
            item.content = newContent;

            await saveBookSummaryItem(item, _bsBookId, 'short');

            _bsRenderDetailContent(newContent);
            document.getElementById('bs-detail-content').style.display  = '';
            if (textareaEl) textareaEl.style.display = 'none';
            screen._bsIsEditing = false;
            _bsSetEditBtnMode(false);
            showToast('已保存');
        } else {
            // ── 进入编辑 ──────────────────────────────────────
            const textareaEl = document.getElementById('bs-detail-content-textarea');
            if (textareaEl) {
                textareaEl.value = item.content || '';
                textareaEl.style.display = 'block';
            }
            document.getElementById('bs-detail-content').style.display = 'none';
            screen._bsIsEditing = true;
            _bsSetEditBtnMode(true);
            textareaEl?.focus();
        }
    });

    // 删除
    document.getElementById('bs-detail-delete-btn')?.addEventListener('click', async () => {
        const item = screen._currentItem;
        if (!item) return;
        const ok = typeof AppUI !== 'undefined'
            ? await AppUI.confirm('确定删除这条总结吗？', '删除', '取消')
            : confirm('确定删除这条总结吗？');
        if (!ok) return;

        const book = _getBsBook();
        const arr  = book?.memorySummaries || [];
        const idx  = arr.findIndex(s => s.id === item.id);
        if (idx >= 0) arr.splice(idx, 1);

        await deleteBookSummaryItem(item.id);

        _bsExitEditMode(screen);
        switchScreen('study-book-summary-screen');
        studyRenderBookSummaryScreen();
        showToast('已删除');
    });
}

// ══════════════════════════════════════════════════════════════
// 生成弹窗
// ══════════════════════════════════════════════════════════════
function _bsOpenGenerateModal() {
    const s   = window._study?.state?.reader;
    const toc = s?.toc || [];

    if (!toc.length) {
        showToast('未识别到章节目录，请先打开书籍');
        return;
    }

    const startSel  = document.getElementById('bs-gen-chapter-start');
    const endSel    = document.getElementById('bs-gen-chapter-end');
    const customSel = document.getElementById('bs-gen-custom-chapter');
    if (!startSel || !endSel) return;

    const opts = toc.map((item, i) =>
        `<option value="${i}">${i + 1}. ${_escHtml(item.title || '（无标题）')}</option>`
    ).join('');
    startSel.innerHTML  = opts;
    endSel.innerHTML    = opts;
    if (customSel) customSel.innerHTML = opts;
    startSel.value = '0';
    endSel.value   = '0';

    // 重置为 AI 模式
    const modeSel = document.getElementById('bs-gen-mode');
    if (modeSel) modeSel.value = 'ai';
    document.getElementById('bs-gen-ai-fields').style.display     = '';
    document.getElementById('bs-gen-custom-fields').style.display = 'none';
    const submitBtn = document.getElementById('bs-gen-submit-btn');
    if (submitBtn) submitBtn.textContent = '生成';

    const textarea = document.getElementById('bs-gen-custom-content');
    if (textarea) textarea.value = '';

    document.getElementById('study-book-generate-modal')?.classList.add('visible');
}

function _bsCloseGenerateModal() {
    document.getElementById('study-book-generate-modal')?.classList.remove('visible');
}

// ══════════════════════════════════════════════════════════════
// AI 生成章节总结
// 单章：一次 API → 【标题】/【内容】格式 → 1 条记录
// 多章：一次 API → 按 <CHAPTER_N>...</CHAPTER_N> 标签切分 → 每章 1 条记录
// 返回值：Item 数组（单章也是数组，方便调用方统一处理）
// ══════════════════════════════════════════════════════════════
async function _bsDoGenerate(startIdx, endIdx) {
    const book = _getBsBook();
    if (!book) throw new Error('未找到书籍对象');

    const s     = window._study?.state?.reader;
    const toc   = s?.toc   || [];
    const pages = s?.pages || [];

    if (!toc.length || !pages.length) {
        throw new Error('请先在阅读器中打开书籍，再生成总结');
    }

    // ── API 配置 ──────────────────────────────────────────
    const studySettings = db.studySettings || {};
    let apiConfig = db.apiSettings || {};
    if (studySettings.textApiPresetId) {
        const preset = (db.apiPresets || []).find(p =>
            p.id === studySettings.textApiPresetId && (!p.type || p.type === 'chat')
        );
        if (preset?.data) apiConfig = preset.data;
    }
    const { url, key, model, temperature } = apiConfig;
    if (!url || !key)  throw new Error('请先在「学习设置」中配置文本 API 预设');
    if (!model)        throw new Error('API 预设缺少模型名称');

    const isSingle = startIdx === endIdx;

    if (isSingle) {
        const item = await _bsGenerateSingleChapter(
            book, toc, pages, startIdx, { url, key, model, temperature }
        );
        return [item];
    } else {
        return await _bsGenerateMultiChapter(
            book, toc, pages, startIdx, endIdx, { url, key, model, temperature }
        );
    }
}

// ── 单章生成 ──────────────────────────────────────────────────
async function _bsGenerateSingleChapter(book, toc, pages, chapterIdx, apiConfig) {
    const MAX_CHARS = 6000;

    const startPage = toc[chapterIdx].page;
    const endPage   = (chapterIdx + 1 < toc.length)
        ? toc[chapterIdx + 1].page - 1
        : pages.length - 1;

    let chapterRaw  = pages.slice(startPage, endPage + 1).join('\n');
    const truncated = chapterRaw.length > MAX_CHARS;
    if (truncated) chapterRaw = chapterRaw.slice(0, MAX_CHARS) + '\n\n[...（文本过长已截断）]';

    const chapterTitle = toc[chapterIdx].title || `第${chapterIdx + 1}章`;

    const systemPrompt = [
        '你是专业的读书笔记整理员。',
        '任务：将提供的书籍章节内容精炼为简洁摘要，供读者后续快速回顾使用。',
        '',
        `书名：${book.title}`,
        `章节：${chapterTitle}`,
        '',
        '要求：',
        '- 客观概括主要情节 / 核心论点',
        '- 保留关键人物、事件、转折点',
        '- 50～150 字',
        '',
        '请直接输出摘要内容，不要标题，不要标签，不要多余内容。',
    ].join('\n');

    const userContent = `以下是章节原文${truncated ? '（已截断）' : ''}：\n\n${chapterRaw}`;

    const raw = await _bsCallApi(apiConfig, systemPrompt, userContent);

    const title   = chapterTitle;
    const content = raw.trim();

    return await _bsSaveItem(book, {
        title,
        content,
        chapterRange:    chapterTitle,
        startChapterIdx: chapterIdx,
        endChapterIdx:   chapterIdx,
    });
}

// ── 多章生成 ──────────────────────────────────────────────────
async function _bsGenerateMultiChapter(book, toc, pages, startIdx, endIdx, apiConfig) {
    const MAX_PER_CHAPTER = 5000;
    const MAX_TOTAL       = 60000;

    const chapters = [];
    let totalChars = 0;
    for (let i = startIdx; i <= endIdx; i++) {
        const sp = toc[i].page;
        const ep = (i + 1 < toc.length) ? toc[i + 1].page - 1 : pages.length - 1;
        let raw  = pages.slice(sp, ep + 1).join('\n');
        const truncated = raw.length > MAX_PER_CHAPTER;
        if (truncated) raw = raw.slice(0, MAX_PER_CHAPTER) + '\n[...（已截断）]';
        totalChars += raw.length;
        if (totalChars > MAX_TOTAL) {
            raw = raw.slice(0, Math.max(0, MAX_TOTAL - (totalChars - raw.length))) + '\n[...（总量截断）]';
        }
        chapters.push({
            idx:   i,
            title: toc[i].title || `第${i + 1}章`,
            raw,
        });
        if (totalChars >= MAX_TOTAL) break;
    }

    const chapterListDesc = chapters.map((c, n) =>
        `章节 ${n}（原书章节索引 ${c.idx}）：${c.title}`
    ).join('\n');

    const outputFmt = chapters.map((_, n) =>
        `<CHAPTER_${n}>\n（50～150字摘要内容）\n</CHAPTER_${n}>`
    ).join('\n\n');

    const systemPrompt = [
        '你是专业的读书笔记整理员。',
        `任务：为书《${book.title}》的以下 ${chapters.length} 个章节分别生成独立摘要。`,
        '',
        chapterListDesc,
        '',
        '要求：',
        '- 每章独立总结，客观概括主要情节 / 核心论点',
        '- 保留关键人物、事件、转折点，每章 50～150 字',
        '- 必须为每一章都生成总结，一章都不能省略',
        '',
        '请严格按以下格式输出，标签外不要有任何其他内容：',
        '',
        outputFmt,
    ].join('\n');

    const userParts  = chapters.map((c, n) =>
        `=== 章节 ${n}：${c.title} ===\n${c.raw}`
    );
    const userContent = '以下是各章原文：\n\n' + userParts.join('\n\n');

    const raw     = await _bsCallApi(apiConfig, systemPrompt, userContent);
    const now     = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    const results = [];

    for (let n = 0; n < chapters.length; n++) {
        const c = chapters[n];
        const blockReg   = new RegExp(`<CHAPTER_${n}>([\\s\\S]*?)</CHAPTER_${n}>`, 'i');
        const blockMatch = raw.match(blockReg);
        const block      = blockMatch ? blockMatch[1].trim() : '';

        const title   = c.title;
        const content = block ? block.trim() : `（第 ${n + 1} 章总结未能解析，请重新生成）`;

        const item = await _bsSaveItem(book, {
            title,
            content,
            chapterRange:    c.title,
            startChapterIdx: c.idx,
            endChapterIdx:   c.idx,
            dateStr,
        });
        results.push(item);
    }

    return results;
}

// ── 公共：构造并持久化一条总结记录 ──────────────────────────
// ③ 同章节已有总结时自动替换（删旧存新）
async function _bsSaveItem(book, { title, content, chapterRange, startChapterIdx, endChapterIdx, dateStr: _dateStr }) {
    const now = new Date();
    const dateStr = _dateStr || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    const newItem = {
        id:              `bsum_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        title,
        content,
        occurredAt:      dateStr,
        chapterRange,
        startChapterIdx,
        endChapterIdx,
        createdAt:       Date.now(),
        isFavorited:     false,
    };

    if (!book.memorySummaries) book.memorySummaries = [];

    // ③ 替换同章节旧总结
    const existingIdx = book.memorySummaries.findIndex(s =>
        s.startChapterIdx === startChapterIdx && s.endChapterIdx === endChapterIdx
    );
    if (existingIdx >= 0) {
        const oldId = book.memorySummaries[existingIdx].id;
        await deleteBookSummaryItem(oldId);
        book.memorySummaries.splice(existingIdx, 1);
    }

    book.memorySummaries.push(newItem);
    await saveBookSummaryItem(newItem, book.id, 'short');
    return newItem;
}

// ── 公共：发 API 请求，返回 raw 字符串 ───────────────────────
async function _bsCallApi({ url, key, model, temperature }, systemPrompt, userContent) {
    const resp = await fetch(`${url.replace(/\/$/, '')}/v1/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
            model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user',   content: userContent  },
            ],
            temperature: temperature ?? 0.5,
        }),
    });
    if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new Error(`API ${resp.status}：${errText.slice(0, 100)}`);
    }
    const result = await resp.json();
    return result?.choices?.[0]?.message?.content || '';
}

// ══════════════════════════════════════════════════════════════
// 事件绑定（只绑一次）
// ══════════════════════════════════════════════════════════════
function _bsEnsureListeners() {
    const screen = document.getElementById('study-book-summary-screen');
    if (!screen || screen._bsBound) return;
    screen._bsBound = true;

    // ① 侧边栏监听已移除

    // 顶部「+」按钮
    document.getElementById('bs-generate-btn')?.addEventListener('click', _bsOpenGenerateModal);

    // 弹窗取消
    document.getElementById('bs-gen-cancel-btn')?.addEventListener('click', _bsCloseGenerateModal);
    
    // 模式切换
document.getElementById('bs-gen-mode')?.addEventListener('change', e => {
    const isAi = e.target.value === 'ai';
    document.getElementById('bs-gen-ai-fields').style.display     = isAi ? '' : 'none';
    document.getElementById('bs-gen-custom-fields').style.display = isAi ? 'none' : '';
    const submitBtn = document.getElementById('bs-gen-submit-btn');
    if (submitBtn) submitBtn.textContent = isAi ? '生成' : '保存';
});

    // 弹窗遮罩点击关闭
    document.getElementById('study-book-generate-modal')?.addEventListener('click', e => {
        if (e.target === e.currentTarget) _bsCloseGenerateModal();
    });

    // 弹窗提交
    document.getElementById('bs-gen-submit-btn')?.addEventListener('click', async () => {
    if (_bsIsGenerating) return;

    const mode = document.getElementById('bs-gen-mode')?.value || 'ai';

    // ── 手动编写模式 ──────────────────────────────────────
    if (mode === 'custom') {
        const chapterIdx = parseInt(document.getElementById('bs-gen-custom-chapter').value, 10);
        const content    = document.getElementById('bs-gen-custom-content').value.trim();
        if (isNaN(chapterIdx)) return;
        if (!content) { showToast('请输入笔记内容'); return; }

        const s            = window._study?.state?.reader;
        const toc          = s?.toc || [];
        const chapterTitle = toc[chapterIdx]?.title || `第${chapterIdx + 1}章`;
        const book         = _getBsBook();
        if (!book) return;

        const existing = (book.memorySummaries || []).find(s =>
            s.startChapterIdx === chapterIdx && s.endChapterIdx === chapterIdx
        );
        if (existing) {
            const ok = typeof AppUI !== 'undefined'
                ? await AppUI.confirm(`「${chapterTitle}」已有笔记，是否替换？`, '替换确认', '替换', '取消')
                : confirm(`「${chapterTitle}」已有笔记，是否替换？`);
            if (!ok) return;
        }

        _bsCloseGenerateModal();
        await _bsSaveItem(book, {
            title:           chapterTitle,
            content,
            chapterRange:    chapterTitle,
            startChapterIdx: chapterIdx,
            endChapterIdx:   chapterIdx,
        });
        studyRenderBookSummaryScreen();
        showToast('笔记已保存');
        return;
    }

        const startIdx = parseInt(document.getElementById('bs-gen-chapter-start').value, 10);
        const endIdx   = parseInt(document.getElementById('bs-gen-chapter-end').value,   10);

        if (isNaN(startIdx) || isNaN(endIdx)) return;
        if (endIdx < startIdx) {
            showToast('结束章节不能早于起始章节');
            return;
        }

        // ③ 检查是否已有总结，提示用户确认替换
        const book     = _getBsBook();
        const existing = (book?.memorySummaries || []).filter(s => {
            const si = s.startChapterIdx ?? -1;
            const ei = s.endChapterIdx   ?? -1;
            return si >= startIdx && ei <= endIdx;
        });
        if (existing.length) {
            const label = existing.length === 1
                ? `「${existing[0].chapterRange || existing[0].title}」`
                : `${existing.length} 个章节`;
            const ok = typeof AppUI !== 'undefined'
                ? await AppUI.confirm(
                    `${label}已有总结，是否替换原有内容？`,
                    '替换确认', '替换', '取消'
                  )
                : confirm(`${label}已有总结，是否替换原有内容？`);
            if (!ok) return;
        }

        _bsCloseGenerateModal();
        _bsIsGenerating = true;

        const genBtn = document.getElementById('bs-generate-btn');
        if (genBtn) genBtn.disabled = true;

        const chapterCount = endIdx - startIdx + 1;
        const loadingMsg   = chapterCount > 1
            ? `正在生成 ${chapterCount} 章总结，请稍候…`
            : '正在生成章节总结，请稍候…';
        const hideLoading  = showLoadingToast(loadingMsg);

        try {
            const newItems = await _bsDoGenerate(startIdx, endIdx);
            // ① 不再需要 _bsSubTab = 'short'
            studyRenderBookSummaryScreen();
            hideLoading();
            const doneMsg = Array.isArray(newItems) && newItems.length > 1
                ? `已生成 ${newItems.length} 章总结！`
                : '总结生成完成！';
            showToast(doneMsg);
        } catch (e) {
            console.error('[BookSummary] 生成失败:', e);
            hideLoading();
            showToast('❌ 生成失败：' + e.message);
        } finally {
            _bsIsGenerating = false;
            if (genBtn) genBtn.disabled = false;
        }
    });

    // 滚动加载更多
    const mainEl = screen.querySelector('.content');
    if (mainEl) {
        mainEl.addEventListener('scroll', () => {
            const nearBottom = mainEl.scrollTop + mainEl.clientHeight >= mainEl.scrollHeight - 100;
            if (nearBottom && _bsSortedItems.length >= (_bsCurrentPage - 1) * _BS_PAGE_SIZE) {
                _bsAppendPage();
            }
        });
    }
}

// ══════════════════════════════════════════════════════════════
// 工具函数
// ══════════════════════════════════════════════════════════════
function _escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
