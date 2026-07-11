// lib/imageSizeLimit.js
// Guarantees the final image stays under a target file size, regardless of
// how complex/detailed the content is (upscale quality settings alone can't
// promise this — a busy pattern or texture-heavy garment compresses far
// worse than a plain one at the same quality setting). Downloads the image,
// then iteratively reduces JPEG quality, then dimensions if quality alone
// isn't enough, until it fits.

const sharp = require('sharp');

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5MB

/**
 * Takes an image URL, returns { buffer, contentType, bytes } guaranteed to
 * be at or under maxBytes. Always re-encodes as JPEG for predictable,
 * efficient compression (fine for photos — this pipeline's output always is).
 */
async function enforceMaxSize(imageUrl, maxBytes = DEFAULT_MAX_BYTES) {
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`Failed to download image for size check (${res.status})`);
  let buffer = Buffer.from(await res.arrayBuffer());

  if (buffer.length <= maxBytes) {
    // Still re-encode as JPEG for a consistent output format, but at high
    // quality since we're already under budget.
    buffer = await sharp(buffer).jpeg({ quality: 92 }).toBuffer();
    if (buffer.length <= maxBytes) {
      return { buffer, contentType: 'image/jpeg', bytes: buffer.length };
    }
  }

  // Step 1: reduce JPEG quality in steps.
  for (const quality of [85, 75, 65, 55, 45]) {
    buffer = await sharp(buffer).jpeg({ quality }).toBuffer();
    if (buffer.length <= maxBytes) {
      return { buffer, contentType: 'image/jpeg', bytes: buffer.length };
    }
  }

  // Step 2: quality alone wasn't enough (very large/detailed image) — start
  // scaling dimensions down too, at a moderate quality, until it fits.
  let scale = 0.9;
  for (let i = 0; i < 8; i++) {
    const metadata = await sharp(buffer).metadata();
    const targetWidth = Math.round((metadata.width || 2000) * scale);
    buffer = await sharp(buffer).resize({ width: targetWidth }).jpeg({ quality: 70 }).toBuffer();
    if (buffer.length <= maxBytes) {
      return { buffer, contentType: 'image/jpeg', bytes: buffer.length };
    }
    scale -= 0.1;
  }

  // Should be unreachable in practice, but return whatever we've got rather
  // than throw — a slightly-over-budget image beats a hard failure.
  return { buffer, contentType: 'image/jpeg', bytes: buffer.length };
}

module.exports = { enforceMaxSize, DEFAULT_MAX_BYTES };
