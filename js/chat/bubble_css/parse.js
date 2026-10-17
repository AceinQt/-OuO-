// --- START OF FILE bubble_css/parse.js ---
// ======================================================================
// CSS → basicState（反解），外加一长串老预设的兼容迁移。
//
// 两条路：
//   · 有 /* META:{…} */ 注释 —— 直接 JSON.parse，再逐字段浅合并到默认值上
//   · 没有（用户手写 / 别人分享的纯 CSS）—— 退回正则硬扫选择器
//
// ★ 这是「把一份 CSS 装进面板」的唯一入口（换预设 / 启动兜底 / 粘贴完整外观
//   都走它），所以开头统一 resetEditTargets()、结尾统一 updateUIFromState()。
//   这两句的顺序是修过的 bug，别动（见 panel.js 里 resetEditTargets 的注释）。
//
// ★ 这一组文件原先是一个 3074 行的 js/chat/bubble_css_preset.js。
//   拆分的前置条件是把共享状态从 setupBubblePresets 的闭包里提到**脚本级** ——
//   这个项目用的是普通 <script>（不是 ESM），脚本级的 let/const 跨文件可见但
//   不挂在 window 上（同 showToast / AppUI 那批）。所以 basicState 这些
//   在 state.js 里声明、在别的文件里直接用，不需要 import 也不需要命名空间对象。
//
// ★ 加载顺序写在 index.html 里，必须是：
//     state → css_io → store → preview → generate → panel → parse → wire → help_text
//   而且整组必须排在 bubble_css_scope.js **后面**（generate / preview 都调 scopeBubbleCss）、
//   chat_settings.js **前面**（那边调 _getBubblePresets / getBarCollapseFromCss）。
//   函数声明本身是提升的、互相调用不看顺序，排序是为了：
//     · state.js 里 `let basicState = …defaultBasicState…` 要在同文件内先声明；
//     · help_text.js 的 AppHelp.register 在**加载时**就执行，得等 utils.js 先到；
//     · 测试把这 9 个文件按这个顺序拼起来当一整份源码读（见 tests/_bubble_css_src.cjs），
//       有几条断言是跨文件切片的（比如 updateUIFromState → syncBasicUiFromCss）。
// ======================================================================


function syncBasicUiFromCss(css) {
    // 这个函数是「把一份 CSS 装进面板」的唯一入口（换预设、启动兜底、粘贴别人分享的
    // 完整外观都走它），所以三个「修改对象」下拉就在这里统一归位 —— 放在调用点手写
    // 容易漏，漏掉的那一处就是用户报的「切完预设选不中发送按钮」。
    // 末尾那句 updateUIFromState() 会把归位后的值回显出去，顺序已经是对的。
    resetEditTargets();
    if (!css) { basicState = JSON.parse(JSON.stringify(defaultBasicState)); }
    else {
        const metaMatch = css.match(/\/\* META:(.+?) \*\//);
        let parsedFromMeta = false;
        if (metaMatch && metaMatch[1]) {
            try {
                const parsed = JSON.parse(metaMatch[1]);
                // 兼容迁移：旁白曾经是**一个** `narration` 键（两侧共用一套设置，
                // 我方靠生成端硬写 border:none 区分）。现在拆成 narration_sent /
                // narration_received 两键，所以把老值往两边各复制一份。
                // ★ 我方那份必须把描边清零 —— 老版本我方**实际渲染出来**就是没描边的，
                //   原样复制过去会让老预设一加载就凭空长出一圈描边（用户看到的是
                //   "我啥也没动，我方旁白怎么多了条线"）。
                // ★ 比这更老的预设里也出现过 narration_sent/narration_received 这两个键名
                //   （那时候还没有"我方旁白"这个概念，是另一套语义）。它们键名正好对得上，
                //   原样放行即可，不值得为那批数据再猜一层。
                if (parsed.styles && parsed.styles.narration) {
                    const legacy = parsed.styles.narration;
                    if (!parsed.styles.narration_received) {
                        parsed.styles.narration_received = { ...legacy };
                    }
                    if (!parsed.styles.narration_sent) {
                        parsed.styles.narration_sent = { ...legacy, strokeW: 0, strokeSides: [] };
                    }
                    delete parsed.styles.narration;
                }

                // 【核心修复】使用深度合并，坚决防止 defaultBasicState 里的默认属性被意外覆盖为 undefined
                basicState = JSON.parse(JSON.stringify(defaultBasicState));
                if (parsed.hideAvatar !== undefined) basicState.hideAvatar = parsed.hideAvatar;
                // 时间位置：老预设存的是布尔 showTime（那时候只有"气泡上方"一个位置），
                // 迁移成 timePos。两个都在时以新的为准 —— 生成端已经不写 showTime 了，
                // 还留着的一定是更老的那份。
                if (parsed.timePos !== undefined) {
                    basicState.timePos = parsed.timePos;
                } else if (parsed.showTime !== undefined) {
                    basicState.timePos = parsed.showTime ? 'above' : 'none';
                }
                if (parsed.timeFormat !== undefined) basicState.timeFormat = parsed.timeFormat;
                if (parsed.avatarRadius !== undefined) basicState.avatarRadius = parsed.avatarRadius;
                if (parsed.customFont !== undefined) basicState.customFont = parsed.customFont;
                if (parsed.marginY !== undefined) basicState.marginY = parsed.marginY;
                if (parsed.marginX !== undefined) basicState.marginX = parsed.marginX;

                // 顶栏/底栏是后加的，比它早的预设里这两个键根本不存在 ——
                // 一律浅合并到默认值上，缺的字段就按默认走。
                if (parsed.header) {
                    basicState.header = { ...defaultBasicState.header, ...parsed.header };
                    // header 底下也嵌着三个对象（返回键 / 昵称栏 / 按钮组），同 footer：
                    // 外层那次浅合并会把 parsed 里存在的那个键**整块**顶掉，所以每个
                    // 再单独合一次，底板必须取 defaultBasicState。
                    ['back', 'title', 'group'].forEach(k => {
                        if (parsed.header[k]) {
                            basicState.header[k] = { ...defaultBasicState.header[k], ...parsed.header[k] };
                        }
                    });
                    // 兼容迁移：顶栏按钮曾经只有**一组**平铺的 radius/strokeW/strokeC，
                    // 而且画在**每颗按钮**身上（返回 + 通话 + 菜单各得一个框）。
                    // 现在按块走，所以把老值搬到返回键和按钮组上
                    // （昵称栏那时候压根没有样式可言，不搬）。
                    // ★ 只搬**真被用户改过**的：老默认是 radius 8 / strokeW 0 / strokeC #000000，
                    //   原样搬过去会让"从没动过顶栏"的老预设凭空生成 border-radius:8px。
                    // ★ 判定为改过就三项一起搬：radius 8 是配着描边看的，
                    //   只搬描边会把圆角框变成直角框。
                    const legacyHdr = parsed.header;
                    const legacyTouched =
                        (legacyHdr.radius !== undefined && legacyHdr.radius !== 8)
                        || (legacyHdr.strokeW !== undefined && legacyHdr.strokeW !== 0)
                        || (legacyHdr.strokeC !== undefined
                            && String(legacyHdr.strokeC).toUpperCase() !== '#000000');
                    if (legacyTouched) {
                        ['back', 'group'].forEach(k => {
                            if (parsed.header[k]) return;   // 已经是新结构了，别回头覆盖
                            const blk = basicState.header[k];
                            if (legacyHdr.radius !== undefined) blk.radius = legacyHdr.radius;
                            if (legacyHdr.strokeW !== undefined) blk.strokeW = legacyHdr.strokeW;
                            if (legacyHdr.strokeC !== undefined) blk.strokeC = legacyHdr.strokeC;
                        });
                    }
                    // 平铺的老字段不留在 state 里 —— 留着会被下一次保存原样写回 META，
                    // 下次加载又触发一遍上面这段迁移（而那时三块可能已经被用户改过了）。
                    delete basicState.header.radius;
                    delete basicState.header.strokeW;
                    delete basicState.header.strokeC;
                    // 昵称栏的「贴合文字」(fit, 布尔) 已被「宽度占比」(widthPct) 顶替。
                    // 不迁移 —— "贴着文字"没有对应的百分比，硬折算成某个数反而更难解释；
                    // 丢掉等于退回 100%（占满空档），用户照自己的眼睛重新拨一个数就行。
                    if (basicState.header.title) delete basicState.header.title.fit;
                }
                if (parsed.footer) {
                    basicState.footer = { ...defaultBasicState.footer, ...parsed.footer };
                    // footer 里还嵌着三个对象。上面那层浅合并会把 parsed 里存在的那个键
                    // **整块**顶掉，所以每个对象得再单独合一次，底板必须取
                    // defaultBasicState（basicState.footer[k] 此刻已经是 parsed 的版本了）。
                    ['send', 'reply', 'input'].forEach(k => {
                        if (parsed.footer[k]) {
                            basicState.footer[k] = { ...defaultBasicState.footer[k], ...parsed.footer[k] };
                        }
                    });
                    // 工具栏图标的「线条粗细」(btnW → --bar-icon-stroke) 短命地存在过一版，
                    // 发现 6 颗里只有 2 颗是线型、调了反而粗细不一，当天就删了。
                    // 上面那层浅合并会把 parsed 里的 btnW 原样带进来、再写回 META 一直传下去，
                    // 所以显式丢掉（同 header.title.fit 那条的处理）。不迁移：没有等价的新字段。
                    delete basicState.footer.btnW;
                }
                
                if (parsed.styles) {
                    for (const key in parsed.styles) {
                        if (basicState.styles[key]) {
                            basicState.styles[key] = { ...basicState.styles[key], ...parsed.styles[key] };
                        }
                    }
                }
                parsedFromMeta = true;
            } catch(e) { console.error('解析META配置失败', e); }
        }
        
        // ======== 终极进阶版：支持基类提取、分段合并读取与子元素防误伤 ========
        if (!parsedFromMeta) {
            basicState = JSON.parse(JSON.stringify(defaultBasicState));
            
            function extractColorToHexAndAlpha(colorStr) {
                colorStr = colorStr.trim().toLowerCase();
                if (colorStr.startsWith('rgba')) {
                    let m = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
                    if (m) {
                        let r = parseInt(m[1]).toString(16).padStart(2, '0');
                        let g = parseInt(m[2]).toString(16).padStart(2, '0');
                        let b = parseInt(m[3]).toString(16).padStart(2, '0');
                        let a = m[4] !== undefined ? parseFloat(m[4]) : 1;
                        return { hex: `#${r}${g}${b}`.toUpperCase(), alpha: a };
                    }
                } else if (colorStr.startsWith('rgb')) {
                    let m = colorStr.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
                    if (m) {
                        let r = parseInt(m[1]).toString(16).padStart(2, '0');
                        let g = parseInt(m[2]).toString(16).padStart(2, '0');
                        let b = parseInt(m[3]).toString(16).padStart(2, '0');
                        return { hex: `#${r}${g}${b}`.toUpperCase(), alpha: 1 };
                    }
                } else if (colorStr.startsWith('#')) {
                    if (colorStr.length === 4) {
                        let r = colorStr[1], g = colorStr[2], b = colorStr[3];
                        return { hex: `#${r}${r}${g}${g}${b}${b}`.toUpperCase(), alpha: 1 };
                    } else if (colorStr.length === 9) {
                        let alpha = parseInt(colorStr.substring(7, 9), 16) / 255;
                        return { hex: colorStr.substring(0, 7).toUpperCase(), alpha: parseFloat(alpha.toFixed(2)) };
                    } else {
                        return { hex: colorStr.substring(0, 7).toUpperCase(), alpha: 1 };
                    }
                }
                return null;
            }

            function parseRulesToState(rules, targetStateObj) {
                const bgMatch = rules.match(/background-color:\s*([^!;}]+)/i) || rules.match(/(?:^|[^-])background:\s*([^!;}]+)/i);
                if (bgMatch && !bgMatch[1].includes('url')) {
                    const parsedColor = extractColorToHexAndAlpha(bgMatch[1]);
                    if (parsedColor) {
                        targetStateObj.bg = parsedColor.hex;
                        targetStateObj.opacity = parsedColor.alpha;
                    }
                }
                const colorMatch = rules.match(/(?:^|[^a-z-])color:\s*([^!;}]+)/i);
                if (colorMatch) {
                    const parsedColor = extractColorToHexAndAlpha(colorMatch[1]);
                    if (parsedColor) targetStateObj.fontColor = parsedColor.hex;
                }
                const fontMatch = rules.match(/font-size:\s*([\d.]+)px/i);
                if (fontMatch) targetStateObj.fontSize = parseFloat(fontMatch[1]);

                const radiusMatch = rules.match(/border-radius:\s*([\d.]+)px/i);
                if (radiusMatch) targetStateObj.radius = parseFloat(radiusMatch[1]);

                const blurMatch = rules.match(/blur\(([\d.]+)px\)/i);
                if (blurMatch) targetStateObj.blur = parseFloat(blurMatch[1]);

                const borderMatch = rules.match(/(?:^|[^-])border:\s*([\d.]+)px\s+(?:solid\s+)?([^!;}]+)/i);
                if (borderMatch) {
                    targetStateObj.strokeW = parseFloat(borderMatch[1]);
                    const parsedColor = extractColorToHexAndAlpha(borderMatch[2]);
                    if (parsedColor) targetStateObj.strokeC = parsedColor.hex;
                    targetStateObj.strokeSides =['top', 'right', 'bottom', 'left'];
                } else {
                    let foundSide = false;
                    let sides =[];['top', 'right', 'bottom', 'left'].forEach(side => {
                        const regex = new RegExp(`border-${side}:\\s*([\\d.]+)px\\s+(?:solid\\s+)?([^!;}]+)`, 'i');
                        const match = rules.match(regex);
                        if (match) {
                            targetStateObj.strokeW = parseFloat(match[1]); 
                            const parsedColor = extractColorToHexAndAlpha(match[2]);
                            if (parsedColor) targetStateObj.strokeC = parsedColor.hex;
                            sides.push(side);
                            foundSide = true;
                        }
                    });
                    if (foundSide) {
                        targetStateObj.strokeSides = sides;
                    }
                }
            }

            let baseBubbleRules = "";
            const baseRegex = /\.message-bubble(?![^{]*\.(?:sent|received))\s*(?:,[^{]*)?\{([^}]+)\}/ig;
            let baseMatch;
            while ((baseMatch = baseRegex.exec(css)) !== null) { baseBubbleRules += baseMatch[1] + ";"; }

            if (baseBubbleRules) {
                parseRulesToState(baseBubbleRules, basicState.styles['normal_sent']);
                parseRulesToState(baseBubbleRules, basicState.styles['normal_received']);
            }

            const classMap = {
                'normal_sent': /\.message-bubble\.sent\s*(?:,[^{]*)?\{([^}]+)\}/ig,
                'normal_received': /\.message-bubble\.received\s*(?:,[^{]*)?\{([^}]+)\}/ig,
                'narration_received': /\.narration-bubble[^{]*\{([^}]+)\}/ig,
                'narration_sent': /\.narration-bubble[^{]*\{([^}]+)\}/ig,
                'voice_sent': /\.sent\s+\.voice-bubble\s*(?:,[^{]*)?\{([^}]+)\}/ig,
                'voice_received': /\.received\s+\.voice-bubble\s*(?:,[^{]*)?\{([^}]+)\}/ig,
                'transfer_sent': /\.sent(?:-transfer|\s+\.transfer-card)\s*(?:,[^{]*)?\{([^}]+)\}/ig,
                'transfer_received': /\.received(?:-transfer|\s+\.transfer-card)\s*(?:,[^{]*)?\{([^}]+)\}/ig,
                'quote_sent': /\.sent\s+\.quoted-message\s*(?:,[^{]*)?\{([^}]+)\}/ig,
                'quote_received': /\.received\s+\.quoted-message\s*(?:,[^{]*)?\{([^}]+)\}/ig
            };

            for (const[key, regex] of Object.entries(classMap)) {
                let match; let combinedRules = "";
                while ((match = regex.exec(css)) !== null) { combinedRules += match[1] + ";"; }
                if (combinedRules) {
                    parseRulesToState(combinedRules, basicState.styles[key]);
                }
            }

            // 我方旁白（.narration-mine）的专属规则最后再盖一次：上面两侧都先吃了一遍
            // 通用的 `.narration-bubble`，这一遍把"我方单独改过的那部分"补上。
            // 已知不精确：那条通用正则也会吃到 `.narration-mine … .narration-bubble`，
            // 于是我方的值会渗进对方那份。这条回退路径只在**手写 CSS 且没有 META 注释**时
            // 才跑（生成端一律带 META），不值得为它再写一个选择器解析器。
            const mineNarrationRegex = /\.narration-mine[^{]*\.narration-bubble[^{]*\{([^}]+)\}/ig;
            let mineMatch; let mineRules = "";
            while ((mineMatch = mineNarrationRegex.exec(css)) !== null) { mineRules += mineMatch[1] + ";"; }
            if (mineRules) {
                parseRulesToState(mineRules, basicState.styles['narration_sent']);
            }

            if (/(?:\.message-avatar|\.avatar|avatar)[^{]*\{[^}]*(?:display:\s*none|opacity:\s*0|visibility:\s*hidden)/i.test(css) ||
                /\.message-info[^{]*\{[^}]*display:\s*none/i.test(css)) {
                basicState.hideAvatar = true;
            }

            // 手写 CSS 里把某个时间槽位放出来了就把下拉回显到对应位置，否则用户一碰别的
            // 滑块，生成端会按"当前是不显示"补一段规则，把他自己写的那条顶掉。
            // 顺序即优先级：三个都写了的话按"最靠后的那个位置"算，反正手写成这样本来就没定论。
            if (/\.message-time\b[^{]*\{[^}]*display:\s*(?!none)[a-z-]+/i.test(css)) {
                basicState.timePos = 'above';
            }
            if (/\.message-time-avatar[^{]*\{[^}]*display:\s*(?!none)[a-z-]+/i.test(css)) {
                basicState.timePos = 'avatar';
            }
            if (/\.message-time-tail[^{]*\{[^}]*display:\s*(?!none)[a-z-]+/i.test(css)) {
                basicState.timePos = 'tail';
            }

            // 头像圆角同理。`50%` 和 19px 都算正圆（头像 38px）。
            const avatarRadiusMatch = css.match(/\.message-avatar\s*\{[^}]*border-radius:\s*([\d.]+)(px|%)/i);
            if (avatarRadiusMatch) {
                const num = parseFloat(avatarRadiusMatch[1]);
                basicState.avatarRadius = (avatarRadiusMatch[2] === '%')
                    ? 19
                    : Math.max(0, Math.min(19, Math.round(num)));
            }
            
            const fontFaceMatch = css.match(/@font-face\s*\{[^}]*src:\s*url\(['"]([^'"]+)['"]\)/i);
            if (fontFaceMatch) { basicState.customFont = fontFaceMatch[1]; }
        }
    }
    updateUIFromState();
}
