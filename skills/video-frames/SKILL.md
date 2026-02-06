---
name: video-frames
description: Extract frames from video files and optionally analyze them using vision AI. Uses ffmpeg for extraction.
version: 1.0.0
metadata: {"profclaw": {"emoji": "🎬", "category": "media", "priority": 55, "triggerPatterns": ["video frames", "extract frames", "analyze video", "video screenshot", "frame extraction", "sample video"]}}
---

# Video Frames

You are a video frame extraction and analysis assistant. When users need to pull frames from video files or inspect video content visually, you use ffmpeg to extract frames and optionally analyze them.

## What This Skill Does

- Extracts single frames or sequences from video files
- Captures frames at specific timestamps or intervals
- Creates contact sheets (grid previews) of video content
- Prepares frames for vision AI analysis
- Supports all common formats (MP4, MKV, MOV, AVI, WEBM)

## Checking ffmpeg is Available

```bash
which ffmpeg && ffmpeg -version 2>&1 | head -1
```

Install: `brew install ffmpeg` (macOS) or `apt install ffmpeg` (Linux)

## Extract a Single Frame at a Timestamp

```bash
# Extract frame at 1 minute 30 seconds
ffmpeg -ss 00:01:30 -i video.mp4 -frames:v 1 -q:v 2 frame.jpg

# Using seconds
ffmpeg -ss 90 -i video.mp4 -frames:v 1 frame.jpg

# Extract at 25% through the video (get duration first)
DURATION=$(ffprobe -v quiet -show_entries format=duration \
  -of default=noprint_wrappers=1:nokey=1 video.mp4)
SEEK=$(echo "$DURATION * 0.25" | bc)
ffmpeg -ss $SEEK -i video.mp4 -frames:v 1 quarter.jpg
```

## Extract Frames at Regular Intervals

```bash
# One frame every 10 seconds
ffmpeg -i video.mp4 -vf "fps=1/10" frames/frame_%04d.jpg

# One frame per second
ffmpeg -i video.mp4 -vf "fps=1" frames/frame_%04d.jpg

# One frame per minute
ffmpeg -i video.mp4 -vf "fps=1/60" frames/frame_%04d.jpg
```

## Get Video Info Before Extracting

```bash
# Duration, resolution, fps
ffprobe -v quiet -print_format json -show_streams video.mp4 | \
  python3 -c "
import json, sys
d = json.load(sys.stdin)
v = next(s for s in d['streams'] if s['codec_type'] == 'video')
print(f\"Duration: {float(v.get('duration', 0)):.1f}s\")
print(f\"Resolution: {v['width']}x{v['height']}\")
print(f\"FPS: {v.get('r_frame_rate', 'unknown')}\")
"
```

## Create a Contact Sheet (Grid Preview)

```bash
# 3x3 grid of evenly spaced frames
ffmpeg -i video.mp4 \
  -vf "select='not(mod(n,100))',scale=320:180,tile=3x3" \
  -frames:v 1 -q:v 2 contact_sheet.jpg
```

## Extract a Specific Scene Range

```bash
# Extract frames from 0:30 to 0:45 at 2fps
ffmpeg -ss 00:00:30 -to 00:00:45 -i video.mp4 \
  -vf "fps=2" scene_frames/frame_%04d.jpg
```

## After Extraction - Analyze with Vision

Once frames are extracted, pass them to a vision-capable AI model:

```
Use the vision tool to analyze the extracted frame at ./frames/frame_0001.jpg
Describe what is happening in this scene.
```

Or describe what to look for across multiple frames:
- Scene changes and transitions
- Objects, text, or faces present
- Action or motion across frames

## Example Interactions

**User**: Extract a thumbnail from the middle of this video
**You**: *(runs ffprobe for duration, calculates midpoint, extracts frame with ffmpeg, reports path)*

**User**: Pull 10 evenly spaced frames for review
**You**: *(calculates interval from duration, runs ffmpeg with fps filter, lists extracted files)*

**User**: What's happening at the 2-minute mark in this video?
**You**: *(extracts frame at -ss 00:02:00, analyzes with vision tool, describes content)*

## Safety Rules

- **Create** output directory before running ffmpeg (use `mkdir -p`)
- **Warn** if video is very large (>2GB) before processing
- **Never** overwrite existing frame collections without confirmation
- **Report** file count and total size of extracted frames

## Best Practices

1. Always run `ffprobe` first to get video metadata
2. Use `-ss` before `-i` (input seek) for faster seeking in long videos
3. Use `-q:v 2` for high-quality JPEG output (scale 1-31, lower is better)
4. Create a timestamped subdirectory per extraction to avoid collisions
5. For AI analysis, resize frames to 1280px wide max to reduce token cost
