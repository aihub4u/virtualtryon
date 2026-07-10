// routes/webhooks.js
const express = require('express');
const { validateWebhook } = require('replicate');
const jobStore = require('../lib/jobStore');
const { enqueueStep } = require('../queue/queue');
const { persistResultImage } = require('../lib/storage');

const router = express.Router();

// IMPORTANT: this route MUST receive the raw request body (not JSON-parsed)
// for signature verification to work — see index.js, where this router is
// mounted with express.raw() before the global express.json() middleware.
router.post('/replicate', async (req, res) => {
  try {
    const secret = process.env.REPLICATE_WEBHOOK_SECRET;
    if (!secret) {
      console.error('REPLICATE_WEBHOOK_SECRET is not set — rejecting webhook');
      return res.status(500).send('Webhook secret not configured');
    }

    const bodyString = req.body.toString('utf8');

    const isValid = await validateWebhook({
      id: req.header('webhook-id'),
      timestamp: req.header('webhook-timestamp'),
      signature: req.header('webhook-signature'),
      body: bodyString,
      secret,
    });

    if (!isValid) {
      return res.status(401).send('Invalid webhook signature');
    }

    const prediction = JSON.parse(bodyString);
    const mapping = await jobStore.getPredictionMapping(prediction.id);

    if (!mapping) {
      // Could be a stale/expired mapping, or a prediction from outside this
      // app. Acknowledge with 200 so Replicate doesn't keep retrying it.
      console.warn(`No job mapping found for prediction ${prediction.id}`);
      return res.status(200).send('OK (no mapping)');
    }

    const { jobId, step } = mapping;

    if (prediction.status === 'failed' || prediction.status === 'canceled') {
      await jobStore.updateJob(jobId, {
        status: 'failed',
        error: prediction.error || `Prediction ${step} ${prediction.status}`,
      });
      return res.status(200).send('OK');
    }

    if (prediction.status !== 'succeeded') {
      // "processing" / "starting" updates — nothing to do, we only asked
      // for the "completed" event anyway, but handle gracefully either way.
      return res.status(200).send('OK');
    }

    const outputUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
    if (!outputUrl) {
      await jobStore.updateJob(jobId, { status: 'failed', error: `${step} produced no output` });
      return res.status(200).send('OK');
    }

    if (step === 'tryon') {
      await jobStore.updateJob(jobId, {
        status: 'tryon_done',
        tryonResultUrl: outputUrl, // temporary replicate.delivery URL — fine, upscale reads it within the hour
      });
      await enqueueStep(jobId, 'upscale');
    } else if (step === 'upscale') {
      // This is the final image — copy it to persistent storage NOW, before
      // Replicate's 1-hour deletion window closes.
      try {
        const permanentUrl = await persistResultImage(outputUrl, `tryon-results/${jobId}.jpg`);
        await jobStore.updateJob(jobId, { status: 'completed', resultUrl: permanentUrl });
      } catch (persistErr) {
        console.error(`Failed to persist result for job ${jobId}:`, persistErr.message);
        // Fall back to the temporary URL rather than losing the result entirely —
        // it'll work for the next hour, which is better than showing an error.
        await jobStore.updateJob(jobId, {
          status: 'completed',
          resultUrl: outputUrl,
          error: 'Result may expire within an hour — persistent storage upload failed',
        });
      }
    }

    res.status(200).send('OK');
  } catch (err) {
    console.error('Webhook handling failed:', err);
    // Still 200 in most cases would be wrong here — a genuine processing bug
    // should surface as a retry from Replicate, so use 500.
    res.status(500).send('Internal error');
  }
});

module.exports = router;
