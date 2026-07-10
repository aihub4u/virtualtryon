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

  const shouldUpscale = process.env.UPSCALE_TRYON_RESULT !== 'false';
  if (shouldUpscale) {
    try {
      const upscaled = await replicate.run(
        'prunaai/p-image-upscale:7135ff723ecea89c0f67afcd51e4904904586e351093465bdc7beed45941b3e0',
        {
          input: {
            image: imageUrl,
            upscale_mode: 'target',
            target: 4, // megapixels — plenty for web/product display, keeps cost low
            enhance_details: true,
            enhance_realism: true,
            output_format: 'jpg',
            output_quality: 85,
          },
        }
      );
      const upscaledUrl = Array.isArray(upscaled) ? upscaled[0] : upscaled;
      if (upscaledUrl) imageUrl = upscaledUrl;
    } catch (err) {
      // Don't fail the whole request if upscaling has a hiccup — fall back to
      // the unupscaled (blurrier but valid) try-on result.
      console.error('p-image-upscale step failed, returning unupscaled result:', err.message);
    }
  }

  return { imageUrl, raw: output };
}

module.exports = { runTryOn };
