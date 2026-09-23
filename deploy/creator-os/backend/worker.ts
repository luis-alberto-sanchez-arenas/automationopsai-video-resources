import cron from 'node-cron';
import { initPlatform, withLock } from './platform.js';
import { advanceEditorial } from './editorial.js';
import { demandContext, ensurePublishJob, processOnePublishStep, promoteApprovedReviewedJobs, youtubeConnected } from './youtube.js';
import {ensureTikTokPublishJob,processOneTikTokStep,tiktokMirrorEnabled} from './tiktok.js';

const USER_ID=process.env.OWNER_USER_ID||'owner';
await initPlatform();

async function editorialCycle(){
  if(!await youtubeConnected(USER_ID)){
    console.log('worker: waiting for YouTube OAuth');
    return;
  }
  const context=await demandContext(USER_ID);
  const step=await advanceEditorial(USER_ID,context);
  await ensurePublishJob(USER_ID,step.publishSpec);
  await ensureTikTokPublishJob(USER_ID,step.publishSpec);
  console.log(`worker: editorial=${step.status}`);
}
async function publishCycle(){
  const [youtube,tiktok]=await Promise.allSettled([
    youtubeConnected(USER_ID).then(connected=>connected?processOnePublishStep(USER_ID):{status:'not-connected'}),
    tiktokMirrorEnabled()?processOneTikTokStep(USER_ID):Promise.resolve({status:'disabled'}),
  ]);
  console.log(`worker: youtube=${JSON.stringify(youtube.status==='fulfilled'?youtube.value:{status:'failed',error:String(youtube.reason)})}`);
  console.log(`worker: tiktok=${JSON.stringify(tiktok.status==='fulfilled'?tiktok.value:{status:'failed',error:String(tiktok.reason)})}`);
  const promoted=await promoteApprovedReviewedJobs(USER_ID);
  if(promoted.length)console.log(`worker: promoted=${JSON.stringify(promoted)}`);
}
async function guarded(name:string,fn:()=>Promise<unknown>){
  try{await withLock(`automationopsai:${name}`,fn);}
  catch(e){console.error(`worker ${name}:`,e);}
}

const TIMEZONE=process.env.SCHEDULE_TIMEZONE||'America/Mexico_City';
cron.schedule('* * * * *',()=>void guarded('editorial',editorialCycle),{timezone:TIMEZONE});
cron.schedule('* * * * *',()=>void guarded('publisher',publishCycle),{timezone:TIMEZONE});

console.log(`AutomationOpsAI worker started: editorial/publisher every minute; release timezone=${TIMEZONE}; slots=06:00 short, 11:00 standard, 15:00 short, 22:00 short`);
void guarded('startup-editorial',editorialCycle);
void guarded('startup-publisher',publishCycle);
