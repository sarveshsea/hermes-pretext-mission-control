# Changelog

## 2026-04-30 - Improvement Loop And Dedicated Publish Repo

- Added an autonomous improvement loop that records dashboard improvement events, appends `CHANGELOG.md`, and mirrors the trail to Obsidian.
- Added live `IMPROVEMENT_LOOP` status to the Pretext canvas so Sarvesh can see whether Hermes is only checking or actually producing improvement records.
- Prepared publishing for the dedicated `sarveshsea/hermes-pretext-mission-control` repository instead of the inherited home-level Labor Budgeting remote.

## 2026-04-30 - Changelog And Publish Guardrails

- Added a real changelog source so dashboard fixes and upgrades are visible in Pretext.
- Added GitHub publishing guardrail: Pretext must not push through the accidental home-level Labor Budgeting remote.
- Verification: changelog parser test added and passing.

## 2026-04-30 - Pretext-Rendered Communication Docks

- Reworked the `@ LOCAL_CONSOLE` and `$ RUN_REQUEST` composers so visible language is rendered through Pretext canvas components.
- Native HTML inputs remain only as transparent typing/click/accessibility plumbing.
- Verification: composer model tests added and `npm run check` passed.

## 2026-04-30 - Local Console Channel

- Added dashboard-originated local messages as an equal Sarvesh-to-Hermes instruction channel alongside Telegram.
- Messages are stored locally and mirrored to Obsidian at `Agent/Review Queues/Local Console.md`.
- Verification: local message API test added and smoke-tested against the running server.

## 2026-04-30 - Observable Work Trace

- Added Pretext `WORK_TRACE` with observable `OBSERVE`, `ASSESS`, `DECIDE`, `NEXT`, and `GUARD` lines.
- Kept trace at the operational summary level rather than exposing hidden chain-of-thought.
- Verification: console model tests added and `npm run check` passed.

## 2026-04-30 - ASCII Pretext Console

- Removed duplicate white dashboard cards and moved status, node labels, run history, local messages, and safety state into the Pretext canvas.
- Reduced rounded-card styling in favor of a sharper ASCII console surface.
- Verification: full TypeScript, test, and build pass.

## 2026-04-30 - Builder Loop And Jarvis Mode

- Added a local builder heartbeat that auto-runs the safe `npm run check` command inside the Pretext project only.
- Kept hard blocks on arbitrary shell, installs, deletes, pushes, deploys, spending, secrets, and external mutations.
- Verification: builder loop tests added and live heartbeat confirmed.

## 2026-04-30 - Initial Mission Control

- Created the Vite, React, TypeScript, Node API, and `@chenglou/pretext@0.0.6` localhost dashboard.
- Added APIs for status, review queues, projects, learnings, run requests, design references, and dashboard payload.
- Saved Antimetal and Refero style references into Obsidian for Hermes memory.
