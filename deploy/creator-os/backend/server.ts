import express from 'express';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { initPlatform, requireAdmin, serveBlob, storage } from './platform.js';
import { advanceEditorial, getEditorialStatus } from './editorial.js';
import {
  channelSummary,demandContext,ensurePublishJob,ensureReviewedPublishJob,listJobs,oauthComplete,oauthStart,
  processOnePublishStep,youtubeConnected,
} from './youtube.js';

const USER_ID=process.env.OWNER_USER_ID||'owner';
await initPlatform();

const app=express();
app.disable('x-powered-by');
app.use(express.json({limit:'2mb'}));
app.get('/_storage',serveBlob);

app.get('/api/_healthcheck',(_req,res)=>res.json({ok:true,service:'AutomationOpsAI',version:'portable-v1'}));

app.get('/api/public/status',async(_req,res,next)=>{
  try{
    const editorial=await getEditorialStatus(USER_ID);
    res.json({
      editorial:{stage:editorial.stage,title:editorial.title,qualityScore:editorial.qualityScore,renderedScenes:editorial.renderedScenes,totalScenes:editorial.totalScenes,nextAction:editorial.nextAction,youtubeUrl:editorial.youtubeUrl},
      youtubeConfigured:Boolean(process.env.GOOGLE_CLIENT_ID&&process.env.GOOGLE_CLIENT_SECRET),
      aiConfigured:Boolean(process.env.GEMINI_API_KEY||(process.env.AI_BASE_URL&&process.env.AI_API_KEY&&process.env.AI_MODEL)),
      ttsPolicy:process.env.TTS_POLICY||'neural_required',
    });
  }catch(e){next(e);}
});

app.get('/api/status',requireAdmin,async(_req,res,next)=>{
  try{
    const [editorial,jobs,connected,channel]=await Promise.all([
      getEditorialStatus(USER_ID),listJobs(USER_ID),youtubeConnected(USER_ID),channelSummary(USER_ID).catch(()=>null),
    ]);
    res.json({
      youtubeConnected:connected,channel,editorial,
      jobs:jobs.map(x=>({id:x.id,title:x.title,status:x.status,progress:x.totalBytes?Math.min(100,Math.round((x.uploadedBytes/x.totalBytes)*100)):0,youtubeUrl:x.youtubeUrl,lastError:x.lastError,thumbnailStatus:x.thumbnailStatus,updatedAt:x.updatedAt})),
      config:{
        google:Boolean(process.env.GOOGLE_CLIENT_ID&&process.env.GOOGLE_CLIENT_SECRET),
        ai:Boolean(process.env.GEMINI_API_KEY||(process.env.AI_BASE_URL&&process.env.AI_API_KEY&&process.env.AI_MODEL)),
        database:Boolean(process.env.DATABASE_URL),
        publicOrigin:process.env.PUBLIC_ORIGIN||null,
        ttsPolicy:process.env.TTS_POLICY||'neural_required',
      }
    });
  }catch(e){next(e);}
});

app.get('/api/oauth/start',requireAdmin,async(_req,res,next)=>{
  try{res.json(await oauthStart(USER_ID));}catch(e){next(e);}
});
app.post('/api/oauth/complete',requireAdmin,async(req,res,next)=>{
  try{
    const {code,state}=req.body||{};if(!code||!state)return res.status(400).json({error:'Missing code/state'});
    res.json(await oauthComplete(USER_ID,String(code),String(state)));
  }catch(e){next(e);}
});
app.get('/api/oauth/callback',(req,res)=>{
  const q=new URLSearchParams();
  if(req.query.code)q.set('code',String(req.query.code));
  if(req.query.state)q.set('state',String(req.query.state));
  if(req.query.error)q.set('error',String(req.query.error));
  res.redirect(302,`/?${q.toString()}`);
});

function reviewedKey(value:unknown){
  const key=String(value||'');
  if(!/^[a-z0-9][a-z0-9-]{7,79}$/.test(key))throw new Error('Invalid reviewed asset key');
  return key;
}
function verifiedBody(req:express.Request){
  if(!Buffer.isBuffer(req.body)||req.body.length===0)throw new Error('Empty reviewed asset');
  const expected=String(req.headers['x-content-sha256']||'').toLowerCase();
  const actual=createHash('sha256').update(req.body).digest('hex');
  if(!/^[a-f0-9]{64}$/.test(expected)||expected!==actual)throw new Error('Reviewed asset SHA-256 mismatch');
  return req.body as Buffer;
}
app.post('/api/reviewed/video',requireAdmin,express.raw({type:'video/mp4',limit:'400mb'}),async(req,res,next)=>{
  try{
    const key=reviewedKey(req.query.key),content=verifiedBody(req);
    if(content.length<1_000_000)throw new Error('Reviewed video is too small');
    const path=`reviewed/${USER_ID}/${key}/video.mp4`;
    await storage.write([{path,content,contentType:'video/mp4'}]);res.json({ok:true,path,bytes:content.length});
  }catch(e){next(e);}
});
app.post('/api/reviewed/thumbnail',requireAdmin,express.raw({type:['image/jpeg','image/png'],limit:'10mb'}),async(req,res,next)=>{
  try{
    const key=reviewedKey(req.query.key),content=verifiedBody(req),type=String(req.headers['content-type']||'');
    if(content.length<10_000)throw new Error('Reviewed thumbnail is too small');
    const ext=type==='image/png'?'png':'jpg',path=`reviewed/${USER_ID}/${key}/thumbnail.${ext}`;
    await storage.write([{path,content,contentType:type}]);res.json({ok:true,path,bytes:content.length});
  }catch(e){next(e);}
});
app.post('/api/reviewed/jobs',requireAdmin,async(req,res,next)=>{
  try{
    const {key,title,description,tags,transcript,videoPath,thumbnailPath}=req.body||{};
    const cleanKey=reviewedKey(key);
    if(!title||!description||!videoPath||!thumbnailPath)throw new Error('Reviewed job metadata is incomplete');
    if(videoPath!==`reviewed/${USER_ID}/${cleanKey}/video.mp4`||!String(thumbnailPath).startsWith(`reviewed/${USER_ID}/${cleanKey}/thumbnail.`))throw new Error('Reviewed asset paths do not match the job key');
    const job=await ensureReviewedPublishJob(USER_ID,{key:cleanKey,title:String(title),description:String(description),tags:Array.isArray(tags)?tags.map(String):[],transcript:String(transcript||''),preparedStoragePath:videoPath,thumbnailStoragePath:thumbnailPath});
    res.json({ok:true,id:job.id,status:job.status});
  }catch(e){next(e);}
});

app.post('/api/editorial/advance',requireAdmin,async(_req,res,next)=>{
  try{
    const context=await demandContext(USER_ID);
    const step=await advanceEditorial(USER_ID,context);
    await ensurePublishJob(USER_ID,step.publishSpec);
    res.json({ok:true,status:step.status,editorial:await getEditorialStatus(USER_ID)});
  }catch(e){next(e);}
});
app.post('/api/publish/now',requireAdmin,async(_req,res,next)=>{
  try{res.json({ok:true,...await processOnePublishStep(USER_ID),editorial:await getEditorialStatus(USER_ID)});}
  catch(e){next(e);}
});

app.use(express.static(join(process.cwd(),'public'),{maxAge:'5m'}));
app.use((_req,res)=>res.sendFile(join(process.cwd(),'public','index.html')));

app.use((err:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
  const message=err instanceof Error?err.message:String(err);
  console.error(err);
  res.status(500).json({error:message});
});

const port=Number(process.env.PORT||3000);
app.listen(port,'0.0.0.0',()=>console.log(`AutomationOpsAI web listening on :${port}`));
