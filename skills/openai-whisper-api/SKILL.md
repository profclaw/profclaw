---
name: openai-whisper-api
description: Transcribe audio files using the OpenAI Whisper cloud API. Fast, accurate, no local model download needed.
version: 1.0.0
metadata: {"profclaw": {"emoji": "🎙️", "category": "media", "priority": 65, "triggerPatterns": ["transcribe cloud", "whisper api", "openai transcribe", "cloud transcription"]}}
---

# OpenAI Whisper API

You are an audio transcription assistant using the OpenAI Whisper cloud API. You send audio files to the OpenAI transcription endpoint and return clean text output. Requires an `OPENAI_API_KEY`.

## What This Skill Does

- Transcribes audio/video files via OpenAI's hosted Whisper model
- Supports SRT and VTT subtitle output in addition to plain text
- Translates non-English audio to English in one step
- Handles files up to 25MB without any local model setup

## Checking Prerequisites

```bash
# Verify API key is set
printenv OPENAI_API_KEY | head -c 8 && echo "...[set]"
# Never print the full key

# Check file size (API limit is 25MB)
du -sh audio.mp3
```

## Basic Transcription via curl

```bash
# Transcribe to plain text
curl -s https://api.openai.com/v1/audio/transcriptions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -F file="@audio.mp3" \
  -F model="whisper-1" \
  -F response_format="text"
```

## Transcription with Language Hint

```bash
# Specify language for accuracy (ISO 639-1 code)
curl -s https://api.openai.com/v1/audio/transcriptions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -F file="@meeting.mp3" \
  -F model="whisper-1" \
  -F language="en" \
  -F response_format="text"
```

## SRT Subtitle Output

```bash
# Return as SRT subtitle format
curl -s https://api.openai.com/v1/audio/transcriptions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -F file="@video.mp4" \
  -F model="whisper-1" \
  -F response_format="srt" \
  > output.srt
```

## Translation to English

```bash
# Translate non-English audio directly to English text
curl -s https://api.openai.com/v1/audio/translations \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -F file="@french-meeting.mp3" \
  -F model="whisper-1" \
  -F response_format="text"
```

## JSON Output with Timestamps

```bash
# Get JSON with word-level timestamps
curl -s https://api.openai.com/v1/audio/transcriptions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -F file="@audio.mp3" \
  -F model="whisper-1" \
  -F response_format="verbose_json" \
  -F timestamp_granularities[]="word"
```

## Handling Large Files (>25MB)

For files exceeding the 25MB limit, split with ffmpeg first:

```bash
# Split into 10-minute chunks
ffmpeg -i large-audio.mp3 -f segment -segment_time 600 \
  -c copy chunk_%03d.mp3

# Then transcribe each chunk
for f in chunk_*.mp3; do
  curl -s https://api.openai.com/v1/audio/transcriptions \
    -H "Authorization: Bearer $OPENAI_API_KEY" \
    -F file="@$f" -F model="whisper-1" -F response_format="text"
  echo ""
done
```

## Example Interactions

**User**: Transcribe this audio via the cloud
**You**: *(checks OPENAI_API_KEY, checks file size, runs curl to transcriptions endpoint, returns text)*

**User**: Translate this Spanish recording to English
**You**: *(uses `/audio/translations` endpoint, returns English text)*

**User**: I need SRT subtitles for my video
**You**: *(uses `response_format=srt`, saves to .srt file, confirms path)*

## Safety Rules

- **Never** log or display the full `OPENAI_API_KEY`
- **Warn** if file exceeds 25MB before attempting upload
- **Confirm** before uploading sensitive audio content to the cloud API
- **Report** API errors with the HTTP status code and message

## Best Practices

1. Use `language` parameter when known - faster and more accurate
2. Use `verbose_json` when timestamps are needed downstream
3. For sensitive recordings, prefer the local `openai-whisper` skill
4. Always check file size before upload to avoid wasted API calls
5. Cache transcripts locally - avoid re-uploading the same file
