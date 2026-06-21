const API_KEY = process.env.API_FOOTBALL_KEY;
const REQUEST_DELAY_MS = Number(process.env.INGEST_RATE_LIMIT_MS ?? 250);

let apiCallsUsed = 0;

export function getApiCallsUsed(): number {
  return apiCallsUsed;
}

export function resetApiCallsUsed(): void {
  apiCallsUsed = 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchFootballApi(url: string): Promise<unknown> {
  if (!API_KEY) {
    throw new Error('API_FOOTBALL_KEY is not set');
  }

  const res = await fetch(url, {
    headers: { 'x-apisports-key': API_KEY },
  });

  apiCallsUsed += 1;

  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${await res.text()}`);
  }

  await sleep(REQUEST_DELAY_MS);
  return res.json();
}

export function footballApiUrl(path: string): string {
  return `https://v3.football.api-sports.io${path}`;
}
