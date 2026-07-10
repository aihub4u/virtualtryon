// providers/faceSwap.js
// Swaps a real face onto a generated try-on result. Used only in the
// face-only-selfie fallback path: try-on runs on a stock body photo, then
// this swaps the user's actual face into that result.
//
// Field names (swap_image, target_image, hair_source) are confirmed from
// Replicate's own published usage example for this model — not a guess,
// unlike the pose detection module. Still worth a quick check against
// https://replicate.com/easel/advanced-face-swap/api if you hit a 422.

async function swapFace(replicate, { userFaceImage, targetImage }) {
  const output = await replicate.run('easel/advanced-face-swap', {
    input: {
      swap_image: userFaceImage, // the real selfie — source of the face
      target_image: targetImage, // the try-on-on-stock-body result — scene to swap into
      hair_source: 'target', // keep the stock model's hair/hairstyle, just swap the face
    },
  });

  return Array.isArray(output) ? output[0] : output;
}

module.exports = { swapFace };
