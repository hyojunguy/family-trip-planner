#!/usr/bin/env python3
"""하루 가족 일기 페이지 조판 (Pillow, 로컬·비용 0).

A4 150dpi(1240x1754) 세로. 표지 → 사진 그리드 → 아이들 말 → (있으면) AI 삽화.
글자는 전부 여기서 그린다. 아이들이 쓴 말이 주인공이고 사진은 그 옆에 붙는다
(Wendy Ewald: 사진이 먼저, 글이 그 다음).
"""
from __future__ import annotations
import re
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

W, H = 1240, 1754
PAPER, INK, SOFT, SEA, GOLD, LINE = "#FBF7EE", "#22302E", "#6C817D", "#0E7C7B", "#C8890F", "#E6DCC8"
ROLE = {"k1": "언니", "k2": "동생", "dad": "아빠", "both": "자매 둘", "all": "셋 다"}
EMOJI = re.compile("[\U0001F000-\U0001FAFF←-⇿⌀-➿️⬀-⯿]")
_F = [Path.home()/"Library/Fonts/Pretendard-{}.ttf",
      Path("/System/Library/Fonts/Supplemental/AppleSDGothicNeo.ttc"),
      Path("/System/Library/Fonts/Supplemental/AppleGothic.ttf")]


def font(sz, w="Bold"):
    for c in _F:
        p = Path(str(c).format(w))
        if p.exists():
            try: return ImageFont.truetype(str(p), sz)
            except Exception: pass
    return ImageFont.load_default()


def clean(t): return EMOJI.sub("", str(t or "")).strip()


def wrap(d, text, f, maxw):
    out, line = [], ""
    for word in clean(text).split(" "):
        for pc in ([word] if d.textlength(word, font=f) <= maxw else list(word)):
            t = (line + " " + pc).strip() if line and pc != word else line + pc
            if d.textlength(t, font=f) <= maxw: line = t
            else:
                if line: out.append(line)
                line = pc
        if line and d.textlength(line + " ", font=f) <= maxw: line += " "
    if line.strip(): out.append(line.strip())
    return out or [""]


def para(d, x, y, text, f, fill, maxw, lh=1.5):
    for ln in wrap(d, text, f, maxw):
        d.text((x, y), ln, font=f, fill=fill); y += int(f.size * lh)
    return y


def _page():
    im = Image.new("RGB", (W, H), PAPER); d = ImageDraw.Draw(im)
    d.rectangle([0, 0, W, 14], fill=SEA)
    return im, d


def _fit(path, box_w, box_h):
    im = Image.open(path).convert("RGB")
    s = max(box_w/im.width, box_h/im.height)
    im = im.resize((max(1, int(im.width*s)), max(1, int(im.height*s))), Image.LANCZOS)
    return im.crop(((im.width-box_w)//2, (im.height-box_h)//2,
                    (im.width-box_w)//2+box_w, (im.height-box_h)//2+box_h))


def cover(day, trip, hero: Path | None):
    im, d = _page(); M = 88; y = 132
    d.text((M, y), clean(day.get("date_label", "")), font=font(46), fill=GOLD); y += 74
    y = para(d, M, y, day.get("label", ""), font(66), INK, W-2*M, 1.28) + 26
    if day.get("goal"):
        d.text((M, y), "오늘의 목표", font=font(24, "Medium"), fill=SOFT); y += 40
        y = para(d, M, y, day["goal"], font(38), SEA, W-2*M, 1.4) + 20
    if day.get("captain"):
        d.text((M, y), f"오늘의 대장 · {ROLE.get(day['captain'], day['captain'])}",
               font=font(26, "Medium"), fill=SOFT); y += 54
    if hero and Path(hero).exists():
        bh = H - y - 170
        im.paste(_fit(hero, W-2*M, bh), (M, y)); y += bh + 22
    d.line([(M, H-108), (W-M, H-108)], fill=LINE, width=2)
    d.text((M, H-88), clean(trip.get("title", "")), font=font(24, "Medium"), fill=SOFT)
    lab = clean((trip.get("party") or {}).get("label", ""))
    d.text((W-M-d.textlength(lab, font=font(24, "Medium")), H-88), lab,
           font=font(24, "Medium"), fill=SOFT)
    return im


def grid(photos, title="오늘의 사진", cols=2):
    im, d = _page(); M = 78
    d.text((M, 116), title, font=font(44), fill=INK)
    top, gap = 200, 26
    cw = (W - 2*M - gap*(cols-1)) // cols
    ch = int(cw * 0.75)
    rows = max(1, (H - top - 90) // (ch + 92))
    for i, ph in enumerate(photos[:rows*cols]):
        r, c = divmod(i, cols)
        x, y = M + c*(cw+gap), top + r*(ch+92)
        p = Path(ph["file"])
        if p.exists():
            im.paste(_fit(p, cw, ch), (x, y))
        d.rectangle([x, y, x+cw, y+ch], outline=LINE, width=2)
        who = ROLE.get(ph.get("who", ""), ph.get("who", ""))
        if who:
            d.text((x+4, y+ch+10), who, font=font(20, "Medium"), fill=GOLD)
        cap = clean(ph.get("caption", ""))
        if cap:
            para(d, x+4, y+ch+38, cap, font(22, "Medium"), INK, cw-8, 1.3)
    return im


def voices(notes, missions, qdefs):
    im, d = _page(); M = 88; y = 116
    d.text((M, y), "우리 셋이 한 말", font=font(44), fill=INK); y += 92
    for who in ("k1", "k2", "dad"):
        n = notes.get(who) or {}
        if not any(n.get(q["id"]) for q in qdefs): continue
        d.rounded_rectangle([M-16, y-14, W-M+16, y+14+len([1 for q in qdefs if n.get(q['id'])])*112],
                            radius=18, fill="#FFFFFF", outline=LINE, width=2)
        d.text((M, y), ROLE.get(who, who), font=font(32), fill=SEA); y += 54
        for q in qdefs:
            v = clean(n.get(q["id"]))
            if not v: continue
            d.text((M+10, y), q["label"], font=font(20, "Medium"), fill=SOFT); y += 32
            y = para(d, M+10, y, v, font(28, "Medium"), INK, W-2*M-20, 1.35) + 22
        y += 34
        if y > H - 320: break
    done = [m for m in missions if m.get("done")]
    if missions and y < H - 240:
        d.line([(M, y), (W-M, y)], fill=LINE, width=2); y += 34
        d.text((M, y), f"오늘의 미션  {len(done)} / {len(missions)}", font=font(30), fill=GOLD); y += 52
        for m in done[:6]:
            y = para(d, M+12, y, "· " + m.get("t", ""), font(24, "Medium"), INK, W-2*M-24, 1.35) + 10
            if y > H - 120: break
    return im


def art(images, title="오늘의 그림"):
    im, d = _page(); M = 78
    d.text((M, 116), title, font=font(44), fill=INK)
    d.text((M, 172), "우리 사진을 AI가 다시 그린 것", font=font(22, "Medium"), fill=SOFT)
    top = 224; n = min(2, len(images))
    if not n: return im
    bh = (H - top - 80 - 24*(n-1)) // n
    for i, p in enumerate(images[:n]):
        p = Path(p)
        if p.exists(): im.paste(_fit(p, W-2*M, bh), (M, top + i*(bh+24)))
    return im


def save_pdf(pages, out: Path):
    out.parent.mkdir(parents=True, exist_ok=True)
    pages[0].save(out, "PDF", resolution=150.0, save_all=True, append_images=pages[1:])
    return out
