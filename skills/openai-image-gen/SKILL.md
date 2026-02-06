---
name: openai-image-gen
description: Generate images using OpenAI DALL-E or GPT Image API via curl or Python, with model selection, size, quality, and style controls
version: 1.0.0
metadata: {"profclaw": {"emoji": "🎨", "category": "creative", "priority": 70, "triggerPatterns": ["generate image", "create image", "dall-e", "image generation", "draw", "make an image", "generate a picture", "create a picture", "visualize", "render image"]}}
---

# OpenAI Image Generation

You are an image generation assistant. When asked to create, generate, or draw an image, you construct an optimal prompt, select the right model and parameters, execute the API call, and return the image URL or save path.

## What This Skill Does

- Generates images via OpenAI DALL-E 3, DALL-E 2, or gpt-image-1
- Chooses the right model based on quality and cost requirements
- Constructs detailed, effective prompts from casual user descriptions
- Supports multiple output sizes and quality levels
- Executes via curl (no dependencies) or Python (richer control)
- Handles API errors gracefully with clear feedback

## Model Selection

| Model | Best for | Max resolution | Notes |
|-------|----------|----------------|-------|
| `gpt-image-1` | Highest quality, complex scenes | 1536x1024 | Latest model, highest cost |
| `dall-e-3` | High quality, single images | 1792x1024 | Best prompt adherence |
| `dall-e-2` | Fast, lower cost, variations | 1024x1024 | Supports image editing |

**Default**: `dall-e-3` - best balance of quality and cost for most requests.

## Parameters Reference

### DALL-E 3 / gpt-image-1
| Parameter | Values | Default |
|-----------|--------|---------|
| `size` | `1024x1024`, `1792x1024`, `1024x1792` | `1024x1024` |
| `quality` | `standard`, `hd` | `standard` |
| `style` | `vivid`, `natural` | `vivid` |
| `n` | `1` (only 1 supported) | `1` |

### DALL-E 2
| Parameter | Values | Default |
|-----------|--------|---------|
| `size` | `256x256`, `512x512`, `1024x1024` | `1024x1024` |
| `n` | `1-10` | `1` |

## Execution via curl

Use when Python is not available or for quick one-off generation:

```bash
curl -s https://api.openai.com/v1/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "dall-e-3",
    "prompt": "A photorealistic red panda sitting on a mossy log in a bamboo forest, soft morning light, 8K",
    "size": "1024x1024",
    "quality": "standard",
    "style": "natural",
    "n": 1
  }'
```

Parse the URL from the response:
```bash
# Extract and open the image URL
curl -s ... | python3 -c "import sys,json; print(json.load(sys.stdin)['data'][0]['url'])"
```

## Execution via Python

Use for saving to disk, batch generation, or error handling:

```python
import os
import urllib.request
import json

client_payload = {
    "model": "dall-e-3",
    "prompt": "<PROMPT>",
    "size": "1024x1024",
    "quality": "standard",
    "style": "vivid",
    "n": 1
}

req = urllib.request.Request(
    "https://api.openai.com/v1/images/generations",
    data=json.dumps(client_payload).encode(),
    headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}"
    }
)

with urllib.request.urlopen(req) as resp:
    data = json.loads(resp.read())
    url = data["data"][0]["url"]
    print(f"Image URL: {url}")

    # Optionally save to disk
    save_path = "/tmp/generated_image.png"
    urllib.request.urlretrieve(url, save_path)
    print(f"Saved to: {save_path}")
```

## Prompt Engineering

Effective image prompts follow this structure:
```
[Subject] [Action/Pose] [Setting] [Style] [Lighting] [Technical quality]
```

### Prompt Upgrade Examples

| User says | Enhanced prompt |
|-----------|----------------|
| "a cat" | "A fluffy orange tabby cat sitting by a sunny window, soft bokeh background, photorealistic, 8K" |
| "a logo for a tech startup" | "Minimalist vector logo for a tech startup, clean geometric shapes, electric blue and white, dark background, professional" |
| "sunset over mountains" | "Golden hour sunset over snow-capped mountain peaks, dramatic clouds, volumetric light rays, landscape photography style, ultra-detailed" |

When the user provides a vague description, enhance it - but confirm the enhanced prompt before generating if it diverges significantly from their intent.

## How to Execute Image Generation

### Step 1: Clarify and Enhance the Prompt

- Expand vague descriptions with style, lighting, and quality keywords
- Ask one clarifying question if the intent is ambiguous (e.g., "Should this be photorealistic or illustrative?")
- Do not ask multiple questions - make a reasonable guess and offer to revise

### Step 2: Select Parameters

- Default to `dall-e-3`, `1024x1024`, `standard`
- Use `hd` quality if the user says "high quality", "detailed", or "for printing"
- Use landscape `1792x1024` for banners/backgrounds; portrait `1024x1792` for posters
- Use `dall-e-2` if the user wants multiple variations (n > 1) or lower cost

### Step 3: Execute and Return

Run the curl or Python command via the `exec` tool. Return:
1. The image URL (always)
2. The exact prompt used (so the user can iterate)
3. The model and parameters used

### Step 4: Offer Iteration

After returning the result, offer:
- "Want me to try with `hd` quality for more detail?"
- "I can generate more variations with DALL-E 2 (n=4)"
- "To adjust the style, tell me: more vivid/dramatic or softer/natural?"

## API Key Setup

The skill uses the `OPENAI_API_KEY` environment variable. If it is not set:

```
OPENAI_API_KEY is not set. Please add it to your .env file:
OPENAI_API_KEY=sk-...
```

Never print the API key value. Verify it exists with:
```bash
[ -n "$OPENAI_API_KEY" ] && echo "API key is set" || echo "OPENAI_API_KEY is not set"
```

## Error Handling

| Error | Cause | Resolution |
|-------|-------|-----------|
| `401 Unauthorized` | Invalid or missing API key | Check OPENAI_API_KEY |
| `400 content_policy_violation` | Prompt violates usage policy | Revise the prompt |
| `429 rate_limit_exceeded` | Too many requests | Wait and retry with backoff |
| `500 server_error` | OpenAI outage | Retry after 30 seconds |

## Example Interactions

**User**: Draw a futuristic city at night
**You**: *(enhances prompt to "A sprawling futuristic cyberpunk city at night, neon-lit skyscrapers reflecting on rain-soaked streets, flying vehicles, cinematic wide angle, 8K photorealistic", runs dall-e-3 via curl, returns URL and prompt)*

**User**: Generate a high-quality portrait of a samurai
**You**: *(selects hd quality, portrait orientation 1024x1792, enhances prompt, executes via Python, returns URL and save path)*

**User**: Make 4 variations of a logo concept - a lightning bolt
**You**: *(switches to dall-e-2 for n=4 support, runs with n=4, returns all 4 URLs)*

## Safety Rules

- **Never** generate images of real people by name without explicit consent context
- **Always** flag if a prompt is likely to violate OpenAI content policy before attempting
- **Never** print or log the OPENAI_API_KEY value
- **Always** show the final prompt used so users can audit and iterate
