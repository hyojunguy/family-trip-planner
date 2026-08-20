#!/usr/bin/env python3
"""사진 수십 장 → 하루 일기에 쓸 대표 N장 고르기 (전부 로컬, API 비용 0).

왜 이 단계가 먼저인가
  하루에 40~80장이 쌓인다. 그걸 통째로 유료 이미지 API 에 넣으면 돈이 선형으로 나가고
  결과도 나빠진다(비슷한 사진이 반복된다). 사람이 고르는 일을 코드가 먼저 90% 해 둔다.

고르는 기준 (전부 결정론)
  1) 흔들림·초점  — 엣지 에너지 분산. 낮으면 흐린 사진.
  2) 노출         — 히스토그램이 한쪽 끝에 몰렸으면 감점(너무 어둡거나 날아감).
  3) 중복         — average-hash 해밍거리로 연사·비슷한 컷을 한 장만 남긴다.
  4) 시간 분산    — EXIF 촬영시각으로 하루를 N개 구간으로 나눠 구간마다 최고점을 뽑는다.
                    (점수만으로 뽑으면 '잘 찍힌 한 장소'만 남고 하루 서사가 사라진다)
"""
from __future__ import annotations
import math, os
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter, ExifTags

EXT = {".jpg", ".jpeg", ".png", ".heic", ".webp"}
_TAGS = {v: k for k, v in ExifTags.TAGS.items()}


@dataclass
class Shot:
    path: Path
    ts: datetime | None = None
    w: int = 0
    h: int = 0
    sharp: float = 0.0
    expo: float = 0.0
    score: float = 0.0
    ahash: int = 0
    bucket: int = 0
    reason: str = ""
    meta: dict = field(default_factory=dict)


def _exif_dt(im) -> datetime | None:
    try:
        ex = im.getexif()
        for key in ("DateTimeOriginal", "DateTime"):
            v = ex.get(_TAGS.get(key, -1))
            if v:
                return datetime.strptime(str(v)[:19], "%Y:%m:%d %H:%M:%S")
        ifd = ex.get_ifd(0x8769) if hasattr(ex, "get_ifd") else {}
        v = ifd.get(_TAGS.get("DateTimeOriginal", -1))
        if v:
            return datetime.strptime(str(v)[:19], "%Y:%m:%d %H:%M:%S")
    except Exception:
        pass
    return None


def _ahash(im: Image.Image) -> int:
    g = np.asarray(im.convert("L").resize((8, 8), Image.LANCZOS), dtype=np.float32)
    bits = (g > g.mean()).flatten()
    out = 0
    for b in bits:
        out = (out << 1) | int(b)
    return out


def _hamming(a: int, b: int) -> int:
    return bin(a ^ b).count("1")


def measure(path: Path) -> Shot | None:
    try:
        im = Image.open(path)
        im.load()
    except Exception:
        return None
    s = Shot(path=path, ts=_exif_dt(im), w=im.width, h=im.height)
    if not s.ts:                                   # EXIF 가 없으면 파일 수정시각으로 폴백
        try: s.ts = datetime.fromtimestamp(path.stat().st_mtime)
        except Exception: s.ts = None
    small = im.convert("RGB").resize((320, 320), Image.LANCZOS)
    edges = np.asarray(small.convert("L").filter(ImageFilter.FIND_EDGES), dtype=np.float32)
    s.sharp = float(edges.var())
    g = np.asarray(small.convert("L"), dtype=np.float32) / 255.0
    # 노출: 평균이 0.5 에서 멀수록, 클리핑 화소가 많을수록 감점
    clip = float(((g < 0.02) | (g > 0.98)).mean())
    s.expo = max(0.0, 1.0 - abs(g.mean() - 0.5) * 1.7 - clip * 1.2)
    s.ahash = _ahash(small)
    im.close()
    return s


def _norm(vals):
    if not vals: return []
    lo, hi = min(vals), max(vals)
    return [0.5] * len(vals) if hi - lo < 1e-9 else [(v - lo) / (hi - lo) for v in vals]


def triage(folder, want: int = 12, buckets: int | None = None,
           dup_dist: int = 5, dup_window: int = 180, keep_all: bool = False) -> tuple[list[Shot], list[Shot]]:
    """(선택된 사진, 전체 사진) 반환. 전체는 감사 로그용으로 점수·탈락 사유를 달고 돌려준다."""
    folder = Path(folder)
    files = sorted(f for f in folder.rglob("*") if f.suffix.lower() in EXT and not f.name.startswith("."))
    shots = [s for s in (measure(f) for f in files) if s]
    if not shots:
        return [], []

    sh = _norm([s.sharp for s in shots])
    ex = _norm([s.expo for s in shots])
    for i, s in enumerate(shots):
        s.score = round(0.62 * sh[i] + 0.38 * ex[i], 4)

    shots.sort(key=lambda s: (s.ts or datetime.min, s.path.name))
    if keep_all:
        for s in shots: s.reason = "keep-all"
        return shots, shots

    # 중복 제거: 시간순으로 훑으며 앞서 채택된 것과 너무 비슷하면 낮은 점수를 버린다.
    # ⛔ 해시만으로 지우지 않는다. 다른 장소인데 색·구도가 비슷하면(바다 사진 두 장)
    #    해밍거리가 가까워 서로를 지운다 — 실제로 30장이 7장으로 무너졌다.
    #    그래서 "촬영시각이 dup_window 안"일 때만 연사로 보고 지운다. 시간 정보가
    #    아예 없을 때만 아주 강한 유사도(<=2)로 지운다.
    def _near(a: Shot, b: Shot) -> bool:
        h = _hamming(a.ahash, b.ahash)
        if a.ts and b.ts:
            return h <= dup_dist and abs((a.ts - b.ts).total_seconds()) <= dup_window
        return h <= 2

    kept: list[Shot] = []
    for s in shots:
        twin = next((k for k in kept if _near(k, s)), None)
        if twin is None:
            kept.append(s)
        elif s.score > twin.score:
            twin.reason = f"중복(더 나은 컷 {s.path.name})"
            kept[kept.index(twin)] = s
        else:
            s.reason = f"중복({twin.path.name})"

    # 시간 구간별 배분 — 하루 서사를 잃지 않게
    # dedup 이 리스트 중간을 더 늦은 컷으로 갈아끼우므로 시간순이 깨져 있다. 다시 정렬한다.
    kept.sort(key=lambda s: (s.ts or datetime.min, s.path.name))
    nb = buckets or max(1, min(want, 8))
    with_ts = [s for s in kept if s.ts]
    if with_ts:
        t0, t1 = with_ts[0].ts.timestamp(), with_ts[-1].ts.timestamp()
        span = max(1.0, t1 - t0)
        for s in kept:
            s.bucket = min(nb - 1, int((s.ts.timestamp() - t0) / span * nb)) if s.ts else 0
    picked: list[Shot] = []
    per = max(1, math.ceil(want / nb))
    for b in range(nb):
        grp = sorted([s for s in kept if s.bucket == b], key=lambda s: -s.score)
        picked += grp[:per]
    picked.sort(key=lambda s: -s.score)
    # 빈 구간이 있으면 목표 장수에 못 미친다 — 남은 것 중 점수순으로 채운다.
    # (이걸 빼면 "10장 달라"고 했는데 6장만 나온다. 실제로 그랬다.)
    if len(picked) < want:
        rest = sorted((s for s in kept if s not in picked), key=lambda s: -s.score)
        picked += rest[:want - len(picked)]
    picked = picked[:want]
    chosen = {id(s) for s in picked}
    for s in kept:
        if id(s) not in chosen and not s.reason:
            s.reason = "구간 내 점수 밀림"
    for s in picked:
        s.reason = f"채택 (구간 {s.bucket + 1}/{nb})"
    picked.sort(key=lambda s: (s.ts or datetime.min, s.path.name))
    return picked, shots


if __name__ == "__main__":
    import argparse, json
    ap = argparse.ArgumentParser(description="사진 폴더에서 대표 N장 고르기 (로컬, 비용 0)")
    ap.add_argument("folder"); ap.add_argument("-n", "--want", type=int, default=12)
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    picked, allshots = triage(a.folder, a.want)
    if a.json:
        print(json.dumps([{"file": str(s.path), "ts": s.ts.isoformat() if s.ts else None,
                           "score": s.score, "reason": s.reason} for s in picked],
                         ensure_ascii=False, indent=2))
    else:
        print(f"전체 {len(allshots)}장 → 채택 {len(picked)}장")
        for s in picked:
            print(f"  {s.score:.3f}  {s.ts.strftime('%H:%M') if s.ts else '  ?  '}  {s.path.name}  ({s.reason})")
