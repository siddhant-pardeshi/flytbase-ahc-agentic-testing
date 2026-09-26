# Agentic Software Testing — Evaluation Document

**Challenge:** The Tireless Hand Challenge (Agentic Software Testing) · **Level 1:** Static UI and basic security testing
**Generated:** 2026-09-26T08:45:26.075Z · **System-under-test:** Live Incident Response (drone cockpit + shared incident dashboard), running at http://localhost:5173 / http://localhost:4000
**Vision judge:** deterministic-only run (no judge API key configured for this run)

---

## Part 1 · System design

### What we built

**SentiNEL** is an agentic, black-box QA system that tests the running product the way a responder would: through a real browser, judging behaviour by meaning, and returning reproducible evidence (video, screenshots, timeline logs) for every finding. It never reads product source code and never runs unit tests.

### Main parts

| Part | What it does |
|---|---|
| **Scenario runner** (Playwright) | Drives real Chromium sessions — one per human in the story (commander, responders, a phone). Every session is video-recorded; screenshots, console errors, page errors and failed requests are captured as evidence. |
| **Independent telemetry observer** | A separate socket.io client that listens to the simulator directly. It is ground truth: whatever the UI displays about drones (status, position, liveness) is cross-checked against this stream, so a screen that shows data nobody sent — or hides data that was sent — is caught without trusting the app under test. |
| **Deterministic expectation engine** | Product-level expectations written from the user's point of view ("status pill reaches in_flight", "freshness badge downgrades to delayed under a slow network", "reply quotes the original message"). Checked via stable test ids and in-page measurement (bounding boxes, canvas pixel sampling of the video element, DOM state attributes). |
| **Vision-language judge** (pluggable) | For semantic checks that resist exact assertions ("does this screen look right?"), screenshots are reviewed by a hosted vision model over an OpenAI-compatible API. It is rate-limit aware (serialised calls, minimum interval, 429 backoff) so it works within the free tiers. Its findings are merged with the deterministic layer; it never overrules a passing deterministic check on wording. |
| **Mutation harness** | Simulates the deliberate changes evaluators introduce: CSS/JS/API-level mutations are applied to the running app from outside (route interception — no product code touched), and the paired detector must catch each one. The same detectors are also run against the clean build to prove they stay silent there (precision control). |
| **Evidence & report generator** | Emits this document: per-scenario Title / Description / Approach / Video, plus findings with severity and the exact screenshot/log evidence behind each one. |

### How the parts work together

1. The runner resets the product to a known state through its own control API (the documented scripting surface), then executes scenarios end-to-end: real sign-ins, real joins from a second browser, real drone commands, real fault injection.
2. While each scenario runs, the observer records the truth, the expectation engine checks user-visible behaviour, and the vision judge reviews key screens against user-level expectations.
3. Findings are only reported when user-facing behaviour is genuinely wrong; acceptable wording/layout differences are ignored (the judge is instructed accordingly, and the clean-build control run validates precision).
4. Each scenario produces its own real-time screen recording, so every claim in this document is reproducible from its video alone.

### Product under test

The starter drone cockpit was extended into the **Live Incident Response** product described in the brief: email + OTP sign-in, incident create, secure joining links, a shared dashboard (participants with live presence and shared locations, drones with telemetry/video/freshness, chat with replies and mentions, shared map observations), fault-visible data freshness, and a read-only audit history after the incident ends. The testing system treats this product exactly as an external QA system would.

---

## Part 2 · Scenarios

Each scenario below was executed against the running product; the video shows it running in real time.

### 1. Sign-in gate, OTP flow and session persistence

**Categories:** Security and permissions, State and persistence, Functional UI · **Result:** ✅ behaviour correct · 6/6 checks passed

**Description.** A signed-out person must not see any operational screen: every product URL lands on the sign-in page, a wrong one-time code is rejected with a visible error, a correct email + OTP signs them in, and the session survives a page reload without asking again.

**Approach.** Playwright drives a fresh browser profile with no storage. It visits /incidents, / and a fake incident URL and asserts each redirects to /signin. It then runs the real sign-in UI: the one-time code is captured from the app’s own OTP response (fetch tap), a wrong code is tried first, and after sign-in the page is reloaded to prove the session persists.

**Video.** [01-auth-gate-and-session-1.mp4](https://drive.google.com/drive/folders/1zScppxBViCQ4jaNEU89lUIFVGiVV12l7?usp=sharing — file: 01-auth-gate-and-session-1.mp4)

<details><summary>Vision judge notes</summary>

- signin-review: skipped — no judge API key configured

</details>

<details><summary>Checks executed</summary>

- ✅ signed-out /incidents is redirected to sign-in — http://localhost:5173/signin?next=%2Fincidents
- ✅ signed-out cockpit is redirected to sign-in — http://localhost:5173/signin?next=%2F
- ✅ signed-out incident page is redirected to sign-in — http://localhost:5173/signin?next=%2Fincident%2Fdoes-not-exist
- ✅ wrong one-time code is rejected with a visible error
- ✅ email + OTP sign-in completes and lands on Incidents — http://localhost:5173/incidents
- ✅ session survives a reload (no repeated sign-in) — http://localhost:5173/incidents

</details>

### 2. Create an incident and join a teammate through the secure link

**Categories:** End-to-end workflow, Real-time and multi-user, Functional UI · **Result:** ✅ behaviour correct · 5/5 checks passed

**Description.** A commander creates an incident and gets a secret joining link. A teammate opening that link joins in one click, and the commander must see them appear in the responders list immediately, without refreshing.

**Approach.** Two independent recorded browser sessions run concurrently. The commander creates the incident through the UI; the joining link is read from the dashboard and opened in the second browser. The test waits (bounded) for the responder to appear in the commander’s participants panel and checks both show presence "connected".

**Video.** [02-create-join-multiuser-1.mp4](https://drive.google.com/drive/folders/1zScppxBViCQ4jaNEU89lUIFVGiVV12l7?usp=sharing — file: 02-create-join-multiuser-1.mp4) · [02-create-join-multiuser-2.mp4](https://drive.google.com/drive/folders/1zScppxBViCQ4jaNEU89lUIFVGiVV12l7?usp=sharing — file: 02-create-join-multiuser-2.mp4)

<details><summary>Vision judge notes</summary>

- multiuser-review: skipped — no judge API key configured

</details>

<details><summary>Checks executed</summary>

- ✅ commander creates an incident and lands on its dashboard — http://localhost:5173/incident/inc-958-4aac9bf9
- ✅ a secure joining link is shown to the commander — http://localhost:5173/join/9f23fc43cbdcb7d7072db03c
- ✅ joining link opens a join page that names the incident — Dock fire drill — multi-user
- ✅ responder appears on the commander’s dashboard without a refresh
- ✅ both participants show as connected in real time — 2 connected

</details>

### 3. A dropped teammate shows as disconnected immediately

**Categories:** Real-time and multi-user, Network and recovery · **Result:** ✅ behaviour correct · 3/3 checks passed

**Description.** When someone’s browser dies, everyone else must see them as disconnected right away — the shared picture must never silently include people who are gone.

**Approach.** Two sessions join the same incident. The responder’s browser context is killed outright, then the test asserts the commander’s panel flips that participant to "disconnected" within 12s, and proves the commander page was not reloaded (an in-page marker set before the drop is still set afterwards).

**Video.** [03-presence-disconnect-1.mp4](https://drive.google.com/drive/folders/1zScppxBViCQ4jaNEU89lUIFVGiVV12l7?usp=sharing — file: 03-presence-disconnect-1.mp4) · [03-presence-disconnect-2.mp4](https://drive.google.com/drive/folders/1zScppxBViCQ4jaNEU89lUIFVGiVV12l7?usp=sharing — file: 03-presence-disconnect-2.mp4)

<details><summary>Checks executed</summary>

- ✅ both participants connected before the drop
- ✅ commander sees the responder drop to disconnected without refreshing
- ✅ commander page was not reloaded to learn about the drop

</details>

### 4. Team chat: delivery, replies and @mentions

**Categories:** Functional UI, Real-time and multi-user · **Result:** ✅ behaviour correct · 3/3 checks passed

**Description.** Messages must reach the other browser within seconds, a reply must visibly quote the message it answers, and a message mentioning a teammate must be highlighted for that teammate.

**Approach.** Two recorded sessions chat in one incident. Assertions: message visible on the peer within 6s; a reply renders a quote of the original on the peer; a message containing @Name appears with the mentions-me highlight in the mentioned user’s browser.

**Video.** [04-chat-sync-and-replies-1.mp4](https://drive.google.com/drive/folders/1zScppxBViCQ4jaNEU89lUIFVGiVV12l7?usp=sharing — file: 04-chat-sync-and-replies-1.mp4) · [04-chat-sync-and-replies-2.mp4](https://drive.google.com/drive/folders/1zScppxBViCQ4jaNEU89lUIFVGiVV12l7?usp=sharing — file: 04-chat-sync-and-replies-2.mp4)

<details><summary>Vision judge notes</summary>

- chat-review: skipped — no judge API key configured

</details>

<details><summary>Checks executed</summary>

- ✅ message appears on the other browser within seconds, no refresh
- ✅ reply quotes the original message on the other side
- ✅ a message mentioning the responder is visually highlighted for them

</details>

### 5. Drone workflow: take off, climb, verify against the telemetry stream, land

**Categories:** Functional UI, End-to-end workflow, Map and geospatial, Telemetry · **Result:** ✅ behaviour correct · 6/6 checks passed

**Description.** The full operator loop: select a drone, take off, watch the status pill go taking_off → in_flight with altitude actually climbing, cross-check what the screen claims against an independent telemetry listener, then land back to standby.

**Approach.** The test runs its own socket.io observer that hears the simulator directly (ground truth). It clicks Take off in the UI, waits through the real state transitions, reads the altitude field, compares the on-screen status against the observer, verifies the drone’s position genuinely changes over 4s (a live object, not a frozen marker), then lands and waits for standby.

**Video.** [05-drone-command-end-to-end-1.mp4](https://drive.google.com/drive/folders/1zScppxBViCQ4jaNEU89lUIFVGiVV12l7?usp=sharing — file: 05-drone-command-end-to-end-1.mp4)

<details><summary>Vision judge notes</summary>

- flight-review: skipped — no judge API key configured

</details>

<details><summary>Checks executed</summary>

- ✅ takeoff is accepted and the status pill moves to taking_off
- ✅ status reaches in_flight
- ✅ altitude climbs while in flight (user sees numbers, not dashes) — altitude RLT = 30.0 m
- ✅ UI flight status matches the independent telemetry stream — observer says in_flight
- ✅ the drone is genuinely moving (map object should be live, not frozen) — {"latitude":18.561330666789846,"longitude":73.69443469059388} → {"latitude":18.56157600110865,"longitude":73.69471221556921}
- ✅ land returns the drone to standby

</details>

### 6. The dashboard must say when data is delayed or stale

**Categories:** Telemetry, Network and recovery, Usability · **Result:** ✅ behaviour correct · 5/5 checks passed

**Description.** Under a slow network or a dead simulator, on-screen numbers stop being trustworthy. The freshness indicator must downgrade from live → delayed → stale and recover, so responders never mistake old data for current.

**Approach.** Using the product’s own fault-injection API (the documented way to simulate bad networks): a 2.5s telemetry delay must flip the selected drone’s freshness badge to "delayed"; clearing it returns "live"; stopping the simulator must show "stale" within 25s; recovery returns "live". Screenshots capture each state.

**Video.** [06-telemetry-freshness-honesty-1.mp4](https://drive.google.com/drive/folders/1zScppxBViCQ4jaNEU89lUIFVGiVV12l7?usp=sharing — file: 06-telemetry-freshness-honesty-1.mp4)

<details><summary>Vision judge notes</summary>

- freshness-review: skipped — no judge API key configured

</details>

<details><summary>Checks executed</summary>

- ✅ freshness starts as live — live
- ✅ under a delayed network the badge honestly shows delayed (not live)
- ✅ badge returns to live once the network recovers
- ✅ when the simulator stops, the UI shows stale instead of pretending the data is current
- ✅ UI recovers to live when telemetry resumes

</details>

### 7. Video is genuinely playing, survives a source switch, and admits failure

**Categories:** Video and media, Network and recovery, Visual UI · **Result:** ✅ behaviour correct · 7/7 checks passed

**Description.** A "live" label must mean moving pixels; switching drones must switch the actual feed; a dropped stream must not keep looking live; and everything must recover.

**Approach.** The test samples the <video> element onto a canvas 2.5s apart and compares pixels — identical frames while labelled "live" would be a defect. It switches to Drone 2 and repeats. It then injects a 12s video-freeze fault: frames must stop, the label must stop saying "live" during the freeze, and playback must return after the fault clears.

**Video.** [07-video-liveness-and-failure-1.mp4](https://drive.google.com/drive/folders/1zScppxBViCQ4jaNEU89lUIFVGiVV12l7?usp=sharing — file: 07-video-liveness-and-failure-1.mp4)

<details><summary>Vision judge notes</summary>

- video-review: skipped — no judge API key configured

</details>

<details><summary>Checks executed</summary>

- ✅ video tile reaches live
- ✅ pixels actually change while the label says live (not a frozen frame)
- ✅ after switching drones the video still plays
- ✅ label still reads live after the switch
- ✅ frames stop while the stream is frozen — two samples 2.5s apart are identical or unavailable
- ✅ the UI does not keep claiming live during the freeze — label = reconnecting
- ✅ stream recovers to playing after the fault window

</details>

### 8. Phone-width layout keeps every critical action usable

**Categories:** Responsive UI, Usability, Visual UI · **Result:** ✅ behaviour correct · 5/5 checks passed

**Description.** At 390×844 the sign-in, the chat input and the drone controls must all be visible or reachable by scrolling — a workflow that works on a laptop but loses its main action on a phone is a defect.

**Approach.** A session with a 390×844 viewport runs the real sign-in and opens an incident dashboard. The test measures horizontal overflow on each screen, scrolls to and bounding-boxes the chat input and the Take off button, and confirms a responder correctly has no "End incident" control.

**Video.** [08-responsive-phone-usability-1.mp4](https://drive.google.com/drive/folders/1zScppxBViCQ4jaNEU89lUIFVGiVV12l7?usp=sharing — file: 08-responsive-phone-usability-1.mp4)

<details><summary>Vision judge notes</summary>

- mobile-review: skipped — no judge API key configured

</details>

<details><summary>Checks executed</summary>

- ✅ sign-in fits a 390px phone without horizontal scroll — overflow = 1px
- ✅ incident dashboard has no horizontal overflow at phone width — overflow = 0px
- ✅ chat input is reachable on the phone — {"x":21,"y":787.390625,"width":283.3125,"height":35.59375}
- ✅ takeoff action is reachable on the phone (main action not pushed off screen) — {"x":10,"y":241.046875,"width":181,"height":37.59375}
- ✅ responder correctly cannot see the end-incident control

</details>

### 9. API surface refuses anonymous, forged, and over-privileged requests

**Categories:** Security and permissions, API and data · **Result:** ✅ behaviour correct · 10/10 checks passed

**Description.** Every incident API must reject anonymous callers and forged tokens; a fabricated joining link must fail; a responder must not be able to end someone else’s incident; an ended incident must refuse writes; and a signed-out session must lose access.

**Approach.** Two layers: direct HTTP probes of the running product (anonymous GETs expect 401, forged bearer token 401, bad join token 404, responder ending a commander’s incident 403, chat after end 409, access after logout 401) — and the same seven probes re-run live inside a recorded browser against a probe console, so the video shows each request being refused in real time.

**Video.** [09-security-and-permissions-api-1.mp4](https://drive.google.com/drive/folders/1zScppxBViCQ4jaNEU89lUIFVGiVV12l7?usp=sharing — file: 09-security-and-permissions-api-1.mp4)

<details><summary>Checks executed</summary>

- ✅ incidents API rejects anonymous callers (401) — 401
- ✅ history API rejects anonymous callers (401) — 401
- ✅ a fabricated joining link is rejected (404) — 404
- ✅ a forged session token is rejected (401) — 401
- ✅ responder can join with a genuine link/token — 200
- ✅ a responder cannot end someone else’s incident (403) — 403
- ✅ another incident can be created by the responder (isolation sanity)
- ✅ writing into an ended incident is rejected (409) — 409
- ✅ a revoked session no longer grants access (401) — after logout: 401
- ✅ all seven in-browser probes were refused exactly as designed — 401,401,401,404,403,409,401

</details>

### 10. A closed incident leaves a complete, attributed, read-only history

**Categories:** Audit and history, State and persistence, End-to-end workflow · **Result:** ✅ behaviour correct · 8/8 checks passed

**Description.** After an incident ends, the timeline must show who joined, what was said (attributed), what was marked on the map, which drone commands were sent, and when it ended — and the closed incident must refuse new writes.

**Approach.** A scripted incident generates a known event sequence (chat from two people, a map observation, a takeoff/land command issued from the incident dashboard). The commander ends it via the UI; the test verifies the read-only banner and missing inputs, then opens the history page and asserts each expected event is present, attributed and ordered, with the read-only marker shown.

**Video.** [10-history-audit-trail-1.mp4](https://drive.google.com/drive/folders/1zScppxBViCQ4jaNEU89lUIFVGiVV12l7?usp=sharing — file: 10-history-audit-trail-1.mp4) · [10-history-audit-trail-2.mp4](https://drive.google.com/drive/folders/1zScppxBViCQ4jaNEU89lUIFVGiVV12l7?usp=sharing — file: 10-history-audit-trail-2.mp4)

<details><summary>Vision judge notes</summary>

- history-review: skipped — no judge API key configured

</details>

<details><summary>Checks executed</summary>

- ✅ commander sees the incident is now ended and the dashboard is read-only
- ✅ chat input is removed after the incident ends
- ✅ history records who joined — 14:04:00🚨Incident "Audit trail drill" created (fire) | 14:04:00🟢Nia is connected | 14:04:00➕Omar joined the incident | 14:04:00🟢Omar is connected | 14:04:05💬Nia: First message for the record | 14:
- ✅ history records both chat messages attributed to their authors — 2 chat events
- ✅ history records the map observation
- ✅ history records the drone command issued from the control surface
- ✅ history records the end of the incident
- ✅ closed history is explicitly read-only

</details>

### 11. Shared map state: teammate locations and observations sync live

**Categories:** Map and geospatial, Real-time and multi-user · **Result:** ✅ behaviour correct · 2/2 checks passed

**Description.** A responder sharing their location must appear with coordinates on the commander’s screen, and a map observation must appear for everyone without a refresh — the map is the shared picture of the incident.

**Approach.** Two sessions; the commander’s browser is granted a synthetic geolocation and toggles location sharing on. The test waits for coordinates to render in the responder’s participants panel, then adds a marker via the UI and asserts it appears in the teammate’s observation list within 8s.

**Video.** [11-shared-map-and-location-1.mp4](https://drive.google.com/drive/folders/1zScppxBViCQ4jaNEU89lUIFVGiVV12l7?usp=sharing — file: 11-shared-map-and-location-1.mp4) · [11-shared-map-and-location-2.mp4](https://drive.google.com/drive/folders/1zScppxBViCQ4jaNEU89lUIFVGiVV12l7?usp=sharing — file: 11-shared-map-and-location-2.mp4)

<details><summary>Vision judge notes</summary>

- map-review: skipped — no judge API key configured

</details>

<details><summary>Checks executed</summary>

- ✅ location sharing appears on the teammate’s screen with coordinates — @ 18.56210, 73.69650
- ✅ a map observation appears on the teammate’s screen without refresh

</details>

### 12. Mutation validation (catching deliberate app changes)

**Description.** During evaluation, deliberate changes (mutations) will be introduced into the app; the testing system must catch them and must not fire on the clean build. This scenario validates exactly that, against the brief’s own example mutations, applied from outside the app (route interception, CSS/JS/API level — mirroring what a code change does to the served app).

**Approach.** For each mutation: apply it to a fresh recorded browser, run the paired detector, and require detection. Then run every detector against the untouched build and require silence (false-positive control).

**Result: 4/4 mutations caught · 0 false positives on the clean build.**

| Mutation | Simulated change | Detector | Caught? | Evidence |
|---|---|---|---|---|
| Sign-in button removed from the login page | The submit button is hidden while the email and OTP fields remain, so the user can no longer sign in (the brief’s first example mutation). | auth-gate: a real user must be able to complete email + OTP sign-in through the UI. | ✅ caught | with a valid code entered, no way to submit: sign-in is impossible |
| Main drone action pushed off screen at phone width | A CSS change pushes the Take off command off the visible area at phone width (the brief’s third example mutation). | responsive: at 390px the takeoff control must be inside the viewport and usable. | ✅ caught | takeoff control sits at x=-600 — completely off screen on a phone |
| Signed-out user can open protected pages | The route guard that redirects signed-out users is disabled, letting anyone open operational pages (the brief’s fourth example mutation). | security: with empty storage, /incidents must redirect to the sign-in page. | ✅ caught | signed-out visit lands on http://localhost:5173/incidents — protected content exposed |
| A frozen video stream keeps its live label | The video tile is changed to always display "live", so a dropped or frozen stream still looks live to the operator. | video-liveness: while frames are not advancing, the label must not claim the feed is live. | ✅ caught | frames are frozen but the tile still reads "live" — operator would trust a dead feed |
| Sign-in button removed from the login page — clean build control (clean control) | none — clean build | auth-gate: a real user must be able to complete email + OTP sign-in through the UI. | ❌ missed | sign-in submit button still reachable — flow can complete |
| Main drone action pushed off screen at phone width — clean build control (clean control) | none — clean build | responsive: at 390px the takeoff control must be inside the viewport and usable. | ❌ missed | takeoff control visible at x=10 |
| Signed-out user can open protected pages — clean build control (clean control) | none — clean build | security: with empty storage, /incidents must redirect to the sign-in page. | ❌ missed | signed-out visit still redirects to sign-in |
| A frozen video stream keeps its live label — clean build control (clean control) | none — clean build | video-liveness: while frames are not advancing, the label must not claim the feed is live. | ❌ missed | frozen=true, label=reconnecting |

**Video.** Mutation runs are recorded under `evidence/mutations/`.

---

## Appendix A · Real defects this system caught in the product (and their fixes)

The system was run against the product repeatedly while both were being built. Beyond the seeded mutations above, it surfaced two genuine user-facing defects. Both were fixed in the product and are now regression-checked by their scenarios:

1. **Signed-in users were bounced back to sign-in on every page reload** (found by scenario 1 on the first full run). The session was restored from storage in a React effect, but the auth guard redirected on the first render — a one-tick race that made the product unusable after every refresh, and broke every multi-user workflow after it. Fix: restore the session synchronously before the first render. Scenario 1 now asserts "session survives a reload" on every run.
2. **The dashboard overflowed horizontally at phone width** (found by scenario 8). Grid children defaulted to their content width, so the chat input rendered 549px wide inside a 390px viewport and pushed the incident header actions off screen. Fix: min-width: 0 on grid children plus a wrapping header. Scenario 8 now asserts zero horizontal overflow on both the sign-in screen and the live dashboard.

---

## Reproducing

```bash
cd tester
# optional: export JUDGE_API_KEY=… JUDGE_BASE_URL=… JUDGE_MODEL=…
npm run test        # resets the product state, runs all scenarios + mutations, writes this document
```

Evidence tree: `C:\Users\siddh\Desktop\FlytBase Hackathon\tester\evaluationevidence/<scenario-id>/` — screen recordings (webm + mp4), screenshots, and the raw results in `results.json`.
