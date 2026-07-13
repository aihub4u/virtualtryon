// lib/garmentClassify.js
// Automatically classifies a garment product photo into one of three
// structures, so the try-on pipeline can handle it correctly WITHOUT a
// manual checkbox — needed because this API is also called from channels
// with no UI at all (WhatsApp bots, other integrations).
//
// This replaces the "full outfit" checkbox, which caused a real production
// failure: a saree was manually flagged as "full outfit," which split the
// photo into a top-half and bottom-half crop. A saree is a continuous
// drape, not two separable garments — the bottom crop was just a fragment
// of fabric mid-drape, not a coherent standalone garment, so the model
// couldn't apply it and the person's original clothing showed through.
//
// v2: the first version asked one complex 3-way multiple-choice question
// (TWOPIECE / ONEPIECE / SIMPLE) — confirmed via a live response to
// misclassify an actual saree as "simple", meaning the one-piece handling
// path never even ran. Two sequential simple yes/no questions are a more
// reliable task for a vision model than one 3-way choice, so that's what
// this does now. The one-piece question also names "saree" explicitly and
// first, since that's the confirmed real-world failure case, not a
// hypothetical one.
//
// Uses lucataco/moondream2 (same model, same pinned version, as
// lib/poseDetection.js — see that file's header for why it's pinned).

const MODEL_VERSION = 'lucataco/moondream2:72ccb656353c348c1385df54b237eeb7bfa874bf11486cf0b9473e691b662d31';

const ONE_PIECE_QUESTION =
  'Look at this clothing product photo. Is it a saree, gown, kaftan, jumpsuit, salwar suit, lehenga, or any other single continuous garment or drape that covers the body from the upper torso down past the waist, all as ONE connected piece of fabric (not a separate top and bottom)? Answer with exactly one word: YES or NO.';

const TWO_PIECE_QUESTION =
  'Look at this clothing product photo. Does it show TWO genuinely separate, distinct garments worn together that could each be worn on their own — for example a blazer with trousers, or a top with a skirt (two distinct pieces of clothing, not one continuous piece of fabric)? Answer with exactly one word: YES or NO.';

async function askYesNo(replicate, garmentInput, question) {
  const output = await replicate.run(MODEL_VERSION, {
    input: { image: garmentInput, prompt: question },
  });
  const text = Array.isArray(output) ? output.join('') : String(output);
  return text.trim().toUpperCase().startsWith('YES');
}

/**
 * garmentInput: a data:image/...;base64,... string or a plain https URL.
 * Returns one of 'two-piece' | 'one-piece' | 'simple'.
 * Fails to 'simple' (the safest no-op default — just send the image as-is,
 * same as original behavior) if classification errors, rather than
 * blocking the whole try-on request on this step.
 */
async function classifyGarment(replicate, garmentInput) {
  try {
    const isOnePiece = await askYesNo(replicate, garmentInput, ONE_PIECE_QUESTION);
    if (isOnePiece) return 'one-piece';

    const isTwoPiece = await askYesNo(replicate, garmentInput, TWO_PIECE_QUESTION);
    if (isTwoPiece) return 'two-piece';

    return 'simple';
  } catch (err) {
    console.error('Garment classification failed, defaulting to simple (no special handling):', err.message);
    return 'simple';
  }
}

module.exports = { classifyGarment };
