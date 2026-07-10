// lib/poseDetection.js
// Detects whether a selfie shows enough of the body (shoulders/torso) for a
// direct try-on, or whether it's a face-only crop that needs the
// generic-body + face-swap fallback path instead.
//
// Uses ultralytics/yolo26-pose on Replicate. IMPORTANT — same caveat as
// providers/pImageTryOn.js: I could not fetch this model's live API schema
// page from this environment, so the input/output field names below are
// built from Ultralytics' own COCO-pose keypoint documentation and the
// naming convention of their confirmed sibling model (ultralytics/yolo26-cls),
// not a confirmed live schema. Verify against
// https://replicate.com/ultralytics/yolo26-pose/api before relying on this,
// and adjust the `input` object / output parsing below if field names differ.
//
// COCO-pose keypoint indices (0-16), per Ultralytics docs:
// 0 nose, 1-2 eyes, 3-4 ears, 5-6 shoulders, 7-8 elbows, 9-10 wrists,
// 11-12 hips, 13-14 knees, 15-16 ankles.
const KEYPOINT = {
  LEFT_SHOULDER: 5,
  RIGHT_SHOULDER: 6,
  LEFT_HIP: 11,
  RIGHT_HIP: 12,
};

const CONFIDENCE_THRESHOLD = 0.4;

/**
 * Returns { fullBodyDetected, reason, raw }.
 * Throws on Replicate API errors (so the caller's retry wrapper can actually
 * retry a 429) — only fails open (assumes full body) when the call succeeds
 * but returns output we can't parse into keypoints, since that's a genuine
 * "we don't understand this shape" case, not a transient failure.
 */
async function detectFullBody(replicate, imageUrl) {
  const output = await replicate.run('ultralytics/yolo26-pose', {
    input: {
      image: imageUrl,
      model_size: 'n', // nano — fastest/cheapest, plenty for a coarse full-body check
      conf: 0.25,
    },
  });

  // Expected shape (best guess, VERIFY against live schema): an array of
  // detected people, each with a `keypoints` array of [x, y, confidence]
  // triples indexed per COCO-pose order. Handle a couple of plausible
  // shapes defensively since this is unconfirmed.
  const detections = Array.isArray(output) ? output : output?.predictions || output?.detections;
  if (!detections || detections.length === 0) {
    return { fullBodyDetected: false, reason: 'No person detected', raw: output };
  }

  const person = detections[0];
  const keypoints = person.keypoints || person.keypoints_xy || person.kpts;
  if (!keypoints || keypoints.length < 13) {
    // Can't parse keypoints in the shape we expected — fail open.
    return { fullBodyDetected: true, reason: 'Unrecognized keypoint format, assuming full body', raw: output };
  }

  const conf = (idx) => {
    const kp = keypoints[idx];
    // Support [x, y, conf] triples or {x, y, confidence} objects
    return Array.isArray(kp) ? kp[2] : kp?.confidence ?? kp?.conf ?? 0;
  };

  const shouldersVisible =
    conf(KEYPOINT.LEFT_SHOULDER) > CONFIDENCE_THRESHOLD || conf(KEYPOINT.RIGHT_SHOULDER) > CONFIDENCE_THRESHOLD;
  const hipsVisible =
    conf(KEYPOINT.LEFT_HIP) > CONFIDENCE_THRESHOLD || conf(KEYPOINT.RIGHT_HIP) > CONFIDENCE_THRESHOLD;

  // Require at least shoulders for a "top" try-on to make sense; hips too
  // if we want to be stricter about full-body. Shoulders-visible is the
  // practical bar — most tops/dresses just need the torso.
  return {
    fullBodyDetected: shouldersVisible,
    reason: shouldersVisible ? 'Shoulders detected' : 'Face-only crop — shoulders not visible',
    hipsVisible,
    raw: output,
  };
}

module.exports = { detectFullBody };
