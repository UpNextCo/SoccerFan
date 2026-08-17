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

export const PLAYABLE_MODES = [
  'football_bingo',
  'one_more',
  'draft_master',
  'football_golf',
  'club_chain',
  'target_man',
  'last_man_standing',
  'back_yourself',
] as const

export type PlayableMode = (typeof PLAYABLE_MODES)[number]
export type GenerationRunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'completed_with_failures'
export type GenerationItemStatus = 'queued' | 'running' | 'succeeded' | 'skipped' | 'failed'

export type MonthGenerationRun = {
  id: string
  yearMonth: string
  requestedModes: PlayableMode[]
  modeScope: string
  status: GenerationRunStatus
  totalCount: number
  completedCount: number
  failedCount: number
  skippedCount: number
  succeededCount: number
  requestedBy: string
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  updatedAt: string
}

export type MonthGenerationItem = {
  id: string
  runId: string
  date: string
  modeId: PlayableMode
  status: GenerationItemStatus
  attempts: number
  error: string | null
  nextAttemptAt: string
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  updatedAt: string
}

export type MonthGenerationRunDetail = MonthGenerationRun & {
  items: MonthGenerationItem[]
}

export type StartMonthGenerationResult = MonthGenerationRunDetail & {
  created: boolean
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

export type TargetManCategoryOption = {
  id: string
  label: string
  valueNoun: string
  offNoun: string
  unit: 'eur_m' | null
  round: number
  minimumPlayerValue: number
  suggestedTarget: number
}

export type OpsMediaUpload = {
  id: string
  url: string
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
  size: number
  filename?: string
}

export type GolfRarity = 'common' | 'uncommon' | 'rare' | 'ultraRare'

export type GolfTowerRule = {
  validIds?: string[]
  label?: string
  nationality?: string
  nonEuropean?: true
  position?: 'Goalkeeper' | 'Defender'
  leaguePlayed?: string
  leaguesPlayed?: string[]
  playedFor?: string[]
  minPlApps?: number
  minPlAssists?: number
  minPlGoals?: number
  minPlYellowCards?: number
  minPlCleanSheets?: number
  uclWinner?: true
  minUclGoals?: number
  minUclApps?: number
  minPeakValueEur?: number
  minRecordFeeEur?: number
  seasonStat?: {
    leagueId: number
    season: number
    metric: 'goals' | 'assists' | 'appearances'
    minimum: number
  }
  clubSeason?: { club: string; season: number }
  managedBy?: string
  directTransfer?: { fromClub: string; toClub: string }
  finalAppearance?: {
    competition: 'Champions League' | 'World Cup' | 'Euro'
    season?: number
    scored?: true
    won?: true
  }
  worldCupScorerYear?: number
  minCareerHattricks?: number
  minUclKnockoutGoals?: number
}

export type GolfAnswer = {
  id: string
  name: string
  aliases: string[]
  rarity: GolfRarity
  headshotUrl?: string
}

export type AuthoredGolfHole = {
  id: string
  holeNumber: number
  par: 2 | 3 | 4
  target: number
  prompt: string
  category: string
  answers: GolfAnswer[]
  hints: string[]
  rule?: GolfTowerRule
  templateId?: string
}

export type AdminGolfTemplate = {
  id: string
  prompt: string
  rule: GolfTowerRule
  ruleSignature: string
  category: string
  tier: string
  difficulty: number
  validAnswers: number
  sampleAnswers: string[]
  usedCount: number
  lastUsedDate: string | null
}

export type GolfRuleCounts = {
  total: number
  nameable: number
  duplicateNamesRemoved: number
  rarity: Record<GolfRarity, number>
}

export type GolfRuleEvaluation = {
  prompt: string
  rule: GolfTowerRule
  category: string
  answers: GolfAnswer[]
  hints: string[]
  counts: GolfRuleCounts
  qualityWarnings: string[]
  suggestedPar: 2 | 3 | 4
  suggestedTarget: number
}

export type GeneratedGolfHole = {
  hole: AuthoredGolfHole
  evaluation: GolfRuleEvaluation
}

export type GeneratedGolfHoleFromTemplate = GeneratedGolfHole & {
  template: AdminGolfTemplate
}

export type GolfAnswerSetValidation =
  | {
      valid: true
      warning: string
    }
  | {
      valid: boolean
      expectedCount: number
      storedCount: number
      missingAnswerIds: string[]
      staleAnswerIds: string[]
      evaluation: GolfRuleEvaluation
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
  startMonthGeneration: (yearMonth: string, modes?: PlayableMode[]) =>
    request<StartMonthGenerationResult>('/month-generation/runs', {
      method: 'POST',
      body: JSON.stringify({ yearMonth, modes }),
    }),
  listMonthGenerationRuns: (yearMonth: string) =>
    request<MonthGenerationRun[]>(
      `/month-generation/runs?yearMonth=${encodeURIComponent(yearMonth)}`
    ),
  getMonthGenerationRun: (runId: string) =>
    request<MonthGenerationRunDetail>(
      `/month-generation/runs/${encodeURIComponent(runId)}`
    ),
  retryFailedMonthGenerationItems: (runId: string) =>
    request<MonthGenerationRunDetail>(
      `/month-generation/runs/${encodeURIComponent(runId)}/retry-failed`,
      { method: 'POST' }
    ),
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
  recomputeDraftOptimal: (puzzleJson: unknown) =>
    request<{ puzzleJson: unknown }>('/puzzle/recompute-draft', {
      method: 'POST',
      body: JSON.stringify({ puzzleJson }),
    }),
  draftPlayerValues: (categoryId: string, playerIds: string[]) =>
    request<{ values: Record<string, number> }>('/puzzle/draft-player-values', {
      method: 'POST',
      body: JSON.stringify({ categoryId, playerIds }),
    }),
  recomputeBackYourself: (body: { puzzleJson: unknown; answerJson?: unknown }) =>
    request<{ puzzleJson: unknown; answerJson: unknown }>('/puzzle/recompute-back-yourself', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  recomputeClubChain: (body: { startPlayerId: string; targetPlayerId: string }) =>
    request<{ shortestPathPlayerIds: string[]; shortestPathLength: number }>(
      '/validation/club-chain/recompute',
      {
        method: 'POST',
        body: JSON.stringify(body),
      }
    ),
  recomputeLmsReveal: (body: {
    question: {
      id: string
      type: string
      prompt?: string | null
      subPrompt?: string | null
      options: Array<{ id: string; label: string }>
      presentation?: Record<string, unknown> | null
    }
    answer: {
      questionId: string
      correctOptionId: string
      reveal?: string | null
    }
  }) =>
    request<{
      answer: {
        questionId: string
        correctOptionId: string
        reveal?: string | null
      }
    }>('/puzzle/recompute-lms-reveal', {
      method: 'POST',
      body: JSON.stringify(body),
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
  listTargetManCategories: () =>
    request<TargetManCategoryOption[]>('/validation/target-man/categories'),
  uploadLmsImage: (body: { fileBase64: string; mimeType: string; filename?: string }) =>
    request<OpsMediaUpload>('/media', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  listPlayerPhotoOverrides: (limit = 40) =>
    request<{ players: AdminPlayerPhoto[] }>(
      `/player-photos/overrides?limit=${encodeURIComponent(String(limit))}`
    ),
  getPlayerPhoto: (playerId: string) =>
    request<AdminPlayerPhoto>(`/player-photos/${encodeURIComponent(playerId)}`),
  setPlayerPhoto: (
    playerId: string,
    body: { fileBase64: string; mimeType: string; filename?: string }
  ) =>
    request<AdminPlayerPhoto>(`/player-photos/${encodeURIComponent(playerId)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  clearPlayerPhoto: (playerId: string) =>
    request<AdminPlayerPhoto>(`/player-photos/${encodeURIComponent(playerId)}`, {
      method: 'DELETE',
    }),
  listGolfTemplates: (q = '', limit = 80) =>
    request<AdminGolfTemplate[]>(
      `/validation/golf/templates?q=${encodeURIComponent(q)}&limit=${encodeURIComponent(String(limit))}`
    ),
  previewGolfRule: (body: { prompt: string; rule: GolfTowerRule }) =>
    request<GolfRuleEvaluation>('/validation/golf/preview', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  generateGolfHole: (body: {
    prompt: string
    rule: GolfTowerRule
    holeNumber: number
    holeId?: string
  }) =>
    request<GeneratedGolfHole>('/validation/golf/generate', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  generateGolfHoleFromTemplate: (body: {
    templateId: string
    holeNumber: number
    promptOverride?: string
  }) =>
    request<GeneratedGolfHoleFromTemplate>('/validation/golf/from-template', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  validateGolfHole: (hole: AuthoredGolfHole) =>
    request<GolfAnswerSetValidation>('/validation/golf/validate-hole', {
      method: 'POST',
      body: JSON.stringify({ hole }),
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

export type AdminPlayerPhoto = {
  id: string
  name: string
  club: string
  nationality: string
  position: string
  photoUrl: string | null
  headshotUrl: string | null
  hasCustomPhoto: boolean
}

export type AdminTeamHit = {
  id: number
  name: string
  logoUrl: string
  leagueId: number | null
  country: string | null
}

export type AdminLeagueHit = { id: number; name: string; logoUrl: string }
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
  back_yourself: 'Back Yourself',
}
