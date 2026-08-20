#!/usr/bin/env python3
"""이미지·영상 생성 provider 어댑터.

⛔ 이 파일의 모든 호출은 **기본이 dry-run** 이다. `Ctx(go=True)` 가 아니면 네트워크로
   한 바이트도 나가지 않고, 무엇을 어떤 바디로 부를지만 계획(plan)에 적는다.
   유료 API 라 "일단 돌려보고 고치기"가 가장 비싼 실패다.

계약 출처: 이 조직 저장소에서 **실제로 호출해 통과한 코드**를 그대로 옮겼다.
  · OpenAI gpt-image-2 : .claude/skills/gpt-image-2/scripts/{generate,edit}_image.py
  · Gemini 이미지      : .claude/skills/nano-banana/scripts/generate_image.py (google-genai)
  · Veo 3.1            : scripts/shorts/generate.py (REST, predictLongRunning)
"""
from __future__ import annotations
import base64, json, os, time, urllib.request
from dataclasses import dataclass, field
from pathlib import Path

VEO_API = "https://generativelanguage.googleapis.com/v1beta"
VEO_MODELS = {"draft": "veo-3.1-lite-generate-preview", "hero": "veo-3.1-generate-preview"}
GEMINI_IMAGE_MODEL = os.environ.get("DIARY_GEMINI_IMAGE_MODEL", "gemini-3.1-flash-image-preview")
OPENAI_IMAGE_MODEL = os.environ.get("DIARY_OPENAI_IMAGE_MODEL", "gpt-image-2")
VEO_DUR_MIN, VEO_DUR_MAX = 4, 8          # 실측 허용 범위. 밖으로 나가면 400.
# ⛔ Veo parameters 에서 실측 거부된 키 — 넣으면 400 이고 조용히 무시되지 않는다.
VEO_REJECTED = ("generateAudio", "negativePrompt", "personGeneration")


@dataclass
class Ctx:
    """실행 컨텍스트. go=False 면 계획만 쌓고 아무것도 호출하지 않는다."""
    go: bool = False
    outdir: Path = Path("out")
    plan: list = field(default_factory=list)
    spent: float = 0.0

    def note(self, provider, op, cost, detail):
        self.plan.append({"provider": provider, "op": op, "est_usd": round(cost, 4), **detail})
        self.spent += cost


def have(*keys):
    return next((k for k in keys if os.environ.get(k)), None)


# ─────────────────────────── OpenAI gpt-image-2 ───────────────────────────
def openai_edit(ctx: Ctx, images: list[Path], prompt: str, out: Path,
                size="1024x1536", quality="medium", cost=0.0):
    """여러 장을 레퍼런스로 한 장을 만든다(images.edit, 최대 16장).

    API 에 이미지별 역할 필드가 없어서, 원본 스킬과 같은 방식으로 프롬프트 앞머리에
    'Image N - ROLE' 프리앰블을 직접 붙여 역할을 알려준다.
    """
    ctx.note("openai", "images.edit", cost, {
        "model": OPENAI_IMAGE_MODEL, "n_images": len(images), "size": size,
        "quality": quality, "out": str(out),
        "images": [i.name for i in images], "prompt": prompt[:400]})
    if not ctx.go:
        return None
    key = have("OPENAI_API_KEY")
    if not key:
        print("  건너뜀: OPENAI_API_KEY 없음"); return None
    from contextlib import ExitStack
    from openai import OpenAI
    from PIL import Image as PILImage
    png = []
    for p in images:                                  # edit 은 PNG 를 요구한다
        q = ctx.outdir/"_png"/(p.stem + ".png"); q.parent.mkdir(parents=True, exist_ok=True)
        if not q.exists(): PILImage.open(p).convert("RGB").save(q)
        png.append(q)
    cli = OpenAI(api_key=key)
    with ExitStack() as st:
        h = [st.enter_context(open(p, "rb")) for p in png[:16]]
        r = cli.images.edit(model=OPENAI_IMAGE_MODEL, image=h if len(h) > 1 else h[0],
                            prompt=prompt, size=size, quality=quality)
    d = r.data[0]
    raw = base64.b64decode(d.b64_json) if getattr(d, "b64_json", None) else \
        urllib.request.urlopen(d.url).read()
    out.parent.mkdir(parents=True, exist_ok=True); out.write_bytes(raw)
    return out


# ─────────────────────── Google Gemini 이미지 편집 ───────────────────────
def gemini_edit(ctx: Ctx, images: list[Path], prompt: str, out: Path,
                image_size="2K", cost=0.0):
    """google-genai 로 이미지+텍스트 → 이미지. contents 에 PIL 이미지를 그대로 넣는다."""
    ctx.note("gemini", "generate_content(image)", cost, {
        "model": GEMINI_IMAGE_MODEL, "n_images": len(images), "image_size": image_size,
        "out": str(out), "images": [i.name for i in images], "prompt": prompt[:400]})
    if not ctx.go:
        return None
    key = have("GEMINI_API_KEY", "GOOGLE_API_KEY")
    if not key:
        print("  건너뜀: GEMINI_API_KEY 없음"); return None
    from google import genai
    from google.genai import types
    from PIL import Image as PILImage
    from io import BytesIO
    cli = genai.Client(api_key=key)
    contents = [prompt] + [PILImage.open(p) for p in images]
    r = cli.models.generate_content(
        model=GEMINI_IMAGE_MODEL, contents=contents,
        config=types.GenerateContentConfig(
            response_modalities=["TEXT", "IMAGE"],
            image_config=types.ImageConfig(image_size=image_size)))
    parts = getattr(r, "parts", None) or r.candidates[0].content.parts
    for part in parts:
        inline = getattr(part, "inline_data", None)
        if inline and inline.data:
            data = inline.data
            raw = base64.b64decode(data) if isinstance(data, str) else data
            out.parent.mkdir(parents=True, exist_ok=True)
            PILImage.open(BytesIO(raw)).save(out)
            return out
    print("  Gemini 응답에 이미지 파트가 없습니다"); return None


# ───────────────────────────── Veo 3.1 (REST) ─────────────────────────────
def _post(url, body):
    req = urllib.request.Request(url, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r: return json.load(r)


def veo_clip(ctx: Ctx, prompt: str, out: Path, still: Path | None = None,
             tier="draft", seconds=6, aspect="9:16", cost=0.0, poll=10, timeout=900):
    """스틸 1장(선택) + 프롬프트 → 4~8초 클립.

    오디오는 parameters 로 못 준다(generateAudio 는 400). 필요하면 프롬프트 본문에
    [AUDIO] 절을 넣어 지시한다 — 원본 스킬이 그렇게 우회했다.
    """
    model = VEO_MODELS.get(tier, VEO_MODELS["draft"])
    seconds = max(VEO_DUR_MIN, min(VEO_DUR_MAX, int(seconds)))
    inst = {"prompt": prompt}
    if still:
        inst["image"] = {"bytesBase64Encoded": "<base64>", "mimeType": "image/png"}
    params = {"aspectRatio": aspect, "durationSeconds": seconds, "sampleCount": 1}
    ctx.note("veo", "predictLongRunning", cost, {
        "model": model, "seconds": seconds, "aspect": aspect,
        "still": still.name if still else None, "out": str(out), "prompt": prompt[:400],
        "body_preview": {"instances": [inst], "parameters": params}})
    if not ctx.go:
        return None
    key = have("GEMINI_API_KEY", "GOOGLE_API_KEY")
    if not key:
        print("  건너뜀: GEMINI_API_KEY 없음"); return None
    if still:
        inst["image"]["bytesBase64Encoded"] = base64.b64encode(still.read_bytes()).decode()
    op = _post(f"{VEO_API}/models/{model}:predictLongRunning?key={key}",
               {"instances": [inst], "parameters": params})
    name, t0 = op["name"], time.time()
    while time.time() - t0 < timeout:
        time.sleep(poll)
        with urllib.request.urlopen(f"{VEO_API}/{name}?key={key}", timeout=60) as r:
            op = json.load(r)
        if op.get("done"):
            break
        print(f"  … Veo 대기 {int(time.time()-t0)}s")
    if op.get("error"):
        print(f"  Veo 실패: {op['error']}"); return None
    if not op.get("done"):
        print("  Veo 타임아웃"); return None
    uri = op["response"]["generateVideoResponse"]["generatedSamples"][0]["video"]["uri"]
    with urllib.request.urlopen(f"{uri}&key={key}", timeout=300) as r:
        out.parent.mkdir(parents=True, exist_ok=True); out.write_bytes(r.read())
    return out
