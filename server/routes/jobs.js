// routes/jobs.js
const express = require('express');
const { randomUUID } = require('crypto');
const rateLimit = require('express-rate-limit');
const jobStore = require('../lib/jobStore');
const { enqueueStep } = require('../queue/queue');

const router = express.Router();

// Cost guardrail: each generation costs real money (Replicate + storage).
// This caps abuse from a single IP; tune per your actual campaign traffic
// shape (e.g. behind a CDN, consider rate limiting per session/device ID
// instead if many real users share office/mobile-carrier IPs).
const createLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10, // 10 job creations per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — please wait a moment and try again.' },
});

router.post('/', createLimiter, async (req, res) => {
  try {
    const { selfieUrl, garmentUrl, turbo } = req.body || {};

    if (!selfieUrl || !garmentUrl) {
      return res.status(400).json({ error: 'Both "selfieUrl" and "garmentUrl" are required.' });
    }
    try {
      new URL(selfieUrl);
      new URL(garmentUrl);
    } catch {
      return res.status(400).json({ error: 'selfieUrl and garmentUrl must be valid URLs.' });
    }

    const id = randomUUID();
    await jobStore.createJob(id, {
      status: 'queued',
      selfieUrl,
      garmentUrl,
      turbo: turbo ? 'true' : 'false',
    });
    await enqueueStep(id, 'tryon');

    res.status(202).json({
      id,
      status: 'queued',
      statusUrl: `/api/jobs/${id}`,
    });
  } catch (err) {
    console.error('Job creation failed:', err);
    res.status(500).json({ error: 'Failed to create job' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const job = await jobStore.getJob(req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'Job not found (it may have expired or never existed).' });
    }

    res.json({
      id: req.params.id,
      status: job.status,
      imageUrl: job.resultUrl || null,
      error: job.error || null,
    });
  } catch (err) {
    console.error('Job lookup failed:', err);
    res.status(500).json({ error: 'Failed to look up job' });
  }
});

module.exports = router;
