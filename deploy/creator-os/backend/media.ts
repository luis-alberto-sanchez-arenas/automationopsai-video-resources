import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';

export async function runFfmpeg(args:string[]) {
  await new Promise<void>((resolve,reject)=>{
    const child=spawn(process.env.FFMPEG_PATH || 'ffmpeg',args,{stdio:['ignore','ignore','pipe']});
    let stderr='',settled=false;
    const timeoutMs=Number(process.env.FFMPEG_TIMEOUT_MS || '600000');
    const timer=setTimeout(()=>{
      if(settled)return;
      settled=true;child.kill('SIGKILL');
      reject(new Error(`FFmpeg timeout after ${timeoutMs}ms: ${stderr.slice(-1200)}`));
    },timeoutMs);
    child.stderr.on('data',chunk=>stderr=(stderr+String(chunk)).slice(-12000));
    child.on('error',error=>{if(settled)return;settled=true;clearTimeout(timer);reject(error);});
    child.on('close',(code,signal)=>{
      if(settled)return;settled=true;clearTimeout(timer);
      code===0?resolve():reject(new Error(`FFmpeg failed (code=${code}, signal=${signal||'none'}): ${stderr.slice(-1200)}`));
    });
  });
}

type KokoroRequest={resolve:()=>void;reject:(error:Error)=>void;timer:NodeJS.Timeout};
let kokoroServer:{child:ReturnType<typeof spawn>;pending:Map<string,KokoroRequest>;stderr:string}|undefined;
let kokoroRequestId=0;

function failKokoroServer(server:NonNullable<typeof kokoroServer>,error:Error){
  if(kokoroServer===server)kokoroServer=undefined;
  for(const request of server.pending.values()){clearTimeout(request.timer);request.reject(error);}
  server.pending.clear();
}

function ensureKokoroServer(){
  if(kokoroServer&&!kokoroServer.child.killed)return kokoroServer;
  const python=process.env.KOKORO_PYTHON || '/opt/kokoro/bin/python';
  const script=process.env.KOKORO_SCRIPT || '/app/backend/kokoro_tts.py';
  const model=process.env.KOKORO_MODEL_PATH || '/opt/kokoro-models/kokoro-v1.0.onnx';
  const voices=process.env.KOKORO_VOICES_PATH || '/opt/kokoro-models/voices-v1.0.bin';
  const child=spawn(python,[script,'--serve','--model',model,'--voices',voices],{stdio:['pipe','pipe','pipe']});
  const server={child,pending:new Map<string,KokoroRequest>(),stderr:''};
  kokoroServer=server;
  child.stderr.on('data',chunk=>server.stderr=(server.stderr+String(chunk)).slice(-8000));
  createInterface({input:child.stdout}).on('line',line=>{
    try{
      const result=JSON.parse(line) as {id?:string;ok?:boolean;error?:string};
      if(!result.id)return;
      const request=server.pending.get(result.id);if(!request)return;
      server.pending.delete(result.id);clearTimeout(request.timer);
      result.ok?request.resolve():request.reject(new Error(`Local Kokoro TTS failed: ${result.error||'unknown error'}`));
    }catch{server.stderr=(server.stderr+`\nInvalid Kokoro response: ${line}`).slice(-8000);}
  });
  child.on('error',error=>failKokoroServer(server,error));
  child.on('close',code=>failKokoroServer(server,new Error(`Local Kokoro server exited (${code}): ${server.stderr.slice(-1200)}`)));
  return server;
}

async function localKokoroSpeech(text:string,outputPath:string){
  const voice=process.env.KOKORO_TTS_VOICE || 'af_heart';
  const speed=Number(process.env.KOKORO_TTS_SPEED || '0.97');
  const lang=process.env.KOKORO_TTS_LANG || 'en-us';
  const server=ensureKokoroServer();
  const id=String(++kokoroRequestId);
  await new Promise<void>((resolve,reject)=>{
    const timer=setTimeout(()=>{
      server.pending.delete(id);
      reject(new Error(`Local Kokoro TTS timeout; stderr=${server.stderr.slice(-600)}`));
    },Number(process.env.KOKORO_TTS_TIMEOUT_MS || '900000'));
    server.pending.set(id,{resolve,reject,timer});
    server.child.stdin!.write(`${JSON.stringify({id,text,output:outputPath,voice,speed,lang})}\n`,'utf8',error=>{
      if(!error)return;
      const request=server.pending.get(id);if(!request)return;
      server.pending.delete(id);clearTimeout(request.timer);reject(error);
    });
  });
  const info=await stat(outputPath);
  if(info.size<16000)throw new Error(`Local Kokoro TTS failed quality floor (${info.size} bytes)`);
}
export async function synthesizeNeuralSpeech(text:string,outputPath:string) {
  const endpoint=(process.env.KOKORO_TTS_URL || '').trim();
  if(endpoint){
    try{
      const response=await fetch(endpoint,{
        method:'POST',
        headers:{
          'content-type':'application/json',
          ...(process.env.KOKORO_TTS_TOKEN?{'authorization':`Bearer ${process.env.KOKORO_TTS_TOKEN}`}:{})
        },
        body:JSON.stringify({
          text,
          voice:process.env.KOKORO_TTS_VOICE || 'af_heart',
          speed:Number(process.env.KOKORO_TTS_SPEED || '0.97'),
          format:'wav'
        }),
        signal:AbortSignal.timeout(Number(process.env.KOKORO_TTS_TIMEOUT_MS || '120000'))
      });
      if(!response.ok)throw new Error(`Kokoro TTS failed (${response.status})`);
      const bytes=Buffer.from(await response.arrayBuffer());
      await import('node:fs/promises').then(fs=>fs.writeFile(outputPath,bytes));
      const info=await stat(outputPath);
      if(info.size<16000)throw new Error(`Kokoro TTS failed quality floor (${info.size} bytes)`);
      return;
    }catch(e){
      console.warn('Remote Kokoro TTS unavailable, using local Kokoro ONNX:',e instanceof Error?e.message:String(e));
    }
  }
  await localKokoroSpeech(text,outputPath);
}

export function fontDir() {
  return process.env.FONT_DIR || '/usr/share/fonts/truetype/dejavu';
}

export function fontName() {
  return process.env.FONT_NAME || 'DejaVu Sans';
}

export async function remoteFileSize(url:string) {
  const head=await fetch(url,{method:'HEAD',redirect:'follow'});
  const length=Number(head.headers.get('content-length'));
  if (head.ok && Number.isFinite(length) && length>0) return length;
  const probe=await fetch(url,{headers:{range:'bytes=0-0'},redirect:'follow'});
  const match=probe.headers.get('content-range')?.match(/\/(\d+)$/);
  if (!match) throw new Error(`Remote media does not expose file size (${probe.status})`);
  return Number(match[1]);
}
