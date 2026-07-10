// routes/tryon.js
const express = require('express');
const multer = require('multer');

const router = express.Router();

// Keep uploads in memory — we convert straight to base64 data URIs and never
// write to disk, since Render's filesystem is ephemeral anyway.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB per image
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed'));
    }
    cb(null, true);
  },
});

function fileToDataUri(file) {
  return `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
}

router.post(
  '/',
  upload.fields([
    { name: 'selfie', maxCount: 1 },
    { name: 'product', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const selfieFile = req.files?.selfie?.[0];
      const productFile = req.files?.product?.[0];

      if (!selfieFile || !productFile) {
        return res.status(400).json({
          error: 'Both "selfie" and "product" image files are required.',
        });
      }

      const modelImage = fileToDataUri(selfieFile);
      const garmentImage = fileToDataUri(productFile);
      const garmentDescription = req.body.description || undefined;

      const provider = (process.env.TRYON_PROVIDER || 'p-image-try-on').toLowerCase();
      let providerModule;
      if (provider === 'p-image-try-on') {
        providerModule = require('../providers/pImageTryOn');
      } else if (provider === 'fashn') {
        providerModule = require('../providers/fashn');
      } else if (provider === 'idm-vton') {
        providerModule = require('../providers/idmVton');
      } else if (provider === 'fashn-selfhosted') {
        providerModule = require('../providers/fashnVtonSelfHosted');
      } else {
        return res.status(500).json({ error: `Unknown TRYON_PROVIDER "${provider}"` });
      }

      const category = req.body.category || undefined; // "tops" | "bottoms" | "one-pieces" (self-hosted provider only)
      const turbo = req.body.turbo === 'true'; // p-image-try-on only: true = faster/lower fidelity, false = quality mode

      const result = await providerModule.runTryOn({
        modelImage,
        garmentImage,
        garmentDescription,
        category,
        turbo,
      });

      if (!result.imageUrl) {
        return res.status(502).json({ error: 'Provider returned no image', raw: result.raw });
      }

      res.json({ imageUrl: result.imageUrl, provider });
    } catch (err) {
      console.error('Try-on generation failed:', err);
      res.status(500).json({ error: err.message || 'Try-on generation failed' });
    }
  }
);

module.exports = router;
