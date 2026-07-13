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
// misclassify an actual saree as "simple". Switched to two SEPARATE yes/no
// questions across two calls — confirmed working correctly afterward.
//
// v3 (cost pass): merged back into ONE call, but kept the two-separate-
// questions structure that actually fixed v1 — the model now answers two
// independent, clearly-labeled yes/no questions in one response, rather
// than picking one of three categories in a single judgment. This is a
// different (and hopefully still reliable) task shape than v1's mistake,
// not a reversion to it. Halves the classification cost (1 moondream2 call
// instead of up to 2). Worth re-verifying against a real saree — if
// misclassification comes back, revert to the two-call version.
//
// Uses lucataco/moondream2 (same model, same pinned version, as
// lib/poseDetection.js — see that file's header for why it's pinned).

const MODEL_VERSION = 'lucataco/moondream2:72ccb656353c348c1385df54b237eeb7bfa874bf11486cf0b9473e691b662d31';

const QUESTION =
  'Look at this clothing product photo and answer two separate questions, one per line, in exactly this format:\n' +
  'ONEPIECE: YES or NO\n' +
  'TWOPIECE: YES or NO\n\n' +
  'For ONEPIECE: answer YES if this is a saree, gown, kaftan, jumpsuit, salwar suit, lehenga, or any other single continuous garment or drape that covers the body from the upper torso down past the waist, all as ONE connected piece of fabric.\n' +
  'For TWOPIECE: answer YES if this shows TWO genuinely separate, distinct garments worn together that could each be worn on their own — for example a blazer with trousers, or a top with a skirt.\n' +
  'If ONEPIECE is YES, always answer TWOPIECE as NO. Answer with only the two lines, nothing else.';

/**
 * garmentInput: a data:image/...;base64,... string or a plain https URL.
 * Returns one of 'two-piece' | 'one-piece' | 'simple'.
 * Fails to 'simple' (the safest no-op default — just send the image as-is,
 * same as original behavior) if classification errors or the response
 * can't be parsed, rather than blocking the whole try-on request.
 */
async function classifyGarment(replicate, garmentInput) {
  try {
    const output = await replicate.run(MODEL_VERSION, {
      input: { image: garmentInput, prompt: QUESTION },
    });
    const text = (Array.isArray(output) ? output.join('') : String(output)).toUpperCase();

    const onePieceMatch = text.match(/ONEPIECE:\s*(YES|NO)/);
    const twoPieceMatch = text.match(/TWOPIECE:\s*(YES|NO)/);

    if (onePieceMatch && onePieceMatch[1] === 'YES') return 'one-piece';
    if (twoPieceMatch && twoPieceMatch[1] === 'YES') return 'two-piece';
    return 'simple';
  } catch (err) {
    console.error('Garment classification failed, defaulting to simple (no special handling):', err.message);
    return 'simple';
  }
}

module.exports = { classifyGarment };
