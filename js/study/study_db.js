// study_db.js — 学习模块数据层
// 操作 window.db 内存对象 + 同步到 dexieDB（精准保存）
// 所有写操作为 async；读操作为同步（直接读内存）
// ★ V8：书籍正文 → studyBookContents 表，共读消息 → studyCoreadMessages 表，分页缓存 → studyPageCache 表
// =====================================================

function _genStudyId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

// ── Books ──────────────────────────────────────────

/**
 * 导入新书：元数据写 studyBooks，正文单独写 studyBookContents
 * book 参数中必须含有 content 字段（原文）
 */
async function saveStudyBook(book) {
  const content = book.content || '';
  const newBook = { ...book, id: _genStudyId('book'), createdAt: Date.now() };
  // 元数据不含正文
  delete newBook.content;
  delete newBook.coreadMessages; // 防御旧数据混入

  db.studyBooks.push(newBook);
  await saveStudyBookToDB(newBook);                          // 只写元数据
  await saveStudyBookContentToDB(newBook.id, content);      // 正文独立写

  return newBook;
}

/**
 * 删除书籍：级联删除元数据 / 正文 / 题目 / 记录 / 共读消息 / 分页缓存
 */
async function deleteStudyBook(bookId) {
  db.studyBooks     = db.studyBooks.filter(b => b.id !== bookId);
  db.studyQuestions = db.studyQuestions.filter(q => q.bookId !== bookId);
  db.studyRecords   = db.studyRecords.filter(r => r.bookId !== bookId);
  // database.js 的 deleteStudyBookFromDB 已级联删除所有关联表
  await deleteStudyBookFromDB(bookId);
}

/**
 * 部分更新书籍元数据（patch 只需包含要改的字段，不含 content）
 */
async function updateStudyBook(bookId, patch) {
  const book = db.studyBooks.find(b => String(b.id) === String(bookId));
  if (!book) return null;
  // 防止意外把正文塞进元数据
  const safePatch = { ...patch };
  delete safePatch.content;
  delete safePatch.coreadMessages;
  Object.assign(book, safePatch);
  if (typeof saveStudyBookToDB === 'function') await saveStudyBookToDB(book);
  return book;
}

function getAllStudyBooks() {
  return db.studyBooks || [];
}

// ── Questions ──────────────────────────────────────

async function saveStudyQuestion(question) {
  const newQ = { ...question, id: _genStudyId('q'), createdAt: Date.now() };
  db.studyQuestions.push(newQ);
  await saveStudyQuestionToDB(newQ);
  return newQ;
}

// 生成题库时批量保存，减少 IDB 事务数
async function bulkSaveStudyQuestions(questions) {
  db.studyQuestions.push(...questions);
  await bulkSaveStudyQuestionsToDB(questions);
}

async function deleteStudyQuestion(qId) {
  db.studyQuestions = db.studyQuestions.filter(q => q.id !== qId);
  await deleteStudyQuestionFromDB(qId);
}

function getQuestionsByBook(bookId) {
  return (db.studyQuestions || []).filter(q => q.bookId === bookId);
}

function getAllStudyQuestions() {
  return db.studyQuestions || [];
}

// ── Records ────────────────────────────────────────

async function saveStudyRecord(record) {
  const newRec = { ...record, id: _genStudyId('rec'), date: Date.now() };
  db.studyRecords.push(newRec);
  await saveStudyRecordToDB(newRec);
  return newRec;
}

function getAllStudyRecords() {
  return db.studyRecords || [];
}

function getRecordsByBook(bookId) {
  return (db.studyRecords || []).filter(r => r.bookId === bookId);
}

function getRecordsByQuestion(qId) {
  return (db.studyRecords || []).filter(r => r.questionId === qId);
}

// ── Study Settings (绑定人设 / API预设) ──────────────

function getStudySettings() {
  return db.studySettings || {
    boundPersonaId: null,
    textApiPresetName: null,
    embeddingApiPresetName: null,
    homeName: null,
    homeGreeting: null,
  };
}

async function updateStudySettings(patch) {
  db.studySettings = { ...getStudySettings(), ...patch };
  await saveStudySettingsToDB();
}

// 从 db.userPersonas 取出当前绑定的人设对象（没绑定返回 null）
function getStudyBoundPersona() {
  const { boundPersonaId } = getStudySettings();
  if (!boundPersonaId) return null;
  return (db.userPersonas || []).find(p => p.id === boundPersonaId) || null;
}

// ── Banks ───────────────────────────────────────────────────

async function saveStudyBank(name) {
  const bank = { id: `bank_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`, name, createdAt: Date.now() };
  db.studyBanks = db.studyBanks || [];
  db.studyBanks.push(bank);
  await saveStudyBankToDB(bank);
  return bank;
}

async function updateStudyBankMeta(bankId, patch) {
  db.studyBanks = db.studyBanks || [];
  const bank = db.studyBanks.find(b => b.id === bankId);
  if (!bank) return null;
  Object.assign(bank, patch);
  await saveStudyBankToDB(bank);
  return bank;
}

async function deleteStudyBank(bankId) {
  db.studyBanks     = (db.studyBanks     || []).filter(b => b.id !== bankId);
  db.studyQuestions = (db.studyQuestions || []).filter(q => q.bankId !== bankId);
  await deleteStudyBankFromDB(bankId);
}

function getAllStudyBanks() {
  return db.studyBanks || [];
}

function getQuestionsByBank(bankId) {
  return (db.studyQuestions || []).filter(q => q.bankId === bankId);
}

// ── Questions 扩展 ───────────────────────────────────────────

// 批量保存（带 bankId）
async function bulkSaveBankQuestions(questions) {
  db.studyQuestions = db.studyQuestions || [];
  db.studyQuestions.push(...questions);
  await bulkSaveStudyQuestionsToDB(questions);
}

// 更新单题（含 analysis 字段）
async function updateStudyQuestion(qId, patch) {
  const q = (db.studyQuestions || []).find(q => q.id === qId);
  if (!q) return null;
  Object.assign(q, patch);
  await updateStudyQuestionToDB(q);
  return q;
}

// 删除单题（bankId 版）
async function deleteBankQuestion(qId) {
  db.studyQuestions = (db.studyQuestions || []).filter(q => q.id !== qId);
  await deleteStudyQuestionFromDB(qId);
}

// ── Exams ────────────────────────────────────────────────────

async function saveStudyExam(exam) {
  const newExam = {
    ...exam,
    id:        `exam_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    createdAt: Date.now(),
  };
  db.studyExams = db.studyExams || [];
  db.studyExams.push(newExam);
  await dexieDB.studyExams.put(newExam);
  return newExam;
}

async function updateStudyExam(examId, patch) {
  db.studyExams = db.studyExams || [];
  const exam = db.studyExams.find(e => e.id === examId);
  if (!exam) return null;
  Object.assign(exam, patch);
  await dexieDB.studyExams.put(exam);
  return exam;
}

async function deleteStudyExam(examId) {
  db.studyExams = (db.studyExams || []).filter(e => e.id !== examId);
  await dexieDB.studyExams.delete(examId);
  await deleteExamRecordsByExam(examId); 
}

function getAllStudyExams() {
  return db.studyExams || [];
}

// ════════════════════════════════════════════════════════════════

// ── ExamRecords ──────────────────────────────────────────────────

/**
 * 创建一条考试记录（开始考试时调用）
 * record 参数：{ examId, questions }
 */
async function saveExamRecord(record) {
  const newRec = {
    ...record,
    id:        `erec_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    startedAt: Date.now(),
    finishedAt: null,
    status:    'in_progress',
    answers:   {},
    results:   {},
    score:     null,
  };
  db.studyExamRecords = db.studyExamRecords || [];
  db.studyExamRecords.push(newRec);
  await dexieDB.studyExamRecords.put(newRec);
  return newRec;
}

/**
 * 更新考试记录（存答案、写批改结果、改状态）
 */
async function updateExamRecord(recordId, patch) {
  db.studyExamRecords = db.studyExamRecords || [];
  const rec = db.studyExamRecords.find(r => r.id === recordId);
  if (!rec) return null;
  Object.assign(rec, patch);
  await dexieDB.studyExamRecords.put(rec);
  return rec;
}

/**
 * 删除单条考试记录
 */
async function deleteExamRecord(recordId) {
  db.studyExamRecords = (db.studyExamRecords || []).filter(r => r.id !== recordId);
  await dexieDB.studyExamRecords.delete(recordId);
}

/**
 * 删除某考卷的全部记录（deleteStudyExam 时级联调用）
 */
async function deleteExamRecordsByExam(examId) {
  const toDelete = (db.studyExamRecords || []).filter(r => r.examId === examId).map(r => r.id);
  db.studyExamRecords = (db.studyExamRecords || []).filter(r => r.examId !== examId);
  if (toDelete.length) await dexieDB.studyExamRecords.bulkDelete(toDelete);
}

/**
 * 获取某考卷的全部记录（按开始时间倒序）
 */
function getExamRecordsByExam(examId) {
  return (db.studyExamRecords || [])
    .filter(r => r.examId === examId)
    .sort((a, b) => b.startedAt - a.startedAt);
}