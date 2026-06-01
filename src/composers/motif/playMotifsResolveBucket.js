// playMotifsResolveBucket.js - resolve unit bucket/cursor context for playMotifs

playMotifsResolveBucket = function playMotifsResolveBucket(unit, layer) {
  const plannedDivsPerBeat = (layer && Number.isFinite(layer.playMotifsResolveBucketPlannedDivsPerBeat)) ? Number(layer.playMotifsResolveBucketPlannedDivsPerBeat) : Number(divsPerBeat);
  const absBeatIdx = Number.isFinite(Number(beatIndex)) ? Number(beatIndex) : 0;
  const absDivOff = Number.isFinite(Number(divIndex)) ? Number(divIndex) : 0;
  const absDivIdx = m.max(0, absBeatIdx * plannedDivsPerBeat + absDivOff);
  const absSubOff = Number.isFinite(Number(subdivIndex)) ? Number(subdivIndex) : 0;
  const absSubIdx = absDivIdx * (Number.isFinite(Number(subdivsPerDiv)) ? Number(subdivsPerDiv) : 1) + absSubOff;
  const absSSbOff = Number.isFinite(Number(subsubdivIndex)) ? Number(subsubdivIndex) : 0;
  const absSSbIdx = absSubIdx * (Number.isFinite(Number(subsubsPerSub)) ? Number(subsubsPerSub) : 1) + absSSbOff;

  let targetIndex, bucket, bucketLabel;
  switch (unit) {
    case 'beat':
      targetIndex = absBeatIdx;
      bucket = layer.beatMotifs && layer.beatMotifs[targetIndex];
      bucketLabel = 'beatMotifs';
      if (!Array.isArray(bucket) || bucket.length === 0) {
        targetIndex = absBeatIdx * plannedDivsPerBeat;
        bucket = layer.divMotifs && layer.divMotifs[targetIndex];
        bucketLabel = 'divMotifs(fallback)';
      }
      break;
    case 'subdiv':
      targetIndex = absSubIdx;
      bucket = layer.subdivMotifs && layer.subdivMotifs[targetIndex];
      bucketLabel = 'subdivMotifs';
      if (!Array.isArray(bucket) || bucket.length === 0) {
        targetIndex = absDivIdx;
        bucket = layer.divMotifs && layer.divMotifs[targetIndex];
        bucketLabel = 'divMotifs(fallback)';
      }
      break;
    case 'subsubdiv':
      targetIndex = absSSbIdx;
      bucket = layer.subsubdivMotifs && layer.subsubdivMotifs[targetIndex];
      bucketLabel = 'subsubdivMotifs';
      if (!Array.isArray(bucket) || bucket.length === 0) {
        targetIndex = absSubIdx;
        bucket = layer.subdivMotifs && layer.subdivMotifs[targetIndex];
        bucketLabel = 'subdivMotifs(fallback)';
      }
      if (!Array.isArray(bucket) || bucket.length === 0) {
        targetIndex = absDivIdx;
        bucket = layer.divMotifs && layer.divMotifs[targetIndex];
        bucketLabel = 'divMotifs(fallback)';
      }
      break;
    default:
      targetIndex = absDivIdx;
      bucket = layer.divMotifs && layer.divMotifs[targetIndex];
      bucketLabel = 'divMotifs';
      break;
  }

  if (!Array.isArray(bucket) || bucket.length === 0) {
    throw new Error(`${unit}.playMotifs: empty ${bucketLabel} bucket at index ${targetIndex} - fail-fast`);
  }

  if (!layer.playMotifsResolveBucketBucketCursors) layer.playMotifsResolveBucketBucketCursors = {};
  if (!layer.playMotifsResolveBucketBucketCursors[unit]) layer.playMotifsResolveBucketBucketCursors[unit] = new Map();
  const cursorMap = layer.playMotifsResolveBucketBucketCursors[unit];

  return { targetIndex, bucket, bucketLabel, cursorMap };
};
