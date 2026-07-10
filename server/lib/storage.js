// lib/storage.js
// Replicate deletes output files after 1 hour, so any result someone might
// check later has to be copied somewhere durable immediately. This uploads
// to Cloudflare R2 (S3-compatible API, no egress fees — cheap at millions of
// images). Swap the client config for plain S3/another provider if you'd
// rather use that instead; the rest of the app only calls uploadToStorage().

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

function getClient() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error('R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY must all be set');
  }
  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

/**
 * Downloads a (temporary, Replicate-hosted) image URL and re-uploads it to
 * R2, returning a permanent public URL.
 */
async function persistResultImage(temporaryUrl, key) {
  const bucket = process.env.R2_BUCKET;
  const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL; // e.g. https://cdn.yourdomain.com or the r2.dev URL
  if (!bucket) throw new Error('R2_BUCKET is not set');
  if (!publicBaseUrl) throw new Error('R2_PUBLIC_BASE_URL is not set');

  const res = await fetch(temporaryUrl);
  if (!res.ok) throw new Error(`Failed to download temporary image (${res.status})`);
  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const contentType = res.headers.get('content-type') || 'image/jpeg';

  const client = getClient();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );

  return `${publicBaseUrl.replace(/\/$/, '')}/${key}`;
}

module.exports = { persistResultImage };
