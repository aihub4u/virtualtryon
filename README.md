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

## Extending

- **Swap in another Replicate model** (e.g. CatVTON for cost, or a newer model): add a new file in `providers/`, following the same `runTryOn({ modelImage, garmentImage }) -> { imageUrl }` shape, and reference it in `routes/tryon.js`.
- **Persist results:** currently the generated image URL is returned straight to the frontend and nothing is stored. If you want a history (like the RedTag click log), log `{ timestamp, imageUrl, campaign }` to Google Sheets the same way you did there.
- **Garment category / mode control:** FASHN's `category` (`auto`/`tops`/`bottoms`/`one-pieces`) and `mode` (`performance`/`balanced`/`quality`) params are hardcoded in `providers/fashn.js` — expose them as frontend controls if you need per-request tuning.
