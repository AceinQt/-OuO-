// study_test.js — 学习模块：测试模式
// 依赖：study_core.js / study_db.js / study_ai.js
// =====================================================

// ── 题库面板（测试页上半部分）─────────────────────

function studyRenderBankPanel() {
  const { h, icons } = window._study;
  const rowEl = document.getElementById('st-bank-row');
  if (!rowEl) return;

  const books = getAllStudyBooks();

  // 虚线加号块永远第一个
  let html = `
    <div class="st-bank-tile st-bank-add" id="st-bank-add-btn" title="新增题库">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
    </div>`;

  // 已有题库的书本（有题目的才显示）
  books.forEach(book => {
    const qc = getQuestionsByBook(book.id).length;
    if (qc === 0) return;
    html += `
      <div class="st-bank-tile st-bank-book" data-book-id="${h(book.id)}" title="${h(book.title)}">
        <div class="st-bank-tile-icon">${icons.file()}</div>
        <div class="st-bank-tile-name">${h(book.title)}</div>
        <div class="st-bank-tile-count">${qc}题</div>
      </div>`;
  });

  rowEl.innerHTML = html;

  // 加号按钮 → 弹出选书对话框
  document.getElementById('st-bank-add-btn')?.addEventListener('click', _studyAddBank);

  // 书本方块 → 加载该书题目到下方测试区
  rowEl.querySelectorAll('.st-bank-book').forEach(tile => {
    tile.addEventListener('click', () => {
      const bookId = tile.dataset.bookId;
      const qs = getQuestionsByBook(bookId).sort(() => Math.random() - 0.5);
      if (!qs.length) {
        if (typeof AppUI !== 'undefined') AppUI.alert('该题库暂无题目', '提示');
        return;
      }
      const s = window._study.state.test;
      Object.assign(s, { questions: qs, idx: 0, selectedAnswer: null, userAnswer: '', feedback: null, isGrading: false, showAnswer: false });
      studyRenderTest();
    });
  });
}

async function _studyAddBank() {
  const books = getAllStudyBooks();
  if (!books.length) {
    if (typeof AppUI !== 'undefined') AppUI.alert('请先到书架导入书籍', '提示');
    return;
  }

  // 用 AppUI.select 选择书籍
  const bookId = await AppUI.select(
    books.map(b => ({ value: b.id, label: b.title })),
    { title: '选择要生成题库的书籍' }
  );
  if (!bookId) return;

  const book = books.find(b => b.id === bookId);
  if (!book) return;

  const countStr = await AppUI.prompt('请输入要生成的题目数量', '例如：5', '生成题库');
  if (!countStr || isNaN(parseInt(countStr))) return;
  const count = Math.max(1, parseInt(countStr));

  // 找到对应方块显示 loading（如果已存在）
  const existingTile = document.querySelector(`.st-bank-book[data-book-id="${book.id}"]`);
  const addBtn = document.getElementById('st-bank-add-btn');
  if (addBtn) { addBtn.style.pointerEvents = 'none'; addBtn.style.opacity = '0.5'; }

  try {
    const raw = await generateStudyQuestions(book.content, count);
    const withIds = raw.map(q => ({
      ...q,
      bookId: book.id,
      id: `q_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      createdAt: Date.now(),
    }));
    await bulkSaveStudyQuestions(withIds);

    if (typeof AppUI !== 'undefined') AppUI.alert(`成功生成 ${withIds.length} 道题目！`, '生成成功');
    studyRenderBankPanel();
    studyRenderHome?.();
  } catch (e) {
    if (typeof AppUI !== 'undefined') AppUI.alert('生成失败：' + e.message, '错误');
  } finally {
    if (addBtn) { addBtn.style.pointerEvents = ''; addBtn.style.opacity = ''; }
  }
}

// ── 测试任务面板（测试页下半部分）────────────────

function studyRenderTest() {
  const { state, h } = window._study;
  const s = state.test;
  const bodyEl     = document.getElementById('study-test-body');
  const subTitleEl = document.getElementById('study-test-subtitle');
  if (!bodyEl) return;

  // 首次进入且无当前题目：加载全题库
  if (s.questions.length === 0) {
    const allQ = getAllStudyQuestions();
    if (allQ.length === 0) {
      if (subTitleEl) subTitleEl.textContent = '';
      bodyEl.innerHTML = `
        <div class="st-center-msg">
          题库为空，请点击上方「+」新增题库。
        </div>`;
      return;
    }
    s.questions = allQ.sort(() => Math.random() - 0.5);
  }

  // 全部答完
  if (s.idx >= s.questions.length) {
    if (subTitleEl) subTitleEl.textContent = '';
    bodyEl.innerHTML = `
      <div class="st-complete st-fade">
        <div class="st-complete-emoji">🎉</div>
        <h2>测试完成！</h2>
        <p>你已经完成了所有题目。</p>
        <button class="st-btn-primary st-btn-max-240" id="btn-done-test">返回学习首页</button>
      </div>`;
    document.getElementById('btn-done-test')?.addEventListener('click', () => {
      if (typeof navigateTo === 'function') navigateTo('study-screen');
    });
    return;
  }

  const q = s.questions[s.idx];
  const isChoice = q.type === 'choice';
  if (subTitleEl) subTitleEl.textContent = `${s.idx + 1} / ${s.questions.length}`;

  bodyEl.innerHTML = `
    <div class="st-card st-q-card st-fade">
      <span class="st-q-badge">${isChoice ? '选择题' : '问答题'}</span>
      <h2 class="st-q-text">${h(q.question)}</h2>
      ${isChoice && q.options
        ? `<div class="st-options">
            ${q.options.map((opt, i) => {
              const letter = String.fromCharCode(65 + i);
              let cls = 'st-option';
              if (s.feedback) {
                if (letter === q.answer)             cls += ' correct';
                else if (letter === s.selectedAnswer) cls += ' wrong';
                else                                  cls += ' dimmed';
              }
              return `<button class="${cls}" data-letter="${letter}" ${s.feedback || s.isGrading ? 'disabled' : ''}>${h(opt)}</button>`;
            }).join('')}
           </div>`
        : `<div class="st-qa-area">
            <textarea id="test-ans" class="st-input st-textarea" placeholder="请默写你的答案…" ${s.feedback || s.isGrading ? 'disabled' : ''}>${h(s.userAnswer)}</textarea>
            ${!s.feedback
              ? `<div class="st-btn-row">
                  <button class="st-btn-secondary" id="btn-show-ans-test">直接看答案</button>
                  <button class="st-btn-primary" id="btn-submit-test" ${s.isGrading ? 'disabled' : ''}>
                    ${s.isGrading ? '正在批改…' : '提交答案'}
                  </button>
                 </div>`
              : ''}
           </div>`}
    </div>

    ${(!isChoice && (s.feedback || s.showAnswer))
      ? `<div class="st-answer-box st-fade st-mt-16">
           <h3>标准答案：</h3>
           <p>${h(q.answer)}</p>
         </div>`
      : ''}

    ${s.feedback
      ? `<div class="st-feedback ${s.feedback.correct ? 'correct' : 'wrong'} st-fade st-mt-16">
           <h3>${s.feedback.correct ? '回答正确！' : '回答错误'}</h3>
           <p>${h(s.feedback.comment)}</p>
           <button class="st-btn-primary st-btn-full st-mt-16" id="btn-next-test">下一题</button>
         </div>`
      : s.showAnswer
        ? `<button class="st-btn-primary st-btn-full st-mt-16" id="btn-next-test">下一题</button>`
        : ''}
  `;

  // 选择题点击
  if (isChoice) {
    bodyEl.querySelectorAll('.st-option').forEach(btn => {
      btn.addEventListener('click', async () => {
        const letter  = btn.dataset.letter;
        const correct = letter === q.answer;
        s.selectedAnswer = letter;
        s.feedback = {
          correct,
          comment: correct
            ? '太棒了！答对了！继续保持哦~'
            : `哎呀，选错了。正确答案是 ${q.answer}，再仔细看看题目吧！`,
        };
        await saveStudyRecord({ questionId: q.id, bookId: q.bookId, userAnswer: letter, correct });
        studyRenderTest();
      });
    });
  } else {
    document.getElementById('test-ans')?.addEventListener('input', e => { s.userAnswer = e.target.value; });

    document.getElementById('btn-show-ans-test')?.addEventListener('click', () => {
      s.showAnswer = true;
      studyRenderTest();
    });

    document.getElementById('btn-submit-test')?.addEventListener('click', async () => {
      const answer = document.getElementById('test-ans').value.trim();
      if (!answer) return;
      s.userAnswer  = answer;
      s.isGrading   = true;
      studyRenderTest();
      try {
        s.feedback = await gradeStudyAnswer(q.answer, answer);
        await saveStudyRecord({ questionId: q.id, bookId: q.bookId, userAnswer: answer, correct: s.feedback.correct });
      } catch {
        if (typeof AppUI !== 'undefined') AppUI.alert('批改失败，请重试');
        else alert('批改失败，请重试');
      }
      s.isGrading = false;
      studyRenderTest();
    });
  }

  document.getElementById('btn-next-test')?.addEventListener('click', () => {
    s.idx++;
    s.feedback = null; s.selectedAnswer = null; s.userAnswer = ''; s.showAnswer = false;
    studyRenderTest();
  });
}
