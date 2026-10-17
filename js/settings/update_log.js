const appVersion = "Q.2.3"; // 面向用户的正式版号，仅在发布正式版时更新
            const updateLog = [
            {
                    version: "Q.2.3",
                    date: "2026-10-17",
                    notes: [
                        "✨ 新功能",
                        "1.论坛",
                        "(1)新增论坛搜索功能，入口在「世界 → 管理」。可自行选择标题、正文、评论等搜索范围，点击结果可直接跳转到对应帖子。",
                        "2.聊天室外观",
                        "(1)新增顶栏外观设置，包括各组件颜色、布局、收纳通话按钮等设置；",
                        "(2)新增底栏外观设置，包括各组件颜色及按钮收纳等设置；",
                        "(3)新增消息时间、时间分割线、系统提示和群昵称等小字的外观设置；",
                        "(4)为每块设置增加了提示说明，点击带圈的问号就可以看到；",
                        "(5)新增外观预设复制按钮，可通过右上角「管理」按钮调出管理弹窗后操作。",
                        "3.分类清空",
                        "(1)入口在「主页 → 设置 → 存储备份」；",
                        "(2)支持单独清空某一类数据，也支持清空所有数据，清空以后无法恢复；",
                        "(3)偷看手机数据、记忆跟随角色数据管理，清空角色数据时会把这两项也一起清空。",
                        "4.Flex 请求",
                        "(1)在 API 设置中勾选即可开启 AI Studio 和 Vertex API 的 Flex 请求：慢但半价。不是每个模型都支持，同一个模型在 Vertex 和 AI Studio 的支持情况也可能不同。",
                        "🌱 功能优化",
                        "1.聊天室底部栏",
                        "(1)调整底部栏 SVG 图标的视觉风格与粗细，与 + 号面板中的图标风格保持一致；",
                        "(2)更改 + 号面板展开方式，不再遮挡输入框；",
                        "(3)为避免误触，将重新生成按钮收纳至 + 号面板，并增加了二次确认。",
                        "2.语音功能",
                        "(1)API 设置页面增加重播及下载按钮，防止试听不小心没听到，还需要反复消耗额度去听；",
                        "(2)语气要求字数限制提升到 2000 字，因为发现原来的连 MiniMax 官方生成提示都放不下 (•́ω•̀ ٥)；",
                        "(3)通话过程中，如果你已发言、角色还没发言，点击工具栏中的「撤回发言」可以删除你的发言，并增加了二次确认提示。",
                        "3.总结",
                        "(1)长期总结支持修改日期范围。",
                        "🔧 问题修复",
                        "1.识图超时时间默认改为 120 秒，并支持自定义，修复识图超过 60 秒必定失败的问题；",
                        "2.修复部分 SVG 图标在 iOS 不显示的问题（包括外观页面工具栏、论坛保存按钮）；",
                        "3.修复外观页面的顶部栏不显示的问题；",
                        "4.删除已经不适用的主屏幕自定义聊天室相关快捷 CSS，修改这些内容可以直接去外观页面；",
                        "5.修复全局 CSS 美化失效的问题；",
                        "6.修复安卓无法导入外观 JSON 文件的问题；",
                        "7.修复导出外观预设默认为全部预设的问题，现在只导出当前预设；",
                        "8.修复气泡描边后，每行会缺少一个字符的问题；",
                        "9.修复发送的聊天中存在图片时向量记忆失效的问题；",
                        "10.修复长期总结日期未输入前导 0 会导致总结内容不全的问题。"
                    ]
            }
            ];
// ★ 更新日志只保留最新一版，发正式版时**替换**这一条，不要往下堆历史。
// 以前这里堆了 14 个版本（Q.2.0 → 1.1.0）。两个问题：旧条目描述的操作方式早就跟着改版失效
// 了（比如「长按菜单转文字」），留着反而误导人；而且全量渲染出来一万多 px，被折叠条的
// max-height 砍掉一半，后面的版本根本看不见。
// 功能怎么用以教程页（js/settings/tutorial.js 的 usageModules）为准 —— 那边随时更新，
// 改了功能就同步改对应模块，不用等发版。
              
                                          // --- 更新日志渲染与提示 ---
                function renderUpdateLog() {
                    const tutorialContent = document.getElementById('tutorial-content-area');
                    if (!tutorialContent) return;

                    const updateSection = document.createElement('div');
                    updateSection.className = 'tutorial-item'; // 复用教程条目样式，展开/收起由统一点击事件控制

                    let notesHtml = '';
                    updateLog.forEach((log, index) => {
                        const isLast = index === updateLog.length - 1;
                        // 版本之间留间距 + 分隔线，最后一版两样都不要 —— 收起时 .tutorial-content
                        // 是 max-height:0 + overflow:hidden，但末尾这 15px margin 在展开时会顶出
                        // 一块比别的条目厚的空白。
                        const sep = isLast ? '' : 'margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid #f0f0f0;';
                        notesHtml += `
                        <div style="${sep}">
                            <h4 style="font-size: 15px; color: #333; margin: 0 0 5px 0;">版本 ${log.version} (${log.date})</h4>
                            <ul style="padding-left: 20px; margin: 0; list-style-type: '› ';">
                                ${log.notes.map(note => `<li style="margin-bottom: 5px; color: #666;">${note}</li>`).join('')}
                            </ul>
                        </div>
                    `;
                    });

                    // ★ 这里的 .tutorial-content 不能带 inline style。
                    // 原先写了 style="padding-top: 15px;"，inline 优先级高于 tutorial.css 里
                    // 收起态的 `.tutorial-content { padding: 0 10px }`，于是「更新日志」这一条
                    // 收起时也顶着 15px 的 padding —— 表现就是它比别的条目高一截、底下空一块。
                    // 展开态的内边距交给 `.tutorial-item.open .tutorial-content` 统一管。
                    updateSection.innerHTML = `
                    <div class="tutorial-header">版本更新内容</div>
                    <div class="tutorial-content">
                        ${notesHtml}
                    </div>
                `;

                    tutorialContent.appendChild(updateSection);
                }

                function showUpdateModal() {
                    const modal = document.getElementById('update-log-modal');
                    const contentEl = document.getElementById('update-log-modal-content');
                    const closeBtn = document.getElementById('close-update-log-modal');

                    const latestLog = updateLog[0];
                    if (!latestLog) return;

                    contentEl.innerHTML = `
                    <h4>版本 ${latestLog.version} (${latestLog.date})</h4>
                    <ul>
                        ${latestLog.notes.map(note => `<li>${note}</li>`).join('')}
                    </ul>
                    <p style="font-size: 12px; color: #888; text-align: center; margin-top: 15px; border-top: 1px solid #eee; padding-top: 10px;">完整使用说明可在“教程与更新”内查看。</p>
                `;

                    modal.classList.add('visible');

                    closeBtn.onclick = () => {
                        modal.classList.remove('visible');
                        localStorage.setItem('lastSeenVersion', appVersion);
                    };
                }

                function checkForUpdates() {
                    const lastSeenVersion = localStorage.getItem('lastSeenVersion');
                    if (lastSeenVersion !== appVersion) {
                        // 稍作延迟，等主界面渲染后再弹出更新提示
                        setTimeout(showUpdateModal, 500);
                    }
                }
                
  let loadingBtn = false;