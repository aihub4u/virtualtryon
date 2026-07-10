// providers/fashnVtonSelfHosted.js
// Calls a private Replicate model you've deployed yourself using the
// replicate-deploy/ Cog package (FASHN VTON v1.5, Apache-2.0 core model).
//
// IMPORTANT: see replicate-deploy/README.md's license caveat before using
// this for commercial traffic — the human-parser dependency this pipeline
// relies on is NOT confirmed to carry a commercial-safe license.

const Replicate = require('replicate');

async function runTryOn({ modelImage, garmentImage, category }) {
  const apiToken = process.env.REPLICATE_API_TOKEN;
  if (!apiToken) throw new Error('REPLICATE_API_TOKEN is not set');

  const selfHostedModel = process.env.SELF_HOSTED_MODEL;
  if (!selfHostedModel) {
    throw new Error(
      'SELF_HOSTED_MODEL is not set. Deploy replicate-deploy/ with `cog push r8.im/<you>/fashn-vton-1-5` first, then set SELF_HOSTED_MODEL=<you>/fashn-vton-1-5'
    );
  }

  const replicate = new Replicate({ auth: apiToken });

  const output = await replicate.run(selfHostedModel, {
    input: {
      person_image: modelImage,
      garment_image: garmentImage,
      category: category || 'tops', // "tops" | "bottoms" | "one-pieces"
    },
  });

  const imageUrl = Array.isArray(output) ? output[0] : output;
  return { imageUrl, raw: output };
}

module.exports = { runTryOn };
