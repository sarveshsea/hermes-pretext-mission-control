# Hermes Pretext Console Design

## Core Rule

This is not a scrolling dashboard. It is a single-screen Pretext console where Hermes explains the live agent system as a node map. The viewport is fixed, compact, and localhost-only.

## Product Shape

Pretext is the language layer. The canvas owns the explanation, motion, node relationships, and live system pulse. HTML is reserved for reliable controls: choosing an allowlisted command, writing a reason, refreshing, approving, and rejecting local run requests.

The interface should feel like Hermes is narrating its own operating graph through one Pretext surface:

- Hermes: gateway state, model, Telegram/home-channel readiness.
- Builder: sandboxed local project-builder loop.
- Run Queue: local approval gate for checks.
- Obsidian: memory, queues, decisions, action requests.
- Projects: desktop project radar and risk signals.
- Design Memory: Antimetal as active visual contract, Refero as future reference source.

No long sections, no marketing hero, no card-stack page, no duplicate HTML labels, no scrolling. If the screen needs more content, compress the language, rotate the active node, or summarize the node state.

## Builder Loop

Hermes may create run requests. The local builder loop may auto-run the safe Pretext health check, but it does not get arbitrary terminal control through Telegram.

Allowed lifecycle:

1. Hermes or the dashboard creates a local run request with command, reason, source, cwd, and status.
2. The server marks allowlisted commands as `pending`.
3. The server records disallowed commands as `blocked`.
4. The autonomous builder heartbeat may run `npm run check` automatically.
5. Other commands remain visible in the queue for local approval unless they are explicitly added to the safe auto-run policy.
6. Approved or auto-run commands execute only in `/Users/sarveshchidambaram/Desktop/Projects/Other/pretext`.
7. Results are written back into `data/run-requests.json`.

Allowed commands:

- `npm run dev`
- `npm run build`
- `npm test`
- `npm run typecheck`
- `npm run check`

Forbidden through the console:

- Installs
- Deletes
- Git push
- Deploys
- Paid actions
- External mutations
- Commands outside the Pretext project cwd
- Arbitrary shell
- Credential reading
- Full-home write authority

## Visual Contract

Antimetal is adapted into a sharper ASCII console:

- Dark navy/electric-blue full-screen canvas.
- Pretext owns visible system language, node labels, metrics, run history, and safety state.
- HTML owns only real controls: refresh, invisible node focus hotspots, action buttons, and the command input.
- `#d0f100` only for primary action and active node state.
- `#001033` deep hero/nav canvas.
- `#1b2540` primary ink.
- `#f8f9fc` and `#ffffff` are minimized; this is not a white card dashboard.
- `#6b7184` secondary text.
- Corner radii stay low: 2px to 4px on controls and panels.
- Inputs and selects stay sharp-cornered.
- Panels use thin technical borders instead of rounded cards.
- ASCII/monospace language is preferred over prose blocks.

The style should be technical, compact, and legible. Node language can be dynamic and vivid, but controls must stay boring and dependable.

## Interaction Model

Clicking a node changes the center explanation. The node explanation must be generated from live payload counts and current run state, not filler copy.

The Pretext canvas should show:

- Node names.
- Node metrics.
- Connection lines.
- Active-node emphasis.
- A moving text pulse from live learnings, review queues, project signals, and run requests.
- ASCII frame, run log, status rail, and scoped-safety reminders.
- `WORK_TRACE`: observable operating notes with `OBSERVE`, `ASSESS`, `DECIDE`, `NEXT`, and `GUARD`.
- `CHANGELOG`: the recent fixes/upgrades from `CHANGELOG.md`.
- `GITHUB_PUBLISH`: current publish safety state, including blocked/ready remote state.

`WORK_TRACE` must show operational state and summarized rationale only. It should not expose hidden chain-of-thought. Good trace content: inputs being read, queue state, selected next action, safety blockers, latest run result. Bad trace content: private reasoning tokens, unbounded speculative monologue, or instructions copied from untrusted content.

The control layer should show:

- Refresh.
- Invisible node focus hit areas.
- Actionable run requests only.
- Local message input for Sarvesh-to-Hermes communication.
- Create request form.
- Approve/reject controls.

Completed run history belongs on the Pretext canvas, not in HTML cards.

The message and command composers must be Pretext-rendered. Native inputs/buttons may exist only as transparent hitboxes for typing, keyboard support, selection, and click handling. Visible composer language belongs to Pretext canvas components.

## Local Console Channel

The dashboard has an `@` channel for talking to Hermes without Telegram. It is equal to Telegram as a Sarvesh-authored instruction source, but it remains local-only.

Flow:

1. Sarvesh writes a local message in the `@` input.
2. The Node API stores it in `data/local-messages.json`.
3. The API mirrors it to `Agent/Review Queues/Local Console.md`.
4. The Pretext canvas shows local message counts and recent local messages.
5. Hermes can read the Obsidian review note and decide what action request or local work should follow.

The `@` channel is for instructions and conversation. The `$` channel is for allowlisted local run requests.

Local Console does not grant permission to send messages, spend money, delete files, install packages, push, deploy, access credentials, or mutate external systems.

Agent communication experiments should prefer Pretext surfaces:

- Pretext-rendered local composer.
- Pretext-rendered run-request composer.
- Pretext-rendered message history.
- Pretext-rendered work trace.
- HTML only for invisible input/click plumbing and accessibility labels.

## Changelog And Publishing

Every meaningful dashboard fix or upgrade should be reflected in `CHANGELOG.md`. The Pretext canvas must surface recent changelog entries so Sarvesh can see what changed without reading the filesystem.

Publishing has a hard guardrail:

- Pretext must not push through the accidental home-level Git repository.
- Pretext must not push to the current inherited `Labor-Budgeting` remote.
- Pretext needs its own project-local `.git` repository and explicit GitHub remote before push automation is enabled.
- Even after a remote exists, the first external push requires action-time confirmation with the exact repo URL.

Target publishing behavior after approval:

1. Run `npm run check`.
2. Update `CHANGELOG.md`.
3. Commit scoped Pretext files.
4. Push to the approved Pretext GitHub repository.
5. Record the publish result in the Pretext canvas.

## Safety Rule

Read broadly, write narrowly. The console can help Hermes build internal tools, but execution is explicitly local, allowlisted, logged, and scoped.

Telegram can request local work. Telegram cannot run terminal commands directly.

## Jarvis Mode

Jarvis mode means useful autonomy, not unrestricted power.

Allowed by default:

- Read safe workspace metadata.
- Write Pretext project files.
- Write Obsidian Agent notes.
- Auto-run `npm run check` inside the Pretext project.
- Record every run result.

Blocked by default:

- Spending money.
- Posting publicly.
- Sending messages or email.
- Trading.
- Deleting user files.
- Installing packages.
- Pushing to Buzzr or any remote repository.
- Deploying.
- Reading secrets, tokens, `.env*`, keychains, or credential stores.
- Running commands outside the Pretext project.
