import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateReviewedMaster } from './master-review.js';
const video=Buffer.from('test master');
const sha=createHash('sha256').update(video).digest('hex');
const fixture=()=>({
  manifest:{stageOnly:false,video:'video.mp4',thumbnail:'thumbnail.jpg'},
  review:{approved:true,videoSha256:sha,voiceNaturalnessReviewed:true,syncReviewed:true,contactSheetReviewed:true,markFramesReviewed:true,copyrightReviewed:true,originalityReviewed:true},
  qa:{passed:true,videoSha256:sha,failures:[],technical:{width:1080,height:1920,fps:30,duration:56.3,integrated_lufs:-16.15,true_peak_dbtp:-1.38,black_segments:[],long_silences:[]}},
  composition:{passed:true,videoSha256:sha,framesChecked:1689,intersectingPixels:0,textBoundsCheckedEveryFrame:true},
  originality:{passed:true,videoSha256:sha,failures:[],comparisons:[{path:'reviewed prior master'}]}
});
assert.deepEqual(validateReviewedMaster(video,fixture()),[]);
assert.ok(validateReviewedMaster(Buffer.from('replaced video'),fixture()).length);
for(const mutate of [
  (e:any)=>e.manifest.stageOnly=true,
  (e:any)=>delete e.manifest.stageOnly,
  (e:any)=>e.manifest.video='../other.mp4',
  (e:any)=>e.review.syncReviewed=false,
  (e:any)=>e.review.voiceNaturalnessReviewed=false,
  (e:any)=>e.qa.technical.integrated_lufs=NaN,
  (e:any)=>e.qa.technical.true_peak_dbtp=0,
  (e:any)=>e.qa.technical.long_silences=[[0,4]],
  (e:any)=>e.composition.framesChecked=0,
  (e:any)=>e.composition.intersectingPixels=1,
  (e:any)=>e.originality.comparisons=[],
  (e:any)=>delete e.originality.videoSha256,
]){const evidence=fixture();mutate(evidence);assert.ok(validateReviewedMaster(video,evidence).length);}
console.log('PASS: valid master, replaced bytes, and 12 invalid evidence cases');
