// 正则只处理正文：存储型在新消息出场前执行，显示型只处理局部字符串副本。
// 分类、关联与规则本身存于数据库；这里不负责写库，也不能在通用保存时再次执行。
(function () {
    function compileRule(rule) {
        if (!rule || typeof rule.pattern !== 'string' || !rule.pattern.length) throw new Error('匹配表达式不能为空');
        return new RegExp(rule.pattern, typeof rule.flags === 'string' ? rule.flags : 'g');
    }

    function replaceText(source, rules) {
        const original = String(source ?? '');
        let text = original;
        let matched = false;
        let html = false;
        const errors = [];
        for (const rule of rules || []) {
            if (!rule) continue;
            try {
                const expression = compileRule(rule);
                // test 会移动全局表达式的游标，replace 前必须归零；每次编译也避免聊天之间串状态。
                const hit = expression.test(text);
                expression.lastIndex = 0;
                if (hit) {
                    matched = true;
                    html ||= rule.html === true;
                    text = text.replace(expression, String(rule.replacement ?? ''));
                }
            } catch (error) {
                errors.push({ id: rule.id, name: rule.name || '未命名正则', message: error.message });
            }
        }
        return { text, changed: text !== original, matched, html, errors };
    }

    function getRules(chat, chatType, stage) {
        if (!chat) return [];
        // 整个类别动态生效，新增/移动规则不需要重存聊天；模式与阶段仍分别过滤。
        const binding = getChatRegexBinding(chat, chatType, db.regexCategories);
        const selected = new Set(binding.ids);
        const mode = chatType === 'private' && chat.offlineModeEnabled ? 'offline' : 'online';
        const result = [];
        for (const category of (Array.isArray(db.regexCategories) ? db.regexCategories : [])) {
            if (!selected.has(category.id) || (chatType === 'private' && binding.modes[category.id]?.[mode] !== true)) continue;
            for (const rule of (Array.isArray(category?.rules) ? category.rules : [])) {
                if (!rule || (rule.html === true ? 'display' : rule.mode) !== stage) continue;
                result.push(rule);
            }
        }
        return result.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || String(a.id).localeCompare(String(b.id)));
    }

    const reportedErrors = new Set();
    function reportErrors(errors) {
        for (const error of errors) {
            const key = `${error.id}:${error.message}`;
            if (reportedErrors.has(key)) continue;
            reportedErrors.add(key);
            console.warn(`已跳过无效正则「${error.name}」：${error.message}`);
            if (typeof showToast === 'function') showToast(`正则「${error.name}」无效，已跳过`);
        }
    }

    // 对外壳做整条匹配，正文内的 ]、多行 HTML 不会截断，也不碰语音、转账等控制协议。
    function messageBody(message) {
        const content = typeof message?.content === 'string' ? message.content : '';
        if (message?.regexKind === 'html' || message?.parts?.[0]?.type === 'html') {
            return { kind: 'html', text: message.parts?.[0]?.type === 'html' ? String(message.parts[0].text ?? content) : content, prefix: '', suffix: '' };
        }
        const narration = content.match(/^(\[system-narration:)([\s\S]*)(\])$/);
        if (narration) return { kind: 'narration', text: narration[2], prefix: narration[1], suffix: narration[3] };
        const dialogue = content.match(/^(\[[^\[\]\r\n]*?的消息[:：]\s*)([\s\S]*)(\])$/);
        if (dialogue) return { kind: 'text', text: dialogue[2], prefix: dialogue[1], suffix: dialogue[3] };
        if (content && !content.startsWith('[') && !/^(?:data:image\/|https?:\/\/\S+\.(?:png|jpe?g|webp|gif))/i.test(content)) {
            return { kind: 'text', text: content, prefix: '', suffix: '' };
        }
        return null;
    }

    function applyStorage(message, chat, chatType) {
        if (!message || message.role !== 'assistant' || message.isHidden || message.isWithdrawn || message.regexKind
            || message.media || message.stickerData || message.transferStatus || message.giftStatus
            || message.callSessionId || chat?.callMode
            || (Array.isArray(message.parts) && message.parts.some(part => !['text', 'html'].includes(part?.type)))) return message;
        const rules = getRules(chat, chatType, 'storage');
        if (!rules.length) return message;
        const body = messageBody(message);
        if (!body) return message;
        const result = replaceText(body.text, rules);
        reportErrors(result.errors);
        if (!result.changed) return message;
        const content = body.prefix + result.text + body.suffix;
        message.content = content;
        message.parts = (message.parts || []).map(part => ({ ...part, text: part.type === 'html' ? result.text : content }));
        if (!message.parts.length) message.parts = [{ type: body.kind === 'html' ? 'html' : 'text', text: body.kind === 'html' ? result.text : content }];
        // 只记类型，不另存一份原文。替换正文中的 [system:…] 不能反过来执行隐藏/媒体协议。
        message.regexKind = body.kind;
        return message;
    }

    function classificationContent(message) {
        if (message?.regexKind === 'narration') return '[system-narration:正则正文]';
        if (message?.regexKind === 'html') return '<div>正则正文</div>';
        if (message?.regexKind === 'text') return '[正则的消息：正则正文]';
        return message?.content;
    }

    // 一个共享观察器负责回收已移走气泡的高度监听；不能等内页再次 resize 才释放。
    const frameObservers = new Map();
    let frameRemovalObserver;
    function trackFrame(frame, observer) {
        frameObservers.set(frame, observer);
        if (!frameRemovalObserver && typeof MutationObserver === 'function') {
            frameRemovalObserver = new MutationObserver(() => {
                for (const [item, watcher] of frameObservers) {
                    if (!item.isConnected) { watcher.disconnect(); frameObservers.delete(item); }
                }
                if (!frameObservers.size) { frameRemovalObserver.disconnect(); frameRemovalObserver = null; }
            });
            frameRemovalObserver.observe(document.documentElement, { childList: true, subtree: true });
        }
    }

    function observeFrame(frame, body, resize) {
        if (typeof ResizeObserver !== 'function' || !frame.isConnected) return;
        const observer = new ResizeObserver(resize);
        observer.observe(body);
        trackFrame(frame, observer);
    }

    // 只剥掉包住整个文档的一层围栏；普通内容中的代码块仍原样保留。
    function unwrapHtml(source) {
        const text = String(source ?? '');
        return text.match(/^\s*```(?:html)?\s*\n([\s\S]*?)\n```\s*$/i)?.[1] ?? text;
    }

    // 此函数序列化后在不透明源 iframe 内执行，不能引用聊天页面变量。
    function cardBridge(channel) {
        const send = data => parent.postMessage({ channel, ...data }, '*');
        let scheduled = false, lastHeight = 0, pressTimer, held = false;
        const resize = () => {
            if (scheduled) return;
            scheduled = true;
            requestAnimationFrame(() => {
                scheduled = false;
                const body = document.body;
                if (!body) return;
                const style = getComputedStyle(body);
                const margin = (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0);
                const height = Math.min(6000, Math.max(24, Math.ceil(Math.max(body.getBoundingClientRect().height, body.scrollHeight) + margin)));
                if (height !== lastHeight) { lastHeight = height; send({ type: 'height', height }); }
            });
        };
        document.addEventListener('DOMContentLoaded', () => {
            new ResizeObserver(resize).observe(document.body);
            new MutationObserver(resize).observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
            resize();
        });
        window.addEventListener('load', resize);
        document.addEventListener('load', resize, true);
        // 卡片自行处理点击；长按直接通知父页开本条菜单，避免异步转发 touchend 来不及取消 click。
        document.addEventListener('touchstart', event => {
            clearTimeout(pressTimer);
            held = false;
            if (event.touches.length !== 1) return;
            const { clientX: x, clientY: y } = event.touches[0];
            pressTimer = setTimeout(() => { held = true; send({ type: 'contextmenu', x, y }); }, 400);
        }, { passive: true, capture: true });
        document.addEventListener('touchmove', () => clearTimeout(pressTimer), { passive: true, capture: true });
        for (const type of ['touchend', 'touchcancel']) document.addEventListener(type, event => {
            clearTimeout(pressTimer);
            if (held && event.cancelable) event.preventDefault();
        }, { passive: false, capture: true });
        document.addEventListener('click', event => {
            if (held) { held = false; event.preventDefault(); event.stopImmediatePropagation(); }
            // 不让链接把沙箱自身导航离开卡片；按钮、details、checkbox 等默认交互保留。
            if (event.target.closest?.('a,area')) event.preventDefault();
        }, true);
        document.addEventListener('submit', event => event.preventDefault(), true);
        document.addEventListener('contextmenu', event => {
            event.preventDefault();
            if (!held) send({ type: 'contextmenu', x: event.clientX, y: event.clientY });
        }, true);
    }

    function renderInteractiveHtml(container, source) {
        const frame = document.createElement('iframe');
        frame.className = 'regex-html-frame';
        frame.title = '正则 HTML 交互卡片';
        // 绝不能同时添加 allow-same-origin：卡片脚本只能接触自己的 DOM，不能访问主页面及其存储。
        frame.setAttribute('sandbox', 'allow-scripts');
        frame.setAttribute('referrerpolicy', 'no-referrer');
        frame.setAttribute('allow', "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'");
        frame.style.cssText = 'display:block;width:100%;min-width:0;height:48px;border:0;background:transparent;';
        const channel = 'regex-card-' + crypto.randomUUID();
        // 保留完整文档的 head/body 与内联脚本；旧静态模式继续走 DOMPurify，不能借自动 HTML 检测获得脚本权限。
        const parsed = new DOMParser().parseFromString(unwrapHtml(source), 'text/html');
        parsed.querySelectorAll('iframe,frame,frameset,object,embed,base,meta,link,script[src]').forEach(node => node.remove());
        parsed.querySelectorAll('[autofocus]').forEach(node => node.removeAttribute('autofocus'));
        const policy = parsed.createElement('meta');
        policy.httpEquiv = 'Content-Security-Policy';
        policy.content = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'";
        const baseStyle = parsed.createElement('style');
        baseStyle.textContent = 'html,body{margin:0;background:transparent;overflow-wrap:anywhere;font-family:system-ui,sans-serif}body{display:flow-root}*,*::before,*::after{box-sizing:border-box}img{max-width:100%}pre{white-space:pre-wrap}';
        const bridge = parsed.createElement('script');
        bridge.textContent = `(${cardBridge.toString()})(${JSON.stringify(channel)});`;
        parsed.head.prepend(policy, baseStyle, bridge);
        const onMessage = event => {
            const data = event.data;
            if (event.source !== frame.contentWindow || event.origin !== 'null' || !frame.isConnected || !data || data.channel !== channel) return;
            if (data.type === 'height' && Number.isFinite(data.height)) {
                const height = Math.min(6000, Math.max(24, Math.ceil(data.height))) + 'px';
                if (frame.style.height !== height) frame.style.height = height;
            } else if (data.type === 'contextmenu' && Number.isFinite(data.x) && Number.isFinite(data.y)) {
                const wrapper = frame.closest('.message-wrapper');
                if (!wrapper || typeof handleMessageLongPress !== 'function' || (typeof isInMultiSelectMode !== 'undefined' && isInMultiSelectMode)) return;
                const rect = frame.getBoundingClientRect();
                handleMessageLongPress(wrapper, rect.left + Math.max(0, Math.min(rect.width, data.x)), rect.top + Math.max(0, Math.min(rect.height, data.y)));
            }
        };
        window.addEventListener('message', onMessage);
        frame.srcdoc = '<!doctype html>' + parsed.documentElement.outerHTML;
        container.appendChild(frame);
        // 创建时气泡可能尚未插入文档；首个移除批次再检查连接状态，和静态帧共用回收器。
        trackFrame(frame, { disconnect: () => window.removeEventListener('message', onMessage) });
        return frame;
    }

    function renderHtmlPreview(container, source, options = {}) {
        container.replaceChildren();
        container.classList.add('regex-html-bubble');
        // 错误的全局/空匹配可能复制几百张完整卡片；渲染前止损，原始替换结果仍可在普通预览检查。
        if (String(source ?? '').length > 512 * 1024) {
            container.textContent = 'HTML 结果过大，已暂停渲染。请检查正则是否重复匹配，并在普通预览查看结果。';
            return null;
        }
        if (options.interactive === true) {
            container.classList.add('regex-html-card');
            return renderInteractiveHtml(container, source);
        }
        container.classList.remove?.('regex-html-card');
        const frame = document.createElement('iframe');
        frame.className = 'regex-html-frame';
        frame.title = '正则 HTML 展示';
        // 不开放脚本。同源权限仅用于父页面测量高度、转发长按，绝不能与 allow-scripts 同时开启。
        frame.setAttribute('sandbox', 'allow-same-origin');
        frame.setAttribute('referrerpolicy', 'no-referrer');
        frame.style.cssText = 'display:block;width:100%;min-width:0;height:48px;border:0;background:transparent;';
        // 先包一层正文容器：DOMPurify 对开头单独的 style 会丢弃，放进正文才能保留局部卡片样式。
        const cleaned = DOMPurify.sanitize('<div>' + String(source) + '</div>', {
            ADD_TAGS: ['style'], ADD_ATTR: ['style'],
            FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'meta', 'base', 'link'],
            FORBID_ATTR: ['srcdoc', 'autofocus']
        });
        const computed = typeof getComputedStyle === 'function' ? getComputedStyle(container) : null;
        const color = computed?.color || '#333';
        const fontSize = computed?.fontSize || '14px';
        // CSP 拦住脚本、表单与外部资源；图片允许 HTTPS/data，本页面数据不会成为卡片的脚本上下文。
        frame.srcdoc = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            + '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; script-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; img-src https: data:; font-src data:; form-action &#39;none&#39;; base-uri &#39;none&#39;">'
            + `<style>html,body{margin:0;background:transparent;overflow-wrap:anywhere;color:${color};font-size:${fontSize};font-family:system-ui,sans-serif}body{display:flow-root}*,*::before,*::after{box-sizing:border-box}img{max-width:100%}pre{white-space:pre-wrap}a{color:inherit}</style>`
            + '</head><body>' + cleaned + '</body></html>';
        frame.addEventListener('load', () => {
            const inner = frame.contentDocument;
            if (!inner) return;
            const resize = () => {
                frame.style.height = Math.max(24, Math.ceil(inner.body.getBoundingClientRect().height), inner.body.scrollHeight) + 'px';
            };
            resize();
            // 图片加载后随内容调整高度，历史重绘移走 iframe 时由共享观察器回收。
            observeFrame(frame, inner.body, resize);
            let suppressClick = false;
            inner.addEventListener('click', event => {
                event.preventDefault();
                if (suppressClick) { suppressClick = false; return; }
                frame.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            });
            // 聊天长按使用 touchstart/touchend 而非 pointer：坐标换算后保留 preventDefault 回传，
            // 让长按后的抬手不会再合成 click 把菜单关掉；滑动仍由原聊天委托取消计时。
            for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
                inner.addEventListener(type, event => {
                    if (type === 'touchstart') suppressClick = false;
                    const rect = frame.getBoundingClientRect();
                    const touches = list => Array.from(list || [], touch => ({
                        identifier: touch.identifier, target: frame,
                        clientX: rect.left + touch.clientX, clientY: rect.top + touch.clientY,
                        pageX: rect.left + touch.clientX + window.scrollX, pageY: rect.top + touch.clientY + window.scrollY
                    }));
                    const forwarded = new Event(type === 'touchcancel' ? 'touchend' : type, { bubbles: true, cancelable: true });
                    for (const name of ['touches', 'targetTouches', 'changedTouches']) Object.defineProperty(forwarded, name, { value: touches(event[name]) });
                    if (!frame.dispatchEvent(forwarded)) {
                        if (event.cancelable) event.preventDefault();
                        if (type === 'touchend') suppressClick = true;
                    }
                }, { passive: false });
            }
            // iframe 内右键和指针事件也不冒泡，统一转换为父页面坐标。
            for (const type of ['pointerdown', 'pointerup', 'pointermove', 'pointercancel', 'contextmenu']) {
                inner.addEventListener(type, event => {
                    if (type === 'contextmenu') event.preventDefault();
                    const rect = frame.getBoundingClientRect();
                    const values = { bubbles: true, cancelable: true, button: event.button, buttons: event.buttons, clientX: rect.left + event.clientX, clientY: rect.top + event.clientY, pointerId: event.pointerId, pointerType: event.pointerType, isPrimary: event.isPrimary };
                    frame.dispatchEvent(type === 'contextmenu' ? new MouseEvent(type, values) : new PointerEvent(type, values));
                });
            }
        });
        container.appendChild(frame);
        return frame;
    }

    function resolveBody(source, message, chat, chatType, options = {}) {
        const storedBody = message?.regexKind && !options.ignoreStoredBody ? messageBody(message)?.text : null;
        const original = storedBody ?? String(source ?? '');
        const eligible = message?.role === 'assistant' && !message.isHidden && !message.isWithdrawn
            && !message.media && !message.stickerData && !message.transferStatus && !message.giftStatus
            && !message.callSessionId && !chat?.callMode
            && (!Array.isArray(message.parts) || message.parts.every(part => ['text', 'html'].includes(part?.type)));
        // 旧普通显示规则的作用范围不变；新增脚本权限才排除通话、媒体等特殊消息。
        // 双语局部片段不再命中卡片规则，整条卡片由气泡工厂在拆分之前判断，避免一条消息生成两张卡片。
        const rules = message?.role === 'assistant' ? getRules(chat, chatType, 'display').filter(rule => rule.html !== true || (eligible && !options.ignoreStoredBody)) : [];
        // 手动指定也只保存规则 ID；模板只在显示副本展开，绝不写入 content/parts。
        if (eligible && !options.ignoreStoredBody && message.regexHtmlRuleId) {
            const selected = rules.find(rule => rule.id === message.regexHtmlRuleId && rule.html === true);
            const manual = replaceText(original, selected ? [selected] : []);
            reportErrors(manual.errors);
            return manual;
        }
        const result = replaceText(original, rules);
        // 仅兼容过去已经存下的卡片；新 HTML 规则只走显示阶段，不再产生此标记。
        if (eligible && message.regexHtml === true) result.html = true;
        reportErrors(result.errors);
        return result;
    }

    function renderBody(container, source, message, chat, chatType, options = {}) {
        const result = options.result || resolveBody(source, message, chat, chatType, options);
        // HTML 卡片不能再经过 Markdown：缩进、脚本和整个文档结构都必须保留。
        const html = !result.html && options.markdown && typeof marked !== 'undefined' ? marked.parse(result.text, { breaks: true }) : result.text;
        const isRegexHtml = result.html || ((result.changed || !!message?.regexKind) && /<\/?[a-z][^>]*>/i.test(html));
        container.classList?.remove?.('regex-html-bubble', 'regex-html-card');
        if (isRegexHtml) renderHtmlPreview(container, html, { interactive: result.html });
        else if (options.plainText) container.textContent = result.text;
        else container.innerHTML = options.allowStyle
            ? DOMPurify.sanitize(html, { ADD_TAGS: ['style'], ADD_ATTR: ['style'] }) : DOMPurify.sanitize(html);
        return result;
    }

    window.ChatRegex = { compileRule, replaceText, getRules, reportErrors, messageBody, applyStorage, classificationContent, unwrapHtml, resolveBody, renderHtmlPreview, renderBody };
})();
