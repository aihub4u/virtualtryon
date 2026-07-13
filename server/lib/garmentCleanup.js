// lib/garmentCleanup.js
// Isolates just the clothing from a garment product photo, removing any
// person/limbs visible in it (most product photos are on-model shots).
//
// Why this exists: confirmed in production that p-image-try-on can blend
// fragments of the GARMENT REFERENCE PHOTO's own model — their arms/hands —
// into the final composite alongside the actual selfie's body, producing
// extra-limb artifacts. This isn't fixable via a try-on model parameter (no
// published parameter reference exists for p-image-try-on at all — see
// providers/pImageTryOn.js). Instead, this pre-processes the garment photo
// with an image editor to strip the person out entirely before it's ever
// sent to the try-on model, so there's no second body for it to draw from.
//
// Uses prunaai/p-image-edit — confirmed schema (images, prompt,
// aspect_ratio) from multiple independent sources, all showing the plain
// owner/name form (no pinned version), unlike prunaai/p-image-upscale which
// needed one. If this 404s, check https://replicate.com/prunaai/p-image-edit
// directly — same class of issue as p-image-upscale/moondream2 elsewhere.

const CLEANUP_PROMPT =
  'Remove the person completely from this photo. Show only the garment/clothing item by itself, as if it were photographed as a flat-lay or on an invisible mannequin, on a plain neutral background. Do not show any human skin, arms, hands, legs, face, hair, or other body parts anywhere in the image. Preserve the garment\'s exact color, pattern, texture, drape, and design exactly as shown.';

/**
 * garmentInput: a data:image/...;base64,... string or a plain https URL.
 * Returns a cleaned image URL with the person removed, or the ORIGINAL
 * input unchanged if the cleanup step fails — this should never be the
 * reason a try-on request fails outright, just a best-effort improvement.
 */
async function cleanupGarmentImage(replicate, garmentInput) {
  try {
    const output = await replicate.run('prunaai/p-image-edit', {
      input: {
        images: [garmentInput],
        prompt: CLEANUP_PROMPT,
        aspect_ratio: 'match_input_image',
      },
    });
    const cleaned = Array.isArray(output) ? output[0] : output;
    if (!cleaned) {
      console.error('Garment cleanup returned no output, using original garment image');
      return garmentInput;
    }
    return cleaned;
  } catch (err) {
    console.error('Garment cleanup failed, using original garment image:', err.message);
    return garmentInput;
  }
}

module.exports = { cleanupGarmentImage };
