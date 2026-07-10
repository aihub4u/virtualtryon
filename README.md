# Fitting Room — Virtual Try-On

Upload a selfie + a product photo, get back a realistic image of the user wearing that product. Single Node/Express service, static frontend served from the same app — same shape as your RedTag tracker deploy.

## How it works

1. Frontend (`public/index.html`) — vanilla HTML/JS, no build step. Uploads selfie + product image as `multipart/form-data` to `/api/tryon`.
2. Backend (`server/`) — Express route converts both images to base64 data URIs and hands them to a **provider adapter**.
3. Provider adapter calls the actual generation model and returns an image URL.

Two providers are wired up out of the box, switchable via `.env`:

| Provider | File | License | Notes |
|---|---|---|---|
| `fashn` (default) | `providers/fashn.js` | Commercial use OK | Direct REST to FASHN AI's own API (not via Replicate). ~5-19s per generation, $0.075ish/run. |
| `idm-vton` | `providers/idmVton.js` | **Non-commercial only** (CC BY-NC-SA 4.0) | Via Replicate. Best for prototyping/demos — don't ship this one to a paying client without a separate license. |

## Setup

```bash
cd server
npm install
cp .env.example .env
```

Fill in `.env`:
- **If using FASHN (recommended for anything client-facing):** get an API key at https://app.fashn.ai → API keys. Set `FASHN_API_KEY`.
- **If using IDM-VTON instead:** get a token at https://replicate.com/account/api-tokens, set `REPLICATE_API_TOKEN`, and set `TRYON_PROVIDER=idm-vton`.

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
