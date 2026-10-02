#!/usr/bin/env python3
from __future__ import annotations
import argparse, json, re, subprocess, tempfile
from pathlib import Path
import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

def chunks(text: str, limit: int = 220) -> list[str]:
    parts = re.split(r'(?<=[.!?])\\s+', text.strip())
    out, current = [], ''
    for part in parts:
        if len(part) > limit:
            words = part.split()
            for word in words:
                candidate = f'{current} {word}'.strip()
                if len(candidate) > limit and current:
                    out.append(current); current = word
                else: current = candidate
        else:
            candidate = f'{current} {part}'.strip()
            if len(candidate) > limit and current:
                out.append(current); current = part
            else: current = candidate
    if current: out.append(current)
    return out

def main() -> int:
    parser=argparse.ArgumentParser()
    parser.add_argument('--package',required=True); parser.add_argument('--model',required=True); parser.add_argument('--voices',required=True)
    args=parser.parse_args()
    package=json.loads(Path(args.package).read_text())
    key=package['packageKey']
    output_dir=Path('deploy/creator-os/editorial-packages/audio')/key
    output_dir.mkdir(parents=True,exist_ok=True)
    engine=Kokoro(args.model,args.voices)
    for scene in package['storyboard']:
        target=output_dir/f"scene-{int(scene['sceneIndex']):02d}.mp3"
        if target.exists() and target.stat().st_size>=16000: continue
        pieces=[]; sample_rate=24000
        for text in chunks(scene['narration']):
            audio,sample_rate=engine.create(text,voice='af_heart',speed=0.97,lang='en-us')
            pieces.extend([audio,np.zeros(int(sample_rate*0.16),dtype=audio.dtype)])
        merged=np.concatenate(pieces[:-1])
        with tempfile.NamedTemporaryFile(suffix='.wav') as tmp:
            sf.write(tmp.name,merged,sample_rate,format='WAV',subtype='PCM_16')
            subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',tmp.name,'-af','loudnorm=I=-16:TP=-1.5:LRA=10','-codec:a','libmp3lame','-b:a','160k',str(target)],check=True)
        if target.stat().st_size<16000: raise RuntimeError(f'Audio asset too small: {target}')
        print(json.dumps({'scene':scene['sceneIndex'],'path':str(target),'bytes':target.stat().st_size}),flush=True)
    return 0
if __name__=='__main__': raise SystemExit(main())
