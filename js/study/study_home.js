// study_home.js — 学习模块：首页渲染
// 依赖：study_core.js / study_db.js
// =====================================================

// 首页任务列表当前 tab 状态（存到 state.home）
// state.home.taskTab: 'all' | 'focus' | 'test'

function studyRenderHome() {
  const { state } = window._study;
  if (!state.home.taskTab) state.home.taskTab = 'all';

  const settings = getStudySettings();

  // 主页昵称
  const nameEl = document.getElementById('st-home-name');
  if (nameEl) nameEl.textContent = settings.homeName || 'User';

  // 主页问候语
  const greetEl = document.querySelector('.st-home-title');
  if (greetEl) greetEl.textContent = settings.homeGreeting || '今天要做什么呢？';

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
  let globalIdx = 0; // 全局卡片序号，用于统一颜色序列

  // 专注任务块
  if (showFocus) {
    if (focusTasks.length === 0) {
      if (tab === 'focus') {
        html += `<div class="st-task-empty">暂无专注任务，去「专注」新建一个吧~</div>`;
      } else {
        // 全部tab下，专注任务为空则不显示
      }
    } else {
      if (tab === 'all') {
        // 全部tab不显示分组标题
      } else if (tab === 'focus') {
        // 单独tab也不需要
      }
      html += focusTasks.map(t => _renderFocusCard(t, globalIdx++)).join('');
    }
  }

  // 测试任务块
  if (showTest) {
    if (testTasks.length === 0) {
      if (tab === 'test') {
        html += `<div class="st-task-empty">暂无测试任务，去「测试」新建一个吧~</div>`;
      }
    } else {
      html += testTasks.map(t => _renderTestCard(t, globalIdx++)).join('');
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

// 绑定测试卡片点击（_renderTaskSection 里）
  listEl.querySelectorAll('.st-task-card[data-type="test"]').forEach(card => {
  card.addEventListener('click', () => _openExam(card.dataset.examId));
});
}

// ── 数据获取 ─────────────────────────────────────

function _getFocusTasks() {
  return db.pomodoroTasks || [];
}

function _getTestTasks() {
  return getAllStudyExams();
}

// ── 卡片颜色序列 (1,2,3,2,1,2,3,2,...) ───────────────
function _taskThemeClass(index) {
  // 周期4：0→1, 1→2, 2→3, 3→2
  const seq = [1, 2, 3, 2];
  return 'st-task-theme-' + seq[index % 4];
}

// ── 卡片模板 ─────────────────────────────────────

function _renderFocusCard(task, index) {
  const { h } = window._study;
  const modeText  = task.mode === 'countdown' ? `倒计时 ${task.duration} 分钟` : '正计时模式';
  const themeClass = _taskThemeClass(index);

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

function _renderTestCard(exam, index) {
  const { h } = window._study;
  const themeClass = _taskThemeClass(index);

  return `
    <div class="st-task-card ${themeClass}" data-type="test" data-exam-id="${h(exam.id)}">
      <div class="st-task-badge st-badge-test">测试</div>
      <div class="st-task-name">${h(exam.title || '未命名考卷')}</div>
      <div class="st-task-meta">${exam.drawCount || 0} 道题</div>
      <div class="st-task-arrow">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
    </div>`;
}

