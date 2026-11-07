// 论坛只绑定正则大类，不区分线上/线下，也不把表达式注入模型提示词。
// 两个处理阶段复用聊天引擎：存储型仅处理新 AI 正文，显示型不改变帖子/评论记录。
(function () {
    function replaceBody(record, stage) {
        const text = String(record?.content ?? '');
        if (!record || record.isUser || record.forumUserAuthored || !window.ChatRegex) return { text, changed: false };
        const result = ChatRegex.replaceText(text, ChatRegex.getRules(db.forumBindings || {}, 'forum', stage));
        ChatRegex.reportErrors(result.errors);
        return result;
    }

    function applyStorage(record) {
        if (!record || record.isUser || record.forumUserAuthored || record.forumRegexApplied) return record;
        const result = replaceBody(record, 'storage');
        if (result.changed) {
            record.content = result.text;
            // 标记已处理，避免同一条内容再次经过保存入口时重复替换；不留原文副本。
            record.forumRegexApplied = true;
        }
        return record;
    }

    function renderBody(container, record, format) {
        container.classList.remove('regex-html-bubble', 'regex-html-card');
        const result = replaceBody(record, 'display');
        // 旧存储卡片只保留渲染兼容，新规则不会再写 forumRegexHtml 或保存模板。
        const interactive = !record.isUser && !record.forumUserAuthored && (result.html || record.forumRegexHtml === true);
        if (interactive || ((result.changed || record.forumRegexApplied) && /<\/?[a-z][^>]*>/i.test(result.text))) {
            ChatRegex.renderHtmlPreview(container, result.text, { interactive });
        } else {
            container.innerHTML = DOMPurify.sanitize(format(result.text));
        }
        return result;
    }

    window.ForumRegex = { replaceBody, applyStorage, renderBody };
})();
