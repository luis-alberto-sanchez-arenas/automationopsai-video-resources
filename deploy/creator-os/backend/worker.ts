import cron from 'node-cron';
import { initPlatform, withLock } from './platform.js';
import { advanceEditorial } from './editorial.js';
import { demandContext, ensurePublishJob, processOnePublishStep, promoteApprovedReviewedJobs, youtubeConnected } from './youtube.js';

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
  console.log(`worker: editorial=${step.status}`);
}
async function publishCycle(){
  if(!await youtubeConnected(USER_ID))return;
  const result=await processOnePublishStep(USER_ID);
  console.log(`worker: publish=${JSON.stringify(result)}`);
  const promoted=await promoteApprovedReviewedJobs(USER_ID);
  if(promoted.length)console.log(`worker: promoted=${JSON.stringify(promoted)}`);
}
async function guarded(name:string,fn:()=>Promise<unknown>){
  try{await withLock(`automationopsai:${name}`,fn);}
  catch(e){console.error(`worker ${name}:`,e);}
}

cron.schedule('* * * * *',()=>void guarded('editorial',editorialCycle));
cron.schedule('*/2 * * * *',()=>void guarded('publisher',publishCycle));

console.log('AutomationOpsAI worker started: editorial every minute, publisher every 2 minutes');
void guarded('startup-editorial',editorialCycle);
