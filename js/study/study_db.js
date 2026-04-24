// study_db.js — 学习模块数据层
// 操作 window.db 内存对象 + 同步到 dexieDB（精准保存）
// 所有写操作为 async；读操作为同步（直接读内存）
// =====================================================

function _genStudyId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

// ── Books ──────────────────────────────────────────

async function saveStudyBook(book) {
  const newBook = { ...book, id: _genStudyId('book'), createdAt: Date.now() };
  db.studyBooks.push(newBook);
  await saveStudyBookToDB(newBook);
  return newBook;
}

async function deleteStudyBook(bookId) {
  db.studyBooks     = db.studyBooks.filter(b => b.id !== bookId);
  db.studyQuestions = db.studyQuestions.filter(q => q.bookId !== bookId);
  db.studyRecords   = db.studyRecords.filter(r => r.bookId !== bookId);
  await deleteStudyBookFromDB(bookId); // 一次性清理三张表
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
  return db.studySettings || { boundPersonaId: null, textApiPresetName: null, embeddingApiPresetName: null };
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
