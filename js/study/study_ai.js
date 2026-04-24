// study_ai.js — 学习模块 AI 调用层
// =====================================================

/**
 * 获取学习功能当前应使用的 chat 预设数据。
 * 优先级：学习侧边栏选定预设 > 全局默认预设 > db.apiSettings 旧结构
 * 返回一个包含 url/key/model/temperature/streamEnabled 的对象。
 */
function _getStudyApiConfig() {
  const settings    = getStudySettings();
  const presetName  = settings.textApiPresetName;
  const allPresets  = db.apiPresets || [];

  // 1. 学习模块指定了预设
  if (presetName) {
    const preset = allPresets.find(p => p.name === presetName && (!p.type || p.type === 'chat'));
    if (preset?.data) return preset.data;
  }

  // 2. 全局默认预设（db.apiSettings.activePreset）
  const globalActive = db.apiSettings?.activePreset;
  if (globalActive) {
    const preset = allPresets.find(p => p.name === globalActive && (!p.type || p.type === 'chat'));
    if (preset?.data) return preset.data;
  }

  // 3. 旧结构兜底（未迁移的用户）
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
 *
 * @param {string} prompt         - user 消息
 * @param {object} [options]
 * @param {string} [options.systemPrompt] - system 消息（可选）
 * @param {function} [options.onStream]   - 流式 chunk 回调；存在且预设启用流式时启用
 * @returns {Promise<string>} 完整回复文本
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

// ── 生成题库 ─────────────────────────────────────────────────────
async function generateStudyQuestions(content, count) {
  const prompt =
`请根据以下教材内容，生成 ${count} 道题目，要求选择题和问答题混合。
以 JSON 数组格式返回，每个对象包含：
- type: "choice" 或 "qa"
- question: 题目文本
- options: 选择题为 ["A. ...", "B. ...", "C. ...", "D. ..."]，问答题为 null
- answer: 选择题为 "A"/"B"/"C"/"D"，问答题为完整答案文本

只返回 JSON，不要有任何多余文字。

教材内容：
${content.substring(0, 15000)}`;

  const text = await callAI(prompt);
  try {
    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch (e) {
    console.error('[generateStudyQuestions] parse error', e, text);
    throw new Error('AI 返回格式有误，请重试');
  }
}

// ── 批改问答题 ────────────────────────────────────────────────────
async function gradeStudyAnswer(correctAnswer, userAnswer) {
  const prompt =
`标准答案：${correctAnswer}
用户回答：${userAnswer}

请判断用户回答是否正确（包含关键要点即可），并以角色口吻给出简短评语。
返回 JSON：{ "correct": true/false, "comment": "角色评语" }
只返回 JSON，不要有多余文字。`;

  const text = await callAI(prompt);
  try {
    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch (e) {
    console.error('[gradeStudyAnswer] parse error', e, text);
    return { correct: false, comment: '批改出错了，请稍后再试。' };
  }
}