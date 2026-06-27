// study_bank.js — 题库管理模块
// 依赖：study_core.js / study_db.js / study_ai.js / study_bookshelf.js(_scanRawToc)
// 包含三个 screen：
//   study-bank-screen       题库详情（题目列表）
//   study-bank-edit-screen  单题编辑
//   study-bank-add-screen   新增题目（导入 / AI生成）
// =====================================================

// ── 状态 ────────────────────────────────────────────
window._study.state.bank = {
  currentBankId: null,   // 当前操作的题库
  editingQId:    null,   // 正在编辑的题目 id（null=新建单题）
  addMode:       'ai',   // 'ai' | 'import' | 'manual'
  // AI生成子状态
  ai: {
    bookId:      null,
    toc:         [],       // [{title, startLine, endLine}]
    selectedChapters: [],  // 选中章节的 title 列表
    useCharRange: false,   // 无章节时退回字数范围
    charStart:   0,
    charEnd:     50000,
    count:       5,
    typePreference: 'mixed', // 'mixed'|'choice'|'qa'
    pending:     null,       // 识别到的待确认题目数组
    loading:     false,
  },
  // 导入子状态
  imp: {
    pending: null,   // 解析后的待确认题目数组
    fileName: '',
  },
  // 手动新增子状态（与单题编辑表单共用结构，便于切换添加方式时保留已填内容）
  manual: {
    type: 'qa', question: '', options: ['', '', '', ''], answer: '', analysis: '',
  },
};

// ── 工具 ────────────────────────────────────────────
function _stH(str) { return window._study.h(str); }

function _genQId() {
  return `q_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

// ── 初始化（只执行一次）─────────────────────────────
let _bankInited = false;
function _studyBankInit() {
  if (_bankInited) return;
  _bankInited = true;

  // 注册页面进入钩子
  window._screenEnterHooks = window._screenEnterHooks || {};
  window._screenEnterHooks['study-bank-screen']      = () => studyRenderBankScreen();
  window._screenEnterHooks['study-bank-edit-screen'] = () => studyRenderBankEdit();
  window._screenEnterHooks['study-bank-add-screen']  = () => studyRenderBankAdd();
  
  // 多选模式：取消按钮
  document.getElementById('st-bk-cancel-select-btn')?.addEventListener('click', _exitBankSelectMode);

  // 多选模式：删除按钮
  document.getElementById('st-bk-delete-selected-btn')?.addEventListener('click', async () => {
    const ids = [..._bankSelectedIds];
    if (!ids.length) return;
    const ok = await AppUI.confirm(
      `确定删除选中的 ${ids.length} 道题目？此操作不可撤销。`,
      '批量删除题目',
      '删除',
      '取消'
    );
    if (!ok) return;
    for (const qId of ids) await deleteBankQuestion(qId);
    _exitBankSelectMode();
  });
}

// =============================================================
// screen 1：study-bank-screen  题库详情页
// =============================================================

function studyOpenBank(bankId) {
  _studyBankInit();
  window._study.state.bank.currentBankId = bankId;
  if (typeof navigateTo === 'function') navigateTo('study-bank-screen');
  // hooks 会自动调 studyRenderBankScreen
}

function studyRenderBankScreen() {
  const { bank } = window._study.state;
  const bankId   = bank.currentBankId;
  const allBanks = getAllStudyBanks();
  const bankObj  = allBanks.find(b => b.id === bankId);
  if (!bankObj) return;

  // 渲染 header 题库名
  const titleEl = document.getElementById('st-bk-title');
  if (titleEl) titleEl.textContent = bankObj.name;

  // 题目列表
  const listEl = document.getElementById('st-bk-list');
  if (!listEl) return;

  const qs = getQuestionsByBank(bankId).sort((a, b) => a.createdAt - b.createdAt);

  if (!qs.length) {
    listEl.innerHTML = `<div class="st-center-msg" style="padding:48px 0">
      还没有题目<br><small style="color:var(--text-tertiary,#aaa)">点右上角「+」添加题目</small>
    </div>`;
    return;
  }

  listEl.innerHTML = qs.map(q => {
    const typeLabel = q.type === 'choice' ? '客观' : '主观';
    const typeCls   = q.type === 'choice' ? 'st-badge-choice' : 'st-badge-qa';
    const preview   = (q.question || '').slice(0, 40) + ((q.question || '').length > 40 ? '…' : '');
    return `
  <div class="st-bk-item" data-qid="${_stH(q.id)}">
    <span class="st-bk-check"></span>
    <span class="st-badge ${typeCls}">${typeLabel}</span>
    <span class="st-bk-item-text">${_stH(preview)}</span>
    <span class="st-bk-item-arrow">${window._study.icons.chevronRight()}</span>
  </div>`;
  }).join('');

  // 统一在一个 forEach 里处理点击 & 长按
  listEl.querySelectorAll('.st-bk-item').forEach(row => {
    let pressTimer;

    row.addEventListener('pointerdown', () => {
      pressTimer = setTimeout(() => {
        // 已在多选模式就不重复触发
        if (document.getElementById('study-bank-screen').classList.contains('st-bk-select-active')) return;
        _enterBankSelectMode(row.dataset.qid);
      }, 500);
    });
    row.addEventListener('pointerup',    () => clearTimeout(pressTimer));
    row.addEventListener('pointerleave', () => clearTimeout(pressTimer));

    row.addEventListener('click', () => {
      const isSelect = document.getElementById('study-bank-screen').classList.contains('st-bk-select-active');
      if (isSelect) {
        const qid = row.dataset.qid;
        _bankSelectedIds.has(qid) ? _bankSelectedIds.delete(qid) : _bankSelectedIds.add(qid);
        _refreshBankSelectUI();
      } else {
        bank.editingQId = row.dataset.qid;
        if (typeof navigateTo === 'function') navigateTo('study-bank-edit-screen');
      }
    });
  });
}

// ── 批量选择模式 ──────────────────────────────────────
let _bankSelectedIds = new Set();

function _enterBankSelectMode(preSelectId) {
  _bankSelectedIds = new Set();
  if (preSelectId) _bankSelectedIds.add(preSelectId);

  document.getElementById('st-bk-header-default').style.display = 'none';
  document.getElementById('st-bk-header-select').style.display  = '';
  document.getElementById('st-bk-select-bar').classList.add('visible');
  document.getElementById('study-bank-screen').classList.add('st-bk-select-active');

  _refreshBankSelectUI();
}

function _exitBankSelectMode() {
  _bankSelectedIds = new Set();
  document.getElementById('st-bk-header-default').style.display = '';
  document.getElementById('st-bk-header-select').style.display  = 'none';
  document.getElementById('st-bk-select-bar').classList.remove('visible');
  document.getElementById('study-bank-screen').classList.remove('st-bk-select-active');
  studyRenderBankScreen();
}

function _refreshBankSelectUI() {
  const count = _bankSelectedIds.size;
  document.getElementById('st-bk-select-title').textContent =
    count ? `已选 ${count} 题` : '选择题目';
  const delBtn = document.getElementById('st-bk-delete-selected-btn');
  if (delBtn) delBtn.disabled = count === 0;
  document.getElementById('st-bk-select-count').textContent = `已选 ${count} 题`;

  document.querySelectorAll('#st-bk-list .st-bk-item').forEach(row => {
    const selected = _bankSelectedIds.has(row.dataset.qid);
    row.classList.toggle('st-bk-selected', selected);
    const check = row.querySelector('.st-bk-check');
    if (check) check.classList.toggle('checked', selected);
  });
}

// 题库改名
async function _studyRenameBankPrompt() {
  const { bank } = window._study.state;
  const bankObj  = getAllStudyBanks().find(b => b.id === bank.currentBankId);
  if (!bankObj) return;
  const newName = await AppUI.prompt('修改题库名称', bankObj.name, '题库改名');
  if (!newName || newName.trim() === bankObj.name) return;
  await updateStudyBankMeta(bank.currentBankId, { name: newName.trim() });
  const titleEl = document.getElementById('st-bk-title');
  if (titleEl) titleEl.textContent = newName.trim();
  // 同步刷新测试页题库面板
  studyRenderBankPanel();
}

// =============================================================
// screen 2：study-bank-edit-screen  单题编辑
// DOM 已静态化在 HTML 中（id 前缀 edit-），此处只做填值 + show/hide
// =============================================================

function studyRenderBankEdit() {
  const { bank } = window._study.state;
  const existing = bank.editingQId
    ? (db.studyQuestions || []).find(q => q.id === bank.editingQId)
    : null;

  _fillEditForm('edit', {
    type:     existing?.type     || 'qa',
    question: existing?.question || '',
    options:  existing?.options  || ['', '', '', ''],
    answer:   existing?.answer   || '',
    analysis: existing?.analysis || '',
  });
}

// ── 通用表单填值（edit-screen 和 add-screen manual 面板共用）──
// prefix='edit' → id 前缀为 edit-，容器为 #st-edit-body
// prefix='mn'   → id 前缀为 mn-，  容器为 #st-manual-form-wrap
function _fillEditForm(prefix, { type, question, options, answer, analysis }) {
  const isChoice  = type === 'choice';
  const $         = id => document.getElementById(id);
  const container = $(prefix === 'edit' ? 'st-edit-body' : 'st-manual-form-wrap');
  if (!container) return;

  // 基础字段
  const typeEl = $(`${prefix}-type-select`);
  if (typeEl) typeEl.value = type;
  const qEl = $(`${prefix}-question`);
  if (qEl) qEl.value = question;
  const aEl = $(`${prefix}-analysis`);
  if (aEl) aEl.value = analysis;

  // 切换 choice / qa 专区
  const choiceSec = $(`${prefix}-choice-section`);
  const qaSec     = $(`${prefix}-qa-section`);
  if (choiceSec) choiceSec.style.display = isChoice ? '' : 'none';
  if (qaSec)     qaSec.style.display     = isChoice ? 'none' : '';

  if (isChoice) {
    ['A', 'B', 'C', 'D'].forEach((l, i) => {
      const el = $(`${prefix}-opt-${l}`);
      if (el) el.value = (options || [])[i] || '';
    });
    // 答案按钮 active 状态
    container.querySelectorAll('.st-edit-ans-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.letter === answer);
    });
  } else {
    const ansEl = $(`${prefix}-answer`);
    if (ansEl) ansEl.value = answer;
  }

  _bindEditFormEvents(prefix, container);
}

// ── 表单事件绑定（type 切换 + 答案按钮）──
// 注：每次 _fillEditForm 调用时都会重新执行本函数，
//     但因为 type-select 和答案按钮是 static DOM，需要先移除旧监听器。
//     用 AbortController 保证每个 prefix 只有一组有效监听器。
const _editFormCtrls = {};
function _bindEditFormEvents(prefix, container) {
  // 先 abort 旧的
  if (_editFormCtrls[prefix]) _editFormCtrls[prefix].abort();
  _editFormCtrls[prefix] = new AbortController();
  const signal = _editFormCtrls[prefix].signal;

  // 类型 select：切换时只做 show/hide + 填值，不再整体 innerHTML
  document.getElementById(`${prefix}-type-select`)?.addEventListener('change', (e) => {
    const snap = _readEditForm(prefix);
    snap.type  = e.target.value;
    _fillEditForm(prefix, snap);
  }, { signal });

  // 答案按钮
  container?.querySelectorAll('.st-edit-ans-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.st-edit-ans-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    }, { signal });
  });
}

// ── 从表单读取当前值 ──
function _readEditForm(prefix = 'edit') {
  const container = document.getElementById(prefix === 'edit' ? 'st-edit-body' : 'st-manual-form-wrap');
  const type      = document.getElementById(`${prefix}-type-select`)?.value || 'qa';
  const isChoice  = type === 'choice';
  const question  = document.getElementById(`${prefix}-question`)?.value || '';
  const analysis  = document.getElementById(`${prefix}-analysis`)?.value || '';

  let options = null, answer = '';
  if (isChoice) {
    options = ['A', 'B', 'C', 'D'].map(l => document.getElementById(`${prefix}-opt-${l}`)?.value || '');
    answer  = container?.querySelector('.st-edit-ans-btn.active')?.dataset.letter || '';
  } else {
    answer = document.getElementById(`${prefix}-answer`)?.value || '';
  }

  return { type, question, options, answer, analysis };
}

async function studySaveBankEdit() {
  const { bank } = window._study.state;
  // editingQId 非 null → edit-screen；null → add-screen manual 面板
  const prefix = (bank.editingQId !== null && bank.editingQId !== undefined) ? 'edit' : 'mn';
  const data   = _readEditForm(prefix);

  if (!data.question.trim()) { AppUI.alert('题目内容不能为空', '提示'); return; }
  if (data.type === 'choice') {
    const filled = (data.options || []).filter(o => o.trim()).length;
    if (filled < 2) { AppUI.alert('客观题至少填写 2 个选项', '提示'); return; }
    if (!data.answer) { AppUI.alert('请选择正确答案', '提示'); return; }
  } else {
    if (!data.answer.trim()) { AppUI.alert('请填写答案', '提示'); return; }
  }

  if (bank.editingQId) {
    // 更新已有题目
    await updateStudyQuestion(bank.editingQId, {
      type:     data.type,
      question: data.question.trim(),
      options:  data.type === 'choice' ? data.options : null,
      answer:   data.answer.trim(),
      analysis: data.analysis.trim(),
    });
  } else {
    // 新建单题
    const newQ = {
      id:        _genQId(),
      bankId:    bank.currentBankId,
      type:      data.type,
      question:  data.question.trim(),
      options:   data.type === 'choice' ? data.options : null,
      answer:    data.answer.trim(),
      analysis:  data.analysis.trim(),
      createdAt: Date.now(),
    };
    db.studyQuestions = db.studyQuestions || [];
    db.studyQuestions.push(newQ);
    await saveStudyQuestionToDB(newQ);
  }

  // 返回题库详情页
  if (typeof navigateTo === 'function') navigateTo('study-bank-screen');
}

// =============================================================
// screen 3：study-bank-add-screen  新增题目
// DOM 骨架已静态化在 HTML 中，三个面板通过 show/hide 切换，
// 只有 AI 面板的范围区（章节/字数）和 pending 区必须动态构建。
// =============================================================

function studyOpenBankAdd(bankId) {
  const { bank } = window._study.state;
  bank.currentBankId = bankId;
  bank.editingQId    = null;  // 确保手动新增走"新建"分支
  // 重置状态
  bank.addMode = 'ai';
  Object.assign(bank.ai, {
    bookId: null, toc: [], selectedChapters: [], useCharRange: false,
    charStart: 0, charEnd: 50000, count: 5, typePreference: 'mixed',
    pending: null, loading: false,
  });
  bank.imp    = { pending: null, fileName: '' };
  bank.manual = { type: 'qa', question: '', options: ['', '', '', ''], answer: '', analysis: '' };

  if (typeof navigateTo === 'function') navigateTo('study-bank-add-screen');
}

function studyRenderBankAdd() {
  const { bank } = window._study.state;

  // header subtitle（题库名）
  const bankObj    = getAllStudyBanks().find(b => b.id === bank.currentBankId);
  const subtitleEl = document.getElementById('st-add-subtitle');
  if (subtitleEl) subtitleEl.textContent = bankObj?.name || '';

  // 添加方式 select 同步 state
  const modeSelect = document.getElementById('add-mode-select');
  if (modeSelect) modeSelect.value = bank.addMode;

  // 书籍下拉填充（options 来自 DB，需动态，但只填 options 不重建 select）
  _populateBookSelect();

  // 显示对应面板，绑定事件
  _switchAddPanel(bank.addMode);

  // 模式切换事件（绑定在 select 上，进入页面时绑定一次）
  // 用 AbortController 防止返回后重复绑定
  if (_addModeCtrl) _addModeCtrl.abort();
  _addModeCtrl = new AbortController();
  modeSelect?.addEventListener('change', (e) => {
    // 切换前保存手动表单当前内容
    if (bank.addMode === 'manual') {
      bank.manual = _readEditForm('mn');
    }
    bank.addMode = e.target.value;
    _switchAddPanel(bank.addMode);
  }, { signal: _addModeCtrl.signal });
}

// 模式切换 AbortController（防止 navigateTo 来回时重复绑定）
let _addModeCtrl = null;

// ── 填充书籍下拉选项（只更新 <option>，不重建 <select>）──
function _populateBookSelect() {
  const { ai } = window._study.state.bank;
  const bookSel = document.getElementById('ai-book-select');
  if (!bookSel) return;

  const books = getAllStudyBooks();
  bookSel.innerHTML =
    `<option value="">— 请选择 —</option>` +
    books.map(b =>
      `<option value="${_stH(b.id)}" ${ai.bookId === b.id ? 'selected' : ''}>${_stH(b.title)}</option>`
    ).join('');
}

// ── 切换三个面板的显隐，并绑定对应事件 ──
let _panelEventsCtrl = null;
function _switchAddPanel(mode) {
  document.getElementById('st-panel-ai').style.display     = mode === 'ai'     ? '' : 'none';
  document.getElementById('st-panel-import').style.display = mode === 'import' ? '' : 'none';
  document.getElementById('st-panel-manual').style.display = mode === 'manual' ? '' : 'none';

  // abort 上一个面板的事件
  if (_panelEventsCtrl) _panelEventsCtrl.abort();
  _panelEventsCtrl = new AbortController();

  if (mode === 'ai') {
    // 同步 state 到静态 DOM
    const countEl = document.getElementById('ai-count');
    if (countEl) countEl.value = window._study.state.bank.ai.count;
    document.querySelectorAll('.st-type-pref').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.pref === window._study.state.bank.ai.typePreference);
    });
    // 渲染动态区域
    _renderAIRangeWrap();
    _renderAIActionWrap();
    // 绑定所有 AI 面板事件
    _bindAIEvents(_panelEventsCtrl.signal);
  }

  if (mode === 'import') {
    _refreshImportPanel();
    _bindImportEvents(_panelEventsCtrl.signal);
  }

  if (mode === 'manual') {
    _fillEditForm('mn', window._study.state.bank.manual);
    document.getElementById('btn-manual-save')?.addEventListener('click', studySaveBankEdit, {
      signal: _panelEventsCtrl.signal,
    });
  }
}

// =============================================================
// AI 生成面板
// =============================================================

// ── 动态区域：章节/字数范围 ──
function _renderAIRangeWrap() {
  const { ai } = window._study.state.bank;
  const wrap = document.getElementById('st-ai-range-wrap');
  if (!wrap) return;

  if (!ai.bookId) {
    wrap.innerHTML = '';
    return;
  }

  if (ai.loading) {
    wrap.innerHTML = `<div class="st-add-section">
      <div class="st-center-msg" style="padding:24px 0">章节识别中…</div>
    </div>`;
    return;
  }

  if (ai.toc.length && !ai.useCharRange) {
    wrap.innerHTML = `
      <div class="st-add-section">
        <label class="st-edit-label">选择章节范围 <span class="st-edit-opt-tag">可多选</span></label>
        <div class="st-chapter-list" id="st-chapter-list">
          <button class="st-chapter-all-btn" id="btn-chapter-all">全选 / 取消</button>
          ${ai.toc.map((item, i) => `
            <label class="st-chapter-row">
              <input type="checkbox" class="st-chapter-cb" data-idx="${i}"
                ${ai.selectedChapters.includes(item.title) ? 'checked' : ''}>
              <span>${_stH(item.title)}</span>
            </label>`).join('')}
        </div>
      </div>`;
  } else {
    wrap.innerHTML = `
      <div class="st-add-section">
        <label class="st-edit-label">截取范围（字符）</label>
        <div class="st-range-row">
          <label>起始</label>
          <input id="char-start" class="st-input" type="number" min="0" value="${ai.charStart}" style="width:100px">
          <label>结束</label>
          <input id="char-end" class="st-input" type="number" min="0" value="${ai.charEnd}" style="width:100px">
        </div>
      </div>`;
  }
}

// ── 动态区域：pending 预览 / 生成按钮 ──
function _renderAIActionWrap() {
  const { ai } = window._study.state.bank;
  const wrap = document.getElementById('st-ai-action-wrap');
  if (!wrap) return;

  if (ai.pending) {
    wrap.innerHTML = _buildPendingPreview(ai.pending, 'ai');
  } else {
    wrap.innerHTML = `
      <button class="btn btn-primary" id="btn-ai-generate"
        ${ai.loading ? 'disabled' : ''} style="margin-top:32px">
        ${ai.loading ? '生成中…' : '开始生成'}
      </button>`;
  }
}

// ── 绑定 AI 面板所有事件（静态 + 动态区域）──
// 所有事件都挂上 signal，_switchAddPanel 切走时统一 abort。
// 动态区域（范围、action）每次 innerHTML 后重新调用本函数中对应的片段。
function _bindAIEvents(signal) {
  const { bank } = window._study.state;
  const { ai }   = bank;

  // ── 静态区域：书籍 select ──
  const bookSel = document.getElementById('ai-book-select');
  if (bookSel) {
    bookSel.addEventListener('change', async () => {
      const bookId = bookSel.value;
      ai.bookId           = bookId || null;
      ai.toc              = [];
      ai.selectedChapters = [];
      ai.useCharRange     = false;

      if (!bookId) { _renderAIRangeWrap(); return; }

      ai.loading = true;
      _renderAIRangeWrap();

      try {
        const content = await getStudyBookContentFromDB(bookId);
        const rawToc  = _scanRawToc(content);

        if (rawToc.length) {
          const lines = (content || '').split('\n');
          ai.toc = rawToc.map(title => {
            const lineIdx = lines.findIndex(l => l.trim() === title || l.trim().startsWith(title));
            return { title, lineIdx: lineIdx >= 0 ? lineIdx : 0 };
          });
          ai.selectedChapters = ai.toc.map(t => t.title); // 默认全选
        } else {
          ai.useCharRange = true;
          ai.charEnd = (content || '').length;
        }
      } catch (e) {
        ai.useCharRange = true;
      } finally {
        ai.loading = false;
      }
      _renderAIRangeWrap();
      _bindAIRangeEvents(signal);
    }, { signal });
  }

  // ── 静态区域：数量 input ──
  document.getElementById('ai-count')?.addEventListener('change', e => {
    ai.count = Math.min(20, Math.max(1, parseInt(e.target.value) || 5));
  }, { signal });

  // ── 静态区域：类型偏好 tabs ──
  document.querySelectorAll('.st-type-pref').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.st-type-pref').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      ai.typePreference = btn.dataset.pref;
    }, { signal });
  });

  // ── 动态区域：初始绑定 ──
  _bindAIRangeEvents(signal);
  _bindAIActionEvents(signal);
}

// ── 绑定范围区的事件（每次 _renderAIRangeWrap 后调用）──
// 动态区域是全新 DOM，直接 addEventListener 即可（无重复问题），
// 但仍传入 signal 以便切面板时统一清理。
function _bindAIRangeEvents(signal) {
  const { ai } = window._study.state.bank;

  // 章节全选/取消
  document.getElementById('btn-chapter-all')?.addEventListener('click', () => {
    const allTitles = ai.toc.map(t => t.title);
    ai.selectedChapters = ai.selectedChapters.length === allTitles.length ? [] : [...allTitles];
    _renderAIRangeWrap();
    _bindAIRangeEvents(signal);
  }, { signal });

  // 章节单选
  document.querySelectorAll('.st-chapter-cb').forEach(cb => {
    cb.addEventListener('change', () => {
      const title = ai.toc[parseInt(cb.dataset.idx)]?.title;
      if (!title) return;
      if (cb.checked) {
        if (!ai.selectedChapters.includes(title)) ai.selectedChapters.push(title);
      } else {
        ai.selectedChapters = ai.selectedChapters.filter(t => t !== title);
      }
    }, { signal });
  });

  // 字数范围 inputs
  document.getElementById('char-start')?.addEventListener('change', e => {
    ai.charStart = parseInt(e.target.value) || 0;
  }, { signal });
  document.getElementById('char-end')?.addEventListener('change', e => {
    ai.charEnd = parseInt(e.target.value) || 50000;
  }, { signal });
}

// ── 绑定 action 区的事件（每次 _renderAIActionWrap 后调用）──
function _bindAIActionEvents(signal) {
  const { ai } = window._study.state.bank;

  // 生成按钮
  document.getElementById('btn-ai-generate')?.addEventListener('click', async () => {
    if (!ai.bookId) { AppUI.alert('请先选择一本书', '提示'); return; }
    if (!ai.useCharRange && ai.selectedChapters.length === 0) {
      AppUI.alert('请至少选择一个章节', '提示'); return;
    }

    ai.loading = true;
    _renderAIActionWrap();

    try {
      const content = await getStudyBookContentFromDB(ai.bookId);
      let slice = '';

      if (ai.useCharRange) {
        slice = (content || '').slice(ai.charStart, ai.charEnd);
      } else {
        const lines       = (content || '').split('\n');
        const selectedSet = new Set(ai.selectedChapters);
        const tocLines    = ai.toc
          .filter(t => selectedSet.has(t.title))
          .map(t => t.lineIdx)
          .sort((a, b) => a - b);

        if (tocLines.length) {
          const allTocLineIdxs = ai.toc.map(t => t.lineIdx).sort((a, b) => a - b);
          const segments = [];
          tocLines.forEach(startLine => {
            const nextHeading = allTocLineIdxs.find(l => l > startLine && !tocLines.includes(l));
            const endLine     = nextHeading !== undefined ? nextHeading : lines.length;
            segments.push(lines.slice(startLine, endLine).join('\n'));
          });
          slice = segments.join('\n\n');
        } else {
          slice = content || '';
        }
      }

      if (!slice.trim()) { AppUI.alert('所选范围内容为空，请重新选择', '提示'); return; }

      const questions = await generateStudyQuestions(slice, ai.count, ai.typePreference);
      ai.pending = questions;
    } catch (e) {
      AppUI.alert('生成失败：' + e.message, '错误');
    } finally {
      ai.loading = false;
    }
    _renderAIActionWrap();
    _bindAIActionEvents(signal);
  }, { signal });

  // 确认导入（AI）
  document.getElementById('btn-confirm-ai')?.addEventListener('click', async () => {
    await _confirmImportQuestions(ai.pending);
    ai.pending = null;
  }, { signal });

  // 重新生成
  document.getElementById('btn-rerun-ai')?.addEventListener('click', () => {
    ai.pending = null;
    _renderAIActionWrap();
    _bindAIActionEvents(signal);
  }, { signal });
}

// =============================================================
// 导入面板
// =============================================================

// ── 刷新导入面板的动态部分（文件名 + pending 区）──
function _refreshImportPanel() {
  const { imp } = window._study.state.bank;

  // 文件名显示
  const filenameEl = document.getElementById('st-import-filename');
  if (filenameEl) {
    filenameEl.textContent = imp.fileName ? `📄 ${imp.fileName}` : '选择 CSV 文件';
  }

  // pending 预览区
  const wrap = document.getElementById('st-import-action-wrap');
  if (wrap) {
    wrap.innerHTML = imp.pending ? _buildPendingPreview(imp.pending, 'import') : '';
  }
}

function _bindImportEvents(signal) {
  const { imp } = window._study.state.bank;

  // 下载模板
  document.getElementById('btn-download-template')?.addEventListener('click', () => {
    const csv = `类型,题目,选项A,选项B,选项C,选项D,答案,解析\nchoice,下列哪个是光合作用的产物？,水,氧气,二氧化碳,葡萄糖,D,光合作用产生葡萄糖和氧气\nqa,简述牛顿第一定律的内容。,,,,,\"一个物体如果不受外力作用，将保持静止或匀速直线运动状态。\",`;
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = '题库模板.csv'; a.click();
    URL.revokeObjectURL(url);
  }, { signal });

  // 选文件
  document.getElementById('btn-pick-file')?.addEventListener('click', () => {
    document.getElementById('import-file-input')?.click();
  }, { signal });

  document.getElementById('import-file-input')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    imp.fileName = file.name;

    try {
      const text   = await file.text();
      imp.pending  = _parseCSV(text);
    } catch (err) {
      AppUI.alert('文件解析失败：' + err.message, '错误');
    }
    _refreshImportPanel();
    _bindImportActionEvents(signal);
  }, { signal });

  // 初始绑定 pending 区按钮（若已有 pending）
  _bindImportActionEvents(signal);
}

// ── 绑定 import pending 区按钮（每次 _refreshImportPanel 后调用）──
function _bindImportActionEvents(signal) {
  const { imp } = window._study.state.bank;

  document.getElementById('btn-confirm-import')?.addEventListener('click', async () => {
    await _confirmImportQuestions(imp.pending);
    imp.pending  = null;
    imp.fileName = '';
  }, { signal });

  document.getElementById('btn-rerun-import')?.addEventListener('click', () => {
    imp.pending  = null;
    imp.fileName = '';
    _refreshImportPanel();
  }, { signal });
}

// =============================================================
// CSV 解析
// =============================================================

function _parseCSV(text) {
  const clean = text.replace(/^\uFEFF/, '');
  const lines = clean.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) throw new Error('文件为空');

  const questions = [];
  const startIdx  = _isHeaderRow(lines[0]) ? 1 : 0;

  for (let i = startIdx; i < lines.length; i++) {
    const cols = _splitCSVLine(lines[i]);
    if (cols.length < 2) continue;

    const [typeRaw, question, optA, optB, optC, optD, answer, analysis] = cols.map(c => c.trim());
    const type = typeRaw.toLowerCase().includes('choice') ? 'choice' : 'qa';
    if (!question) continue;

    if (type === 'choice') {
      const options = [optA, optB, optC, optD].filter(Boolean);
      if (options.length < 2 || !answer) continue;
      questions.push({ type, question, options: [optA||'', optB||'', optC||'', optD||''], answer: answer.toUpperCase(), analysis: analysis || '' });
    } else {
      if (!answer) continue;
      questions.push({ type, question, options: null, answer, analysis: analysis || '' });
    }
  }

  if (!questions.length) throw new Error('未识别到有效题目，请检查格式');
  return questions;
}

function _isHeaderRow(line) {
  const lower = line.toLowerCase();
  return lower.includes('类型') || lower.includes('题目') || lower.includes('type') || lower.includes('question');
}

function _splitCSVLine(line) {
  const result = [];
  let cur = '', inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i+1] === '"') { cur += '"'; i++; }
      else inQuote = !inQuote;
    } else if (ch === ',' && !inQuote) {
      result.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}

// =============================================================
// 预览卡（AI + import 共用）
// =============================================================

function _buildPendingPreview(questions, mode) {
  const confirmId = mode === 'ai' ? 'btn-confirm-ai'   : 'btn-confirm-import';
  const rerunId   = mode === 'ai' ? 'btn-rerun-ai'     : 'btn-rerun-import';
  const rerunText = mode === 'ai' ? '重新生成'         : '重新选择';

  const preview = questions.slice(0, 3).map(q => `
    <div class="st-pending-item">
      <span class="st-badge ${q.type==='choice'?'st-badge-choice':'st-badge-qa'}">${q.type==='choice'?'客观':'主观'}</span>
      <span class="st-pending-q">${_stH((q.question||'').slice(0, 40))}${(q.question||'').length>40?'…':''}</span>
    </div>`).join('');

  return `
    <div class="st-pending-card st-fade">
      <div class="st-pending-header">
        <span class="st-pending-count">识别到 <strong>${questions.length}</strong> 道题目</span>
        ${questions.length > 3 ? `<span class="st-pending-more">（预览前3条）</span>` : ''}
      </div>
      <div class="st-pending-preview">${preview}</div>
      <div class="btn-group" style="margin-top:16px">
        <button class="btn btn-neutral" id="${rerunId}">${rerunText}</button>
        <button class="btn btn-primary" id="${confirmId}">确认导入</button>
      </div>
    </div>`;
}

// =============================================================
// 确认写库
// =============================================================

async function _confirmImportQuestions(questions) {
  const { bank } = window._study.state;
  const now      = Date.now();
  const withIds  = questions.map((q, i) => ({
    ...q,
    id:        _genQId(),
    bankId:    bank.currentBankId,
    createdAt: now + i,
  }));

  await bulkSaveBankQuestions(withIds);
  AppUI.alert(`已成功导入 ${withIds.length} 道题目！`, '导入成功');

  if (typeof navigateTo === 'function') navigateTo('study-bank-screen');
}

// =============================================================
// 题库面板（study-test-screen 内的题库方块）
// =============================================================

function studyRenderBankPanel() {
  _studyBankInit();
  const { h, icons } = window._study;
  const rowEl = document.getElementById('st-bank-row');
  if (!rowEl) return;

  const banks = getAllStudyBanks();

  let html = `
    <div class="st-bank-tile st-bank-add" id="st-bank-add-btn" title="新建题库">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
    </div>`;

  const BANK_COLORS = ['st-bank-color-1','st-bank-color-2','st-bank-color-3','st-bank-color-4'];

  banks.forEach((bank, idx) => {
    const qc       = getQuestionsByBank(bank.id).length;
    const colorCls = BANK_COLORS[idx % BANK_COLORS.length];
    html += `
      <div class="st-bank-tile st-bank-book ${colorCls}" data-bank-id="${h(bank.id)}" title="${h(bank.name)}">
        <div class="st-bank-tile-header">
          <div class="st-bank-tile-icon">${icons.file()}</div>
          <div class="st-bank-tile-count">${qc}题</div>
        </div>
        <div class="st-bank-tile-name">${h(bank.name)}</div>
      </div>`;
  });

  rowEl.innerHTML = html;

  // 加号 → 新建题库
  document.getElementById('st-bank-add-btn')?.addEventListener('click', async () => {
    const name = await AppUI.prompt('请输入题库名称', '例如：数学、历史…', '新建题库');
    if (!name || !name.trim()) return;
    const bank = await saveStudyBank(name.trim());
    studyRenderBankPanel();
    studyOpenBank(bank.id);
  });

  // 题库方块 → 进入题库详情
  rowEl.querySelectorAll('.st-bank-book').forEach(tile => {
    tile.addEventListener('click', () => studyOpenBank(tile.dataset.bankId));
  });
}

async function _studyDeleteBankPrompt() {
  const bank    = window._study.state.bank;
  const bankObj = getAllStudyBanks().find(b => b.id === bank.currentBankId);
  const name    = bankObj?.name || '该题库';

  const confirmed = await AppUI.confirm(`确认删除题库「${name}」？\n题库内所有题目将一并删除，此操作不可撤销。`);
  if (!confirmed) return;

  await deleteStudyBank(bank.currentBankId);
  bank.currentBankId = null;
  navigateTo('study-test-screen');
}
