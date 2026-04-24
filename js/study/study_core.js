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
  file()         { return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`; },
  folder()       { return `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`; },
  trash()        { return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`; },
  chevronRight() { return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="color:#8e8e93;"><polyline points="9 18 15 12 9 6"/></svg>`; },
  close()        { return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`; },
};

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
    studyRenderBookshelf();
  });
  document.getElementById('go-test')?.addEventListener('click', () => {
    Object.assign(s.test, { questions: [], idx: 0, selectedAnswer: null, userAnswer: '', feedback: null, isGrading: false, showAnswer: false });
    if (typeof navigateTo === 'function') navigateTo('study-test-screen');
    studyRenderBankPanel();
    studyRenderTest();
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

  s.isInitialized = true;
}

// ── 模块出口（供主应用调用）─────────────────────────
window.StudyModule = {
  renderMain() {
    _studyInit();
    studyRenderHome();
  },
};
