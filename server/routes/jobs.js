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
//
// AUTH: this endpoint is for trusted backend callers only (a WhatsApp bot
// server, another internal service) — NOT meant for public/browser traffic.
// Every POST requires a valid x-api-key header matching BOT_API_KEY; there
// is no public/unauthenticated fallback. An earlier version of this file
// allowed unauthenticated calls under a stricter per-IP limit — removed on
// request, since this route is exclusively for the bot integration.
//
// RATE LIMITING: keyed per END USER (a userId in the request body — e.g.
// the WhatsApp phone number), not per IP, since the bot's own server IP is
// shared across every user going through it. This means many different
// real users can use the bot simultaneously without throttling each other,
// while a single user spamming requests still gets capped.

const express = require('express');
const { randomUUID } = require('crypto');
const rateLimit = require('express-rate-limit');
const jobStore = require('../lib/jobStore');
const { enqueueJob } = require('../queue/queue');

const router = express.Router();

function requireApiKey(req, res, next) {
  const key = req.header('x-api-key');
  if (!process.env.BOT_API_KEY) {
    // Misconfiguration, not a caller problem — fail closed with a clear
    // server-side signal rather than silently accepting everything.
    console.error('BOT_API_KEY is not set — rejecting all /api/jobs requests until it is configured.');
    return res.status(503).json({ error: 'This endpoint is not yet configured. Set BOT_API_KEY on the server.' });
  }
  if (!key || key !== process.env.BOT_API_KEY) {
    return res.status(401).json({ error: 'Missing or invalid x-api-key header.' });
  }
  next();
}

// Capped per END USER (userId in the request body), not per IP — see file
// header. Applied only after requireApiKey passes.
const perUserLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 6, // generations are not free — 6/min/user is generous for a real person, not a script
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.body?.userId || req.ip, // falls back to IP if userId is missing
  message: { error: 'Too many requests from this user — please wait a moment and try again.' },
});

router.post('/', requireApiKey, perUserLimiter, async (req, res) => {
  try {
    const { selfieUrl, garmentUrl, turbo, selectedProvider, skipBodyCheck, category, description, userId } = req.body || {};

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
      userId: userId || '',
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

router.get('/:id', requireApiKey, async (req, res) => {
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

    // fullBodyDetected can be true, false, or null (check skipped/not yet
    // run) — cast to a literal "true"/"false" string per request. null stays
    // null (not stringified) since it isn't actually a true/false answer,
    // it means "no detection result available yet or the check was skipped."
    const fullBodyDetectedRaw = bodyDetection?.fullBodyDetected ?? null;
    const fullBodyDetected = fullBodyDetectedRaw === null ? null : String(fullBodyDetectedRaw);

    res.json({
      id: req.params.id,
      status: job.status,
      imageUrl: result?.imageUrl ?? null,
      fullBodyDetected,
      error: job.error || null,
    });
  } catch (err) {
    console.error('Job lookup failed:', err);
    res.status(500).json({ error: 'Failed to look up job' });
  }
});

module.exports = router;
