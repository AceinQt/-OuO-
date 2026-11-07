function setupWallpaperApp() {
    // --- 原有壁纸逻辑 ---
    const e = document.getElementById('wallpaper-upload');
    const t = document.getElementById('wallpaper-preview');
    // 初始化壁纸预览
    t.style.backgroundImage = `url(${db.wallpaper})`;
    t.textContent = '';
    
    e.addEventListener('change', async (a) => {
        const n = a.target.files[0];
        if (n) {
            try {
                const r = await compressImage(n, { quality: 0.85, maxWidth: 1080, maxHeight: 1920 });
                db.wallpaper = r;
                applyWallpaper(r);
                t.style.backgroundImage = `url(${r})`;
                await saveGlobalKeys(['wallpaper']);
                showToast('壁纸更换成功！');
            } catch (s) {
                showToast('壁纸压缩失败，请重试');
            }
        }
    });

    // --- 新增：首页顶部状态栏颜色逻辑 ---
    const colorPicker = document.getElementById('home-status-bar-color-picker');
    const colorInput = document.getElementById('home-status-bar-color-input');

    // 1. 回显已保存的颜色；未设置时与初始首页一致，初始化不写回用户设置。
    const savedColor = db.homeStatusBarColor || '#BEC9CB';
    colorPicker.value = savedColor;
    colorInput.value = savedColor;

    // 2. 颜色选择器变动 -> 更新输入框 & 保存
    colorPicker.addEventListener('input', async (ev) => {
        const val = ev.target.value;
        colorInput.value = val;
        db.homeStatusBarColor = val;
        await saveGlobalKeys(['homeStatusBarColor']);
    });

    // 3. 输入框变动 -> 更新选择器 & 保存
    colorInput.addEventListener('change', async (ev) => {
        let val = ev.target.value.trim();
        if (!val.startsWith('#')) {
            val = '#' + val;
        }
        // 简单的 hex 校验
        if (/^#[0-9A-F]{6}$/i.test(val)) {
            colorPicker.value = val;
            db.homeStatusBarColor = val;
            await saveGlobalKeys(['homeStatusBarColor']);
        }
    });
    
    const navColorPicker = document.getElementById('home-navigation-bar-color-picker');
    const navColorInput = document.getElementById('home-navigation-bar-color-input');

    if (navColorPicker && navColorInput) {
        // 1. 初始化值
        const savedNavColor = db.homeNavigationBarColor || '#FFFFFF';
        navColorPicker.value = savedNavColor;
        navColorInput.value = savedNavColor;

        // 2. 颜色选择器变动 -> 更新输入框 & 保存 & 立刻生效
        navColorPicker.addEventListener('input', async (ev) => {
            const val = ev.target.value;
            navColorInput.value = val;
            db.homeNavigationBarColor = val;
            await saveGlobalKeys(['homeNavigationBarColor']);
        });

        // 3. 输入框变动 -> 更新选择器 & 保存 & 立刻生效
        navColorInput.addEventListener('change', async (ev) => {
            let val = ev.target.value.trim();
            if (!val.startsWith('#')) {
                val = '#' + val;
            }
            if (/^#[0-9A-F]{6}$/i.test(val)) {
                navColorPicker.value = val;
                db.homeNavigationBarColor = val;
                await saveGlobalKeys(['homeNavigationBarColor']);
            }
        });
    }
}