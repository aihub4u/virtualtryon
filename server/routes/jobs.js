// routes/jobs.js
// POST creates a job and returns an ID immediately. GET fetches status and
// (once ready) the result, using that ID. Built for callers where a
// synchronous request that blocks for 10-60+ seconds isn't practical —
// WhatsApp bots, other backend integrations, or a frontend that wants to
// poll rather than hold one long connection open.
//
// Accepts the same options as the synchronous POST /api/tryon (model
// selection, the Pruna-only "accept any image" filter, turbo mode,
// description) — see queue/worker.js, which runs the actual pipeline via
// the same provider modules /api/tryon uses, so this gets every fix
// (body-check, garment classification, cleanup, anatomy-check, upscale)
// automatically, with no risk of drifting out of sync with the
// synchronous route the way an earlier version of this file did.

const express = require('express');
const { randomUUID } = require('crypto');
const rateLimit = require('express-rate-limit');
const jobStore = require('../lib/jobStore');
const { enqueueJob } = require('../queue/queue');

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
    const { selfieUrl, garmentUrl, turbo, selectedProvider, skipBodyCheck, category, description } = req.body || {};

    if (!selfieUrl || !garmentUrl) {
      return res.status(400).json({ error: 'Both "selfieUrl" and "garmentUrl" are required.' });
    }
    try {
      new URL(selfieUrl);
      new URL(garmentUrl);
    } catch {
      return res.status(400).json({ error: 'selfieUrl and garmentUrl must be valid, publicly-reachable URLs.' });
    }

    const id = randomUUID();
    await jobStore.createJob(id, {
      status: 'queued',
      selfieUrl,
      garmentUrl,
      turbo: turbo ? 'true' : 'false',
      selectedProvider: selectedProvider || '',
      skipBodyCheck: skipBodyCheck ? 'true' : 'false',
      category: category || '',
      description: description || '',
    });
    await enqueueJob(id);

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

    // The full pipeline result (imageUrl + every diagnostic field —
    // upscaled, bodyDetection, garmentClassification, anatomyWarning, etc.)
    // is stored as one JSON blob by the worker, since Redis hash fields are
    // flat strings, not nested objects.
    let result = null;
    if (job.resultJson) {
      try {
        result = JSON.parse(job.resultJson);
      } catch (err) {
        console.error(`Failed to parse resultJson for job ${req.params.id}:`, err.message);
      }
    }

    let bodyDetection = result?.bodyDetection ?? null;
    if (!bodyDetection && job.bodyDetectionJson) {
      try {
        bodyDetection = JSON.parse(job.bodyDetectionJson);
      } catch {
        // ignore — leave as null
      }
    }

    res.json({
      id: req.params.id,
      status: job.status,
      imageUrl: result?.imageUrl ?? null,
      provider: job.provider || null,
      upscaled: result?.upscaled ?? null,
      upscaleWarning: result?.upscaleWarning ?? null,
      bodyDetection,
      garmentClassification: result?.garmentClassification ?? null,
      garmentCleaned: result?.garmentCleaned ?? null,
      anatomyWarning: result?.anatomyWarning ?? null,
      finalSizeBytes: result?.finalSizeBytes ?? null,
      storageWarning: result?.storageWarning ?? null,
      error: job.error || null,
    });
  } catch (err) {
    console.error('Job lookup failed:', err);
    res.status(500).json({ error: 'Failed to look up job' });
  }
});

module.exports = router;
