// --- START OF FILE bubble_css_scope.js ---
//
// 把用户手写的气泡/顶栏/底栏 CSS 限制到「某一个聊天室」里去。
//
// 为什么要单独一个文件：预览（bubble_css_preset.js 的 iframe）和实际应用
// （chat_settings.js 的 updateCustomBubbleStyle）**必须**跑同一个函数。
// 历史上这两条是分开的 —— 预览把 CSS 原样塞进 <style>，实际走一个手写正则改写器，
// 于是「预览生效、保存后不生效」变成常态反馈。气泡能碰对是因为气泡选择器足够简单，
// 底栏（@media + 动画 + 变量 + 跟基础样式抢权重）一碰就散。
//
// 旧正则改写器实测踩到的五个坑，这里逐个对应（回归测试见 tests/bubble_css_scope.test.cjs）：
//   1. ruleRegex 只认单层 {}，@media 的外壳被丢掉 → 媒体查询里的规则变成无条件生效；
//   2. 清 @keyframes 用的非贪婪正则只吃到第一帧，剩下的帧掉进规则匹配，
//      「100%」被当成选择器（实测输出真的有这一行）；
//   3. rootRegex 没有 g，只处理第一个 :root，第二个被拼成 `scope :root` 永不匹配；
//   4. scope 只加一个 class，权重打不过 layout.css 里 `#chat-room-screen .chat-input-wrapper`
//      这种自带 ID 的基础样式，谁后加载谁赢 —— 运行期才定，所以表现为随机失效；
//   5. 注释里的 META JSON 带 {}，不先剥掉就会被当成规则。
//
// 已知不处理（和本次修的问题无关，留着别当 bug 查）：
//   @keyframes / @font-face 的名字是文档级全局的，不同聊天用同名不同内容的动画或字体时
//   会互相顶掉。要修得给名字加后缀并回写引用处，那是另一件事。

(function (global) {
    'use strict';

    // 用 class 重复两次把权重抬到 (1 id, 3 class) 以上。
    // 目的是压过项目自带的 `#chat-room-screen .foo`（1 id, 1 class），
    // 这样用户不用自己写 !important 也能改动底栏底色、输入框圆角这些基础样式。
    // 选择器长得丑，但只存在于生成出来的 <style> 里，用户看不到。
    function buildScope(chatId) {
        const cls = `.chat-active-${chatId}`;
        return `#chat-room-screen${cls}${cls}`;
    }

    // ---------------------------------------------------------------
    // 扫描器：逐字符走，字符串和注释里的花括号一律不算结构
    // ---------------------------------------------------------------

    // 剥掉注释。必须按字符扫而不是正则替换，因为 content: "/*" 这种写法合法，
    // 正则会从字符串中间开始吃掉后面一大片。
    function stripComments(css) {
        let out = '';
        let i = 0;
        const n = css.length;
        while (i < n) {
            const c = css[i];
            if (c === '/' && css[i + 1] === '*') {
                const end = css.indexOf('*/', i + 2);
                i = end === -1 ? n : end + 2;
                // 用一个空格顶替，防止 `a/**/b` 被粘成 `ab`
                out += ' ';
                continue;
            }
            if (c === '"' || c === "'") {
                const quote = c;
                out += c;
                i++;
                while (i < n) {
                    if (css[i] === '\\') { out += css[i] + (css[i + 1] || ''); i += 2; continue; }
                    out += css[i];
                    if (css[i] === quote) { i++; break; }
                    i++;
                }
                continue;
            }
            out += c;
            i++;
        }
        return out;
    }

    // 从 openIndex（指向 '{'）找到配对的 '}'，跳过字符串。
    // 找不到就返回 css.length，让调用方把剩下的当成一整块（宽容处理未闭合的 CSS）。
    function findBlockEnd(css, openIndex) {
        let depth = 0;
        let i = openIndex;
        const n = css.length;
        while (i < n) {
            const c = css[i];
            if (c === '"' || c === "'") {
                const quote = c;
                i++;
                while (i < n) {
                    if (css[i] === '\\') { i += 2; continue; }
                    if (css[i] === quote) { i++; break; }
                    i++;
                }
                continue;
            }
            if (c === '{') depth++;
            else if (c === '}') {
                depth--;
                if (depth === 0) return i;
            }
            i++;
        }
        return n;
    }

    // 把一段 CSS 切成 [{ type, prelude, body }]。
    // type: 'style'（普通规则）| 'at-block'（带 {} 的 @ 规则）| 'at-statement'（以 ; 结尾的 @ 规则）
    function parseRules(css) {
        const rules = [];
        let i = 0;
        const n = css.length;

        while (i < n) {
            // 跳过空白
            while (i < n && /\s/.test(css[i])) i++;
            if (i >= n) break;

            // 找本条规则的边界：先遇到 '{' 就是块规则，先遇到 ';' 就是语句
            let j = i;
            let brace = -1;
            let semi = -1;
            while (j < n) {
                const c = css[j];
                if (c === '"' || c === "'") {
                    const quote = c;
                    j++;
                    while (j < n) {
                        if (css[j] === '\\') { j += 2; continue; }
                        if (css[j] === quote) { j++; break; }
                        j++;
                    }
                    continue;
                }
                if (c === '{') { brace = j; break; }
                if (c === ';') { semi = j; break; }
                j++;
            }

            if (brace === -1 && semi === -1) {
                // 尾部残留（比如只写了半个选择器），丢掉
                break;
            }

            if (semi !== -1 && (brace === -1 || semi < brace)) {
                const text = css.slice(i, semi + 1).trim();
                if (text) rules.push({ type: 'at-statement', text });
                i = semi + 1;
                continue;
            }

            const prelude = css.slice(i, brace).trim();
            const end = findBlockEnd(css, brace);
            const body = css.slice(brace + 1, end);
            rules.push({
                type: prelude.startsWith('@') ? 'at-block' : 'style',
                prelude,
                body
            });
            i = end + 1;
        }

        return rules;
    }

    // ---------------------------------------------------------------
    // 选择器改写
    // ---------------------------------------------------------------

    // 按顶层逗号切选择器组。括号里的逗号不算 —— :is(a, b)、:not(.x, .y)、nth-child(2n, 1)。
    function splitSelectorList(selectorText) {
        const parts = [];
        let buf = '';
        let depth = 0;
        let i = 0;
        const n = selectorText.length;
        while (i < n) {
            const c = selectorText[i];
            if (c === '"' || c === "'") {
                const quote = c;
                buf += c;
                i++;
                while (i < n) {
                    if (selectorText[i] === '\\') { buf += selectorText[i] + (selectorText[i + 1] || ''); i += 2; continue; }
                    buf += selectorText[i];
                    if (selectorText[i] === quote) { i++; break; }
                    i++;
                }
                continue;
            }
            if (c === '(' || c === '[') depth++;
            else if (c === ')' || c === ']') depth--;
            else if (c === ',' && depth === 0) {
                parts.push(buf);
                buf = '';
                i++;
                continue;
            }
            buf += c;
            i++;
        }
        parts.push(buf);
        return parts.map(s => s.trim()).filter(Boolean);
    }

    // 这些「指向文档根」的选择器要整体换成 scope，而不是加前缀。
    // 用户写 :root { --x: 1 } 是想定义变量给整套皮肤用，
    // 加前缀会变成 `scope :root` —— 后代里不存在 :root，规则直接失效（旧实现的坑 3）。
    const ROOT_LIKE = /^(:root|html|body)\b/i;

    function scopeSelector(selector, scope) {
        // 用户自己写了 #chat-room-screen：把它替换掉，不要叠成 `scope #chat-room-screen`
        if (selector.includes('#chat-room-screen')) {
            return selector.split('#chat-room-screen').join(scope);
        }
        // :root / html / body 开头：把那一段吃掉换成 scope，后面的组合器原样保留
        if (ROOT_LIKE.test(selector)) {
            const rest = selector.replace(ROOT_LIKE, '').trim();
            return rest ? `${scope} ${rest}` : scope;
        }
        return `${scope} ${selector}`;
    }

    function scopeSelectorList(selectorText, scope) {
        const scoped = splitSelectorList(selectorText)
            .map(s => scopeSelector(s, scope))
            .filter(Boolean);
        return scoped.length ? scoped.join(',\n') : '';
    }

    // ---------------------------------------------------------------
    // 生成
    // ---------------------------------------------------------------

    // 需要递归进去、并且要把外壳原样留下的条件组规则。
    // 旧实现整体丢掉外壳，@media 里的规则于是变成无条件生效（坑 1）。
    const CONDITIONAL_AT = /^@(media|supports|container|layer|scope|document)\b/i;
    // 内部不是选择器（是 0% / from / to 或描述符），一律原样输出，别去改写（坑 2）。
    const VERBATIM_AT = /^@(keyframes|-webkit-keyframes|-moz-keyframes|font-face|page|property|counter-style|font-feature-values|viewport)\b/i;

    function emit(rules, scope, indent) {
        let out = '';
        const pad = indent || '';

        for (const rule of rules) {
            if (rule.type === 'at-statement') {
                // @import / @charset：作用域是整个文档，塞进来只会污染全局，直接丢。
                // @namespace 同理。留着也没有正确的位置放。
                continue;
            }

            if (rule.type === 'at-block') {
                if (VERBATIM_AT.test(rule.prelude)) {
                    out += `${pad}${rule.prelude} {${rule.body}}\n`;
                    continue;
                }
                if (CONDITIONAL_AT.test(rule.prelude)) {
                    const inner = emit(parseRules(rule.body), scope, pad + '  ');
                    if (inner.trim()) {
                        out += `${pad}${rule.prelude} {\n${inner}${pad}}\n`;
                    }
                    continue;
                }
                // 没见过的 @ 规则：原样透传，别自作聪明改写
                out += `${pad}${rule.prelude} {${rule.body}}\n`;
                continue;
            }

            // 普通规则
            const props = rule.body.trim();
            if (!props) continue;
            const selectors = scopeSelectorList(rule.prelude, scope);
            if (!selectors) continue;
            out += `${pad}${selectors} { ${props} }\n`;
        }

        return out;
    }

    /**
     * 把用户 CSS 限制到指定聊天室。
     * @param {string} css   用户手写 / 基础面板生成的 CSS
     * @param {string} chatId 聊天 id（char_xxx / group_xxx），预览用 '__preview__'
     * @returns {string} 可以直接塞进 <style> 的 CSS
     */
    function scopeBubbleCss(css, chatId) {
        if (!css || !String(css).trim() || !chatId) return '';
        const scope = buildScope(chatId);
        return emit(parseRules(stripComments(String(css))), scope, '');
    }

    global.scopeBubbleCss = scopeBubbleCss;
    global.buildBubbleCssScope = buildScope;

    // 给 node 测试用（浏览器里 module 不存在，走上面的全局挂载）
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { scopeBubbleCss, buildScope };
    }
})(typeof window !== 'undefined' ? window : globalThis);
