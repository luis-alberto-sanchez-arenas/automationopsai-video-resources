#!/usr/bin/env python3
"""Create editorially planned 9:16 Shorts from an original long-form master."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import tempfile
import textwrap
from pathlib import Path


def esc(text: str) -> str:
    return text.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")


def wrapped(text: str, width: int) -> str:
    return "\n".join(textwrap.wrap(text, width=width, break_long_words=False))


def filter_path(path: Path) -> str:
    return str(path).replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")


def seconds(value: str) -> float:
    h, m, rest = value.replace(",", ".").split(":")
    return int(h) * 3600 + int(m) * 60 + float(rest)


def timestamp(value: float) -> str:
    value = max(0.0, value)
    h, rem = divmod(value, 3600)
    m, sec = divmod(rem, 60)
    return f"{int(h):02d}:{int(m):02d}:{sec:06.3f}".replace(".", ",")


def trimmed_srt(source: Path, start: float, duration: float) -> str:
    blocks = re.split(r"\n\s*\n", source.read_text(encoding="utf-8-sig").strip())
    output: list[str] = []
    for block in blocks:
        lines = block.splitlines()
        timing_index = next((i for i, line in enumerate(lines) if "-->" in line), None)
        if timing_index is None:
            continue
        begin, end = [seconds(x.strip()) for x in lines[timing_index].split("-->")]
        if end <= start or begin >= start + duration:
            continue
        local_begin = max(begin, start) - start
        local_end = min(end, start + duration) - start
        output.append(
            f"{len(output) + 1}\n{timestamp(local_begin)} --> {timestamp(local_end)}\n"
            + "\n".join(lines[timing_index + 1 :])
        )
    return "\n\n".join(output) + "\n"


def render(master: Path, out: Path, item: dict, font: str, srt: Path | None) -> None:
    start = float(item["start"])
    duration = float(item["duration"])
    if not 12 <= duration <= 60:
        raise ValueError(f"{item['id']}: duration must be 12–60 seconds for this channel strategy")
    title = wrapped(item["hook"], 25)
    takeaway = wrapped(item["takeaway"], 32)
    title_handle = tempfile.NamedTemporaryFile("w", suffix=".txt", encoding="utf-8", delete=False)
    title_handle.write(title)
    title_handle.close()
    title_file = Path(title_handle.name)
    takeaway_handle = tempfile.NamedTemporaryFile("w", suffix=".txt", encoding="utf-8", delete=False)
    takeaway_handle.write(takeaway)
    takeaway_handle.close()
    takeaway_file = Path(takeaway_handle.name)
    caption_filter = ""
    caption_file: Path | None = None
    if srt:
        handle = tempfile.NamedTemporaryFile("w", suffix=".srt", encoding="utf-8", delete=False)
        handle.write(trimmed_srt(srt, start, duration))
        handle.close()
        caption_file = Path(handle.name)
        subtitle_path = filter_path(caption_file)
        caption_filter = (
            f"subtitles='{subtitle_path}':force_style='FontName=DejaVu Sans,FontSize=5,"
            "PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=3,"
            "Outline=1,Shadow=0,Alignment=2,MarginV=38',"
        )
    else:
        caption_filter = "null,"
    filters = (
        "[0:v]split=2[bg][fg];"
        "[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,"
        "boxblur=28:12,eq=brightness=-0.18[back];"
        "[fg]scale=1000:-2:force_original_aspect_ratio=decrease,"
        "pad=1000:650:(ow-iw)/2:(oh-ih)/2:color=0x08111f[front];"
        "[back][front]overlay=40:520[base];"
        f"[base]{caption_filter}"
        f"drawtext=fontfile='{font}':textfile='{filter_path(title_file)}':fontcolor=white:fontsize=54:"
        "line_spacing=12:x=(w-text_w)/2:y=135:box=1:boxcolor=0x07111fee:boxborderw=28,"
        f"drawtext=fontfile='{font}':textfile='{filter_path(takeaway_file)}':fontcolor=0xBDEBFF:fontsize=36:"
        "line_spacing=10:x=(w-text_w)/2:y=1350:box=1:boxcolor=0x07111fdd:boxborderw=22,"
        f"drawtext=fontfile='{font}':text='Video completo en el canal':fontcolor=0x38D5FF:"
        "fontsize=36:x=(w-text_w)/2:y=1740[outv]"
    )
    cmd = [
        "ffmpeg", "-y", "-hide_banner", "-ss", str(start), "-t", str(duration),
        "-i", str(master), "-filter_complex", filters,
        "-map", "[outv]", "-map", "0:a:0", "-c:v", "libx264", "-preset", "medium",
        "-crf", "18", "-pix_fmt", "yuv420p", "-r", "30", "-c:a", "aac", "-b:a", "192k",
        "-movflags", "+faststart", str(out),
    ]
    try:
        subprocess.run(cmd, check=True)
    finally:
        if caption_file:
            caption_file.unlink(missing_ok=True)
        title_file.unlink(missing_ok=True)
        takeaway_file.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("master", type=Path)
    parser.add_argument("plan", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--font", default="/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")
    parser.add_argument("--srt", type=Path)
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    plan = json.loads(args.plan.read_text(encoding="utf-8"))
    items = plan["shorts"][: args.limit] if args.limit else plan["shorts"]
    for item in items:
        render(args.master, args.output / f"{item['id']}.mp4", item, args.font, args.srt)


if __name__ == "__main__":
    main()
