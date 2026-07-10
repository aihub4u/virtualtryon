// lib/redisClient.js
// Single shared ioredis connection. Works with Upstash (or any Redis) via
// REDIS_URL. BullMQ needs maxRetriesPerRequest: null on its own connections,
// so queue.js and worker.js create their own clients from this same URL
// rather than reusing this instance directly.
//
// Connection is created lazily (on first use, not at require-time) so that
// importing this module doesn't crash the whole process for deployments
// that only use the synchronous /api/tryon flow and never configured Redis.

const Redis = require('ioredis');

let redis = null;

function getRedis() {
  if (redis) return redis;

  const REDIS_URL = process.env.REDIS_URL;
  if (!REDIS_URL) {
    throw new Error(
      'REDIS_URL is not set. Required for the async job pipeline (/api/jobs) — see README\'s "Scaling for campaign traffic" section. The synchronous /api/tryon route works fine without it.'
    );
  }

  redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 3 });
  redis.on('error', (err) => console.error('Redis connection error:', err.message));
  return redis;
}

// Proxy so existing call sites (`redis.hset(...)`) keep working unchanged,
// while the actual connection is only created the first time a method is called.
module.exports = new Proxy(
  {},
  {
    get(_target, prop) {
      return getRedis()[prop];
    },
  }
);

