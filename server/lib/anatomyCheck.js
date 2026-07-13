// lib/anatomyCheck.js
// Diffusion models occasionally produce anatomical artifacts — extra or
// duplicated hands/arms being the classic one. Confirmed in production on
// a one-piece garment result: coverage was fixed correctly, but the result
// showed three hands. Likely connected to the duplicate-image technique in
// providers/pImageTryOn.js (feeding the model two references of the same
// garment to blend may add rendering complexity that occasionally produces
// extra limbs) — but this class of artifact happens with diffusion image
// generation generally, not just here.
//
// This can't be fixed by prompting the generation model differently (no
// confirmed parameter for that — see providers/pImageTryOn.js's notes on
// p-image-try-on having no published parameter reference at all). Instead:
// check the result afterward, and if it looks anatomically wrong, retry the
// generation once. Diffusion outputs are stochastic, so a retry is a
// genuinely different roll, not a no-op.
//
// Uses lucataco/moondream2 (same model/version as elsewhere in this codebase).

const MODEL_VERSION = 'lucataco/moondream2:72ccb656353c348c1385df54b237eeb7bfa874bf11486cf0b9473e691b662d31';

const QUESTION =
  'Look carefully at this photo of a person. Count their visible hands and arms. Does the person have a completely normal human body — exactly two arms and two hands, no extra, duplicated, missing, or malformed limbs anywhere in the image? Answer with exactly one word: YES or NO.';

/**
 * imageInput: an image URL (the generated try-on result).
 * Returns true if the image looks anatomically normal, false if it looks
 * wrong. Fails to true (assume fine, don't force a retry) on any error —
 * this check should never be the reason a valid result gets thrown away.
 */
async function looksAnatomicallyNormal(replicate, imageInput) {
  try {
    const output = await replicate.run(MODEL_VERSION, {
      input: { image: imageInput, prompt: QUESTION },
    });
    const text = Array.isArray(output) ? output.join('') : String(output);
    return text.trim().toUpperCase().startsWith('YES');
  } catch (err) {
    console.error('Anatomy check failed, assuming image is fine:', err.message);
    return true;
  }
}

module.exports = { looksAnatomicallyNormal };
