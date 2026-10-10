#!/usr/bin/env python3
"""Deterministic proof: a one-pixel change invalidates an asset hash."""
from __future__ import annotations
import hashlib, json
from pathlib import Path
from tempfile import TemporaryDirectory
from PIL import Image, ImageDraw

def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

def main() -> None:
    with TemporaryDirectory() as raw:
        root=Path(raw); original=root/'synthetic-asset.png'; altered=root/'synthetic-asset-altered.png'
        image=Image.new('RGB',(96,96),'#11131A'); draw=ImageDraw.Draw(image)
        for y in range(96): draw.line((0,y,95,y),fill=(20+y,40+y//2,130+y))
        draw.ellipse((22,22,74,74),fill='#FF7A00',outline='#F8F1E1',width=3); image.save(original,optimize=False)
        before=sha256(original); changed=image.copy(); changed.putpixel((61,37),(182,255,92)); changed.save(altered,optimize=False); after=sha256(altered)
        result={'algorithm':'SHA-256','changedPixel':{'x':61,'y':37},'originalHash':before,'alteredHash':after,'hashesMatch':before==after,'gate':'REJECT' if before!=after else 'PASS','claim':'tamper evidence only; not identity or legal-compliance proof'}
        assert before!=after and result['gate']=='REJECT'; print(json.dumps(result,indent=2))

if __name__=='__main__': main()
