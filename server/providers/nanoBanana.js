// providers/nanoBanana.js
// Backup try-on provider using google/nano-banana on Replicate. Used
// automatically by routes/tryon.js when the primary provider
// (prunaai/p-image-try-on) fails or times out — cold starts, Replicate
// account credit throttling, or any other issue affecting that specific
// model's infrastructure.
//
// Why this model specifically: it's a genuinely different model family
// (Google's Gemini) from the primary path (Pruna's Flux-based stack), so a
// problem specific to Pruna's models (e.g. their cold-start behavior, or an
// issue with that publisher's infrastructure) doesn't take down the
// fallback too. Still the same Replicate account, so this does NOT protect
// against account-wide issues like a credit/billing throttle — only a
// genuinely separate platform (like the FASHN direct-API provider also in
// this codebase) protects against that category of failure.
//
// This is NOT a purpose-built try-on model — it's a general instruction-
// following image editor being directed via a prompt to do a try-on-shaped
// task. Confirmed schema (prompt, image_input array, output_format) from
// Replicate's own published code examples across multiple pages. Expect
// somewhat less consistent results than a dedicated try-on model; that's an
// acceptable trade-off for "something reasonable" over "no result at all"
// when the primary is down.

const TRYON_PROMPT =
  'Take the person shown in the first image and dress them in the exact garment/outfit shown in the second image. Preserve the person\'s face, identity, pose, body shape, and the photo\'s background and lighting exactly. Preserve the garment\'s exact color, pattern, texture, and design exactly as shown in the second image. Return a single photoreal composite image.';

async function runTryOn({ modelImage, garmentImage }) {
  const apiToken = process.env.REPLICATE_API_TOKEN;
  if (!apiToken) throw new Error('REPLICATE_API_TOKEN is not set');

  const Replicate = require('replicate');
  const replicate = new Replicate({ auth: apiToken });

  const output = await replicate.run('google/nano-banana', {
    input: {
      prompt: TRYON_PROMPT,
      image_input: [modelImage, garmentImage],
      output_format: 'jpg',
    },
  });

  // Replicate's JS client returns a FileOutput object for this model (per
  // their own docs: output.url() / output bytes via .read()), not a plain
  // string URL like the array-returning models elsewhere in this codebase.
  // Handle both shapes defensively.
  let imageUrl;
  if (typeof output === 'string') {
    imageUrl = output;
  } else if (Array.isArray(output)) {
    imageUrl = output[0];
  } else if (output && typeof output.url === 'function') {
    imageUrl = output.url();
  } else if (output && output.url) {
    imageUrl = output.url;
  }

  return { imageUrl, raw: output };
}

module.exports = { runTryOn };
