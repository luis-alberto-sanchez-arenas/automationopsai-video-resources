import { createHash } from 'node:crypto';

type Evidence = { manifest: any; review: any; qa: any; composition: any; originality: any };
/** Fail closed: evidence must belong to the exact bytes being imported. */
export function validateReviewedMaster(video: Buffer, evidence: Evidence): string[] {
  const {manifest,review,qa,composition,originality}=evidence;
  const failures:string[]=[];
  const sha=createHash('sha256').update(video).digest('hex');
  const finite=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x);
  if(manifest.stageOnly!==false)failures.push('explicit stageOnly:false required');
  if(manifest.video!=='video.mp4'||manifest.thumbnail!=='thumbnail.jpg')failures.push('unexpected asset paths');
  if(review.approved!==true||review.videoSha256!==sha)failures.push('approval missing or belongs to another video');
  for(const key of ['voiceNaturalnessReviewed','syncReviewed','contactSheetReviewed','markFramesReviewed','copyrightReviewed','originalityReviewed']){
    if(review[key]!==true)failures.push(`review missing: ${key}`);
  }
  const q=qa.technical||{};
  const portrait=q.width===1080&&q.height===1920;
  const landscape=q.width>=1920&&q.height>=1080;
  if(qa.passed!==true||qa.videoSha256!==sha||!Array.isArray(qa.failures)||qa.failures.length)failures.push('technical report invalid or stale');
  if(!portrait&&!landscape)failures.push('invalid resolution');
  if(!finite(q.fps)||q.fps<29.97)failures.push('invalid frame rate');
  if(!finite(q.duration)||!(portrait?q.duration>=35&&q.duration<=60:q.duration>=240&&q.duration<=480))failures.push('invalid duration');
  if(!finite(q.integrated_lufs)||q.integrated_lufs< -17.5||q.integrated_lufs> -14.5)failures.push('invalid loudness');
  if(!finite(q.true_peak_dbtp)||q.true_peak_dbtp> -1)failures.push('invalid true peak');
  for(const key of ['black_segments','long_silences'])if(!Array.isArray(q[key])||q[key].length)failures.push(`invalid ${key}`);
  if(composition.passed!==true||composition.videoSha256!==sha||composition.intersectingPixels!==0||composition.textBoundsCheckedEveryFrame!==true||
    !finite(composition.framesChecked)||!finite(q.duration)||!finite(q.fps)||Math.abs(composition.framesChecked-Math.round(q.duration*q.fps))>1){
    failures.push('composition not checked for every frame of this video');
  }
  if(originality.passed!==true||originality.videoSha256!==sha||!Array.isArray(originality.failures)||originality.failures.length||
    !Array.isArray(originality.comparisons)||!originality.comparisons.length)failures.push('originality report missing, failed, or stale');
  return failures;
}
