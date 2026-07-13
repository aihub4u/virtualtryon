// providers/idmVton.js
// Runs IDM-VTON on Replicate. NOTE: this model is licensed for non-commercial
// use only (CC BY-NC-SA 4.0). Fine for prototyping/demos, not for a paid
// production deployment — switch TRYON_PROVIDER=fashn for that.
//
// Version pin confirmed directly from Replicate's own versions page
// (https://replicate.com/cuuupid/idm-vton/versions) — this is a community
// (non-official) model, and those need an explicit version hash, same
// pattern as p-image-upscale and moondream2 elsewhere in this codebase.
// An earlier version of this file ran without a pin on the theory that
// Replicate would resolve "latest" automatically — that's only true for
// official models, and was never actually verified working for this one.

const Replicate = require('replicate');

const MODEL_VERSION = 'cuuupid/idm-vton:139cb1163486954531b765d4ac3bb6d3e02fe121151665adfc3b47e9ba3ebf67';

async function runTryOn({ modelImage, garmentImage, garmentDescription }) {
  const apiToken = process.env.REPLICATE_API_TOKEN;
  if (!apiToken) throw new Error('REPLICATE_API_TOKEN is not set');

  const replicate = new Replicate({ auth: apiToken });

  const output = await replicate.run(MODEL_VERSION, {
    input: {
      human_img: modelImage,
      garm_img: garmentImage,
      garment_des: garmentDescription || 'a garment',
    },
  });

  // replicate.run resolves to the model's output — for idm-vton this is a single image URL
  const imageUrl = Array.isArray(output) ? output[0] : output;
  return { imageUrl, raw: output };
}

module.exports = { runTryOn };
