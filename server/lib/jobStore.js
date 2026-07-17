// lib/jobStore.js
// Job state lives in Redis as a hash: job:{id} -> { status, selfieUrl, ... }
//
// mapPrediction/getPredictionMapping below are no longer used by anything —
// they supported an earlier webhook-based worker design (see
// queue/worker.js's header for why that was replaced). Left in place rather
// than deleted in case a fire-and-forget/webhook design is wanted again for
// very high-throughput scenarios later.
//
// TTLs exist so a campaign that generates millions of jobs doesn't leave
// Redis growing forever — jobs and their prediction mappings expire after a
// couple of days, long enough for anyone to check their result.

const redis = require('./redisClient');

const JOB_TTL_SECONDS = 60 * 60 * 48; // 48h
const PREDMAP_TTL_SECONDS = 60 * 60 * 6; // predictions finish in minutes, not days

function jobKey(id) {
  return `job:${id}`;
}
function predMapKey(predictionId) {
  return `predmap:${predictionId}`;
}

async function createJob(id, data) {
  const key = jobKey(id);
  await redis.hset(key, {
    ...data,
    createdAt: Date.now().toString(),
    updatedAt: Date.now().toString(),
  });
  await redis.expire(key, JOB_TTL_SECONDS);
}

async function updateJob(id, patch) {
  const key = jobKey(id);
  // No expire() call here anymore — was refreshing the 48h TTL on every
  // single status update (queued -> processing -> completed), doubling
  // Redis command usage for no real benefit: jobs finish in well under a
  // minute, nowhere near the TTL boundary. TTL is set once at creation and
  // that's sufficient. This alone roughly halves write-side command usage,
  // relevant if you're near Upstash's free-tier command cap.
  await redis.hset(key, { ...patch, updatedAt: Date.now().toString() });
}

async function getJob(id) {
  const key = jobKey(id);
  const data = await redis.hgetall(key);
  if (!data || Object.keys(data).length === 0) return null;
  return data;
}

async function mapPrediction(predictionId, jobId, step) {
  const key = predMapKey(predictionId);
  await redis.hset(key, { jobId, step });
  await redis.expire(key, PREDMAP_TTL_SECONDS);
}

async function getPredictionMapping(predictionId) {
  const key = predMapKey(predictionId);
  const data = await redis.hgetall(key);
  if (!data || Object.keys(data).length === 0) return null;
  return data; // { jobId, step }
}

module.exports = {
  createJob,
  updateJob,
  getJob,
  mapPrediction,
  getPredictionMapping,
};
