#!/usr/bin/env python3
"""
ass_bounce.py — render an ASS subtitle file as a transparent animated overlay
with a bounce entrance (0 → 115 → 100% scale) on each dialogue line.

Usage:
    python ass_bounce.py input.ass output.webm [--fps 30] [--bounce-frames 6]

Output is a WebM with VP9 + alpha at the same resolution as the ASS PlayRes.
Drop it over your footage in Kdenlive as a video track (no compositing mode
needed — the alpha is already baked in).

Dependencies:
    pip install pillow numpy
    apt install ffmpeg python3-numpy   (ffmpeg must be on PATH)

Font note:
    The script uses the Fontname from each ASS Style. The font must be
    installed on your system (fc-list to check). If Pillow can't find it,
    it falls back to the default font and prints a warning.
"""

import argparse
import math
import os
import re
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

try:
    from PIL import Image, ImageDraw, ImageFont
    import numpy as np
except ImportError:
    sys.exit("Missing dependencies. Run: pip install pillow numpy")


# ---------------------------------------------------------------------------
# ASS colour: &H00BBGGRR  (alpha is the first byte, 00 = fully opaque)
# ---------------------------------------------------------------------------
def parse_ass_colour(s: str) -> tuple[int, int, int, int]:
    """Return (R, G, B, A) with A=0 meaning fully opaque."""
    s = s.strip()
    # Strip &H or 0x prefix properly (not lstrip which treats it as a char set)
    if s.upper().startswith("&H"):
        s = s[2:]
    elif s.upper().startswith("0X"):
        s = s[2:]
    val = int(s, 16) if s else 0
    a = (val >> 24) & 0xFF
    b = (val >> 16) & 0xFF
    g = (val >> 8) & 0xFF
    r = val & 0xFF
    alpha = 255 - a  # ASS alpha 0 = opaque → PIL alpha 255
    return r, g, b, alpha


def parse_ass_time(t: str) -> float:
    """h:mm:ss.cc → seconds (centiseconds)."""
    h, m, rest = t.split(":")
    s, cs = rest.split(".")
    return int(h) * 3600 + int(m) * 60 + int(s) + int(cs) / 100


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------
@dataclass
class AssStyle:
    name: str
    fontname: str
    fontsize: float
    primary: tuple[int, int, int, int]   # RGBA
    outline_colour: tuple[int, int, int, int]
    bold: bool
    outline: float
    margin_v: int
    alignment: int  # numpad alignment (2 = bottom-center)


@dataclass
class DialogueLine:
    start: float   # seconds
    end: float
    style: str
    text: str


# ---------------------------------------------------------------------------
# ASS parser (minimal — only what we need)
# ---------------------------------------------------------------------------
def parse_ass(path: str) -> tuple[dict[str, AssStyle], list[DialogueLine], int, int]:
    styles: dict[str, AssStyle] = {}
    lines: list[DialogueLine] = []
    res_x, res_y = 1080, 1920

    style_fmt: list[str] = []
    event_fmt: list[str] = []

    with open(path, encoding="utf-8-sig") as f:
        section = ""
        for raw in f:
            line = raw.rstrip("\n")
            if line.startswith("["):
                section = line.strip("[]").lower()
                continue

            if section == "script info":
                if line.startswith("PlayResX:"):
                    res_x = int(line.split(":")[1].strip())
                elif line.startswith("PlayResY:"):
                    res_y = int(line.split(":")[1].strip())

            elif section == "v4+ styles":
                if line.startswith("Format:"):
                    style_fmt = [x.strip() for x in line[7:].split(",")]
                elif line.startswith("Style:"):
                    vals = line[6:].split(",", len(style_fmt) - 1)
                    d = dict(zip(style_fmt, [v.strip() for v in vals]))
                    styles[d["Name"]] = AssStyle(
                        name=d["Name"],
                        fontname=d["Fontname"],
                        fontsize=float(d["Fontsize"]),
                        primary=parse_ass_colour(d["PrimaryColour"]),
                        outline_colour=parse_ass_colour(d["OutlineColour"]),
                        bold=d.get("Bold", "0") in ("-1", "1"),
                        outline=float(d.get("Outline", "0")),
                        margin_v=int(d.get("MarginV", "0")),
                        alignment=int(d.get("Alignment", "2")),
                    )

            elif section == "events":
                if line.startswith("Format:"):
                    event_fmt = [x.strip() for x in line[7:].split(",")]
                elif line.startswith("Dialogue:"):
                    # Text field may contain commas
                    n = len(event_fmt) - 1
                    parts = line[9:].split(",", n)
                    d = dict(zip(event_fmt, [p.strip() for p in parts]))
                    text = d.get("Text", "").strip()
                    # Strip override tags like {\an8}
                    text = re.sub(r"\{[^}]*\}", "", text)
                    lines.append(DialogueLine(
                        start=parse_ass_time(d["Start"]),
                        end=parse_ass_time(d["End"]),
                        style=d.get("Style", "Default"),
                        text=text,
                    ))

    return styles, lines, res_x, res_y


# ---------------------------------------------------------------------------
# Font loading
# ---------------------------------------------------------------------------
_font_cache: dict[tuple, ImageFont.FreeTypeFont] = {}

def get_font(fontname: str, size: int, bold: bool) -> ImageFont.FreeTypeFont:
    key = (fontname, size, bold)
    if key in _font_cache:
        return _font_cache[key]

    # Try to find the font via fc-match
    try:
        weight = ":weight=200" if bold else ""
        result = subprocess.run(
            ["fc-match", "--format=%{file}", f"{fontname}{weight}"],
            capture_output=True, text=True, timeout=3
        )
        font_path = result.stdout.strip()
        if font_path and os.path.exists(font_path):
            font = ImageFont.truetype(font_path, size)
            _font_cache[key] = font
            return font
    except Exception:
        pass

    print(f"  Warning: could not find font '{fontname}', using default.", file=sys.stderr)
    font = ImageFont.load_default()
    _font_cache[key] = font
    return font


# ---------------------------------------------------------------------------
# Bounce easing  (0 → 1.15 → 1.0)
# ---------------------------------------------------------------------------
def bounce_scale(t_norm: float) -> float:
    """
    t_norm in [0, 1] over the bounce window.
    Returns a scale factor: starts at 0, overshoots to 1.15, settles at 1.0.
    Uses a simple two-phase ease.
    """
    overshoot = 1.15
    # Phase 1: 0 → overshoot  (first 60% of the window)
    p1 = 0.6
    if t_norm <= p1:
        x = t_norm / p1
        # ease-out cubic
        x = 1 - (1 - x) ** 3
        return x * overshoot
    else:
        # Phase 2: overshoot → 1.0  (remaining 40%)
        x = (t_norm - p1) / (1 - p1)
        # ease-in-out
        x = x * x * (3 - 2 * x)
        return overshoot + (1.0 - overshoot) * x


# ---------------------------------------------------------------------------
# Render a single frame for one dialogue line
# ---------------------------------------------------------------------------
def render_text_frame(
    text: str,
    style: AssStyle,
    scale: float,
    res_x: int,
    res_y: int,
) -> Image.Image:
    """
    Render `text` centred horizontally, positioned vertically according to
    style.margin_v from the bottom, at the given scale factor.
    Returns an RGBA image of size (res_x, res_y).
    """
    base_size = int(style.fontsize)
    scaled_size = max(4, int(base_size * scale))
    outline_px = max(0, int(style.outline * scale))

    font = get_font(style.fontname, scaled_size, style.bold)

    # Measure text on a scratch image
    scratch = Image.new("RGBA", (1, 1))
    draw_s = ImageDraw.Draw(scratch)
    bbox = draw_s.textbbox((0, 0), text, font=font, stroke_width=outline_px)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]

    # Position: bottom-center alignment (alignment=2)
    x = (res_x - tw) // 2 - bbox[0]
    # margin_v is from bottom in ASS
    y = res_y - style.margin_v - th - bbox[1]

    frame = Image.new("RGBA", (res_x, res_y), (0, 0, 0, 0))
    draw = ImageDraw.Draw(frame)

    pr, pg, pb, pa = style.primary
    or_, og, ob, oa = style.outline_colour

    # Draw outline (stroke)
    if outline_px > 0:
        draw.text(
            (x, y), text, font=font,
            fill=(or_, og, ob, oa),
            stroke_width=outline_px,
            stroke_fill=(or_, og, ob, oa),
        )

    # Draw primary text on top
    draw.text((x, y), text, font=font, fill=(pr, pg, pb, pa))

    return frame


# ---------------------------------------------------------------------------
# Main render pipeline
# ---------------------------------------------------------------------------
def render(
    ass_path: str,
    output_path: str,
    fps: float = 30.0,
    bounce_frames: int = 6,
):
    print(f"Parsing {ass_path} ...")
    styles, lines, res_x, res_y = parse_ass(ass_path)

    if not lines:
        sys.exit("No dialogue lines found in ASS file.")

    total_duration = max(l.end for l in lines)
    total_frames = math.ceil(total_duration * fps)

    print(f"Resolution: {res_x}x{res_y}  FPS: {fps}  Duration: {total_duration:.2f}s  Frames: {total_frames}")
    print(f"Dialogue lines: {len(lines)}  Bounce window: {bounce_frames} frames")

    # Build a per-frame index of which line is active
    # Each frame can have at most one active line (subtitle tracks are single-line)
    frame_line: list[Optional[int]] = [None] * total_frames
    for i, dl in enumerate(lines):
        f_start = int(dl.start * fps)
        f_end = min(int(dl.end * fps), total_frames)
        for f in range(f_start, f_end):
            frame_line[f] = i

    # Write frames to a temp directory, then pipe to ffmpeg
    with tempfile.TemporaryDirectory() as tmpdir:
        print("Rendering frames ...")
        prev_line_idx: Optional[int] = None
        line_start_frame: dict[int, int] = {}

        for f in range(total_frames):
            li = frame_line[f]
            frame = Image.new("RGBA", (res_x, res_y), (0, 0, 0, 0))

            if li is not None:
                dl = lines[li]

                # Track when this line first appeared
                if li not in line_start_frame:
                    line_start_frame[li] = f

                frames_since_start = f - line_start_frame[li]
                if frames_since_start < bounce_frames:
                    t_norm = frames_since_start / bounce_frames
                    scale = bounce_scale(t_norm)
                else:
                    scale = 1.0

                style = styles.get(dl.style, styles.get("Default"))
                if style is None:
                    style = next(iter(styles.values()))

                frame = render_text_frame(dl.text, style, scale, res_x, res_y)

            # Save frame as PNG
            frame_path = os.path.join(tmpdir, f"frame_{f:06d}.png")
            frame.save(frame_path, "PNG")

            if f % 100 == 0 or f == total_frames - 1:
                pct = (f + 1) / total_frames * 100
                print(f"  {f+1}/{total_frames} ({pct:.1f}%)", end="\r")

        print()
        print(f"Encoding to {output_path} ...")

        # Encode with ffmpeg — VP9 with alpha (libvpx-vp9) or ProRes 4444
        ext = Path(output_path).suffix.lower()
        if ext == ".mov":
            codec_args = ["-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le"]
        else:
            # Default: WebM with VP9 alpha
            codec_args = ["-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "18", "-auto-alt-ref", "0"]

        cmd = [
            "ffmpeg", "-y",
            "-framerate", str(fps),
            "-i", os.path.join(tmpdir, "frame_%06d.png"),
            *codec_args,
            output_path,
        ]
        result = subprocess.run(cmd)
        if result.returncode != 0:
            sys.exit("ffmpeg encoding failed.")

    print(f"\nDone! Output: {output_path}")
    print("Drop this file as a video track in Kdenlive above your footage.")
    print("No compositing mode needed — alpha is baked in.")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="Render ASS subtitles as a bouncing transparent overlay.")
    parser.add_argument("input_ass", help="Path to the exported .ass file from Kdenlive")
    parser.add_argument("output", help="Output file (.webm for VP9+alpha, .mov for ProRes 4444)")
    parser.add_argument("--fps", type=float, default=30.0, help="Frame rate (default: 30)")
    parser.add_argument("--bounce-frames", type=int, default=6, help="Number of frames for the bounce animation (default: 6)")
    args = parser.parse_args()

    if not os.path.exists(args.input_ass):
        sys.exit(f"File not found: {args.input_ass}")

    render(args.input_ass, args.output, fps=args.fps, bounce_frames=args.bounce_frames)


if __name__ == "__main__":
    main()
