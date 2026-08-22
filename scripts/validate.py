#!/usr/bin/env python3
"""Exit gate for the family-trip-planner build loop. Exit 0 = green.
Checks: cities index, >=10 plans/city, ref integrity, numeric fields, JSON valid, app.js syntax."""
import json, os, subprocess, sys
from datetime import date as _date, timedelta as _td

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def p(*a): return os.path.join(ROOT, *a)
errs, warns = [], []

def load(fp):
    try: return json.load(open(fp, encoding="utf-8"))
    except Exception as e: errs.append(f"JSON load fail {fp}: {e}"); return None

cities = load(p("data","cities.json"))
if not cities or "cities" not in cities:
    errs.append("cities.json missing/invalid")
    cities = {"cities":[]}

for c in cities["cities"]:
    d = c["dir"]
    plans = load(p(d,"plans.json")); hotels = load(p(d,"hotels.json")); at = load(p(d,"attractions.json"))
    rest = load(p(d,"restaurants.json")) or {}
    if plans is None or hotels is None or at is None:
        errs.append(f"[{c['id']}] missing data files"); continue
    if len(rest) < 6: warns.append(f"[{c['id']}] only {len(rest)} restaurants")
    n = len(plans.get("plans",[]))
    if n < 10: errs.append(f"[{c['id']}] only {n} plans (need >=10)")
    # numeric fields
    for k,v in at.items():
        if "price4" not in v: errs.append(f"[{c['id']}] attraction {k} missing price4")
        if v.get("lat") is None: warns.append(f"[{c['id']}] attraction {k} no lat")
    for k,v in hotels.items():
        if "nightly" not in v: errs.append(f"[{c['id']}] hotel {k} missing nightly")
    # ref integrity + budget
    for pl in plans.get("plans",[]):
        if pl.get("total",0) > pl.get("budget",3000000):
            warns.append(f"[{c['id']}] {pl['id']} over budget ({pl['total']})")
        if pl.get("base_hotel") not in hotels: errs.append(f"[{c['id']}] {pl['id']} base_hotel {pl.get('base_hotel')} missing")
        for day in pl["days"]:
            for s in day["stops"]:
                r=s["ref"]
                if r.startswith("hotel:"):
                    if r[6:] not in hotels: errs.append(f"[{c['id']}] {pl['id']} ref {r} missing")
                elif r not in at: errs.append(f"[{c['id']}] {pl['id']} ref {r} missing")
            for mm in day.get("meals",[]):
                for rid in mm.get("candidates",[]):
                    if rid not in rest: errs.append(f"[{c['id']}] {pl['id']} meal ref {rid} missing")
            # ---- 고르기(picks): 아이가 누르는 선택 후보 ----
            # ref 오타는 화면에서 '빈 줄'로만 보여서 눈으로 못 잡는다 → 코드가 막는다.
            pk = day.get("picks")
            if pk:
                ptag = f"[{c['id']}] {pl['id']} day{day['day']} picks"
                opts = pk.get("options") or []
                if not opts: errs.append(f"{ptag} options 가 비어 있음")
                oids = []
                for o in opts:
                    oid = o.get("id") or o.get("ref")
                    if not oid: errs.append(f"{ptag} 후보에 id/ref 둘 다 없음: {o.get('name','?')}")
                    oids.append(oid)
                    if o.get("ref") and o["ref"] not in at:
                        errs.append(f"{ptag} ref {o['ref']} 가 attractions 에 없음")
                    if not (o.get("name") or (o.get("ref") and at.get(o["ref"],{}).get("name"))):
                        errs.append(f"{ptag} 후보 {oid} 이름 없음")
                    if not o.get("why"): warns.append(f"{ptag} 후보 {oid} why(고를 이유) 없음")
                    if not o.get("dur"): warns.append(f"{ptag} 후보 {oid} dur(소요시간) 없음")
                if len(oids) != len(set(oids)):
                    errs.append(f"{ptag} 후보 id 중복 (선택 기록이 섞인다)")
                mx = pk.get("max")
                if mx is not None and (not isinstance(mx,int) or mx < 1 or mx > len(opts)):
                    errs.append(f"{ptag} max={mx} 가 후보 수({len(opts)})와 안 맞음")
        if not any(day.get("meals") for day in pl["days"]):
            warns.append(f"[{c['id']}] {pl['id']} has no meals")
        # ---- 확정 일정(trip): 날짜 구조 게이트 ----
        t = pl.get("trip")
        if t:
            tag = f"[{c['id']}] {pl['id']} trip"
            if t.get("lodging",{}).get("ref") not in hotels:
                errs.append(f"{tag} lodging.ref {t.get('lodging',{}).get('ref')} missing")
            n = t.get("nights")
            if n is None or len(pl["days"]) != n + 1:
                errs.append(f"{tag} nights={n} but {len(pl['days'])} days (need nights+1)")
            try:
                y,mo,dd = (int(x) for x in t["start"].split("-")); base=_date(y,mo,dd)
                ey,em,ed = (int(x) for x in t["end"].split("-"))
                if base + _td(days=n) != _date(ey,em,ed):
                    errs.append(f"{tag} start+{n}d != end ({t['start']} .. {t['end']})")
                for day in pl["days"]:
                    want = (base + _td(days=day["day"]-1)).isoformat()
                    if day.get("date") != want:
                        errs.append(f"{tag} day{day['day']} date {day.get('date')} != {want}")
                    if not day.get("date_label"): errs.append(f"{tag} day{day['day']} no date_label")
            except Exception as e:
                errs.append(f"{tag} bad start/end date: {e}")
            for f in t.get("flights", []):
                for k in ("date","dep","from","to","airline"):
                    if not f.get(k): errs.append(f"{tag} flight missing {k}")
            if not t.get("party",{}).get("people"): errs.append(f"{tag} party.people missing")
            # ---- 기록 계약(미션·3샷·마감 3문답) ----
            rec = t.get("record")
            if not rec:
                errs.append(f"{tag} record 블록 없음 (미션·마감 의식 계약)")
            else:
                for k in ("roles","one_second","shot_cards","closing","mission_kinds"):
                    if not rec.get(k): errs.append(f"{tag} record.{k} 없음")
                if len(((rec.get("closing") or {}).get("questions")) or []) != 3:
                    errs.append(f"{tag} closing.questions 는 3개(Rose/Thorn/Bud)여야 함")
                for src in ("one_second","shot_cards","closing"):
                    u = (rec.get(src) or {}).get("src")
                    if u and not u.startswith("http"): errs.append(f"{tag} record.{src}.src 가 URL 이 아님")
            mids, kinds = [], set((rec or {}).get("mission_kinds", {}))
            for day in pl["days"]:
                if not day.get("goal"): errs.append(f"{tag} day{day['day']} goal 없음")
                for st in day.get("stops", []):
                    for mm in st.get("missions", []):
                        if not mm.get("id"): errs.append(f"{tag} 미션 id 없음: {mm.get('t','')[:20]}")
                        mids.append(mm.get("id"))
                        if kinds and mm.get("k") not in kinds:
                            errs.append(f"{tag} 미션 종류 '{mm.get('k')}' 는 mission_kinds 에 없음")
                        if mm.get("who") not in ((rec or {}).get("roles") or {}):
                            errs.append(f"{tag} 미션 who '{mm.get('who')}' 는 roles 에 없음")
            if len(mids) != len(set(mids)):
                errs.append(f"{tag} 미션 id 중복 (체크 기록이 섞인다)")
            if len(mids) < 4 * len(pl["days"]):
                warns.append(f"{tag} 미션이 {len(mids)}개뿐 (하루 4개 미만)")

# app.js syntax
for js in ("app.js","record.js","record-ui.js","calc.js"):
    fpj = p("assets", js)
    if not os.path.exists(fpj): errs.append(f"assets/{js} 없음"); continue
    r = subprocess.run(["node","--check",fpj], capture_output=True, text=True)
    if r.returncode != 0: errs.append(f"{js} syntax: "+r.stderr.strip())

print("=== VALIDATE ===")
for w in warns: print("WARN:", w)
if errs:
    for e in errs: print("FAIL:", e)
    print(f"RESULT: RED ({len(errs)} errors, {len(warns)} warns)"); sys.exit(1)
print(f"RESULT: GREEN (0 errors, {len(warns)} warns)"); sys.exit(0)
