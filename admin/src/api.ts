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

export type OneMoreMetricCatalogItem = {
  id: string
  title: string
  noun: string
  ladder: number[]
  goalLike: boolean
  eventBased: boolean
}

export type OneMoreMetricCandidate = {
  id: string
  name: string
  position: string
  nationality: string
  prestige: number
  value: number
  birth_year: number | null
  api_football_id: number | null
}

export type OneMoreMetricPreview = {
  metric: OneMoreMetricCatalogItem
  threshold: number
  suggestedThreshold: number
  counts: {
    participating: number
    qualifying: number
    distractors: number
    nearQualifying: number
    nearDistractors: number
    verifiedPairs: number
  }
  samples: {
    qualifying: OneMoreMetricCandidate[]
    distractors: OneMoreMetricCandidate[]
  }
  warnings: string[]
}

export type OneMoreCandidatePair = {
  options: [OneMoreMetricCandidate, OneMoreMetricCandidate]
  qualifierId: string
  verified: true
}

export type OneMoreCandidateResponse = {
  metric: OneMoreMetricCatalogItem
  threshold: number
  pairs: OneMoreCandidatePair[]
  warnings: string[]
}

export type OneMorePlayerMetricValue = {
  playerId: string
  metricId: string
  value: number
}

export type OneMorePairVerification = {
  valid: boolean
  options: Array<{
    playerId: string
    expectedValue?: number
    actualValue: number | null
    qualifies: boolean | null
    valueMatches: boolean
  }>
  errors: string[]
}

export type OneMoreVerificationResponse = {
  valid: boolean
  pairs: OneMorePairVerification[]
}

export type QuestionTemplateStatus = 'draft' | 'active' | 'archived'

export type QuestionTemplate = {
  id: string
  mode: string
  name: string
  prompt: string
  config: Record<string, unknown>
  status: QuestionTemplateStatus
  validationPassCount: number
  validationFailCount: number
  usedCount: number
  lastUsedAt: string | null
  createdAt: string
  updatedAt: string
}

export type QuestionTemplateCreate = {
  mode: string
  name: string
  prompt: string
  config: Record<string, unknown>
  status?: QuestionTemplateStatus
  validationPassCount?: number
  validationFailCount?: number
}

export type QuestionTemplateUpdate = Partial<QuestionTemplateCreate> & {
  usedCount?: number
  lastUsedAt?: string | null
}

export type PuzzleValidationIssue = {
  severity: 'error' | 'warning'
  path: string
  message: string
}

export type PuzzleValidationReport = {
  ok: boolean
  issues: PuzzleValidationIssue[]
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
    request<{ ok: boolean; puzzleJson?: unknown; answerJson?: unknown }>('/puzzle', {
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

  oneMoreMetrics: () =>
    request<OneMoreMetricCatalogItem[]>('/question-engine/metrics'),
  previewOneMoreMetric: (metricId: string, threshold?: number) =>
    request<OneMoreMetricPreview>('/question-engine/metrics/preview', {
      method: 'POST',
      body: JSON.stringify({ metricId, threshold }),
    }),
  generateOneMoreCandidates: (body: {
    metricId: string
    threshold: number
    count?: number
    seed?: string
  }) =>
    request<OneMoreCandidateResponse>('/question-engine/metrics/candidates', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  lookupOneMorePlayerValue: (metricId: string, playerId: string) =>
    request<OneMorePlayerMetricValue>(
      `/question-engine/metrics/${encodeURIComponent(metricId)}/players/${encodeURIComponent(playerId)}`
    ),
  verifyOneMorePairs: (body: {
    metricId: string
    threshold: number
    pairs: Array<[
      { playerId: string; expectedValue?: number },
      { playerId: string; expectedValue?: number },
    ]>
  }) =>
    request<OneMoreVerificationResponse>('/question-engine/metrics/verify', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  listQuestionTemplates: (filters?: { mode?: string; status?: QuestionTemplateStatus }) => {
    const params = new URLSearchParams()
    if (filters?.mode) params.set('mode', filters.mode)
    if (filters?.status) params.set('status', filters.status)
    const query = params.size > 0 ? `?${params.toString()}` : ''
    return request<QuestionTemplate[]>(`/question-engine/templates${query}`)
  },
  getQuestionTemplate: (id: string) =>
    request<QuestionTemplate>(`/question-engine/templates/${encodeURIComponent(id)}`),
  createQuestionTemplate: (body: QuestionTemplateCreate) =>
    request<QuestionTemplate>('/question-engine/templates', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateQuestionTemplate: (id: string, body: QuestionTemplateUpdate) =>
    request<QuestionTemplate>(`/question-engine/templates/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteQuestionTemplate: (id: string) =>
    request<{ deleted: true }>(`/question-engine/templates/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  validatePuzzleDraft: (body: {
    modeId: string
    puzzleJson: unknown
    answerJson: unknown
  }) =>
    request<PuzzleValidationReport>('/validation/validate', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  searchPlayers: (q: string) =>
    request<AdminPlayerHit[]>(`/search/players?q=${encodeURIComponent(q)}`),
  searchTeams: (q: string) =>
    request<AdminTeamHit[]>(`/search/teams?q=${encodeURIComponent(q)}`),
  searchLeagues: (q: string) =>
    request<AdminLeagueHit[]>(`/search/leagues?q=${encodeURIComponent(q)}`),
  searchNationalities: (q: string) =>
    request<AdminNationalityHit[]>(`/search/nationalities?q=${encodeURIComponent(q)}`),
  resolvePlayer: (id: string, kind: 'card' | 'bingo' | 'golf' = 'card') =>
    request<Record<string, unknown>>(
      `/resolve/player/${encodeURIComponent(id)}?kind=${encodeURIComponent(kind)}`
    ),
  resolveTeam: (id: number) =>
    request<AdminTeamResolved>(`/resolve/team/${id}`),
}

export type AdminPlayerHit = {
  id: string
  name: string
  club: string
  league: string
  nationality: string
  position: string
  headshotUrl?: string
  teamLogoUrl?: string
}

export type AdminTeamHit = {
  id: number
  name: string
  logoUrl: string
  leagueId: number | null
  country: string | null
}

export type AdminLeagueHit = { id: number; name: string }
export type AdminNationalityHit = { name: string }

export type AdminTeamResolved = {
  id: number
  name: string
  logoUrl: string
  leagueId: number | null
  leagueName: string | null
  country: string | null
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
