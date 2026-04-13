# Changelog

All notable changes to this project will be documented in this file.

## [2.2.0](https://github.com/profclaw/profclaw/compare/v2.1.0...v2.2.0) (2026-04-13)


### Features

* pico auth bypass, docs overhaul, issue templates, quickstart guide ([#32](https://github.com/profclaw/profclaw/issues/32)) ([d80b7ac](https://github.com/profclaw/profclaw/commit/d80b7ac6b63a72cf163791138c99c13baca8ab39))
* token optimization, Qwen 3 support, tool routing ([#30](https://github.com/profclaw/profclaw/issues/30)) ([6a3d2bd](https://github.com/profclaw/profclaw/commit/6a3d2bd91fd5b72514e5170a29d5a30e0548f315))


### Bug Fixes

* add missing @tiptap/core and @tiptap/suggestion to ui deps ([557abe1](https://github.com/profclaw/profclaw/commit/557abe109fe1f6ff71c1444fa1e53f93a6d24820))

## [2.1.0](https://github.com/profclaw/profclaw/compare/v2.0.0...v2.1.0) (2026-04-11)


### Features

* engine hardening, Ink TUI, launch-ready enhancements ([#21](https://github.com/profclaw/profclaw/issues/21)) ([7bb38cf](https://github.com/profclaw/profclaw/commit/7bb38cf4006a2c68ec3c7cda70e8808964654c48))

## [2.0.0](https://github.com/profclaw/profclaw/releases/tag/v2.0.0) (2026-03-14)

Initial public beta release.

### Features

* **35 AI providers** - Anthropic, OpenAI, Google, Groq, Ollama, DeepSeek, Bedrock, and more
* **22 chat channels** - Slack, Discord, Telegram, WhatsApp, iMessage, Matrix, Teams, and 15 more
* **72 built-in tools** - file ops, git, browser automation, cron, web search, canvas, voice
* **50 skills** - coding agent, GitHub issues, Notion, Obsidian, image gen, and more
* **3 deployment modes** - pico (~140MB), mini (~145MB), pro (full features)
* **MCP server** - native Model Context Protocol support (stdio + SSE)
* **Voice I/O** - STT (Whisper) + TTS (ElevenLabs/OpenAI/system) + Talk Mode
* **Plugin SDK** - build and share third-party plugins via npm
* **Mode-aware routing** - API endpoints, tools, and capabilities gated by deployment mode
* **In-memory queue** - BullMQ-compatible task queue without Redis for pico/mini modes
* **Cost tracking** - per-token budget management with alerts at 50/80/100%
* **Project management** - tickets, Kanban, sprints, burndown charts, GitHub/Jira/Linear sync

### Chat Channels

Slack, Discord, Telegram, WhatsApp, WebChat, Matrix, Google Chat, Microsoft Teams, iMessage, Signal, IRC, LINE, Mattermost, DingTalk, WeCom, Feishu/Lark, QQ, Nostr, Twitch, Zalo, Nextcloud Talk, Synology Chat

### Integrations

* GitHub (webhooks, OAuth, issue sync, PR automation)
* Jira (webhooks, OAuth, issue sync, transitions)
* Linear (webhooks, OAuth, issue sync)
