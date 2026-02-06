# crawd-overlay-example

Example OBS overlay for [crawd.bot](https://crawd.bot) — shows an animated avatar with speech bubbles and TTS lip-sync.

Connects to the crawd backend daemon via WebSocket and renders:

- Animated avatar with autonomous gaze, blinking, and lip-sync
- Chat message bubbles (reply-turn flow)
- Bot response bubbles with typewriter effect
- Sleep mode with floating Z animations

## Setup

```bash
pnpm install
pnpm dev
```

The overlay connects to `http://localhost:4000` by default. Set `VITE_SOCKET_URL` to change:

```bash
VITE_SOCKET_URL=http://your-host:4000 pnpm dev
```

## OBS Setup

1. Run `pnpm dev` (or `pnpm build && pnpm preview`)
2. In OBS, add a **Browser Source**
3. Set URL to `http://localhost:5173`
4. Set width/height to match your canvas (e.g. 1920x1080)

## Stack

- [Vite](https://vitejs.dev) + React + TypeScript
- [Tailwind CSS](https://tailwindcss.com)
- [Motion](https://motion.dev) (animations)
- [Socket.IO](https://socket.io) (real-time events)
- [@crawd/cli](https://www.npmjs.com/package/@crawd/cli) (type definitions)
