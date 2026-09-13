// ============================================================
// chat_image_service.js - 聊天图片生成与归档业务层
// ============================================================
// 只处理消息、预设、存储去向和任务并发，不直接拼 DOM。
// 图片卡片通过 generateImageForMessage() 发起手动生成；AI 回复完成后由
// queueAutoImageGeneration() 触发自动生成。任何失败都保留文字描述。

const IMAGE_DESCRIPTION_REGEX = /^\[([^\[\]：:]+?)发来的照片\/视频[:：]\s*([\s\S]+?)\]$/;
const _imageGenerationInflight = new Map();
let _imageGenerationQueueTail = Promise.resolve();
let _imageLocalModeNoticeShown = false;

// ============================================================
// 双语照片描述：[张三发来的照片/视频：夕阳下的海边（1girl, sunset, ocean）]
// ============================================================
// 中文给用户看，英文喂生图模型。两种都由聊天模型一次产出，不额外走翻译调用
// （用户按次计费，多一次不划算）。英文是必要的不是可选的：中文喂生图模型实测
// 会跑偏（水蜜桃画成西瓜），而 NAI 那套控制用的 tag（no humans、animal focus）
// 压根只存在于英文 danbooru 词表里，中文自然语言够不着。
//
// ★ 顺序是「中文在前、英文在括号里」，和普通消息的「双语模式」
//   （[X的消息：{外语原文}（中文翻译）]，见 private_prompt.js）**刻意相反**。
//   理由是降级安全——模型只写一半的情况一定会发生：
//     中文在前 → 退化成纯中文，和没有这个功能时一模一样，用户无感
//     英文在前 → 退化成一串英文直接甩给用户看，当场坏掉
//   按"坏掉时长什么样"来选，不按"哪个更整齐"来选。
//
// ★ 中文描述自己就爱用全角括号（"她在笑（有点害羞）"），所以不能见括号就切。
//   判据只有一条、只写在 _looksLikeEnglishPrompt 里：括号内不含汉字/全角标点，
//   且至少有一个三字母以上的单词。不满足就整条当中文，退回老行为。
const IMAGE_BILINGUAL_REGEX = /^([\s\S]*?)[（(]([^（）()]*)[）)]\s*$/;

function _looksLikeEnglishPrompt(text) {
    const t = String(text || '').trim();
    if (t.length < 3) return false;
    // 汉字、CJK 标点、全角字符任意出现 → 这是中文补充说明，不是提示词
    if (/[　-〿一-鿿！-｠]/.test(t)) return false;
    // 纯数字/颜文字（"2024"、">_<"）也挡掉：要求至少有一个成词的字母串
    return /[A-Za-z]{3,}/.test(t);
}

/**
 * 把「中文（English）」拆成两段。拆不动就原样当中文返回，绝不抛错——
 * 这个函数在每条照片消息上都会跑，坏一次就是一条消息显示异常。
 * @returns {{description: string, promptEn: string}} promptEn 为空表示没有英文
 */
function splitBilingualImageDescription(raw) {
    const text = String(raw || '').trim();
    const match = text.match(IMAGE_BILINGUAL_REGEX);
    if (!match) return { description: text, promptEn: '' };
    const description = match[1].trim();
    const promptEn = match[2].trim();
    if (!description || !_looksLikeEnglishPrompt(promptEn)) return { description: text, promptEn: '' };
    return { description, promptEn };
}

/**
 * 把英文提示词从 content 里摘出来，挪到 message.imagePromptEn。
 *
 * ★ 必须在消息对象造好、push 进 history / 画气泡**之前**调用。
 *   摘干净之后 content 的形状和今天完全一致，全项目另外 10 处解析
 *   [X发来的照片/视频：…] 的正则（气泡渲染、聊天列表预览、转发卡片、
 *   编辑消息、主动消息…）一个都不用改，也不会漏出英文给用户看。
 *
 * ★ 英文放 message 上而不是 message.media 上：normalizeImageMedia 是严格白名单，
 *   且 state 默认就是 'ready'——往 media 里塞东西会让气泡误以为图已经生成好了，
 *   转头去读字节、显示"图片暂不可用"。imagePromptEn 和消息上已有的
 *   transferStatus / giftStatus / quote 一样是随手字段，跟着消息入库。
 */
function stripBilingualImagePrompt(message) {
    if (!message || typeof message.content !== 'string') return message;
    const match = message.content.match(IMAGE_DESCRIPTION_REGEX);
    if (!match) return message;
    const { description, promptEn } = splitBilingualImageDescription(match[2]);
    if (!promptEn) return message;
    message.imagePromptEn = promptEn;
    // 刻意不调 chat_image_store.js 的 setImageMessageDescription：本体就这两行，
    // 内联换来一个自包含、不依赖加载顺序、测试里不用额外打桩的函数
    const next = `[${match[1].trim()}发来的照片/视频：${description}]`;
    message.content = next;
    message.parts = [{ type: 'text', text: next }];
    return message;
}

function parseImageDescriptionMessage(content) {
    const match = String(content || '').match(IMAGE_DESCRIPTION_REGEX);
    if (!match) return null;
    const { description, promptEn } = splitBilingualImageDescription(match[2]);
    return description ? { sender: match[1].trim(), description, promptEn } : null;
}

function isImageDescriptionMessage(message) {
    return !!(message && parseImageDescriptionMessage(message.content));
}

function isImageGenerationPending(messageId, chatId = '') {
    if (!messageId) return false;
    if (chatId) return _imageGenerationInflight.has(_imageTaskKey(chatId, messageId));
    const suffix = `:${messageId}`;
    return Array.from(_imageGenerationInflight.keys()).some(key => key.endsWith(suffix));
}

function _imageTargetChat(chatId, chatType) {
    if (chatId && chatType) {
        return chatType === 'private'
            ? (db.characters || []).find(c => c.id === chatId)
            : (db.groups || []).find(g => g.id === chatId);
    }
    if (typeof currentChatId !== 'undefined' && typeof currentChatType !== 'undefined') {
        return currentChatType === 'private'
            ? (db.characters || []).find(c => c.id === currentChatId)
            : (db.groups || []).find(g => g.id === currentChatId);
    }
    return null;
}

function _imageCacheLimit() {
    const raw = Number(db && db.imageSettings && db.imageSettings.localCacheLimitMB);
    return Number.isFinite(raw) && raw >= 0 ? raw : 10;
}

function _imageStorageTarget() {
    try {
        return typeof getGithubBinding === 'function' ? getGithubBinding('image') : null;
    } catch (error) {
        return null;
    }
}

function _imageStorageAvailability() {
    const localEnabled = _imageCacheLimit() > 0 && typeof dexieDB !== 'undefined'
        && dexieDB && dexieDB.imageCache;
    const cloudTarget = _imageStorageTarget();
    return { localEnabled: !!localEnabled, cloudTarget };
}

function getImageStorageAvailability() {
    const availability = _imageStorageAvailability();
    return {
        localEnabled: availability.localEnabled,
        cloudEnabled: !!availability.cloudTarget,
        localCacheLimitMB: _imageCacheLimit()
    };
}

function _safeImageMessageId(messageId) {
    return String(messageId || `msg_${Date.now()}`).replace(/[^a-zA-Z0-9._-]/g, '_');
}

function _imageArchivePath(target, messageId, mime) {
    const safeId = _safeImageMessageId(messageId);
    const shard = safeId.replace(/[^a-zA-Z0-9]/g, '').slice(-2).padStart(2, '0');
    const prefix = String((target && target.pathPrefix) || 'image').replace(/\/+$/g, '');
    const ext = typeof imageMimeExtension === 'function' ? imageMimeExtension(mime) : 'jpg';
    return `${prefix}/${shard}/${safeId}.${ext}`;
}

function _imageTaskKey(chatId, messageId) {
    return `${chatId || ''}:${messageId || ''}`;
}

function _enqueueImageTask(task) {
    const run = _imageGenerationQueueTail.then(task, task);
    _imageGenerationQueueTail = run.catch(() => {});
    return run;
}

function _findImageMessageById(messageId, chatId, chatType) {
    const chat = _imageTargetChat(chatId, chatType);
    if (!messageId || !chat || !Array.isArray(chat.history)) return null;
    return chat.history.find(item => item && item.id === messageId) || null;
}

function _imageChatMessage(message, chatId, chatType) {
    if (!message) return null;
    return _findImageMessageById(message.id, chatId, chatType);
}

/** 只存在本地、没进 GitHub 时提醒一次，别每张图都弹。 */
function _noticeImageLocalOnly(localOnly) {
    if (!localOnly || _imageLocalModeNoticeShown) return;
    _imageLocalModeNoticeShown = true;
    if (typeof showToast === 'function') showToast('图片仅保存在当前浏览器，不能随备份恢复，缓存超限后可能被清理');
}

/**
 * 生图失败的统一日志出口。
 *
 * ★ 为什么非要写日志：失败时界面上只有一句 toast（预生成连 toast 都没有），
 *   划走就没了，事后问"这张为什么没出图"手上一点线索都没有。console.error
 *   会被 main.js 的控制台拦截器收进「设置 > 系统日志」，可以事后翻、可以截图。
 * ★ 只记预设的名字/服务商/模型，**绝不记 apiKey** —— 那一页正是用来截图外发的。
 * ★ 同一个 error 只记一次（记在 WeakSet 里，不往 error 上挂属性，免得跟着
 *   消息被序列化进库）：内层手里有预设，先记；外层兜网时自动跳过。
 *   所以可以放心在多层各加一句，不会刷出重复日志。
 */
const _loggedImageFailures = new WeakSet();

function _logImageFailure(scene, error, { chatId = '', chatType = '', messageId = '', preset = null } = {}) {
    if (error && typeof error === 'object') {
        if (_loggedImageFailures.has(error)) return;
        _loggedImageFailures.add(error);
    }

    const where = [`[图片] ${scene}失败`];
    if (preset) {
        const provider = typeof imageProviderLabel === 'function'
            ? imageProviderLabel(preset.provider)
            : (preset.provider || '未知服务商');
        where.push(`预设「${preset.name || preset.id || '未命名'}」（${provider} / ${preset.model || '未填模型'}）`);
    }
    if (chatId) where.push(`聊天 ${chatType || '?'}:${chatId}`);
    if (messageId) where.push(`消息 ${messageId}`);

    const code = error && error.code ? `[${error.code}] ` : '';
    const reason = (error && error.message) || String(error || '未知错误');
    // 落地失败那类错误会把真正的起因挂在 cause 上（如 GitHub 上传的报错）
    const cause = error && error.cause && error.cause.message ? `｜起因：${error.cause.message}` : '';
    // 带 code 的都是我们自己抛的业务错误，message 已经写清了原因，堆栈只是噪音；
    // 没 code 的可能是代码 bug（TypeError 之类），那种情况堆栈才是唯一有用的东西
    const stack = !code && error && error.stack ? `\n${error.stack}` : '';
    console.error(`${where.join(' · ')}：${code}${reason}${cause}${stack}`);
}

async function _saveImageMessage(message, chatId, chatType) {
    await _persistImageMessageRecord(message, chatId, chatType);
    if (typeof saveSingleChat === 'function') await saveSingleChat(chatId, chatType);
}

async function _persistImageMessageRecord(message, chatId, chatType) {
    if (typeof dexieDB !== 'undefined' && dexieDB && dexieDB.messages
        && typeof dexieDB.messages.put === 'function') {
        await dexieDB.messages.put({ ...message, chatId, chatType });
        return;
    }
    if (typeof saveMessageToDB === 'function') await saveMessageToDB(message, chatId, chatType);
}

function _refreshImageMessageBubble(message, chatId, chatType) {
    if (typeof currentChatId === 'undefined' || currentChatId !== chatId
        || typeof currentChatType === 'undefined' || currentChatType !== chatType
        || typeof messageArea === 'undefined' || !messageArea) return;
    const oldBubble = messageArea.querySelector(`.message-wrapper[data-id="${message.id}"]`);
    if (!oldBubble || typeof createMessageBubbleElement !== 'function') return;
    if (typeof releaseImageObjectUrlsWithin === 'function') releaseImageObjectUrlsWithin(oldBubble);
    const nextBubble = createMessageBubbleElement(message);
    if (nextBubble) oldBubble.replaceWith(nextBubble);
}

function _setImageMediaState(message, chatId, chatType, state, extra = {}) {
    const current = message.media && message.media.kind === 'image'
        ? normalizeImageMedia(message.media)
        : createImageMedia({
            source: 'generated',
            state,
            localCacheKey: computeImageCacheKey(chatType, chatId, message.id)
        });
    message.media = normalizeImageMedia({ ...current, state, ...extra });
    return message.media;
}

function _replaceImageMessage(target, source) {
    if (!target || !source) return target;
    Object.keys(target).forEach(key => {
        if (!Object.prototype.hasOwnProperty.call(source, key)) delete target[key];
    });
    Object.assign(target, source);
    return target;
}

function _cloneImageMessage(message) {
    if (!message) return null;
    return {
        ...message,
        parts: Array.isArray(message.parts) ? message.parts.map(part => ({ ...part })) : message.parts,
        media: message.media && typeof message.media === 'object' ? { ...message.media } : message.media
    };
}

async function archiveUploadedImageMessage(message, {
    chatId = '', chatType = '', description = '', senderName = '', dataUrl = '', saveChat = true
} = {}) {
    if (!message || !message.id) {
        throw Object.assign(new Error('图片消息无有效 ID'), { code: 'image-message-missing' });
    }
    const cleanDescription = String(description || '').trim();
    if (!cleanDescription) {
        throw Object.assign(new Error('识图描述为空'), { code: 'image-description-empty' });
    }
    const parsed = typeof _imageBytesFromDataUrl === 'function' ? _imageBytesFromDataUrl(dataUrl) : null;
    if (!parsed || !parsed.bytes || !parsed.bytes.byteLength) {
        throw Object.assign(new Error('原图片数据无效'), { code: 'image-data-invalid' });
    }

    const availability = _imageStorageAvailability();
    if (!availability.localEnabled && !availability.cloudTarget) {
        throw Object.assign(new Error('没有可用的图片保存位置，请开启本地图片缓存或绑定 GitHub 图片仓库'), {
            code: 'image-no-storage'
        });
    }

    const localCacheKey = computeImageCacheKey(chatType, chatId, message.id);
    let localResult = { stored: false, reason: 'local-disabled' };
    if (availability.localEnabled && typeof putImageCache === 'function') {
        try {
            localResult = await putImageCache({
                key: localCacheKey,
                chatId,
                chatType,
                messageId: message.id,
                mime: parsed.mime,
                bytes: parsed.bytes,
                cloudBacked: false,
                protectedKeys: [localCacheKey]
            });
        } catch (error) {
            localResult = { stored: false, reason: 'write-failed', error };
        }
    }

    let cloudResult = null;
    let cloudError = null;
    if (availability.cloudTarget) {
        const cloudPath = _imageArchivePath(availability.cloudTarget, message.id, parsed.mime);
        try {
            if (typeof uploadGithubFile !== 'function') throw new Error('GitHub 上传模块未加载');
            cloudResult = await uploadGithubFile(
                availability.cloudTarget.repo,
                cloudPath,
                parsed.bytes,
                { message: `image: ${message.id}` }
            );
            if (localResult.stored && typeof markImageCacheCloudBacked === 'function') {
                await markImageCacheCloudBacked(localCacheKey);
            }
        } catch (error) {
            cloudError = error;
            console.warn('[图片] 用户图片归档失败：', error.message);
        }
    }

    if (!localResult.stored && !cloudResult) {
        const reason = localResult.reason || 'image-persist-failed';
        const messageText = reason === 'image-too-large'
            ? '原图超过本地缓存上限，且没有成功上传到 GitHub，已保留原图片消息'
            : '原图保存失败，已保留原图片消息，请稍后重试';
        throw Object.assign(new Error(messageText), { code: reason, cause: cloudError || localResult.error });
    }

    const cloud = availability.cloudTarget && cloudResult
        ? {
            cloudState: 'uploaded',
            cloudRepoId: availability.cloudTarget.repo.id || '',
            cloudOwner: availability.cloudTarget.repo.username || '',
            cloudRepo: availability.cloudTarget.repo.repo || '',
            cloudPath: cloudResult.path || _imageArchivePath(availability.cloudTarget, message.id, parsed.mime),
            sha: cloudResult.sha || ''
        }
        : {
            cloudState: availability.cloudTarget ? 'failed' : 'none',
            errorCode: cloudError ? 'image-cloud-upload-failed' : ''
        };
    const newContent = `[${String(senderName || '').trim() || '未知发送者'}发来的照片/视频：${cleanDescription}]`;
    const nextMessage = {
        ...message,
        content: newContent,
        parts: [{ type: 'text', text: newContent }],
        media: createImageMedia({
            source: 'uploaded',
            state: 'ready',
            localCacheKey,
            mime: parsed.mime,
            size: parsed.bytes.byteLength,
            ...cloud,
            errorCode: cloudError ? 'image-cloud-upload-failed' : ''
        })
    };

    const originalMessage = _cloneImageMessage(message);
    const chat = _imageTargetChat(chatId, chatType);
    const memoryMessage = chat && Array.isArray(chat.history)
        ? chat.history.find(item => item && item.id === message.id)
        : null;
    const originalMemoryMessage = memoryMessage && memoryMessage !== message
        ? _cloneImageMessage(memoryMessage)
        : null;
    let messageSaved = false;
    try {
        await _persistImageMessageRecord(nextMessage, chatId, chatType);
        messageSaved = true;
        _replaceImageMessage(message, nextMessage);
        if (memoryMessage && memoryMessage !== message) _replaceImageMessage(memoryMessage, nextMessage);
        if (saveChat && typeof saveSingleChat === 'function') await saveSingleChat(chatId, chatType);
    } catch (error) {
        _replaceImageMessage(message, originalMessage);
        if (memoryMessage && memoryMessage !== message) _replaceImageMessage(memoryMessage, originalMemoryMessage);
        if (messageSaved) {
            try { await _persistImageMessageRecord(originalMessage, chatId, chatType); } catch (rollbackError) {
                console.error('[图片] 回滚原图片消息失败：', rollbackError);
            }
        }
        if (localResult.stored && typeof deleteImageCache === 'function') {
            await deleteImageCache(localCacheKey);
        }
        throw Object.assign(new Error(`图片消息写库失败，已保留原图：${error.message || '未知错误'}`), {
            code: 'image-message-save-failed', cause: error
        });
    }

    return {
        message,
        media: message.media,
        localStored: !!localResult.stored,
        cloudStored: !!cloudResult,
        localOnly: !!localResult.stored && !cloudResult
    };
}

/**
 * 只负责「调接口拿字节 → 落本地缓存 / 传 GitHub → 拼出 media 补丁」。
 * 刻意不碰 chat.history、不写消息库、不刷气泡，所以调用方既可以是
 * 已经有气泡的手动生成，也可以是气泡还没出生的预生成。
 *
 * @returns {{readyPatch: object, localOnly: boolean}} readyPatch 可直接交给
 *   _setImageMediaState(..., 'ready', readyPatch)，也可以 createImageMedia 现拼一份。
 * @throws 生成或落地失败时抛错，error.code 为失败原因；error.imageMime/imageSize
 *   在「图片拿到了但存不下」时带上，便于调用方把尺寸信息一起写进 failed 状态。
 */
async function _produceImageMedia({ description, promptEn = '', messageId, chat, chatId, chatType, preset, availability }) {
    const localCacheKey = computeImageCacheKey(chatType, chatId, messageId);

    // 风格文本按聊天存，和画面比例一起在 API 层并进提示词。
    // 参考图同样按聊天存：给了它，API 层会自动改走对话式生图（只有那条路能带图）。
    // ★ 有英文就用英文：中文喂生图模型会跑偏（水蜜桃→西瓜），这对 NAI 和
    //   DALL-E/Gemini 都成立，所以不按 provider 区分。没英文才退回中文描述。
    const generated = await generateImage({
        prompt: promptEn || description,
        preset,
        stylePrompt: (chat && chat.imageStylePrompt) || '',
        negativePrompt: (chat && chat.imageNegativePrompt) || '',
        referenceImage: (chat && chat.imageReference) || ''
    });

    const bytes = generated && generated.bytes;
    const mime = (generated && generated.mime) || 'image/jpeg';
    if (!bytes || !bytes.byteLength) {
        throw Object.assign(new Error('生图接口没有返回有效图片'), { code: 'image-empty' });
    }

    let localResult = { stored: false, reason: 'local-disabled' };
    if (availability.localEnabled && typeof putImageCache === 'function') {
        localResult = await putImageCache({
            key: localCacheKey,
            chatId,
            chatType,
            messageId,
            mime,
            bytes,
            cloudBacked: false,
            protectedKeys: [localCacheKey]
        });
    }

    let cloudResult = null;
    let cloudError = null;
    if (availability.cloudTarget) {
        const cloudPath = _imageArchivePath(availability.cloudTarget, messageId, mime);
        try {
            if (typeof uploadGithubFile !== 'function') throw new Error('GitHub 上传模块未加载');
            cloudResult = await uploadGithubFile(
                availability.cloudTarget.repo,
                cloudPath,
                bytes,
                { message: `image: ${messageId}` }
            );
            if (localResult.stored && typeof markImageCacheCloudBacked === 'function') {
                await markImageCacheCloudBacked(localCacheKey);
            }
        } catch (error) {
            cloudError = error;
            console.warn('[图片] GitHub 归档失败：', error.message);
        }
    }

    if (!localResult.stored && !cloudResult) {
        throw Object.assign(new Error(
            localResult.reason === 'image-too-large'
                ? '图片超过本地缓存上限，且没有成功上传到 GitHub，未保存真实图片'
                : '真实图片保存失败，描述仍已保留，请稍后重试'
        ), {
            code: localResult.reason || 'image-persist-failed',
            cause: cloudError || undefined,
            imageMime: mime,
            imageSize: bytes.byteLength
        });
    }

    const cloud = availability.cloudTarget && cloudResult
        ? {
            cloudState: 'uploaded',
            cloudRepoId: availability.cloudTarget.repo.id || '',
            cloudOwner: availability.cloudTarget.repo.username || '',
            cloudRepo: availability.cloudTarget.repo.repo || '',
            cloudPath: cloudResult.path || _imageArchivePath(availability.cloudTarget, messageId, mime),
            sha: cloudResult.sha || ''
        }
        : {
            cloudState: availability.cloudTarget ? 'failed' : 'none',
            errorCode: cloudError ? 'image-cloud-upload-failed' : ''
        };

    return {
        readyPatch: {
            source: 'generated', localCacheKey, mime, size: bytes.byteLength,
            presetId: preset.id, ...cloud, errorCode: cloudError ? 'image-cloud-upload-failed' : ''
        },
        localOnly: !!localResult.stored && !cloudResult
    };
}

async function _generateImageForMessage(message, { chatId, chatType, auto = false } = {}) {
    const chat = _imageTargetChat(chatId, chatType);
    if (!chat) throw Object.assign(new Error('找不到这条图片消息所属的聊天'), { code: 'image-chat-missing' });
    const targetMessage = _imageChatMessage(message, chatId, chatType) || message;
    const parsed = parseImageDescriptionMessage(targetMessage.content);
    if (!parsed) throw Object.assign(new Error('这条消息不是标准照片/视频描述'), { code: 'image-description-missing' });

    const preset = typeof resolveImagePresetForChat === 'function'
        ? resolveImagePresetForChat(chat)
        : null;
    if (!preset || !preset.apiKey || !preset.model) {
        throw Object.assign(new Error('当前聊天没有可用的生图预设，请先完成图像 API 设置'), { code: 'image-preset-missing' });
    }

    const availability = _imageStorageAvailability();
    if (!availability.localEnabled && !availability.cloudTarget) {
        throw Object.assign(new Error('图片没有可用的保存位置：请开启本地图片缓存或绑定 GitHub 图片仓库'), { code: 'image-no-storage' });
    }

    const localCacheKey = computeImageCacheKey(chatType, chatId, targetMessage.id);
    _setImageMediaState(targetMessage, chatId, chatType, 'pending', {
        source: 'generated', localCacheKey, presetId: preset.id,
        cloudState: availability.cloudTarget ? 'pending' : 'none', errorCode: ''
    });
    await _saveImageMessage(targetMessage, chatId, chatType);
    _refreshImageMessageBubble(targetMessage, chatId, chatType);

    let produced;
    try {
        produced = await _produceImageMedia({
            description: parsed.description,
            // 消息进 history 时英文已经被 stripBilingualImagePrompt 摘到 imagePromptEn 上，
            // 所以先看它；parsed.promptEn 兜的是没走过摘取那条路的消息
            promptEn: targetMessage.imagePromptEn || parsed.promptEn,
            messageId: targetMessage.id,
            chat, chatId, chatType, preset, availability
        });
    } catch (error) {
        _setImageMediaState(targetMessage, chatId, chatType, 'failed', {
            source: 'generated', localCacheKey, presetId: preset.id,
            ...(error && error.imageMime ? { mime: error.imageMime, size: error.imageSize } : {}),
            cloudState: availability.cloudTarget ? 'failed' : 'none',
            errorCode: (error && error.code) || 'image-generation-failed'
        });
        // 在这里记：本层手里有预设，日志能写出"哪个预设、哪个模型"，
        // 比外层兜网只能写一句错误信息有用得多
        _logImageFailure(auto ? '自动生成' : '生成', error, {
            chatId, chatType, messageId: targetMessage.id, preset
        });
        await _saveImageMessage(targetMessage, chatId, chatType);
        _refreshImageMessageBubble(targetMessage, chatId, chatType);
        throw error;
    }

    _setImageMediaState(targetMessage, chatId, chatType, 'ready', produced.readyPatch);
    await _saveImageMessage(targetMessage, chatId, chatType);
    _refreshImageMessageBubble(targetMessage, chatId, chatType);
    _noticeImageLocalOnly(produced.localOnly);

    return {
        message: targetMessage,
        media: targetMessage.media,
        source: produced.localOnly ? 'local' : 'cloud'
    };
}

function generateImageForMessage(message, options = {}) {
    const chatId = options.chatId || (typeof currentChatId !== 'undefined' ? currentChatId : '');
    const chatType = options.chatType || (typeof currentChatType !== 'undefined' ? currentChatType : '');
    const target = _imageChatMessage(message, chatId, chatType) || message;
    if (!target || !target.id) {
        const error = Object.assign(new Error('图片消息无有效 ID'), { code: 'image-message-missing' });
        _logImageFailure('生成', error, { chatId, chatType });
        return Promise.reject(error);
    }
    const key = _imageTaskKey(chatId, target.id);
    if (_imageGenerationInflight.has(key)) return _imageGenerationInflight.get(key);

    const task = _enqueueImageTask(() => _generateImageForMessage(target, {
        chatId, chatType, auto: !!options.auto
    }));
    _imageGenerationInflight.set(key, task);
    task.finally(() => {
        if (_imageGenerationInflight.get(key) === task) _imageGenerationInflight.delete(key);
    }).catch(() => {});
    // 兜网：接口失败已经在内层记过（带预设信息），这里补的是那些还没走到接口就
    // 退出的情况——没预设、没保存位置、找不到聊天。调用方只会弹 toast，
    // 不在这里记就彻底没有痕迹。重复记会被 _logImageFailure 的标记挡掉。
    task.catch(error => _logImageFailure(options.auto ? '自动生成' : '生成', error, {
        chatId, chatType, messageId: target.id
    }));
    return task;
}

/**
 * 删除一张已生成的图片，让消息退回「只有文字」的状态。
 *
 * ★ 顺序是刻意的：**先删云端，成功了才动本地**。反过来的话云端删失败，
 *   本地已经没了，这张图就变成"看不到、又一直占着仓库空间"的幽灵文件。
 *   云端真 404（本来就没了）视为成功——否则那些早就失效的图永远清理不掉。
 *
 * 删完只是摘掉 media 元数据，描述文字仍在，气泡会自动退回「点击生成」形态，
 * 所以「重新生成」不需要单独的按钮，删掉再点生成即可。
 */
async function deleteImageMessageMedia(message, options = {}) {
    const chatId = options.chatId || (typeof currentChatId !== 'undefined' ? currentChatId : '');
    const chatType = options.chatType || (typeof currentChatType !== 'undefined' ? currentChatType : '');
    if (!isImageMediaMessage(message)) throw new Error('这条消息没有可删除的图片');
    const media = normalizeImageMedia(message.media);

    // ① 云端：任何一种"没删干净"都要抛出来中止，绝不能先动本地数据
    if (media.cloudPath && media.cloudRepoId) {
        const repo = typeof getGithubRepo === 'function' ? getGithubRepo(media.cloudRepoId) : null;
        if (!repo) {
            throw Object.assign(new Error(
                `这张图片归档在 ${media.cloudOwner || '?'}/${media.cloudRepo || '?'}，`
                + '但仓库配置已删除，删不掉云端文件。请到“设置 > GitHub 仓库”重新添加该仓库。'
            ), { code: 'image-repo-missing' });
        }
        if (typeof deleteGithubFile !== 'function') throw new Error('图片删除模块未加载');
        await deleteGithubFile(repo, media.cloudPath, { message: `Delete image ${message.id}` });
    }

    // ② 云端已确认不存在，再清本地字节（顺带 revoke 掉对应的 objectUrl）
    if (typeof deleteImageCacheByMessage === 'function') await deleteImageCacheByMessage(message.id);

    // ③ 摘掉 media：气泡靠它判断有没有图，去掉后自动退回纯文字 + 生成按钮
    const target = _imageChatMessage(message, chatId, chatType) || message;
    delete target.media;
    if (target !== message) delete message.media;
    await _saveImageMessage(target, chatId, chatType);
    _refreshImageMessageBubble(target, chatId, chatType);
    return true;
}

/** 每批自动最多取一条，避免一次 AI 回复意外产生多张付费图片。 */
function queueAutoImageGeneration(messages, chat, chatId, chatType) {
    if (!chat || !chat.imageAutoGenerate || !Array.isArray(messages)) return null;
    // 预设为「不开启」时连队都不入：否则每轮回复都要白跑一次再报 preset-missing
    if (typeof resolveImagePresetForChat === 'function' && !resolveImagePresetForChat(chat)) return null;
    const message = messages.find(item => isImageDescriptionMessage(item) && !isImageMediaMessage(item));
    if (!message) return null;
    const promise = generateImageForMessage(message, { chatId, chatType, auto: true });
    // 失败原因已由 generateImageForMessage 内部记进系统日志，这里只是接住
    // rejection 免得变成 unhandled，别再重复打一遍
    promise.catch(() => {});
    return promise;
}

// ============================================================
// 推气泡前的预生成
// ============================================================

// 等待生图的上限。超了就放行，让消息先出来 —— 生成还在后台跑，
// 落地后由 _reconcilePreparedImage 补写 media 并把气泡翻成真实图片。
// 定这个数：单张实测几秒到几十秒，90 秒能覆盖绝大多数正常情况，
// 又不至于在接口卡住时把整条回复无限期压着不发。
const IMAGE_PREPARE_TIMEOUT_MS = 90000;

/**
 * 等超时后才落地的那张图：此刻气泡已经在屏幕上（pending 转圈），
 * 生成一结束就按结果把它翻成真实图片或失败态。
 */
function _reconcilePreparedImage(task, { messageId, chatId, chatType, preset, availability }) {
    const settle = async (readyPatch, error) => {
        // 消息可能压根没被推出来（比如群聊里没匹配到说话人），那就什么都不用做
        const message = _findImageMessageById(messageId, chatId, chatType);
        if (!message) return;
        if (readyPatch) {
            _setImageMediaState(message, chatId, chatType, 'ready', readyPatch);
        } else {
            _setImageMediaState(message, chatId, chatType, 'failed', {
                source: 'generated',
                localCacheKey: computeImageCacheKey(chatType, chatId, messageId),
                presetId: preset.id,
                ...(error && error.imageMime ? { mime: error.imageMime, size: error.imageSize } : {}),
                cloudState: availability.cloudTarget ? 'failed' : 'none',
                errorCode: (error && error.code) || 'image-generation-failed'
            });
            _logImageFailure('超时后补写的预生成', error, { chatId, chatType, messageId, preset });
        }
        await _saveImageMessage(message, chatId, chatType);
        _refreshImageMessageBubble(message, chatId, chatType);
    };

    task.then(
        produced => settle(produced.readyPatch).then(() => _noticeImageLocalOnly(produced.localOnly)),
        error => settle(null, error)
    ).catch(err => console.error('[图片] 预生成补写失败：', err));
}

/**
 * 把这批新回复里的那张图**先生成好**，然后才让打字机开始逐条推送。
 *
 * ★ 调用点在打字机循环之前，而且要 await —— 和 prepareVoiceForMessages 同一个道理：
 *   发请求前界面上已经挂着「"某某"正在输入中…」，生成期间它一直显示，
 *   所以多等这一会儿看起来就是"他在拍/在发"，很自然。反过来如果先弹气泡再生成，
 *   用户会看着一张空占位图转半天圈 —— 那才像坏了。
 *
 * ★ 关键手法：**提前把消息 id 定下来**。图片的本地缓存键和 GitHub 归档路径都由
 *   消息 id 推导（computeImageCacheKey / _imageArchivePath），而打字机循环原本是
 *   在推气泡的那一刻才 `msg_${Date.now()}_${Math.random()}` 现取 id。所以这里先占一个 id，
 *   连同生成好的 media 一起挂在 item 上，循环里用 applyPreparedImage 装配回去，
 *   图片字节和消息才对得上号 —— 不然生成的图会成为找不到主人的孤儿。
 *
 * ★ 只在「自动生成」开着、且预设可用时才动手；关着立刻返回，气泡照常秒出。
 *
 * ★ 绝不抛异常、绝不无限等。接口挂了就把气泡推成 failed（长按可重试）；
 *   慢过 90 秒就先放行，生成完再自己把气泡翻过来。
 *
 * @param {Array<{content: string}>} messages 打字机即将逐条播放的那个列表
 * @param {{timeoutMs?: number}} [options] timeoutMs 仅供测试注入，默认 IMAGE_PREPARE_TIMEOUT_MS
 */
async function prepareImageForMessages(messages, chat, chatId, chatType, options = {}) {
    try {
        if (!Array.isArray(messages) || !messages.length || !chat || !chat.imageAutoGenerate) return null;
        if (typeof resolveImagePresetForChat !== 'function') return null;
        const preset = resolveImagePresetForChat(chat);
        if (!preset || !preset.apiKey || !preset.model) return null;

        const availability = _imageStorageAvailability();
        if (!availability.localEnabled && !availability.cloudTarget) return null;

        // 和 queueAutoImageGeneration 一个口径：每批只取第一条，别一次烧掉几张图的钱
        let target = null;
        for (const item of messages) {
            const parsed = parseImageDescriptionMessage(String((item && item.content) || '').trim());
            if (parsed) { target = { item, parsed }; break; }
        }
        if (!target) return null;

        const messageId = `msg_${Date.now()}_${Math.random()}`;
        const localCacheKey = computeImageCacheKey(chatType, chatId, messageId);
        const prepared = { messageId, media: null };
        target.item._preparedImage = prepared;

        // 进 inflight 表：这样超时放行后，气泡能靠 isImageGenerationPending
        // 显示「正在生成图片」而不是「生成已中断」
        const key = _imageTaskKey(chatId, messageId);
        const task = _enqueueImageTask(() => _produceImageMedia({
            description: target.parsed.description,
            // 这里的 item 还是模型原始输出、没造成消息对象，双语英文只能从 parsed 里拿
            promptEn: target.parsed.promptEn,
            messageId, chat, chatId, chatType, preset, availability
        }));
        _imageGenerationInflight.set(key, task);
        task.finally(() => {
            if (_imageGenerationInflight.get(key) === task) _imageGenerationInflight.delete(key);
        }).catch(() => {});

        const TIMED_OUT = Symbol('image-prepare-timeout');
        const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : IMAGE_PREPARE_TIMEOUT_MS;
        let timer;
        const outcome = await Promise.race([
            task.then(produced => ({ produced }), error => ({ error })),
            new Promise(resolve => { timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs); })
        ]);
        clearTimeout(timer);

        if (outcome === TIMED_OUT) {
            // 先放行，气泡带着 pending 出场，转圈等 _reconcilePreparedImage 补上
            prepared.media = createImageMedia({
                source: 'generated', state: 'pending', localCacheKey, presetId: preset.id,
                cloudState: availability.cloudTarget ? 'pending' : 'none', errorCode: ''
            });
            _reconcilePreparedImage(task, { messageId, chatId, chatType, preset, availability });
            return prepared;
        }

        if (outcome.error) {
            // 预生成失败连 toast 都不弹（气泡照常出，只是带失败标记），
            // 不记日志的话用户完全无从得知失败原因
            _logImageFailure('预生成', outcome.error, { chatId, chatType, messageId, preset });
            prepared.media = createImageMedia({
                source: 'generated', state: 'failed', localCacheKey, presetId: preset.id,
                ...(outcome.error.imageMime ? { mime: outcome.error.imageMime, size: outcome.error.imageSize } : {}),
                cloudState: availability.cloudTarget ? 'failed' : 'none',
                errorCode: outcome.error.code || 'image-generation-failed'
            });
            return prepared;
        }

        // 正常路径：气泡一出现就是真实图片
        prepared.media = createImageMedia({ state: 'ready', ...outcome.produced.readyPatch });
        _noticeImageLocalOnly(outcome.produced.localOnly);
        return prepared;
    } catch (error) {
        _logImageFailure('预生成调度', error, { chatId, chatType });
        return null;
    }
}

/**
 * 打字机循环里造好消息对象后调一次：把 prepareImageForMessages 预留的 id 和
 * 生成好的 media 装配上去。必须在 chat.history.push / addMessageBubble 之前调用。
 */
function applyPreparedImage(item, message) {
    const prepared = item && item._preparedImage;
    if (!prepared || !message) return message;
    if (prepared.messageId) message.id = prepared.messageId;
    if (prepared.media) message.media = prepared.media;
    return message;
}

window.parseImageDescriptionMessage = parseImageDescriptionMessage;
window.splitBilingualImageDescription = splitBilingualImageDescription;
window.stripBilingualImagePrompt = stripBilingualImagePrompt;
window.isImageDescriptionMessage = isImageDescriptionMessage;
window.isImageGenerationPending = isImageGenerationPending;
window.getImageStorageAvailability = getImageStorageAvailability;
window.archiveUploadedImageMessage = archiveUploadedImageMessage;
window.generateImageForMessage = generateImageForMessage;
window.deleteImageMessageMedia = deleteImageMessageMedia;
window.queueAutoImageGeneration = queueAutoImageGeneration;
window.prepareImageForMessages = prepareImageForMessages;
window.applyPreparedImage = applyPreparedImage;
