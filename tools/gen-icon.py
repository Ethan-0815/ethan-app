#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 ETHAN 启动图标：浅色圆角底 + 三段斜杠组成的 E（顶部蓝色渐变，中下银灰）。"""
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'android', 'res')
S = 512  # 绘制尺寸

def vgrad(size, top, bottom):
    """垂直渐变图层"""
    w, h = size
    img = Image.new('RGBA', size)
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / max(1, h - 1)
        c = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)) + (255,)
        d.line([(0, y), (w, y)], fill=c)
    return img

def rounded_mask(size, radius):
    m = Image.new('L', size, 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], radius=radius, fill=255)
    return m

# ---- 底板：浅色渐变圆角方块（占满 512，四周留 8px 透明） ----
PAD = 8
bg_size = S - PAD * 2
bg = vgrad((bg_size, bg_size), (250, 251, 253), (233, 236, 241))
icon = Image.new('RGBA', (S, S), (0, 0, 0, 0))
icon.paste(bg, (PAD, PAD), rounded_mask((bg_size, bg_size), 116))

# ---- 三段斜杠（圆角矩形旋转 -14°，右端上扬） ----
ANGLE = -14
BAR_W, BAR_H, RADIUS = 244, 62, 28
bars = [
    # (渐变顶色, 渐变底色, 左上粘贴位置)  —— 顶:蓝 中:银灰 底:银灰
    ((106, 148, 205), (168, 198, 235), (126, 122)),
    ((236, 238, 243), (198, 203, 213), (116, 226)),
    ((224, 227, 234), (190, 195, 206), (134, 330)),
]
for top, bottom, pos in bars:
    bar = vgrad((BAR_W, BAR_H), top, bottom)
    mask = rounded_mask((BAR_W, BAR_H), RADIUS)
    bar.putalpha(mask)
    bar = bar.rotate(ANGLE, expand=True, resample=Image.BICUBIC)
    icon.alpha_composite(bar, pos)

# ---- 轻微内阴影提升质感（顶部 1px 高光） ----
hl = Image.new('RGBA', (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(hl)
d.rounded_rectangle([PAD + 3, PAD + 2, S - PAD - 3, S - PAD], radius=114, outline=(255, 255, 255, 90), width=3)
icon.alpha_composite(hl)

# ---- 输出各 mipmap 尺寸 ----
SIZES = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
for dpi, size in SIZES.items():
    ddir = os.path.join(OUT, 'mipmap-' + dpi)
    os.makedirs(ddir, exist_ok=True)
    icon.resize((size, size), Image.LANCZOS).save(os.path.join(ddir, 'ic_launcher.png'))
    print('ic_launcher.png ->', dpi, size)

# 预览大图
icon.save(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'docs', 'shots', 'app-icon.png'))
print('preview: docs/shots/app-icon.png')
