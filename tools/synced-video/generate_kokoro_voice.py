#!/usr/bin/env python3
import json, os
import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

MODEL='kokoro-v1.0.onnx'
VOICES='voices-v1.0.bin'
OUT='replacement'; os.makedirs(OUT,exist_ok=True)

segments=[
  ('hook', 'A coding agent should never see production secrets.'),
  ('setup', 'Watch the same attack run twice: first with broad access, then inside a real security boundary.'),
  ('attack', 'A malicious instruction hidden in the repository asks the agent to read the production token and send it to an unknown domain.'),
  ('unsafe', 'In the unsafe environment, both commands work. The token is visible, and the network request leaves the machine.'),
  ('reset', 'Now reset the workspace and apply four controls.'),
  ('controls', 'Use a disposable file system. Mount no production secrets. Allow only approved destinations. And require a human before merge or deployment.'),
  ('retry', 'Run the exact same malicious instruction again.'),
  ('blocked', 'This time, the secret lookup returns nothing. The outbound request is blocked by policy.'),
  ('proof', 'The agent can still edit the code, run lint, execute unit tests, and return a reviewable patch.'),
  ('payoff', 'That is the difference between trusting an agent and containing one. Build fast, but keep production outside the blast radius.'),
]

k=Kokoro(MODEL,VOICES)
gap=np.zeros(int(24000*0.16),dtype=np.float32)
pieces=[]; timeline=[]; cursor=0.0
for i,(key,text) in enumerate(segments):
    audio,sr=k.create(text,voice='af_heart',speed=0.98,lang='en-us',sentence_pause=0.22,clause_pause=0.10)
    audio=np.asarray(audio,dtype=np.float32)
    path=f'{OUT}/{i:02d}-{key}.wav'; sf.write(path,audio,sr)
    start=cursor; end=start+len(audio)/sr
    timeline.append({'id':key,'text':text,'start':round(start,3),'end':round(end,3),'duration':round(end-start,3)})
    pieces.append(audio); cursor=end
    if i<len(segments)-1: pieces.append(gap); cursor+=len(gap)/sr
full=np.concatenate(pieces)
sf.write(f'{OUT}/voice.wav',full,24000)
with open(f'{OUT}/timeline.json','w') as f: json.dump({'voice':'Kokoro af_heart','sampleRate':24000,'duration':round(len(full)/24000,3),'segments':timeline},f,indent=2)
print(json.dumps({'duration':round(len(full)/24000,3),'segments':timeline},indent=2))
