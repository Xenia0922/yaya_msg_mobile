"""
生成原生开屏 logo（splashscreen_logo.png）各密度版本，替换 Expo 默认灰色占位图。

源：assets/splash-icon.png（彩色 app 图标，正方形）
目标：android/app/src/main/res/drawable-*/splashscreen_logo.png

规则：
- 画布尺寸严格匹配现有占位图（mdpi 288 / hdpi 432 / xhdpi 576 / xxhdpi 864 / xxxhdpi 1152）。
- 图标缩放到画布的 66.7%（Android 12+ SplashScreen 有效图标区域为 192dp / 288dp 画布），
  居中放置，背景透明，使原生开屏背景色（亮 #fff7fb / 暗 #1c1c1e）能透出来。
- 重新生成命令：python scripts/generate-splash-logo.py
"""
import glob
import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets", "splash-icon.png")
RES_DIR = os.path.join(ROOT, "android", "app", "src", "main", "res")
SCALE = 0.667  # 192 / 288


def main() -> None:
    src = Image.open(SRC).convert("RGBA")
    targets = sorted(glob.glob(os.path.join(RES_DIR, "drawable-*", "splashscreen_logo.png")))
    if not targets:
        raise SystemExit("未找到任何 splashscreen_logo.png，请确认路径正确")
    for path in targets:
        canvas = Image.open(path).convert("RGBA")
        w, h = canvas.size
        target = int(round(min(w, h) * SCALE))
        icon = src.resize((target, target), Image.LANCZOS)
        left = (w - target) // 2
        top = (h - target) // 2
        canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        canvas.paste(icon, (left, top), icon)
        canvas.save(path)
        print(f"wrote {os.path.relpath(path, ROOT)}  canvas={w}x{h} icon={target}x{target}")


if __name__ == "__main__":
    main()
