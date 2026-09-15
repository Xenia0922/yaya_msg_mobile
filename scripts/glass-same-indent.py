"""把「容器与 GlassBackground 同缩进」的旧用法转成作者结构。
（v3/v4 转换器要求容器缩进更小，这类同缩进的形态会漏。）
"""
import re
import sys

for p in sys.argv[1:]:
    lines = open(p, encoding='utf-8').read().split('\n')
    conv = 0
    i = len(lines) - 1
    while i >= 0:
        m = re.match(r'^(\s*)<GlassBackground radius=\{(\d+)\}(?:\s+refract=\{false\})?\s*/>\s*$', lines[i])
        if not m:
            i -= 1
            continue
        gind = len(m.group(1))
        radius = m.group(2)
        open_i = -1
        for j in range(i - 1, max(-1, i - 7), -1):
            mm = re.match(r'^(\s*)<View[\s>]', lines[j])
            if mm and len(mm.group(1)) <= gind:
                open_i = j
                break
        if open_i < 0:
            print(f'  skip(no container) {p}:{i + 1}')
            i -= 1
            continue
        cind = len(re.match(r'^(\s*)', lines[open_i]).group(1))
        close_i = -1
        for j in range(i + 1, len(lines)):
            if len(re.match(r'^(\s*)', lines[j]).group(1)) == cind and re.match(r'^\s*</View>\s*$', lines[j]):
                close_i = j
                break
        if close_i < 0:
            print(f'  skip(no close) {p}:{i + 1}')
            i -= 1
            continue
        lines[open_i] = re.sub(
            r'^(\s*)<View',
            r'\g<1><GlassSurface radius={' + radius + '} role="card"',
            lines[open_i],
            count=1,
        )
        lines[close_i] = re.sub(r'</View>', '</GlassSurface>', lines[close_i], count=1)
        del lines[i]
        conv += 1
        i = open_i - 1
    txt = '\n'.join(lines)
    if conv and 'GlassBackground' not in txt:
        txt = txt.replace(
            "import { GlassBackground } from '../components/GlassBackground';",
            "import { GlassSurface } from '../components/GlassSurface';",
        )
    open(p, 'w', encoding='utf-8').write(txt)
    print(f'{p.split("/")[-1]}: converted={conv}')
