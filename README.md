# crawd-overlay-example

Example OBS overlay for [crawd.bot](https://crawd.bot) — shows an animated avatar with speech bubbles and TTS lip-sync.

Connects to the crawd backend via WebSocket and renders:

- Animated avatar with autonomous gaze, blinking, and lip-sync
- Chat message bubbles (reply-turn flow)
- Bot response bubbles with typewriter effect
- Sleep mode with floating Z animations

TTS is generated in the overlay via Next.js server actions — the backend sends text-only events. TTS is entirely optional; without it, bubbles display with a timed delay.

## Setup

```bash
pnpm install
pnpm dev
```

The overlay connects to `http://localhost:4000` by default. Set `NEXT_PUBLIC_SOCKET_URL` in `.env.local` to change:

```env
NEXT_PUBLIC_SOCKET_URL=http://your-host:4000
```

## TTS Configuration

TTS is optional. Copy `.env.local.example` to `.env.local` and configure providers:

```env
# Bot voice (narration, replies)
TTS_BOT_PROVIDER=openai          # openai | elevenlabs | tiktok
TTS_BOT_VOICE=onyx

# Chat voice (reading viewer messages)
TTS_CHAT_PROVIDER=tiktok
TTS_CHAT_VOICE=en_us_002

# Provider API keys (only needed for the providers you use)
OPENAI_API_KEY=sk-...
ELEVENLABS_API_KEY=...
TIKTOK_SESSION_ID=...
```

Omit all `TTS_*` vars for text-only mode (bubbles appear with a timed delay, no audio).

## OBS Setup

1. Run `pnpm dev` (or `pnpm build && pnpm start`)
2. In OBS, add a **Browser Source**
3. Set URL to `http://localhost:3000`
4. Set width/height to match your canvas (e.g. 1920x1080)

## Debug Panel

Press **Ctrl+D** to toggle the debug panel. From there you can:

- Set coordinator status (sleep/idle/vibing/chatting)
- Send talk messages (direct overlay bubble + TTS)
- Send mock chat messages (routed through coordinator)
- Send mock turns (chat + bot reply with TTS)
- Monitor audio amplitude

## Stack

- [Next.js](https://nextjs.org) (App Router) + React 19 + TypeScript
- [Tailwind CSS v4](https://tailwindcss.com)
- [Motion](https://motion.dev) (animations)
- [Socket.IO](https://socket.io) (real-time events via `crawd` package)
- TTS: OpenAI (`gpt-4o-mini-tts`), ElevenLabs (optional dep), TikTok (vendored)
