import {
  createCipheriv,createDecipheriv,createHash,createHmac,randomBytes,timingSafeEqual,
} from 'node:crypto';
import { db, storage, type Stored } from './platform.js';
import { EDITORIAL_PREFIX, getEditorialStatus, markPublished, type EditorialContext, type PublishSpec } from './editorial.js';

const TOKEN_TABLE='youtube_tokens_v2';
const JOB_TABLE='youtube_publish_jobs_v2';
const CHUNK_SIZE=16*1024*1024;
const OAUTH_SCOPE=[
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.force-ssl',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
].join(' ');

type TokenRecord={userId:string;encryptedRefreshToken:string;createdAt:string;updatedAt:string};
export type PublishJob={
  userId:string;automationKey:string;title:string;description:string;tags:string[];
  privacyStatus:'private'|'unlisted'|'public';targetPrivacyStatus:'unlisted'|'public';
  preparedStoragePath:string;thumbnailStoragePath:string;transcript:string;
  status:'pending'|'uploading'|'published'|'failed';
  totalBytes?:number;uploadedBytes:number;uploadSessionUrl?:string;youtubeVideoId?:string;youtubeUrl?:string;
  thumbnailStatus?:'pending'|'set'|'failed';lastError?:string;retryCount:number;createdAt:string;updatedAt:string;
  publishAt?:string;
};
export type ReviewedPublishSpec={
  key:string;title:string;description:string;tags:string[];transcript:string;
  preparedStoragePath:string;thumbnailStoragePath:string;
  publishAt?:string;
};

function origin(){return (process.env.PUBLIC_ORIGIN||'http://localhost:3000').replace(/\/$/,'');}
function redirectUri(){return `${origin()}/api/oauth/callback`;}
function clientSecrets(){
  const clientId=process.env.GOOGLE_CLIENT_ID||'',clientSecret=process.env.GOOGLE_CLIENT_SECRET||'';
  if(!clientId||!clientSecret)throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not configured');
  return {clientId,clientSecret};
}
function key(secret:string){return createHash('sha256').update(`${secret}|youtube-refresh-token-v2`).digest();}
function encrypt(value:string,secret:string){
  const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',key(secret),iv);
  const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);const tag=cipher.getAuthTag();
  return [iv,tag,encrypted].map(x=>x.toString('base64url')).join('.');
}
function decrypt(value:string,secret:string){
  const [iv,tag,data]=value.split('.');if(!iv||!tag||!data)throw new Error('Invalid encrypted token');
  const d=createDecipheriv('aes-256-gcm',key(secret),Buffer.from(iv,'base64url'));d.setAuthTag(Buffer.from(tag,'base64url'));
  return Buffer.concat([d.update(Buffer.from(data,'base64url')),d.final()]).toString('utf8');
}
function state(userId:string,secret:string){
  const payload=Buffer.from(JSON.stringify({userId,iat:Date.now()})).toString('base64url');
  const sig=createHmac('sha256',secret).update(payload).digest('base64url');return `${payload}.${sig}`;
}
function verifyState(value:string,secret:string){
  const [payload,sig]=value.split('.');if(!payload||!sig)throw new Error('Invalid OAuth state');
  const expected=createHmac('sha256',secret).update(payload).digest();const actual=Buffer.from(sig,'base64url');
  if(expected.length!==actual.length||!timingSafeEqual(expected,actual))throw new Error('Invalid OAuth state signature');
  const parsed=JSON.parse(Buffer.from(payload,'base64url').toString('utf8')) as {userId:string;iat:number};
  if(!parsed.userId||Date.now()-parsed.iat>15*60*1000)throw new Error('OAuth state expired');return parsed.userId;
}
async function tokenFor(userId:string){
  const {items}=await db.list<TokenRecord>(TOKEN_TABLE,{filter:{userId},limit:10});return items[0]||null;
}
async function saveToken(userId:string,refreshToken:string,secret:string){
  const old=await tokenFor(userId),t=new Date().toISOString();
  const record:TokenRecord={userId,encryptedRefreshToken:encrypt(refreshToken,secret),createdAt:old?.createdAt||t,updatedAt:t};
  if(old){const {id}=old;await db.update(TOKEN_TABLE,[{id,record}]);}
  else await db.add(TOKEN_TABLE,[record]);
}
async function exchangeCode(code:string){
  const {clientId,clientSecret}=clientSecrets();
  const response=await fetch('https://oauth2.googleapis.com/token',{
    method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({code,client_id:clientId,client_secret:clientSecret,redirect_uri:redirectUri(),grant_type:'authorization_code'}),
  });
  const data=await response.json() as any;
  if(!response.ok||!data.refresh_token)throw new Error(data.error_description||'Google did not return a refresh token');
  return data.refresh_token as string;
}
async function accessToken(userId:string){
  const {clientId,clientSecret}=clientSecrets();const token=await tokenFor(userId);
  if(!token)throw new Error('YouTube is not authorized');
  const refreshToken=decrypt(token.encryptedRefreshToken,clientSecret);
  const response=await fetch('https://oauth2.googleapis.com/token',{
    method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({refresh_token:refreshToken,client_id:clientId,client_secret:clientSecret,grant_type:'refresh_token'}),
  });
  const data=await response.json() as any;
  if(!response.ok||!data.access_token)throw new Error(data.error_description||'Unable to refresh Google access token');
  return data.access_token as string;
}

export async function oauthStart(userId:string){
  const {clientId,clientSecret}=clientSecrets();
  const params=new URLSearchParams({
    client_id:clientId,redirect_uri:redirectUri(),response_type:'code',scope:OAUTH_SCOPE,
    access_type:'offline',prompt:'consent',include_granted_scopes:'true',state:state(userId,clientSecret),
  });
  return {authUrl:`https://accounts.google.com/o/oauth2/v2/auth?${params}`,redirectUri:redirectUri()};
}
export async function oauthComplete(userId:string,code:string,stateValue:string){
  const {clientSecret}=clientSecrets();const owner=verifyState(stateValue,clientSecret);
  if(owner!==userId)throw new Error('OAuth state does not belong to this owner');
  const refresh=await exchangeCode(code);await saveToken(userId,refresh,clientSecret);
  return {ok:true};
}
export async function youtubeConnected(userId:string){return Boolean(await tokenFor(userId));}

type ManagedVideoMetric={
  id:string;title:string;publishedAt:string|null;privacyStatus:string;
  views:number;likes:number;comments:number;url:string;ageDays:number;viewsPerDay:number;
};
async function managedVideoMetrics(userId:string,access:string):Promise<ManagedVideoMetric[]>{
  const jobs=(await listJobs(userId)).filter(x=>x.youtubeVideoId);
  const ids=[...new Set(jobs.map(x=>x.youtubeVideoId as string))].slice(0,50);
  if(!ids.length)return [];
  const response=await fetch(`https://www.googleapis.com/youtube/v3/videos?part=id,snippet,statistics,status&id=${encodeURIComponent(ids.join(','))}`,{headers:{authorization:`Bearer ${access}`}});
  if(!response.ok)return [];
  const data=await response.json() as any;
  const now=Date.now();
  return (data.items||[]).map((item:any)=>{
    const publishedAt=item.snippet?.publishedAt||null;
    const ageDays=publishedAt?Math.max(0,(now-new Date(publishedAt).getTime())/86_400_000):0;
    const views=Number(item.statistics?.viewCount||0);
    return {
      id:item.id,title:item.snippet?.title||'',publishedAt,
      privacyStatus:item.status?.privacyStatus||'unknown',views,
      likes:Number(item.statistics?.likeCount||0),comments:Number(item.statistics?.commentCount||0),
      url:`https://www.youtube.com/watch?v=${item.id}`,ageDays,
      viewsPerDay:views/Math.max(1,ageDays),
    };
  });
}
function searchSeed(title:string){
  return title.replace(/#\w+/g,' ').replace(/[^a-zA-Z0-9\s-]/g,' ').replace(/\s+/g,' ').trim().split(' ').slice(0,7).join(' ');
}

export async function demandContext(userId:string):Promise<EditorialContext>{
  if(!await tokenFor(userId))return {demandSignals:[],recentVideos:await recentEditorialVideos(userId),blockedTopics:[]};
  const access=await accessToken(userId);
  const performance=await managedVideoMetrics(userId,access).catch(()=>[]);
  const stale=performance.filter(x=>x.privacyStatus==='public'&&x.views===0&&x.ageDays>=7);
  const winners=performance.filter(x=>x.views>0).sort((a,b)=>b.viewsPerDay-a.viewsPerDay||b.views-a.views).slice(0,3);
  const queries=[...new Set([
    ...winners.map(x=>searchSeed(x.title)).filter(Boolean),
    'AI agent workflow reliability','MCP security tutorial','AI software development workflow',
    'AI design accessibility workflow','business workflow automation',
  ])].slice(0,7);
  const signals:string[]=[
    ...winners.map(x=>`CHANNEL WINNER: ${x.title} | ${x.views} views | ${x.viewsPerDay.toFixed(1)} views/day; adapt the viewer problem and proof pattern, never copy the package`),
    ...stale.map(x=>`BLOCKED AFTER 7 DAYS AT ZERO VIEWS: ${x.title}; do not reuse this topic or a semantic variant`),
  ];
  const publishedAfter=new Date(Date.now()-45*86_400_000).toISOString();
  for(const query of queries){
    const params=new URLSearchParams({part:'snippet',type:'video',maxResults:'5',order:'viewCount',publishedAfter,q:query});
    const response=await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`,{headers:{authorization:`Bearer ${access}`}});
    if(!response.ok)continue;
    const data=await response.json() as any;
    signals.push(`CURRENT SEARCH: ${query}`,...(data.items||[]).map((x:any)=>x.snippet?.title||'').filter(Boolean));
  }
  const commitments=await engagementCommitments(userId).catch(()=>[]);
  const pending=commitments.filter(x=>x.status==='pending').map(x=>`AUDIENCE COMMITMENT (priority): deliver ${x.trigger} requested on ${x.sourceTitle}`);
  return {
    demandSignals:[...pending,...signals].slice(0,40),
    recentVideos:await recentEditorialVideos(userId),
    blockedTopics:stale.map(x=>x.title),
  };
}
async function recentEditorialVideos(userId:string){
  const {items}=await db.list<PublishJob>(JOB_TABLE,{filter:{userId},limit:30});
  return items.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,20).map(x=>({title:x.title,transcript:x.transcript}));
}

function optimizeMetadata(title:string,description:string,inputTags:string[],short:boolean){
  const cleanTitle=title.replace(/\s+/g,' ').trim().slice(0,100);
  const baseDescription=description.replace(/(^|\s)#[A-Za-z0-9_-]+/g,' ').replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
  const haystack=`${cleanTitle} ${baseDescription}`.toLowerCase();
  const unique=(values:string[])=>[...new Set(values.map(x=>x.replace(/^#/,'').replace(/\s+/g,' ').trim()).filter(Boolean))];
  const tags=unique(inputTags).filter(tag=>tag.toLowerCase()==='shorts'||tag.toLowerCase().split(/[^a-z0-9]+/).some(word=>word.length>2&&haystack.includes(word)));
  const concepts:Array<[RegExp,string,string]>= [
    [/\b(ai|artificial intelligence)\b/i,'AI','AI'],
    [/\bagents?\b/i,'AI agents','AIAgents'],
    [/\bautomation\b/i,'automation','Automation'],
    [/\bmcp\b/i,'MCP','MCP'],
    [/\bsecurity|sandbox|secret|vulnerab/i,'AI security','AISecurity'],
    [/\btest|testing|quality gate/i,'software testing','SoftwareTesting'],
    [/\bcode|coding|developer|software/i,'software development','SoftwareDevelopment'],
    [/\bdesign|ui|ux|accessibility/i,'AI design','AIDesign'],
    [/\bn8n\b/i,'n8n','n8n'],
  ];
  const hashtags:string[]=[];
  for(const [pattern,tag,hash] of concepts)if(pattern.test(haystack)){tags.push(tag);hashtags.push(hash);}
  if(short){tags.push('Shorts');hashtags.push('Shorts');}
  const finalTags=unique(tags).slice(0,12);
  const finalHashes=unique(hashtags).slice(0,5).map(x=>`#${x.replace(/[^A-Za-z0-9_]/g,'')}`);
  const significant=cleanTitle.toLowerCase().replace(/#\w+/g,'').split(/[^a-z0-9]+/).filter(x=>x.length>3&&!['this','that','with','from','before','after','your'].includes(x));
  const opening=baseDescription.slice(0,240).toLowerCase();
  const searchAligned=significant.slice(0,4).filter(x=>opening.includes(x)).length>=2;
  const alignedDescription=searchAligned?baseDescription:`Demonstration: ${cleanTitle.replace(/#\w+/g,'').trim()}.\n\n${baseDescription}`;
  return {title:cleanTitle,description:`${alignedDescription}\n\n${finalHashes.join(' ')}`.trim().slice(0,5000),tags:finalTags};
}

export async function ensurePublishJob(userId:string,spec?:PublishSpec){
  if(!spec)return;
  const {items}=await db.list<PublishJob>(JOB_TABLE,{filter:{userId},limit:50});
  if(items.some(x=>x.automationKey===spec.automationKey))return;
  const t=new Date().toISOString();
  const metadata=optimizeMetadata(spec.title,spec.description,spec.tags,/short/i.test(spec.title)||/short/i.test(spec.automationKey));
  const record:PublishJob={
    userId,automationKey:spec.automationKey,title:metadata.title,description:metadata.description,tags:metadata.tags,
    privacyStatus:'private',targetPrivacyStatus:'public',preparedStoragePath:spec.preparedStoragePath,
    thumbnailStoragePath:spec.thumbnailStoragePath,transcript:spec.transcript,status:'pending',uploadedBytes:0,retryCount:0,
    thumbnailStatus:'pending',createdAt:t,updatedAt:t,
  };
  await db.add(JOB_TABLE,[record]);
}
export async function ensureReviewedPublishJob(userId:string,spec:ReviewedPublishSpec){
  const automationKey=`reviewed-${spec.key}`;
  const {items}=await db.list<PublishJob>(JOB_TABLE,{filter:{userId},limit:100});
  const existing=items.find(x=>x.automationKey===automationKey);
  if(existing)return existing;
  const [video,thumb]=await Promise.all([storage.info(spec.preparedStoragePath),storage.info(spec.thumbnailStoragePath)]);
  if(!video||video.content_type!=='video/mp4'||Number(video.bytes)<1_000_000)throw new Error('Reviewed video asset missing or invalid');
  if(!thumb||!/^image\/(jpeg|png)$/.test(thumb.content_type)||Number(thumb.bytes)<10_000)throw new Error('Reviewed thumbnail asset missing or invalid');
  const t=new Date().toISOString();
  const metadata=optimizeMetadata(spec.title,spec.description,spec.tags,/short/i.test(spec.title)||/short/i.test(spec.key));
  const record:PublishJob={
    userId,automationKey,title:metadata.title,description:metadata.description,tags:metadata.tags,
    privacyStatus:'private',targetPrivacyStatus:'public',preparedStoragePath:spec.preparedStoragePath,
    thumbnailStoragePath:spec.thumbnailStoragePath,transcript:spec.transcript.slice(0,20000),status:'pending',
    uploadedBytes:0,retryCount:0,thumbnailStatus:'pending',publishAt:spec.publishAt,createdAt:t,updatedAt:t,
  };
  const [id]=await db.add(JOB_TABLE,[record]);return {...record,id};
}
export async function listJobs(userId:string){
  const {items}=await db.list<PublishJob>(JOB_TABLE,{filter:{userId},limit:50});
  return items.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}

export async function repairPublishedDiscoveryMetadata(userId:string){
  const access=await accessToken(userId);
  const jobs=(await listJobs(userId)).filter(x=>x.status==='published'&&x.youtubeVideoId);
  let updated=0,unchanged=0;const failed:Array<{id:string;error:string}>=[];
  for(const job of jobs){
    const metadata=optimizeMetadata(job.title,job.description,job.tags,/short/i.test(job.title)||/short/i.test(job.automationKey));
    const same=job.title===metadata.title&&job.description===metadata.description&&JSON.stringify(job.tags)===JSON.stringify(metadata.tags);
    if(same){unchanged++;continue;}
    const response=await fetch('https://www.googleapis.com/youtube/v3/videos?part=snippet',{
      method:'PUT',headers:{authorization:`Bearer ${access}`,'content-type':'application/json'},
      body:JSON.stringify({id:job.youtubeVideoId,snippet:{
        title:metadata.title,description:metadata.description,tags:metadata.tags,
        categoryId:'28',defaultLanguage:'en',defaultAudioLanguage:'en',
      }}),
    });
    if(!response.ok){
      failed.push({id:job.youtubeVideoId as string,error:`HTTP ${response.status}: ${(await response.text()).slice(0,240)}`});
      continue;
    }
    job.title=metadata.title;job.description=metadata.description;job.tags=metadata.tags;
    await saveJob(job);updated++;
  }
  return {checked:jobs.length,updated,unchanged,failed};
}

export async function retryJob(userId:string,jobId:string){
  const job=(await listJobs(userId)).find(x=>x.id===jobId);
  if(!job)throw new Error('Publish job not found');
  if(job.status!=='failed')return {status:job.status,retryCount:job.retryCount};
  job.status='pending';job.retryCount=0;job.lastError=undefined;
  if(!job.youtubeVideoId){job.uploadSessionUrl=undefined;job.uploadedBytes=0;}
  await saveJob(job);
  return {status:'pending',retryCount:0};
}

export async function makeJobPublic(userId:string,jobId:string){
  const job=(await listJobs(userId)).find(x=>x.id===jobId);
  if(!job)throw new Error('Publish job not found');
  if(job.status!=='published'||!job.youtubeVideoId)throw new Error('Video must finish processing before it can be public');
  if(job.thumbnailStatus!=='set')throw new Error('Thumbnail must be set before public release');
  if(job.privacyStatus==='public')return {status:'already-public',youtubeUrl:job.youtubeUrl};
  const access=await accessToken(userId);
  await privacy(job.youtubeVideoId,'public',access);
  job.privacyStatus='public';job.targetPrivacyStatus='public';job.lastError=undefined;
  await saveJob(job);
  return {status:'public',youtubeUrl:job.youtubeUrl};
}

export async function promoteApprovedReviewedJobs(userId:string){
  const candidates=(await listJobs(userId)).filter(job=>
    job.automationKey.startsWith('reviewed-')&&job.status==='published'&&
    job.thumbnailStatus==='set'&&job.privacyStatus!=='public'&&Boolean(job.youtubeVideoId)&&
    (!job.publishAt||new Date(job.publishAt).getTime()<=Date.now())
  );
  const results=[];
  for(const job of candidates){
    results.push({id:job.id,...await makeJobPublic(userId,job.id)});
  }
  return results;
}

async function initiate(job:PublishJob,totalBytes:number,access:string){
  const response=await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',{
    method:'POST',headers:{
      authorization:`Bearer ${access}`,'content-type':'application/json; charset=UTF-8',
      'x-upload-content-length':String(totalBytes),'x-upload-content-type':'video/mp4'
    },
    body:JSON.stringify({
      snippet:{title:job.title,description:job.description,tags:job.tags,categoryId:'28',defaultLanguage:'en',defaultAudioLanguage:'en'},
      status:{privacyStatus:job.privacyStatus,selfDeclaredMadeForKids:false,containsSyntheticMedia:true,...(job.publishAt?{publishAt:job.publishAt}:{})},
    }),
  });
  if(!response.ok)throw new Error(`YouTube could not start upload (${response.status}): ${(await response.text()).slice(0,500)}`);
  const url=response.headers.get('location');if(!url)throw new Error('YouTube did not return resumable URL');return url;
}
async function querySession(job:PublishJob,access:string){
  if(!job.uploadSessionUrl||!job.totalBytes)throw new Error('Incomplete upload session');
  const response=await fetch(job.uploadSessionUrl,{method:'PUT',headers:{authorization:`Bearer ${access}`,'content-length':'0','content-range':`bytes */${job.totalBytes}`}});
  if(response.status===308){const m=response.headers.get('range')?.match(/bytes=0-(\d+)/);return {done:false,uploaded:m?Number(m[1])+1:0};}
  if(response.ok){const data=await response.json() as any;if(!data.id)throw new Error('Upload completed without video id');return {done:true,uploaded:job.totalBytes,videoId:data.id as string};}
  if([404,410].includes(response.status))throw new Error('UPLOAD_SESSION_EXPIRED');
  throw new Error(`Upload-session query failed (${response.status})`);
}
async function uploadChunk(job:PublishJob,access:string,sourceUrl:string){
  if(!job.uploadSessionUrl||!job.totalBytes)throw new Error('Incomplete upload session');
  const start=job.uploadedBytes||0,end=Math.min(start+CHUNK_SIZE-1,job.totalBytes-1);
  const source=await fetch(sourceUrl,{headers:{range:`bytes=${start}-${end}`},redirect:'follow'});
  if(source.status!==206&&!(source.status===200&&start===0&&job.totalBytes<=CHUNK_SIZE))throw new Error(`Source range failed (${source.status})`);
  const bytes=Buffer.from(await source.arrayBuffer()),actualEnd=start+bytes.length-1;
  const response=await fetch(job.uploadSessionUrl,{method:'PUT',headers:{
    authorization:`Bearer ${access}`,'content-type':'video/mp4','content-length':String(bytes.length),
    'content-range':`bytes ${start}-${actualEnd}/${job.totalBytes}`
  },body:bytes});
  if(response.status===308){const m=response.headers.get('range')?.match(/bytes=0-(\d+)/);return {done:false,uploaded:m?Number(m[1])+1:actualEnd+1};}
  if(response.ok){const data=await response.json() as any;if(!data.id)throw new Error('Upload completed without video id');return {done:true,uploaded:job.totalBytes,videoId:data.id as string};}
  if([404,410].includes(response.status))throw new Error('UPLOAD_SESSION_EXPIRED');
  throw new Error(`YouTube chunk failed (${response.status}): ${(await response.text()).slice(0,500)}`);
}
async function videoStatus(videoId:string,access:string){
  const response=await fetch(`https://www.googleapis.com/youtube/v3/videos?part=id,status&id=${encodeURIComponent(videoId)}`,{headers:{authorization:`Bearer ${access}`}});
  const data=await response.json() as any;if(!response.ok)throw new Error(`Video status failed (${response.status})`);
  const item=(data.items||[]).find((x:any)=>x.id===videoId);if(!item)throw new Error('Uploaded video not found');return item;
}
async function thumbnail(videoId:string,url:string,access:string){
  const source=await fetch(url,{redirect:'follow'});if(!source.ok)throw new Error(`Thumbnail source failed (${source.status})`);
  const bytes=Buffer.from(await source.arrayBuffer());
  const response=await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}&uploadType=media`,{
    method:'POST',headers:{authorization:`Bearer ${access}`,'content-type':source.headers.get('content-type')||'image/jpeg','content-length':String(bytes.length)},body:bytes
  });
  if(!response.ok)throw new Error(`Thumbnail upload failed (${response.status}): ${(await response.text()).slice(0,500)}`);
}
async function privacy(videoId:string,status:'unlisted'|'public',access:string){
  const response=await fetch('https://www.googleapis.com/youtube/v3/videos?part=status',{
    method:'PUT',headers:{authorization:`Bearer ${access}`,'content-type':'application/json'},
    body:JSON.stringify({id:videoId,status:{privacyStatus:status,selfDeclaredMadeForKids:false,containsSyntheticMedia:true}})
  });
  if(!response.ok)throw new Error(`Privacy update failed (${response.status})`);
}
async function saveJob(job:Stored<PublishJob>){
  const {id,...record}=job;record.updatedAt=new Date().toISOString();await db.update(JOB_TABLE,[{id,record}]);
}

export async function processOnePublishStep(userId:string){
  const jobs=await listJobs(userId);
  let editorial:Awaited<ReturnType<typeof getEditorialStatus>>|undefined;
  const recoverable=(x:PublishJob)=>['pending','uploading'].includes(x.status)||(x.status==='failed'&&x.retryCount<4);
  let job=jobs.find(x=>x.automationKey.startsWith('reviewed-')&&recoverable(x));
  if(!job){
    editorial=await getEditorialStatus(userId);
    if(editorial.stage!=='ready'||!editorial.projectKey)return {status:'not-ready'};
    job=jobs.find(x=>x.automationKey===editorial!.projectKey&&recoverable(x));
  }
  if(!job)return {status:'no-job'};
  if(job.status==='failed'){
    if(job.retryCount>=4)return {status:'failed',error:job.lastError};
    job.status='pending';job.lastError=undefined;job.retryCount++;job.uploadSessionUrl=undefined;job.uploadedBytes=0;await saveJob(job);
  }
  try{
    const access=await accessToken(userId);
    if(job.youtubeVideoId){
      const s=await videoStatus(job.youtubeVideoId,access);
      if(s.status?.uploadStatus!=='processed'){job.status='uploading';job.lastError=undefined;await saveJob(job);return {status:'processing',youtubeUrl:job.youtubeUrl};}
      if(job.thumbnailStatus!=='set'){
        await thumbnail(job.youtubeVideoId,await storage.url(job.thumbnailStoragePath),access);
        job.thumbnailStatus='set';await saveJob(job);return {status:'thumbnail-set',youtubeUrl:job.youtubeUrl};
      }
      if(job.publishAt&&new Date(job.publishAt).getTime()>Date.now()){
        job.status='published';job.lastError=undefined;await saveJob(job);return {status:'scheduled',publishAt:job.publishAt,youtubeUrl:job.youtubeUrl};
      }
      if(job.privacyStatus!==job.targetPrivacyStatus){
        await privacy(job.youtubeVideoId,job.targetPrivacyStatus,access);job.privacyStatus=job.targetPrivacyStatus;await saveJob(job);return {status:'unlisted',youtubeUrl:job.youtubeUrl};
      }
      job.status='published';job.lastError=undefined;await saveJob(job);
      if(editorial?.projectKey===job.automationKey)await markPublished(userId,job.automationKey,job.youtubeVideoId,job.youtubeUrl||`https://www.youtube.com/watch?v=${job.youtubeVideoId}`);
      return {status:'published',youtubeUrl:job.youtubeUrl};
    }

    const sourceUrl=await storage.url(job.preparedStoragePath);
    if(!job.totalBytes){const info=await storage.info(job.preparedStoragePath);if(!info)throw new Error('Video blob missing');job.totalBytes=Number(info.bytes);}
    if(!job.uploadSessionUrl){job.uploadSessionUrl=await initiate(job,job.totalBytes,access);job.status='uploading';await saveJob(job);return {status:'session-created'};}
    const session=await querySession(job,access);job.uploadedBytes=session.uploaded;
    if(session.done){job.youtubeVideoId=session.videoId;job.youtubeUrl=`https://www.youtube.com/watch?v=${session.videoId}`;job.thumbnailStatus='pending';await saveJob(job);return {status:'uploaded',youtubeUrl:job.youtubeUrl};}
    const chunk=await uploadChunk(job,access,sourceUrl);job.uploadedBytes=chunk.uploaded;
    if(chunk.done){job.youtubeVideoId=chunk.videoId;job.youtubeUrl=`https://www.youtube.com/watch?v=${chunk.videoId}`;job.thumbnailStatus='pending';}
    await saveJob(job);return {status:chunk.done?'uploaded':'uploading',progress:Math.round((job.uploadedBytes/(job.totalBytes||1))*100),youtubeUrl:job.youtubeUrl};
  }catch(e){
    const message=e instanceof Error?e.message:String(e);
    if(message==='UPLOAD_SESSION_EXPIRED'){job.status='pending';job.uploadSessionUrl=undefined;job.uploadedBytes=0;}
    else job.status='failed';
    job.lastError=message.slice(0,1200);await saveJob(job);throw e;
  }
}

export async function channelSummary(userId:string){
  if(!await tokenFor(userId))return null;const access=await accessToken(userId);
  const response=await fetch('https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true',{headers:{authorization:`Bearer ${access}`}});
  const data=await response.json() as any;if(!response.ok)return null;const c=data.items?.[0];
  return c?{id:c.id,title:c.snippet?.title||''}:null;
}

function isoDay(date:Date){return date.toISOString().slice(0,10);}
export async function channelAnalytics(userId:string,days=28){
  if(!await tokenFor(userId))return null;
  const access=await accessToken(userId);
  const channelResponse=await fetch('https://www.googleapis.com/youtube/v3/channels?part=id,snippet,statistics&mine=true',{headers:{authorization:`Bearer ${access}`}});
  const channelData=await channelResponse.json() as any;
  if(!channelResponse.ok)throw new Error(`Channel analytics failed (${channelResponse.status})`);
  const channel=channelData.items?.[0];
  if(!channel)throw new Error('YouTube channel not found');

  const videos=await managedVideoMetrics(userId,access);

  const end=new Date();end.setUTCDate(end.getUTCDate()-1);
  const start=new Date(end);start.setUTCDate(start.getUTCDate()-Math.max(1,Math.min(days,90))+1);
  let period={days,views:0,watchMinutes:0,subscribersGained:0,subscribersLost:0,subscriberDelta:0,available:false,error:''};
  const query=new URLSearchParams({ids:'channel==MINE',startDate:isoDay(start),endDate:isoDay(end),metrics:'views,estimatedMinutesWatched,subscribersGained,subscribersLost'});
  const reportResponse=await fetch(`https://youtubeanalytics.googleapis.com/v2/reports?${query}`,{headers:{authorization:`Bearer ${access}`}});
  const report=await reportResponse.json() as any;
  if(reportResponse.ok&&report.rows?.[0]){
    const [viewsCount,watchMinutes,gained,lost]=report.rows[0].map((x:any)=>Number(x||0));
    period={days,views:viewsCount,watchMinutes,subscribersGained:gained,subscribersLost:lost,subscriberDelta:gained-lost,available:true,error:''};
  }else{
    period.error=report?.error?.message||'Reautoriza YouTube para activar métricas históricas.';
  }

  return {
    channel:{id:channel.id,title:channel.snippet?.title||'',subscribers:Number(channel.statistics?.subscriberCount||0),views:Number(channel.statistics?.viewCount||0),videos:Number(channel.statistics?.videoCount||0),hiddenSubscribers:Boolean(channel.statistics?.hiddenSubscriberCount)},
    period,
    topVideos:[...videos].sort((a,b)=>b.views-a.views).slice(0,8),
    staleZeroViewVideos:videos.filter(x=>x.privacyStatus==='public'&&x.views===0&&x.ageDays>=7).sort((a,b)=>b.ageDays-a.ageDays),
    totals:{views:videos.reduce((n,x)=>n+x.views,0),likes:videos.reduce((n,x)=>n+x.likes,0),comments:videos.reduce((n,x)=>n+x.comments,0)},
    updatedAt:new Date().toISOString(),
  };
}

export async function engagementCommitments(userId:string){
  if(!await tokenFor(userId))return [];
  const access=await accessToken(userId),jobs=(await listJobs(userId)).filter(x=>x.youtubeVideoId);
  const byVideo=new Map(jobs.map(x=>[x.youtubeVideoId as string,x]));
  const channel=await channelSummary(userId);if(!channel)return [];
  const query=new URLSearchParams({part:'snippet',allThreadsRelatedToChannelId:channel.id,maxResults:'100',order:'time',textFormat:'plainText'});
  const response=await fetch(`https://www.googleapis.com/youtube/v3/commentThreads?${query}`,{headers:{authorization:`Bearer ${access}`}});
  const data=await response.json() as any;if(!response.ok)throw new Error(`Comment scan failed (${response.status})`);
  const keywords=['workflow','parte 2','part 2','segunda parte','código','codigo','code','plantilla','template','repositorio'];
  const grouped=new Map<string,any>();
  for(const item of data.items||[]){
    const snippet=item.snippet||{},videoId=snippet.videoId,source=byVideo.get(videoId);if(!source)continue;
    const top=snippet.topLevelComment?.snippet||{},text=String(top.textDisplay||top.textOriginal||'').trim();
    const normalized=text.toLocaleLowerCase('es-MX');const trigger=keywords.find(x=>normalized===x||normalized.includes(x));if(!trigger)continue;
    const key=`${videoId}:${trigger}`,existing=grouped.get(key)||{sourceVideoId:videoId,sourceTitle:source.title,sourceUrl:source.youtubeUrl,sourceCreatedAt:source.createdAt,trigger,requestCount:0,commenters:[],latestCommentAt:'',commentIds:[]};
    existing.requestCount++;existing.commenters.push(String(top.authorDisplayName||'Audiencia'));existing.commentIds.push(String(snippet.topLevelComment?.id||''));
    if(String(top.publishedAt||'')>existing.latestCommentAt)existing.latestCommentAt=String(top.publishedAt||'');grouped.set(key,existing);
  }
  return [...grouped.values()].map(request=>{
    const followUp=jobs.filter(x=>x.youtubeVideoId!==request.sourceVideoId&&x.createdAt>request.sourceCreatedAt&&x.status==='published'&&x.privacyStatus==='public')
      .find(x=>`${x.title} ${x.description}`.toLocaleLowerCase('es-MX').includes(request.trigger));
    return {...request,commenters:[...new Set(request.commenters)].slice(0,5),status:followUp?'fulfilled':'pending',followUp:followUp?{videoId:followUp.youtubeVideoId,title:followUp.title,url:followUp.youtubeUrl}:null};
  }).sort((a,b)=>(a.status===b.status?b.latestCommentAt.localeCompare(a.latestCommentAt):a.status==='pending'?-1:1));
}
