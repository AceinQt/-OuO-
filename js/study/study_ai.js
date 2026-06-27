// study_ai.js — 学习模块 AI 调用层
// =====================================================

/**
 * 获取学习功能当前应使用的 chat 预设数据。
 * 优先级：学习侧边栏选定预设 > 全局默认预设 > db.apiSettings 旧结构
 */
function _getStudyApiConfig() {
  const settings    = getStudySettings();
  const presetName  = settings.textApiPresetName;
  const allPresets  = db.apiPresets || [];

  if (presetName) {
    const preset = allPresets.find(p => p.name === presetName && (!p.type || p.type === 'chat'));
    if (preset?.data) return preset.data;
  }

  const globalActive = db.apiSettings?.activePreset;
  if (globalActive) {
    const preset = allPresets.find(p => p.name === globalActive && (!p.type || p.type === 'chat'));
    if (preset?.data) return preset.data;
  }

  return db.apiSettings || {};
}

/**
 * 读取 SSE 流，每个 delta chunk 调用 onChunk，最终返回完整文本。
 */
async function _readStream(response, onChunk) {
  const reader  = response.body.getReader();
  const decoder = new TextDecoder();
  let full = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === 'data: [DONE]') continue;
      if (trimmed.startsWith('data: ')) {
        try {
          const json  = JSON.parse(trimmed.slice(6));
          const chunk = json.choices?.[0]?.delta?.content || '';
          if (chunk) { full += chunk; onChunk(chunk); }
        } catch { /* 忽略格式异常行 */ }
      }
    }
  }
  return full;
}

/**
 * 统一 AI 调用入口。
 */
async function callAI(prompt, options = {}) {
  const cfg = _getStudyApiConfig();
  const url   = cfg.url || cfg.apiUrl || '';
  const key   = cfg.key || cfg.apiKey || '';
  const model = cfg.model || '';
  const temperature = cfg.temperature !== undefined ? Number(cfg.temperature) : 0.8;

  if (!url || !key || !model) throw new Error('API 未配置，请在学习设置中选择预设或前往 API 设置页配置全局默认');

  const useStream = cfg.streamEnabled !== false && typeof options.onStream === 'function';

  const messages = [];
  if (options.systemPrompt) messages.push({ role: 'system', content: options.systemPrompt });
  messages.push({ role: 'user', content: prompt });

  const response = await fetch(`${url}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${key}`
    },
    body: JSON.stringify({ model, messages, temperature, stream: useStream })
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`API 请求失败 (${response.status})${errText ? ': ' + errText : ''}`);
  }

  if (useStream) {
    return _readStream(response, options.onStream);
  } else {
    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  }
}

// ── 构建角色人设 system prompt（供多处复用）──────────────────────
/**
 * 根据 charId 和 worldbookIds 构建 systemPrompt 字符串。
 * @returns {string|undefined}
 */
function _buildGraderSystemPrompt(charId, worldbookIds = [], personaId = '') {
  // ── 按 position 分组世界书 ──
  const allWbs   = db.worldBooks || [];

  const _wbText = (wb) => {
    if (wb.entries?.length) {
      return wb.entries
        .filter(e => e.enabled !== false)
        .map(e => e.content || '')
        .filter(Boolean)
        .join('\n');
    }
    return wb.content || '';
  };

  const wbBefore = worldbookIds
    .map(id => allWbs.find(w => w.id === id))
    .filter(w => w && w.position !== 'after')   // 无 position 或 before 都算前置
    .map(_wbText).filter(Boolean).join('\n\n');

  const wbAfter = worldbookIds
    .map(id => allWbs.find(w => w.id === id))
    .filter(w => w?.position === 'after')
    .map(_wbText).filter(Boolean).join('\n\n');

  // ── 提取角色 & 用户信息 ──
  let charName    = '助手';
  let charPersona = '';
  let userName    = db.settings?.userNickname || '同学';
  let userDesc    = '';

  if (charId) {
    const char = (db.characters || []).find(c => c.id === charId);
    if (char) {
      charName    = char.realName || char.remarkName || char.name || '助手';
      charPersona = char.persona || char.description || char.system || char.setting || char.prompt || '';
    }
  }

  if (personaId) {
    const persona = (db.userPersonas || []).find(p => (p.id || p.nickname) === personaId);
    if (persona) {
      userName = persona.realName || persona.nickname || userName;
      userDesc = persona.persona || '';
    }
  }

  let prompt = '';

  // ① 情境描述（置顶）
  prompt += `你（${charName}）正在帮我（${userName}）批改答题、讲解知识点。\n\n`;

  // ② 前置世界书
  if (wbBefore) prompt += `【世界观】\n${wbBefore}\n\n`;

  // ③ 角色人设
  prompt += `【人设信息】\n`;
  prompt += `你的姓名是：${charName}。\n`;
  if (charPersona) prompt += `\n你的人设是：\n${charPersona}\n\n`;
  else prompt += '\n';

  // ④ 用户人设
  prompt += `我的姓名是：${userName}。\n`;
  if (userDesc) prompt += `我的人设是：\n${userDesc}\n\n`;

  // ⑤ 后置世界书
  if (wbAfter) prompt += `【其他重要事项说明】\n${wbAfter}\n\n`;

  return prompt.trimEnd();
}

// ── 生成题库 ─────────────────────────────────────────────────────
async function generateStudyQuestions(content, count, typePreference = 'mixed') {
  const typeDesc =
    typePreference === 'choice' ? '全部为选择题（客观题）' :
    typePreference === 'qa'     ? '全部为问答题（主观题）' :
    '选择题和问答题混合，尽量各占一半';

  const prompt =
`请根据以下教材内容，生成 ${count} 道题目，类型要求：${typeDesc}。
以 JSON 数组格式返回，每个对象包含：
- type: "choice" 或 "qa"
- question: 题目文本
- options: 选择题为 ["A. ...", "B. ...", "C. ...", "D. ..."]（四个选项），问答题为 null
- answer: 选择题为 "A"/"B"/"C"/"D"，问答题为完整答案文本
- analysis: 简短解析说明（1-2句），可为空字符串

只返回 JSON 数组，不要有任何多余文字、注释或 markdown 代码块。

教材内容：
${content.substring(0, 15000)}`;

  const text = await callAI(prompt);
  try {
    const clean = text.replace(/```json|```/g, '').trim();
    const result = JSON.parse(clean);
    if (!Array.isArray(result)) throw new Error('返回格式不是数组');
    return result;
  } catch (e) {
    console.error('[generateStudyQuestions] parse error', e, text);
    throw new Error('AI 返回格式有误，请重试');
  }
}

// ── 解析 #GRADE / #ANALYSIS 标签格式 ────────────────────────────
/**
 * 从 AI 返回的原始文本里提取批改结论和分析正文。
 * @returns {{ grade: {correct, comment}|null, analysisText: string }}
 */
function _parseGradeAndAnalysis(text) {
  const gradeMatch    = text.match(/#GRADE\s*(true|false)/i);
  const analysisMatch = text.match(/#ANALYSIS\s*([\s\S]*)$/i);

  const correct      = gradeMatch ? gradeMatch[1].toLowerCase() === 'true' : null;
  const analysisText = analysisMatch ? analysisMatch[1].trim() : text.trim();
  return { correct, analysisText };
}

// ── 逐题详细分析（流式，用于答题后底部弹窗）────────────────────
/**
 * 选择题：直接解析知识点（返回纯文本）。
 * 主观题：同时返回批改结论（#GRADE）和分析正文（#ANALYSIS），
 *         用 _parseGradeAndAnalysis() 解析。
 *
 * @param {object} q           - 题目对象 {type, question, options, answer}
 * @param {string} userAnswer  - 用户作答
 * @param {object} options     - {charId, worldbookIds, onStream}
 * @returns {Promise<string>}  完整原始文本
 */
async function analyzeStudyQuestion(q, userAnswer, options = {}) {
  const { charId, worldbookIds = [], personaId = '', onStream } = options;
  const systemPrompt = _buildGraderSystemPrompt(charId, worldbookIds, personaId);

  const isChoice = q.type === 'choice';

  let prompt;
  if (isChoice) {
    const optionsText = (q.options || [])
      .map((opt, i) => `${String.fromCharCode(65 + i)}. ${opt}`)
      .join('\n');
    prompt =
`题目：${q.question}
${optionsText ? `选项：\n${optionsText}\n` : ''}正确答案：${q.answer}
我的选择：${userAnswer || '（未作答）'}

请用你自己的方式帮我讲解一下：为什么正确答案是 ${q.answer}？涉及哪些知识点？如果有常见误区也可以帮我指出来。`;
  } else {
prompt =
`题目：${q.question}

标准答案：${q.answer}
我的回答：${userAnswer || '（未作答）'}

请帮我批改这道题，格式严格如下（不要输出任何额外文字）：

#GRADE
true 或 false（仅此一词，表示我的回答是否正确）
#ANALYSIS
（用你自己的方式，结合人设语气，详细评点我的回答，补充相关知识点，给出改进建议）`;
  }

  return callAI(prompt, { systemPrompt, onStream });
}
