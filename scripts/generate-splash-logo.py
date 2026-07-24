"""
统一生成原生开屏 logo 与 launcher 图标，全部源自 assets/logo.jpg。
样式与「关于」页 logo（52x52，borderRadius 16，居中 cover 裁切）保持一致：
- 圆角比例 = 16/52 ≈ 0.3077
- 裁切 = 居中正方形 cover
- 圆角外区域透明，透出底色

产物：
- android/.../drawable-*/splashscreen_logo.png   （开屏 logo，占画布 66%）
- android/.../mipmap-*/ic_launcher_foreground.png （自适应图标前景，铺满画布）
- android/.../mipmap-*/ic_launcher.png           （API<26 legacy 图标，铺满画布）
- android/.../mipmap-*/ic_launcher_round.png     （API<26 legacy 圆角图标，铺满画布，若存在）
"""
import glob
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets", "logo.jpg")
RADIUS_RATIO = 16 / 52  # 关于页 logo 圆角比例
SPLASH_FRAC = 0.66      # 开屏 logo 占画布比例


def make_rounded(src_rgba: Image.Image, size: int, frac: float) -> Image.Image:
    """在 size×size 透明画布中央放置 frac*size 的圆角方形 logo（居中 cover 裁切）。"""
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    L = int(round(size * frac))
    radius = max(1, int(round(L * RADIUS_RATIO)))
    w, h = src_rgba.size
    s = min(w, h)
    left, top = (w - s) // 2, (h - s) // 2
    sq = src_rgba.crop((left, top, left + s, top + s)).resize((L, L), Image.LANCZOS)
    mask = Image.new("L", (L, L), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, L - 1, L - 1], radius=radius, fill=255)
    offset = (size - L) // 2
    canvas.paste(sq, (offset, offset), mask)
    return canvas


def main() -> None:
    src = Image.open(SRC).convert("RGBA")
    # 开屏 logo（占画布 66%）
    for path in sorted(glob.glob(os.path.join(ROOT, "android/app/src/main/res/drawable-*", "splashscreen_logo.png"))):
        size = Image.open(path).size[0]
        out = make_rounded(src, size, SPLASH_FRAC)
        out.save(path)
        print(f"wrote {os.path.relpath(path, ROOT)}  {size}x{size} logo~{int(SPLASH_FRAC*size)} r={int(round(SPLASH_FRAC*size*RADIUS_RATIO))}")
    # launcher 图标（铺满画布）
    for name in ("ic_launcher_foreground.png", "ic_launcher.png", "ic_launcher_round.png"):
        for path in sorted(glob.glob(os.path.join(ROOT, "android/app/src/main/res/mipmap-*", name))):
            size = Image.open(path).size[0]
            out = make_rounded(src, size, 1.0)
            out.save(path)
            print(f"wrote {os.path.relpath(path, ROOT)}  {size}x{size} r={int(round(size*RADIUS_RATIO))}")


if __name__ == "__main__":
    main()
