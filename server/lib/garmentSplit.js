// lib/garmentSplit.js
// For a product photo showing a full outfit (e.g. a suit, or a matching
// top+bottom set), a single garment image typically gets auto-categorized
// as ONE clothing type by try-on models — usually whichever is visually
// dominant (a blazer, say), with the rest of the outfit ignored. Splitting
// the same photo into a top-half and bottom-half crop and sending both as
// separate garment_images entries is the standard workaround across
// virtual try-on APIs generally (confirmed pattern, not specific to
// p-image-try-on — see README for the source).
//
// This is a coarse crop, not a segmentation model — it just splits the
// frame roughly in half with a little overlap so both crops still show
// enough context (waistband, jacket hem) for the try-on model to align
// each piece naturally.

const sharp = require('sharp');

const OVERLAP_RATIO = 0.08; // how much the two crops overlap around the midpoint

/**
 * garmentInput: a data:image/...;base64,... string.
 * Returns { topDataUri, bottomDataUri }.
 */
async function splitGarmentTopBottom(garmentInput) {
  const match = garmentInput.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
  if (!match) throw new Error('splitGarmentTopBottom expects a data URI input');
  const buffer = Buffer.from(match[2], 'base64');

  const image = sharp(buffer);
  const metadata = await image.metadata();
  const { width, height } = metadata;
  if (!width || !height) throw new Error('Could not read garment image dimensions');

  const midpoint = height / 2;
  const overlap = height * OVERLAP_RATIO;

  const topCrop = await sharp(buffer)
    .extract({ left: 0, top: 0, width, height: Math.round(midpoint + overlap) })
    .jpeg({ quality: 90 })
    .toBuffer();

  const bottomTop = Math.round(midpoint - overlap);
  const bottomCrop = await sharp(buffer)
    .extract({ left: 0, top: bottomTop, width, height: height - bottomTop })
    .jpeg({ quality: 90 })
    .toBuffer();

  return {
    topDataUri: `data:image/jpeg;base64,${topCrop.toString('base64')}`,
    bottomDataUri: `data:image/jpeg;base64,${bottomCrop.toString('base64')}`,
  };
}

module.exports = { splitGarmentTopBottom };
