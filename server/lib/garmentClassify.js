// lib/garmentClassify.js
// Automatically classifies a garment product photo into one of three
// structures, so the try-on pipeline can handle it correctly WITHOUT a
// manual checkbox — needed because this API is also called from channels
// with no UI (WhatsApp bots, other integrations) where a checkbox isn't an
// option anyway.
//
// This replaces the "full outfit" checkbox, which caused a real production
// failure: a saree was manually flagged as "full outfit," which split the
// photo into a top-half and bottom-half crop. A saree is a continuous
// drape, not two separable garments — the bottom crop was just a fragment
// of fabric mid-drape, not a coherent standalone garment, so the model
// couldn't apply it and the person's original clothing showed through.
//
// Uses lucataco/moondream2 (same model, same pinned version, as
// lib/poseDetection.js — see that file's header for why it's pinned).

const MODEL_VERSION = 'lucataco/moondream2:72ccb656353c348c1385df54b237eeb7bfa874bf11486cf0b9473e691b662d31';

const QUESTION =
  'Look at this clothing product photo. Reply with exactly one word: ' +
  '"TWOPIECE" if it shows two genuinely separate garments worn together that could be worn apart (e.g. a blazer with trousers, a top with a skirt, a jacket with pants). ' +
  '"ONEPIECE" if it is a single continuous garment covering more than just the torso — a saree, gown, kaftan, jumpsuit, kurta, salwar suit, lehenga, or any full-length draped or flowing item. ' +
  '"SIMPLE" if it is a single, ordinary garment covering only the torso or only the legs (a t-shirt, shirt, blouse, pair of trousers, skirt on its own).';

/**
 * garmentInput: a data:image/...;base64,... string or a plain https URL.
 * Returns one of 'two-piece' | 'one-piece' | 'simple'.
 * Fails to 'simple' (the safest no-op default — just send the image as-is,
 * same as current behavior) if the classification errors or can't be
 * parsed, rather than blocking the whole try-on request on this step.
 */
async function classifyGarment(replicate, garmentInput) {
  try {
    const output = await replicate.run(MODEL_VERSION, {
      input: {
        image: garmentInput,
        prompt: QUESTION,
      },
    });

    const text = Array.isArray(output) ? output.join('') : String(output);
    const answer = text.trim().toUpperCase();

    if (answer.includes('TWOPIECE')) return 'two-piece';
    if (answer.includes('ONEPIECE')) return 'one-piece';
    return 'simple';
  } catch (err) {
    console.error('Garment classification failed, defaulting to simple (no special handling):', err.message);
    return 'simple';
  }
}

module.exports = { classifyGarment };
