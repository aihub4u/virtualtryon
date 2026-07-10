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

// providers/pImageTryOn.js
// Uses prunaai/p-image-try-on, an OFFICIAL Replicate model purpose-built for
// virtual try-on. Cheapest option found: $0.015 for the first garment,
// $0.008 for each additional one. No self-hosting, no cold starts.
//
// Field names confirmed against a live 422 error from Replicate: person_image
// and garment_images were accepted; a string "mode" field was rejected
// ("Unexpected field 'mode'"). Pruna's sibling model p-image-edit uses a
// boolean `turbo` field rather than a mode string, so this sends `turbo`
// instead.
//
// FACE-ONLY FALLBACK: if the uploaded selfie doesn't show enough of the body
// (a headshot rather than a torso+ shot), fitting a garment directly onto it
// doesn't work well. In that case this pipeline instead: (1) runs the normal
// try-on using a configured stock body photo as the "person", then (2) face-
// swaps the user's real face onto that result via easel/advanced-face-swap.
// See lib/poseDetection.js and lib/stockModel.js — and their header comments
// on which parts are confirmed vs. best-effort schema guesses.
//
// Also confirm the "License" tab on the p-image-try-on model page states
// commercial use is permitted before sending real customer traffic through it.

const Replicate = require('replicate');
const { detectFullBody } = require('../lib/poseDetection');
const { getStockModelUrl } = require('../lib/stockModel');
const { swapFace } = require('./faceSwap');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runPImageTryOn(replicate, personImage, garmentImage, turbo) {
  const output = await replicate.run('prunaai/p-image-try-on', {
    input: {
      person_image: personImage,
      garment_images: [garmentImage], // supports up to 11 — extend this array for multi-garment try-on
      turbo: !!turbo,
    },
  });
  return Array.isArray(output) ? output[0] : output;
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
            target: 8, // max supported megapixels
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
        const waitMs = 2000 * (i + 1);
        console.warn(`Upscale hit 429, retrying in ${waitMs}ms (attempt ${i + 1}/${attempts})`);
        await sleep(waitMs);
        continue;
      }
      throw err;
    }
  }
}

async function runTryOn({ modelImage, garmentImage, turbo, category }) {
  const apiToken = process.env.REPLICATE_API_TOKEN;
  if (!apiToken) throw new Error('REPLICATE_API_TOKEN is not set');

  const replicate = new Replicate({ auth: apiToken });

  let fallbackUsed = false;
  let fallbackReason = null;
  let tryOnResultUrl;

  const fallbackEnabled = process.env.ENABLE_FACE_SWAP_FALLBACK !== 'false';

  if (fallbackEnabled) {
    const detection = await detectFullBody(replicate, modelImage);
    if (!detection.fullBodyDetected) {
      fallbackUsed = true;
      fallbackReason = detection.reason;
      console.log(`Face-only selfie detected (${detection.reason}) — using stock body + face swap fallback`);

      const stockPhotoUrl = getStockModelUrl(category);
      const tryOnOnStockBody = await runPImageTryOn(replicate, stockPhotoUrl, garmentImage, turbo);
      tryOnResultUrl = await swapFace(replicate, {
        userFaceImage: modelImage,
        targetImage: tryOnOnStockBody,
      });
    }
  }

  if (!tryOnResultUrl) {
    // Normal path: full body was detected, or fallback is disabled.
    tryOnResultUrl = await runPImageTryOn(replicate, modelImage, garmentImage, turbo);
  }

  let imageUrl = tryOnResultUrl;
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
      const is429 = err.message && err.message.includes('429');
      upscaleWarning = is429
        ? `Upscale step failed after retries: Replicate rate limit (429) — your account likely has under $5 credit. Add credit at replicate.com/account/billing to remove this throttle. Showing raw (unupscaled) result.`
        : `Upscale step failed (${err.message}) — showing raw (unupscaled) try-on result.`;
      console.error('p-image-upscale step failed, returning unupscaled result:', err.message);
    }
  }

  return { imageUrl, upscaled, upscaleWarning, fallbackUsed, fallbackReason };
}

module.exports = { runTryOn };
