// queue/queue.js
// One job per try-on request now — the provider modules (providers/*.js)
// internally handle every pipeline step (body-check, garment classify,
// cleanup, generation, anatomy-check, upscale) within a single awaited
// call, so there's no need for this queue to know about individual steps
// the way an earlier webhook-based version did. See queue/worker.js's
// header for the full rewrite rationale.
//
// The queue still exists — and still matters — because it's what lets the
// API respond instantly (job accepted, here's an ID) while a separate
// worker process actually burns through Replicate calls at a controlled
// rate, rather than every incoming request hitting Replicate directly and
// piling up against its rate limits during a traffic spike.

const { Queue } = require('bullmq');
const IORedis = require('ioredis');

function makeConnection() {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is not set');
  // BullMQ requires this exact option on its own Redis connections.
  return new IORedis(url, { maxRetriesPerRequest: null });
}

const tryonQueue = new Queue('tryon-jobs', {
  connection: makeConnection(),
  defaultJobOptions: {
    attempts: 2, // a full try-on pipeline is expensive — don't retry too aggressively
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 1000, // keep last 1000 for debugging, drop the rest
    removeOnFail: 5000,
  },
});

async function enqueueJob(jobId) {
  await tryonQueue.add('tryon', { jobId });
}

module.exports = { tryonQueue, enqueueJob, makeConnection };
