const fontSettingsForm = document.getElementById('font-settings-form'),
                fontUrlInput = document.getElementById('font-url'),
                restoreDefaultFontBtn = document.getElementById('restore-default-font-btn');



function setupFontSettingsApp() {
                fontUrlInput.value = db.fontUrl;
                fontSettingsForm.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const newFontUrl = fontUrlInput.value.trim();
                    db.fontUrl = newFontUrl;
                    await saveGlobalKeys(['fontUrl']);
                    applyGlobalFont(newFontUrl);
                    showToast('新字体已应用！');
                });
                restoreDefaultFontBtn.addEventListener('click', async () => {
                    fontUrlInput.value = '';
                    db.fontUrl = '';
                    await saveGlobalKeys(['fontUrl']);
                    applyGlobalFont('');
                    showToast('已恢复默认字体！');
                });
            }

            function applyGlobalFont(fontUrl) {
                const styleId = 'global-font-style';
                let styleElement = document.getElementById(styleId);
                if (!styleElement) {
                    styleElement = document.createElement('style');
                    styleElement.id = styleId;
                    document.head.appendChild(styleElement);
                }
                if (fontUrl) {
                    const fontName = 'CustomGlobalFont';
                    styleElement.innerHTML = `@font-face { font-family: '${fontName}'; src: url('${fontUrl}'); } :root { --font-family: '${fontName}', 'KaomojiFixed',-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; }`;
                } else {
                    styleElement.innerHTML = `:root { --font-family: 'KaomojiFixed',-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; }`;
                }
            }
            
window.applyGlobalFont = applyGlobalFont;