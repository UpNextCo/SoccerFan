export type CellStatus = 'missing' | 'generated' | 'approved' | 'locked'

export type MonthCell = {
  date: string
  modeId: string
  title: string
  status: CellStatus
  snippet: string | null
  version: number | null
  contentHash: string | null
  reviewedAt: string | null
}

export type MonthMatrix = {
  yearMonth: string
  dates: string[]
  modes: string[]
  cells: MonthCell[]
  summary: {
    total: number
    present: number
    missing: number
    locked: number
    approved: number
    generated: number
  }
}

export type PuzzleRow = {
  id: string
  date: string
  modeId: string
  status: string
  puzzleJson: unknown
  answerJson: unknown
  contentHash: string | null
  reviewNote: string | null
  reviewedAt: string | null
  createdAt: string
}

type ApiOk<T> = { success: true; data: T }
type ApiErr = { success: false; error: { message: string; code?: string } }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/admin/api${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  })
  const json = (await res.json()) as ApiOk<T> | ApiErr
  if (!res.ok || !json.success) {
    const msg = !json.success ? json.error.message : res.statusText
    const err = new Error(msg) as Error & { status?: number; code?: string }
    err.status = res.status
    if (!json.success) err.code = json.error.code
    throw err
  }
  return json.data
}

export const api = {
  login: (password: string, name?: string) =>
    request<{ ok: boolean; name: string }>('/login', {
      method: 'POST',
      body: JSON.stringify({ password, name }),
    }),
  logout: () => request<{ ok: boolean }>('/logout', { method: 'POST' }),
  me: () => request<{ name: string }>('/me'),
  month: (yearMonth: string) =>
    request<MonthMatrix>(`/month?yearMonth=${encodeURIComponent(yearMonth)}`),
  generateMonth: (yearMonth: string, modes?: string[], force?: boolean) =>
    request<{
      results: Array<{ date: string; modeId: string; ok: boolean; skipped?: string; error?: string }>
    }>('/month/generate', {
      method: 'POST',
      body: JSON.stringify({ yearMonth, modes, force }),
    }),
  lockMonth: (yearMonth: string, note?: string) =>
    request<{ updated: number }>('/month/lock', {
      method: 'POST',
      body: JSON.stringify({ yearMonth, note }),
    }),
  unlockMonth: (yearMonth: string, note?: string) =>
    request<{ updated: number }>('/month/unlock', {
      method: 'POST',
      body: JSON.stringify({ yearMonth, note }),
    }),
  getPuzzle: (date: string, modeId: string) =>
    request<PuzzleRow>(
      `/puzzle?date=${encodeURIComponent(date)}&modeId=${encodeURIComponent(modeId)}`
    ),
  savePuzzle: (body: {
    date: string
    modeId: string
    puzzleJson: unknown
    answerJson: unknown
    reviewNote?: string
    keepApproved?: boolean
  }) =>
    request<{ ok: boolean }>('/puzzle', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  approvePuzzle: (date: string, modeId: string, note?: string) =>
    request<{ ok: boolean }>('/puzzle/approve', {
      method: 'POST',
      body: JSON.stringify({ date, modeId, note }),
    }),
  lockPuzzle: (date: string, modeId: string, note?: string) =>
    request<{ ok: boolean }>('/puzzle/lock', {
      method: 'POST',
      body: JSON.stringify({ date, modeId, note }),
    }),
  unlockPuzzle: (date: string, modeId: string, note?: string) =>
    request<{ ok: boolean }>('/puzzle/unlock', {
      method: 'POST',
      body: JSON.stringify({ date, modeId, note }),
    }),
  regeneratePuzzle: (date: string, modeId: string, force = true) =>
    request<{ ok: boolean; puzzle: PuzzleRow | null }>('/puzzle/regenerate', {
      method: 'POST',
      body: JSON.stringify({ date, modeId, force }),
    }),
}

export const MODE_LABELS: Record<string, string> = {
  football_bingo: 'Bingo',
  one_more: 'One More',
  draft_master: 'Draft XI',
  football_golf: 'Golf',
  club_chain: 'Club Chain',
  target_man: 'Target Man',
  last_man_standing: 'LMS',
}
