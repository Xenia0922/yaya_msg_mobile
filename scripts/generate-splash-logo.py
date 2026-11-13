"""
统一生成原生开屏 logo 与 launcher 图标，全部源自 assets/logo.jpg。
样式与「关于」页 logo 完全一致：logo 铺满正方形画布（cover，无 inset），圆角比例 16/52≈0.3077。

- 开屏 splashscreen_logo.png：frac=1.0（铺满），圆角外透明，透出开屏底色。
- launcher legacy 图标 ic_launcher.png / ic_launcher_round.png：frac=1.0（铺满），
  圆角外同样透明；避免 #f0f0f0 填充被桌面强制套上白底时「露馅」。
  （刻意删除 mipmap-anydpi-v26 自适应 xml，使 API26+ 也回退到本 legacy 图标，
   避免系统 squircle 重遮罩导致圆角与关于页不一致）

产物分辨率沿用现有各 dpi png 画布尺寸。
"""
import glob
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets", "logo.jpg")
RADIUS_RATIO = 16 / 52  # 关于页 logo 圆角比例


def make_rounded(src_rgba: Image.Image, size: int, frac: float, tile=None) -> Image.Image:
    """在 size×size 画布中央放置 frac*size 的圆角方形 logo（居中 cover 裁切）。
    tile=None → 圆角外透明；否则填充 tile 颜色（用于 launcher 浅底）。"""
    canvas_color = tile if tile is not None else (0, 0, 0, 0)
    canvas = Image.new("RGBA", (size, size), canvas_color)
    L = int(round(size * frac))
    radius = max(1, int(round(L * RADIUS_RATIO)))
    w, h = src_rgba.size
    s = min(w, h)
    left, top = (w - s) // 2, (h - s) // 2
    sq = src_rgba.crop((left, top, left + s, top + s)).resize((L, L), Image.LANCZOS)
    mask = Image.new("L", (L, L), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, L, L], radius=radius, fill=255)
    offset = (size - L) // 2
    canvas.paste(sq, (offset, offset), mask)
    return canvas


def main() -> None:
    src = Image.open(SRC).convert("RGBA")
    # 开屏：铺满，圆角外透明
    for path in sorted(glob.glob(os.path.join(ROOT, "android/app/src/main/res/drawable-*", "splashscreen_logo.png"))):
        size = Image.open(path).size[0]
        out = make_rounded(src, size, 1.0, tile=None)
        out.save(path)
        print(f"wrote {os.path.relpath(path, ROOT)} {size}x{size} frac=1.0 transparent-corners r={int(round(size * RADIUS_RATIO))}")
    # launcher legacy：铺满，圆角外透明（与开屏、关于页 visible 区域一致）
    for name in ("ic_launcher.png", "ic_launcher_round.png"):
        for path in sorted(glob.glob(os.path.join(ROOT, "android/app/src/main/res/mipmap-*", name))):
            size = Image.open(path).size[0]
            out = make_rounded(src, size, 1.0, tile=None)
            out.save(path)
            print(f"wrote {os.path.relpath(path, ROOT)} {size}x{size} frac=1.0 transparent-corners r={int(round(size * RADIUS_RATIO))}")
    # foreground 保留（若启用自适应时同款），同样铺满透明圆角
    for path in sorted(glob.glob(os.path.join(ROOT, "android/app/src/main/res/mipmap-*", "ic_launcher_foreground.png"))):
        size = Image.open(path).size[0]
        out = make_rounded(src, size, 1.0, tile=None)
        out.save(path)
        print(f"wrote {os.path.relpath(path, ROOT)} {size}x{size} fg transparent-corners r={int(round(size * RADIUS_RATIO))}")


if __name__ == "__main__":
    main()
