#!/usr/bin/env python3
"""하루 기록(zip) → 저녁에 같이 보는 리캡 영상(MP4).

사이트에서 "오늘 기록 내보내기"로 받은 `jeju-YYYY-MM-DD.zip` 을 넣으면
타이틀 → 사진(켄번스) → 미션 → 3문답 → 엔딩 순서의 영상을 만든다.

    python3 scripts/make_recap_video.py ~/Downloads/jeju-2026-09-22.zip
    python3 scripts/make_recap_video.py ~/Downloads/jeju-2026-09-*.zip -o out/여행전체.mp4
    python3 scripts/make_recap_video.py ~/Downloads/*.zip --reel     # 1초씩 넘기는 하이라이트
    python3 scripts/make_recap_video.py ... --bgm bgm.mp3 --landscape

설계 메모
  · 카드(글자)는 **Pillow 로 PNG 를 그린다**. ffmpeg drawtext 는 한글 줄바꿈·따옴표
    이스케이프가 지옥이고, 폰트 메트릭을 못 재서 글자가 프레임 밖으로 나간다.
  · 세로 사진과 가로 사진이 섞여 들어온다. 캔버스를 고정하고 뒤에 흐린 배경을 깔아
    어느 방향이든 같은 프레임에 앉힌다.
  · 세그먼트를 각각 mp4 로 굽고 마지막에 xfade 로 잇는다. 세그먼트가 많으면
    (>MAX_XFADE) 필터그래프가 비대해지므로 페이드+concat 으로 자동 강등한다.
  · BGM 은 기본 없음. 로열티프리 라이브러리를 이 저장소가 들고 있지 않다.
    --bgm 으로 직접 준 파일만 쓴다 (지어내지 않는다).
"""
import argparse, json, os, re, shutil, subprocess, sys, tempfile, zipfile
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont, ImageFilter
except ImportError:
    sys.exit("Pillow 가 필요합니다:  python3 -m pip install --user Pillow")

FPS, TRANS, MAX_XFADE = 30, 0.5, 26
INK, PAPER, SEA, GOLD, DIM = "#F4F1E8", "#0B1F1E", "#7FD1C6", "#F4B740", "#9FB3AF"
ROLE = {"k1": "언니", "k2": "동생", "dad": "아빠", "both": "자매 둘", "all": "셋 다"}
FONTS = [Path.home()/"Library/Fonts/Pretendard-{}.ttf",
         Path("/System/Library/Fonts/Supplemental/AppleSDGothicNeo.ttc"),
         Path("/System/Library/Fonts/Supplemental/AppleGothic.ttf")]


def font(size, weight="Bold"):
    for cand in FONTS:
        p = Path(str(cand).format(weight))
        if p.exists():
            try: return ImageFont.truetype(str(p), size)
            except Exception: pass
    return ImageFont.load_default()


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"ffmpeg 실패:\n{' '.join(cmd[:9])} …\n{r.stderr[-1800:]}")


EMOJI = re.compile("[\U0001F000-\U0001FAFF\u2190-\u21FF\u2300-\u27BF\uFE0F\u2B00-\u2BFF]")

def clean(t):
    """카드에 그릴 문자열에서 이모지를 뺀다. 본문 폰트에 글리프가 없어 네모로 찍힌다."""
    return EMOJI.sub("", str(t or "")).strip()


def wrap(draw, text, fnt, maxw):
    """실제 폰트 폭으로 줄바꿈. 한국어는 공백이 드물어 글자 단위 폴백이 필요하다."""
    out, line = [], ""
    for word in clean(text).split(" "):
        for piece in ([word] if draw.textlength(word, font=fnt) <= maxw else list(word)):
            trial = (line + " " + piece).strip() if line and piece != word else line + piece
            if draw.textlength(trial, font=fnt) <= maxw:
                line = trial
            else:
                if line: out.append(line)
                line = piece
        if line and draw.textlength(line + " ", font=fnt) <= maxw:
            line += " "
    if line.strip(): out.append(line.strip())
    return out or [""]


def block(draw, xy, text, fnt, fill, maxw, lh=1.45, center=True, W=0):
    x, y = xy
    for ln in wrap(draw, text, fnt, maxw):
        w = draw.textlength(ln, font=fnt)
        draw.text(((W - w) / 2 if center else x, y), ln, font=fnt, fill=fill)
        y += int(fnt.size * lh)
    return y


# ───────────────────────── 카드 그리기 ─────────────────────────
def canvas(W, H):
    im = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, W, 8], fill=GOLD)
    return im, d


def card_title(W, H, day, trip):
    im, d = canvas(W, H); M = int(W * .09); y = int(H * .30)
    d.text((M, y), day.get("date_label", ""), font=font(int(W*.055)), fill=GOLD); y += int(W*.10)
    y = block(d, (M, y), day.get("label", ""), font(int(W*.085)), INK, W-2*M, center=False)
    y += int(W*.06)
    if day.get("goal"):
        d.text((M, y), "오늘의 목표", font=font(int(W*.032), "Medium"), fill=DIM); y += int(W*.055)
        y = block(d, (M, y), day["goal"], font(int(W*.052)), SEA, W-2*M, center=False)
    if day.get("captain"):
        d.text((M, y+int(W*.05)), f"오늘의 대장 · {ROLE.get(day['captain'], day['captain'])}",
               font=font(int(W*.034), "Medium"), fill=DIM)
    d.text((M, H-int(W*.10)), (trip.get("party") or {}).get("label", ""),
           font=font(int(W*.030), "Medium"), fill=DIM)
    return im


def card_photo(W, H, path, who, caption):
    im, _ = canvas(W, H)
    ph = Image.open(path).convert("RGB")
    bg = ph.copy(); s = max(W/bg.width, H/bg.height)
    bg = bg.resize((max(1,int(bg.width*s)), max(1,int(bg.height*s))), Image.LANCZOS)
    bg = bg.crop(((bg.width-W)//2, (bg.height-H)//2, (bg.width-W)//2+W, (bg.height-H)//2+H))
    bg = bg.filter(ImageFilter.GaussianBlur(int(W*.05)))
    im.paste(Image.blend(bg, Image.new("RGB", (W, H), PAPER), .45), (0, 0))

    capH = int(H * (.16 if caption else .10))
    boxW, boxH = int(W*.94), H - capH - int(H*.05)
    s = min(boxW/ph.width, boxH/ph.height)
    ph = ph.resize((max(1,int(ph.width*s)), max(1,int(ph.height*s))), Image.LANCZOS)
    im.paste(ph, ((W-ph.width)//2, int(H*.03) + (boxH-ph.height)//2))

    d = ImageDraw.Draw(im); y = H - capH + int(H*.012)
    tag = ROLE.get(who, who); f_t = font(int(W*.030), "Medium")
    tw = d.textlength(tag, font=f_t)
    d.rounded_rectangle([(W-tw)/2-int(W*.022), y, (W+tw)/2+int(W*.022), y+int(W*.055)],
                        radius=int(W*.028), fill=GOLD)
    d.text(((W-tw)/2, y+int(W*.013)), tag, font=f_t, fill=PAPER)
    if caption:
        block(d, (0, y+int(W*.085)), caption, font(int(W*.042)), INK, int(W*.86), 1.35, True, W)
    return im


def card_missions(W, H, day, missions):
    im, d = canvas(W, H); M = int(W*.09); y = int(H*.24)
    done = [m for m in missions if m.get("done")]
    d.text((M, y), "오늘의 미션", font=font(int(W*.048), "Medium"), fill=DIM); y += int(W*.10)
    d.text((M, y), f"{len(done)} / {len(missions)}", font=font(int(W*.13)), fill=GOLD); y += int(W*.20)
    if done:
        for m in done[:7]:
            y = block(d, (M+int(W*.045), y), "· " + m["t"], font(int(W*.038), "Medium"),
                      INK, W-2*M-int(W*.05), 1.4, center=False) + int(W*.018)
    else:
        block(d, (M, y), "체크한 미션은 없지만 오늘 하루는 지나갔고 사진은 남았습니다.",
              font(int(W*.040), "Medium"), DIM, W-2*M, 1.5, center=False)
    return im


def card_talk(W, H, notes, qdefs):
    im, d = canvas(W, H); M = int(W*.08); y = int(H*.16)
    d.text((M, y), "하루 마감 3문답", font=font(int(W*.055)), fill=GOLD); y += int(W*.13)
    for who in ("k1", "k2", "dad"):
        n = notes.get(who) or {}
        if not any(n.get(q["id"]) for q in qdefs): continue
        d.text((M, y), ROLE.get(who, who), font=font(int(W*.042)), fill=SEA); y += int(W*.075)
        for q in qdefs:
            v = (n.get(q["id"]) or "").strip()
            if not v: continue
            # 이모지를 그리지 않는다. 본문 폰트(Pretendard/AppleGothic)에 이모지
            # 글리프가 없어 두부(네모)로 렌더된다 — 실제로 그렇게 나왔다.
            d.text((M+int(W*.03), y), q["label"], font=font(int(W*.028), "Medium"), fill=DIM)
            y += int(W*.045)
            y = block(d, (M+int(W*.03), y), v, font(int(W*.038), "Medium"),
                      INK, W-2*M-int(W*.04), 1.4, center=False) + int(W*.024)
        y += int(W*.030)
        if y > H - int(H*.12): break
    return im


def card_end(W, H, line1, line2):
    im, d = canvas(W, H)
    y = block(d, (0, int(H*.40)), line1, font(int(W*.085)), INK, int(W*.84), 1.35, True, W)
    block(d, (0, y+int(W*.06)), line2, font(int(W*.040), "Medium"), DIM, int(W*.80), 1.5, True, W)
    return im


# ───────────────────────── 영상 세그먼트 ─────────────────────────
def seg(png, mp4, dur, W, H, ken=None):
    """정지 PNG → 세그먼트. ken 이 있으면 켄번스(2배로 키운 뒤 zoompan → 지터 감소)."""
    n = max(2, int(dur * FPS))
    if ken is None:
        vf = f"scale={W}:{H},format=yuv420p"
    else:
        z = ("min(zoom+0.0009,1.10)" if ken % 2 == 0 else "if(lte(zoom,1.0),1.10,max(1.001,zoom-0.0009))")
        x = {0: "iw/2-(iw/zoom/2)", 1: "0", 2: "iw-iw/zoom", 3: "iw/2-(iw/zoom/2)"}[ken % 4]
        vf = (f"scale={W*2}:{H*2},zoompan=z='{z}':d={n}:x='{x}':y='ih/2-(ih/zoom/2)'"
              f":s={W}x{H}:fps={FPS},format=yuv420p")
    run(["ffmpeg","-y","-loglevel","error","-loop","1","-i",str(png),
         "-f","lavfi","-i","anullsrc=channel_layout=stereo:sample_rate=48000",
         "-t",f"{dur:.3f}","-vf",vf,"-r",str(FPS),
         "-c:v","libx264","-preset","medium","-crf","18","-pix_fmt","yuv420p",
         "-c:a","aac","-b:a","96k","-shortest",str(mp4)])


def stitch(segs, durs, out, W, H):
    if len(segs) <= MAX_XFADE and len(segs) > 1:
        ins, fc, prev, off = [], [], "0:v", 0.0
        for i, s in enumerate(segs): ins += ["-i", str(s)]
        for i in range(1, len(segs)):
            off += durs[i-1] - TRANS
            lab = f"v{i}"
            fc.append(f"[{prev}][{i}:v]xfade=transition=fade:duration={TRANS}:offset={off:.3f}[{lab}]")
            prev = lab
        # 무음 트랙은 **입력 목록 안에서** 열어야 한다(-f lavfi 는 그 파일 앞에 와야 함).
        ins += ["-f","lavfi","-i","anullsrc=channel_layout=stereo:sample_rate=48000"]
        run(["ffmpeg","-y","-loglevel","error",*ins,
             "-filter_complex",";".join(fc),
             "-map",f"[{prev}]","-map",f"{len(segs)}:a","-shortest",
             "-c:v","libx264","-preset","medium","-crf","19","-pix_fmt","yuv420p",
             "-c:a","aac","-b:a","96k",str(out)])
        return sum(durs) - TRANS*(len(segs)-1)
    lst = out.parent/"_concat.txt"
    lst.write_text("".join(f"file '{s.resolve()}'\n" for s in segs), encoding="utf-8")
    run(["ffmpeg","-y","-loglevel","error","-f","concat","-safe","0","-i",str(lst),
         "-c","copy",str(out)])
    return sum(durs)


def add_audio(video, out, bgm=None, narr=None, total=0.0):
    if not bgm and not narr:
        shutil.move(str(video), str(out)); return
    ins, maps, fc = ["-i", str(video)], ["-map","0:v"], []
    idx = 1
    if narr: ins += ["-i", str(narr)]; fc.append(f"[{idx}:a]volume=1.0[na]"); narr_i = idx; idx += 1
    if bgm:
        ins += ["-stream_loop","-1","-i",str(bgm)]
        fc.append(f"[{idx}:a]volume={0.16 if narr else 0.30},"
                  f"afade=t=out:st={max(0,total-2.5):.2f}:d=2.5[bg]"); idx += 1
    if narr and bgm: fc.append("[na][bg]amix=inputs=2:duration=first:dropout_transition=0[aout]"); a="[aout]"
    elif narr: a="[na]"
    else: a="[bg]"
    run(["ffmpeg","-y","-loglevel","error",*ins,"-filter_complex",";".join(fc),
         *maps,"-map",a,"-t",f"{total:.3f}","-c:v","copy","-c:a","aac","-b:a","160k",str(out)])
    Path(video).unlink(missing_ok=True)


# ───────────────────────── 입력 ─────────────────────────
def load(src, work):
    src = Path(src)
    if src.is_dir():
        d = json.loads((src/"day.json").read_text(encoding="utf-8")); return d, src
    out = work/re.sub(r"\W+", "_", src.stem)
    out.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(src) as z: z.extractall(out)
    j = out/"day.json"
    if not j.exists(): sys.exit(f"{src.name} 안에 day.json 이 없습니다. 사이트의 '오늘 기록 내보내기'로 받은 zip 인가요?")
    return json.loads(j.read_text(encoding="utf-8")), out


def main():
    ap = argparse.ArgumentParser(description="여행 하루 기록 zip → 리캡 영상")
    ap.add_argument("inputs", nargs="+", help="jeju-YYYY-MM-DD.zip (여러 개면 이어 붙여 여행 전체 영상)")
    ap.add_argument("-o", "--out", default=None)
    ap.add_argument("--landscape", action="store_true", help="1920x1080 (기본은 폰용 1080x1920)")
    ap.add_argument("--photo-sec", type=float, default=3.0)
    ap.add_argument("--reel", action="store_true", help="1초씩 넘기는 하이라이트(카드 생략)")
    ap.add_argument("--bgm", default=None, help="배경음 파일 (없으면 무음)")
    ap.add_argument("--narrate", default=None, help="미리 만든 나레이션 wav/mp3")
    ap.add_argument("--keep", action="store_true", help="중간 파일 남기기")
    a = ap.parse_args()

    if shutil.which("ffmpeg") is None: sys.exit("ffmpeg 이 필요합니다:  brew install ffmpeg")
    W, H = (1920, 1080) if a.landscape else (1080, 1920)
    psec = 1.0 if a.reel else a.photo_sec

    days = []
    work = Path(tempfile.mkdtemp(prefix="recap_"))
    for src in a.inputs:
        man, root = load(src, work)
        days.append((man, root))
    days.sort(key=lambda t: t[0]["day"]["date"])
    if not days: sys.exit("입력이 없습니다.")

    out = Path(a.out) if a.out else Path("out")/(
        f"jeju-{days[0][0]['day']['date']}.mp4" if len(days) == 1 else "jeju-trip.mp4")
    out.parent.mkdir(parents=True, exist_ok=True)
    frames = work/"f"; frames.mkdir()
    segs, durs, n = [], [], 0

    def push(img, dur, ken=None):
        nonlocal n
        p = frames/f"{n:04d}.png"; img.save(p)
        m = frames/f"{n:04d}.mp4"; seg(p, m, dur, W, H, ken)
        segs.append(m); durs.append(dur); n += 1

    trip = days[0][0].get("trip", {})
    if len(days) > 1:
        push(card_end(W, H, trip.get("title", "우리 여행"),
                      f"{trip.get('start','')} ~ {trip.get('end','')}"), 3.0)

    total_photos = 0
    for man, root in days:
        d, ms, notes = man["day"], man.get("missions", []), man.get("notes", {})
        if not a.reel: push(card_title(W, H, d, trip), 3.2)
        for i, ph in enumerate(man.get("photos", [])):
            f = root/ph["file"]
            if not f.exists(): continue
            push(card_photo(W, H, f, ph.get("who", ""), "" if a.reel else ph.get("caption", "")),
                 psec, ken=i)
            total_photos += 1
        if a.reel: continue
        if ms: push(card_missions(W, H, d, ms), 3.4)
        qd = [{"id": "rose", "label": "좋았던 것"}, {"id": "thorn", "label": "힘들었던 것"},
              {"id": "bud", "label": "내일 기대되는 것"}]
        if any((notes.get(w) or {}).get(q["id"]) for w in ("k1", "k2", "dad") for q in qd):
            push(card_talk(W, H, notes, qd), 5.5)

    push(card_end(W, H, "잘 자자" if len(days) == 1 else "우리 여행 끝",
                  "가족여행 플래너 · 오늘의 기록"), 3.0)

    print(f"세그먼트 {len(segs)}개 (사진 {total_photos}장) · {W}x{H} · 잇는 중…")
    raw = out.parent/("_raw_"+out.name)
    total = stitch(segs, durs, raw, W, H)
    add_audio(raw, out, a.bgm, a.narrate, total)
    if not a.keep: shutil.rmtree(work, ignore_errors=True)

    size = out.stat().st_size/1e6
    print(f"완성: {out}  ({total:.1f}초 · {size:.1f}MB)")
    if not a.bgm: print("배경음 없이 만들었습니다. 넣으려면 --bgm <파일>. (이 저장소는 음원을 들고 있지 않습니다)")
    if sys.platform == "darwin": subprocess.run(["open", str(out)])


if __name__ == "__main__":
    main()
