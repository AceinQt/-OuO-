// study_home.js — 学习模块：首页渲染
// 依赖：study_core.js / study_db.js
// =====================================================

// 首页任务列表当前 tab 状态（存到 state.home）
// state.home.taskTab: 'all' | 'focus' | 'test'

function studyRenderHome() {
  const { state, h } = window._study;
  const persona = getStudyBoundPersona();

  // 初始化 tab 状态
  if (!state.home.taskTab) state.home.taskTab = 'all';

  // 顶部问候名字
  const nameEl = document.getElementById('st-home-name');
  if (nameEl) nameEl.textContent = persona?.nickname || persona?.name || 'User';

  // 渲染任务列表区域
  _renderTaskSection();
}

// ── 任务列表区域 ──────────────────────────────────

function _renderTaskSection() {
  const { state, h } = window._study;

  // 渲染 tab 栏
  const tabsEl = document.querySelector('.st-category-tabs');
  if (tabsEl) {
    const tabs = [
      { key: 'all',   label: '全部' },
      { key: 'focus', label: '专注' },
      { key: 'test',  label: '测试' },
    ];
    tabsEl.innerHTML = tabs.map(t =>
      `<button class="st-cat-tab ${state.home.taskTab === t.key ? 'active' : ''}" data-tab="${t.key}">${t.label}</button>`
    ).join('');
    tabsEl.querySelectorAll('.st-cat-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        state.home.taskTab = btn.dataset.tab;
        _renderTaskSection();
      });
    });
  }

  // 获取各类任务
  const focusTasks = _getFocusTasks();
  const testTasks  = _getTestTasks();

  const tab = state.home.taskTab;
  const showFocus = tab === 'all' || tab === 'focus';
  const showTest  = tab === 'all' || tab === 'test';

  const listEl = document.getElementById('st-home-books');
  if (!listEl) return;

  let html = '';

  // 专注任务块
  if (showFocus) {
    if (focusTasks.length === 0) {
      if (tab === 'focus') {
        html += `<div class="st-task-empty">暂无专注任务，去番茄钟新建一个吧~</div>`;
      } else {
        // 全部tab下，专注任务为空则不显示标题
      }
    } else {
      if (tab === 'all') html += `<div class="st-task-group-title">专注任务</div>`;
      html += focusTasks.map((t, i) => _renderFocusCard(t, i)).join('');
    }
  }

  // 测试任务块
  if (showTest) {
    if (testTasks.length === 0) {
      if (tab === 'test') {
        html += `<div class="st-task-empty">暂无测试任务，先去书架导入书籍和题目吧~</div>`;
      }
    } else {
      if (tab === 'all') html += `<div class="st-task-group-title">测试任务</div>`;
      html += testTasks.map((t, i) => _renderTestCard(t, i)).join('');
    }
  }

  // 全部为空
  if (!html) {
    html = `<div class="st-task-empty">还没有任何任务，快去创建或导入吧~</div>`;
  }

  listEl.innerHTML = html;

  // 绑定专注卡片点击
  listEl.querySelectorAll('.st-task-card[data-type="focus"]').forEach(card => {
    card.addEventListener('click', () => {
      if (typeof navigateTo === 'function') navigateTo('pomodoro-screen');
    });
  });

  // 绑定测试卡片点击
  listEl.querySelectorAll('.st-task-card[data-type="test"]').forEach(card => {
    card.addEventListener('click', () => {
      const bookId = card.dataset.bookId;
      const s = window._study.state.test;
      Object.assign(s, {
        questions: getQuestionsByBook(bookId).sort(() => Math.random() - 0.5),
        idx: 0, selectedAnswer: null, userAnswer: '',
        feedback: null, isGrading: false, showAnswer: false,
      });
      if (typeof navigateTo === 'function') navigateTo('study-test-screen');
      studyRenderTest();
    });
  });
}

// ── 数据获取 ─────────────────────────────────────

function _getFocusTasks() {
  return db.pomodoroTasks || [];
}

function _getTestTasks() {
  const books = getAllStudyBooks();
  // 只显示有题目的书本
  return books.filter(b => getQuestionsByBook(b.id).length > 0);
}

// ── 卡片模板 ─────────────────────────────────────

function _renderFocusCard(task, index) {
  const { h } = window._study;
  const modeText  = task.mode === 'countdown' ? `倒计时 ${task.duration} 分钟` : '正计时模式';
  const themeClass = 'st-task-theme-' + ((index % 3) + 1);

  // 自定义背景图
  const bgStyle = task.settings?.taskCardBackground
    ? `style="background-image:url(${task.settings.taskCardBackground});background-size:cover;background-position:center;"`
    : '';

  return `
    <div class="st-task-card ${themeClass}" data-type="focus" ${bgStyle}>
      <div class="st-task-badge st-badge-focus">专注</div>
      <div class="st-task-name">${h(task.name || '未命名任务')}</div>
      <div class="st-task-meta">${h(modeText)}</div>
      <div class="st-task-arrow">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
    </div>`;
}

function _renderTestCard(book, index) {
  const { h } = window._study;
  const qc = getQuestionsByBook(book.id).length;
  const themeClass = 'st-task-theme-' + (((index + 1) % 3) + 1);

  return `
    <div class="st-task-card ${themeClass}" data-type="test" data-book-id="${h(book.id)}">
      <div class="st-task-badge st-badge-test">测试</div>
      <div class="st-task-name">${h(book.title)}</div>
      <div class="st-task-meta">${qc} 道题</div>
      <div class="st-task-arrow">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
    </div>`;
}
