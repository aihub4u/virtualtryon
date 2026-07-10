// lib/jobStore.js
// Job state lives in Redis as a hash: job:{id} -> { status, selfieUrl, ... }
// A separate mapping predmap:{predictionId} -> jobId+step lets the webhook
// handler figure out which job a completed Replicate prediction belongs to.
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
  await redis.hset(key, { ...patch, updatedAt: Date.now().toString() });
  await redis.expire(key, JOB_TTL_SECONDS); // refresh TTL on update
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
