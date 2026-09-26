# SentiNEL — Agentic Software Testing System

Black-box, agent-grade QA for the **Live Incident Response** product (the extended
FlytBase cockpit). SentiNEL tests the running product the way a responder would —
through real browsers, judging behaviour by meaning — and returns reproducible
evidence: a screen recording, screenshots and a check log for every scenario.

It never reads product source code and never runs unit tests.

## Architecture

| Part | Role |
|---|---|
| `src/runner.ts` | Scenario lifecycle: recorded browser contexts (one per human in the story), screenshots, console/page-error capture, structured checks and issues. |
| `src/scenarios.ts` | The 11 evaluation scenarios (auth gate, multi-user join, presence, chat, drone workflow, telemetry freshness, video liveness, phone layout, API security, audit history, shared map). |
| `src/observer.ts` | Independent socket.io listener on the simulator = ground truth. UI claims are cross-checked against what the devices actually published. |
| `src/model.ts` | Vision-language judge over any OpenAI-compatible endpoint (NVIDIA NIM / AI Grants GPT / Gemini-compatible). Rate-limit aware; optional. |
| `src/mutations.ts` | Mutation harness: applies the brief's example mutations to the served app from outside (route interception / injected CSS / JS rewrite) and requires the paired detector to catch each one — plus a clean-build false-positive control. |
| `src/report.ts` | Generates `evaluation/EVALUATION.md` (system design + numbered scenarios with video links) and `results.json`. |

## Run it

```bash
# product must be running (see repo README); then:
npm install
npm test            # runs all scenarios + mutation validation, writes evaluation/

# with a vision judge (any OpenAI-compatible endpoint):
JUDGE_API_KEY=nvapi-… JUDGE_BASE_URL=https://integrate.api.nvidia.com/v1 \
JUDGE_MODEL=meta/llama-3.2-90b-vision-instruct npm test
```

Outputs land in `evaluation/`:

```
evaluation/
├── EVALUATION.md          the submission write-up
├── results.json           raw machine-readable results
└── evidence/<scenario>/   screen recordings (.webm + .mp4), screenshots
```
