const appVersion = "Q.2.1"; // Current app version
            const updateLog = [
            {
                    version: "Q.2.1",
                    date: "2026-09-13",
                    notes: [
                        "✨ 新功能",
                        "1.API 配置",
                        "(1)新增 Vertex 支持。是为了配合我自己用的快速模式 vertex 做的，理论上付费 vertex 也能用，但没有尝试；",
                        "(2)同时优化了原生 Gemini 格式的适配，除聊天以外的功能现在也走得通 Gemini 原生格式了。",
                        "2.MiniMax 语音",
                        "(1)语音新增 MiniMax 服务商，地址默认填的是中文站（api.minimaxi.com，多一个 i 的那个），可以自己改成海外站；",
                        "(2)为保证统一性，删掉了 API 界面原有的「音量」「声音描述」两个参数。想加语气词之类的要求，请到聊天设置里新增的描述框填。",
                        "3.生图功能",
                        "(1)新增 Vertex 接口方式的 Gemini 生图；",
                        "(2)新增 NovelAI 生图，自定义站点把 url 改一改也能支持，试了一张可以正常生成对应要素的图像。但是负面提示词还有画师串这些没有测试（因为不太懂这些），如果有问题反馈一下吧；",
                        "(3)另外如果要编辑生图的内容，请使用 novelai 支持的描述方式，否则可能会生成奇怪的东西。",
                        "4.转发分享功能",
                        "(1)发送入口在聊天室「+」面板，替代原来的「赠送礼物」；",
                        "(2)类似于一个万能分享卡片，可以点开。不管是文件、链接、外卖都可以通过这个功能发送；",
                        "(3)原论坛分享气泡和本功能的气泡合并了；",
                        "(4)原长按「删除」改为「多选」，点击后可进入多选界面，选中的聊天记录可以删除也可以转发给其他角色。",
                        "🌱 功能优化",
                        "1.顶部弹窗",
                        "(1)支持点击跳转到对应窗口；",
                        "(2)优化显示内容，修改状态等不可见消息不再提示。",
                        "2.论坛",
                        "(1)帖子的 new 标记优化为看完就消失，评论同理；",
                        "(2)分享到聊天室的帖子现在可以点开看内容了。",
                        "3.加载",
                        "(1)优化备份页面加载，加载、备份期间无法退出页面，避免中断导致数据遗失；",
                        "(2)优化聊天搜索加载，点击搜索后搜索框立刻消失，避免二次发起搜索；",
                        "(3)外部链接载入改为本地载入，避免图床失效导致默认头像、图片等内容失效。",
                        "4.教程与更新",
                        "(1)重写了教程页面内容（glm 写的，ds 根据最新内容改的）；",
                        "(2)更新内容只保留最新版本，避免老版日志中不适用的内容误导。",
                        "🔧 问题修复",
                        "1.修复表情包存储路径错误可能丢失问题；",
                        "2.修复世界书删除后残留 id 问题；",
                        "3.修复主动消息 api 选择跟随聊天却使用全局默认 api 的问题；",
                        "4.修复状态圆点在状态很长时拉伸变形的问题；",
                        "5.修复生图失败原因未记录到日志的问题；",
                        "6.修复后台消息推送缺失的问题；",
                        "7.修复外观 css 部分在聊天室无效的问题；",
                        "8.修复线下旁白气泡修改圆角和描边时，会切分成小气泡的问题；",
                        "9.修复窄屏幕大字号情况下，论坛首页搜索栏显示不全的问题。"
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