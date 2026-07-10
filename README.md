# Fitting Room — Virtual Try-On

Upload a selfie + a product photo, get back a realistic image of the user wearing that product. Single Node/Express service, static frontend served from the same app — same shape as your RedTag tracker deploy.

## How it works

1. Frontend (`public/index.html`) — vanilla HTML/JS, no build step. Uploads selfie + product image as `multipart/form-data` to `/api/tryon`.
2. Backend (`server/`) — Express route converts both images to base64 data URIs and hands them to a **provider adapter**.
3. Provider adapter calls the actual generation model and returns an image URL.

Multiple providers are wired up, switchable via `.env`:

| Provider | File | Cost | License | Notes |
|---|---|---|---|---|
| `p-image-try-on` (default) | `providers/pImageTryOn.js` | $0.015 first garment + $0.008/additional | Verify on model page — see caveat below | Official Replicate model, purpose-built for try-on, supports up to 11 garments in one call, quality/turbo modes |
| `idm-vton` | `providers/idmVton.js` | ~$0.024/run | **Non-commercial only** (CC BY-NC-SA 4.0) | Prototyping/demos only |
| `fashn` | `providers/fashn.js` | ~$0.075/run | Commercial use explicitly permitted | Direct FASHN AI REST API, not via Replicate |
| `fashn-selfhosted` | `providers/fashnVtonSelfHosted.js` | ~$0.01-0.02/run (raw GPU-seconds) | ⚠️ Unresolved — see `replicate-deploy/README.md` | Requires Cog packaging + your own Replicate deployment |

**Before sending real customer traffic through `p-image-try-on`:** I built this adapter from Pruna's documented conventions, not a live schema fetch (blocked in my environment). Two things to verify yourself before production use:
1. Open https://replicate.com/prunaai/p-image-try-on/api and confirm the input field names (`person_image`, `garment_images`, `mode`) match what's actually there — adjust `providers/pImageTryOn.js` if not.
2. Check the "License" tab on that same page. Being an official Replicate model means it's stably hosted and priced, not that commercial use is automatically cleared — confirm explicitly.

## Setup

```bash
cd server
npm install
cp .env.example .env
```

Fill in `.env`:
- **Default (`p-image-try-on`):** get a token at https://replicate.com/account/api-tokens, set `REPLICATE_API_TOKEN`. Confirm the license on the model page before commercial use (see caveat above).
- **If using FASHN instead:** get an API key at https://app.fashn.ai → API keys. Set `FASHN_API_KEY` and `TRYON_PROVIDER=fashn`.
- **If using IDM-VTON instead:** same `REPLICATE_API_TOKEN`, set `TRYON_PROVIDER=idm-vton`. Non-commercial only.

Run locally:

```bash
npm start
# -> http://localhost:3000
```

## Deploying to Render

Same pattern as your other Node services:

1. Push this repo to GitHub.
2. New Web Service on Render, root directory `server`.
3. Build command: `npm install`
4. Start command: `npm start`
5. Add environment variables from `.env` in the Render dashboard (`TRYON_PROVIDER`, `FASHN_API_KEY` or `REPLICATE_API_TOKEN`).
6. Render auto-assigns `PORT` — the app already reads `process.env.PORT`.

If you want a custom domain like `tryon.karixforge.in`, add it the same way you did for `track.karixforge.in`.

## Face-only selfie fallback

If someone uploads a headshot instead of a photo showing their torso, a direct try-on doesn't work well — there's no body to fit the garment onto. Instead of a broken result, the pipeline can detect this and reroute:

1. **Detect body coverage** — `lib/poseDetection.js` runs `ultralytics/yolo26-pose` on the selfie and checks whether shoulders are visible.
2. **If face-only** — instead of using the user's selfie directly, it runs the normal try-on with a **stock body photo** as the "person," then face-swaps the user's real face onto that result via `easel/advanced-face-swap` (`providers/faceSwap.js`).
3. **If full body** — normal direct flow, no extra steps or cost.

The API response now includes `fallbackUsed` (boolean) and `fallbackReason` (string) so you can tell which path a given request took.

### Before this actually works, you must:

1. **Add real stock photos.** Edit `server/config/stockModels.json` and replace the placeholder URLs with your own licensed, front-facing, neutral-pose stock photos. The fallback throws a clear error until you do this — it won't silently use a broken placeholder.
2. **Verify two unconfirmed schemas.** I couldn't fetch either model's live API schema page from this environment (same limitation as `p-image-try-on` earlier, which needed one correction after real testing):
   - `ultralytics/yolo26-pose` — check https://replicate.com/ultralytics/yolo26-pose/api. The input fields (`image`, `model_size`, `conf`) and the output keypoint parsing in `lib/poseDetection.js` are built from Ultralytics' documented COCO-pose keypoint order and a sibling model's naming convention, not a confirmed schema.
   - `easel/advanced-face-swap` — check https://replicate.com/easel/advanced-face-swap/api. The fields used (`swap_image`, `target_image`, `hair_source`) come from Replicate's own published usage example, so these are more likely correct than the pose ones, but still worth a quick check.
3. **Check both models' licenses** for commercial use before real campaign traffic, same as every other model in this stack.

**Fails open by design:** if pose detection itself errors for any reason (bad schema guess, model down, etc.), it defaults to "full body" and proceeds with the normal direct try-on rather than blocking the request — so a bug in the detection step degrades to the old behavior, not a hard failure.

**Cost note:** the fallback path is three model calls instead of one (try-on-on-stock-body + face-swap + upscale, vs. just try-on + upscale) — roughly 2-3x the cost of a direct try-on. Set `ENABLE_FACE_SWAP_FALLBACK=false` to disable it entirely if you'd rather have face-only selfies just produce a (likely poor) direct result than pay for the fallback chain.

The original `/api/tryon` (upload two files, wait for the result) works fine for casual use, but doesn't scale to a campaign: it holds an HTTP connection open for 5-15+ seconds per user (two chained Replicate calls), and Replicate deletes its output files after **1 hour** — so anyone who checks their result later than that gets a dead link.

For anything sent to a real campaign audience, use **`POST /api/jobs`** + **`GET /api/jobs/:id`** instead:

```
POST /api/jobs
{ "selfieUrl": "https://...", "garmentUrl": "https://..." }

→ 202 { "id": "uuid", "status": "queued", "statusUrl": "/api/jobs/uuid" }
```

```
GET /api/jobs/uuid

→ { "id": "uuid", "status": "tryon_processing", "imageUrl": null, "error": null }
→ ... (poll again later) ...
→ { "id": "uuid", "status": "completed", "imageUrl": "https://cdn.../tryon-results/uuid.jpg", "error": null }
```

Status values: `queued` → `tryon_processing` → `tryon_done` → `upscale_processing` → `completed` (or `failed` at any point, with `error` populated).

### How it avoids falling over under load

1. **The API never waits on Replicate.** `POST /api/jobs` just writes a job record to Redis and pushes it onto a queue, then returns immediately. This is why it can absorb a traffic spike from a campaign blast without every request piling up.
2. **A separate worker process drains the queue at a controlled rate** (5 dispatches/sec = 300/min), well under Replicate's 600 requests per minute prediction-creation limit — even with the try-on + upscale chain effectively doubling calls per job.
3. **The worker never waits on Replicate either.** It fires each prediction with a `webhook` URL and moves on — Replicate calls back when the prediction finishes. This is what lets one small worker dispatch thousands of jobs without holding thousands of connections open.
4. **Results get copied to permanent storage (Cloudflare R2) the moment the webhook fires** — required, because predictions created through the API have all input parameters, output values, output files, and logs automatically removed after an hour by default.
5. **Per-IP rate limiting on job creation** (10/min by default in `routes/jobs.js`) — a cost guardrail, since every generation is real Replicate spend.

### New pieces

| File | Role |
|---|---|
| `lib/redisClient.js` | Shared Redis connection (lazy — only connects if `REDIS_URL` is set) |
| `lib/jobStore.js` | Job status + prediction→job mapping, stored in Redis with TTLs |
| `lib/storage.js` | Copies the final image to Cloudflare R2 before Replicate's 1-hour window closes |
| `queue/queue.js` | BullMQ queue definition, shared by API and worker |
| `queue/worker.js` | **Separate process** — drains the queue, dispatches to Replicate via webhook |
| `routes/jobs.js` | `POST /api/jobs`, `GET /api/jobs/:id` |
| `routes/webhooks.js` | Receives Replicate's callbacks, verifies signature, advances job state |

### Setup

1. **Redis** — create a free/cheap database at https://upstash.com, copy the `rediss://...` connection string into `REDIS_URL`.
2. **Replicate webhook secret** — needed to verify callbacks actually came from Replicate. Fetch it:
   ```js
   const secret = await replicate.webhooks.default.secret.get();
   ```
   or from the Replicate dashboard. Set as `REPLICATE_WEBHOOK_SECRET`.
3. **Cloudflare R2** — create a bucket at https://dash.cloudflare.com → R2, create an API token scoped to it, set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL` (the bucket's `r2.dev` URL, or your own domain mapped to it).
4. **`WEBHOOK_BASE_URL`** — your API's public URL (Render gives you one automatically). Replicate needs to reach this from the internet, so local testing requires a tunnel (e.g. ngrok) — `localhost` won't work.

### Deploying the worker on Render

The worker (`queue/worker.js`) must run as its own process — it's not part of the same request/response cycle as the API.

- Render dashboard → New → **Background Worker** (not Web Service)
- Root directory: `server`
- Build command: `npm install`
- Start command: `npm run worker`
- Same environment variables as the API service (`REDIS_URL`, `REPLICATE_API_TOKEN`, `WEBHOOK_BASE_URL`, `R2_*`)

Both the API service and the worker read/write the same Redis and Replicate account, so they need matching env vars but are deployed as two separate Render services from the same repo.

### Cost math — read this before a real campaign launch

Each completed try-on costs roughly:
- `p-image-try-on`: $0.015 (first garment)
- `p-image-upscale`: ~$0.01-0.02 (varies by target resolution)
- R2 storage: negligible per-image, but add up storage + Class A operation costs at scale
- **≈ $0.03-0.04 per completed generation**

At 100K generations: ~$3,000-4,000. At 1M: ~$30,000-40,000. There's no built-in spend cap in this code — the per-IP rate limiter slows abuse but doesn't cap total spend. Before a real launch, consider:
- Setting a hard daily/total job-creation counter (e.g. a Redis counter checked in `routes/jobs.js`) that returns 503 once a budget threshold is hit
- Replicate's own spend alerts/prepaid credit limits (dashboard → billing)
- Deciding upfront whether uncapped campaign reach is intended, or whether a "first N free tries" model is safer
