const appVersion = "Q.2.2"; // Current app version
            const updateLog = [
            {
                    version: "Q.2.2",
                    date: "2026-09-28",
                    notes: [
                        "✨ 新功能",
                        "1.通话工具栏",
                        "(1)原通话模式右上角的「历史记录」改成了工具按钮，点击呼出工具栏，目前包含三项功能；",
                        "(2)重新生成：可以重 roll 本轮角色生成的消息；",
                        "(3)历史记录：查看先前的通话消息；",
                        "(4)语音接入：开启后角色消息会自动转成语音消息并播放，也可以在聊天室侧边栏的音色设置弹窗里开启。",
                        "🌱 功能优化",
                        "1.论坛",
                        "(1)新增论坛管理功能，入口在底部「世界」—左侧「管理」，原来的论坛 API 设置和帖子 css 设置都挪到这里了；",
                        "(2)新增按日期批量删除帖子，可选是否过滤「收藏」和「在看」的帖子；",
                        "(3)论坛首页长按可以进入多选模式，支持对选中的帖子批量删除、收藏、转发。",
                        "2.多选模式",
                        "(1)新增「显示隐藏」按钮，开启后可以显示隐藏消息，便于删除管理；",
                        "(2)多选模式下可以删除时间戳、通话消息块等原本不支持多选删除的消息。",
                        "3.用户旁白消息",
                        "(1)修改样式，与角色旁白基本一致，相邻气泡合并，原有气泡无变化；",
                        "(2)长按编辑区分旁白与系统提示；",
                        "(3)不再重复发送两条，系统可见与用户可见的旁白合并为一条。",
                        "4.外观",
                        "(1)旁白区分为我方和对方两种；",
                        "(2)新增头像弧度选项；",
                        "(3)新增时间戳选项，可以自定义时间戳格式。",
                        "🔧 问题修复",
                        "1.修复进入聊天列表页面时卡顿的问题；",
                        "2.修复进入论坛世界页面卡顿的问题；",
                        "3.修复开启系统返回功能时可能会自动重启的问题；",
                        "4.修复挂断通话可能导致通话最后的消息丢失的问题；",
                        "5.修复通话历史消息中用户名称显示为「用户」的问题；",
                        "6.修复专注设置侧边栏无法打开的问题；",
                        "7.修复分享帖子时无法触发时间感知的问题。"
                    ]
            }
            ];
// ★ 更新日志只保留最新一版，发正式版时**替换**这一条，不要往下堆历史。
// 以前这里堆了 14 个版本（Q.2.0 → 1.1.0）。两个问题：旧条目描述的操作方式早就跟着改版失效
// 了（比如「长按菜单转文字」），留着反而误导人；而且全量渲染出来一万多 px，被折叠条的
// max-height 砍掉一半，后面的版本根本看不见。
// 功能怎么用以教程页（js/settings/tutorial.js 的 usageModules）为准 —— 那边随时更新，
// 改了功能就同步改对应模块，不用等发版。
              
                                          // --- NEW: Update Log Functions ---
                function renderUpdateLog() {
                    const tutorialContent = document.getElementById('tutorial-content-area');
                    if (!tutorialContent) return;

                    const updateSection = document.createElement('div');
                    updateSection.className = 'tutorial-item'; // Use tutorial-item class, default open

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
                        // Use a small delay to ensure the main UI has rendered
                        setTimeout(showUpdateModal, 500);
                    }
                }
                
  let loadingBtn = false;