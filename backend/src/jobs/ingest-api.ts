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

function isRetryableFetchError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'EAI_AGAIN') return true;
  return error.message === 'fetch failed';
}

export async function fetchFootballApi(url: string): Promise<unknown> {
  if (!API_KEY) {
    throw new Error('API_FOOTBALL_KEY is not set');
  }

  const maxAttempts = Number(process.env.INGEST_MAX_RETRIES ?? 5);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: { 'x-apisports-key': API_KEY },
      });

      apiCallsUsed += 1;

      if (res.status === 429 || res.status >= 500) {
        const body = await res.text();
        if (attempt < maxAttempts) {
          const backoff = REQUEST_DELAY_MS * attempt * 2;
          console.warn(`  API ${res.status} — retry ${attempt}/${maxAttempts} in ${backoff}ms`);
          await sleep(backoff);
          continue;
        }
        throw new Error(`API error ${res.status}: ${body}`);
      }

      if (!res.ok) {
        throw new Error(`API error ${res.status}: ${await res.text()}`);
      }

      await sleep(REQUEST_DELAY_MS);
      return res.json();
    } catch (error) {
      if (attempt < maxAttempts && isRetryableFetchError(error)) {
        const backoff = REQUEST_DELAY_MS * attempt * 2;
        console.warn(`  Network error — retry ${attempt}/${maxAttempts} in ${backoff}ms`);
        await sleep(backoff);
        continue;
      }
      throw error;
    }
  }

  throw new Error('fetchFootballApi: exhausted retries');
}

export function footballApiUrl(path: string): string {
  return `https://v3.football.api-sports.io${path}`;
}
