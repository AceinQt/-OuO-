// ============================================================
// chat_image_store.js - 双层图片消息的字节存储与读取
// ============================================================
// 消息只保存描述和稳定的 media 元数据；真实图片字节只存在 imageCache 表，
// 或按 media.cloudRepoId / cloudPath 从 GitHub 取回。这个模块不负责生图业务。

const IMAGE_CACHE_DEFAULT_LIMIT_MB = 10;
const IMAGE_CACHE_KEY_VERSION = 'v1';
const _imageObjectUrls = new Set();
const _imageObjectUrlCacheKeys = new Map();

function _imageHash(text) {
    let h1 = 0x811c9dc5;
    let h2 = 0xc2b2ae35;
    const value = String(text || '');
    for (let i = 0; i < value.length; i++) {
        const c = value.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 0x01000193);
        h2 = Math.imul(h2 ^ c, 0x85ebca6b);
    }
    return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

function computeImageCacheKey(chatType, chatId, messageId) {
    return `${IMAGE_CACHE_KEY_VERSION}_${_imageHash(`${chatType || 'unknown'}\u0001${chatId || ''}\u0001${messageId || ''}`)}`;
}

function _imageBytes(value) {
    if (!value) return null;
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return null;
}

function _imageMimeFromDataUrl(dataUrl) {
    const match = String(dataUrl || '').match(/^data:([^;,]+)[;,]/i);
    return match ? match[1].toLowerCase() : '';
}

function _imageBytesFromDataUrl(dataUrl) {
    const match = String(dataUrl || '').match(/^data:([^;,]+);base64,([\s\S]*)$/i);
    if (!match) return null;
    try {
        const binary = atob(match[2].replace(/\s/g, ''));
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return { bytes, mime: match[1].toLowerCase() };
    } catch (error) {
        return null;
    }
}

function normalizeImageMedia(raw, defaults = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};
    return {
        version: 1,
        kind: 'image',
        source: (source.source || defaults.source) === 'uploaded' ? 'uploaded' : 'generated',
        state: ['pending', 'ready', 'failed'].includes(source.state) ? source.state : (defaults.state || 'ready'),
        cloudState: ['pending', 'uploaded', 'failed'].includes(source.cloudState) ? source.cloudState : 'none',
        cloudRepoId: String(source.cloudRepoId || '').trim(),
        cloudOwner: String(source.cloudOwner || '').trim(),
        cloudRepo: String(source.cloudRepo || '').trim(),
        cloudPath: String(source.cloudPath || '').trim(),
        localCacheKey: String(source.localCacheKey || defaults.localCacheKey || '').trim(),
        mime: String(source.mime || defaults.mime || 'image/jpeg').trim().toLowerCase(),
        size: Number(source.size) > 0 ? Number(source.size) : 0,
        sha: String(source.sha || '').trim(),
        presetId: String(source.presetId || '').trim(),
        errorCode: String(source.errorCode || '').trim()
    };
}

function createImageMedia(options = {}) {
    return normalizeImageMedia(options, options);
}

function isImageMediaMessage(message) {
    return !!(message && message.media && message.media.kind === 'image');
}

function setImageMessageDescription(message, content) {
    if (!message) return null;
    const text = String(content || '');
    message.content = text;
    message.parts = [{ type: 'text', text }];
    return message;
}

function _imageCacheLimitMB(limitMB) {
    const candidate = Number(limitMB);
    if (Number.isFinite(candidate) && candidate >= 0) return candidate;
    try {
        const configured = Number(db && db.imageSettings && db.imageSettings.localCacheLimitMB);
        if (Number.isFinite(configured) && configured >= 0) return configured;
    } catch (e) { /* db may not exist in tests */ }
    return IMAGE_CACHE_DEFAULT_LIMIT_MB;
}

function _imageCacheTableReady() {
    return typeof dexieDB !== 'undefined' && dexieDB && dexieDB.imageCache;
}

async function getImageCacheEntry(key, { touch = true } = {}) {
    if (!key || !_imageCacheTableReady()) return null;
    try {
        const row = await dexieDB.imageCache.get(key);
        if (!row) return null;
        if (touch) dexieDB.imageCache.update(key, { lastAccessedAt: Date.now() }).catch(() => {});
        return row;
    } catch (error) {
        console.warn('[图片] 读取本地缓存失败：', error);
        return null;
    }
}

async function getImageCacheBytes(key, options = {}) {
    const row = await getImageCacheEntry(key, options);
    return row && _imageBytes(row.bytes) ? _imageBytes(row.bytes) : null;
}

async function hasImageCacheBytes(key) {
    if (!key || !_imageCacheTableReady()) return false;
    try { return !!(await dexieDB.imageCache.get(key)); }
    catch (error) { return false; }
}

async function putImageCache({ key, chatId = '', chatType = '', messageId = '', mime = 'image/jpeg', bytes,
                               cloudBacked = false, protectedKeys = [] } = {}) {
    const data = _imageBytes(bytes);
    if (!key || !data || !data.byteLength || !_imageCacheTableReady()) {
        return { stored: false, reason: 'cache-unavailable' };
    }
    const limitMB = _imageCacheLimitMB();
    if (limitMB <= 0 || data.byteLength > limitMB * 1024 * 1024) {
        return { stored: false, reason: limitMB <= 0 ? 'cache-disabled' : 'image-too-large' };
    }
    try {
        await dexieDB.imageCache.put({
            key,
            chatId: String(chatId || ''),
            chatType: String(chatType || ''),
            messageId: String(messageId || ''),
            mime: String(mime || 'image/jpeg').toLowerCase(),
            size: data.byteLength,
            cloudBacked: !!cloudBacked,
            bytes: data,
            createdAt: Date.now(),
            lastAccessedAt: Date.now()
        });
        await enforceImageCacheLimit(undefined, [...new Set([key, ...(protectedKeys || [])])]);
        return { stored: true, key, size: data.byteLength };
    } catch (error) {
        console.warn('[图片] 写入本地缓存失败：', error);
        return { stored: false, reason: 'write-failed', error };
    }
}

async function restoreImageCacheBytes(key, bytes, { mime, cloudBacked = true, chatId = '', chatType = '', messageId = '' } = {}) {
    const data = _imageBytes(bytes);
    if (!key || !data || !data.byteLength || !_imageCacheTableReady()) return { stored: false, reason: 'cache-unavailable' };
    return putImageCache({ key, chatId, chatType, messageId, mime, bytes: data, cloudBacked });
}

async function markImageCacheCloudBacked(key) {
    if (!key || !_imageCacheTableReady()) return false;
    try { return (await dexieDB.imageCache.update(key, { cloudBacked: true })) > 0; }
    catch (error) { return false; }
}

async function deleteImageCache(key) {
    if (!key || !_imageCacheTableReady()) return;
    try {
        await dexieDB.imageCache.delete(key);
        revokeImageObjectUrlsForCacheKeys([key]);
    } catch (error) { console.warn('[图片] 删除本地缓存失败：', error); }
}

async function _deleteImageCacheWhere(indexName, value) {
    if (!_imageCacheTableReady() || value === undefined || value === null) return 0;
    try {
        const keys = await dexieDB.imageCache.where(indexName).equals(value).primaryKeys();
        if (keys.length) {
            await dexieDB.imageCache.bulkDelete(keys);
            revokeImageObjectUrlsForCacheKeys(keys);
        }
        return keys.length;
    } catch (error) {
        console.warn('[图片] 批量删除本地缓存失败：', error);
        return 0;
    }
}

function deleteImageCacheByMessage(messageId) {
    return _deleteImageCacheWhere('messageId', messageId);
}

function deleteImageCacheByChat(chatId) {
    return _deleteImageCacheWhere('chatId', chatId);
}

async function getImageCacheStats() {
    const empty = { entryCount: 0, cachedBytes: 0, cloudBackedCount: 0, localOnlyCount: 0 };
    if (!_imageCacheTableReady()) return empty;
    try {
        const rows = await dexieDB.imageCache.toArray();
        const stats = { ...empty, entryCount: rows.length };
        rows.forEach(row => {
            stats.cachedBytes += Number(row.size) || (_imageBytes(row.bytes)?.byteLength || 0);
            if (row.cloudBacked) stats.cloudBackedCount++;
            else stats.localOnlyCount++;
        });
        return stats;
    } catch (error) {
        console.warn('[图片] 统计本地缓存失败：', error);
        return empty;
    }
}

async function countImageMessagesInRepo(repoId) {
    const id = String(repoId || '').trim();
    if (!id || typeof dexieDB === 'undefined' || !dexieDB.messages) return 0;
    let count = 0;
    try {
        await dexieDB.messages.each(message => {
            const media = message && message.media;
            if (media && media.kind === 'image'
                && String(media.cloudRepoId || '').trim() === id
                && String(media.cloudPath || '').trim()) {
                count++;
            }
        });
        return count;
    } catch (error) {
        console.warn('[图片] 统计仓库引用失败：', error);
        return 0;
    }
}

async function enforceImageCacheLimit(limitMB, protectedKeys = []) {
    const result = { freedBytes: 0, evictedCloudBacked: 0, evictedLocalOnly: 0, remainingBytes: 0 };
    if (!_imageCacheTableReady()) return result;
    try {
        const rows = await dexieDB.imageCache.toArray();
        const limitBytes = _imageCacheLimitMB(limitMB) * 1024 * 1024;
        let total = rows.reduce((sum, row) => sum + (Number(row.size) || _imageBytes(row.bytes)?.byteLength || 0), 0);
        result.remainingBytes = total;
        if (total <= limitBytes) return result;

        const protectedSet = new Set(protectedKeys || []);
        const lru = (a, b) => (Number(a.lastAccessedAt) || 0) - (Number(b.lastAccessedAt) || 0);
        const removable = rows.filter(row => !protectedSet.has(row.key));
        const cloudRows = removable.filter(row => row.cloudBacked).sort(lru);
        const localRows = removable.filter(row => !row.cloudBacked).sort(lru);
        const toDelete = [];
        for (const row of [...cloudRows, ...localRows]) {
            if (total <= limitBytes) break;
            toDelete.push(row.key);
            const size = Number(row.size) || _imageBytes(row.bytes)?.byteLength || 0;
            total -= size;
            result.freedBytes += size;
            if (row.cloudBacked) result.evictedCloudBacked++;
            else result.evictedLocalOnly++;
        }
        if (toDelete.length) {
            await dexieDB.imageCache.bulkDelete(toDelete);
            revokeImageObjectUrlsForCacheKeys(toDelete);
        }
        result.remainingBytes = total;
        return result;
    } catch (error) {
        console.warn('[图片] 缓存淘汰失败：', error);
        return result;
    }
}

function _imageLegacyDataUrl(message) {
    if (!message) return '';
    if (typeof message.content === 'string' && /^data:image\//i.test(message.content)) return message.content;
    const part = Array.isArray(message.parts) && message.parts.find(p => p && p.type === 'image' && typeof p.data === 'string');
    if (part) return part.data;
    if (typeof message.content === 'string' && /^https?:\/\/[^\s]+$/i.test(message.content)) return message.content;
    return '';
}

function _imageCloudRepo(meta) {
    if (!meta || !meta.cloudRepoId || typeof getGithubRepo !== 'function') return null;
    return getGithubRepo(meta.cloudRepoId);
}

/** 统一读取入口：本地缓存 → GitHub → 旧消息 Base64。 */
async function readImageMessageBytes(message, { signal, cacheCloud = true } = {}) {
    const media = isImageMediaMessage(message) ? normalizeImageMedia(message.media) : null;
    if (media && media.localCacheKey) {
        const local = await getImageCacheBytes(media.localCacheKey);
        if (local) return { bytes: local, mime: media.mime || 'image/jpeg', source: 'local', media };
    }

    if (media && media.cloudPath && media.cloudRepoId) {
        const repo = _imageCloudRepo(media);
        if (!repo) {
            throw Object.assign(new Error(
                `这张图片归档在 ${media.cloudOwner || '?'}/${media.cloudRepo || '?'}，但仓库配置已删除。`
                + '请到“设置 > GitHub 仓库”重新添加该仓库。'
            ), { code: 'image-repo-missing' });
        }
        if (typeof downloadGithubFile !== 'function') throw new Error('图片下载模块未加载');
        const downloaded = await downloadGithubFile(repo, media.cloudPath, { signal });
        if (downloaded && downloaded.byteLength) {
            if (cacheCloud && media.localCacheKey) {
                await restoreImageCacheBytes(media.localCacheKey, downloaded, {
                    mime: media.mime,
                    cloudBacked: true,
                    chatId: message.chatId || (typeof currentChatId !== 'undefined' ? currentChatId : ''),
                    chatType: message.chatType || (typeof currentChatType !== 'undefined' ? currentChatType : ''),
                    messageId: message.id || ''
                });
            }
            return { bytes: downloaded, mime: media.mime || 'image/jpeg', source: 'cloud', media };
        }
    }

    const legacy = _imageLegacyDataUrl(message);
    const parsed = _imageBytesFromDataUrl(legacy);
    if (parsed) return { ...parsed, source: 'legacy-base64', media };
    if (/^https?:\/\//i.test(legacy)) {
        try {
            const response = await fetch(legacy, { signal });
            if (!response.ok) throw new Error(`图片下载返回 HTTP ${response.status}`);
            return {
                bytes: new Uint8Array(await response.arrayBuffer()),
                mime: response.headers.get('content-type') || 'image/jpeg',
                source: 'legacy-url',
                media
            };
        } catch (error) {
            if (error && error.name === 'AbortError') throw error;
        }
    }
    return null;
}

function createImageObjectUrl(bytes, mime = 'image/jpeg', cacheKey = '') {
    const data = _imageBytes(bytes);
    if (!data || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return '';
    const url = URL.createObjectURL(new Blob([data], { type: mime || 'image/jpeg' }));
    _imageObjectUrls.add(url);
    if (cacheKey) _imageObjectUrlCacheKeys.set(url, cacheKey);
    return url;
}

function revokeImageObjectUrl(url) {
    if (!url || !_imageObjectUrls.has(url)) return;
    try { URL.revokeObjectURL(url); } catch (e) {}
    _imageObjectUrls.delete(url);
    _imageObjectUrlCacheKeys.delete(url);
}

function revokeImageObjectUrlsForCacheKeys(keys) {
    const wanted = new Set(keys || []);
    if (!wanted.size) return;
    for (const [url, key] of Array.from(_imageObjectUrlCacheKeys.entries())) {
        if (wanted.has(key)) revokeImageObjectUrl(url);
    }
}

function releaseImageObjectUrlsWithin(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('[data-image-object-url]').forEach(el => {
        revokeImageObjectUrl(el.dataset.imageObjectUrl);
        delete el.dataset.imageObjectUrl;
    });
}

function imageMimeExtension(mime) {
    const clean = String(mime || '').toLowerCase().split(';')[0];
    const map = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/bmp': 'bmp', 'image/svg+xml': 'svg' };
    return map[clean] || 'jpg';
}

async function downloadImageMessage(message) {
    const result = await readImageMessageBytes(message);
    if (!result || !result.bytes) throw new Error('真实图片暂不可用，请稍后重试或重新生成。');
    const url = createImageObjectUrl(result.bytes, result.mime);
    if (!url) throw new Error('当前浏览器不支持图片下载');
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `图片_${message && message.id ? message.id : Date.now()}.${imageMimeExtension(result.mime)}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => revokeImageObjectUrl(url), 0);
    return result;
}

window.computeImageCacheKey = computeImageCacheKey;
window.normalizeImageMedia = normalizeImageMedia;
window.createImageMedia = createImageMedia;
window.isImageMediaMessage = isImageMediaMessage;
window.setImageMessageDescription = setImageMessageDescription;
window.getImageCacheEntry = getImageCacheEntry;
window.getImageCacheBytes = getImageCacheBytes;
window.hasImageCacheBytes = hasImageCacheBytes;
window.putImageCache = putImageCache;
window.restoreImageCacheBytes = restoreImageCacheBytes;
window.markImageCacheCloudBacked = markImageCacheCloudBacked;
window.deleteImageCache = deleteImageCache;
window.deleteImageCacheByMessage = deleteImageCacheByMessage;
window.deleteImageCacheByChat = deleteImageCacheByChat;
window.getImageCacheStats = getImageCacheStats;
window.countImageMessagesInRepo = countImageMessagesInRepo;
window.enforceImageCacheLimit = enforceImageCacheLimit;
window.readImageMessageBytes = readImageMessageBytes;
window.createImageObjectUrl = createImageObjectUrl;
window.revokeImageObjectUrl = revokeImageObjectUrl;
window.revokeImageObjectUrlsForCacheKeys = revokeImageObjectUrlsForCacheKeys;
window.releaseImageObjectUrlsWithin = releaseImageObjectUrlsWithin;
window.imageMimeExtension = imageMimeExtension;
window.downloadImageMessage = downloadImageMessage;

window.addEventListener?.('pagehide', () => {
    for (const url of Array.from(_imageObjectUrls)) revokeImageObjectUrl(url);
});

// ============================================================
// 图片查看器：点气泡右上角的放大按钮打开
//   布局：图片区（右上角浮一个关闭）+ 底部固定工具栏（下载 / 删除）
//   只借用气泡正在显示的 src（objectUrl 的生命周期归气泡管），
//   下载走 downloadImageMessage、删除走 deleteImageMessageMedia 的统一入口。
//   图片加载失败（云端已删/断网）时换成固定尺寸占位块：
//   此时下载置灰（读不到字节必然失败），删除保持可用——
//   「删掉再点气泡上的生成」就是重新生成的入口，所以不做单独的重生成按钮。
// ============================================================
let _imageViewerMessage = null;
let _imageViewerFailed = false;

function _imageViewerEls() {
    return {
        overlay: document.getElementById('image-viewer-modal'),
        img: document.getElementById('image-viewer-img'),
        fallback: document.getElementById('image-viewer-fallback'),
        downloadBtn: document.getElementById('image-viewer-download'),
        deleteBtn: document.getElementById('image-viewer-delete')
    };
}

function setImageViewerFailed(failed) {
    const { img, fallback, downloadBtn } = _imageViewerEls();
    _imageViewerFailed = !!failed;
    if (img) img.hidden = _imageViewerFailed;
    if (fallback) fallback.hidden = !_imageViewerFailed;
    // 下载读不到字节必然失败，直接禁用；删除不禁用，图裂时正是要靠它清理重生成
    if (downloadBtn) downloadBtn.disabled = _imageViewerFailed;
}

function openImageViewer(message, src) {
    const { overlay, img, deleteBtn } = _imageViewerEls();
    if (!overlay || !img || !src) return;
    _imageViewerMessage = message || null;
    setImageViewerFailed(false);
    // 上一次删除留下的 disabled 不能带到下一张图上
    if (deleteBtn) deleteBtn.disabled = false;
    img.src = src;
    overlay.classList.add('visible');
}

function closeImageViewer() {
    const { overlay, img } = _imageViewerEls();
    if (!overlay) return;
    overlay.classList.remove('visible');
    if (img) img.removeAttribute('src');
    setImageViewerFailed(false);
    _imageViewerMessage = null;
}

// 脚本在 body 尾部加载，弹窗 DOM 已存在，直接绑定
(function initImageViewer() {
    // 没有真实 DOM 的宿主（测试沙箱）里只加载纯函数，不绑事件
    if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
    const overlay = document.getElementById('image-viewer-modal');
    const img = document.getElementById('image-viewer-img');
    const closeBtn = document.getElementById('image-viewer-close');
    const downloadBtn = document.getElementById('image-viewer-download');
    const deleteBtn = document.getElementById('image-viewer-delete');
    if (!overlay || !closeBtn || !downloadBtn) return;
    closeBtn.addEventListener('click', closeImageViewer);
    // main.js 的全局委托只关「第一个」可见弹窗，这里自己绑定一份更稳（幂等）
    overlay.addEventListener('click', event => {
        if (event.target === overlay) closeImageViewer();
    });
    // removeAttribute('src') 也会触发 error，靠 hasAttribute 过滤掉这一下
    if (img) {
        img.addEventListener('error', () => {
            if (img.hasAttribute('src')) setImageViewerFailed(true);
        });
        img.addEventListener('load', () => setImageViewerFailed(false));
    }
    downloadBtn.addEventListener('click', async () => {
        if (!_imageViewerMessage || _imageViewerFailed) return;
        downloadBtn.disabled = true;
        try {
            await downloadImageMessage(_imageViewerMessage);
        } catch (error) {
            if (typeof showToast === 'function') showToast(error.message || '图片暂不可下载');
        } finally {
            // 失败态可能是在下载过程中才判定的，别把该灰的按钮又点亮
            downloadBtn.disabled = _imageViewerFailed;
        }
    });
    if (deleteBtn) {
        deleteBtn.addEventListener('click', async () => {
            const message = _imageViewerMessage;
            if (!message) return;
            if (typeof deleteImageMessageMedia !== 'function') {
                if (typeof showToast === 'function') showToast('图片删除功能尚未加载');
                return;
            }
            // 不可逆且要动云端，先确认一次
            if (typeof AppUI !== 'undefined' && AppUI && typeof AppUI.show === 'function') {
                const ok = await AppUI.show({
                    title: '删除这张图片？',
                    content: '会连同云端仓库里的文件一起删掉，只保留文字描述。删除后可以重新生成。',
                    type: 'confirm',
                    confirmText: '删除',
                    cancelText: '取消'
                });
                if (!ok) return;
            }
            deleteBtn.disabled = true;
            try {
                await deleteImageMessageMedia(message, {
                    chatId: message.chatId || (typeof currentChatId !== 'undefined' ? currentChatId : ''),
                    chatType: message.chatType || (typeof currentChatType !== 'undefined' ? currentChatType : '')
                });
                closeImageViewer();
                if (typeof showToast === 'function') showToast('图片已删除，可点气泡重新生成');
            } catch (error) {
                // 云端没删干净就不动本地，这里只报错、图片照旧留着
                if (typeof showToast === 'function') showToast(error.message || '删除失败，图片已保留');
            } finally {
                // 放在 finally：万一 showToast 自己抛了，按钮也不会卡死在禁用态
                deleteBtn.disabled = false;
            }
        });
    }
})();

window.openImageViewer = openImageViewer;
window.closeImageViewer = closeImageViewer;
