// providers/pImageTryOn.js
// Uses prunaai/p-image-try-on, an OFFICIAL Replicate model purpose-built for
// virtual try-on. Cheapest option found: $0.015 for the first garment,
// $0.008 for each additional one. No self-hosting, no cold starts.
//
// Field names confirmed against a live 422 error from Replicate: person_image
// and garment_images were accepted; a string "mode" field was rejected
// ("Unexpected field 'mode'"). Pruna's sibling model p-image-edit uses a
// boolean `turbo` field rather than a mode string, so this now sends `turbo`
// instead. If you hit another validation error, check
// https://replicate.com/prunaai/p-image-try-on/api directly and adjust below.
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

  const imageUrl = Array.isArray(output) ? output[0] : output;
  return { imageUrl, raw: output };
}

module.exports = { runTryOn };
