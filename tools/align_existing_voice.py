#!/usr/bin/env python3
"""Offline acoustic word alignment. Does not synthesize speech or use ONNX."""
import argparse
import hashlib
import json
import re
import subprocess
import tempfile
import wave
from pathlib import Path
from pocketsphinx import Decoder


def align(video, timeline):
    with tempfile.TemporaryDirectory(prefix='voice-alignment-') as tmp:
        wav = Path(tmp) / 'voice.wav'
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', str(video),
                        '-vn', '-ac', '1', '-ar', '16000', str(wav)], check=True)
        with wave.open(str(wav)) as audio:
            frames = audio.readframes(audio.getnframes())
        segments = json.loads(Path(timeline).read_text())['segments']
        result = []
        for segment in segments:
            text = segment['text'].lower().replace('real-world', 'real world')
            words = re.findall(r"[a-z]+(?:'[a-z]+)?", text)
            decoder = Decoder(samprate=16000, lm=None, loglevel='ERROR')
            decoder.add_word('json', 'JH EY S AH N', update=True)
            unknown = [word for word in words if not decoder.lookup_word(word)]
            if unknown:
                raise ValueError(f'Unknown pronunciation: {unknown}')
            start, end = segment['start'], segment['end']
            data = frames[round(start*16000)*2:round(end*16000)*2]
            decoder.set_align_text(' '.join(words))
            decoder.start_utt()
            decoder.process_raw(data, full_utt=True)
            decoder.end_utt()
            aligned = [dict(word=re.sub(r'\(\d+\)$', '', s.word), start=round(start+s.start_frame/100, 3),
                            end=round(start+(s.end_frame+1)/100, 3))
                       for s in decoder.seg() if s.word not in ('<sil>', '<s>', '</s>', '[SPEECH]', '[NOISE]')]
            if [s['word'] for s in aligned] != words:
                raise ValueError(f'Alignment token mismatch: expected {words}; got {aligned}')
            result.append(dict(index=segment['index'], text=segment['text'],
                               start=start, end=end, words=aligned))
        return dict(method='PocketSphinx 5.0.4 forced acoustic alignment, 10ms frames',
                    sourceSha256=hashlib.sha256(Path(video).read_bytes()).hexdigest(),
                    note='Acoustic estimates; manual listening review remains required.',
                    segments=result)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--video', type=Path, required=True)
    parser.add_argument('--timeline', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(align(args.video,args.timeline),indent=2)+'\n')
    print(args.output)
