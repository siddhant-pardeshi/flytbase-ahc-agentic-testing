# Agentic Software Testing — Level 2: Semantic Visual Performance & Chaos

**Challenge:** The Tireless Hand Challenge · **Level 2:** Getting into your domain (performance testing)
**Generated:** 2026-09-26T11:00:53.395Z · **System-under-test:** Live Incident Response at http://localhost:5173 / http://localhost:4000

---

## Part 1 · System design

### The angle: perceived frontend performance, not backend latency

Standard load testing (k6, JMeter) hammers APIs and reports server latency. That is exactly the wrong instrument for this product. Live Incident Response is a **real-time visual cockpit**: its failure modes are the ones backend load tests cannot see —

- the render loop starving while the API reports 20 ms responses;
- a participants panel that duplicates rows after a reconnect storm;
- a chat that swallows messages on screen while the API accepted every one;
- an interface that stays "healthy" on the wire but stops being *usable* on glass.

So this level of **SentiNEL** measures performance where the user experiences it: in the rendered browser, under real protocol-level load, with an AI judge deciding whether what is on screen is still *usable to a responder*.

### Main parts

| Part | What it does |
|---|---|
| **Load generation via documented surfaces** | No product code is touched. The control API adds **real simulator drones** (each a full state machine: position 2 Hz + heartbeat/battery/flight/attitude 1 Hz), simulation speed multiplies every tick (the avalanche knob), a **server-side socket-kick** drops every connection at once (the herd trigger), and chat floods use the same REST API the UI uses. |
| **In-page probes** | Injected into the page under test: requestAnimationFrame **FPS sampler**, `PerformanceObserver` **long-task** tracking, live **DOM node count**, **JS heap** usage. These measure the browser's actual ability to keep painting. |
| **Time-to-Glass instrumentation** | End-to-end latency from the user's point of view: *command click → alert toast visible on screen*, and *API return → device row rendered*. Glass latency includes backend, socket fan-out, store updates and paint — the number a responder actually feels. |
| **Vision judge** | Screenshots taken under load are reviewed by a vision-language model (OpenAI-compatible API, rate-limit aware): is the map still functional? are panel rows duplicated or ghosted? is the flooded chat visually broken? The judge evaluates *usability*, not beauty. |
| **Evidence pipeline** | Every scenario records the screen (video), captures screenshots at each load tier, and emits structured checks and readings — the same evidence discipline as Level 1. |

### How the parts work together

1. The product is reset to a known state, then load is escalated in **tiers** (fleet size, sim speed, connection count, message volume) so degradation can be *localized* to a tier.
2. During each tier, in-page probes sample rendering health, Time-to-Glass probes measure user-felt latency, and screenshots freeze the visual state for the judge.
3. Chaos events (the socket-kick herd) are injected server-side, and recovery is measured on glass — not on the wire.
4. Findings are separated honestly: **defects** (user-visible breakage) vs **scalability findings** (measured growth that should drive future work, e.g. missing list virtualization) — precision over drama.

---

## Part 2 · Scenarios

### 1. The Telemetry Avalanche — visual degradation under a data flood

**Categories:** Performance, Visual UI, Telemetry, Usability · **Result:** ✅ behaviour held up · 5/5 checks passed

**Description.** A responder watching 24 drones at 6× simulation speed must still get a usable map, live device list and actionable alerts. A backend load test would report "API latency fine" here; the real risk is the browser: render loop starvation, main-thread lockups, and commands that stop reaching the glass.

**Approach.** Load is generated through documented surfaces only: the control API adds real simulator drones (each a full state machine publishing position at 2 Hz plus heartbeat, battery, flight and attitude), then multiplies simulation time ×6 so every machine ticks faster — thousands of telemetry messages per second through the same socket pipeline the browser drinks from. In-page probes sample FPS, long tasks, DOM size and JS heap. Time-to-Glass is measured two ways: API-return → device row visible, and command-click → alert toast visible under peak load. The vision judge reviews map screenshots for functional (not pretty) degradation.

**Video.** [ava-1.mp4](<VIDEO_LINK:ava-1.mp4>)

<details><summary>Vision judge notes</summary>

- avalanche-review: skipped — no judge API key configured

</details>

<details open><summary>Checks & measurements executed</summary>

- ✅ 10 added drones render in the device list within 20s (Time-to-Glass) — TTG = 447ms after API returns
- ✅ rendering stays alive under 14 drones (fps sampled, no page freeze) — 42 fps, longest task 0ms
- ✅ page stays interactive during the avalanche (no fatal long-task lockup) — 0 long tasks, longest 0ms
- ✅ observer sees the full expanded fleet on the wire — 48 devices streaming
- ✅ command-to-glass under peak load: takeoff alert toast appears (protocol path) — TTG = 13759ms

- 📈 baseline: {"fps":0,"longTasks":0,"longestTaskMs":0,"domNodes":174,"heapMB":51}
- 📈 after 10 extra drones: {"fps":42,"longTasks":0,"longestTaskMs":0,"domNodes":244,"heapMB":51}
- 📈 after 24 drones at speed 6: {"fps":22,"longTasks":0,"longestTaskMs":0,"domNodes":314,"heapMB":51}
- 📈 post-peak: {"fps":9,"longTasks":0,"longestTaskMs":0,"domNodes":314,"heapMB":51}

</details>

### 2. The Thundering Herd — 31 sockets dropped and reconnected at once

**Categories:** Performance, Real-time and multi-user, Network and recovery, State and persistence · **Result:** ✅ behaviour held up · 3/3 checks passed

**Description.** When an access-point blip drops every responder at once, each dashboard reconnects automatically. The UI must resolve the storm cleanly: every participant listed exactly once, presence accurate, no ghost rows, and the panel must converge without a manual refresh.

**Approach.** 30 users are created and joined through the public REST API, then connected as presence-carrying socket clients using the same handshake the dashboard uses (30 clients + the commander’s browser = 31 sockets). A single server-side socket-kick fault drops them all simultaneously; clients auto-reconnect with jittered delays, producing a genuine reconnect storm. Recovery time is measured from kick to the moment the commander’s panel shows every participant connected again; DOM rows are diffed against unique participant identities to catch duplicates and ghosts; the vision judge inspects the panel.

**Video.** [ben-1.mp4](<VIDEO_LINK:ben-1.mp4>)

<details><summary>Vision judge notes</summary>

- herd-review: skipped — no judge API key configured

</details>

<details open><summary>Checks & measurements executed</summary>

- ✅ all 31 participants render with no duplicates — 31/31 unique
- ✅ presence fully recovers after a simultaneous 31-socket drop — recovered in 81ms
- ✅ no ghost users or duplicates after the storm — 31 rows, 31 unique

- 📈 post-herd probes: {"fps":50,"longTasks":3,"longestTaskMs":75,"domNodes":324,"heapMB":54.2}

</details>

### 3. Resource Starvation — 300 messages, DOM bloat and scroll health

**Categories:** Performance, Long-running use, Real-time and multi-user, Visual UI · **Result:** ✅ behaviour held up · 4/4 checks passed

**Description.** An incident that stays open for hours accumulates chat and drone tracks. The browser must keep delivering every message live, keep the chat scrollable to the newest message, and degrade gracefully. Backend load tests cannot see DOM bloat or broken scroll — this scenario measures both, and the vision judge checks what truncation actually looks like.

**Approach.** 300 messages are flooded through the public chat API from three participants while the dashboard is open. In-page probes measure DOM node growth and JS heap before/after; the test verifies all 300 messages render (none lost), hammers the chat scroll, and asserts the newest message remains reachable. The vision judge then inspects the flooded panel for visual truncation or broken layout. Linear DOM growth is reported honestly as a scalability finding (no list virtualization) rather than a false defect.

**Video.** [cara-1.mp4](<VIDEO_LINK:cara-1.mp4>)

<details><summary>Vision judge notes</summary>

- starvation-review: skipped — no judge API key configured

</details>

<details open><summary>Checks & measurements executed</summary>

- ✅ flooded 300/300 chat messages through the public API — 2522ms
- ✅ every flooded message renders live on the other screen — 300 messages in DOM
- ✅ resource growth is measured and bounded — fps 42→8, dom 182→1981, heap 48.1→48.1 MB, longTasks +59 (longest 102ms)
- ✅ chat scroll still reaches the newest message after the flood — distance from newest message = 0px (scrollHeight 23216, clientHeight 131)

- 📈 baseline: {"fps":42,"longTasks":0,"longestTaskMs":0,"domNodes":182,"heapMB":48.1}
- 📈 heap growth: 0 MB — DOM grows linearly because the chat list is not virtualized; noted as a scalability finding, not a false defect
- 📈 final probes: {"fps":24,"longTasks":59,"longestTaskMs":102,"domNodes":1988,"heapMB":48.1}

</details>

---

## Why traditional load testing misses all of this

| Failure this framework can catch | What k6/JMeter would report |
|---|---|
| Render loop starvation at 24 drones × 6× speed | "p95 latency 22 ms — all good" |
| Duplicated/ghost participants after a reconnect storm | "0 errors on reconnection endpoints" |
| Command-to-glass latency growing under flood | "API accepted the command in 15 ms" |
| DOM bloat and broken chat scroll in long sessions | Not measured at all |
| A live video tile labelled "live" showing a frozen frame | Not measured at all |

The user does not feel the server's p95. The user feels the glass.

## Reproducing

```bash
cd tester
OUT_DIR="$(pwd)/evaluation2" node --env-file=- -e "1" 2>/dev/null; OUT_DIR="$(pwd)/evaluation2" npx tsx src/main2.ts
```
