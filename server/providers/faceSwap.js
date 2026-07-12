// providers/faceSwap.js
// Swaps a real face onto any target image, via easel/advanced-face-swap.
// Used by the standalone /api/faceswap route (swap onto any base image the
// user provides) — originally built for the face-only-selfie fallback path,
// which is no longer wired up but could reuse this too.
//
// Field names (swap_image, target_image, hair_source) are confirmed from
// Replicate's own published usage example for this model — not a guess.
// Still worth a quick check against
// https://replicate.com/easel/advanced-face-swap/api if you hit a 422.

async function swapFace(replicate, { userFaceImage, targetImage, hairSource }) {
  const output = await replicate.run('easel/advanced-face-swap', {
    input: {
      swap_image: userFaceImage, // the real selfie — source of the face
      target_image: targetImage, // the photo to swap the face onto
      hair_source: hairSource === 'source' ? 'source' : 'target', // default: keep the base image's hair
    },
  });

  return Array.isArray(output) ? output[0] : output;
}

module.exports = { swapFace };
