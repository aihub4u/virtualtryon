// queue/queue.js
// One queue handles both pipeline steps ("tryon" and "upscale"), so a single
// rate limiter caps total dispatch to Replicate regardless of which step —
// this is what keeps a traffic spike from blowing through Replicate's
// 600 predictions/minute account-wide limit.

const { Queue } = require('bullmq');
const IORedis = require('ioredis');

function makeConnection() {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is not set');
  // BullMQ requires this exact option on its own Redis connections.
  return new IORedis(url, { maxRetriesPerRequest: null });
}

const replicateDispatchQueue = new Queue('replicate-dispatch', {
  connection: makeConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 1000, // keep last 1000 for debugging, drop the rest
    removeOnFail: 5000,
  },
});

async function enqueueStep(jobId, step) {
  await replicateDispatchQueue.add(step, { jobId, step });
}

module.exports = { replicateDispatchQueue, enqueueStep, makeConnection };
