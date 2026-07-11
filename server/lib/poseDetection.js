// lib/poseDetection.js
// Detects whether a selfie shows enough of the body (shoulders/torso) for a
// direct try-on, or whether it's a face-only crop that should be rejected
// with a clear error instead of generating a broken result.
//
// Uses lucataco/moondream2 on Replicate — a vision-language model, asked a
// direct yes/no question about the photo. History on how this landed here:
//   1. ultralytics/yolo26-pose — confirmed via live 404 not to exist.
//   2. Claude vision directly — worked, but a Replicate-only solution was wanted.
//   3. lucataco/moondream2 without a pinned version — ALSO 404'd. Reason:
//      it's a community model (not "official"), and those need an explicit
//      version hash, same as prunaai/p-image-upscale did elsewhere in this
//      codebase. Plain `owner/name` only works for official models.
// The version hash below was pulled directly from Replicate's own versions
// page (https://replicate.com/lucataco/moondream2/versions), not guessed —
// it's the actual "Latest" version listed there as of this writing. If
// lucataco publishes a newer version later, check that page again.

const MODEL_VERSION = 'lucataco/moondream2:72ccb656353c348c1385df54b237eeb7bfa874bf11486cf0b9473e691b662d31';

const QUESTION =
  "Does this photo clearly show the person's shoulders and upper torso (not just a close-up face/headshot)? Answer with exactly one word: YES or NO.";

/**
 * imageInput: a data:image/...;base64,... string or a plain https URL —
 * same shape passed to the try-on model elsewhere in this pipeline.
 * Returns { fullBodyDetected, reason }.
 * Throws on Replicate API errors (so the caller's retry wrapper can retry a
 * 429) — only fails open (assumes full body) when the call succeeds but
 * returns text that doesn't clearly parse to YES/NO.
 */
async function detectFullBody(replicate, imageInput) {
  const output = await replicate.run(MODEL_VERSION, {
    input: {
      image: imageInput,
      prompt: QUESTION,
    },
  });

  // Output is documented as "a list of text strings" — join defensively in
  // case it comes back as an array of chunks vs. a single string.
  const text = Array.isArray(output) ? output.join('') : String(output);
  const answer = text.trim().toUpperCase();

  if (answer.startsWith('YES')) {
    return { fullBodyDetected: true, reason: 'moondream2: shoulders/torso visible' };
  }
  if (answer.startsWith('NO')) {
    return { fullBodyDetected: false, reason: 'moondream2: face-only crop, no torso visible' };
  }

  // Unparseable answer — fail open rather than blocking the request.
  return {
    fullBodyDetected: true,
    reason: `Unparseable vision check response ("${answer.slice(0, 60)}"), assuming full body`,
  };
}

module.exports = { detectFullBody };
