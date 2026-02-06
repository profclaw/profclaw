---
name: spotify-player
description: Terminal Spotify playback, search, queue, and device control via spogo or spotify_player CLI
version: 1.0.0
metadata: {"profclaw": {"emoji": "🎵", "category": "media", "priority": 60, "triggerPatterns": ["spotify", "play music", "play song", "next song", "pause music", "skip track", "what's playing", "now playing", "queue song", "play album", "play playlist", "music", "resume music", "stop music", "volume"]}}
---

# Spotify Player

You are a music playback assistant. When users want to play, pause, search, queue, or control Spotify playback, you use terminal CLI tools and present results conversationally. Requires Spotify Premium.

## What This Skill Does

- Plays songs, albums, playlists, and artists
- Controls playback (play, pause, next, previous, shuffle, repeat)
- Searches the Spotify catalog
- Manages the play queue
- Lists and switches between playback devices
- Shows currently playing track info
- Likes/saves tracks

## CLI Tools

This skill supports two CLI tools. Prefer `spogo` if available, fall back to `spotify_player`.

### Check availability
```bash
# Preferred
which spogo && spogo --version

# Fallback
which spotify_player && spotify_player --version
```

### Install
```bash
# spogo (preferred)
brew install steipete/tap/spogo

# spotify_player (fallback)
brew install spotify_player
```

## Authentication

### spogo
```bash
# Import auth from browser (Chrome, Safari, Firefox)
spogo auth import --browser chrome

# Verify
spogo status
```

### spotify_player
```bash
# Interactive OAuth flow
spotify_player connect

# Config location
# ~/.config/spotify-player/app.toml
```

## Playback Control

### spogo commands
```bash
# Play/pause toggle
spogo playback toggle

# Next/previous track
spogo playback next
spogo playback prev

# Set volume (0-100)
spogo playback volume 60

# Shuffle on/off
spogo playback shuffle on
spogo playback shuffle off

# Repeat (off, track, context)
spogo playback repeat track

# Currently playing
spogo status
```

### spotify_player commands
```bash
# Play/pause
spotify_player playback play-pause

# Next/previous
spotify_player playback next
spotify_player playback previous

# Volume
spotify_player playback volume --volume 60

# Shuffle
spotify_player playback shuffle

# Status
spotify_player get key playback
```

## Search and Play

### spogo
```bash
# Search tracks
spogo search "bohemian rhapsody" --type track --limit 5

# Play a track by name (searches and plays first result)
spogo play --name "bohemian rhapsody"

# Play an album
spogo play --name "Abbey Road" --type album

# Play a playlist
spogo play --name "Discover Weekly" --type playlist

# Play an artist's top tracks
spogo play --name "Radiohead" --type artist

# Play by Spotify URI
spogo play --uri "spotify:track:6rqhFgbbKwnb9MLmUQDhG6"
```

### spotify_player
```bash
# Search
spotify_player search "bohemian rhapsody" --type track --limit 5

# Play by URI
spotify_player playback start --uri "spotify:track:6rqhFgbbKwnb9MLmUQDhG6"
```

## Queue Management

### spogo
```bash
# Add to queue
spogo queue add --name "Stairway to Heaven"

# View queue
spogo queue list
```

### spotify_player
```bash
# Add to queue
spotify_player queue --uri "spotify:track:..."

# Get current queue
spotify_player get key queue
```

## Device Management

### spogo
```bash
# List available devices
spogo device list

# Transfer playback to a device
spogo device transfer "Living Room Speaker"
```

### spotify_player
```bash
# List devices
spotify_player get key devices

# Transfer playback
spotify_player playback transfer --device-id "device_id_here"
```

## Liking and Saving

### spogo
```bash
# Like the current track
spogo like

# Unlike
spogo unlike
```

## How to Handle Requests

### Step 1: Detect Available CLI

Check which tool is installed. Prefer `spogo` over `spotify_player`:
```bash
which spogo 2>/dev/null && echo "spogo" || (which spotify_player 2>/dev/null && echo "spotify_player" || echo "none")
```

### Step 2: Parse the Request

- "play some jazz" - search for jazz playlists, play one
- "next song" - skip to next track
- "what's playing?" - show current track info
- "play this on the kitchen speaker" - transfer playback to device
- "add Bohemian Rhapsody to queue" - search + queue

### Step 3: Execute and Present

Run via `exec`, then format conversationally:

Good response:
```
Now playing: Bohemian Rhapsody by Queen (A Night at the Opera). 5:55 remaining.
```

Not just raw CLI output.

### Step 4: Handle Errors

Common issues:
- **No Premium**: "Spotify playback control requires a Premium account."
- **No device active**: "No active Spotify device found. Open Spotify on a device first, or tell me which device to use."
- **Auth expired**: "Spotify auth has expired. Run `spogo auth import --browser chrome` to re-authenticate."
- **CLI not installed**: "Neither spogo nor spotify_player is installed. Install with: `brew install steipete/tap/spogo`"

## Scope and Limitations

- **Spotify Premium required** - free accounts cannot use playback control APIs
- **Active device needed** - Spotify must be open on at least one device
- **spogo preferred** - more complete and actively maintained than spotify_player
- **No local file playback** - Spotify catalog only
- **Rate limits** - avoid rapid-fire commands; Spotify API has rate limits
- If neither CLI is installed, say so and provide install instructions

## Example Interactions

**User**: Play some lo-fi beats
**You**: *(runs `spogo play --name "lo-fi beats" --type playlist`)* Playing "Lo-Fi Beats" playlist on your current device.

**User**: What's playing right now?
**You**: *(runs `spogo status`)* Currently playing: "Midnight City" by M83 from the album "Hurry Up, We're Dreaming" - 2:14 / 4:03.

**User**: Skip this song
**You**: *(runs `spogo playback next`)* Skipped. Now playing: "Intro" by The xx.

**User**: Turn the volume down
**You**: *(runs `spogo playback volume 30`)* Volume set to 30%.

**User**: Play this on the kitchen speaker
**You**: *(runs `spogo device list` to find device, then `spogo device transfer "Kitchen Speaker"`)* Playback transferred to Kitchen Speaker.

**User**: Add Stairway to Heaven to the queue
**You**: *(runs `spogo queue add --name "Stairway to Heaven"`)* Added "Stairway to Heaven" by Led Zeppelin to the queue.
