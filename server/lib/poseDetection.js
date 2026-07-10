// lib/poseDetection.js
// Detects whether a selfie shows enough of the body (shoulders/torso) for a
// direct try-on, or whether it's a face-only crop that needs the
// generic-body + face-swap fallback path instead.
//
// PREVIOUSLY this called ultralytics/yolo26-pose on Replicate — that model
// slug turned out not to exist (confirmed via a live 404, not a guess), and
// I wasn't able to verify the correct one from this environment after
// several attempts. Rather than guess a third time, this now uses Claude's
// vision capability directly via the Anthropic API instead — a schema I
// actually know precisely, with no guessing involved. Requires
// ANTHROPIC_API_KEY (separate from REPLICATE_API_TOKEN) — get one at
// https://console.anthropic.com/settings/keys.

const CLAUDE_MODEL = 'claude-sonnet-4-5-20250929';

/**
 * imageDataUri: a data:image/...;base64,... string (what fileToDataUri
 * produces in routes/tryon.js) or a plain https URL.
 * Returns { fullBodyDetected, reason }.
 * Throws on API errors (so the caller's retry wrapper can retry a 429) —
 * only fails open (assumes full body) if Claude's answer can't be parsed,
 * since that's a "we don't understand the response" case, not transient.
 */
async function detectFullBody(_replicateUnused, imageInput) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set — required for the face-only-selfie detection step. Get one at https://console.anthropic.com/settings/keys'
    );
  }

  const imageBlock = imageInput.startsWith('data:')
    ? (() => {
        const match = imageInput.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
        if (!match) throw new Error('Could not parse data URI for vision check');
        return { type: 'base64', media_type: match[1], data: match[2] };
      })()
    : { type: 'url', url: imageInput };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 20,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: imageBlock },
            {
              type: 'text',
              text:
                'Does this photo clearly show the person\'s shoulders and upper torso (not just a close-up face/headshot)? ' +
                'Reply with exactly one word: YES or NO.',
            },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Claude vision check failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  const answer = (data.content?.[0]?.text || '').trim().toUpperCase();

  if (answer.startsWith('YES')) {
    return { fullBodyDetected: true, reason: 'Claude vision check: shoulders/torso visible' };
  }
  if (answer.startsWith('NO')) {
    return { fullBodyDetected: false, reason: 'Claude vision check: face-only crop, no torso visible' };
  }

  // Unparseable answer — fail open rather than blocking the request.
  return { fullBodyDetected: true, reason: `Unparseable vision check response ("${answer}"), assuming full body` };
}

module.exports = { detectFullBody };
