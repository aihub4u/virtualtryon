// providers/faceSwap.js
// Swaps a real face onto any target image.
//
// IMPORTANT: originally used easel/advanced-face-swap, but that model has
// been taken down from Replicate entirely — its page now 404s ("Page not
// found"), not just a permissions error. Confirmed by visiting the page
// directly, not assumed. Switched to codeplugtech/face-swap instead:
//   - Confirmed to exist and actively used (2.4M+ runs)
//   - Field names confirmed via a live 422 error, not just docs: swap_image
//     was accepted, but "target_image" was rejected — the real field is
//     input_image. (Sources describing this model as taking a "swap image"
//     and "target/input image" were technically accurate but didn't state
//     the literal field name clearly enough to avoid this guess.)
//   - Cheaper (~$0.0064-0.0068/run vs. easel's ~$0.04/run)
//   - Does NOT support a hair_source parameter — that was specific to
//     Easel's model, so it's silently ignored here if passed
//   - Non-official model, so needs a pinned version (same pattern as
//     p-image-upscale and moondream2 elsewhere in this codebase) — this
//     hash was pulled directly from Replicate's own versions page
//     (https://replicate.com/codeplugtech/face-swap/versions), not guessed.
// If a newer version gets published, check that page again.
//
// Trade-off vs. the old Easel model: likely lower fidelity for full-body
// swaps (this one is focused on face-region swapping specifically), but
// it's a real, working, actively-maintained model — which the previous
// choice no longer is.

const MODEL_VERSION =
  'codeplugtech/face-swap:278a81e7ebb22db98bcba54de985d22cc1abeead2754eb1f2af717247be69b34';

async function swapFace(replicate, { userFaceImage, targetImage }) {
  const output = await replicate.run(MODEL_VERSION, {
    input: {
      swap_image: userFaceImage, // the real selfie — source of the face
      input_image: targetImage, // the photo to swap the face onto (confirmed via live 422: NOT "target_image")
    },
  });

  return Array.isArray(output) ? output[0] : output;
}

module.exports = { swapFace };
