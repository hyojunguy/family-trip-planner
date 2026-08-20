#!/usr/bin/env python3
"""하루 사진 수십 장 → 하루 가족 일기 (PDF + 삽화 + 영상).

    # 1) 무엇을 할지 계획만 본다 (네트워크 0, 비용 0) ← 기본값
    python3 scripts/family_diary.py ~/Pictures/제주0923 --zip ~/Downloads/jeju-2026-09-23.zip

    # 2) 로컬만 실행 — 선별 + 일기 PDF + 리캡 영상 (여전히 비용 0)
    python3 scripts/family_diary.py ~/Pictures/제주0923 --zip ... --local

    # 3) 유료 API 까지 실행 (여기서만 돈이 나간다)
    python3 scripts/family_diary.py ~/Pictures/제주0923 --zip ... --go --look watercolor --veo 1

단계
    ① 선별   수십 장 → 대표 N장            로컬·무료   (diary/triage.py)
    ② 조판   일기 PDF (표지·사진·아이들 말)  로컬·무료   (diary/page.py)
    ③ 삽화   사진 → AI 그림                 유료·선택   gpt-image-2 / Gemini 이미지
    ④ 클립   스틸 → 4~8초 영상             유료·선택   Veo 3.1
    ⑤ 영상   일기 영상 조립                 로컬·무료   (make_recap_video.py)

돈에 대한 태도
    ③④ 는 `--go` 없이는 **절대** 호출되지 않는다. 그 전에 무엇을 몇 번 부르고 얼마가
    들지 표로 보여준다. 요금은 pricing.json 의 [추정]값이며 정산이 아니다.
"""
from __future__ import annotations
import argparse, json, shutil, subprocess, sys, tempfile, zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from diary import providers as P              # noqa: E402
from diary import page as PG                  # noqa: E402
from diary.triage import triage               # noqa: E402

QDEFS = [{"id": "rose", "label": "좋았던 것"},
         {"id": "thorn", "label": "힘들었던 것"},
         {"id": "bud", "label": "내일 기대되는 것"}]


def load_day(zip_or_dir):
    """사이트에서 내보낸 zip(또는 푼 폴더)에서 그날의 기록을 읽는다. 없으면 빈 껍데기."""
    if not zip_or_dir:
        return {"trip": {}, "day": {}, "missions": [], "notes": {}, "photos": []}, None
    p = Path(zip_or_dir)
    if p.is_dir():
        return json.loads((p/"day.json").read_text(encoding="utf-8")), p
    tmp = Path(tempfile.mkdtemp(prefix="diary_"))
    with zipfile.ZipFile(p) as z: z.extractall(tmp)
    j = tmp/"day.json"
    if not j.exists(): sys.exit(f"{p.name} 안에 day.json 이 없습니다.")
    return json.loads(j.read_text(encoding="utf-8")), tmp


def money(plan, pricing):
    if not plan:
        print("\n유료 호출 없음. 전부 로컬입니다.")
        return 0.0
    print("\n" + "─"*74)
    print(f"{'provider':10} {'op':26} {'예상($)':>9}  대상")
    print("─"*74)
    tot = 0.0
    for e in plan:
        tot += e["est_usd"]
        tgt = e.get("out", "")
        print(f"{e['provider']:10} {e['op']:26} {e['est_usd']:>9.3f}  {Path(tgt).name if tgt else ''}")
    print("─"*74)
    print(f"{'합계':10} {len(plan)}건 {'':18} {tot:>9.3f}  [추정]")
    print(f"\n⛔ 요금은 추정입니다. 실제 청구는 다를 수 있어요. 확인: {pricing['_check']}")
    return tot


def main():
    ap = argparse.ArgumentParser(description="하루 사진 → 가족 일기 (기본은 계획만, 호출 안 함)")
    ap.add_argument("photos", help="그날 사진이 든 폴더")
    ap.add_argument("--zip", dest="rec", default=None, help="사이트에서 내보낸 jeju-YYYY-MM-DD.zip (미션·아이들 말)")
    ap.add_argument("-o", "--out", default=None)
    ap.add_argument("-n", "--pick", type=int, default=12, help="대표 사진 장수 (기본 12)")
    ap.add_argument("--local", action="store_true", help="로컬 단계(선별·PDF·영상)를 실제로 실행")
    ap.add_argument("--go", action="store_true", help="⚠️ 유료 API 까지 실제 호출")
    ap.add_argument("--look", default="watercolor", help="삽화 스타일 id (looks.json)")
    ap.add_argument("--art", type=int, default=2, help="AI 삽화 장수 (0이면 안 만듦)")
    ap.add_argument("--oneframe", action="store_true", help="여러 장을 합쳐 '하루 한 장' 만들기")
    ap.add_argument("--veo", type=int, default=0, help="Veo 클립 개수 (0이면 안 만듦)")
    ap.add_argument("--veo-tier", default="draft", choices=["draft", "hero"])
    ap.add_argument("--veo-sec", type=int, default=6)
    ap.add_argument("--no-video", action="store_true", help="리캡 영상은 만들지 않음")
    a = ap.parse_args()

    looks = json.loads((HERE/"diary/looks.json").read_text(encoding="utf-8"))
    pricing = json.loads((HERE/"diary/pricing.json").read_text(encoding="utf-8"))
    man, recroot = load_day(a.rec)
    day, trip = man.get("day", {}), man.get("trip", {})
    date = day.get("date") or "untitled"
    out = Path(a.out or (Path("out")/"diary"/date))
    out.mkdir(parents=True, exist_ok=True)
    ctx = P.Ctx(go=a.go, outdir=out)

    # ── ① 선별 (로컬) ──────────────────────────────────────────────────
    picked, allshots = triage(a.photos, want=a.pick)
    if not allshots:
        sys.exit(f"{a.photos} 에서 사진을 찾지 못했습니다.")
    print(f"① 선별  {len(allshots)}장 → {len(picked)}장")
    for s in picked:
        print(f"     {s.score:.3f}  {s.ts.strftime('%H:%M') if s.ts else '  ?  '}  {s.path.name}")
    dropped = [s for s in allshots if s not in picked]
    if dropped:
        print(f"     (탈락 {len(dropped)}장 — 사유는 triage.json 에 남깁니다)")

    # 사이트에서 담은 사진의 캡션을 파일명으로 이어 붙인다(있으면 아이들 말이 캡션이 된다)
    capmap = {Path(ph["file"]).name: ph for ph in man.get("photos", [])}
    photos = []
    for s in picked:
        rec = capmap.get(s.path.name, {})
        photos.append({"file": str(s.path), "who": rec.get("who", ""),
                       "caption": rec.get("caption", ""),
                       "ts": s.ts.isoformat() if s.ts else None, "score": s.score})
    if recroot:                                     # zip 안 사진도 캡션째로 합류
        for ph in man.get("photos", []):
            f = recroot/ph["file"]
            if f.exists() and not any(Path(p["file"]).name == f.name for p in photos):
                photos.append({"file": str(f), "who": ph.get("who", ""),
                               "caption": ph.get("caption", ""), "ts": None, "score": None})

    (out/"triage.json").write_text(json.dumps(
        {"picked": [p["file"] for p in photos],
         "all": [{"file": str(s.path), "score": s.score, "reason": s.reason} for s in allshots]},
        ensure_ascii=False, indent=2), encoding="utf-8")

    # ── ③④ 계획 세우기 (호출 전에 전부 적는다) ──────────────────────────
    look = next((l for l in looks["looks"] if l["id"] == a.look), looks["looks"][0])
    artpaths = []
    for i, ph in enumerate(photos[:max(0, a.art)]):
        dst = out/"art"/f"art_{i+1:02d}_{look['id']}.png"
        artpaths.append(dst)
        fn = P.gemini_edit if look.get("provider") == "gemini" else P.openai_edit
        cost = pricing["gemini_image_usd"] if look.get("provider") == "gemini" else pricing["openai_image_edit_usd"]
        fn(ctx, [Path(ph["file"])], look["prompt"], dst, cost=cost)
    if a.oneframe and photos:
        one = next((l for l in looks["looks"] if l.get("multi")), None)
        if one:
            dst = out/"art"/"oneframe.png"; artpaths.append(dst)
            refs = [Path(p["file"]) for p in photos[:6]]
            pre = "".join(f"Image {i+1} - MOMENT: a moment from the same day.\n" for i in range(len(refs)))
            P.openai_edit(ctx, refs, pre + "\n" + one["prompt"], dst,
                          cost=pricing["openai_image_edit_usd"])
    clips = []
    for i, ph in enumerate(photos[:max(0, a.veo)]):
        dst = out/"clip"/f"clip_{i+1:02d}.mp4"; clips.append(dst)
        rate = pricing[f"veo_{a.veo_tier}_usd_per_sec"]
        P.veo_clip(ctx, looks["veo"]["prompt"], dst, still=Path(ph["file"]),
                   tier=a.veo_tier, seconds=a.veo_sec, cost=rate*a.veo_sec)

    (out/"plan.json").write_text(json.dumps(ctx.plan, ensure_ascii=False, indent=2), encoding="utf-8")
    total = money(ctx.plan, pricing)

    if not (a.local or a.go):
        print(f"\n계획만 세웠습니다 (호출 0건). 계획서: {out/'plan.json'}")
        print("   로컬만 실행: --local     유료까지 실행: --go")
        return

    # ── ② 조판 (로컬) ─────────────────────────────────────────────────
    hero = Path(photos[0]["file"]) if photos else None
    pages = [PG.cover(day, trip, hero)]
    for i in range(0, min(len(photos), 12), 4):
        pages.append(PG.grid(photos[i:i+4], "오늘의 사진" if i == 0 else "오늘의 사진 (이어서)"))
    if man.get("notes") or man.get("missions"):
        pages.append(PG.voices(man.get("notes", {}), man.get("missions", []), QDEFS))
    made_art = [p for p in artpaths if p.exists()]
    if made_art:
        pages.append(PG.art(made_art))
    pdf = PG.save_pdf(pages, out/f"일기-{date}.pdf")
    for i, pg in enumerate(pages):
        pg.save(out/f"page{i+1}.png")
    print(f"\n② 조판  {pdf}  ({len(pages)}쪽)")

    # ── ⑤ 영상 (로컬) ─────────────────────────────────────────────────
    if not a.no_video and a.rec:
        vid = out/f"일기영상-{date}.mp4"
        r = subprocess.run([sys.executable, str(HERE/"make_recap_video.py"), str(a.rec),
                            "-o", str(vid)], capture_output=True, text=True)
        print("⑤ 영상 ", vid if r.returncode == 0 else f"실패\n{r.stderr[-600:]}")
    made_clips = [c for c in clips if c.exists()]
    if made_clips:
        print(f"④ Veo 클립  {len(made_clips)}개  {made_clips[0].parent}")
    if a.go:
        print(f"\n실제 호출 {len(ctx.plan)}건 · 예상 ${total:.2f} [추정]")
    print(f"\n산출물: {out}")
    if sys.platform == "darwin":
        subprocess.run(["open", str(out)])


if __name__ == "__main__":
    main()
