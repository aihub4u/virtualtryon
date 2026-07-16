// queue/worker.js
// Run this as a SEPARATE process from the API server (separate Render
// service, same repo). Drains the job queue and actually runs each try-on.
//
// REWRITE NOTE: the original version of this file fired raw Replicate
// predictions with a webhook callback, on the theory that predictions
// should be dispatched without waiting so one small worker could handle
// many jobs concurrently. That design predates most of this codebase's
// actual try-on pipeline (body-coverage check, automatic garment
// classification, garment cleanup, anatomy-check + retry, model selection,
// automatic fallback) — all of which lives in providers/*.js and was never
// wired into the old webhook-based worker, so the async job API was
// silently missing every fix built into the synchronous /api/tryon route.
//
// This version calls the SAME provider modules routes/tryon.js uses,
// awaiting the full result directly — replicate.run() (used throughout
// providers/*.js) already blocks until the prediction completes, so there
// was never actually a need for fire-and-forget + webhook complexity here.
// This is simpler AND gets every pipeline feature for free, automatically,
// forever (no more risk of the async path silently drifting out of sync
// with the sync path again).

require('dotenv').config();
const { Worker } = require('bullmq');
const { makeConnection } = require('./queue');
const jobStore = require('../lib/jobStore');

function getProviderModule(name) {
  if (name === 'p-image-try-on') return require('../providers/pImageTryOn');
  if (name === 'fashn') return require('../providers/fashn');
  if (name === 'idm-vton') return require('../providers/idmVton');
  if (name === 'fashn-selfhosted') return require('../providers/fashnVtonSelfHosted');
  if (name === 'nano-banana') return require('../providers/nanoBanana');
  return null;
}

async function runJob(jobId) {
  const record = await jobStore.getJob(jobId);
  if (!record) throw new Error(`Job ${jobId} not found — may have expired`);

  const providerName = (record.selectedProvider || process.env.TRYON_PROVIDER || 'p-image-try-on').toLowerCase();
  const providerModule = getProviderModule(providerName);
  if (!providerModule) throw new Error(`Unknown provider "${providerName}"`);

  await jobStore.updateJob(jobId, { status: 'processing' });

  const result = await providerModule.runTryOn({
    modelImage: record.selfieUrl,
    garmentImage: record.garmentUrl,
    garmentDescription: record.description || undefined,
    category: record.category || undefined,
    turbo: record.turbo === 'true',
    skipBodyCheck: record.skipBodyCheck === 'true',
  });

  if (!result.imageUrl) {
    throw new Error('Provider returned no image');
  }

  await jobStore.updateJob(jobId, {
    status: 'completed',
    provider: providerName,
    resultJson: JSON.stringify(result),
  });
}

const worker = new Worker(
  'tryon-jobs',
  async (job) => {
    try {
      await runJob(job.data.jobId);
    } catch (err) {
      // A rejected input (e.g. no body detected) is a real, permanent
      // result — not a transient failure BullMQ should retry. Mark it
      // failed immediately with the specific reason rather than burning
      // retry attempts on something that will never succeed.
      if (err.code === 'FULL_BODY_NOT_DETECTED') {
        await jobStore.updateJob(job.data.jobId, {
          status: 'failed',
          error: err.message,
          bodyDetectionJson: JSON.stringify(err.bodyDetection || null),
        });
        return; // don't rethrow — this isn't a job-processing failure to retry
      }
      throw err; // genuine failure — let BullMQ's retry/backoff handle it
    }
  },
  {
    connection: makeConnection(),
    concurrency: 5, // how many jobs this worker processes in parallel
  }
);

worker.on('failed', async (job, err) => {
  console.error(`Job ${job?.data?.jobId} failed:`, err.message);
  if (job && job.attemptsMade >= (job.opts?.attempts || 1)) {
    // Exhausted retries — mark the job as failed so GET /api/jobs/:id reflects it.
    await jobStore.updateJob(job.data.jobId, { status: 'failed', error: err.message }).catch(() => {});
  }
});

worker.on('completed', (job) => {
  console.log(`Job ${job.data.jobId} completed`);
});

console.log('Worker started — processing tryon-jobs, concurrency 5');
