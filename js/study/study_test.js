// study_test.js — 学习模块：测试模式（考卷任务）
// 依赖：study_core.js / study_db.js / study_ai.js / study_bank.js
// =====================================================



// ── 运行时状态（覆盖 study_core 里的旧结构）─────────────────

window._study.state.test = {
  currentExamId:    null,
  currentRecordId:  null,
  viewingRecordId:  null,   // 结果页正在查看的记录
  examIdx:          0,
  answers:          {},
  isGrading:        false,
  analyzingQIds:    new Set(),  // 正在 AI 分析中的题目 id 集合
};

// ── 简易 Markdown → HTML 渲染 ──────────────────────────────────
function _mdToHtml(raw) {
  if (!raw) return '';

  // 转义 HTML 特殊字符（文本节点专用）
  const esc = s => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // ① 提取代码块，占位，避免内部被处理
  const codeBlocks = [];
  let text = raw.replace(/```([\w]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push({ lang, code });
    return `\x00CB${idx}\x00`;
  });

  // ② 提取行内代码
  const inlineCodes = [];
  text = text.replace(/`([^`\n]+)`/g, (_, code) => {
    const idx = inlineCodes.length;
    inlineCodes.push(code);
    return `\x00IC${idx}\x00`;
  });

  // ③ 行内格式（粗斜体/粗体/斜体/删除线）
  const inline = s => s
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g,     '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,         '<em>$1</em>')
    .replace(/~~(.+?)~~/g,         '<del>$1</del>');

  // ④ 逐行处理
  const lines = text.split('\n');
  let html = '';
  let inUl = false, inOl = false;

  const closeList = () => {
    if (inUl) { html += '</ul>'; inUl = false; }
    if (inOl) { html += '</ol>'; inOl = false; }
  };

  for (const line of lines) {
    // 代码块占位
    if (/^\x00CB\d+\x00$/.test(line.trim())) {
      closeList();
      const idx = parseInt(line.match(/\d+/)[0]);
      const { lang, code } = codeBlocks[idx];
      html += `<pre><code${lang ? ` class="language-${esc(lang)}"` : ''}>${esc(code)}</code></pre>`;
      continue;
    }

    // 标题
    const hm = line.match(/^(#{1,3})\s+(.*)/);
    if (hm) {
      closeList();
      const lvl = hm[1].length + 2; // # → h3, ## → h4, ### → h5（弹窗里不用太大）
      html += `<h${lvl}>${inline(esc(hm[2]))}</h${lvl}>`;
      continue;
    }

    // 无序列表
    const ul = line.match(/^[\-\*\+]\s+(.*)/);
    if (ul) {
      if (inOl) { html += '</ol>'; inOl = false; }
      if (!inUl) { html += '<ul>'; inUl = true; }
      html += `<li>${inline(esc(ul[1]))}</li>`;
      continue;
    }

    // 有序列表
    const ol = line.match(/^\d+\.\s+(.*)/);
    if (ol) {
      if (inUl) { html += '</ul>'; inUl = false; }
      if (!inOl) { html += '<ol>'; inOl = true; }
      html += `<li>${inline(esc(ol[1]))}</li>`;
      continue;
    }

    // 空行 → 段落分隔
    if (!line.trim()) {
      closeList();
      html += '<br>';
      continue;
    }

    // 普通段落
    closeList();
    html += `<p>${inline(esc(line))}</p>`;
  }

  closeList();

  // ⑤ 还原行内代码
  inlineCodes.forEach((code, i) => {
    html = html.replace(`\x00IC${i}\x00`, `<code>${esc(code)}</code>`);
  });

  return html;
}


function initStudyTestModals() {
  // ① 新建考卷
  const createModal = document.getElementById('st-create-exam-modal');
  if (createModal && !createModal._bound) {
    createModal._bound = true;

    document.getElementById('st-create-exam-close')
      ?.addEventListener('click', _closeCreateExamModal);
    createModal.addEventListener('click', e => {
      if (e.target === createModal) _closeCreateExamModal();
    });

    createModal.addEventListener('change', e => {
      if (e.target.classList.contains('st-exam-bank-cb'))
        _updateCreateExamDrawMax();
    });

    document.getElementById('st-create-exam-confirm')
      ?.addEventListener('click', _onCreateExamConfirm);
  }

  // ② AI 分析面板
  const analysisSheet = document.getElementById('st-analysis-sheet');
  if (analysisSheet && !analysisSheet._bound) {
    analysisSheet._bound = true;
    document.getElementById('st-analysis-close')
      ?.addEventListener('click', () => {
        analysisSheet.classList.remove('visible');
        analysisSheet._onClose?.();
        analysisSheet._onClose = null;
      });
    analysisSheet.addEventListener('click', e => {
      if (e.target !== analysisSheet) return;
      analysisSheet.classList.remove('visible');
      analysisSheet._onClose?.();
      analysisSheet._onClose = null;
    });
  }

  // ③ 世界书弹窗
  initWbSelectModal();
  initEiSelectModals();
}

// ── 测试任务列表 ──────────────────────────────────────────────

function studyRenderTest() {
  const { h } = window._study;
  const bodyEl = document.getElementById('study-test-body');
  if (!bodyEl) return;

  const exams = getAllStudyExams().sort((a, b) => b.createdAt - a.createdAt);

  if (!exams.length) {
    bodyEl.innerHTML = `
      <div class="st-center-msg">
        <p style="font-size:13px;color:#aaa;margin-top:6px">
          点击右上角 <strong>＋</strong> 新建第一个测试任务吧
        </p>
      </div>`;
    return;
  }

  const EXAM_COLORS = ['st-exam-theme-1','st-exam-theme-2','st-exam-theme-3'];

bodyEl.innerHTML = exams.map((exam, idx) => {
    const records     = getExamRecordsByExam(exam.id);
    const doneRecs    = records.filter(r => r.status === 'done');
    const bestScore   = doneRecs.length
      ? Math.max(...doneRecs.map(r => r.score ?? 0))
      : null;
    const timesText   = records.length
      ? `考了 ${records.length} 次`
      : '未考过';
    const bankNames   = (exam.bankIds || [])
      .map(id => (db.studyBanks || []).find(b => b.id === id)?.name)
      .filter(Boolean);
    const bankMeta    = bankNames.length
      ? bankNames.join('、')
      : '—';
    const scoreMeta   = bestScore != null ? ` · 最高 ${bestScore} 分` : '';

    const colorCls = EXAM_COLORS[idx % EXAM_COLORS.length];
    return `<div class="st-exam-card ${colorCls}" data-exam-id="${h(exam.id)}">
        <div class="st-exam-card-left">
          <div class="st-exam-card-title">${h(exam.title || '未命名考卷')}</div>
          <div class="st-exam-card-meta">${h(bankMeta)} · ${exam.drawCount || '?'} 题${scoreMeta}</div>
        </div>
        <div class="st-exam-card-right">
          <span class="st-exam-times">${timesText}</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
               stroke="#ccc" stroke-width="2" stroke-linecap="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </div>
      </div>`;
  }).join('');

  bodyEl.querySelectorAll('.st-exam-card').forEach(card => {
    card.addEventListener('click', () => _openExam(card.dataset.examId));

    let pressTimer;
    card.addEventListener('pointerdown', () => {
      pressTimer = setTimeout(async () => {
        const ok = await AppUI.confirm('确定删除这份考卷吗？（历史答题记录一并删除）', '删除考卷');
        if (!ok) return;
        await deleteStudyExam(card.dataset.examId);
        studyRenderTest();
      }, 600);
    });
    card.addEventListener('pointerup',    () => clearTimeout(pressTimer));
    card.addEventListener('pointerleave', () => clearTimeout(pressTimer));
    card.addEventListener('pointermove',  () => clearTimeout(pressTimer));
  });
}

// ── 新建考卷 modal ────────────────────────────────────────────

function _openCreateExamModal() {
  const { h } = window._study;
  const banks  = getAllStudyBanks();
  if (!banks.length) {
    showToast?.('请先创建题库并添加题目');
    return;
  }

  // 填充题库 checklist
  const checklist = document.getElementById('st-exam-bank-checklist');
  checklist.innerHTML = banks.map(bank => {
    const total    = getQuestionsByBank(bank.id).length;
    const disabled = !total;
    return `
      <label class="st-exam-bank-check-row${disabled ? ' disabled' : ''}">
        <input type="checkbox" class="st-exam-bank-cb"
               value="${h(bank.id)}" data-total="${total}" ${disabled ? 'disabled' : ''}>
        <div class="st-exam-bank-check-info">
          <span class="st-exam-bank-name">${h(bank.name)}</span>
          <span class="st-exam-bank-total${!total ? ' empty' : ''}">${total ? `${total} 题` : '暂无题目'}</span>
        </div>
      </label>`;
  }).join('');

  // 重置抽题数
  const maxEl = document.getElementById('st-exam-draw-max');
  const input  = document.getElementById('st-exam-draw-count');
  if (maxEl) maxEl.textContent = '（请先选择题库）';
  if (input) { input.max = 1; input.value = 10; }

  // 重置考卷名称框
  const nameInput = document.getElementById('st-exam-name-input');
  if (nameInput) nameInput.value = '';

  document.getElementById('st-create-exam-modal')?.classList.add('visible');
}

function _closeCreateExamModal() {
  document.getElementById('st-create-exam-modal')?.classList.remove('visible');
}

function _updateCreateExamDrawMax() {
  const modal    = document.getElementById('st-create-exam-modal');
  const checked  = [...modal.querySelectorAll('.st-exam-bank-cb:checked')];
  const maxTotal = checked.reduce((sum, cb) => sum + (parseInt(cb.dataset.total) || 0), 0);
  const maxEl    = document.getElementById('st-exam-draw-max');
  const input    = document.getElementById('st-exam-draw-count');
  if (maxEl) maxEl.textContent = maxTotal ? `最多 ${maxTotal} 题` : '（请先选择题库）';
  if (input) {
    input.max   = maxTotal || 1;
    input.value = Math.min(parseInt(input.value) || 10, maxTotal || 10);
  }
}

async function _onCreateExamConfirm() {
  const { h } = window._study;
  const modal      = document.getElementById('st-create-exam-modal');
  const checkedCbs = [...modal.querySelectorAll('.st-exam-bank-cb:checked')];
  if (!checkedCbs.length) { showToast?.('请至少选择一个题库'); return; }

  const bankIds    = checkedCbs.map(cb => cb.value);
  const drawCount  = Math.max(1, parseInt(document.getElementById('st-exam-draw-count')?.value) || 10);
  const totalAvail = checkedCbs.reduce((s, cb) => s + (parseInt(cb.dataset.total) || 0), 0);

  if (drawCount > totalAvail) {
    showToast?.(`题库共 ${totalAvail} 题，不足以抽取 ${drawCount} 题`);
    return;
  }

  // 优先用用户填写的名称，为空时以题库名兜底（不再硬拼题数）
  const customName = document.getElementById('st-exam-name-input')?.value.trim();
  const bankNames  = bankIds
    .map(id => (db.studyBanks || []).find(b => b.id === id)?.name)
    .filter(Boolean);
  const title = customName || bankNames.join('＋') || '未命名考卷';

  await saveStudyExam({ title, bankIds, drawCount, graderCharId: '', examPersonaId: '', worldbookIds: [] });
  _closeCreateExamModal();
  studyRenderTest();
  showToast?.('考卷已生成！');
}

// ── 进入答题页 ────────────────────────────────────────────────

function _openExam(examId) {
  const s  = window._study.state.test;
  const exam = (db.studyExams || []).find(e => e.id === examId);
  if (!exam) return;

  s.currentExamId   = examId;
  s.currentRecordId = null;
  s.examIdx         = 0;
  s.answers         = {};
  s.isGrading       = false;

  if (typeof navigateTo === 'function') navigateTo('study-exam-info-screen');
}

// ── 答题页主渲染 ──────────────────────────────────────────────

// ── 答题页主渲染 ──────────────────────────────────────────────
function studyRenderExam() {
  const s   = window._study.state.test;
  const rec = (db.studyExamRecords || []).find(r => r.id === s.currentRecordId);
  if (!rec) return;

  const qs     = rec.questions || [];
  const total  = qs.length;
  const idx    = s.examIdx;
  const isDone = rec.status === 'done';

  const wrapperAnswering = document.getElementById('st-exam-answering-wrapper');
  const wrapperResult    = document.getElementById('st-exam-result-wrapper');

  // ── 交卷按钮控制 ──
  const handInBtn = document.getElementById('st-exam-handin-btn');
  if (handInBtn) {
    handInBtn.style.display = (!isDone && idx < total) ? '' : 'none';
  }

  // ① 已批改完成，隐藏答题区，显示结果区
  if (isDone) {
    if(wrapperAnswering) wrapperAnswering.style.display = 'none';
    if(wrapperResult) {
      wrapperResult.style.display = 'block';
      _renderExamResult(rec, wrapperResult);
    }
    return;
  }

  // ③ 正在答题（逐题模式）
  if(wrapperAnswering) wrapperAnswering.style.display = 'flex';
  if(wrapperResult)    wrapperResult.style.display = 'none';
  
  _renderExamQuestion(rec, qs, idx);
}

// ── ③ 单题渲染 (填充静态 DOM) ──────────────────────────────────
function _renderExamQuestion(rec, qs, idx) {
  const { h } = window._study;
  const s     = window._study.state.test;
  const total = qs.length;
  const q     = qs[idx];

  const _examForGrader = (db.studyExams || []).find(e => e.id === rec.examId);
  const _graderChar    = _examForGrader?.graderCharId
    ? (db.characters || []).find(c => c.id === _examForGrader.graderCharId)
    : null;
  const graderName = _graderChar
    ? (_graderChar.remarkName || _graderChar.realName || _graderChar.name || 'AI')
    : 'AI';

  const isChoice    = q.type === 'choice';
  const result      = rec.results?.[q.id];
  const isSubmitted = !!result;
  const answer      = s.answers[q.id] ?? (rec.answers?.[q.id] ?? '');
  
  if (!s.answers[q.id] && rec.answers?.[q.id]) {
    s.answers[q.id] = rec.answers[q.id];
  }

  // 1. 填充卡片 Header 信息
  document.getElementById('st-q-badge').textContent = isChoice ? '单选题' : '问答题';
  document.getElementById('st-exam-current-num').textContent = idx + 1;
  document.getElementById('st-exam-total-num').textContent = ` /${total}`;
  document.getElementById('st-q-text').textContent = q.question;

  // 2. 填充输入区域 (选项 或 textarea)
  const inputArea = document.getElementById('st-input-area');
  if (isChoice && q.options) {
    const opts = q.options.map((opt, i) => {
      const letter = String.fromCharCode(65 + i);
      let cls = 'st-option';
      if (isSubmitted) {
        if (letter === q.answer)         cls += ' correct';
        else if (letter === answer)      cls += ' wrong';
        else                             cls += ' dimmed';
      } else if (letter === answer)      cls += ' selected';
      
      return `<button class="${cls}" data-letter="${letter}" ${isSubmitted ? 'disabled' : ''}>
                ${letter}. ${h(opt)}
              </button>`;
    }).join('');
    inputArea.innerHTML = `<div class="st-options">${opts}</div>`;
  } else {
    inputArea.innerHTML = `
      <div class="st-qa-area" style="margin-top: 10px;">
        <textarea id="exam-ans" class="st-input st-textarea" style="background:#f8f9fb; border:none; border-radius:12px; padding:16px;" placeholder="写下你的答案…" ${isSubmitted ? 'disabled' : ''}>${h(answer)}</textarea>
      </div>`;
  }

  // 3. 填充反馈区域
  const feedbackArea = document.getElementById('st-feedback-area');
  feedbackArea.innerHTML = ''; // 清空
  if (isSubmitted) {
    if (isChoice) {
      const isCorrect = result.correct;
      feedbackArea.innerHTML = `
        <div class="st-feedback ${isCorrect ? 'correct' : 'wrong'}" style="margin-top: 16px;">
          <h3 style="margin:0">${isCorrect ? '✓ 回答正确' : '✗ 回答错误'}</h3>
        </div>`;
    } else {
      const graded = result.correct !== null && result.correct !== undefined;
      const sourceLabel = result.source === 'self' ? '自评' : `${graderName}批改`;
      feedbackArea.innerHTML = `
        <div class="st-answer-box" style="background:#f8f9fb; border:none; margin-top: 16px;margin-bottom: 16px;">
          <h3>标准答案</h3>
          <p>${h(q.answer)}</p>
        </div>
        ${graded ? `
          <div class="st-feedback ${result.correct ? 'correct' : 'wrong'}">
             <h3 style="margin:0">${result.correct ? `✓ ${sourceLabel}：正确` : `✗ ${sourceLabel}：有待改进`}</h3>
          </div>` : ''}`;
    }
  }

  // 4. 填充操作区域 (统一的美化按钮)
  const actionArea = document.getElementById('st-action-area');
  let actionHTML = '';
  
  if (isSubmitted) {
    const isQA          = q.type === 'qa';
    const graded        = isQA && (result.correct !== null && result.correct !== undefined);
    const selfGradeOpen = !!(s._selfGradeOpen?.[q.id]);
    const showSelfBtn   = isQA && !graded;
    const isAnalyzing   = s.analyzingQIds?.has(q.id);
    const hasAnalysis   = !!result?.analysisText;
    const aiLabel       = isAnalyzing
      ? `${graderName}批改中…`
      : hasAnalysis
      ? `查看${graderName}批改结果`
      : `${graderName}批改`;

    if (!selfGradeOpen) {
      actionHTML += `<button class="st-action-btn" id="exam-analyze-btn" ${isAnalyzing ? 'disabled' : ''}>${aiLabel}</button>`;
      if (showSelfBtn) {
        actionHTML += `<button class="st-action-btn" id="self-grade-toggle">自己批改</button>`;
      }
    } else {
      actionHTML += `
        <button class="st-action-btn active" id="self-grade-toggle">返回${graderName}批改</button>
        <div style="width:100%;"></div> <!-- 折行占位 -->
        <button class="st-action-btn st-action-btn-correct" id="self-grade-correct">✓ 答对了</button>
        <button class="st-action-btn st-action-btn-wrong" id="self-grade-wrong">✗ 答错了</button>
      `;
    }
    actionArea.innerHTML = actionHTML ? `<div class="st-action-btn-group">${actionHTML}</div>` : '';
  } else {
    actionArea.innerHTML = '';
  }

  // 5. 设置底部导航状态
  const isLastQ   = idx === total - 1;
  const hasAnswer = answer.trim() !== '';
  const btnPrev   = document.getElementById('exam-prev');
  const btnNext   = document.getElementById('exam-next-submit');
  
  btnPrev.disabled = (idx === 0);
  
  if (!isSubmitted) {
    btnNext.textContent = '提交';
    btnNext.disabled = !hasAnswer;
  } else {
    btnNext.textContent = isLastQ ? '完成考试' : '下一题';
    btnNext.disabled = (!isChoice && result.correct === null) ? true : false; 
  }

  // ── 事件绑定 (重新绑定当前区域的事件) ──

  // 选项点击事件
  if (isChoice && !isSubmitted) {
    inputArea.querySelectorAll('.st-option').forEach(btn => {
      btn.onclick = () => {
        s.answers[q.id] = btn.dataset.letter;
        inputArea.querySelectorAll('.st-option').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        btnNext.disabled = false;
      };
    });
  }

  // 文本框输入事件
  if (!isChoice && !isSubmitted) {
    const ta = document.getElementById('exam-ans');
    if (ta) ta.oninput = (e) => {
      s.answers[q.id] = e.target.value;
      btnNext.disabled = !e.target.value.trim();
    };
  }

// 动作按钮事件 (AI/自己批改)
  const elAnalyze = document.getElementById('exam-analyze-btn');
  const elSelfTog = document.getElementById('self-grade-toggle');
  const elCorrect = document.getElementById('self-grade-correct');
  const elWrong   = document.getElementById('self-grade-wrong');

  // ✅ 新增：获取当前的批改角色 ID
  const currentGraderId = _examForGrader?.graderCharId || '';

  if (elAnalyze) elAnalyze.onclick = () => {
    if (result?.analysisText) {
      _openAnalysisSheet(result.analysisText, result, currentGraderId); return; // ✅ 修改为传入当前角色 ID
    }
    if (s.analyzingQIds?.has(q.id)) return;
    _runAnalysis(rec, q);
  };

  if (elSelfTog) elSelfTog.onclick = () => {
    s._selfGradeOpen = s._selfGradeOpen || {};
    s._selfGradeOpen[q.id] = !s._selfGradeOpen[q.id];
    studyRenderExam(); // 重新渲染刷新区域
  };

  if (elCorrect) elCorrect.onclick = async () => {
    rec.results[q.id] = { ...(rec.results[q.id] || {}), correct: true, source: 'self' };
    await updateExamRecord(rec.id, { results: rec.results });
    studyRenderExam();
  };

  if (elWrong) elWrong.onclick = async () => {
    rec.results[q.id] = { ...(rec.results[q.id] || {}), correct: false, source: 'self' };
    await updateExamRecord(rec.id, { results: rec.results });
    studyRenderExam();
  };

  // 底部导航按钮事件 (使用 onclick 避免重复绑定)
  btnPrev.onclick = () => {
    _saveCurrentAnswer(rec, q, s);
    s.examIdx--;
    studyRenderExam();
  };

  btnNext.onclick = async () => {
    if (!isSubmitted) {
      _submitCurrentQuestion(rec, q);
    } else {
      _saveCurrentAnswer(rec, q, s);
      if (isLastQ) {
        await _handInExam(rec);
      } else {
        s.examIdx = idx + 1;
        studyRenderExam();
      }
    }
  };
}

// ── 保存当前题目答案到 rec（不写 DB，仅内存）──────────────────
function _saveCurrentAnswer(rec, q, s) {
  if (s.answers[q.id] !== undefined) {
    rec.answers = { ...rec.answers, [q.id]: s.answers[q.id] };
  }
}

// ── 逐题提交（客观题直接比对，主观题展示答案）──────────────────
async function _submitCurrentQuestion(rec, q) {
  const s          = window._study.state.test;
  const userAnswer = (s.answers[q.id] ?? '').trim();

  let result;
  if (q.type === 'choice') {
    const correct = userAnswer === q.answer;
    result = {
      correct,
      comment: correct ? '回答正确！' : `正确答案是 ${q.answer}。`,
      source:  'direct',
    };
  } else {
    // 主观题：先标记已提交（correct = null 待 AI 批改）
    result = {
      correct: null,
      comment: '',
      source:  'direct',
    };
  }

  // 更新内存 + 写库
  rec.answers = { ...rec.answers, [q.id]: userAnswer };
  rec.results = { ...(rec.results || {}), [q.id]: result };
  await updateExamRecord(rec.id, { answers: rec.answers, results: rec.results });

  studyRenderExam();
}

// ── AI 分析：执行批改 + 流式分析 ─────────────────────────────
async function _runAnalysis(rec, q) {
  const s          = window._study.state.test;
  const statusWord = q.type === 'qa' ? '批改' : '分析';

  // 标记进行中
  (s.analyzingQIds ||= new Set()).add(q.id);

  const exam         = (db.studyExams || []).find(e => e.id === rec.examId);
  const charId       = exam?.graderCharId  || '';
  const worldbookIds = exam?.worldbookIds  || [];
  const personaId    = exam?.examPersonaId || '';
  const _rGChar      = charId ? (db.characters || []).find(c => c.id === charId) : null;
  const graderName   = _rGChar
    ? (_rGChar.remarkName || _rGChar.realName || _rGChar.name || 'AI')
    : 'AI';
  const userAnswer   = rec.answers?.[q.id] ?? '';

// 即时更新按钮区 DOM（如果还在当前题）
  const btnEl = document.getElementById('exam-analyze-btn');
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = `${graderName}${statusWord}中`; } // ✅ 加入 statusWord

  // 省略号动画（JS 驱动，循环 · ·· ···）
  let dot = 1;
  const dotTimer = setInterval(() => {
    dot = (dot % 3) + 1;
    const el = document.getElementById('exam-analyze-btn');
    if (el?.disabled) el.textContent = `${graderName}${statusWord}中${'·'.repeat(dot)}`; // ✅ 加入 statusWord
  }, 400);

  let streamText = '';   // onStream 实时累积（流式场景）
  try {
    const returnedText = await analyzeStudyQuestion(q, userAnswer, {
      charId, worldbookIds, personaId,
      onStream: chunk => { streamText += chunk; },
    });

    const rawText = returnedText || streamText;

    rec.results = rec.results || {};

    let analysisText;
    if (q.type === 'qa') {
      const { correct, analysisText: parsed } = _parseGradeAndAnalysis(rawText);
      analysisText = parsed;
      rec.results[q.id] = {
        ...(rec.results[q.id] || {}),
        correct: correct ?? null,
        source: 'ai',
        analysisText,
      };
    } else {
      analysisText = rawText;
      rec.results[q.id] = {
        ...(rec.results[q.id] || {}),
        analysisText,
      };
    }

    await updateExamRecord(rec.id, { results: rec.results });

    s.analyzingQIds?.delete(q.id);

    _openAnalysisSheet(analysisText, rec.results[q.id], charId);
    studyRenderExam();

  } catch (err) {
    console.error('[_runAnalysis]', err);
    s.analyzingQIds?.delete(q.id);
    studyRenderExam();
    showToast?.(`${statusWord}失败，请重试`);
  } finally {
    clearInterval(dotTimer);
    s.analyzingQIds?.delete(q.id);
  }
}

// ── 打开底部弹窗（批改评语 + 分析文本）────────────────────────
// ── 打开底部弹窗（批改评语 + 分析文本）────────────────────────
function _openAnalysisSheet(analysisText, result, charId = '') {
  const { h } = window._study;
  const sheet  = document.getElementById('st-analysis-sheet');
  const bodyEl = document.getElementById('st-analysis-body');
  if (!sheet || !bodyEl) return;

  // ── 更新标题区：头像 + 角色名 ──
  const titleEl  = document.getElementById('st-analysis-title');
  const avatarEl = document.getElementById('st-analysis-char-avatar');
  if (titleEl && avatarEl) {
    const char = charId ? (db.characters || []).find(c => c.id === charId) : null;
    if (char) {
      const charName = char.remarkName || char.realName || char.name || 'AI';
      titleEl.textContent = `${charName}的点评`;
      if (char.avatar) {
        avatarEl.src = char.avatar;
        avatarEl.style.display = '';
      } else {
        avatarEl.style.display = 'none';
      }
    } else {
      titleEl.textContent = 'AI的点评';
      avatarEl.style.display = 'none';
    }
  }

  // ── 正文 HTML ──
  let contentHTML = '';

  // ① 批改评语（有 comment 才显示）
  if (result?.comment) {
    const isCorrect = result.correct;
    contentHTML += `
      <div class="st-analysis-grade ${isCorrect ? 'correct' : 'wrong'}">
        <strong>${isCorrect ? '✓ 批改正确' : '✗ 有待改进'}</strong>
        <p>${h(result.comment)}</p>
      </div>`;
  }

  // ② 分析文本（Markdown 渲染）
  if (analysisText) {
    contentHTML += `<div class="st-analysis-text st-analysis-md">${_mdToHtml(analysisText)}</div>`;
  }

  bodyEl.innerHTML = contentHTML || '<p style="color:#aaa;text-align:center;padding:24px 0">暂无内容</p>';
  sheet.classList.add('visible');
}


// ── 中途交卷：未答/未批改的题目全部算错 ─────────────────────

async function _handInExam(rec) {
  const qs = rec.questions || [];
  rec.results = rec.results || {};

  for (const q of qs) {
    const r = rec.results[q.id];
    if (!r) {
      // 完全未作答
      rec.results[q.id] = { correct: false, comment: '未作答', source: 'direct' };
    } else if (r.correct === null || r.correct === undefined) {
      // 主观题已提交但未批改
      rec.results[q.id] = { ...r, correct: false, comment: '未批改', source: 'direct' };
    }
  }

  await _finishExam(rec);
}

// ── 完成考试（自动补充批改未评分的主观题）────────────────────

async function _finishExam(rec) {
  const s  = window._study.state.test;   // s 还有其他地方用到吗？如果没有也可删
  const qs = rec.questions || [];

  let correctCount = 0;
  let gradedCount  = 0;
  for (const q of qs) {
    const r = rec.results?.[q.id];
    if (!r) continue;
    gradedCount++;
    if (r.correct === true) correctCount++;
  }
  const score = qs.length ? Math.round((correctCount / qs.length) * 100) : 0;

  await updateExamRecord(rec.id, {
    results:    rec.results,
    score,
    status:     'done',
    finishedAt: Date.now(),
  });

  studyRenderExam();   // ← 统一走 wrapper 切换，不再污染 bodyEl
}

// ── 成绩结果页 ────────────────────────────────────────────────

function _renderExamResult(rec, bodyEl) {
  const qs           = rec.questions || [];
  const correctCount = qs.filter(q => rec.results?.[q.id]?.correct === true).length;
  const wrongCount   = qs.filter(q => rec.results?.[q.id]?.correct === false).length;
  const ungradedCount = qs.filter(q => {
    const r = rec.results?.[q.id];
    return !r || r.correct === null || r.correct === undefined;
  }).length;
  
  // 交卷按钮隐藏
  const handInBtn = document.getElementById('st-exam-handin-btn');
  if (handInBtn) handInBtn.style.display = 'none';

  bodyEl.innerHTML = `
    <div class="st-complete st-fade">
      <div class="st-exam-score-ring">
        <span class="st-exam-score-num">${rec.score ?? 0}</span>
      </div>
      <p class="st-exam-score-summary">
        共 ${qs.length} 题 &nbsp;·&nbsp; 答对 <strong>${correctCount}</strong> 题
        &nbsp;·&nbsp; 答错 <strong>${wrongCount}</strong> 题
        ${ungradedCount ? `<br><span style="color:#f5a623;font-size:13px">${ungradedCount} 题未评分</span>` : ''}
      </p>
      <button class="btn btn-primary" id="exam-done-btn">返回任务主页</button>
    </div>`;

  document.getElementById('exam-done-btn')?.addEventListener('click', () => {
    if (typeof navigateTo === 'function') navigateTo('study-exam-info-screen');
    const s = window._study.state.test;
    if (s.currentExamId) {
      _renderExamInfoScreen(s.currentExamId);
      setTimeout(() => {
        document.querySelector('#st-ei-tabs .char-info-tab-btn[data-tab="records"]')?.click();
      }, 50);
    }
  });
}

let _testPendingWbIds = [];

function studyInitTest() {
  document.getElementById('study-test-add-btn')
    ?.addEventListener('click', _openCreateExamModal);

  // 交卷按钮（全局只绑一次）
  document.getElementById('st-exam-handin-btn')
    ?.addEventListener('click', async () => {
      const s   = window._study.state.test;
      const rec = (db.studyExamRecords || []).find(r => r.id === s.currentRecordId);
      if (!rec) return;
      const ok = await AppUI.confirm(
        '确定中途交卷？未作答的题目将计为错误。',
        '交卷'
      );
      if (!ok) return;
      await _handInExam(rec);
    });

  window._screenEnterHooks = window._screenEnterHooks || {};
  window._screenEnterHooks['study-exam-screen']      = () => studyRenderExam();
  window._screenEnterHooks['study-exam-info-screen'] = () => {
    const s = window._study.state.test;
    if (s.currentExamId) _renderExamInfoScreen(s.currentExamId);
  };
  // ↓ 新增
  window._screenEnterHooks['study-exam-result-screen'] = () => {
    const s = window._study.state.test;
    if (s.viewingRecordId) _renderExamResultScreen(s.viewingRecordId);
  };
}

function _populateTestSidebar() {
  const cfg = { graderCharId:  exam.graderCharId  || '',
  examPersonaId: exam.examPersonaId || '',
  worldbookIds:  exam.worldbookIds  || [] };
  _testPendingWbIds = [...(cfg.worldbookIds || [])];

  const charSel = document.getElementById('st-test-char-select');
  if (charSel) {
    charSel.innerHTML =
      `<option value="">（不指定）</option>` +
      (db.characters || []).map(c => {
        const name = c.remarkName || c.realName || c.name || '';
        return `<option value="${c.id}" ${c.id === cfg.graderCharId ? 'selected' : ''}>${name}</option>`;
      }).join('');
  }

  const personaSel = document.getElementById('st-test-persona-select');
  if (personaSel) {
    personaSel.innerHTML =
      `<option value="">（不指定）</option>` +
      (db.userPersonas || []).map(p => {
        const pid = p.id || p.nickname;
        return `<option value="${pid}" ${pid === cfg.examPersonaId ? 'selected' : ''}>${p.nickname || ''}</option>`;
      }).join('');
  }

  _updateTestWbLabel();
}

function _updateTestWbLabel() {
  const label = document.getElementById('study-test-worldbook-label');
  if (!label) return;
  const names = _testPendingWbIds
    .map(id => (db.worldBooks || []).find(w => w.id === id)?.name)
    .filter(Boolean);
  label.textContent = names.length ? names.join('、') : '未关联';
}

// ── 世界书多选 modal ──────────────────────────────────────────
function _openTestWbModal() {
  _openWbSelectModal(_testPendingWbIds, 'test-wb', selectedIds => {
    _testPendingWbIds = selectedIds;
    _updateTestWbLabel();
  });
}

// ──────────────────────────────────────────────────────────────

let _eiPendingWbIds        = [];
let _eiPendingBankIds      = [];
let _eiPendingPersonaId    = '';
let _eiPendingGraderCharId = '';
let _eiPendingTitle        = '';   // 标题暂存（编辑中尚未写库）

// ── 考卷详情页主入口 ─────────────────────────────────────────
function _renderExamInfoScreen(examId) {
  const exam = (db.studyExams || []).find(e => e.id === examId);
  if (!exam) return;

  const records   = getExamRecordsByExam(examId);
  const hasActive = records.some(r => r.status === 'in_progress');

  // ── 标题：初始化暂存 + 绑定点击编辑 ──
  _eiPendingTitle = exam.title || '未命名考卷';
  const titleEl = document.getElementById('st-ei-title');
  if (titleEl) {
    titleEl.textContent = _eiPendingTitle;
    titleEl.onclick = () => _startEiTitleEdit(titleEl);
  }

  // ── 开始/继续按钮 ──
  const startBtn   = document.getElementById('st-ei-start-btn');
  const startLabel = document.getElementById('st-ei-start-label');
  if (startBtn && startLabel) {
    startLabel.textContent = hasActive ? '继续答题' : '开始新考试';
    startBtn.onclick = () => _startExamFromInfo(exam.id);
  }

  // ── header 保存按钮 ──
  const saveBtn = document.getElementById('st-ei-save-btn');
  if (saveBtn) saveBtn.onclick = () => _saveEiSettings(exam.id);
  
  // ── header 删除按钮 ──（新增）
const deleteBtn = document.getElementById('st-ei-delete-btn');
if (deleteBtn) {
  deleteBtn.onclick = async () => {
    const confirmed = await AppUI.confirm(
      `确定要删除「${exam.title || '未命名考卷'}」吗？\n删除后无法恢复，包含所有测试记录。`,
      '删除测试任务',
      '删除',
      '取消'
    );
    if (!confirmed) return;
    await deleteStudyExam(exam.id);
    showToast('已删除');
    studyRenderTest();
    if (typeof navigateTo === 'function') navigateTo('study-test-screen');
  };
}

  // ── Tab 栏（克隆重绑，防止重复监听）──
  const tabBar = document.getElementById('st-ei-tabs');
  if (tabBar) {
    const freshBar = tabBar.cloneNode(true);
    tabBar.replaceWith(freshBar);
    freshBar.querySelectorAll('.char-info-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        freshBar.querySelectorAll('.char-info-tab-btn')
          .forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('#study-exam-info-screen .char-info-tab-panel')
          .forEach(p => p.classList.toggle('active', p.dataset.panel === btn.dataset.tab));
      });
    });
  }

  document.querySelectorAll('#study-exam-info-screen .char-info-tab-btn')
    .forEach((b, i) => b.classList.toggle('active', i === 0));
  document.querySelectorAll('#study-exam-info-screen .char-info-tab-panel')
    .forEach((p, i) => p.classList.toggle('active', i === 0));

  _renderEiInfoPanel(exam);
  _renderEiRecordsPanel(exam);
}

// ── 标题行内编辑 ─────────────────────────────────────────────
function _startEiTitleEdit(titleEl) {
  const snapshot = _eiPendingTitle;

  const input = document.createElement('input');
  input.type      = 'text';
  input.className = 'st-ei-title-input';
  input.value     = snapshot;
  titleEl.replaceWith(input);
  input.focus();
  input.select();

  const commit = () => {
    const val = input.value.trim() || snapshot;
    _eiPendingTitle = val;
    _restoreEiTitleEl(input, val);
  };
  const cancel = () => {
    _eiPendingTitle = snapshot;
    _restoreEiTitleEl(input, snapshot);
  };

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); input.removeEventListener('blur', commit); commit(); }
    if (e.key === 'Escape') { input.removeEventListener('blur', commit); cancel(); }
  });
}

function _restoreEiTitleEl(input, text) {
  const div = document.createElement('div');
  div.className   = 'st-ei-title st-ei-title--editable';
  div.id          = 'st-ei-title';
  div.textContent = text;
  div.onclick     = () => _startEiTitleEdit(div);
  input.replaceWith(div);
}

// ── 保存设置（header 按钮触发）───────────────────────────────
async function _saveEiSettings(examId) {
  if (!_eiPendingBankIds.length) {
    if (typeof showToast === 'function') showToast('请至少选择一个题库');
    return;
  }
  const drawCount = Math.max(1,
    parseInt(document.getElementById('st-ei-draw-count')?.value) || 10);

  // 用户自定义标题优先；为空时以题库名兜底（不拼题数）
  const title = _eiPendingTitle.trim() || (() => {
    const names = _eiPendingBankIds
      .map(id => (db.studyBanks || []).find(b => b.id === id)?.name)
      .filter(Boolean);
    return names.join('＋') || '未命名考卷';
  })();

  await updateStudyExam(examId, {
    title,
    bankIds:       _eiPendingBankIds,
    drawCount,
    graderCharId:  _eiPendingGraderCharId,
    examPersonaId: _eiPendingPersonaId,
    worldbookIds:  _eiPendingWbIds,
  });

  // 同步回显标题
  _eiPendingTitle = title;
  const titleEl = document.getElementById('st-ei-title');
  if (titleEl) titleEl.textContent = title;

  if (typeof showToast === 'function') showToast('已保存');
}

// ── 基本信息 panel（静态 DOM 已存在，只更新内容）──────────────
function _renderEiInfoPanel(exam) {
  // 初始化待确认状态
  _eiPendingBankIds      = [...(exam.bankIds      || [])];
  _eiPendingPersonaId    = exam.examPersonaId     || '';
  _eiPendingGraderCharId = exam.graderCharId      || '';
  _eiPendingWbIds        = [...(exam.worldbookIds || [])];

  // 更新各 label 文字
  _updateEiBankLabel();
  _updateEiDrawHint();
  _updateEiPersonaLabel();
  _updateEiGraderLabel();
  _updateEiWbLabel();

  // 抽题数量 input 初始值
  const drawInput = document.getElementById('st-ei-draw-count');
  if (drawInput) drawInput.value = exam.drawCount || 10;

  // 绑定按钮（用 onclick 赋值覆盖，不重复 addEventListener）
  const bankBtn    = document.getElementById('st-ei-bank-btn');
  const personaBtn = document.getElementById('st-ei-persona-btn');
  const graderBtn  = document.getElementById('st-ei-grader-btn');
  const wbBtn      = document.getElementById('st-ei-wb-btn');

  if (bankBtn)    bankBtn.onclick    = _openEiBankModal;
  if (personaBtn) personaBtn.onclick = _openEiPersonaModal;
  if (graderBtn)  graderBtn.onclick  = _openEiGraderModal;
  if (wbBtn)      wbBtn.onclick      = _openEiWbModal;
}

// ── 考试记录 panel ───────────────────────────────────────────
function _renderEiRecordsPanel(exam) {
  const { h } = window._study;
  const panelEl = document.getElementById('st-ei-panel-records');
  if (!panelEl) return;

  const records = getExamRecordsByExam(exam.id);

if (!records.length) {
  panelEl.innerHTML = `
    <div class="st-center-msg" style="padding-top:48px">
      <p style="font-size:13px;color:#aaa">点击"开始新考试"开始第一次测验</p>
    </div>`;
  return;
}

  const statusMap = { done: '已完成', in_progress: '进行中', pending: '待开始' };
  const statusCls = { done: 'st-exam-done', in_progress: 'st-exam-progress', pending: 'st-exam-pending' };

  panelEl.innerHTML = records.map((rec, idx) => {
    const dateStr = new Date(rec.startedAt).toLocaleString('zh-CN', {
      month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    const status = rec.status || 'pending';

    return `
      <div class="st-ei-record-card" data-rec-id="${h(rec.id)}" data-status="${h(status)}">
        <div class="st-ei-record-header">
          <div class="st-ei-record-meta">
            <span class="st-ei-record-num">第 ${records.length - idx} 次</span>
            <span class="st-ei-record-date">${dateStr}</span>
          </div>
          <div class="st-ei-record-right">
            ${rec.status === 'done'
              ? `<span class="st-ei-record-score">${rec.score ?? 0} 分</span>`
              : `<span class="st-exam-status ${statusCls[status] || ''}">${statusMap[status]}</span>`}
            <svg class="st-ei-record-chevron" viewBox="0 0 24 24" fill="none"
                 stroke="#bbb" stroke-width="2" stroke-linecap="round" width="16" height="16">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </div>
        </div>
      </div>`;
  }).join('');

  panelEl.querySelectorAll('.st-ei-record-card').forEach(card => {
    card.addEventListener('click', () => {
      const recId  = card.dataset.recId;
      const status = card.dataset.status;
      if (status === 'done') {
        _openExamResultScreen(recId);
      } else if (status === 'in_progress') {
        _resumeExamRecord(recId);
      }
    });
  });
}

function _openExamResultScreen(recordId) {
  window._study.state.test.viewingRecordId = recordId;
  if (typeof navigateTo === 'function') navigateTo('study-exam-result-screen');
}

// ── 成绩结果页 ────────────────────────────────────────────────
function _renderExamResultScreen(recordId) {
  const { h } = window._study;
  const rec    = (db.studyExamRecords || []).find(r => r.id === recordId);
  const bodyEl = document.getElementById('study-exam-result-body');
  if (!bodyEl) return;
  if (!rec) {
    bodyEl.innerHTML = '<p style="padding:40px 0;text-align:center;color:#aaa">找不到记录</p>';
    return;
  }

  // header subtitle 置空（因为时间移到了卡片里）
  const subEl = document.getElementById('st-result-subtitle');
  if (subEl) subEl.textContent = '';

  // back-btn：返回 exam-info-screen 并激活记录 tab
  const backBtn = document.getElementById('st-result-back-btn');
  if (backBtn && !backBtn._resultBound) {
    backBtn._resultBound = true;
    backBtn.addEventListener('click', () => {
      if (typeof navigateTo === 'function') navigateTo('study-exam-info-screen');
      const s = window._study.state.test;
      if (s.currentExamId) {
        _renderExamInfoScreen(s.currentExamId);
        setTimeout(() => {
          document.querySelector('#st-ei-tabs .char-info-tab-btn[data-tab="records"]')?.click();
        }, 50);
      }
    });
  }

  const qs            = rec.questions || [];
  const correctCount  = qs.filter(q => rec.results?.[q.id]?.correct === true).length;
  const ungradedCount = qs.filter(q => {
    const r = rec.results?.[q.id];
    return !r || r.correct === null || r.correct === undefined;
  }).length;

  // 格式化时间
  const dateStr = new Date(rec.startedAt).toLocaleString('zh-CN', {
    year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  bodyEl.innerHTML = `
    <div class="st-exam-result st-fade">

      <!-- 1. 顶部数据总览卡片 (左右结构) -->
      <div class="st-result-overview-card">
        <div class="overview-left">
          <div class="st-exam-score-ring">
            <span class="st-exam-score-num">${rec.score ?? 0}</span>
          </div>
        </div>
        <div class="overview-right">
          <div class="overview-date">${dateStr}</div>
          <div class="overview-stats">
            <div class="stat-item">共计 <strong>${qs.length}</strong> 题</div>
            <div class="stat-item correct">答对 <strong>${correctCount}</strong> 题</div>
            ${ungradedCount ? `<div class="stat-item warning"><strong>${ungradedCount}</strong> 题未评分</div>` : ''}
          </div>
        </div>
      </div>

      <!-- 2. 逐题详情列表 (采用 Summary Chunk 风格) -->
      <div class="st-result-list">
        ${qs.map((q, i) => {
          const r          = rec.results?.[q.id];
          const userAns    = rec.answers?.[q.id] ?? '';
          const correct    = r?.correct;
          const isUngraded = correct === null || correct === undefined;
          const isChoice   = q.type === 'choice';
          const statusCls  = isUngraded ? 'ungraded' : correct ? 'correct' : 'wrong';

          // 选择题选项
          let optionsHTML = '';
          if (isChoice && Array.isArray(q.options)) {
            optionsHTML = `<div class="st-res-options">
              ${q.options.map((opt, oi) => {
                const letter = String.fromCharCode(65 + oi);
                let cls = 'st-res-opt';
                if (letter === q.answer)                       cls += ' is-answer';
                if (letter === userAns && letter === q.answer) cls += ' is-chosen-correct';
                if (letter === userAns && letter !== q.answer) cls += ' is-chosen-wrong';
                return `<div class="${cls}">
                  <span class="opt-letter">${letter}</span>
                  <span class="opt-text">${h(opt)}</span>
                </div>`;
              }).join('')}
            </div>`;
          }

          // 答案对比 + AI点评 (内嵌折叠区)
          const showAnswerCmp = !isChoice || (!correct && !isUngraded);
          
          let innerMetaHTML = '';
          if (showAnswerCmp || r?.comment || r?.analysisText) {
            
            // 我的回答 vs 标准答案
            let cmpHTML = '';
            if (showAnswerCmp) {
                cmpHTML = `
                <div class="st-res-cmp">
                    <div class="cmp-row my-ans ${isUngraded ? '' : correct ? 'is-correct' : 'is-wrong'}">
                        <span class="cmp-label">你的回答</span>
                        <span class="cmp-val">${h(userAns || '（未作答）')}</span>
                    </div>
                    <div class="cmp-row std-ans">
                        <span class="cmp-label">正确答案</span>
                        <span class="cmp-val">${h(q.answer)}</span>
                    </div>
                </div>`;
            }

            // 点评内容
            let analysisHTML = '';
            if (r?.comment || r?.analysisText) {
                analysisHTML = `
                <div class="st-res-analysis-body chunk-hide">
                    ${r?.comment ? `<div class="st-res-comment"><span class="cmp-label">批改评语</span><p>${h(r.comment)}</p></div>` : ''}
                    ${r?.analysisText ? `<div class="st-analysis-md">${_mdToHtml(r.analysisText)}</div>` : ''}
                </div>`;
            }

            // 组装折叠块 (复刻 chunk-meta-wrapper)
            innerMetaHTML = `
            <div class="chunk-meta-wrapper">
                <div class="chunk-meta-toggle">
                    <span>${r?.analysisText ? '解析' : '解析'}</span>
                    <svg class="toggle-icon" viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                        <path d="M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z"/>
                    </svg>
                </div>
                <div class="chunk-block-meta chunk-hide">
                    ${cmpHTML}
                    ${analysisHTML}
                </div>
            </div>`;
          }

          return `
            <div class="chunk-block st-res-card ${statusCls}">
              <div class="chunk-block-header">
                <div class="chunk-header-left">
                  <span class="st-res-badge ${statusCls}">${isChoice ? '选择题' : '问答题'}</span>
                  <span class="chunk-block-index">第 ${i + 1} 题</span>
                </div>
                <div class="chunk-header-actions st-res-status ${statusCls}">
                  ${isUngraded ? '待评分' : correct ? '✓ 回答正确' : '✗ 需要改进'}
                </div>
              </div>
              <div class="chunk-block-content st-res-q-text">${h(q.question)}</div>
              ${optionsHTML}
              ${innerMetaHTML}
            </div>`;
        }).join('')}
      </div>

    </div>`;

  // ── 手风琴：展开/折叠点评 ──
  bodyEl.querySelectorAll('.chunk-meta-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const wrapper = btn.closest('.chunk-meta-wrapper');
      const metaDiv = wrapper.querySelector('.chunk-block-meta');
      const analysisBody = wrapper.querySelector('.st-res-analysis-body');
      const toggleText = btn.querySelector('span');
      
      const isHidden = metaDiv.classList.contains('chunk-hide');
      if (isHidden) {
        metaDiv.classList.remove('chunk-hide');
        if (analysisBody) analysisBody.classList.remove('chunk-hide');
        wrapper.classList.add('expanded');
        toggleText.textContent = '解析';
      } else {
        metaDiv.classList.add('chunk-hide');
        if (analysisBody) analysisBody.classList.add('chunk-hide');
        wrapper.classList.remove('expanded');
        toggleText.textContent = btn.dataset.oriText || (analysisBody ? '解析' : '解析');
      }
      if(!btn.dataset.oriText) btn.dataset.oriText = toggleText.textContent;
    });
  });
}

// ── 世界书多选弹窗（exam-info 专用）────────────────────────
function _openEiWbModal() {
  _openWbSelectModal(_eiPendingWbIds, 'ei-wb', selectedIds => {
    _eiPendingWbIds = selectedIds;
    _updateEiWbLabel();
  });
}

function _updateEiWbLabel() {
  const names = _eiPendingWbIds
    .map(id => (db.worldBooks || []).find(w => w.id === id)?.name).filter(Boolean);
  const el = document.getElementById('st-ei-wb-label');
  if (el) el.textContent = names.length ? names.join('、') : '未关联';
}

// ── exam-info 三个选择弹窗：初始化绑定 ───────────────────────
function initEiSelectModals() {
  // 关联题库 modal
  const bankModal = document.getElementById('ei-bank-modal');
  if (bankModal && !bankModal._bound) {
    bankModal._bound = true;
    bankModal.addEventListener('click', e => {
      if (e.target === bankModal) bankModal.classList.remove('visible');
    });
    document.getElementById('ei-bank-modal-confirm')
      ?.addEventListener('click', () => {
        _eiPendingBankIds = [...bankModal.querySelectorAll('.ei-bank-cb:checked')]
          .map(cb => cb.value);
        bankModal.classList.remove('visible');
        _updateEiBankLabel();
        _updateEiDrawHint();
      });
  }

  // 答题人 modal
  const personaModal = document.getElementById('ei-persona-modal');
  if (personaModal && !personaModal._bound) {
    personaModal._bound = true;
    personaModal.addEventListener('click', e => {
      if (e.target === personaModal) personaModal.classList.remove('visible');
    });
    document.getElementById('ei-persona-modal-confirm')
      ?.addEventListener('click', () => {
        const checked = personaModal.querySelector('.ei-persona-radio:checked');
        _eiPendingPersonaId = checked ? checked.value : '';
        personaModal.classList.remove('visible');
        _updateEiPersonaLabel();
      });
  }

  // 批改角色 modal
  const graderModal = document.getElementById('ei-grader-modal');
  if (graderModal && !graderModal._bound) {
    graderModal._bound = true;
    graderModal.addEventListener('click', e => {
      if (e.target === graderModal) graderModal.classList.remove('visible');
    });
    document.getElementById('ei-grader-modal-confirm')
      ?.addEventListener('click', () => {
        const checked = graderModal.querySelector('.ei-grader-radio:checked');
        _eiPendingGraderCharId = checked ? checked.value : '';
        graderModal.classList.remove('visible');
        _updateEiGraderLabel();
      });
  }
}

// ── 关联题库 ─────────────────────────────────────────────────
function _openEiBankModal() {
  const { h } = window._study;
  const banks  = getAllStudyBanks();
  const listEl = document.getElementById('ei-bank-modal-list');
  if (!listEl) return;

  listEl.innerHTML = banks.length
    ? banks.map(bank => {
        const total   = getQuestionsByBank(bank.id).length;
        const checked = _eiPendingBankIds.includes(bank.id);
        const disabled = !total;
        return `
          <li class="wb-select-item${disabled ? ' disabled' : ''}">
            <label>
              <input type="checkbox" class="ei-bank-cb"
                     value="${h(bank.id)}" ${checked ? 'checked' : ''}
                     ${disabled ? 'disabled' : ''}>
              <span>${h(bank.name)}</span>
              <span class="wb-select-sub${!total ? ' empty' : ''}" style="margin-left:auto">
                ${total ? `${total} 题` : '暂无题目'}
              </span>
            </label>
          </li>`;
      }).join('')
    : `<li class="wb-select-item" style="color:#aaa">暂无题库，请先创建</li>`;

  document.getElementById('ei-bank-modal')?.classList.add('visible');
}

function _updateEiBankLabel() {
  const names = _eiPendingBankIds
    .map(id => (db.studyBanks || []).find(b => b.id === id)?.name)
    .filter(Boolean);
  const el = document.getElementById('st-ei-bank-label');
  if (el) el.textContent = names.length ? names.join('、') : '未关联';
}

function _updateEiDrawHint() {
  const max   = _eiPendingBankIds.reduce((s, id) => s + getQuestionsByBank(id).length, 0);
  const hint  = document.getElementById('st-ei-draw-hint');
  const input = document.getElementById('st-ei-draw-count');
  if (hint)  hint.textContent  = max ? `最多 ${max} 题` : '请先选择题库';
  if (input) {
    input.max   = max || 1;
    input.value = Math.min(parseInt(input.value) || 10, max || 1);
  }
}

// ── 答题人 ───────────────────────────────────────────────────
function _openEiPersonaModal() {
  const { h } = window._study;
  const personas = db.userPersonas || [];
  const listEl   = document.getElementById('ei-persona-modal-list');
  if (!listEl) return;

  listEl.innerHTML = '';

  // "不指定" 选项
  const noneItem = document.createElement('li');
  noneItem.className = 'list-item';
  noneItem.style.cssText = 'display:flex;align-items:center;padding:10px;';
  noneItem.innerHTML = `
    <input type="radio" name="ei_persona_radio" class="ei-persona-radio"
           value="" id="ei_p_none"
           ${_eiPendingPersonaId === '' ? 'checked' : ''}
           style="margin-right:15px;transform:scale(1.2);">
    <label for="ei_p_none" style="display:flex;align-items:center;flex:1;cursor:pointer;">
      <div style="width:36px;height:36px;border-radius:50%;margin-right:10px;
                  background:var(--bg-tertiary,#f0f0f0);display:flex;
                  align-items:center;justify-content:center;color:#aaa;font-size:14px;">
        无
      </div>
      <div style="display:flex;flex-direction:column;justify-content:center;">
        <div style="font-weight:bold;color:var(--primary-color);">不指定</div>
        <div style="font-size:12px;color:#aaa;margin-top:2px;">不绑定答题人身份</div>
      </div>
    </label>`;
  listEl.appendChild(noneItem);

  if (!personas.length) {
    const empty = document.createElement('li');
    empty.className = 'list-item';
    empty.style.cssText = 'color:#aaa;justify-content:center;';
    empty.textContent = '暂无人设预设';
    listEl.appendChild(empty);
  } else {
    personas.forEach((p, i) => {
      const pid     = p.id || p.nickname || '';
      const checked = _eiPendingPersonaId === pid;
      const li      = document.createElement('li');
      li.className  = 'list-item';
      li.style.cssText = 'display:flex;align-items:center;padding:10px;';
      li.innerHTML = `
        <input type="radio" name="ei_persona_radio" class="ei-persona-radio"
               value="${h(pid)}" id="ei_p_${i}"
               ${checked ? 'checked' : ''}
               style="margin-right:15px;transform:scale(1.2);">
        <label for="ei_p_${i}" style="display:flex;align-items:center;flex:1;cursor:pointer;">
          <img src="${p.avatar || ''}"
               style="width:36px;height:36px;border-radius:50%;margin-right:10px;
                      object-fit:cover;background:var(--bg-tertiary,#eee);"
               onerror="this.style.visibility='hidden'">
          <div style="display:flex;flex-direction:column;justify-content:center;">
            <div style="font-weight:bold;color:var(--primary-color);">${h(p.nickname || '未命名')}</div>
            <div style="font-size:12px;color:#666;margin-top:2px;
                        overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px;">
              真名：${h(p.realName || '—')}
            </div>
          </div>
        </label>`;
      listEl.appendChild(li);
    });
  }

  document.getElementById('ei-persona-modal')?.classList.add('visible');
}

function _updateEiPersonaLabel() {
  const p  = (db.userPersonas || []).find(p => (p.id || p.nickname) === _eiPendingPersonaId);
  const el = document.getElementById('st-ei-persona-label');
  if (el) el.textContent = p ? (p.nickname || '未知') : '未指定';
}

// ── 批改角色 ─────────────────────────────────────────────────
function _openEiGraderModal() {
  const { h } = window._study;
  const chars  = db.characters || [];
  const listEl = document.getElementById('ei-grader-modal-list');
  if (!listEl) return;

  listEl.innerHTML = '';

  // "不指定" 选项
  const noneItem = document.createElement('li');
  noneItem.className = 'list-item';
  noneItem.style.cssText = 'display:flex;align-items:center;padding:10px;';
  noneItem.innerHTML = `
    <input type="radio" name="ei_grader_radio" class="ei-grader-radio"
           value="" id="ei_g_none"
           ${_eiPendingGraderCharId === '' ? 'checked' : ''}
           style="margin-right:15px;transform:scale(1.2);">
    <label for="ei_g_none" style="display:flex;align-items:center;flex:1;cursor:pointer;">
      <div style="width:36px;height:36px;border-radius:50%;margin-right:10px;
                  background:var(--bg-tertiary,#f0f0f0);display:flex;
                  align-items:center;justify-content:center;color:#aaa;font-size:14px;">
        无
      </div>
      <div style="display:flex;flex-direction:column;justify-content:center;">
        <div style="font-weight:bold;color:var(--primary-color);">不指定</div>
        <div style="font-size:12px;color:#aaa;margin-top:2px;">使用默认 API 批改</div>
      </div>
    </label>`;
  listEl.appendChild(noneItem);

  if (!chars.length) {
    const empty = document.createElement('li');
    empty.className = 'list-item';
    empty.style.cssText = 'color:#aaa;justify-content:center;';
    empty.textContent = '暂无角色数据';
    listEl.appendChild(empty);
  } else {
    chars.forEach((c, i) => {
      const checked    = _eiPendingGraderCharId === c.id;
      const remarkName = c.remarkName || c.realName || c.name || '未知';
      const realName   = c.realName   || c.name    || '—';
      const li         = document.createElement('li');
      li.className     = 'list-item';
      li.style.cssText = 'display:flex;align-items:center;padding:10px;';
      li.innerHTML = `
        <input type="radio" name="ei_grader_radio" class="ei-grader-radio"
               value="${h(c.id)}" id="ei_g_${i}"
               ${checked ? 'checked' : ''}
               style="margin-right:15px;transform:scale(1.2);">
        <label for="ei_g_${i}" style="display:flex;align-items:center;flex:1;cursor:pointer;">
          <img src="${c.avatar || ''}"
               style="width:36px;height:36px;border-radius:50%;margin-right:10px;
                      object-fit:cover;background:var(--bg-tertiary,#eee);"
               onerror="this.style.visibility='hidden'">
          <div style="display:flex;flex-direction:column;justify-content:center;">
            <div style="font-weight:bold;color:var(--primary-color);">${h(remarkName)}</div>
            <div style="font-size:12px;color:#666;margin-top:2px;
                        overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px;">
              真名：${h(realName)}
            </div>
          </div>
        </label>`;
      listEl.appendChild(li);
    });
  }

  document.getElementById('ei-grader-modal')?.classList.add('visible');
}

function _updateEiGraderLabel() {
  const c  = (db.characters || []).find(c => c.id === _eiPendingGraderCharId);
  const el = document.getElementById('st-ei-grader-label');
  if (el) el.textContent = c
    ? (c.remarkName || c.realName || c.name || '未知')
    : '未指定';
}

// ── 开始/继续答题 ──────────────────────────────────────────
async function _startExamFromInfo(examId) {
  const exam = (db.studyExams || []).find(e => e.id === examId);
  if (!exam) return;

  const activeRec = getExamRecordsByExam(examId).find(r => r.status === 'in_progress');
  if (activeRec) {
    _resumeExamRecord(activeRec.id);
    return;
  }

  const bankIds       = _eiPendingBankIds.length ? _eiPendingBankIds : (exam.bankIds || []);
  const drawCount     = Math.max(1,
    parseInt(document.getElementById('st-ei-draw-count')?.value) || exam.drawCount || 10);
  const graderCharId  = _eiPendingGraderCharId  || exam.graderCharId  || '';
  const examPersonaId = _eiPendingPersonaId      || exam.examPersonaId || '';

  await updateStudyExam(examId, { bankIds, drawCount, graderCharId, examPersonaId, worldbookIds: _eiPendingWbIds });

  const pool = bankIds.flatMap(id => {
    const bankName = (db.studyBanks || []).find(b => b.id === id)?.name || '';
    return getQuestionsByBank(id).map(q => ({ ...q, _bankName: bankName }));
  });
  const questions = [...pool].sort(() => Math.random() - 0.5).slice(0, drawCount);

  if (!questions.length) {
    if (typeof showToast === 'function') showToast('选中题库暂无题目，请先添加');
    return;
  }

  const newRec = await saveExamRecord({ examId, questions });

  const s = window._study.state.test;
  s.currentExamId   = examId;
  s.currentRecordId = newRec.id;
  s.examIdx         = 0;
  s.answers         = {};
  s.isGrading       = false;

  if (typeof navigateTo === 'function') navigateTo('study-exam-screen');
}

// 继续某条未完成的答题记录
function _resumeExamRecord(recordId) {
  const rec = (db.studyExamRecords || []).find(r => r.id === recordId);
  if (!rec) return;

  const s = window._study.state.test;
  s.currentExamId   = rec.examId;
  s.currentRecordId = recordId;
  s.examIdx         = 0;
  s.answers         = { ...(rec.answers || {}) };
  s.isGrading       = false;

  if (typeof navigateTo === 'function') navigateTo('study-exam-screen');
}
