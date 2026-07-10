// providers/fashn.js
// Talks directly to FASHN AI's REST API (https://docs.fashn.ai).
// Commercial-use safe. Expects images as data URIs or public URLs.

const FASHN_BASE = 'https://api.fashn.ai/v1';

async function runTryOn({ modelImage, garmentImage }) {
  const apiKey = process.env.FASHN_API_KEY;
  if (!apiKey) throw new Error('FASHN_API_KEY is not set');

  const submitRes = await fetch(`${FASHN_BASE}/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model_name: process.env.FASHN_MODEL || 'tryon-v1.6',
      inputs: {
        model_image: modelImage,
        garment_image: garmentImage,
        category: 'auto',
        mode: 'balanced',
      },
    }),
  });

  if (!submitRes.ok) {
    const text = await submitRes.text();
    throw new Error(`FASHN submit failed (${submitRes.status}): ${text}`);
  }

  const { id } = await submitRes.json();
  if (!id) throw new Error('FASHN did not return a prediction id');

  // Poll for completion
  const started = Date.now();
  const timeoutMs = 60_000;
  while (Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, 1500));

    const statusRes = await fetch(`${FASHN_BASE}/status/${id}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!statusRes.ok) {
      const text = await statusRes.text();
      throw new Error(`FASHN status check failed (${statusRes.status}): ${text}`);
    }

    const data = await statusRes.json();
    if (data.status === 'completed') {
      return { imageUrl: data.output?.[0], raw: data };
    }
    if (data.status === 'failed') {
      throw new Error(`FASHN generation failed: ${data.error || 'unknown error'}`);
    }
    // status is "starting", "in_queue", or "processing" -> keep polling
  }

  throw new Error('FASHN generation timed out after 60s');
}

module.exports = { runTryOn };
