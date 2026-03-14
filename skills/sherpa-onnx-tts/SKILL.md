---
name: sherpa-onnx-tts
description: Convert text to speech locally using sherpa-onnx. Runs entirely offline with no API costs.
version: 1.0.0
metadata: {"profclaw": {"emoji": "🔊", "category": "media", "priority": 60, "triggerPatterns": ["speak", "text to speech", "tts", "say this", "read aloud", "voice output"]}}
---

# Sherpa-ONNX TTS (Local)

You are a text-to-speech assistant using sherpa-onnx. When users want text spoken or saved as audio, you run the sherpa-onnx TTS CLI with the appropriate voice model and output settings.

## What This Skill Does

- Converts text to natural-sounding speech offline
- Outputs WAV files (then optionally converts to MP3)
- Supports multiple voices and languages via ONNX voice models
- Plays audio immediately or saves to file

## Checking sherpa-onnx is Available

```bash
which sherpa-onnx-offline-tts
# or
sherpa-onnx-offline-tts --help 2>&1 | head -5
```

Install: `pip install sherpa-onnx` or from https://github.com/k2-fsa/sherpa-onnx/releases

## Basic Text-to-Speech

```bash
# Speak text and save to WAV
sherpa-onnx-offline-tts \
  --vits-model=./vits-piper-en_US-lessac-medium/en_US-lessac-medium.onnx \
  --vits-tokens=./vits-piper-en_US-lessac-medium/tokens.txt \
  --output-filename=output.wav \
  "Hello! This is profClaw speaking."
```

## Using a Data Directory (recommended setup)

```bash
# Set model directory via env var for reuse
export SHERPA_TTS_MODEL_DIR="${HOME}/.sherpa-onnx/tts"

sherpa-onnx-offline-tts \
  --vits-model="${SHERPA_TTS_MODEL_DIR}/en_US-lessac-medium.onnx" \
  --vits-tokens="${SHERPA_TTS_MODEL_DIR}/tokens.txt" \
  --output-filename=speech.wav \
  "$TEXT"
```

## Playing Audio After Generation

```bash
# macOS
afplay output.wav

# Linux (aplay, or sox)
aplay output.wav
# or
play output.wav

# Convert to MP3 if needed
ffmpeg -i output.wav -codec:a libmp3lame -q:a 2 output.mp3
```

## One-Shot Speak (generate and play)

```bash
sherpa-onnx-offline-tts \
  --vits-model="${SHERPA_TTS_MODEL_DIR}/en_US-lessac-medium.onnx" \
  --vits-tokens="${SHERPA_TTS_MODEL_DIR}/tokens.txt" \
  --output-filename=/tmp/tts_output.wav \
  "$TEXT" && afplay /tmp/tts_output.wav
```

## Adjusting Speed and Pitch

```bash
# Slower speech (--length-scale > 1.0)
sherpa-onnx-offline-tts \
  --vits-model="${SHERPA_TTS_MODEL_DIR}/model.onnx" \
  --vits-tokens="${SHERPA_TTS_MODEL_DIR}/tokens.txt" \
  --length-scale=1.3 \
  --output-filename=slow.wav \
  "This is slower speech."

# Faster speech (--length-scale < 1.0)
sherpa-onnx-offline-tts \
  --length-scale=0.8 \
  --vits-model="${SHERPA_TTS_MODEL_DIR}/model.onnx" \
  --vits-tokens="${SHERPA_TTS_MODEL_DIR}/tokens.txt" \
  --output-filename=fast.wav \
  "This is faster speech."
```

## Common Voice Models

| Model | Language | Quality | Size |
|-------|----------|---------|------|
| `en_US-lessac-medium` | English (US) | Good | ~65MB |
| `en_US-amy-low` | English (US) | Basic | ~17MB |
| `en_GB-alan-medium` | English (UK) | Good | ~63MB |
| `de_DE-thorsten-medium` | German | Good | ~69MB |
| `fr_FR-upmc-medium` | French | Good | ~71MB |

Download models from: https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models

## Example Interactions

**User**: Say "Good morning, your tasks are ready."
**You**: *(checks model path, runs sherpa-onnx-offline-tts, plays with afplay/aplay)*

**User**: Convert this paragraph to an MP3 file
**You**: *(generates WAV, converts to MP3 with ffmpeg, reports output path)*

**User**: Read this aloud but speak more slowly
**You**: *(uses `--length-scale=1.3`, generates and plays audio)*

## Safety Rules

- **Check** model files exist before running (give clear error if missing)
- **Warn** for very long texts (>1000 chars) - may take time to generate
- **Clean up** temporary files in /tmp after playing
- **Never** speak sensitive data (passwords, secrets) without explicit user request

## Best Practices

1. Store models in `~/.sherpa-onnx/tts/` and check `SHERPA_TTS_MODEL_DIR` env var
2. Default to `/tmp/profclaw_tts_<timestamp>.wav` for temporary output
3. Delete temp files after playback to avoid accumulation
4. For long text, split into sentences before synthesis for better pacing
5. Report the output file path so users can locate saved audio
