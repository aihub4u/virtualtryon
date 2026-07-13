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

## Face-only selfie check

If someone uploads a headshot instead of a photo showing their torso, a direct try-on doesn't work well — there's no body to fit the garment onto. Rather than generate a broken result (and pay for it), the pipeline checks first and stops with a clear error if the photo won't work:

1. **Detect body coverage** — `lib/poseDetection.js` asks `lucataco/moondream2` (a vision-language model on Replicate) a direct yes/no question about whether the selfie shows shoulders/torso.
   - This went through two earlier attempts that didn't pan out: `ultralytics/yolo26-pose` doesn't actually exist (confirmed via a live 404), and Ultralytics hasn't deployed any pose-estimation endpoint to Replicate under their own org — only detection/classification. moondream2's schema is corroborated across multiple independent sources, not a single guessed page, and it's Apache-2.0 licensed (commercial-safe).
2. **If face-only** — the request stops immediately with a `422` and a clear error message. No try-on generation runs, no cost incurred beyond the one cheap detection call (~$0.0015).
3. **If full body** — normal flow proceeds as usual.

Response shape on rejection:
```json
{
  "error": "Full body not detected in the uploaded photo. Please upload a photo that shows your shoulders and torso, not just a close-up face.",
  "bodyDetection": { "fullBodyDetected": false, "reason": "moondream2: face-only crop, no torso visible" }
}
```

On success, the response includes `bodyDetection` too, so you can confirm the check ran and passed.

**Fails open by design:** if the moondream2 check itself errors after retries, it defaults to "full body" and proceeds with generation rather than blocking the request — so a bug or outage in the detection step degrades to the old (no-check) behavior, not a hard failure that blocks every request.

Set `ENABLE_BODY_CHECK=false` to skip this entirely and always attempt generation regardless of framing.

*(An earlier version of this feature attempted a more elaborate fallback — running the garment on a stock body photo and face-swapping the user's real face on — instead of rejecting. That added real complexity (stock photo licensing, an extra unconfirmed model schema, 2-3x the cost) for a use case that's simpler to just reject and ask the user to re-upload. `providers/faceSwap.js` and `lib/stockModel.js` are still in the repo if you want to revisit that approach later, but nothing currently calls them.)*

## Full outfit garment photos (suits, co-ord sets)

A single garment photo typically gets auto-categorized as **one** clothing type by try-on models — usually whichever piece is visually dominant. A photo of a full suit, for example, often only gets applied as a jacket, leaving the person's original pants untouched. This isn't specific to `p-image-try-on` — it's a consistent pattern across virtual try-on APIs generally, since most process one garment category per image.

The fix: when the person uploading knows the product photo shows **two genuinely separate garments worn together**, checking **"This photo shows two separate garments worn together"** in the UI splits the same image into a top-half and bottom-half crop (`lib/garmentSplit.js`, via `sharp`) and sends both as separate entries in `garment_images`, rather than the one full-frame photo. This matches how virtual try-on APIs generally recommend handling full outfits — one image per garment category, even if both categories originate from the same source photo.

**⚠️ Do NOT use this for one-piece draped garments (sarees, gowns, kaftans, jumpsuits, kurtas).** This caused a real broken result in production: a saree was checked as "full outfit," which split the photo into a blouse/upper-drape crop and a lower-drape crop. The lower crop isn't a coherent standalone garment — it's just a fragment of continuous fabric mid-drape — so the model couldn't apply it convincingly, and the person's original clothing (jeans) showed through underneath. **A saree, gown, or any single continuous piece should be uploaded with the checkbox unchecked** — send it as one image and let the model treat it as a one-piece garment, the same way it'd handle a dress. The checkbox is specifically for outfits made of two genuinely separable items (a blazer that could be worn without the trousers, a top that could be worn without the skirt) — not anything that's structurally one continuous piece of fabric.

This is opt-in, not automatic — forcing the split on every product photo would break normal single-item photos (a plain t-shirt shot doesn't have a meaningful "bottom half" to extract). Toggle it per-request based on what the actual product photo shows.

**Cost note:** garment_images accepts multiple images per call at (per Pruna's pricing) $0.015 for the first + $0.008 for each additional — so a full-outfit request costs $0.023 instead of $0.015 for the base try-on step, before upscale/detection.

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
