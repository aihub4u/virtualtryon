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
//
// ONLY CALL THIS FOR GENUINELY TWO-PIECE OUTFITS. Confirmed broken in
// production on a saree: splitting a one-piece draped garment (saree, gown,
// kaftan, jumpsuit, kurta) produces a coherent top crop but a MEANINGLESS
// bottom crop — just a fragment of continuous fabric mid-drape, not a
// standalone garment. The model can't apply that convincingly, and the
// person's original clothing shows through underneath in the result. For
// one-piece garments, send the whole photo as a single garment_images
// entry instead (skip this function entirely) and let the model treat it
// as one continuous piece, same as it would a dress.

const sharp = require('sharp');

const OVERLAP_RATIO = 0.08; // how much the two crops overlap around the midpoint

/**
 * garmentInput: a data:image/...;base64,... string OR a plain https URL
 * (the garment cleanup step in lib/garmentCleanup.js returns a URL, not a
 * data URI, so this needs to handle both).
 * Returns { topDataUri, bottomDataUri }.
 */
async function splitGarmentTopBottom(garmentInput) {
  let buffer;
  if (garmentInput.startsWith('data:')) {
    const match = garmentInput.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
    if (!match) throw new Error('Could not parse data URI garment input');
    buffer = Buffer.from(match[2], 'base64');
  } else {
    const res = await fetch(garmentInput);
    if (!res.ok) throw new Error(`Failed to download garment image (${res.status})`);
    buffer = Buffer.from(await res.arrayBuffer());
  }

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
