// providers/pImageTryOn.js
// Uses prunaai/p-image-try-on, an OFFICIAL Replicate model purpose-built for
// virtual try-on. Cheapest option found: $0.015 for the first garment,
// $0.008 for each additional one. No self-hosting, no cold starts.
//
// Field names confirmed against a live 422 error from Replicate: person_image
// and garment_images were accepted; a string "mode" field was rejected
// ("Unexpected field 'mode'"). Pruna's sibling model p-image-edit uses a
// boolean `turbo` field rather than a mode string, so this sends `turbo`
// instead. If you hit another validation error, check
// https://replicate.com/prunaai/p-image-try-on/api directly and adjust below.
//
// p-image-try-on generates at native (fast/cheap) resolution by design — like
// the rest of the p-image family, Pruna's own documented workflow is
// "generate cheap, upscale once": run the fast/cheap model, then pass the
// result through prunaai/p-image-upscale as a final polish pass. That's what
// happens below (toggle with UPSCALE_TRYON_RESULT=false to skip it).
//
// Also confirm the "License" tab on that page states commercial use is
// permitted before sending real customer traffic through it.

const Replicate = require('replicate');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runUpscaleWithRetry(replicate, imageUrl, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await replicate.run(
        'prunaai/p-image-upscale:7135ff723ecea89c0f67afcd51e4904904586e351093465bdc7beed45941b3e0',
        {
          input: {
            image: imageUrl,
            upscale_mode: 'target',
            target: 8, // max supported megapixels — stronger sharpening than the previous 4MP setting
            enhance_details: true,
            enhance_realism: true,
            output_format: 'jpg',
            output_quality: 90,
          },
        }
      );
    } catch (err) {
      const is429 = err.message && err.message.includes('429');
      const isLastAttempt = i === attempts - 1;
      if (is429 && !isLastAttempt) {
        // Replicate's 429 body includes a retry_after (seconds) — back off
        // a bit longer than that to be safe rather than parsing it exactly.
        const waitMs = 2000 * (i + 1);
        console.warn(`Upscale hit 429, retrying in ${waitMs}ms (attempt ${i + 1}/${attempts})`);
        await sleep(waitMs);
        continue;
      }
      throw err;
    }
  }
}

async function runTryOn({ modelImage, garmentImage, turbo }) {
  const apiToken = process.env.REPLICATE_API_TOKEN;
  if (!apiToken) throw new Error('REPLICATE_API_TOKEN is not set');

  const replicate = new Replicate({ auth: apiToken });

  const output = await replicate.run('prunaai/p-image-try-on', {
    input: {
      person_image: modelImage,
      garment_images: [garmentImage], // supports up to 11 — extend this array for multi-garment try-on
      turbo: !!turbo, // false (default) = quality mode, <2s/garment; true = faster, lower fidelity
    },
  });

  let imageUrl = Array.isArray(output) ? output[0] : output;
  let upscaled = false;
  let upscaleWarning = null;

  const shouldUpscale = process.env.UPSCALE_TRYON_RESULT !== 'false';
  if (shouldUpscale) {
    try {
      const upscaledOutput = await runUpscaleWithRetry(replicate, imageUrl);
      const upscaledUrl = Array.isArray(upscaledOutput) ? upscaledOutput[0] : upscaledOutput;
      if (upscaledUrl) {
        imageUrl = upscaledUrl;
        upscaled = true;
        console.log('p-image-upscale succeeded:', upscaledUrl);
      } else {
        upscaleWarning = 'Upscale step returned no output — showing raw (unupscaled) try-on result.';
        console.error(upscaleWarning);
      }
    } catch (err) {
      // Don't fail the whole request if upscaling has a hiccup — fall back to
      // the unupscaled (blurrier but valid) try-on result. IMPORTANT: this is
      // now surfaced in the API response (upscaleWarning), not just server logs,
      // so a silent fallback is actually visible to whoever's testing.
      const is429 = err.message && err.message.includes('429');
      upscaleWarning = is429
        ? `Upscale step failed after retries: Replicate rate limit (429) — your account likely has under $5 credit. Add credit at replicate.com/account/billing to remove this throttle. Showing raw (unupscaled) result.`
        : `Upscale step failed (${err.message}) — showing raw (unupscaled) try-on result.`;
      console.error('p-image-upscale step failed, returning unupscaled result:', err.message);
    }
  }

  return { imageUrl, raw: output, upscaled, upscaleWarning };
}

module.exports = { runTryOn };
