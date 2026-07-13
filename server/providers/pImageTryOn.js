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
// BODY-COVERAGE CHECK: before spending anything on generation, this asks
// lucataco/moondream2 (a vision-language model on Replicate) whether the
// selfie shows shoulders/torso. If not, it stops immediately with a clear
// error instead of running (and billing for) a try-on that would look
// broken anyway. See lib/poseDetection.js for how that check works and what
// it went through to get here (two earlier, unconfirmed model guesses that
// didn't pan out).
//
// RETRY: every Replicate call in this file goes through withRetry() for 429s
// — Replicate has a base burst limit (~1 request/sec) independent of credit
// balance and payment method.
//
// Also confirm the "License" tab on the p-image-try-on model page states
// commercial use is permitted before sending real customer traffic through it.

const Replicate = require('replicate');
const { randomUUID } = require('crypto');
const { detectFullBody } = require('../lib/poseDetection');
const { classifyGarment } = require('../lib/garmentClassify');
const { looksAnatomicallyNormal } = require('../lib/anatomyCheck');
const { enforceMaxSize, DEFAULT_MAX_BYTES } = require('../lib/imageSizeLimit');
const { splitGarmentTopBottom } = require('../lib/garmentSplit');
const { uploadBuffer } = require('../lib/storage');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wraps any Replicate call with retry/backoff specifically for 429s.
 * `label` is just for clearer log lines when a retry happens.
 */
async function withRetry(label, fn, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      const is429 = err.message && err.message.includes('429');
      const isLastAttempt = i === attempts - 1;
      if (is429 && !isLastAttempt) {
        const waitMs = 2000 * (i + 1);
        console.warn(`${label} hit 429, retrying in ${waitMs}ms (attempt ${i + 1}/${attempts})`);
        await sleep(waitMs);
        continue;
      }
      throw err;
    }
  }
}

async function runPImageTryOn(replicate, personImage, garmentImages, turbo) {
  const output = await withRetry('p-image-try-on', () =>
    replicate.run('prunaai/p-image-try-on', {
      input: {
        person_image: personImage,
        garment_images: garmentImages, // array — 1 image for a single item, 2 (top+bottom crop) for a full outfit
        turbo: !!turbo,
      },
    })
  );
  return Array.isArray(output) ? output[0] : output;
}

async function runUpscale(replicate, imageUrl) {
  return withRetry('p-image-upscale', () =>
    replicate.run('prunaai/p-image-upscale:7135ff723ecea89c0f67afcd51e4904904586e351093465bdc7beed45941b3e0', {
      input: {
        image: imageUrl,
        upscale_mode: 'target',
        target: 8, // max supported megapixels
        enhance_details: true,
        enhance_realism: true,
        output_format: 'jpg',
        output_quality: 90,
      },
    })
  );
}

async function runTryOn({ modelImage, garmentImage, turbo }) {
  const apiToken = process.env.REPLICATE_API_TOKEN;
  if (!apiToken) throw new Error('REPLICATE_API_TOKEN is not set');

  const replicate = new Replicate({ auth: apiToken });

  let bodyDetection = null;
  const checkEnabled = process.env.ENABLE_BODY_CHECK !== 'false';

  if (checkEnabled) {
    let detection;
    try {
      detection = await withRetry('body-check', () => detectFullBody(replicate, modelImage));
    } catch (err) {
      // Detection genuinely failed after retries — fail open rather than
      // blocking the whole request on a detection-step bug.
      console.error('Body-coverage check failed after retries, assuming full body:', err.message);
      detection = { fullBodyDetected: true, reason: `Detection error (${err.message}), failed open` };
    }

    bodyDetection = { fullBodyDetected: detection.fullBodyDetected, reason: detection.reason };

    if (!detection.fullBodyDetected) {
      const err = new Error(
        'Full body not detected in the uploaded photo. Please upload a photo that shows your shoulders and torso, not just a close-up face.'
      );
      err.code = 'FULL_BODY_NOT_DETECTED';
      err.bodyDetection = bodyDetection;
      throw err;
    }
  }

  // Automatically classify the garment's structure — no manual checkbox.
  // This has to be automatic, not UI-driven, because this endpoint gets
  // called from channels with no UI at all (WhatsApp bots, other
  // integrations). See lib/garmentClassify.js for what this replaced and why.
  let garmentClassification = 'simple';
  const classifyEnabled = process.env.ENABLE_GARMENT_CLASSIFY !== 'false';
  if (classifyEnabled) {
    garmentClassification = await withRetry('garment-classify', () => classifyGarment(replicate, garmentImage));
  }

  let garmentImages = [garmentImage];
  if (garmentClassification === 'two-piece') {
    // Genuinely separate garments (blazer + trousers, top + skirt) — split
    // into top/bottom crops, each a coherent standalone item.
    try {
      const { topDataUri, bottomDataUri } = await splitGarmentTopBottom(garmentImage);
      garmentImages = [topDataUri, bottomDataUri];
      console.log('Two-piece garment detected — split into top/bottom crops');
    } catch (err) {
      console.error('Garment split failed, falling back to single full-frame garment image:', err.message);
    }
  } else if (garmentClassification === 'one-piece') {
    // A continuous draped garment (saree, gown, kaftan, jumpsuit, kurta).
    // DO NOT split this — a "bottom crop" of a continuous drape is a
    // meaningless fabric fragment, not a wearable garment (this is exactly
    // what broke on a real saree earlier). Instead, this sends the SAME
    // full image as two garment_images entries. CONFIRMED WORKING in
    // production for full-body coverage on a real saree (previously the
    // garment only covered the torso, leaving original clothing visible
    // below). Trade-off: this technique is also linked to an increased
    // chance of anatomical artifacts (a confirmed real case produced three
    // hands) — see the anatomy check + retry logic below, added
    // specifically to catch this.
    garmentImages = [garmentImage, garmentImage];
    console.log('One-piece draped garment detected — sending as duplicate full-image references, not split');
  }

  let imageUrl = await runPImageTryOn(replicate, modelImage, garmentImages, turbo);

  // Anatomy sanity check + retry — specifically for the one-piece path,
  // since that's the one confirmed to occasionally produce artifacts (see
  // lib/anatomyCheck.js header for the real case this was built from).
  // Diffusion outputs are stochastic, so a retry is a genuinely different
  // attempt, not a no-op. Capped at one retry to bound the extra cost.
  let anatomyWarning = null;
  const anatomyCheckEnabled = process.env.ENABLE_ANATOMY_CHECK !== 'false';
  if (anatomyCheckEnabled && garmentClassification === 'one-piece') {
    try {
      const looksNormal = await withRetry('anatomy-check', () => looksAnatomicallyNormal(replicate, imageUrl));
      if (!looksNormal) {
        console.log('Anatomy check failed (likely extra/malformed limbs) — retrying generation once');
        const retryUrl = await runPImageTryOn(replicate, modelImage, garmentImages, turbo);
        const retryLooksNormal = await withRetry('anatomy-check-retry', () =>
          looksAnatomicallyNormal(replicate, retryUrl)
        );
        if (retryLooksNormal) {
          imageUrl = retryUrl;
        } else {
          // Both attempts looked off — use the retry anyway (as good a
          // chance as the first) but flag it clearly rather than silently
          // hoping for the best.
          imageUrl = retryUrl;
          anatomyWarning =
            'This result may contain a rendering artifact (e.g. extra or malformed limbs) — a retry was attempted but the issue may persist. Regenerating again is worth trying.';
        }
      }
    } catch (err) {
      console.error('Anatomy check step failed, skipping it for this request:', err.message);
    }
  }

  let upscaled = false;
  let upscaleWarning = null;

  const shouldUpscale = process.env.UPSCALE_TRYON_RESULT !== 'false';
  if (shouldUpscale) {
    try {
      const upscaledOutput = await runUpscale(replicate, imageUrl);
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
      upscaleWarning = `Upscale step failed after retries: ${err.message} — showing raw (unupscaled) result.`;
      console.error('p-image-upscale step failed, returning unupscaled result:', err.message);
    }
  }

  // Return Replicate's URL directly in the normal case — fast, simple, no
  // extra hop. Only step in with compression + re-hosting if the file
  // actually exceeds 5MB, which should be rare for real photos (the earlier
  // approach ran this on every single request, which was needless overhead
  // for the common case).
  let finalUrl = imageUrl;
  let finalSizeBytes = null;
  let storageWarning = null;

  try {
    const headRes = await fetch(imageUrl, { method: 'HEAD' });
    const contentLength = headRes.headers.get('content-length');
    finalSizeBytes = contentLength ? parseInt(contentLength, 10) : null;
  } catch (err) {
    console.error('Could not check result size via HEAD request, returning Replicate URL as-is:', err.message);
  }

  const overBudget = finalSizeBytes !== null && finalSizeBytes > DEFAULT_MAX_BYTES;
  if (overBudget) {
    console.log(`Result is ${(finalSizeBytes / 1024 / 1024).toFixed(2)}MB, over the 5MB budget — compressing`);
    try {
      const { buffer, contentType, bytes } = await enforceMaxSize(imageUrl);
      finalSizeBytes = bytes;
      try {
        finalUrl = await uploadBuffer(buffer, `tryon-results/${randomUUID()}.jpg`, contentType);
      } catch (uploadErr) {
        // R2 not configured or upload failed — fall back to a data URI so the
        // size guarantee still holds, just not as a shareable link this time.
        finalUrl = `data:${contentType};base64,${buffer.toString('base64')}`;
        storageWarning = `Result exceeded 5MB and was compressed, but could not upload to persistent storage (${uploadErr.message}) — returning a temporary embedded image instead of a URL. Set R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET/R2_PUBLIC_BASE_URL to fix this.`;
        console.error('R2 upload failed, falling back to data URI:', uploadErr.message);
      }
    } catch (err) {
      console.error('Size enforcement failed, returning original (unverified size) URL:', err.message);
    }
  }

  return { imageUrl: finalUrl, upscaled, upscaleWarning, bodyDetection, garmentClassification, anatomyWarning, finalSizeBytes, storageWarning };
}

module.exports = { runTryOn };
