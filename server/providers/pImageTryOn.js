// providers/pImageTryOn.js
// Uses prunaai/p-image-try-on, an OFFICIAL Replicate model purpose-built for
// virtual try-on. Cheapest option found: $0.015 for the first garment,
// $0.008 for each additional one. No self-hosting, no cold starts.
//
// IMPORTANT: verify field names against the live schema before relying on
// this in production — open https://replicate.com/prunaai/p-image-try-on/api
// and diff it against the `input` object below. Field names here are based
// on Pruna's documented conventions (see replicate-deploy/README.md notes)
// but weren't confirmed against the live schema when this was written.
//
// Also confirm the "License" tab on that page states commercial use is
// permitted before sending real customer traffic through it — being an
// "Official model" means Replicate keeps it online and stably priced, it
// doesn't by itself guarantee the license terms you need.

const Replicate = require('replicate');

async function runTryOn({ modelImage, garmentImage, mode }) {
  const apiToken = process.env.REPLICATE_API_TOKEN;
  if (!apiToken) throw new Error('REPLICATE_API_TOKEN is not set');

  const replicate = new Replicate({ auth: apiToken });

  const output = await replicate.run('prunaai/p-image-try-on', {
    input: {
      person_image: modelImage,
      garment_images: [garmentImage], // supports up to 11 — extend this array for multi-garment try-on
      mode: mode || 'quality', // "quality" (<2s/garment) | "turbo" (faster, lower fidelity)
    },
  });

  const imageUrl = Array.isArray(output) ? output[0] : output;
  return { imageUrl, raw: output };
}

module.exports = { runTryOn };
