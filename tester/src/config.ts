import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const config = {
  appUrl: process.env.APP_URL ?? 'http://localhost:5173',
  apiUrl: process.env.API_URL ?? 'http://localhost:4000',
  orgId: 'flytbase',
  outDir: process.env.OUT_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'evaluation'),
  // Vision judge: any OpenAI-compatible chat completions endpoint.
  // NVIDIA NIM: https://integrate.api.nvidia.com/v1 + meta/llama-3.2-90b-vision-instruct (~40 req/min)
  // AI Grants:  https://api.openai.com/v1     + gpt-5.6-luna (heavily rate-limited ~4 req/min)
  judge: {
    baseUrl: process.env.JUDGE_BASE_URL ?? 'https://integrate.api.nvidia.com/v1',
    apiKey: process.env.JUDGE_API_KEY ?? '',
    model: process.env.JUDGE_MODEL ?? 'meta/llama-3.2-90b-vision-instruct',
    minIntervalMs: Number(process.env.JUDGE_MIN_INTERVAL_MS ?? 1700),
  },
  viewport: { width: 1280, height: 720 },
  mobileViewport: { width: 390, height: 844 },
};

export const APP = {
  signin: `${config.appUrl}/signin`,
  incidents: `${config.appUrl}/incidents`,
};
