// ============================================================
// chat_voice_settings.js — 聊天级语音设置（音色 + 通话语音 + 语气要求）
// ============================================================
// 侧栏上只占一行「语音」，点开是折叠式弹窗，和图像生成那套（chat_image_settings.js
// + #image-generation-modal）刻意同构：私聊侧栏和群聊侧栏共用同一个弹窗。
//
// ★ 这一行下面挂着三个**性质完全不同**的旋钮，合并只是 UI 上的，语义不能混：
//
//   ① 音色（voicePresetId）→ TTS 层。选哪条预设去合成音频，Key/地址/语速/音调
//      都在那条预设里（见 tts_api.js）。花钱的是这个。
//   ② 通话语音（callVoiceEnabled）→ 也是 TTS 层，但只管通话界面：打开后通话中
//      对方的每句台词都自动合成并连播。逻辑全在 chat_voice_call.js，这里只是
//      **第二个入口**。第一个入口是通话界面顶部工具箱那颗 #call-voice-btn ——
//      它的问题是必须先拨通才够得着，等翻出工具箱点开，开头几句已经出完了。
//      两个入口写的是同一个字段，谁也不是谁的副本。
//   ③ 语气要求（voiceTonePrompt）→ 语言模型层。约束模型**怎么写语音消息的文字**，
//      一个字都不进 TTS 请求。
//
//   为什么语气不做进 TTS：「声音描述」拌进 text_prompt 收益不稳定，还挤占台词
//   字数（原因见 tts_api.js 顶部）。但语气本身要能调，只是该在文字层调 —— 让模型
//   写出"慵懒、带语气词"的句子，比让 TTS 去演绎一句书面语可靠得多。
//
// 语气要求按聊天存（角色 / 群各一份），和图像的 imageContentRule 同一套路：
//   · 空值 = 一个字都不注入，提示词和没这功能时逐字符一致
//   · 只约束语音消息的文字，不影响普通消息
//
// ★ 注入的那句提示词只在这个文件里定义一次（buildVoiceTonePromptLine），
//   private_prompt.js 和 group_prompt.js 都来调。两边各抄一份的话，改了一处忘了
//   另一处，表现是"私聊语气对了群聊没对"，而且完全静默 —— 项目里那两个 prompt
//   文件的字符串已经有好几处这种手抄漂移了，这个不再加一处。
//
// 群聊只有语气，没有群级音色：音色是按成员选的（群成员编辑弹窗里那个下拉），
// 所以弹窗在群模式下把音色那节换成一句指路说明 —— 用户一定会先来这里找音色。
// 通话那一节在群模式下**整块隐掉**：通话只支持私聊（chat_voice_call.js 里写死
// 'private'），给群对象写个 callVoiceEnabled 只会是个没人读的字段。
//
// 对外符号：
//   VOICE_TONE_MAX_CHARS
//   normalizeChatVoiceBinding / normalizeVoiceTonePrompt
//   formatVoiceSettingLabel / voiceSettingRowFlags / formatVoiceToneOnlyLabel
//   openVoiceSettingDialog
//   buildVoiceTonePromptLine
// ============================================================

// 上限 300 字，同图像的「内容约束」（弹窗里那个 textarea 也是 maxlength=300）。
// 语气要求是每轮都注入的常驻提示词，写太长会持续占掉上下文预算。
const VOICE_TONE_MAX_CHARS = 300;

/** 折叠面板的展开/收起只绑一次，别每次开弹窗都摞一层监听。 */
let _voiceModalEventBound = false;

/** 没选音色一律落到"不使用语音"，绝不借用什么全局默认替用户花钱。 */
function _voiceBindingOffValue() {
    return typeof VOICE_PRESET_OFF === 'string' ? VOICE_PRESET_OFF : 'off';
}

/**
 * 取一个聊天对象上的语气要求。
 * 所有读这个字段的地方都过这一层，别直接摸 chat.voiceTonePrompt —— 可能是
 * undefined（没设过）、也可能是别处塞进来的非字符串。
 * @param {object} chat 角色对象或群对象
 * @returns {string} 已 trim；'' = 不注入
 */
function normalizeVoiceTonePrompt(chat) {
    const raw = (chat && chat.voiceTonePrompt) || '';
    return String(raw).trim().slice(0, VOICE_TONE_MAX_CHARS);
}

/**
 * 归一化一个聊天（私聊角色 / 群）身上的语音绑定。
 * @returns {{voicePresetId: string, callVoiceEnabled: boolean, voiceTonePrompt: string}}
 */
function normalizeChatVoiceBinding(chat, settings) {
    const source = chat || {};
    const off = _voiceBindingOffValue();
    const wanted = String(source.voicePresetId || '').trim();
    // 悬空 id（预设被删了）和空值一样落回不使用，不留幽灵选项
    const resolved = wanted && wanted !== off && typeof getVoicePreset === 'function'
        ? getVoicePreset(wanted, settings)
        : null;

    return {
        voicePresetId: resolved ? resolved.id : off,
        // 这里只如实反映开关本身，**不判断此刻能不能真出声** —— 那是
        // chat_voice_call.js 的 isCallVoiceOn 干的活（还要看语音总开关和 Key）。
        // 两处都判的话，用户关掉总开关再打开，这个字段就被静默改写成 false 了。
        callVoiceEnabled: !!source.callVoiceEnabled,
        voiceTonePrompt: normalizeVoiceTonePrompt(source)
    };
}

/**
 * 私聊侧栏那一行右边显示什么。**只有音色名，没有任何后缀。**
 *
 * ★ 通话开关和语气要求不写成「· 通话出声 · 已设语气」这种文字后缀：那一行左边
 *   已经占了图标 + 标题，`.item-value` 又不收缩，两个中文后缀叠上去会把整行挤变形。
 *   它们改由两枚小图标表示，亮不亮看 voiceSettingRowFlags。
 * ★ 也不显示语气内容本身的截断预览：语气要求经常以"用……的语气"开头，前十几个字
 *   几乎每条都一样，截出来的预览分辨不出任何信息，只是把行挤长。
 */
function formatVoiceSettingLabel(binding, settings) {
    const off = _voiceBindingOffValue();
    const normalized = normalizeChatVoiceBinding(binding, settings);

    if (normalized.voicePresetId === off) return '不使用语音';
    if (typeof getVoicePreset !== 'function') return '未配置';
    const preset = getVoicePreset(normalized.voicePresetId, settings);
    return preset ? preset.name : '不使用语音';
}

/**
 * 侧栏那一行右边两枚小图标各自亮不亮。**判定只在这里写一次**，
 * 和上面的文案规则挨着 —— 分开放的话，改了"什么时候算开着"很容易漏掉一边。
 *
 * ★ 两枚的规则**故意不一样**，别顺手统一：
 *   · 语气不依赖 TTS（是给语言模型的），所以音色关着它照样亮 —— 否则用户
 *     会以为自己设的语气没生效。
 *   · 通话出声要花钱合成，没音色就合不出来，这时候亮着是骗人的。
 *
 * @returns {{call: boolean, tone: boolean}}
 */
function voiceSettingRowFlags(binding, settings) {
    const off = _voiceBindingOffValue();
    const normalized = normalizeChatVoiceBinding(binding, settings);
    return {
        call: normalized.callVoiceEnabled && normalized.voicePresetId !== off,
        tone: !!normalized.voiceTonePrompt
    };
}

/** 群聊侧栏那一行：群级只有语气，音色是按成员选的。 */
function formatVoiceToneOnlyLabel(chat) {
    return normalizeVoiceTonePrompt(chat) ? '已设语气' : '未设语气';
}

/**
 * 通话那一节的说明行：开关关着讲它是干嘛的，开着就如实说现在还差什么。
 *
 * ★ 缺什么的判定**复用 chat_voice_call.js 的 callVoiceBlockReason**，不在这儿
 *   重抄一遍条件（语音总开关、Key 填没填、音色 id 悬没悬空）。那边加一条新条件
 *   而这边忘了跟，症状是"提示说没问题、打通了却不出声"，完全静默。
 * ★ 唯独"没选音色"这条要自己写：那边的原话是"在聊天设置的「语音」里选一个"，
 *   而用户此刻正站在那个弹窗里，照搬就成了指着自己让用户去找自己。
 * ★ 传的是 `{ voicePresetId }` 这个**弹窗里的草稿值**，不是 db 里那份 ——
 *   用户很可能刚在上面那一节改完音色还没保存。
 */
function _syncCallVoiceHint(presetId, on) {
    const hint = document.getElementById('voice-setting-call-hint');
    if (!hint) return;

    const base = '开启后，语音/视频通话里对方说的每句话都会自动合成并播放。'
        + '关着也照样存成语音条，事后能手动点播放。';
    if (!on) { hint.textContent = base; return; }

    const off = _voiceBindingOffValue();
    if (!presetId || presetId === off) {
        hint.textContent = '现在还出不了声：上面的「音色」是不使用语音，先选一个。';
        return;
    }
    const reason = typeof callVoiceBlockReason === 'function'
        ? callVoiceBlockReason({ voicePresetId: presetId })
        : '';
    hint.textContent = reason ? `现在还出不了声：${reason}` : base;
}

/**
 * 打开语音设置弹窗（私聊 / 群聊共用 index.html 里那个静态 #voice-setting-modal）。
 *
 * @param {object} current 当前绑定 { voicePresetId, callVoiceEnabled, voiceTonePrompt }
 * @param {object} opts    { includePreset } —— 群聊传 false：群里没有群级音色，
 *                         音色那节换成一句"去成员编辑里选"的说明，通话那节整块隐掉
 * @returns {Promise<object|null>} null = 用户取消，调用方一个字段都不要写；
 *          非空 = 要写回聊天的字段（群模式下不含 voicePresetId / callVoiceEnabled）
 */
async function openVoiceSettingDialog(current = {}, { includePreset = true } = {}) {
    const modal = document.getElementById('voice-setting-modal');
    const presetSel = document.getElementById('voice-setting-preset');
    const presetBlock = document.getElementById('voice-setting-preset-block');
    const groupHint = document.getElementById('voice-setting-preset-group-hint');
    const callBlock = document.getElementById('voice-setting-call-block');
    const callEl = document.getElementById('voice-setting-call');
    const toneEl = document.getElementById('voice-setting-tone');
    const confirmBtn = document.getElementById('voice-setting-confirm');
    const cancelBtn = document.getElementById('voice-setting-cancel');
    if (!modal || !confirmBtn || !cancelBtn) return null;

    if (!_voiceModalEventBound) {
        modal.addEventListener('click', (e) => {
            const header = e.target.closest && e.target.closest('.collapsible-header');
            if (header) header.parentElement.classList.toggle('open');
        });
        _voiceModalEventBound = true;
    }

    // 每次开弹窗都把折叠状态复位成「只展开音色」。
    // ★ 不能只靠 index.html 里写死的 class：`open` 是上面那个监听运行时 toggle 上去的，
    //   而弹窗是全局共用的同一份 DOM、从不重建 —— 光改 HTML 的话"默认只展开音色"
    //   只在页面加载后第一次打开成立，用户手动展开过一次通话语音，之后每次打开都是展开的。
    // ★ 群聊那一节顶替音色的位置（见 includePreset），所以它也算"第一项"，一起展开。
    modal.querySelectorAll('.collapsible-section').forEach(section => {
        section.classList.toggle('open',
            section.id === 'voice-setting-preset-block' ||
            section.id === 'voice-setting-preset-group-hint');
    });

    const binding = normalizeChatVoiceBinding(current);
    const off = _voiceBindingOffValue();

    // 音色那一节：私聊给下拉，群聊给指路说明。三块都在 DOM 里静态存在，
    // 这里只切 display —— 弹窗是两边共用的，上次开的是哪种模式不能留痕。
    if (presetBlock) presetBlock.style.display = includePreset ? 'block' : 'none';
    if (groupHint) groupHint.style.display = includePreset ? 'none' : 'block';
    if (callBlock) callBlock.style.display = includePreset ? 'block' : 'none';

    if (includePreset && presetSel && typeof getVoicePresetOptions === 'function') {
        presetSel.innerHTML = '';
        getVoicePresetOptions().forEach(option => {
            const opt = document.createElement('option');
            opt.value = option.value;
            opt.textContent = option.label;
            presetSel.appendChild(opt);
        });
        presetSel.value = Array.from(presetSel.options).some(o => o.value === binding.voicePresetId)
            ? binding.voicePresetId
            : off;
    }

    if (callEl) callEl.checked = binding.callVoiceEnabled;
    if (toneEl) toneEl.value = binding.voiceTonePrompt;
    if (includePreset) {
        _syncCallVoiceHint(presetSel ? presetSel.value : binding.voicePresetId, binding.callVoiceEnabled);
    }

    return new Promise(resolve => {
        // 音色和开关任意一个动了都要重算：提示行说的是"这两个凑在一起现在通不通"
        const onSync = () => _syncCallVoiceHint(
            presetSel ? presetSel.value : '', !!(callEl && callEl.checked));

        const onConfirm = () => {
            // 取值必须在 cleanup 之前读
            const tone = toneEl ? toneEl.value.trim().slice(0, VOICE_TONE_MAX_CHARS) : '';
            const chosen = (includePreset && presetSel) ? (presetSel.value || off) : null;
            const call = includePreset ? !!(callEl && callEl.checked) : null;
            cleanup();
            // 群模式压根不带 voicePresetId / callVoiceEnabled 这两个键：带上去（哪怕是
            // off / false）就会把群对象写出没人读的字段，日后有人顺手拿它当"群级音色"
            // 或"群通话开关"用就出错了
            const result = { voiceTonePrompt: tone };
            if (chosen !== null) result.voicePresetId = chosen;
            if (call !== null) result.callVoiceEnabled = call;
            resolve(result);
        };

        const onCancel = () => {
            cleanup();
            resolve(null);
        };

        function cleanup() {
            modal.classList.remove('visible');
            if (presetSel) presetSel.removeEventListener('change', onSync);
            if (callEl) callEl.removeEventListener('change', onSync);
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
        }

        if (presetSel) presetSel.addEventListener('change', onSync);
        if (callEl) callEl.addEventListener('change', onSync);
        confirmBtn.addEventListener('click', onConfirm);
        cancelBtn.addEventListener('click', onCancel);
        modal.classList.add('visible');
    });
}

/**
 * 拼出要注入提示词的那一句。**这是唯一一处定义这句话的地方。**
 *
 * ★ 句子里不重复写占位符名（私聊是 {语音内容}、群聊是 {语音转述的文字}）——
 *   只在 voiceFormat 里出现一次。早先的版本两处都写死成 {语音内容}，
 *   群聊那条就会指着一个它自己格式里根本不存在的占位符。
 *
 * @param {object} chat        角色对象或群对象
 * @param {string} voiceFormat 该场景下语音消息的格式样例，用于让模型知道这条
 *                             约束挂在哪个格式上（私聊和群聊的格式不同）
 * @returns {string} '' = 不注入（没设过语气要求）。非空时自带结尾换行，
 *                   调用方直接 `prompt += ` 即可。
 */
function buildVoiceTonePromptLine(chat, voiceFormat) {
    const tone = normalizeVoiceTonePrompt(chat);
    if (!tone) return '';
    return `**语音消息的语气要求**：当你使用 ${voiceFormat} 格式时，` +
        `里面那句话的说话方式必须遵守：${tone}。` +
        `这条只约束语音消息怎么说，不影响普通文字消息。\n`;
}
