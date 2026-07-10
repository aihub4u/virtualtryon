// queue/worker.js
// Run this as a SEPARATE process from the API server (separate Render
// service, same repo). Its only job is to drain replicate-dispatch at a
// controlled rate and fire off Replicate predictions with a webhook —
// it does NOT wait for predictions to finish, so one small worker can
// dispatch thousands of jobs without holding thousands of connections open.
//
// Rate limit: 5 dispatches/second = 300/minute, comfortably under
// Replicate's 600/minute account-wide limit, leaving headroom for retries
// and any other Replicate usage on the same account.

require('dotenv').config();
const { Worker } = require('bullmq');
const Replicate = require('replicate');
const { makeConnection } = require('./queue');
const jobStore = require('../lib/jobStore');

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
const WEBHOOK_URL = process.env.WEBHOOK_BASE_URL
  ? `${process.env.WEBHOOK_BASE_URL.replace(/\/$/, '')}/api/webhooks/replicate`
  : null;

if (!WEBHOOK_URL) {
  throw new Error(
    'WEBHOOK_BASE_URL is not set — this must be your public API URL (e.g. https://your-app.onrender.com) so Replicate can call back.'
  );
}

async function dispatchTryOn(job) {
  const record = await jobStore.getJob(job.jobId);
  if (!record) throw new Error(`Job ${job.jobId} not found — may have expired`);

  const prediction = await replicate.predictions.create({
    model: 'prunaai/p-image-try-on',
    input: {
      person_image: record.selfieUrl,
      garment_images: [record.garmentUrl],
      turbo: record.turbo === 'true',
    },
    webhook: WEBHOOK_URL,
    webhook_events_filter: ['completed'],
  });

  await jobStore.mapPrediction(prediction.id, job.jobId, 'tryon');
  await jobStore.updateJob(job.jobId, {
    status: 'tryon_processing',
    tryonPredictionId: prediction.id,
  });
}

async function dispatchUpscale(job) {
  const record = await jobStore.getJob(job.jobId);
  if (!record) throw new Error(`Job ${job.jobId} not found — may have expired`);
  if (!record.tryonResultUrl) {
    throw new Error(`Job ${job.jobId} has no tryonResultUrl to upscale`);
  }

  const prediction = await replicate.predictions.create({
    version: '7135ff723ecea89c0f67afcd51e4904904586e351093465bdc7beed45941b3e0', // prunaai/p-image-upscale
    input: {
      image: record.tryonResultUrl,
      upscale_mode: 'target',
      target: 4,
      enhance_details: true,
      enhance_realism: true,
      output_format: 'jpg',
      output_quality: 85,
    },
    webhook: WEBHOOK_URL,
    webhook_events_filter: ['completed'],
  });

  await jobStore.mapPrediction(prediction.id, job.jobId, 'upscale');
  await jobStore.updateJob(job.jobId, {
    status: 'upscale_processing',
    upscalePredictionId: prediction.id,
  });
}

const worker = new Worker(
  'replicate-dispatch',
  async (job) => {
    if (job.name === 'tryon') {
      await dispatchTryOn(job.data);
    } else if (job.name === 'upscale') {
      await dispatchUpscale(job.data);
    } else {
      throw new Error(`Unknown job step: ${job.name}`);
    }
  },
  {
    connection: makeConnection(),
    limiter: { max: 5, duration: 1000 }, // 5/sec = 300/min dispatch rate
    concurrency: 10,
  }
);

worker.on('failed', async (job, err) => {
  console.error(`Job ${job?.data?.jobId} step "${job?.name}" failed:`, err.message);
  if (job?.attemptsMade >= (job?.opts?.attempts || 1)) {
    // Exhausted retries — mark the job as failed so GET /api/jobs/:id reflects it.
    await jobStore.updateJob(job.data.jobId, { status: 'failed', error: err.message }).catch(() => {});
  }
});

worker.on('completed', (job) => {
  console.log(`Dispatched ${job.name} for job ${job.data.jobId}`);
});

console.log('Worker started — draining replicate-dispatch at 5/sec');
