// ============================================================
// chat_image_settings.js - shared image-generation binding UI
// ============================================================
// This module only owns chat-level selection and display. It does not
// generate images or decide when the chat runtime should call the API.
//
// 弹窗是 index.html 里的静态 #image-generation-modal，私聊侧栏与群聊侧栏共用。
// 不走 AppUI.form：这里要塞文件上传和图片预览，通用表单撑不住。

/** 参考图压缩档位：长边 1024、JPEG 0.8，和头像那套共用 compressImage。 */
const IMAGE_REFERENCE_COMPRESS_OPTIONS = { quality: 0.8, maxWidth: 1024, maxHeight: 1024 };

/** 用于记录折叠面板点击事件是否已经绑定过，防止重复绑定 */
let _imageModalEventBound = false;

/** 没配过生图的聊天一律落到"不开启"，绝不借用全局默认替用户花钱。 */
function _imageBindingOffValue() {
    return typeof IMAGE_PRESET_OFF === 'string' ? IMAGE_PRESET_OFF : 'off';
}

/** Normalize a private-chat or group-chat image binding. */
function normalizeChatImageBinding(chat, settings) {
    const source = chat || {};
    const off = _imageBindingOffValue();
    const wanted = String(source.imageApiPresetId || '').trim();
    // 悬空 id（预设被删了）和空值一样落回不开启，不留幽灵选项
    const selected = wanted && wanted !== off && typeof getImagePreset === 'function'
        ? getImagePreset(wanted, settings)
        : null;

    return {
        imageApiPresetId: selected ? selected.id : off,
        imageAutoGenerate: !!source.imageAutoGenerate,
        imageContentRule: String(source.imageContentRule || ''),
        imageStylePrompt: String(source.imageStylePrompt || ''),
        // 只有 NAI 会真的发送它（见 generateImage 的 JSDoc）。按聊天存而不是按预设存，
        // 是为了和 imageStylePrompt 并排、改动集中在同一个弹窗里。
        imageNegativePrompt: String(source.imageNegativePrompt || ''),
        imageReference: String(source.imageReference || '')
    };
}

/** Display label for the sidebar row. 未选或悬空一律显示"不开启"。 */
function formatImageGenerationSettingLabel(presetId = '', autoGenerate = false, settings) {
    const off = _imageBindingOffValue();
    const wanted = String(presetId || '').trim();
    if (!wanted || wanted === off) return '不开启';
    if (typeof getImagePreset !== 'function') return '未配置';
    const resolved = getImagePreset(wanted, settings);
    if (!resolved) return '不开启';

    const mode = autoGenerate ? '自动' : '手动';
    return `${resolved.name} · ${mode}`;
}

/** 把参考图 dataURL 画进弹窗预览框；空值显示占位文案。 */
function _renderImageReferencePreview(dataUrl) {
    const box = document.getElementById('image-generation-reference-preview');
    if (!box) return;
    const value = String(dataUrl || '').trim();
    box.innerHTML = value ? `<img src="${value}" alt="参考图" style="max-width:100%; max-height:100%; object-fit:contain;">` : '<span>未设置</span>';
}

/**
 * 按当前选中的预设，调整负面提示词那一块的可用状态。
 *
 * ★ 非 NAI 服务商一律标成"不支持"并禁用输入，**绝不偷偷把负面词拼进正面提示词**：
 *   OpenAI 的 images/generations 和 Vertex 的 generateContent 都没有负面字段，
 *   而"不要出现X"这种写法对 DALL-E 是出了名的反效果（经常反倒把 X 画出来）。
 *   宁可明说不支持，也不要造出「我填了、没生效、还帮了倒忙」这种最难查的状态。
 * ★ 一键填入的按钮文案跟着模型走：同一个 Heavy 在 V3 和 V5 上原文完全不同。
 */
function _syncImageNegativeFields(presetId) {
    const textarea = document.getElementById('image-generation-negative');
    const hint = document.getElementById('image-generation-negative-hint');
    const presetBar = document.getElementById('image-generation-uc-presets');
    if (!textarea) return;

    const off = _imageBindingOffValue();
    const wanted = String(presetId || '').trim();
    const preset = wanted && wanted !== off && typeof getImagePreset === 'function'
        ? getImagePreset(wanted)
        : null;
    const supported = !!preset && typeof imageProviderSupportsNegativePrompt === 'function'
        && imageProviderSupportsNegativePrompt(preset.provider);

    textarea.disabled = !supported;
    if (presetBar) presetBar.hidden = !supported;
    if (hint) {
        hint.textContent = !preset
            ? '先选一个生图预设'
            : supported
                ? `不希望出现在画面里的内容 · 当前 ${preset.model || 'NovelAI'}`
                : `${typeof imageProviderLabel === 'function' ? imageProviderLabel(preset.provider) : preset.provider} 没有负面提示词字段，填了不会发送`;
    }
}

/**
 * Open the same image-generation settings form for private and group chats.
 * 返回 null = 用户取消；返回对象 = 要写回聊天的字段。
 */
async function openImageGenerationSettingDialog(current = {}) {
    const modal = document.getElementById('image-generation-modal');
    const presetSel = document.getElementById('image-generation-preset');
    const autoEl = document.getElementById('image-generation-auto');
    const ruleEl = document.getElementById('image-generation-rule');
    const styleEl = document.getElementById('image-generation-style');
    const negativeEl = document.getElementById('image-generation-negative');
    const ucBar = document.getElementById('image-generation-uc-presets');
    const uploadEl = document.getElementById('image-generation-reference-upload');
    const clearBtn = document.getElementById('image-generation-reference-clear');
    const confirmBtn = document.getElementById('image-generation-confirm');
    const cancelBtn = document.getElementById('image-generation-cancel');
    if (!modal || !presetSel || !confirmBtn || !cancelBtn) return null;
    if (typeof getImagePresetOptions !== 'function') return null;

    // === 新增：绑定折叠面板的展开/收起点击事件（确保只绑定一次） ===
    if (!_imageModalEventBound) {
        modal.addEventListener('click', (e) => {
            const header = e.target.closest('.collapsible-header');
            if (header) {
                // 点击头部时，切换父元素(.collapsible-section)的 open 状态
                header.parentElement.classList.toggle('open');
            }
        });
        _imageModalEventBound = true; // 标记为已绑定
    }
    // ==========================================================

    const binding = normalizeChatImageBinding(current);
    const off = _imageBindingOffValue();

    presetSel.innerHTML = '';
    getImagePresetOptions().forEach(option => {
        const opt = document.createElement('option');
        opt.value = option.value;
        opt.textContent = option.label;
        presetSel.appendChild(opt);
    });
    presetSel.value = Array.from(presetSel.options).some(o => o.value === binding.imageApiPresetId)
        ? binding.imageApiPresetId
        : off;

    if (autoEl) autoEl.checked = binding.imageAutoGenerate;
    if (ruleEl) ruleEl.value = binding.imageContentRule;
    if (styleEl) styleEl.value = binding.imageStylePrompt;
    if (negativeEl) negativeEl.value = binding.imageNegativePrompt;
    _syncImageNegativeFields(presetSel.value);

    // 参考图只在弹窗里暂存，取消就整份丢掉，不碰角色数据
    let referenceDraft = binding.imageReference;
    _renderImageReferencePreview(referenceDraft);

    return new Promise(resolve => {
        const onUpload = async (event) => {
            const file = event.target.files && event.target.files[0];
            if (!file) return;
            if (typeof compressImage !== 'function') {
                if (typeof showToast === 'function') showToast('压缩模块未加载，无法设置参考图');
                return;
            }
            try {
                referenceDraft = await compressImage(file, IMAGE_REFERENCE_COMPRESS_OPTIONS);
                _renderImageReferencePreview(referenceDraft);
            } catch (error) {
                if (typeof showToast === 'function') showToast('参考图压缩失败，请重试');
            }
        };

        const onClear = () => {
            referenceDraft = '';
            if (uploadEl) uploadEl.value = '';
            _renderImageReferencePreview('');
        };

        const onPresetChange = () => _syncImageNegativeFields(presetSel.value);

        // 一键填入：按当前预设的模型取官方原文。填进去就是普通文本，
        // 用户可以接着改——这正是不暴露 ucPreset 下标换来的好处。
        const onUcPreset = (event) => {
            const btn = event.target.closest('[data-uc]');
            if (!btn || !negativeEl || negativeEl.disabled) return;
            const off = _imageBindingOffValue();
            const chosen = presetSel.value || off;
            const preset = chosen !== off && typeof getImagePreset === 'function' ? getImagePreset(chosen) : null;
            if (!preset || typeof naiUcPresetText !== 'function') return;
            const text = naiUcPresetText(preset.model, btn.dataset.uc);
            if (!text) return;
            negativeEl.value = text;
        };

        const onConfirm = () => {
            const chosen = presetSel.value || off;
            cleanup();
            resolve({
                imageApiPresetId: chosen,
                imageAutoGenerate: !!(autoEl && autoEl.checked),
                imageContentRule: ruleEl ? ruleEl.value.trim() : '',
                imageStylePrompt: styleEl ? styleEl.value.trim() : '',
                imageNegativePrompt: negativeEl ? negativeEl.value.trim() : '',
                imageReference: referenceDraft
            });
        };

        const onCancel = () => {
            cleanup();
            resolve(null);
        };

        function cleanup() {
            modal.classList.remove('visible');
            if (uploadEl) {
                uploadEl.removeEventListener('change', onUpload);
                uploadEl.value = '';
            }
            if (clearBtn) clearBtn.removeEventListener('click', onClear);
            presetSel.removeEventListener('change', onPresetChange);
            if (ucBar) ucBar.removeEventListener('click', onUcPreset);
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
        }

        if (uploadEl) uploadEl.addEventListener('change', onUpload);
        if (clearBtn) clearBtn.addEventListener('click', onClear);
        presetSel.addEventListener('change', onPresetChange);
        if (ucBar) ucBar.addEventListener('click', onUcPreset);
        confirmBtn.addEventListener('click', onConfirm);
        cancelBtn.addEventListener('click', onCancel);
        modal.classList.add('visible');
    });
}
