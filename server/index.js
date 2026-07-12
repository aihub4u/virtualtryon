// index.js
require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const tryonRoute = require('./routes/tryon');
const faceswapRoute = require('./routes/faceswap');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// The async job pipeline (queue + webhooks) needs Redis. Only wire it up if
// REDIS_URL is configured, so deployments using only the synchronous
// /api/tryon flow don't need Redis at all.
const asyncPipelineEnabled = !!process.env.REDIS_URL;
if (asyncPipelineEnabled) {
  const webhooksRoute = require('./routes/webhooks');
  // Webhook route needs the RAW body for signature verification — must be
  // mounted before express.json() below, or Replicate's signature check fails.
  app.use('/api/webhooks', express.raw({ type: 'application/json' }), webhooksRoute);
}

app.use(express.json({ limit: '2mb' }));

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    provider: process.env.TRYON_PROVIDER || 'p-image-try-on',
    asyncJobPipeline: asyncPipelineEnabled,
  });
});

// Synchronous upload-based flow (single-service, good for low/medium traffic)
app.use('/api/tryon', tryonRoute);

// Standalone face swap — swap a selfie's face onto ANY base image, separate
// from the garment try-on pipeline entirely.
app.use('/api/faceswap', faceswapRoute);

// Async job-based flow (POST creates a job, GET polls it) — this is the one
// built for scale: queue-backed, webhook-driven, safe for campaign traffic.
if (asyncPipelineEnabled) {
  const jobsRoute = require('./routes/jobs');
  app.use('/api/jobs', jobsRoute);
} else {
  app.use('/api/jobs', (req, res) => {
    res.status(503).json({
      error: 'Async job pipeline not configured — set REDIS_URL (see .env.example) to enable /api/jobs.',
    });
  });
}

// Serve the frontend (single-service deploy, same pattern as the RedTag tracker)
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Virtual try-on server running on port ${PORT}`);
  console.log(`Provider: ${process.env.TRYON_PROVIDER || 'p-image-try-on'}`);
});
