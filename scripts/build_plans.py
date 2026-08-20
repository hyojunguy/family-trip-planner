#!/usr/bin/env python3
"""Expand concise plan-specs.json into full plans.json.
Auto-computes: cost table, per-day meals (nearest kid-friendly restaurants),
decision checklist, family highlights, compare metrics.

날짜 기반(trip) 플랜: plan-specs 의 plan 에 `trip` 블록이 있으면
  - days[].date / dow / date_label 을 start 날짜에서 결정론적으로 계산
  - 숙박 박수(nights)·인원(party.people)을 비용표에 반영
  - day.meal_plan 힌트가 있으면 그 앵커/시각으로 식사를 배정(없으면 기존 자동 배정)
날짜·요일·박수 계산은 전부 코드가 소유한다 (모델이 쓰지 않는다).

Usage: python3 scripts/build_plans.py data/busan
Reads:  <dir>/attractions.json, hotels.json, plan-specs.json, [restaurants.json]
Writes: <dir>/plans.json
"""
import json, sys, math
from datetime import date as _date, timedelta as _td

DOW = "월화수목금토일"

TRANSIT={'station','airport'}
def won(n): return f"{n:,}"
def hav(a, b):
    R=6371; r=math.radians
    dlat=r(b["lat"]-a["lat"]); dlon=r(b["lon"]-a["lon"])
    s=math.sin(dlat/2)**2+math.cos(r(a["lat"]))*math.cos(r(b["lat"]))*math.sin(dlon/2)**2
    return R*2*math.atan2(math.sqrt(s),math.sqrt(1-s))

def load(fp, default=None):
    try: return json.load(open(fp, encoding="utf-8"))
    except FileNotFoundError: return default

def main():
    d=sys.argv[1].rstrip("/")
    at=load(f"{d}/attractions.json"); ho=load(f"{d}/hotels.json")
    spec=load(f"{d}/plan-specs.json"); rest=load(f"{d}/restaurants.json", {}) or {}
    prices=load(f"{d}/hotel-prices.json", {}) or {}
    m=spec["meta"]; out=[]

    # 기본 날짜창/객실구성/조식 — plan-specs.meta 로 덮어쓸 수 있다
    PW = m.get("price_window", "A")
    PCFG = m.get("price_config", "one-room")
    PBF = m.get("price_breakfast", "without_breakfast")

    def measured_lodging(hid, hotel, nights=2):
        """실측 우선. (금액, 표기문구, 확정/추정) 반환. 실측 없으면 nightly 추정치로 폴백.
        실측 창(hotel-prices.json)은 2박 기준이라 nights!=2 면 추정으로 폴백한다."""
        if nights != 2:
            nightly = hotel.get("nightly", 220000)
            return nightly * nights, f"{hotel.get('name','')} {nights}박 (1박 {won(nightly)}원 추정)", "추정"
        c = (((prices.get("hotels") or {}).get(hid) or {}).get("windows") or {}).get(PW, {})
        lo = ((c.get("configs") or {}).get(PCFG) or {}).get("lowest") or {}
        pick = lo.get(PBF) or lo.get("without_breakfast") or lo.get("with_breakfast")
        if pick and pick.get("family_total"):
            wlabel = (prices.get("meta", {}).get("date_windows", {}).get(PW, {}) or {}).get("label", PW)
            rooms = pick.get("rooms", 1)
            bits = [hotel.get("name", ""), pick.get("name") or "", f"{rooms}객실" if rooms > 1 else "1객실",
                    "조식 포함" if PBF == "with_breakfast" else "조식 미포함", wlabel]
            return pick["family_total"], " · ".join(b for b in bits if b), "실측"
        nightly = hotel.get("nightly", 220000)
        return nightly * nights, f"{hotel.get('name','')} (1박 {won(nightly)}원)", "추정"

    def measured_intercity():
        """도시간 교통비도 실측 우선(항공=날짜창별, SRT=고정운임). 없으면 plan-specs.meta 값 유지."""
        t = load(f"{d}/transport-prices.json", {}) or {}
        base = dict(m["intercity"])
        srt = t.get("srt") or {}
        if srt.get("family_roundtrip_krw"):
            base.update(amount=srt["family_roundtrip_krw"], type="확정",
                        detail=f"{srt.get('route','')} {srt.get('grade','')} · {srt.get('party','')}")
            return base
        w = (t.get("windows") or {}).get(PW) or {}
        if w.get("family_total_estimate"):
            lo = w.get("lowest_leg") or {}
            wl = w.get("label", PW)
            base.update(amount=w["family_total_estimate"], type="실측",
                        detail=f"항공 왕복 4인 · {wl} · 최저 {lo.get('airline','')} 편도 {won(lo.get('price',0))}원")
        return base

    def near_pool(target,kmax,exclude,maxkm=None,strict=False):
        if not rest or not target: return []
        c=[(rid,hav(target,rv)) for rid,rv in rest.items() if rv.get("lat") and rid not in exclude]
        c.sort(key=lambda x:x[1])
        if maxkm is not None:
            near=[x for x in c if x[1]<=maxkm]
            if strict: c=near            # 반경 밖으로는 절대 안 나간다
            else: c = near or c[:kmax]   # 반경 안에 하나도 없으면 최근접으로 폴백
        return [rid for rid,_ in c[:kmax]]
    # 전수노출 라운드로빈: 시드 나머지연산 대신, 사이트 전체에서 "덜 뽑힌 맛집"을
    # 우선한다(동률이면 near_pool의 근접순을 그대로 유지 — sorted()가 stable이라 보장됨).
    # 결정론적이고(입력 순서에만 의존, 랜덤/시드 없음) pool 안의 맛집을 전부 훑을 때까지
    # 같은 맛집이 2번 뽑히지 않아 커버리지가 자연히 최대화된다.
    used_global={}
    def choose(pool,n):
        if not pool: return []
        ranked=sorted(pool, key=lambda rid: used_global.get(rid,0))
        out=[]; cats=set()
        for rid in ranked:
            cat=rest[rid].get("category")
            if cat in cats and len(pool)>n: continue
            out.append(rid); cats.add(cat)
            if len(out)==n: break
        for rid in ranked:
            if rid not in out: out.append(rid)
            if len(out)==n: break
        out=out[:n]
        for rid in out: used_global[rid]=used_global.get(rid,0)+1
        return out

    def choose_near(pool,n):
        """확정 일정(meal_plan)용: 전수노출 회전 대신 **가까운 순** + 카테고리 다양성.
        실제로 가는 날짜·시간이 정해진 끼니에 먼 식당을 끼워 넣으면 동선이 깨진다.
        used_global 을 건드리지 않아 다른 여행안의 커버리지 회전에도 영향이 없다."""
        out=[]; cats=set()
        for rid in pool:
            cat=rest[rid].get("category")
            if cat in cats and len(pool)>n: continue
            out.append(rid); cats.add(cat)
            if len(out)==n: break
        for rid in pool:
            if rid not in out: out.append(rid)
            if len(out)==n: break
        return out[:n]

    PAID_LABEL={"lotteworld":"롯데월드 종일권 온라인 예매","sealife":"아쿠아리움 온라인권 예매",
      "aquaplanet":"아쿠아플라넷 온라인권 예매","blueline":"블루라인파크 스카이캡슐 시간대 예약",
      "yacht":"광안리 요트투어 사전예약","samjin":"삼진어묵 만들기 체험 예약",
      "park981":"9.81파크 레이싱 예약","xthesky":"엑스더스카이 전망대 예매",
      "hallim":"한림공원 입장권","ecoland":"에코랜드 입장권","camellia":"카멜리아힐 입장권",
      "aerospace":"항공우주박물관 입장권","teddybear":"테디베어뮤지엄 입장권","centum":"센텀 아이스링크/아쿠아필드 예약"}

    for p_idx,p in enumerate(spec["plans"]):
        trip = p.get("trip")
        nights = int(trip.get("nights", len(p["days"])-1)) if trip else 2
        people = int((trip.get("party") or {}).get("people", 4)) if trip else 4
        ndays  = len(p["days"])
        ov = (trip or {}).get("cost_override") or {}

        # ---- 날짜 부여: start + (day-1). 요일/표기까지 코드가 소유한다. ----
        if trip and trip.get("start"):
            y,mo,dd = (int(x) for x in trip["start"].split("-"))
            base = _date(y,mo,dd)
            for day in p["days"]:
                dt = base + _td(days=day["day"]-1)
                day["date"] = dt.isoformat()
                day["dow"] = DOW[dt.weekday()]
                day["date_label"] = f"{dt.month}/{dt.day} ({DOW[dt.weekday()]})"

        seen,paid_names,paid_sum=set(),[],0
        for day in p["days"]:
            for s in day["stops"]:
                r=s["ref"]
                if r.startswith("hotel:") or r in seen: continue
                seen.add(r); a=at.get(r)
                if a and a.get("price4",0)>0: paid_sum+=a["price4"]; paid_names.append(a["name"])
        hotel=ho.get(p["base_hotel"],{})
        # 숙박비: 실측(hotel-prices.json)이 있으면 그것을 쓰고, 없을 때만 nightly 추정치로 폴백.
        lodging, lodge_detail, lodge_type = measured_lodging(p["base_hotel"], hotel, nights)
        # 입장료 데이터는 4인 기준(price4)이라 인원이 다르면 환산해 [추정]으로 표기한다.
        adm = round(paid_sum*people/4/100)*100 if people!=4 else paid_sum
        adm_detail = (", ".join(paid_names) or "무료 위주") + (f" · {people}인 환산" if people!=4 else "")
        ht = ov.get("home_transfer", m.get("home_transfer"))
        cost=[ov.get("intercity") or measured_intercity(),
          *([{"cat":"집↔출발지 이동","detail":f"잠실↔수서/공항 벤 왕복({people}인+짐)","amount":ht,"type":"추정"}] if ht else []),
          ov.get("local") or {"cat":"현지 교통","detail":m.get("local_note","지하철·택시·버스 3일(구간별 표시)"),"amount":m["local"],"type":"추정"},
          (dict(ov["lodging"], cat=f"숙박 {nights}박") if ov.get("lodging") else
           {"cat":f"숙박 {nights}박","detail":lodge_detail,"amount":lodging,"type":lodge_type}),
          {"cat":"입장·체험","detail":adm_detail,"amount":adm,"type":"추정"},
          ov.get("food") or {"cat":"식비","detail":f"{people}인·{ndays}일 (끼니별 맛집 참고)","amount":m["food"],"type":"추정"},
          ov.get("misc") or {"cat":"예비·기념품","detail":"버퍼","amount":m["misc"],"type":"추정"}]
        total=sum(c["amount"] for c in cost)

        # ---- meals wired INTO route order (each meal has `after` = stop index) ----
        hp=hotel if hotel.get("lat") else None
        trip_used=set()          # 확정 일정(meal_plan) 전용: 여행 전체에서 끼니 중복 방지
        def tmin(s):
            try: h,m=s.get("time","").split(":"); return int(h)*60+int(m)
            except Exception: return None
        def anchor_of(ref):
            """meal_plan 힌트가 가리키는 앵커(호텔 or 관광지)를 좌표 있는 객체로."""
            if ref.startswith("hotel:"):
                h=ho.get(ref[6:],{});  return h if h.get("lat") else None
            a=at.get(ref)
            if a and a.get("lat"): return a
            r=rest.get(ref)                     # 식당 id 를 앵커로 줄 수도 있다(경유 저녁 등)
            return r if r and r.get("lat") else None

        for day in p["days"]:
            stops=day["stops"]
            # 확정 일정(trip)은 끼니 시각·장소가 이미 정해져 있다 → 힌트대로 배정하고
            # 후보 식당만 near_pool+choose(전수노출 라운드로빈)로 코드가 고른다.
            hints=day.get("meal_plan")
            if hints:
                meals=[]
                for hnt in hints:
                    tgt=anchor_of(hnt["near_ref"])
                    n=hnt.get("n", 2 if hnt["slot"]=="아침" else 3)
                    km=hnt.get("maxkm", 15 if hnt["near_ref"].startswith("hotel:") else 12)
                    # 확정 일정은 끼니 중복을 여행 전체에서 피한다(trip_used). 다만 마지막 밤
                    # 재방문처럼 일부러 중복을 허용해야 하는 끼니는 "fresh": true 로 푼다.
                    excl=set() if hnt.get("fresh") else trip_used
                    pin=[r for r in (hnt.get("pin") or []) if r in rest]
                    # 반경 > 중복회피 > 반경확장 순으로 완화한다. 반경을 먼저 풀면
                    # "중문 저녁"에 제주시 식당이 끼어든다(실제로 그렇게 샜었다).
                    pool=near_pool(tgt,14,excl|set(pin),km,strict=True)
                    if not pool: pool=near_pool(tgt,14,set(pin),km,strict=True)
                    if not pool: pool=near_pool(tgt,14,excl|set(pin),km)
                    cands=(pin+choose_near(pool, max(0,n-len(pin))))[:n]
                    trip_used|=set(cands)
                    mm={"slot":hnt["slot"],"after":hnt.get("after",-1),
                        "near":hnt.get("near_label") or (tgt or {}).get("name",""),
                        "candidates":cands}
                    if hnt.get("time"): mm["time"]=hnt["time"]
                    if hnt.get("note"): mm["note"]=hnt["note"]
                    if hnt["near_ref"].startswith("hotel:"):
                        bf=ho.get(hnt["near_ref"][6:],{}).get("buffet")
                        if bf and hnt["slot"]=="아침": mm["buffet"]=bf
                    meals.append(mm)
                day["meals"]=meals
                continue
            # candidate anchor stops = real POIs (not hotel/station), keep index
            anc=[(i,at[st["ref"]]) for i,st in enumerate(stops)
                 if not st["ref"].startswith("hotel:") and at.get(st["ref"]) and at[st["ref"]].get("lat") and at[st["ref"]].get("category") not in TRANSIT]
            def pick(target):
                best=None
                for i,a in anc:
                    t=tmin(stops[i]); score=abs((t or 720)-target)
                    if best is None or score<best[0]: best=(score,i,a)
                return (best[1],best[2]) if best else (None,None)
            used=set(); meals=[]
            if day["day"]>1 and hp:
                b=choose(near_pool(hp,12,used), 2); used|=set(b)
                if b: meals.append({"slot":"아침","after":-1,"near":hotel.get("name","숙소"),"buffet":hotel.get("buffet"),"candidates":b})
            li,la=pick(750)   # ~12:30 lunch
            if la:
                c=choose(near_pool(la,14,used), 3); used|=set(c)
                if c: meals.append({"slot":"점심","after":li,"near":la["name"],"candidates":c})
            # dinner: latest POI after lunch; else near hotel; skip on departure day
            last_station = at.get(stops[-1]["ref"],{}).get("category") in TRANSIT
            after_lunch=[(i,a) for i,a in anc if la and i>li]
            di,da,near=None,None,None
            if after_lunch: di,da=after_lunch[-1]; near=da["name"]
            elif hp and not last_station: di,da=len(stops)-1,hp; near=hotel.get("name","숙소")
            if da:
                c=choose(near_pool(da,14,used), 3)
                if c: meals.append({"slot":"저녁","after":di,"near":near,"candidates":c})
            day["meals"]=meals

        # ---- decision checklist ----
        decisions=[{"label":m["intercity"]["cat"]+" 예매","note":m.get("book_note","예매 오픈 즉시(성수기 조기 매진)")},
                   {"label":"숙소 최종 예약","note":f"{hotel.get('name','')} · {nights}박 · {people}인"},
                   {"label":"예산 상한 확정","note":f"현재 예상 총액 {won(total)}원 · 예산 {won(m['budget'])}원"}]
        for r in seen:
            if r in PAID_LABEL: decisions.append({"label":PAID_LABEL[r],"note":"온라인 예매가 현장보다 저렴/시간지정"})

        # ---- family highlights (top kid-fit stops) ----
        kid={"상":3,"중":2,"하":1}
        hi=sorted([at[r] for r in seen if at.get(r) and at[r].get("category") not in TRANSIT],
                  key=lambda a:-kid.get(a.get("kid_fit"),0))[:3]
        highlights=[{"name":a["name"],"blurb":a.get("blurb","")} for a in hi]

        indoor={"aquarium","museum","science","mall","view","cave","themepark"}
        n_stops=sum(1 for r in seen if at.get(r) and at[r].get("category") not in TRANSIT)
        n_indoor=sum(1 for r in seen if at.get(r,{}).get("category") in indoor)
        kv=[kid.get(at[r].get("kid_fit"),0) for r in seen if at.get(r)]
        out.append({"id":p["id"],"short":p["short"],"title":p["title"],"subtitle":p["subtitle"],
          "region":m["region"],"base_hotel":p["base_hotel"],"budget":m["budget"],"total":total,
          "chips":p.get("chips",[]),"intro":p.get("intro") or p.get("subtitle",""),"recommended_for":p.get("recommended_for") or "、".join(p.get("chips",[])[:2]),
          "days":p["days"],"cost":cost,"decisions":decisions,"highlights":highlights,
          "kml":p.get("kml"),"mymaps":p.get("mymaps"),
          **({"trip":trip,"nights":nights,"people":people} if trip else {}),
          "metrics":{"stops":n_stops,"indoor":n_indoor,"kid":round(sum(kv)/len(kv),1) if kv else 0,"meals":sum(len(dd["meals"]) for dd in p["days"])}})
    json.dump({"plans":out},open(f"{d}/plans.json","w",encoding="utf-8"),ensure_ascii=False,indent=2)
    print(json.dumps({"dir":d,"plans":len(out),"restaurants":len(rest),
      "meals_per_plan":[sum(len(dd["meals"]) for dd in p["days"]) for p in out]},ensure_ascii=False))

if __name__=="__main__": main()
