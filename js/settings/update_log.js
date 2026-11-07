const appVersion = "Q.2.4"; // 面向用户的正式版号，仅在发布正式版时更新
            const updateLog = [
            {
                    version: "Q.2.4",
                    date: "2026-11-07",
                    notes: [
                        "✨ 新功能",
                        "1.API 调用明细",
                        "(1)因为开始用 Vertex 赠金，所以做了这个功能，方便估算用量。目前自己核对预估和账单，误差在 1 日元左右，仅供参考，实际费用仍以服务商账单为准；",
                        "(2)入口在「主页 → 设置 → API 调用明细」，支持查看每次调用的结果、缓存命中及费用预估。费用预估需要先在 API 设置中填入对应预设的价格并保存；",
                        "(3)默认显示当天、文字 API 的统计；想看全部记录，请调整日期范围，并在筛选里全选 API 类型和功能；",
                        "(4)支持导出和清除当前查询范围内的记录，不限于表格已经加载的行。记录会一直保存在本机浏览器存储中，不会自动过期，请按需备份或清理。",
                        "2.缓存优化",
                        "(1)开关在聊天室右上角设置菜单，默认关闭，每个聊天室单独设置；",
                        "(2)开启后会调整提示词顺序，让请求前缀更稳定，因此也可能影响回复质量，不适应时关闭即可；",
                        "(3)缓存命中不保证。个人使用中 Gemini 有时隔 1 分钟就掉缓存；Claude（5 分钟～1 小时）、GPT（12 小时）或 DeepSeek（甚至几天）可能更明显。这些只是使用参考，具体仍取决于模型、服务商和缓存条件，请以调用明细为准。",
                        "3.正则",
                        "(1)原世界书入口现在也是正则的入口，点击左侧「正则」Tab 即可管理规则；",
                        "(2)新增或编辑页面右上角的问号有完整说明，每个小标题右侧的问号有对应字段说明，可以复制给 AI 帮忙制作正则；",
                        "(3)支持「修改并保存」和「仅显示替换」：前者永久修改新生成的正文，适合去掉不想要的套话；后者只改变显示，实际记录仍保留原文，适合酒馆状态栏等 HTML 卡片。HTML 卡片固定使用仅显示替换；",
                        "(4)和世界书一样，关联后即可使用。目前聊天室和论坛都支持按类别关联正则，私聊还可分别选择线上、线下生效。",
                        "🌱 功能优化",
                        "1.API 设置",
                        "(1)由于 Vertex 官方接口不支持网页直连所需的 Flex 请求头，移除 Vertex 直连的 Flex 选项；",
                        "(2)新增 OpenAI 兼容格式（NewAPI）的 Flex 支持，需要相关代理项目支持该参数；Gemini 原生接口的 Flex 选项继续保留。",
                        "2.默认图片替换",
                        "(1)项目内的默认图片全部替换为自制图片；",
                        "(2)去掉转账气泡的底图，并重新调整了转账气泡样式。",
                        "3.总结",
                        "(1)支持修改生成长期总结时的起始日期。",
                        "4.世界书",
                        "(1)重做世界书界面，优化世界书过多时进入页面卡顿的问题；",
                        "(2)私聊世界书关联分为线上、线下，可选择只在线上或只在线下生效；",
                        "(3)原「前」「后」「写作」更名为「世界观」「重要事项」「文风」，与实际提示词内容保持一致；注入位置不变，只是方便理解。",
                        "5.长按编辑",
                        "(1)新增「HTML 块（正则显示）」选项。当 AI 输出格式不对、正则未匹配而显示为普通气泡时，可以长按编辑，选择已关联的 HTML 规则并修正原文，重新显示为 HTML 卡片。",
                        "🔧 问题修复",
                        "1.修复无法撤回指定消息的问题；",
                        "2.修复偷看手机草稿箱无法多选删除的问题；",
                        "3.修复分享卡片在内容太少时变形的问题。"
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