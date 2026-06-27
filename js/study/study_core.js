// study_core.js — 学习模块：共享状态 / 工具 / 初始化 / 模块出口
// 必须最先加载，其余 study_*.js 依赖 window._study
// =====================================================

window._study = {
  state: {
    home:      { selectedCategory: 'All' },
    bookshelf: { selectedCategory: 'all' },  // 改为 tab 模式，'all' 表示全部
    test:      { questions: [], idx: 0, selectedAnswer: null, userAnswer: '', feedback: null, isGrading: false, showAnswer: false },
    reader:    { bookId: null, content: '', pages: [], page: 0, pageSize: 400 },
    isInitialized: false,
  },
};

// ── 工具函数（全局共享）─────────────────────────────
window._study.h = function h(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
};

// ── SVG 图标（全局共享）─────────────────────────────
window._study.icons = {
  book()         { return `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`; },
  file()         { return `<svg width="36px" height="36px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M7.2 21C6.07989 21 5.51984 21 5.09202 20.782C4.71569 20.5903 4.40973 20.2843 4.21799 19.908C4 19.4802 4 18.9201 4 17.8V6.2C4 5.07989 4 4.51984 4.21799 4.09202C4.40973 3.71569 4.71569 3.40973 5.09202 3.21799C5.51984 3 6.0799 3 7.2 3H16.8C17.9201 3 18.4802 3 18.908 3.21799C19.2843 3.40973 19.5903 3.71569 19.782 4.09202C20 4.51984 20 5.0799 20 6.2V7M8 7H14M8 15H9M8 11H12M11.1954 20.8945L12.5102 20.6347C13.2197 20.4945 13.5744 20.4244 13.9052 20.2952C14.1988 20.1806 14.4778 20.0317 14.7365 19.8516C15.0279 19.6486 15.2836 19.393 15.7949 18.8816L20.9434 13.7332C21.6306 13.0459 21.6306 11.9316 20.9434 11.2444C20.2561 10.5571 19.1418 10.5571 18.4546 11.2444L13.2182 16.4808C12.739 16.96 12.4994 17.1996 12.3059 17.4712C12.1341 17.7123 11.9896 17.9717 11.8751 18.2447C11.7461 18.5522 11.6686 18.882 11.5135 19.5417L11.1954 20.8945Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`; },
  folder()       { return `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`; },
  trash()        { return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`; },
  chevronRight() { return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="color:#8e8e93;"><polyline points="9 18 15 12 9 6"/></svg>`; },
  close()        { return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`; },
};

// ══════════════════════════════════════════════════════════════════
//  世界书多选弹窗 — 通用逻辑
//  建议放在 study_core.js 或单独一个 study_wb_modal.js
//  供 study_coread.js / study_test.js 调用
// ══════════════════════════════════════════════════════════════════

/**
 * 初始化世界书弹窗的固定事件（只挂一次）
 * 在 study 模块初始化时调用一次即可
 */
function initWbSelectModal() {
  const modal   = document.getElementById('wb-select-modal');
  const listEl  = document.getElementById('wb-select-list');
  const confirm = document.getElementById('wb-select-confirm');
  if (!modal || modal._bound) return;
  modal._bound = true;

  const close = () => modal.classList.remove('visible');

  modal.addEventListener('click', e => { if (e.target === modal) close(); });

  confirm.addEventListener('click', () => {
    const selectedIds = [...listEl.querySelectorAll('input[type=checkbox]:checked')]
      .map(cb => cb.value);
    modal._onConfirm?.(selectedIds);
    modal._onConfirm = null;
    close();
  });
}

/**
 * 填充列表并打开弹窗（内部工具，不直接调用）
 * @param {string[]} pendingIds  当前已选的世界书 id
 * @param {string}   idPrefix    checkbox id 前缀，确保页面内唯一（如 'coread-wb'）
 * @param {(ids: string[]) => void} onConfirm  确认回调
 */
function _openWbSelectModal(pendingIds, idPrefix, onConfirm) {
  const allWbs = db.worldBooks || [];
  if (!allWbs.length) {
    showToast?.('暂无世界书，请先在世界书页面添加条目');
    return;
  }

  const modal  = document.getElementById('wb-select-modal');
  const listEl = document.getElementById('wb-select-list');
  if (!modal || !listEl) return;

  // 优先用已有的分类渲染函数，否则 fallback
  if (typeof renderCategorizedWorldBookList === 'function') {
    renderCategorizedWorldBookList(listEl, allWbs, pendingIds, idPrefix);
  } else {
    listEl.innerHTML = allWbs.map(w => `
      <li class="list-item wb-select-item">
        <input type="checkbox" id="${idPrefix}-${w.id}" value="${w.id}"
               ${pendingIds.includes(w.id) ? 'checked' : ''}>
        <label for="${idPrefix}-${w.id}">${w.name || '未命名'}</label>
      </li>`).join('');
  }

  modal._onConfirm = onConfirm;
  modal.classList.add('visible');
}

// ── 初始化（事件绑定，只执行一次）──────────────────
function _studyInit() {
  const s = window._study.state;
  if (s.isInitialized) return;

  // 首页快捷按钮
  document.getElementById('go-focus')?.addEventListener('click', () => {
    if (typeof navigateTo === 'function') navigateTo('pomodoro-screen');
  });
  document.getElementById('go-bookshelf')?.addEventListener('click', () => {
    if (typeof navigateTo === 'function') navigateTo('study-bookshelf-screen');
  });
document.getElementById('go-test')?.addEventListener('click', () => {
    if (typeof navigateTo === 'function') navigateTo('study-test-screen');
});

  // 书架内部
  document.getElementById('study-import-btn')?.addEventListener('click', studyOpenImportModal);
  // btn-back-cats 已删除（书架改为 tab 直接展示模式）

  // 阅读器翻页（由 studyRenderReader 动态设置 onclick 即可）

  // 侧边栏
  studyInitSidebar();
  // 导入弹窗
  studyInitImportModal();
  
  // 共读功能初始化
  studyInitCoread();
  studyInitTest();
  initStudyTestModals();
  initWbSelectModal();

  // 注册页面进入钩子：书架页每次进入时自动刷新数据
  window._screenEnterHooks = window._screenEnterHooks || {};
  window._screenEnterHooks['study-bookshelf-screen'] = () => {
    studyRenderBookshelf();
  };
  window._screenEnterHooks['study-test-screen'] = () => {
  studyRenderBankPanel();
  studyRenderTest();
};

  s.isInitialized = true;
}

// ── 模块出口（供主应用调用）─────────────────────────
window.StudyModule = {
  renderMain() {
    _studyInit();
    studyRenderHome();
  },
};
