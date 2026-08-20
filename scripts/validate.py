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

# app.js syntax
r = subprocess.run(["node","--check",p("assets","app.js")], capture_output=True, text=True)
if r.returncode != 0: errs.append("app.js syntax: "+r.stderr.strip())

print("=== VALIDATE ===")
for w in warns: print("WARN:", w)
if errs:
    for e in errs: print("FAIL:", e)
    print(f"RESULT: RED ({len(errs)} errors, {len(warns)} warns)"); sys.exit(1)
print(f"RESULT: GREEN (0 errors, {len(warns)} warns)"); sys.exit(0)
