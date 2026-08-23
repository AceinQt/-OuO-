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
 * Open the same image-generation settings form for private and group chats.
 * 返回 null = 用户取消；返回对象 = 要写回聊天的字段。
 */
async function openImageGenerationSettingDialog(current = {}) {
    const modal = document.getElementById('image-generation-modal');
    const presetSel = document.getElementById('image-generation-preset');
    const autoEl = document.getElementById('image-generation-auto');
    const ruleEl = document.getElementById('image-generation-rule');
    const styleEl = document.getElementById('image-generation-style');
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

        const onConfirm = () => {
            const chosen = presetSel.value || off;
            cleanup();
            resolve({
                imageApiPresetId: chosen,
                imageAutoGenerate: !!(autoEl && autoEl.checked),
                imageContentRule: ruleEl ? ruleEl.value.trim() : '',
                imageStylePrompt: styleEl ? styleEl.value.trim() : '',
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
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
        }

        if (uploadEl) uploadEl.addEventListener('change', onUpload);
        if (clearBtn) clearBtn.addEventListener('click', onClear);
        confirmBtn.addEventListener('click', onConfirm);
        cancelBtn.addEventListener('click', onCancel);
        modal.classList.add('visible');
    });
}
