// providers/idmVton.js
// Runs IDM-VTON on Replicate. NOTE: this model is licensed for non-commercial
// use only (CC BY-NC-SA 4.0). Fine for prototyping/demos, not for a paid
// production deployment — switch TRYON_PROVIDER=fashn for that.

const Replicate = require('replicate');

async function runTryOn({ modelImage, garmentImage, garmentDescription }) {
  const apiToken = process.env.REPLICATE_API_TOKEN;
  if (!apiToken) throw new Error('REPLICATE_API_TOKEN is not set');

  const replicate = new Replicate({ auth: apiToken });

  const output = await replicate.run(
    'cuuupid/idm-vton', // no pinned version -> Replicate resolves to the latest version automatically
    {
      input: {
        human_img: modelImage,
        garm_img: garmentImage,
        garment_des: garmentDescription || 'a garment',
      },
    }
  );

  // replicate.run resolves to the model's output — for idm-vton this is a single image URL
  const imageUrl = Array.isArray(output) ? output[0] : output;
  return { imageUrl, raw: output };
}

module.exports = { runTryOn };
