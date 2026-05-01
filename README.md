# Hermes Pretext Mission Control

Localhost-only dashboard for Hermes status, Obsidian review queues, project radar, learnings, and locally approved run requests.

## Commands

```bash
npm run dev
npm run typecheck
npm test
npm run build
npm run check
```

The development server binds to `127.0.0.1` by default. Do not expose it through Tailscale or a public interface until an auth and redaction review is complete.

## Safety

- Writes are scoped to this project and Obsidian Agent notes.
- The dashboard API excludes `.env*`, secrets, tokens, keys, `.git`, `node_modules`, build outputs, and large binaries.
- Telegram may create run requests, but local browser approval is required before any command executes.
- Allowed commands are limited to this project cwd: `npm run dev`, `npm run build`, `npm test`, `npm run typecheck`, and `npm run check`.

## Design

Active style contract: Antimetal.

Reference notes:

- `/Users/sarveshchidambaram/Documents/Obsidian/Sarvesh Brain/Agent/Context/Style References/Antimetal Style Reference.md`
- `/Users/sarveshchidambaram/Documents/Obsidian/Sarvesh Brain/Agent/Context/Style References/Refero Styles Reference.md`

<!-- smoke -->
NLReviewing specific rejection feedback for the draft audit document.
Reviewing specific rejection feedback for the draft audit document.
Reviewing specific rejection feedback for the draft audit document.
Reviewing rejection feedback for audit document...
