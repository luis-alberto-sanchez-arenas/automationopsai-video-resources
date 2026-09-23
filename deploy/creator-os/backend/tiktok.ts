import {createCipheriv,createDecipheriv,createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {db,storage,type Stored} from './platform.js';
import type {PublishSpec} from './editorial.js';
import type {ReviewedPublishSpec} from './youtube.js';

const TOKEN_TABLE='tiktok_tokens_v1';
const JOB_TABLE='tiktok_publish_jobs_v1';
const API='https://open.tiktokapis.com';
const MAX_CHUNK=32*1024*1024;

type TokenRecord={
  userId:string;encryptedAccessToken:string;encryptedRefreshToken:string;accessExpiresAt:string;
  refreshExpiresAt:string;openId:string;scope:string;createdAt:string;updatedAt:string;
};
export type TikTokPublishJob={
  userId:string;automationKey:string;title:string;preparedStoragePath:string;
  status:'pending'|'uploading'|'processing'|'published'|'failed';privacyLevel:string;
  totalBytes?:number;uploadedBytes:number;chunkSize?:number;publishId?:string;uploadUrl?:string;
  postId?:string;tiktokUrl?:string;creatorUsername?:string;lastError?:string;retryCount:number;
  createdAt:string;updatedAt:string;
};

function origin(){return (process.env.PUBLIC_ORIGIN||'http://localhost:3000').replace(/\/$/,'');}
export function tiktokRedirectUri(){return `${origin()}/api/tiktok/oauth/callback/`;}
function clientSecrets(){
  const clientKey=process.env.TIKTOK_CLIENT_KEY||'',clientSecret=process.env.TIKTOK_CLIENT_SECRET||'';
  if(!clientKey||!clientSecret)throw new Error('TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET are not configured');
  return {clientKey,clientSecret};
}
function cryptoKey(secret:string){return createHash('sha256').update(`${secret}|tiktok-token-v1`).digest();}
function encrypt(value:string,secret:string){
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',cryptoKey(secret),iv);
  const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
  return [iv,cipher.getAuthTag(),encrypted].map(x=>x.toString('base64url')).join('.');
}
function decrypt(value:string,secret:string){
  const [iv,tag,data]=value.split('.');if(!iv||!tag||!data)throw new Error('Invalid encrypted TikTok token');
  const decipher=createDecipheriv('aes-256-gcm',cryptoKey(secret),Buffer.from(iv,'base64url'));
  decipher.setAuthTag(Buffer.from(tag,'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data,'base64url')),decipher.final()]).toString('utf8');
}
function oauthState(userId:string,secret:string){
  const payload=Buffer.from(JSON.stringify({userId,iat:Date.now()})).toString('base64url');
  return `${payload}.${createHmac('sha256',secret).update(payload).digest('base64url')}`;
}
function verifyState(value:string,secret:string){
  const [payload,sig]=value.split('.');if(!payload||!sig)throw new Error('Invalid TikTok OAuth state');
  const expected=createHmac('sha256',secret).update(payload).digest(),actual=Buffer.from(sig,'base64url');
  if(expected.length!==actual.length||!timingSafeEqual(expected,actual))throw new Error('Invalid TikTok OAuth state signature');
  const parsed=JSON.parse(Buffer.from(payload,'base64url').toString('utf8')) as {userId:string;iat:number};
  if(!parsed.userId||Date.now()-parsed.iat>15*60*1000)throw new Error('TikTok OAuth state expired');
  return parsed.userId;
}
async function tokenFor(userId:string){
  const {items}=await db.list<TokenRecord>(TOKEN_TABLE,{filter:{userId},limit:5});return items[0]||null;
}
async function saveToken(userId:string,data:any){
  const {clientSecret}=clientSecrets(),old=await tokenFor(userId),now=new Date(),t=now.toISOString();
  const record:TokenRecord={
    userId,encryptedAccessToken:encrypt(String(data.access_token),clientSecret),
    encryptedRefreshToken:encrypt(String(data.refresh_token),clientSecret),
    accessExpiresAt:new Date(now.getTime()+Number(data.expires_in||86400)*1000).toISOString(),
    refreshExpiresAt:new Date(now.getTime()+Number(data.refresh_expires_in||31536000)*1000).toISOString(),
    openId:String(data.open_id||old?.openId||''),scope:String(data.scope||old?.scope||''),
    createdAt:old?.createdAt||t,updatedAt:t,
  };
  if(old){const {id}=old;await db.update(TOKEN_TABLE,[{id,record}]);}
  else await db.add(TOKEN_TABLE,[record]);
}
async function tokenRequest(params:Record<string,string>){
  const response=await fetch(`${API}/v2/oauth/token/`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(params)});
  const data=await response.json() as any;
  if(!response.ok||data.error||!data.access_token)throw new Error(data.error_description||data.message||data.error||`TikTok OAuth failed (${response.status})`);
  return data;
}
async function accessToken(userId:string){
  const {clientKey,clientSecret}=clientSecrets(),record=await tokenFor(userId);
  if(!record)throw new Error('TikTok is not authorized');
  if(Date.parse(record.accessExpiresAt)>Date.now()+5*60*1000)return decrypt(record.encryptedAccessToken,clientSecret);
  const data=await tokenRequest({client_key:clientKey,client_secret:clientSecret,grant_type:'refresh_token',refresh_token:decrypt(record.encryptedRefreshToken,clientSecret)});
  await saveToken(userId,data);return String(data.access_token);
}

export function tiktokConfigured(){return Boolean(process.env.TIKTOK_CLIENT_KEY&&process.env.TIKTOK_CLIENT_SECRET);}
export function tiktokMirrorEnabled(){return process.env.TIKTOK_MIRROR_ENABLED==='true';}
export async function tiktokConnected(userId:string){return Boolean(await tokenFor(userId));}
export async function tiktokOauthStart(userId:string){
  const {clientKey,clientSecret}=clientSecrets(),redirect=tiktokRedirectUri();
  const params=new URLSearchParams({client_key:clientKey,scope:'video.publish',response_type:'code',redirect_uri:redirect,state:oauthState(userId,clientSecret)});
  return {authUrl:`https://www.tiktok.com/v2/auth/authorize/?${params}`,redirectUri:redirect};
}
export async function tiktokOauthComplete(userId:string,code:string,stateValue:string){
  const {clientKey,clientSecret}=clientSecrets(),owner=verifyState(stateValue,clientSecret);
  if(owner!==userId)throw new Error('TikTok OAuth state does not belong to this owner');
  const data=await tokenRequest({client_key:clientKey,client_secret:clientSecret,code,grant_type:'authorization_code',redirect_uri:tiktokRedirectUri()});
  await saveToken(userId,data);return {ok:true};
}

function titleForTikTok(title:string,tags:string[]){
  const cleanTags=tags.map(x=>`#${x.replace(/[^\p{L}\p{N}_]/gu,'')}`).filter(x=>x.length>1).slice(0,6);
  return `${title.replace(/#Shorts/gi,'').trim()}\n\n${cleanTags.join(' ')}`.slice(0,2200);
}
async function ensureJob(userId:string,automationKey:string,title:string,tags:string[],preparedStoragePath:string){
  if(!tiktokMirrorEnabled())return null;
  const {items}=await db.list<TikTokPublishJob>(JOB_TABLE,{filter:{userId},limit:200});
  const existing=items.find(x=>x.automationKey===automationKey);if(existing)return existing;
  const info=await storage.info(preparedStoragePath);if(!info||info.content_type!=='video/mp4')throw new Error('TikTok source video is missing or invalid');
  const t=new Date().toISOString(),record:TikTokPublishJob={
    userId,automationKey,title:titleForTikTok(title,tags),preparedStoragePath,
    status:'pending',privacyLevel:process.env.TIKTOK_PRIVACY_LEVEL||'PUBLIC_TO_EVERYONE',
    uploadedBytes:0,retryCount:0,createdAt:t,updatedAt:t,
  };
  const [id]=await db.add(JOB_TABLE,[record]);return {...record,id};
}
export async function ensureTikTokPublishJob(userId:string,spec?:PublishSpec){
  if(!spec)return null;return ensureJob(userId,spec.automationKey,spec.title,spec.tags,spec.preparedStoragePath);
}
export async function ensureReviewedTikTokJob(userId:string,spec:ReviewedPublishSpec){
  return ensureJob(userId,`reviewed-${spec.key}`,spec.title,spec.tags,spec.preparedStoragePath);
}
export async function listTikTokJobs(userId:string){
  const {items}=await db.list<TikTokPublishJob>(JOB_TABLE,{filter:{userId},limit:200});
  return items.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
async function apiPost(path:string,access:string,body:unknown){
  const response=await fetch(`${API}${path}`,{method:'POST',headers:{authorization:`Bearer ${access}`,'content-type':'application/json; charset=UTF-8'},body:JSON.stringify(body)});
  const data=await response.json() as any;
  if(!response.ok||data.error?.code!=='ok')throw new Error(data.error?.message||data.error?.code||`TikTok API failed (${response.status})`);
  return data.data||{};
}
async function creatorInfo(access:string){return apiPost('/v2/post/publish/creator_info/query/',access,{});}
async function saveJob(job:Stored<TikTokPublishJob>){
  const {id,...record}=job;record.updatedAt=new Date().toISOString();await db.update(JOB_TABLE,[{id,record}]);
}
function chunkPlan(total:number){
  if(total<=64*1024*1024)return {chunkSize:total,totalChunkCount:1};
  const chunkSize=MAX_CHUNK,totalChunkCount=Math.floor(total/chunkSize);
  if(totalChunkCount>1000)throw new Error('TikTok video exceeds the supported chunk count');
  return {chunkSize,totalChunkCount};
}
async function initialize(job:Stored<TikTokPublishJob>,access:string){
  const creator=await creatorInfo(access),options=Array.isArray(creator.privacy_level_options)?creator.privacy_level_options:[];
  if(!options.includes(job.privacyLevel))throw new Error(`TikTok privacy ${job.privacyLevel} is not available for this account/client`);
  const info=await storage.info(job.preparedStoragePath);if(!info)throw new Error('TikTok source video not found');
  const total=Number(info.bytes),plan=chunkPlan(total);
  const data=await apiPost('/v2/post/publish/video/init/',access,{
    post_info:{title:job.title,privacy_level:job.privacyLevel,disable_duet:false,disable_comment:false,disable_stitch:false,video_cover_timestamp_ms:1000,brand_content_toggle:false,brand_organic_toggle:false,is_aigc:true},
    source_info:{source:'FILE_UPLOAD',video_size:total,chunk_size:plan.chunkSize,total_chunk_count:plan.totalChunkCount},
  });
  if(!data.publish_id||!data.upload_url)throw new Error('TikTok did not return publish_id/upload_url');
  job.totalBytes=total;job.chunkSize=plan.chunkSize;job.publishId=String(data.publish_id);job.uploadUrl=String(data.upload_url);
  job.creatorUsername=String(creator.creator_username||'');job.status='uploading';await saveJob(job);
  return {status:'session-created',publishId:job.publishId};
}
async function uploadChunk(job:Stored<TikTokPublishJob>){
  if(!job.uploadUrl||!job.totalBytes||!job.chunkSize)throw new Error('TikTok upload session is incomplete');
  const start=job.uploadedBytes,remaining=job.totalBytes-start;
  const end=remaining<=job.chunkSize*2?job.totalBytes-1:start+job.chunkSize-1;
  const source=await fetch(await storage.url(job.preparedStoragePath),{headers:{range:`bytes=${start}-${end}`}});
  if(source.status!==206&&!(source.status===200&&start===0))throw new Error(`TikTok source range failed (${source.status})`);
  const bytes=Buffer.from(await source.arrayBuffer()),actualEnd=start+bytes.length-1;
  const response=await fetch(job.uploadUrl,{method:'PUT',headers:{'content-type':'video/mp4','content-length':String(bytes.length),'content-range':`bytes ${start}-${actualEnd}/${job.totalBytes}`},body:bytes});
  if(!response.ok)throw new Error(`TikTok upload failed (${response.status}): ${(await response.text()).slice(0,400)}`);
  job.uploadedBytes=actualEnd+1;job.status=job.uploadedBytes>=job.totalBytes?'processing':'uploading';await saveJob(job);
  return {status:job.status,progress:Math.round(job.uploadedBytes/job.totalBytes*100),publishId:job.publishId};
}
async function fetchStatus(job:Stored<TikTokPublishJob>,access:string){
  if(!job.publishId)throw new Error('TikTok publish id is missing');
  const data=await apiPost('/v2/post/publish/status/fetch/',access,{publish_id:job.publishId});
  if(data.status==='FAILED')throw new Error(`TikTok moderation/upload failed: ${data.fail_reason||'unknown reason'}`);
  const ids=data.publicaly_available_post_id||data.publicly_available_post_id||[];
  if(data.status==='PUBLISH_COMPLETE'&&ids.length){
    job.postId=String(ids[0]);job.tiktokUrl=job.creatorUsername?`https://www.tiktok.com/@${job.creatorUsername}/video/${job.postId}`:`https://www.tiktok.com/video/${job.postId}`;
    job.status='published';job.lastError=undefined;await saveJob(job);return {status:'published',tiktokUrl:job.tiktokUrl};
  }
  job.status='processing';await saveJob(job);return {status:String(data.status||'processing').toLowerCase(),publishId:job.publishId};
}
export async function processOneTikTokStep(userId:string){
  if(!tiktokMirrorEnabled())return {status:'disabled'};
  if(!await tiktokConnected(userId))return {status:'not-connected'};
  const jobs=await listTikTokJobs(userId),recoverable=(x:TikTokPublishJob)=>['pending','uploading','processing'].includes(x.status)||(x.status==='failed'&&x.retryCount<4);
  const job=jobs.find(recoverable);if(!job)return {status:'no-job'};
  if(job.status==='failed'){
    job.status='pending';job.retryCount++;job.lastError=undefined;job.publishId=undefined;job.uploadUrl=undefined;job.uploadedBytes=0;await saveJob(job);
  }
  try{
    const access=await accessToken(userId);
    if(job.status==='processing')return await fetchStatus(job,access);
    if(!job.publishId)return await initialize(job,access);
    return await uploadChunk(job);
  }catch(error){
    const message=error instanceof Error?error.message:String(error);job.status='failed';job.lastError=message.slice(0,1200);await saveJob(job);throw error;
  }
}
