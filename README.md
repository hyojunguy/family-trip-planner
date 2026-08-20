# 🧭 가족여행 플래너 (Family Trip Planner)

아이와 함께하는 **부산·제주** 가족여행을 실제 인터랙티브 지도 동선으로 계획하고, 호텔·관광지·**맛집(식사 동선)**·리뷰·이동수단(카카오T)까지 한 페이지에서 보고 **컨펌**받는 오픈소스 정적 사이트입니다.

**➡️ 라이브:** https://sylvanus4.github.io/family-trip-planner/

빌드 불필요. `data/<도시>/*.json`만 고치면 누구나 여행안을 추가·수정할 수 있습니다.

## 무엇이 되나

- 🗺️ **실제 지도(Leaflet/OSM)** 위 방문순서 빨간 번호 핀 + 일자별 색 경로, 핀마다 사진·네이버·리뷰·예매·🚕
- 🏙️ **도시 전환**(부산/제주) + **도시별 10개 여행안** 탭 + 📊 **비교 뷰**(총경비·방문지·식사·실내·아이만족)
- 🍽️ **식사 동선** — 각 날 아침·점심·저녁을 동선 위 아이 동반 맛집 2~3곳(대안 포함, 메뉴·가격·아이 팁·네이버·전화)
- 🚕 **구간 이동수단·요금** 자동 표시(지하철/택시/도보) + **카카오T(카카오맵) 딥링크**
- ✅ **결정 체크리스트**(와이프 컨펌용: 예매·숙소·예산·입장권) + ✨ 하이라이트 + 👨‍👩‍👧‍👧 추천 대상
- 🚌 **시티투어버스/렌터카 안내** · 👍 컨펌 + 🔗 링크 공유 · 🧭 구글맵 길찾기 · ⬇️ KML(구글 마이맵)

## 💰 실측 가격 · 예산 계산기

성수기(8월 말) 가격을 **실제로 조회해서** 반영합니다. 숫자는 전부 수집기가 화면에서 읽은 값이고, 손으로 쓰지 않습니다.

- **날짜 4안**: A 8/24(월) · B 8/25(화) · C 8/26(수) · D 8/28(금), 각 2박
- **객실 2구성**: 1객실(4인 한 방, 큰 침대 필수) / 2객실 — 조식 포함·미포함 각각
- **계산기**: 날짜·숙소·객실·조식을 고르면 교통·숙박·식비·예비까지 더한 **최종 총액**과 예산 대비 여유를 보여주고, 날짜×숙소 매트릭스로 어느 조합이 싼지 한눈에 비교합니다.
- **매일 07:30 자동 갱신**: 가격을 다시 조회해 **전일 대비 변동량**과 특가 배지를 붙이고, 게이트를 통과하면 자동 배포합니다.

```bash
node scripts/fetch_hotel_prices.mjs data/busan --dates A,B,C,D   # 호텔 실측(객실·침대·조식·세금)
node scripts/fetch_transport_prices.mjs jeju                     # 항공 실측(네이버, 전 항공사)
node scripts/price_track.mjs data/busan                          # 이력·변동량·특가 배지
bash scripts/daily_price_update.sh                               # 위 전부 + 빌드·게이트·배포
```

설치(1회): `cp scripts/com.thaki.family-trip-prices.plist ~/Library/LaunchAgents/ && launchctl load ~/Library/LaunchAgents/com.thaki.family-trip-prices.plist`

> ⛔ SRT 예매 시스템은 약관상 자동 조회가 금지돼 있어 **크롤링하지 않습니다**. SRT는 고정 운임이라 사람이 한 번 확인한 값을 상수로 씁니다(일반실 왕복 4인 31만원).

## 새 도시 추가

```bash
python3 scripts/new_city.py <city> --name <이름> --emoji 🌅 --arrival "..." --intercity-label "KTX 왕복"
```
그다음 `--resolve-only` 로 booking_slug를 **검증해 고정**하고(이름검색은 다른 호텔로 잘못 잡힙니다), 수집 → 추적 → 빌드 → 게이트 순으로 돌리면 부산·제주와 똑같은 구성이 그대로 재현됩니다. 상세 순서는 `scripts/new_city.py` 상단 주석에 있습니다.

## 여행안 추가·수정 (누구나, 코드 수정 불필요)

`data/<도시>/`(busan, jeju) 안의 JSON만 편집합니다.

- **`attractions.json`** — 관광지 사전(id→{name,lat,lon,category,naver,img(위키미디어 파일명 or null),price4,price_hours,official,blurb,kid_fit})
- **`hotels.json`** — 호텔(전화·네이버·예약·nightly·family_note)
- **`restaurants.json`** — 맛집(name,lat,lon,category,menu,price,naver,phone,kid_note,wait)
- **`plan-specs.json`** — 여행안 뼈대(meta + days[].stops[].ref). `ref`가 `hotel:<id>`면 숙소, 그 외 관광지.
- **날짜 기반 확정 일정(`trip`)** — plan 에 `trip` 블록을 넣으면 그 여행안은 "고르는 안"이 아니라
  "실제로 가는 날짜별 계획"이 된다. `trip.start`/`nights` 에서 `days[].date`·`dow`·`date_label` 을
  빌드가 계산하고(모델이 날짜를 쓰지 않는다), 비용표는 `party.people`·`nights` 를 따른다.
  `trip.rentcar` 가 있으면 구간 계산이 자차(도로거리×1.3, 50km/h, 연비 9km/L) 모드로 바뀐다.
  `trip.flights` / `lodging` / `rentcar.pickup_steps` / `alerts` / `kid_play` 는 사이드 카드로 렌더된다.
- **`days[].meal_plan`** — 확정 일정용 끼니 힌트(`slot`·`after`·`near_ref`·`time`·`note`·`pin`·`fresh`·`maxkm`).
  힌트가 있으면 그 앵커 반경 안에서 **가까운 순**으로 후보를 뽑고 여행 전체에서 중복을 피한다
  (`fresh: true` 면 중복 허용). 힌트가 없으면 기존 자동 배정(전수노출 라운드로빈)이 그대로 돈다.
- 편집 후 **생성기**로 plans.json 재생성 → 비용·식사동선·결정·하이라이트가 자동 계산됩니다:
  ```bash
  python3 scripts/build_plans.py data/busan   # data/jeju
  python3 scripts/validate.py                 # 종료 게이트(GREEN이어야 배포)
  git add -A && git commit -m "..." && git push
  ```
- 새 도시는 `data/<도시>/` 4파일 + `data/cities.json`에 항목 추가.

## 기록 · 일기 · 영상 (2026-08-20 신설)

여행은 "가는 것"만으로 끝나지 않는다. 장소마다 **미션**이 있고, 하루가 끝나면 셋이 모여
**마감 의식**을 하고, 그 기록이 **일기와 영상**으로 남는다. 설계 근거는 전부 원문을 확인했다.

| 원칙 | 출처 | 구현 |
|---|---|---|
| 하루 의무는 1초/1장뿐이어야 지속된다 | Cesar Kuriyama, [1 Second Everyday (TED 2012)](https://www.ted.com/talks/cesar_kuriyama_one_second_every_day) | "오늘의 1초" 카드. 나머지 미션은 전부 보너스 |
| 손(무엇을) → 얼굴(누가) → 넓게(어디서) | Michael Rosenblum, [BBC 5-shot](https://matthias-suessen.de/en/2017/04/michael-rosenblums-five-shot-method-for-meaningful-video-sequences/) | 매일 3장 훈련 카드. 어깨너머·특이각 2장은 아빠 몫 |
| "봐"가 아니라 "찾아라" | [Rick Steves Europe Scavenger Hunt](https://www.ricksteves.com/europe/scavenger-hunt) (15 items) | 미션 종류 5종(찾기·찍기·물어보기·해보기·모으기), 찾기형이 기본 |
| 좋았던 것 / 힘들었던 것 / 내일 기대 | [Rose · Thorn · Bud](https://www.catholicmom.com/articles/roses-thorns-and-buds-a-tool-for-family-members-to-reflect-each-day) | 하루 마감 3문답, 셋이 각자 |
| 아이가 직접 찍고 그 사진에 한 문장 | Wendy Ewald, [Literacy Through Photography](https://documentarystudies.duke.edu/literacy-through-photography) | 사진마다 캡션 한 줄. 사진이 먼저, 글이 그 다음 |

### 사이트에서 (폰)
낮에는 미션 체크만. 저녁에 셋이 모여 오늘 사진을 고르고 → `🌙 하루 마감하기` → 표지·동선·
사진·미션·3문답·내일 예고가 전체화면으로 넘어간다 → `⬇️ 오늘 기록 내보내기` 로
`jeju-YYYY-MM-DD.zip` 저장. 사진 원본은 사진첩에 그대로 두고 줄인 사본만 IndexedDB 에 담는다.

### 맥에서 (로컬, 비용 0)
```bash
python3 scripts/make_recap_video.py jeju-2026-09-23.zip          # 하루 리캡 영상
python3 scripts/make_recap_video.py jeju-2026-09-2*.zip -o 여행전체.mp4
python3 scripts/make_recap_video.py *.zip --reel                 # 1초씩 넘기는 하이라이트
python3 scripts/diary/triage.py ~/Pictures/0923 -n 12            # 수십 장 → 대표 12장
```
필요한 것은 `ffmpeg` 과 `Pillow` 뿐. API 키·계정·네트워크 전부 불필요.

### AI 일기 (유료 API, 기본은 호출 안 함)
```bash
# ① 계획만 본다 — 네트워크 0, 비용 0
python3 scripts/family_diary.py ~/Pictures/0923 --zip jeju-2026-09-23.zip --art 2 --veo 1
# ② 로컬만 실행 — 일기 PDF + 리캡 영상 (여전히 비용 0)
python3 scripts/family_diary.py ~/Pictures/0923 --zip ... --local
# ③ 유료 API 까지 (여기서만 돈이 나간다)
python3 scripts/family_diary.py ~/Pictures/0923 --zip ... --go --look watercolor --veo 1
```
`--go` 없이는 **한 바이트도 나가지 않는다.** 무엇을 몇 번 부르고 얼마가 들지 표로 먼저 보여준다.

| 단계 | 엔진 | 비용 |
|---|---|---|
| 선별 (수십 장 → 대표 N장) | 로컬 (흔들림·노출·중복·시간분산) | 0 |
| 조판 (일기 PDF) | 로컬 Pillow | 0 |
| 삽화 (수채화·크레용·스티커·포스터·합성) | OpenAI `gpt-image-2` / Google `gemini-3.1-flash-image-preview` | 유료 |
| 클립 (스틸 → 4~8초) | Google `veo-3.1-*-generate-preview` | 유료 |
| 영상 조립 | 로컬 ffmpeg | 0 |

스타일은 `scripts/diary/looks.json`, 요금 추정치는 `scripts/diary/pricing.json` 에서 고친다.
⛔ pricing.json 의 숫자는 **전부 추정**이다. 공식 요금표를 실시간으로 읽지 않는다.

## 사진·가격 원칙 (정직)

사진은 자유 라이선스 **위키미디어 커먼스**만 임베드(없으면 링크). 가격·영업시간·이동요금은 `[추정]` 포함 — 예약·탑승 전 공식/네이버에서 재확인하세요. 수치·연락처 날조 금지.

## 함께 배포된 스킬

`skills/good-dad-family-trip/` — "좋은 아빠 가족여행" 계획 스킬(7조 원칙·워크플로) + `scripts/route_map.py`(빨간 번호 동선 지도 생성기) + `scripts/build_plans.py`(여행안 생성기) + `scripts/validate.py`(게이트).

## 로컬 미리보기
```bash
python3 -m http.server 8000   # http://localhost:8000  (file://로 열면 fetch 차단)
```

## 라이선스
코드 MIT · 지도 © OpenStreetMap · 사진 © 각 위키미디어 커먼스 저작자.
