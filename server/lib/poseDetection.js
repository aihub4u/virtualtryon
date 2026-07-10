// lib/poseDetection.js
// Detects whether a selfie shows enough of the body (shoulders/torso) for a
// direct try-on, or whether it's a face-only crop that needs the
// generic-body + face-swap fallback path instead.
//
// Uses lucataco/moondream2 on Replicate — a vision-language model, asked a
// direct yes/no question about the photo. This replaces two earlier failed
// attempts:
//   1. ultralytics/yolo26-pose — confirmed via live 404 not to exist.
//   2. Claude vision directly — worked, but the person asked for a
//      Replicate-only solution instead.
// moondream2's schema (input: `image`, `prompt`; output: list of text
// strings) is corroborated across multiple independent sources (not a
// single guessed page), and it's Apache-2.0 licensed — commercial-safe,
// unlike some of the try-on models elsewhere in this stack. Still, if you
// hit a validation error, check https://replicate.com/lucataco/moondream2/api
// directly and adjust the input object below.

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
  const output = await replicate.run('lucataco/moondream2', {
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
