# Self-hosted FASHN VTON v1.5 on Replicate

Packages FASHN's Apache-2.0 open-weights model (https://github.com/fashn-AI/fashn-vton-1.5) as a private Replicate model using Cog. You pay Replicate's raw GPU-second rate — no per-run product markup like the hosted FASHN API or Kling/Kolors.

**Important:** this needs building on a machine with Docker (and ideally an NVIDIA GPU for local testing) — it can't be built inside this chat's sandbox, which has no Docker/GPU and no Hugging Face network access. Run these steps on your own machine or a cloud VM.

## 1. Install Cog

```bash
sudo curl -o /usr/local/bin/cog -L "https://github.com/replicate/cog/releases/latest/download/cog_$(uname -s)_$(uname -m)"
sudo chmod +x /usr/local/bin/cog
```

## 2. Log in to Replicate

```bash
cog login
```

(Needs a Replicate account with billing enabled — https://replicate.com/account/api-tokens)

## 3. Build and test locally (optional but recommended)

From this `replicate-deploy/` directory:

```bash
cog predict -i person_image=@/path/to/selfie.jpg -i garment_image=@/path/to/garment.jpg -i category=tops
```

First build will take a while — it clones the FASHN repo and downloads ~2GB of weights into the image.

## 4. Push to Replicate

Create a model on replicate.com first (Dashboard → Create → Model), then:

```bash
cog push r8.im/<your-username>/fashn-vton-1-5
```

This uploads the built image. Replicate hosts it as a private model billed by GPU-second.

## 5. Point your app at it

Back in the main project (`server/`), add a new provider or reuse `idmVton.js`'s pattern — see `server/providers/fashnVtonSelfHosted.js` in the updated project zip, which is already wired to call `<your-username>/fashn-vton-1-5` via `REPLICATE_API_TOKEN` and `SELF_HOSTED_MODEL`.

Set in `.env`:
```
TRYON_PROVIDER=fashn-selfhosted
REPLICATE_API_TOKEN=your_replicate_token
SELF_HOSTED_MODEL=your-username/fashn-vton-1-5
```

## Cost expectations

- Replicate GPU pricing is per-second, hardware-dependent (roughly $0.0009–$0.0015/sec depending on GPU tier).
- FASHN's own benchmark for v1.5 is ~5 seconds on an H100. Even on a slower A100/L40S expect somewhere in the 8-15 second range including model load amortized across a warm container.
- That puts you around **$0.01-0.02/run** once the container is warm — versus $0.07-0.075/run on hosted APIs.
- Public/community Replicate models bill only active processing time (idle and setup are free); **private deployments bill for idle time too** if you configure a "deployment" with dedicated hardware for low-latency serving. For sporadic traffic, stick to the default cold-start-on-demand model (scale-to-zero) rather than a paid-idle deployment — you'll eat occasional cold starts (30s-2min) in exchange for zero idle cost.

## ⚠️ License caveat — read before deploying commercially

FASHN VTON v1.5 itself is Apache-2.0, and its DWPose/YOLOX pose-detection components are also Apache-2.0. **However**, the pipeline depends on the FASHN Human Parser for segmentation, and that model's card states it inherits the **NVIDIA Source Code License for SegFormer** — NVIDIA's source-code licenses are typically research/non-commercial, not permissive like Apache-2.0. That's a real conflict with the "free for commercial use" pitch for this pipeline as a whole.

Before deploying this for RedTag/Meesho-scale commercial traffic:
1. Read the actual NVIDIA SegFormer license terms tied to https://huggingface.co/fashn-ai/fashn-human-parser and confirm whether commercial inference use is permitted.
2. If it isn't, options are: license SegFormer separately from NVIDIA, swap in a different (permissively-licensed) human parsing model, or fall back to FASHN's hosted API / Kling Kolors for commercial traffic and keep this self-hosted build for internal/non-commercial use only.

I'd treat this deployment as **not commercially cleared** until you've confirmed #1 — don't take my earlier "Apache-2.0 means free to use commercially" framing as covering the whole pipeline; it only covers the try-on model itself, not its dependency.
