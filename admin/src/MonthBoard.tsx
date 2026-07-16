import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import {
  api,
  MODE_LABELS,
  PLAYABLE_MODES,
  type CellStatus,
  type GenerationItemStatus,
  type GenerationRunStatus,
  type MonthCell,
  type MonthGenerationItem,
  type PlayableMode,
} from './api'
import { ConfirmDialog, SectionCard, StatusBadge, ValidationPanel } from './components/AdminUi'
import './month-generation.css'

function defaultYearMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function todayDate(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`
}

type BoardNotice = {
  tone: 'success' | 'error' | 'info'
  title: string
  detail?: string
}

type MonthConfirmation = 'generate' | 'lock' | 'unlock' | null

const ACTIVE_RUN_STATUSES: readonly GenerationRunStatus[] = ['queued', 'running']

function isActiveRun(status: GenerationRunStatus): boolean {
  return ACTIVE_RUN_STATUSES.includes(status)
}

function isPlayableMode(mode: string): mode is PlayableMode {
  return (PLAYABLE_MODES as readonly string[]).includes(mode)
}

function runStatusLabel(status: GenerationRunStatus): string {
  const labels: Record<GenerationRunStatus, string> = {
    queued: 'Waiting to start',
    running: 'In progress',
    completed: 'Complete',
    completed_with_failures: 'Complete with some failures',
  }
  return labels[status]
}

function countItems(items: MonthGenerationItem[], status: GenerationItemStatus): number {
  return items.filter((item) => item.status === status).length
}

export function MonthBoard() {
  const [yearMonth, setYearMonth] = useState(defaultYearMonth)
  const [modeFilter, setModeFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<CellStatus | 'all'>('all')
  const [selectedDate, setSelectedDate] = useState(todayDate)
  const [notice, setNotice] = useState<BoardNotice | null>(null)
  const [preferredRun, setPreferredRun] = useState<{ yearMonth: string; id: string } | null>(null)
  const [confirmation, setConfirmation] = useState<MonthConfirmation>(null)
  const qc = useQueryClient()

  const runsQuery = useQuery({
    queryKey: ['month-generation-runs', yearMonth],
    queryFn: () => api.listMonthGenerationRuns(yearMonth),
    refetchInterval: false,
  })

  const newestActiveRun = runsQuery.data?.find((run) => isActiveRun(run.status))
  const newestRun = runsQuery.data?.[0]
  const displayedRunId =
    newestActiveRun?.id ??
    (preferredRun?.yearMonth === yearMonth ? preferredRun.id : undefined) ??
    newestRun?.id

  const runQuery = useQuery({
    queryKey: ['month-generation-run', displayedRunId],
    queryFn: () => {
      if (!displayedRunId) throw new Error('No generation run selected')
      return api.getMonthGenerationRun(displayedRunId)
    },
    enabled: Boolean(displayedRunId),
    refetchInterval: (query) =>
      query.state.data && isActiveRun(query.state.data.status) ? 2_000 : false,
  })

  const displayedRun = runQuery.data
  const displayedRunYearMonth = displayedRun?.yearMonth
  const displayedRunCompletedCount = displayedRun?.completedCount
  const displayedRunStatus = displayedRun?.status

  const monthQuery = useQuery({
    queryKey: ['month', yearMonth],
    queryFn: () => api.month(yearMonth),
  })

  useEffect(() => {
    if (!displayedRunYearMonth || displayedRunCompletedCount === undefined) return
    void qc.invalidateQueries({ queryKey: ['month', displayedRunYearMonth] })
  }, [displayedRunCompletedCount, displayedRunYearMonth, qc])

  useEffect(() => {
    if (!displayedRunYearMonth || !displayedRunStatus || isActiveRun(displayedRunStatus)) return
    void qc.invalidateQueries({ queryKey: ['month-generation-runs', displayedRunYearMonth] })
  }, [displayedRunStatus, displayedRunYearMonth, qc])

  const startGenerationMut = useMutation({
    mutationFn: () => {
      if (modeFilter === 'all') return api.startMonthGeneration(yearMonth)
      if (!isPlayableMode(modeFilter)) throw new Error('Please select a valid game mode.')
      return api.startMonthGeneration(yearMonth, [modeFilter])
    },
    onSuccess: (data) => {
      setPreferredRun({ yearMonth: data.yearMonth, id: data.id })
      qc.setQueryData(['month-generation-run', data.id], data)
      const scope =
        data.requestedModes.length === PLAYABLE_MODES.length
          ? 'all game modes'
          : data.requestedModes.map((mode) => MODE_LABELS[mode] ?? mode).join(', ')
      setNotice({
        tone: 'info',
        title: data.created ? 'Month generation started' : 'Generation already in progress',
        detail: data.created
          ? 'It will continue safely in the background, even if you leave this page.'
          : `Resuming the existing ${scope} run. Only one generation run can be active for a month.`,
      })
      void qc.invalidateQueries({ queryKey: ['month-generation-runs', yearMonth] })
      void qc.invalidateQueries({ queryKey: ['month', yearMonth] })
    },
    onError: (err) =>
      setNotice({
        tone: 'error',
        title: 'Generation could not be started',
        detail: err instanceof Error ? err.message : 'Please try again.',
      }),
  })

  const retryFailedMut = useMutation({
    mutationFn: () => {
      if (!displayedRunId) throw new Error('No generation run selected')
      return api.retryFailedMonthGenerationItems(displayedRunId)
    },
    onSuccess: (data) => {
      setPreferredRun({ yearMonth: data.yearMonth, id: data.id })
      qc.setQueryData(['month-generation-run', data.id], data)
      setNotice({
        tone: 'info',
        title: 'Failed puzzles queued again',
        detail: 'The retry will continue in the background.',
      })
      void qc.invalidateQueries({ queryKey: ['month-generation-runs', data.yearMonth] })
    },
    onError: (err) =>
      setNotice({
        tone: 'error',
        title: 'Failed puzzles could not be retried',
        detail: err instanceof Error ? err.message : 'Please try again.',
      }),
  })

  const lockMut = useMutation({
    mutationFn: () => api.lockMonth(yearMonth),
    onSuccess: (data) => {
      setNotice({
        tone: 'success',
        title: 'Month locked',
        detail: `${data.updated} puzzles are now protected.`,
      })
      void qc.invalidateQueries({ queryKey: ['month', yearMonth] })
    },
    onError: (err) =>
      setNotice({
        tone: 'error',
        title: 'Month lock failed',
        detail: err instanceof Error ? err.message : 'Please try again.',
      }),
  })

  const unlockMut = useMutation({
    mutationFn: () => api.unlockMonth(yearMonth),
    onSuccess: (data) => {
      setNotice({
        tone: 'success',
        title: 'Month unlocked',
        detail: `${data.updated} rows returned to generated status.`,
      })
      void qc.invalidateQueries({ queryKey: ['month', yearMonth] })
    },
    onError: (err) =>
      setNotice({
        tone: 'error',
        title: 'Month unlock failed',
        detail: err instanceof Error ? err.message : 'Please try again.',
      }),
  })

  const matrix = monthQuery.data
  const modes = useMemo(
    () => (modeFilter === 'all' ? matrix?.modes ?? [] : [modeFilter]),
    [matrix?.modes, modeFilter]
  )

  const cellMap = useMemo(() => {
    const m = new Map<string, MonthCell>()
    for (const c of matrix?.cells ?? []) m.set(`${c.date}|${c.modeId}`, c)
    return m
  }, [matrix?.cells])

  const visibleDates = useMemo(() => {
    if (!matrix) return []
    if (statusFilter === 'all') return matrix.dates
    return matrix.dates.filter((date) =>
      modes.some((modeId) => cellMap.get(`${date}|${modeId}`)?.status === statusFilter)
    )
  }, [cellMap, matrix, modes, statusFilter])

  useEffect(() => {
    if (!matrix || matrix.dates.length === 0) return
    if (visibleDates.includes(selectedDate)) return
    const today = todayDate()
    setSelectedDate(
      visibleDates.includes(today)
        ? today
        : visibleDates[0] ?? matrix.dates[0]!
    )
  }, [matrix, selectedDate, visibleDates])

  const visibleSummary = useMemo(() => {
    const cells =
      matrix?.cells.filter((cell) => modeFilter === 'all' || cell.modeId === modeFilter) ?? []
    return {
      total: cells.length,
      missing: cells.filter((cell) => cell.status === 'missing').length,
      generated: cells.filter((cell) => cell.status === 'generated').length,
      approved: cells.filter((cell) => cell.status === 'approved').length,
      locked: cells.filter((cell) => cell.status === 'locked').length,
    }
  }, [matrix?.cells, modeFilter])

  const runCounts = useMemo(() => {
    const items = displayedRun?.items ?? []
    return {
      succeeded: countItems(items, 'succeeded'),
      skipped: countItems(items, 'skipped'),
      failed: countItems(items, 'failed'),
      running: countItems(items, 'running'),
      queued: countItems(items, 'queued'),
    }
  }, [displayedRun?.items])

  const failureGroups = useMemo(() => {
    const groups = new Map<string, MonthGenerationItem[]>()
    for (const item of displayedRun?.items ?? []) {
      if (item.status !== 'failed') continue
      const group = groups.get(item.date) ?? []
      group.push(item)
      groups.set(item.date, group)
    }
    return [...groups.entries()]
  }, [displayedRun?.items])

  const progressPercent =
    displayedRun && displayedRun.totalCount > 0
      ? Math.round((displayedRun.completedCount / displayedRun.totalCount) * 100)
      : 0
  const generatedScope = displayedRun
    ? displayedRun.requestedModes.length === PLAYABLE_MODES.length
      ? 'All game modes'
      : displayedRun.requestedModes.map((mode) => MODE_LABELS[mode] ?? mode).join(', ')
    : ''
  const confirmationContent =
    confirmation === 'generate'
      ? {
          title: 'Generate full month?',
          description: `Generate ${
            modeFilter === 'all' ? 'puzzles' : MODE_LABELS[modeFilter] ?? modeFilter
          } for ${yearMonth}? This starts immediately and continues safely in the background, even if you leave this page.`,
          label: 'Start generation',
          danger: false,
        }
      : confirmation === 'unlock'
        ? {
            title: 'Unlock this month?',
            description: `All locked rows in ${yearMonth} will return to generated status.`,
            label: 'Unlock month',
            danger: false,
          }
        : {
            title: 'Lock this month?',
            description: `All present puzzles in ${yearMonth} will be protected from live regeneration.`,
            label: 'Lock month',
            danger: true,
          }

  const confirmAction = () => {
    const action = confirmation
    setConfirmation(null)
    if (action === 'generate') {
      setNotice({
        tone: 'info',
        title: 'Starting month generation',
        detail: 'Once started, it will continue safely in the background.',
      })
      startGenerationMut.mutate()
    }
    if (action === 'lock') lockMut.mutate()
    if (action === 'unlock') unlockMut.mutate()
  }

  return (
    <div className="page month-page">
      <header className="topbar board-heading">
        <div>
          <p className="eyebrow">Schedule</p>
          <h1>Quiz schedule</h1>
          <p className="muted">Plan and review each day’s games.</p>
        </div>
      </header>

      <SectionCard className="board-controls">
        <div className="toolbar">
          <div className="toolbar-filters">
            <label>
              Month
              <input
                type="month"
                value={yearMonth}
                onChange={(event) => {
                  setYearMonth(event.target.value)
                }}
              />
            </label>
            <label>
              Game mode
              <select value={modeFilter} onChange={(event) => setModeFilter(event.target.value)}>
                <option value="all">All modes</option>
                {(matrix?.modes ?? Object.keys(MODE_LABELS)).map((mode) => (
                  <option key={mode} value={mode}>
                    {MODE_LABELS[mode] ?? mode}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="toolbar-actions">
            <button
              type="button"
              disabled={startGenerationMut.isPending}
              onClick={() => {
                if (newestActiveRun) {
                  setPreferredRun({ yearMonth, id: newestActiveRun.id })
                  document
                    .getElementById('generation-progress')
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  return
                }
                setConfirmation('generate')
              }}
            >
              {startGenerationMut.isPending
                ? 'Starting…'
                : newestActiveRun
                  ? 'View progress'
                  : 'Generate month'}
            </button>
            <button
              type="button"
              className="ghost"
              disabled={lockMut.isPending}
              onClick={() => setConfirmation('lock')}
            >
              {lockMut.isPending ? 'Locking…' : 'Lock month'}
            </button>
            <button
              type="button"
              className="quiet-button"
              disabled={unlockMut.isPending}
              onClick={() => setConfirmation('unlock')}
            >
              {unlockMut.isPending ? 'Unlocking…' : 'Unlock month'}
            </button>
          </div>
        </div>
      </SectionCard>

      {matrix && (
        <div className="summary" aria-label="Filter schedule by status">
          {([
            ['approved', 'Ready'],
            ['generated', 'Needs review'],
            ['missing', 'Missing'],
            ['locked', 'Locked'],
          ] as const).map(([status, label]) => (
            <button
              type="button"
              key={status}
              className={`summary-status${statusFilter === status ? ' active' : ''}`}
              onClick={() => setStatusFilter((current) => (current === status ? 'all' : status))}
            >
              <span className="kpi-copy">{label}</span>
              <strong>{visibleSummary[status]}</strong>
            </button>
          ))}
        </div>
      )}

      {notice && (
        <ValidationPanel
          tone={notice.tone}
          title={notice.title}
          onDismiss={() => setNotice(null)}
        >
          {notice.detail}
        </ValidationPanel>
      )}
      {runsQuery.error && (
        <ValidationPanel tone="error" title="Generation history could not be loaded">
          {runsQuery.error instanceof Error ? runsQuery.error.message : 'Failed to load'}
        </ValidationPanel>
      )}
      {runQuery.error && (
        <ValidationPanel tone="error" title="Generation progress could not be loaded">
          {runQuery.error instanceof Error ? runQuery.error.message : 'Failed to load'}
        </ValidationPanel>
      )}
      {displayedRun &&
        (isActiveRun(displayedRun.status) || displayedRun.failedCount > 0) && (
        <div id="generation-progress">
          <SectionCard
            title={isActiveRun(displayedRun.status) ? 'Month generation progress' : 'Latest generation'}
            description={`${generatedScope} · ${displayedRun.yearMonth}`}
            className="generation-card"
            actions={
              displayedRun.failedCount > 0 && !isActiveRun(displayedRun.status) ? (
                <button
                  type="button"
                  onClick={() => retryFailedMut.mutate()}
                  disabled={retryFailedMut.isPending}
                >
                  {retryFailedMut.isPending ? 'Queueing retry…' : 'Retry failed'}
                </button>
              ) : undefined
            }
          >
            <div className="generation-overview generation-overview-compact" aria-live="polite">
              <div className="generation-main">
                <span
                  className={`generation-status generation-status-${displayedRun.status}`}
                  role="status"
                >
                  {runStatusLabel(displayedRun.status)}
                </span>
                <p className="generation-completed">
                  <strong>{progressPercent}%</strong>
                  <span>
                    {displayedRun.completedCount} of {displayedRun.totalCount} puzzles finished
                  </span>
                </p>
              </div>
              <p className="generation-summary-line">
                {runCounts.succeeded} created
                <span aria-hidden="true"> · </span>
                {runCounts.skipped} already present
                {runCounts.failed > 0 && (
                  <>
                    <span aria-hidden="true"> · </span>
                    <strong>{runCounts.failed} failed</strong>
                  </>
                )}
                {isActiveRun(displayedRun.status) && (
                  <>
                    <span aria-hidden="true"> · </span>
                    {runCounts.running + runCounts.queued} remaining
                  </>
                )}
              </p>
            </div>

            <progress
              className="generation-progress"
              max={Math.max(displayedRun.totalCount, 1)}
              value={displayedRun.completedCount}
              aria-label={`Generation ${progressPercent}% complete`}
            />

            {failureGroups.length > 0 && (
              <div className="generation-failures">
                <h3>Puzzles that need attention</h3>
                <p className="muted">
                  Failures are grouped by date. You can retry all failed puzzles above.
                </p>
                <div className="failure-date-list">
                  {failureGroups.map(([date, items]) => (
                    <section className="failure-date-group" key={date}>
                      <h4>
                        {new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
                          weekday: 'long',
                          month: 'long',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </h4>
                      <ul>
                        {items.map((item) => (
                          <li key={item.id}>
                            <strong>{MODE_LABELS[item.modeId] ?? item.modeId}</strong>
                            <span>{item.error || 'This puzzle could not be created.'}</span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              </div>
            )}
          </SectionCard>
        </div>
      )}
      {monthQuery.isLoading && <div className="board-loading">Loading monthly schedule…</div>}
      {monthQuery.error && (
        <ValidationPanel tone="error" title="Month could not be loaded">
          {monthQuery.error instanceof Error ? monthQuery.error.message : 'Failed to load'}
        </ValidationPanel>
      )}

      {matrix && (
        <SectionCard
          title={`${new Date(`${yearMonth}-02T12:00:00`).toLocaleDateString(undefined, {
            month: 'long',
            year: 'numeric',
          })} schedule`}
          description={
            statusFilter === 'all'
              ? `${visibleSummary.total} games across ${matrix.dates.length} days`
              : `${visibleDates.length} days have games matching this filter`
          }
          className="board-card"
        >
          {visibleDates.length === 0 ? (
            <div className="empty-schedule">
              <strong>No matching days</strong>
              <span>Clear the status filter to see the full schedule.</span>
              <button type="button" className="ghost" onClick={() => setStatusFilter('all')}>
                Clear filter
              </button>
            </div>
          ) : (
            (() => {
              const selectedCells = modes.map((modeId) => ({
                modeId,
                cell: cellMap.get(`${selectedDate}|${modeId}`),
              }))
              const leadingDays = new Date(`${yearMonth}-01T12:00:00`).getDay()
              return (
                <div className="schedule-workspace">
                  <div className="month-calendar">
                    <div className="calendar-weekdays" aria-hidden="true">
                      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                        <span key={day}>{day}</span>
                      ))}
                    </div>
                    <div className="calendar-days">
                      {Array.from({ length: leadingDays }, (_, index) => (
                        <span className="calendar-spacer" key={`spacer-${index}`} />
                      ))}
                      {matrix.dates.map((date) => {
                        const dayCells = modes.map((modeId) =>
                          cellMap.get(`${date}|${modeId}`)
                        )
                        const ready = dayCells.filter(
                          (cell) => cell?.status === 'approved' || cell?.status === 'locked'
                        ).length
                        const missing = dayCells.filter(
                          (cell) => !cell || cell.status === 'missing'
                        ).length
                        const matchesFilter = visibleDates.includes(date)
                        return (
                          <button
                            type="button"
                            className={[
                              'calendar-day',
                              date === selectedDate ? 'selected' : '',
                              date === todayDate() ? 'today' : '',
                            ].filter(Boolean).join(' ')}
                            key={date}
                            disabled={!matchesFilter}
                            onClick={() => setSelectedDate(date)}
                          >
                            <strong>{Number(date.slice(-2))}</strong>
                            <span>
                              {ready === modes.length
                                ? 'Ready'
                                : missing > 0
                                  ? `${missing} missing`
                                  : `${modes.length - ready} to review`}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  <aside className="selected-day">
                    <header>
                      <div>
                        <span className="day-weekday">
                          {new Date(`${selectedDate}T12:00:00`).toLocaleDateString(undefined, {
                            weekday: 'long',
                          })}
                        </span>
                        <h3>
                          {new Date(`${selectedDate}T12:00:00`).toLocaleDateString(undefined, {
                            month: 'long',
                            day: 'numeric',
                          })}
                        </h3>
                      </div>
                    </header>
                    <div className="day-games">
                      {selectedCells.map(({ modeId, cell }) => {
                        const status = cell?.status ?? 'missing'
                        const rowContent = (
                          <>
                            <span className="game-name">{MODE_LABELS[modeId] ?? modeId}</span>
                            <StatusBadge status={status} compact />
                            {cell && <span className="row-arrow" aria-hidden="true">›</span>}
                          </>
                        )
                        return cell ? (
                          <Link
                            className="day-game-row"
                            to={`/d/${selectedDate}/${modeId}`}
                            key={modeId}
                          >
                            {rowContent}
                          </Link>
                        ) : (
                          <div className="day-game-row missing" key={modeId}>
                            {rowContent}
                          </div>
                        )
                      })}
                    </div>
                  </aside>
                </div>
              )
            })()
          )}
        </SectionCard>
      )}

      <ConfirmDialog
        open={confirmation !== null}
        title={confirmationContent.title}
        description={confirmationContent.description}
        confirmLabel={confirmationContent.label}
        danger={confirmationContent.danger}
        onConfirm={confirmAction}
        onCancel={() => setConfirmation(null)}
      />
    </div>
  )
}
