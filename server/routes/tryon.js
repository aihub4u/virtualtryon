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

function getProviderModule(name) {
  if (name === 'p-image-try-on') return require('../providers/pImageTryOn');
  if (name === 'fashn') return require('../providers/fashn');
  if (name === 'idm-vton') return require('../providers/idmVton');
  if (name === 'fashn-selfhosted') return require('../providers/fashnVtonSelfHosted');
  if (name === 'nano-banana') return require('../providers/nanoBanana');
  return null;
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

router.post(
  '/',
  (req, res, next) => {
    upload.fields([
      { name: 'selfie', maxCount: 1 },
      { name: 'product', maxCount: 1 },
    ])(req, res, (err) => {
      if (err) {
        // Multer errors (file too large, wrong type, etc.) land here — return
        // clean JSON instead of letting them fall through to Express's
        // default HTML error page, which the frontend can't parse.
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ error: 'Image too large — please use a photo under 10MB.' });
        }
        return res.status(400).json({ error: err.message || 'Upload failed' });
      }
      next();
    });
  },
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

      const primaryProviderName = (req.body.selectedProvider || process.env.TRYON_PROVIDER || 'p-image-try-on').toLowerCase();
      const providerModule = getProviderModule(primaryProviderName);
      if (!providerModule) {
        return res.status(500).json({ error: `Unknown provider "${primaryProviderName}"` });
      }

      const category = req.body.category || undefined; // "tops" | "bottoms" | "one-pieces" (self-hosted provider only)
      const turbo = req.body.turbo === 'true'; // p-image-try-on only: true = faster/lower fidelity, false = quality mode
      const skipBodyCheck = req.body.skipBodyCheck === 'true'; // p-image-try-on only: "accept any image" filter — bypasses the body-coverage rejection

      // How long to wait on the primary provider before treating it as
      // failed and trying the fallback — generous enough to cover a normal
      // cold start (confirmed to take up to ~2-3 min on Replicate's shared
      // "Official" model infrastructure), but not so long the user just
      // gives up waiting instead of getting a fallback result.
      const PRIMARY_TIMEOUT_MS = 150_000; // 2.5 minutes

      let result;
      let usedFallback = false;
      let primaryError = null;

      try {
        result = await withTimeout(
          providerModule.runTryOn({ modelImage, garmentImage, garmentDescription, category, turbo, skipBodyCheck }),
          PRIMARY_TIMEOUT_MS,
          primaryProviderName
        );
      } catch (err) {
        // A rejected/invalid INPUT (bad selfie) is not an infrastructure
        // problem — retrying with a different provider won't fix a bad
        // photo, so this always surfaces directly, never triggers fallback.
        if (err.code === 'FULL_BODY_NOT_DETECTED') throw err;

        // Genuine infrastructure-shaped failure (cold start timeout, 429s
        // exhausted, Replicate outage, etc.) — could try a backup provider
        // instead of failing outright, but this is now OPT-IN ONLY: no
        // default fallback (previously defaulted to nano-banana, removed
        // per request — set TRYON_FALLBACK_PROVIDER explicitly to
        // re-enable, e.g. "nano-banana" or "fashn").
        const fallbackProviderName = (process.env.TRYON_FALLBACK_PROVIDER || '').toLowerCase();
        const fallbackKeyPresent =
          fallbackProviderName === 'fashn' ? !!process.env.FASHN_API_KEY : !!process.env.REPLICATE_API_TOKEN;
        const fallbackConfigured = !!fallbackProviderName && fallbackProviderName !== primaryProviderName && fallbackKeyPresent;

        if (!fallbackConfigured) {
          throw err; // no usable fallback — surface the original error as before
        }

        console.error(
          `Primary provider "${primaryProviderName}" failed (${err.message}) — trying fallback "${fallbackProviderName}"`
        );
        primaryError = err.message;

        const fallbackModule = getProviderModule(fallbackProviderName);
        try {
          result = await withTimeout(
            fallbackModule.runTryOn({ modelImage, garmentImage, garmentDescription }),
            PRIMARY_TIMEOUT_MS,
            fallbackProviderName
          );
          usedFallback = true;
        } catch (fallbackErr) {
          console.error(`Fallback provider "${fallbackProviderName}" also failed:`, fallbackErr.message);
          const combined = new Error(
            `Primary provider failed (${err.message}), and the fallback also failed (${fallbackErr.message}).`
          );
          throw combined;
        }
      }

      if (!result.imageUrl) {
        return res.status(502).json({ error: 'Provider returned no image', raw: result.raw });
      }

      res.json({
        imageUrl: result.imageUrl,
        provider: usedFallback ? (process.env.TRYON_FALLBACK_PROVIDER || '').toLowerCase() : primaryProviderName,
        usedFallback,
        primaryError,
        upscaled: result.upscaled ?? null,
        upscaleWarning: result.upscaleWarning ?? null,
        bodyDetection: result.bodyDetection ?? null,
        garmentClassification: result.garmentClassification ?? null,
        garmentCleaned: result.garmentCleaned ?? null,
        anatomyWarning: result.anatomyWarning ?? null,
        finalSizeBytes: result.finalSizeBytes ?? null,
        storageWarning: result.storageWarning ?? null,
      });
    } catch (err) {
      if (err.code === 'FULL_BODY_NOT_DETECTED') {
        return res.status(422).json({
          error: err.message,
          bodyDetection: err.bodyDetection ?? null,
        });
      }
      console.error('Try-on generation failed:', err);
      res.status(500).json({ error: err.message || 'Try-on generation failed' });
    }
  }
);

module.exports = router;
