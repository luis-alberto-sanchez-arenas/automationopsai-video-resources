import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function runFfmpeg(args:string[]) {
  await new Promise<void>((resolve,reject)=>{
    const child=spawn(process.env.FFMPEG_PATH || 'ffmpeg',args,{stdio:['ignore','ignore','pipe']});
    let stderr='';
    child.stderr.on('data',chunk=>stderr=(stderr+String(chunk)).slice(-12000));
    child.on('error',reject);
    child.on('close',code=>code===0?resolve():reject(new Error(`FFmpeg failed (${code}): ${stderr.slice(-1200)}`)));
  });
}

async function localKokoroSpeech(text:string,outputPath:string){
  const python=process.env.KOKORO_PYTHON || '/opt/kokoro/bin/python';
  const script=process.env.KOKORO_SCRIPT || '/app/backend/kokoro_tts.py';
  const model=process.env.KOKORO_MODEL_PATH || '/opt/kokoro-models/kokoro-v1.0.onnx';
  const voices=process.env.KOKORO_VOICES_PATH || '/opt/kokoro-models/voices-v1.0.bin';
  const voice=process.env.KOKORO_TTS_VOICE || 'af_heart';
  const speed=process.env.KOKORO_TTS_SPEED || '0.97';
  const lang=process.env.KOKORO_TTS_LANG || 'en-us';
  await new Promise<void>((resolve,reject)=>{
    const child=spawn(python,[script,'--output',outputPath,'--model',model,'--voices',voices,'--voice',voice,'--speed',speed,'--lang',lang],{stdio:['pipe','ignore','pipe']});
    let stderr='';let settled=false;
    const finish=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve();};
    const timer=setTimeout(()=>{child.kill('SIGKILL');finish(new Error('Local Kokoro TTS timeout'));},Number(process.env.KOKORO_TTS_TIMEOUT_MS || '240000'));
    child.stderr.on('data',chunk=>stderr=(stderr+String(chunk)).slice(-4000));
    child.on('error',e=>finish(e));
    child.on('close',code=>code===0?finish():finish(new Error(`Local Kokoro TTS failed (${code}): ${stderr.slice(-1200)}`)));
    child.stdin.on('error',e=>finish(e));
    child.stdin.end(text,'utf8');
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
