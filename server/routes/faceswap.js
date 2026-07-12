// routes/faceswap.js
// Standalone face swap: swap a selfie's face onto ANY base/reference image,
// independent of the garment try-on pipeline. Useful when the base image
// already has the right pose/outfit/scene and a full try-on regeneration
// isn't needed — e.g. an on-model product photo, a poster, a template shot.

const express = require('express');
const multer = require('multer');
const Replicate = require('replicate');
const rateLimit = require('express-rate-limit');
const { swapFace } = require('../providers/faceSwap');
const { enforceMaxSize, DEFAULT_MAX_BYTES } = require('../lib/imageSizeLimit');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image files are allowed'));
    cb(null, true);
  },
});

// Same cost-guardrail pattern as /api/tryon.
const createLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — please wait a moment and try again.' },
});

function fileToDataUri(file) {
  return `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
}

router.post(
  '/',
  createLimiter,
  (req, res, next) => {
    upload.fields([
      { name: 'selfie', maxCount: 1 },
      { name: 'baseImage', maxCount: 1 },
    ])(req, res, (err) => {
      if (err) {
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
      const baseImageFile = req.files?.baseImage?.[0];

      if (!selfieFile || !baseImageFile) {
        return res.status(400).json({
          error: 'Both "selfie" (the face to use) and "baseImage" (the photo to swap it onto) are required.',
        });
      }

      const apiToken = process.env.REPLICATE_API_TOKEN;
      if (!apiToken) throw new Error('REPLICATE_API_TOKEN is not set');
      const replicate = new Replicate({ auth: apiToken });

      const userFaceImage = fileToDataUri(selfieFile);
      const targetImage = fileToDataUri(baseImageFile);
      const swappedUrl = await swapFace(replicate, { userFaceImage, targetImage });
      if (!swappedUrl) {
        return res.status(502).json({ error: 'Face swap returned no output' });
      }

      // Same size-safety net as the try-on route: check cheaply via HEAD,
      // only compress+rehost if actually over budget.
      let finalUrl = swappedUrl;
      let finalSizeBytes = null;
      let storageWarning = null;
      try {
        const headRes = await fetch(swappedUrl, { method: 'HEAD' });
        const contentLength = headRes.headers.get('content-length');
        finalSizeBytes = contentLength ? parseInt(contentLength, 10) : null;
      } catch (err) {
        console.error('Could not check face swap result size via HEAD request:', err.message);
      }

      if (finalSizeBytes !== null && finalSizeBytes > DEFAULT_MAX_BYTES) {
        try {
          const { uploadBuffer } = require('../lib/storage');
          const { randomUUID } = require('crypto');
          const { buffer, contentType, bytes } = await enforceMaxSize(swappedUrl);
          finalSizeBytes = bytes;
          try {
            finalUrl = await uploadBuffer(buffer, `faceswap-results/${randomUUID()}.jpg`, contentType);
          } catch (uploadErr) {
            finalUrl = `data:${contentType};base64,${buffer.toString('base64')}`;
            storageWarning = `Result exceeded 5MB and was compressed, but could not upload to persistent storage (${uploadErr.message}).`;
          }
        } catch (err) {
          console.error('Size enforcement failed for face swap result:', err.message);
        }
      }

      res.json({ imageUrl: finalUrl, finalSizeBytes, storageWarning });
    } catch (err) {
      console.error('Face swap failed:', err);
      res.status(500).json({ error: err.message || 'Face swap failed' });
    }
  }
);

module.exports = router;
