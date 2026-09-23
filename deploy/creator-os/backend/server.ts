import express from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { initPlatform, requireAdmin, serveBlob, storage } from './platform.js';
import { advanceEditorial, getEditorialStatus } from './editorial.js';
import {
  channelAnalytics,channelSummary,demandContext,engagementCommitments,ensurePublishJob,ensureReviewedPublishJob,listJobs,oauthComplete,oauthStart,
  makeJobPublic,processOnePublishStep,promoteApprovedReviewedJobs,retryJob,youtubeConnected,
} from './youtube.js';
import {
  ensureReviewedTikTokJob,ensureTikTokPublishJob,listTikTokJobs,processOneTikTokStep,tiktokConfigured,
  tiktokConnected,tiktokMirrorEnabled,tiktokOauthComplete,tiktokOauthStart,
} from './tiktok.js';

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
    const [editorial,jobs,connected,channel,tiktokJobs,tiktokIsConnected]=await Promise.all([
      getEditorialStatus(USER_ID),listJobs(USER_ID),youtubeConnected(USER_ID),channelSummary(USER_ID).catch(()=>null),
      listTikTokJobs(USER_ID),tiktokConnected(USER_ID),
    ]);
    const summary={
      total:jobs.length,
      published:jobs.filter(x=>x.status==='published').length,
      public:jobs.filter(x=>x.status==='published'&&x.privacyStatus==='public').length,
      active:jobs.filter(x=>['pending','uploading'].includes(x.status)).length,
      failed:jobs.filter(x=>x.status==='failed').length,
      shorts:jobs.filter(x=>/short/i.test(x.title)||/short/i.test(x.automationKey)).length,
    };
    const activity=[
      ...(editorial.updatedAt?[{type:'editorial',label:`Pipeline ${editorial.stage}`,detail:editorial.nextAction,at:editorial.updatedAt,severity:editorial.lastError?'error':'info'}]:[]),
      ...jobs.slice(0,8).map(x=>({type:'publication',label:x.title,detail:`${x.status} · ${x.totalBytes?Math.min(100,Math.round((x.uploadedBytes/x.totalBytes)*100)):0}%${x.thumbnailStatus?` · thumbnail ${x.thumbnailStatus}`:''}`,at:x.updatedAt,severity:x.lastError?'error':x.status==='published'?'success':'info'})),
    ].sort((a,b)=>b.at.localeCompare(a.at)).slice(0,8);
    res.json({
      youtubeConnected:connected,channel,editorial,
      tiktok:{configured:tiktokConfigured(),connected:tiktokIsConnected,mirrorEnabled:tiktokMirrorEnabled(),jobs:{total:tiktokJobs.length,published:tiktokJobs.filter(x=>x.status==='published').length,active:tiktokJobs.filter(x=>['pending','uploading','processing'].includes(x.status)).length,failed:tiktokJobs.filter(x=>x.status==='failed').length}},
      summary,activity,
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

app.get('/api/jobs',requireAdmin,async(req,res,next)=>{
  try{
    const all=await listJobs(USER_ID);
    const page=Math.max(1,Number.parseInt(String(req.query.page||'1'),10)||1);
    const pageSize=Math.max(5,Math.min(25,Number.parseInt(String(req.query.pageSize||'8'),10)||8));
    const status=String(req.query.status||'all');
    const sort=['createdAt','updatedAt','title','status'].includes(String(req.query.sort))?String(req.query.sort):'updatedAt';
    const direction=String(req.query.direction)==='asc'?'asc':'desc';
    const filtered=status==='all'?all:all.filter(x=>x.status===status);
    filtered.sort((a,b)=>{
      const left=String((a as any)[sort]||'').toLowerCase(),right=String((b as any)[sort]||'').toLowerCase();
      return (left<right?-1:left>right?1:0)*(direction==='asc'?1:-1);
    });
    const start=(page-1)*pageSize;
    const items=filtered.slice(start,start+pageSize).map(x=>({
      id:x.id,title:x.title,status:x.status,privacyStatus:x.privacyStatus,targetPrivacyStatus:x.targetPrivacyStatus,
      progress:x.totalBytes?Math.min(100,Math.round((x.uploadedBytes/x.totalBytes)*100)):0,
      youtubeUrl:x.youtubeUrl,lastError:x.lastError,thumbnailStatus:x.thumbnailStatus,
      createdAt:x.createdAt,updatedAt:x.updatedAt,automationKey:x.automationKey,retryCount:x.retryCount,
      canRetry:x.status==='failed',terminal:x.status==='failed'&&x.retryCount>=4,
    }));
    res.json({items,page,pageSize,total:filtered.length,totalPages:Math.max(1,Math.ceil(filtered.length/pageSize)),sort,direction,status});
  }catch(e){next(e);}
});

app.get('/api/analytics',requireAdmin,async(req,res,next)=>{
  try{res.json(await channelAnalytics(USER_ID,Number(req.query.days||28)));}
  catch(e){next(e);}
});

app.get('/api/engagement',requireAdmin,async(_req,res,next)=>{
  try{res.json({items:await engagementCommitments(USER_ID)});}
  catch(e){next(e);}
});

app.post('/api/jobs/:id/retry',requireAdmin,async(req,res,next)=>{
  try{res.json({ok:true,...await retryJob(USER_ID,String(req.params.id))});}
  catch(e){next(e);}
});

app.post('/api/jobs/:id/public',requireAdmin,async(req,res,next)=>{
  try{res.json({ok:true,...await makeJobPublic(USER_ID,String(req.params.id))});}
  catch(e){next(e);}
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

app.get('/api/tiktok/oauth/start',requireAdmin,async(_req,res,next)=>{
  try{res.json(await tiktokOauthStart(USER_ID));}catch(e){next(e);}
});
app.get('/api/tiktok/oauth/callback/',async(req,res)=>{
  try{
    if(req.query.error)throw new Error(String(req.query.error_description||req.query.error));
    const code=String(req.query.code||''),state=String(req.query.state||'');
    if(!code||!state)throw new Error('TikTok callback is missing code/state');
    await tiktokOauthComplete(USER_ID,code,state);res.redirect(302,'/?tiktok=connected');
  }catch(error){res.redirect(302,`/?tiktok_error=${encodeURIComponent(error instanceof Error?error.message:String(error))}`);}
});
app.get('/api/tiktok/jobs',requireAdmin,async(_req,res,next)=>{
  try{res.json({items:await listTikTokJobs(USER_ID)});}catch(e){next(e);}
});
app.post('/api/tiktok/publish/now',requireAdmin,async(_req,res,next)=>{
  try{res.json({ok:true,...await processOneTikTokStep(USER_ID)});}catch(e){next(e);}
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
function requireAutomationUpload(req:express.Request,res:express.Response,next:express.NextFunction){
  const expected=process.env.AUTOMATION_UPLOAD_TOKEN||'';
  const provided=String(req.headers['x-automation-upload-token']||'');
  if(!expected||provided.length!==expected.length||!timingSafeEqual(Buffer.from(provided),Buffer.from(expected))){
    return res.status(401).json({error:'Unauthorized automation upload'});
  }
  next();
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
    const spec={key:cleanKey,title:String(title),description:String(description),tags:Array.isArray(tags)?tags.map(String):[],transcript:String(transcript||''),preparedStoragePath:videoPath,thumbnailStoragePath:thumbnailPath};
    const job=await ensureReviewedPublishJob(USER_ID,spec);await ensureReviewedTikTokJob(USER_ID,spec);
    res.json({ok:true,id:job.id,status:job.status});
  }catch(e){next(e);}
});

app.post('/api/automation-upload/video',requireAutomationUpload,express.raw({type:'video/mp4',limit:'400mb'}),async(req,res,next)=>{
  try{
    const key=reviewedKey(req.query.key),content=verifiedBody(req);
    if(content.length<1_000_000)throw new Error('Reviewed video is too small');
    const path=`reviewed/${USER_ID}/${key}/video.mp4`;
    await storage.write([{path,content,contentType:'video/mp4'}]);res.json({ok:true,path,bytes:content.length});
  }catch(e){next(e);}
});
app.post('/api/automation-upload/thumbnail',requireAutomationUpload,express.raw({type:['image/jpeg','image/png'],limit:'10mb'}),async(req,res,next)=>{
  try{
    const key=reviewedKey(req.query.key),content=verifiedBody(req),type=String(req.headers['content-type']||'');
    if(content.length<10_000)throw new Error('Reviewed thumbnail is too small');
    const ext=type==='image/png'?'png':'jpg',path=`reviewed/${USER_ID}/${key}/thumbnail.${ext}`;
    await storage.write([{path,content,contentType:type}]);res.json({ok:true,path,bytes:content.length});
  }catch(e){next(e);}
});
app.post('/api/automation-upload/jobs',requireAutomationUpload,async(req,res,next)=>{
  try{
    const {key,title,description,tags,transcript,videoPath,thumbnailPath}=req.body||{};
    const cleanKey=reviewedKey(key);
    if(!title||!description||!videoPath||!thumbnailPath)throw new Error('Reviewed job metadata is incomplete');
    if(videoPath!==`reviewed/${USER_ID}/${cleanKey}/video.mp4`||!String(thumbnailPath).startsWith(`reviewed/${USER_ID}/${cleanKey}/thumbnail.`))throw new Error('Reviewed asset paths do not match the job key');
    const spec={key:cleanKey,title:String(title),description:String(description),tags:Array.isArray(tags)?tags.map(String):[],transcript:String(transcript||''),preparedStoragePath:videoPath,thumbnailStoragePath:thumbnailPath};
    const job=await ensureReviewedPublishJob(USER_ID,spec);await ensureReviewedTikTokJob(USER_ID,spec);
    res.json({ok:true,id:job.id,status:job.status});
  }catch(e){next(e);}
});
app.post('/api/automation-upload/process',requireAutomationUpload,async(_req,res,next)=>{
  try{res.json({ok:true,step:await processOnePublishStep(USER_ID),promoted:await promoteApprovedReviewedJobs(USER_ID)});}
  catch(e){next(e);}
});
app.get('/api/automation-upload/status',requireAutomationUpload,async(req,res,next)=>{
  try{
    const key=reviewedKey(req.query.key),job=(await listJobs(USER_ID)).find(x=>x.automationKey===`reviewed-${key}`);
    if(!job)return res.status(404).json({error:'Upload job not found'});
    res.json({id:job.id,status:job.status,privacyStatus:job.privacyStatus,youtubeUrl:job.youtubeUrl,lastError:job.lastError,uploadedBytes:job.uploadedBytes,totalBytes:job.totalBytes,thumbnailStatus:job.thumbnailStatus});
  }catch(e){next(e);}
});

app.post('/api/editorial/advance',requireAdmin,async(_req,res,next)=>{
  try{
    const context=await demandContext(USER_ID);
    const step=await advanceEditorial(USER_ID,context);
    await ensurePublishJob(USER_ID,step.publishSpec);
    await ensureTikTokPublishJob(USER_ID,step.publishSpec);
    res.json({ok:true,status:step.status,editorial:await getEditorialStatus(USER_ID)});
  }catch(e){next(e);}
});
app.post('/api/publish/now',requireAdmin,async(_req,res,next)=>{
  try{
    const [youtube,tiktok]=await Promise.allSettled([processOnePublishStep(USER_ID),processOneTikTokStep(USER_ID)]);
    res.json({ok:true,youtube:youtube.status==='fulfilled'?youtube.value:{status:'failed',error:String(youtube.reason)},tiktok:tiktok.status==='fulfilled'?tiktok.value:{status:'failed',error:String(tiktok.reason)},editorial:await getEditorialStatus(USER_ID)});
  }
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
