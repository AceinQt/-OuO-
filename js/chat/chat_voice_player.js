// ============================================================
// chat_voice_player.js — 语音气泡的播放与状态显示
// ============================================================
// 整个语音功能里**只有这个文件认识 DOM**。字节从哪来、要不要合成、归档去哪，
// 全在 js/chat/chat_voice_service.js；这里只负责"按钮长什么样、什么时候出声"。
//
// 气泡状态机（写在按钮的 data-voice-state 上，CSS 据此换图标）：
//   idle     还没音频。点了才会去合成（要等 20 秒以上，也才会花钱）
//   loading  正在合成或从云端下载
//   ready    本地有音频，随时能播
//   playing  正在播
//   failed   出错了，点一下重试；具体原因在 title 里
//
// ★ 全局只有一个 <audio>。多个 audio 同时播在移动端会互相掐，
//   而且每个 blob URL 都得手动回收，多实例必然漏。
//
// 对外符号：
//   handleVoiceBubbleClick / refreshVoiceBubbleState / toggleVoiceTranscript
//   stopVoicePlayback / regenerateVoiceClip / downloadVoiceClip
// ============================================================

// ── 播放器单例 ────────────────────────────────────────────────
let _voiceAudioEl = null;
let _voiceCurrentUrl = '';       // 当前 blob URL，换曲/停止时必须 revoke
let _voiceCurrentBtn = null;     // 当前正在播的那个按钮，用来复原状态
let _voiceRafId = 0;             // 进度动画的 rAF 句柄

function _getVoiceAudio() {
    if (_voiceAudioEl) return _voiceAudioEl;
    const el = new Audio();
    el.preload = 'auto';
    // 不加 playsinline 的话 iOS 可能弹全屏播放器
    el.setAttribute('playsinline', '');
    el.setAttribute('webkit-playsinline', '');
    el.addEventListener('ended', () => _finishVoicePlayback(false));
    el.addEventListener('error', () => _finishVoicePlayback(true));
    el.addEventListener('timeupdate', _paintVoiceProgress);
    _voiceAudioEl = el;
    return el;
}

/** 收尾：复原按钮、回收 blob、把保活还回去 */
function _finishVoicePlayback(errored) {
    if (_voiceRafId) { cancelAnimationFrame(_voiceRafId); _voiceRafId = 0; }
    if (_voiceCurrentBtn) {
        _setVoiceBubbleState(_voiceCurrentBtn, errored ? 'failed' : 'ready',
            errored ? { message: '播放失败，点一下重试' } : {});
        _paintVoiceProgress(0);
        _voiceCurrentBtn = null;
    }
    if (_voiceCurrentUrl) {
        URL.revokeObjectURL(_voiceCurrentUrl);
        _voiceCurrentUrl = '';
    }
    if (typeof resumeKeepAliveAfterPlayback === 'function') resumeKeepAliveAfterPlayback();
}

/** 停止当前播放（换一条、离开聊天页时调） */
function stopVoicePlayback() {
    if (!_voiceAudioEl) return;
    _voiceAudioEl.pause();
    _voiceAudioEl.removeAttribute('src');
    _finishVoicePlayback(false);
}

// ── 波形进度 ──────────────────────────────────────────────────

/**
 * 按播放进度点亮波形竖条。
 * 用 rAF 而不是只靠 timeupdate —— timeupdate 在移动端大约 4 次/秒，
 * 那样波形是一格一格跳的，看着像卡住了。
 */
function _paintVoiceProgress(forceRatio) {
    if (!_voiceCurrentBtn) return;
    const bubble = _voiceCurrentBtn.closest('.voice-bubble');
    const wave = bubble && bubble.querySelector('.voice-wave');
    if (!wave) return;

    let ratio;
    if (typeof forceRatio === 'number') {
        ratio = forceRatio;
    } else {
        const el = _voiceAudioEl;
        const total = el && el.duration;
        ratio = (total && isFinite(total) && total > 0) ? (el.currentTime / total) : 0;
    }
    wave.style.setProperty('--voice-progress', `${Math.max(0, Math.min(1, ratio)) * 100}%`);

    if (_voiceAudioEl && !_voiceAudioEl.paused && typeof forceRatio !== 'number') {
        _voiceRafId = requestAnimationFrame(() => _paintVoiceProgress());
    }
}

// ── 气泡状态 ──────────────────────────────────────────────────

/**
 * 设置气泡状态。
 * @param {HTMLElement} btn 播放按钮
 * @param {string} state idle | loading | ready | playing | failed
 * @param {object} [opts] { message 失败原因, duration 真实时长 }
 */
function _setVoiceBubbleState(btn, state, opts = {}) {
    if (!btn) return;
    btn.dataset.voiceState = state;
    btn.disabled = state === 'loading';
    const label = {
        idle: '播放语音（首次需要合成，约 20 秒）',
        loading: '正在准备…',
        ready: '播放语音',
        playing: '停止播放',
        failed: opts.message || '出错了，点一下重试'
    }[state] || '播放语音';
    btn.setAttribute('aria-label', label);
    btn.title = label;

    const bubble = btn.closest('.voice-bubble');
    if (!bubble) return;
    bubble.dataset.voiceState = state;
    // 拿到真实时长后替掉按字数估的那个 —— 实测同样字数能差一倍，估算只是占位
    if (opts.duration > 0) {
        const durEl = bubble.querySelector('.duration');
        if (durEl) durEl.textContent = `${Math.round(opts.duration)}"`;
    }
}

/**
 * 按缓存情况刷新一个气泡的初始状态（本地/云端已有就标 ready）。
 * ★ 只查不合成，绝不会花钱。渲染消息列表时逐个调。
 */
async function refreshVoiceBubbleState(bubble, chat, chatType, senderId) {
    if (!bubble || typeof parseVoiceMessage !== 'function') return;
    const btn = bubble.querySelector('.voice-play-btn');
    if (!btn) return;
    const parsed = parseVoiceMessage(bubble.dataset.voiceRaw || '');
    if (!parsed) return;

    const profile = _voiceProfileForBubble(bubble, chat, chatType, senderId);
    if (!profile) {
        // 没有可用音色 —— 按钮留着但标明点了会怎样，不要假装能播
        _setVoiceBubbleState(btn, 'idle');
        if (_voiceIsSentBubble(bubble)) {
            // 自己发的语音播不了，这个键就是个"看文字"的开关（见 handleVoiceBubbleClick）
            btn.setAttribute('aria-label', '查看语音文字');
            btn.title = '查看语音文字';
        } else {
            btn.title = '这个角色还没设置音色（聊天设置里选一个）';
        }
        return;
    }
    // 记下 key：后台预合成完成时靠它找到该更新哪些气泡
    const voiceKey = computeVoiceKey(parsed.text, profile);
    bubble.dataset.voiceKey = voiceKey;

    // ★ 正在后台合成就显示转圈。少了这一步，预合成期间气泡显示成 idle，
    //   等于告诉用户"什么都没发生"，而实际上已经在跑了。
    if (typeof isVoiceSynthPending === 'function' && isVoiceSynthPending(voiceKey)) {
        _setVoiceBubbleState(btn, 'loading');
        return;
    }

    try {
        const hit = await peekVoiceClip(parsed.text, profile);
        // 已经有音频了就标 ready，并用真实时长替掉按字数估的那个占位
        if (hit) _setVoiceBubbleState(btn, 'ready', { duration: hit.duration });
    } catch (_) { /* 查缓存失败就当没有，保持 idle */ }
}

// 后台预合成完成 → 把屏幕上对应的气泡从"转圈"翻成"可播"。
// 一条 key 可能对应多个气泡（同一预设说过同样的话），所以查的是全部匹配项。
if (typeof onVoiceClipReady === 'function') {
    onVoiceClipReady(voiceKey => {
        document.querySelectorAll(`.voice-bubble[data-voice-key="${voiceKey}"]`)
            .forEach(bubble => {
                const btn = bubble.querySelector('.voice-play-btn');
                // 正在播的那个别动，否则会把 playing 顶掉
                if (btn && btn.dataset.voiceState !== 'playing') {
                    _setVoiceBubbleState(btn, 'ready');
                }
            });
    });
}

/** 自己发的消息（右侧气泡） */
function _voiceIsSentBubble(bubble) {
    const wrapper = bubble.closest('.message-wrapper');
    return !!(wrapper && wrapper.classList.contains('sent'));
}

/**
 * 这个气泡该用谁的声音。
 * ★ 自己发的语音一律没有音色 —— 私聊里 resolveVoicePresetForSender 会返回
 *   对方角色的音色，那会让"我发的语音"用对方的声音念出来，明显是错的。
 */
function _voiceProfileForBubble(bubble, chat, chatType, senderId) {
    if (_voiceIsSentBubble(bubble)) return null;
    if (typeof resolveVoicePresetForSender !== 'function') return null;
    return resolveVoicePresetForSender(chat, chatType, senderId);
}

/**
 * 切换文字稿显隐 —— 点气泡本体的那个动作。
 *
 * ★ 放在这里而不是留在 chat_room 的点击分派里：自己发的语音点播放键也要落到
 *   同一个动作上（见 handleVoiceBubbleClick），两个入口共用一份实现，
 *   免得哪天改了一处漏另一处。
 */
function toggleVoiceTranscript(bubble) {
    const wrapper = bubble && bubble.closest('.message-wrapper');
    const transcript = wrapper && wrapper.querySelector('.voice-transcript');
    if (transcript) transcript.classList.toggle('active');
}

// ── 点击入口 ──────────────────────────────────────────────────

/**
 * 点了播放按钮。
 *
 * ★ 必须同步就把状态切成 loading —— 合成要 20 秒以上，中间没有任何反馈的话
 *   用户会以为没响应，然后连点好几下。
 * ★ 也正因为要 20 秒，播放不能等 ensureVoiceClip 返回再要用户手势：
 *   iOS 的自动播放许可只在手势的同一个事件循环里有效，20 秒后早失效了。
 *   解法是拿这次点击顺手把播放器"解锁"（播一个 0 长度的空音源），
 *   之后再 play() 就不需要新手势了。
 */
async function handleVoiceBubbleClick(bubble, chat, chatType, senderId) {
    const btn = bubble && bubble.querySelector('.voice-play-btn');
    if (!btn) return;

    // 正在播这一条 → 当停止按钮用
    if (btn.dataset.voiceState === 'playing') {
        stopVoicePlayback();
        return;
    }
    if (btn.dataset.voiceState === 'loading') return;

    const parsed = typeof parseVoiceMessage === 'function'
        ? parseVoiceMessage(bubble.dataset.voiceRaw || '') : null;
    if (!parsed) return;

    const profile = _voiceProfileForBubble(bubble, chat, chatType, senderId);
    if (!profile) {
        // ★ 自己发的语音永远拿不到音色（见 _voiceProfileForBubble），弹一句"没有音色"
        //   只是让用户白点一下。整个气泡就一个可点区域是"看文字"，播放键也归到那儿去。
        if (_voiceIsSentBubble(bubble)) {
            toggleVoiceTranscript(bubble);
        } else {
            showToast('这个角色还没设置音色，在聊天设置里选一个');
        }
        return;
    }

    // 换一条就把上一条停掉，顺带回收它的 blob
    stopVoicePlayback();

    // ★ 借这次点击的用户手势解锁播放器。空 src 的 play() 会立刻失败，
    //   但"用户激活"已经被记下，后面异步 play() 就不会被拦。
    const audio = _getVoiceAudio();
    try { await audio.play(); } catch (_) { /* 预期会失败，只为拿激活 */ }

    _setVoiceBubbleState(btn, 'loading');

    let clip;
    try {
        clip = await ensureVoiceClip({
            text: parsed.text,
            profile,
            chatId: bubble.dataset.voiceChatId || '',
            msgId: bubble.dataset.voiceMsgId || ''
        });
    } catch (error) {
        // 超额被拦时 api 层已经弹过 toast，这里只把气泡标红，不重复报错
        _setVoiceBubbleState(btn, 'failed', { message: error.message });
        if (!error.quotaBlocked) showToast(error.message);
        return;
    }
    if (!clip || !clip.bytes) {
        _setVoiceBubbleState(btn, 'failed', { message: '没有可播放的音频' });
        return;
    }

    // 合成期间用户可能已经点了别的、或者离开了页面
    if (!bubble.isConnected) return;

    _voiceCurrentUrl = URL.createObjectURL(new Blob([clip.bytes], { type: clip.mime }));
    _voiceCurrentBtn = btn;
    audio.src = _voiceCurrentUrl;

    if (typeof suspendKeepAliveForPlayback === 'function') suspendKeepAliveForPlayback();

    try {
        await audio.play();
        _setVoiceBubbleState(btn, 'playing', { duration: clip.duration });
        _paintVoiceProgress();
    } catch (error) {
        _setVoiceBubbleState(btn, 'ready', { duration: clip.duration });
        _finishVoicePlayback(false);
        // 极少见：解锁没生效。告诉用户再点一次就好，别让他以为功能坏了
        showToast('浏览器拦下了自动播放，再点一次播放键');
    }
}

// ============================================================
// 重新生成
// ============================================================

/**
 * 删掉一条消息已合成的语音，让它下次播放时重新合成。
 *
 * ★ 为什么需要这个入口：缓存键只认预设 id，不认预设内容（见 computeVoiceKey）。
 *   所以调语速、改描述、换音色 ID 都**不会**让已有音频作废 —— 那是刻意的，
 *   免得每次微调都白花一次合成的钱。代价是"觉得现在这条不好听"时得有个手动出口，
 *   就是这里。
 *
 * ★ 重新合成会算出同一个 key，所以归档上传会覆盖云端同一个文件，不留孤儿。
 *
 * @param {string} messageId
 * @param {object} chat
 * @param {string} chatType
 */
async function regenerateVoiceClip(messageId, chat, chatType) {
    const bubble = document.querySelector(
        `.voice-bubble[data-voice-msg-id="${messageId}"]`);
    if (!bubble) return;

    const parsed = typeof parseVoiceMessage === 'function'
        ? parseVoiceMessage(bubble.dataset.voiceRaw || '') : null;
    if (!parsed) return;

    const wrapper = bubble.closest('.message-wrapper');
    const profile = _voiceProfileForBubble(
        bubble, chat, chatType, wrapper && wrapper.dataset.senderId);
    if (!profile) {
        showToast('这条消息没有可用的音色');
        return;
    }

    const voiceKey = computeVoiceKey(parsed.text, profile);
    const existing = await getVoiceClip(voiceKey);
    if (!existing) {
        showToast('这条语音还没生成过，直接点播放键就行');
        return;
    }

    // 重新生成要再花一次额度（20 秒起），值得先问一句
    const go = await AppUI.confirm(
        '删掉已生成的音频，下次点播放时用当前音色重新生成？\n\n重新生成会消耗一次合成额度。',
        '重新生成语音', '删除并重新生成', '取消');
    if (!go) return;

    // 正在播这一条就先停下，否则 blob 会挂在已删的片段上
    const btn = bubble.querySelector('.voice-play-btn');
    if (btn && btn.dataset.voiceState === 'playing') stopVoicePlayback();

    await deleteVoiceClip(voiceKey);
    if (btn) _setVoiceBubbleState(btn, 'idle');
    showToast('已删除，点播放键会用当前音色重新生成');
}

// ============================================================
// 下载
// ============================================================

/** 音频 MIME → 文件后缀。合成出来的一律是 mp3，其余几个是为兼容将来换服务商 */
function _voiceFileExtension(mime) {
    const clean = String(mime || '').toLowerCase().split(';')[0].trim();
    const map = {
        'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/aac': 'aac',
        'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/opus': 'opus',
        'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/webm': 'webm'
    };
    return map[clean] || 'mp3';
}

/**
 * 下载文件名：语音_20260822_1431.mp3
 * ★ 用本机时间，不用 toISOString —— 那个是 UTC，在中国会显示成前一天的晚上。
 * 同一分钟内下载多条会重名，浏览器自己会加 (1)(2)，不用我们操心。
 */
function _voiceDownloadName(mime) {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
        + `_${p(d.getHours())}${p(d.getMinutes())}`;
    return `语音_${stamp}.${_voiceFileExtension(mime)}`;
}

// iOS Safari 对 <a download> 的支持很不稳（常见表现是直接在当前页开始播放，
// 而不是存成文件）。那边优先走系统分享面板，用户能选「存到文件」或发给自己。
function _voiceIsIOS() {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent || '';
    // iPadOS 13+ 的 UA 伪装成 Mac，靠触摸点数区分真 Mac 和 iPad
    return /iPad|iPhone|iPod/.test(ua)
        || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1);
}

/** 走系统分享面板。返回 false = 这条路走不通（没 API 或不支持文件），该退回 <a download> */
async function _voiceShareFile(blob, filename) {
    try {
        if (typeof navigator === 'undefined' || typeof navigator.share !== 'function'
            || typeof File !== 'function') return false;
        const file = new File([blob], filename, { type: blob.type || 'audio/mpeg' });
        if (typeof navigator.canShare === 'function' && !navigator.canShare({ files: [file] })) {
            return false;
        }
        await navigator.share({ files: [file] });
        return true;
    } catch (error) {
        // 用户点了「取消」也会走到这里（AbortError）。那是正常操作，不该再退回去
        // 触发一次下载 —— 那等于无视了用户的取消。
        if (error && error.name === 'AbortError') return true;
        return false;
    }
}

/**
 * 把一条已生成的语音存成文件。
 *
 * ★ 绝不合成：allowSynthesize: false。这个入口是"把已经有的音频拿出来"，
 *   顺手花掉一次合成额度（20 秒 + 真金白银）不是用户点「下载」时预期的事。
 *   本地字节被 LRU 淘汰过、但归档在 GitHub 上的，会自动拉回来 —— 那只花流量。
 *
 * @param {string} messageId
 * @param {object} chat
 * @param {string} chatType
 */
async function downloadVoiceClip(messageId, chat, chatType) {
    const bubble = document.querySelector(
        `.voice-bubble[data-voice-msg-id="${messageId}"]`);
    if (!bubble) return;

    const parsed = typeof parseVoiceMessage === 'function'
        ? parseVoiceMessage(bubble.dataset.voiceRaw || '') : null;
    if (!parsed) return;

    const wrapper = bubble.closest('.message-wrapper');
    const profile = _voiceProfileForBubble(
        bubble, chat, chatType, wrapper && wrapper.dataset.senderId);
    if (!profile) {
        // 自己发的语音从来没合成过音频（见 _voiceProfileForBubble），没有东西可下载
        showToast(_voiceIsSentBubble(bubble)
            ? '自己发的语音没有音频文件'
            : '这条消息没有可用的音色');
        return;
    }

    let clip;
    try {
        clip = await ensureVoiceClip({
            text: parsed.text,
            profile,
            chatId: bubble.dataset.voiceChatId || '',
            msgId: messageId,
            allowSynthesize: false
        });
    } catch (error) {
        showToast(error.message || '取音频失败，请稍后重试');
        return;
    }
    if (!clip || !clip.bytes) {
        // 没合成过 —— 说清楚下一步该干什么，而不是只说"失败"
        showToast('这条语音还没生成，先点播放键生成后再下载');
        return;
    }

    const blob = new Blob([clip.bytes], { type: clip.mime || 'audio/mpeg' });
    const filename = _voiceDownloadName(clip.mime);

    if (_voiceIsIOS() && await _voiceShareFile(blob, filename)) return;

    let url = '';
    try {
        url = URL.createObjectURL(blob);
    } catch (error) {
        showToast('当前浏览器不支持下载');
        return;
    }
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // 立刻 revoke 会让部分浏览器拿不到内容，给它一点时间
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) {} }, 1000);
    showToast(`已保存 ${filename}`);
}
