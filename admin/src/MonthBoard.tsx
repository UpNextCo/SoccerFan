import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { api, MODE_LABELS, type CellStatus, type MonthCell } from './api'
import { ConfirmDialog, SectionCard, StatusBadge, ValidationPanel } from './components/AdminUi'

function statusClass(status: CellStatus): string {
  return `cell cell-${status}`
}

function defaultYearMonth(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function todayDate(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`
}

type GenerationResult = {
  date: string
  modeId: string
  ok: boolean
  skipped?: string
  error?: string
}

type BoardNotice = {
  tone: 'success' | 'error' | 'info'
  title: string
  detail?: string
}

type MonthConfirmation = 'generate' | 'lock' | 'unlock' | null

export function MonthBoard({
  adminName,
  onLogout,
}: {
  adminName: string
  onLogout: () => void
}) {
  const [yearMonth, setYearMonth] = useState(defaultYearMonth)
  const [modeFilter, setModeFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<CellStatus | 'all'>('all')
  const [notice, setNotice] = useState<BoardNotice | null>(null)
  const [generationResults, setGenerationResults] = useState<GenerationResult[] | null>(null)
  const [confirmation, setConfirmation] = useState<MonthConfirmation>(null)
  const qc = useQueryClient()

  const monthQuery = useQuery({
    queryKey: ['month', yearMonth],
    queryFn: () => api.month(yearMonth),
  })

  const generateMut = useMutation({
    mutationFn: () =>
      api.generateMonth(yearMonth, modeFilter === 'all' ? undefined : [modeFilter]),
    onSuccess: (data) => {
      const ok = data.results.filter((r) => r.ok).length
      const skipped = data.results.filter((r) => r.skipped).length
      const failed = data.results.filter((r) => r.error).length
      setGenerationResults(data.results)
      setNotice({
        tone: failed > 0 ? 'error' : 'success',
        title: failed > 0 ? 'Generation completed with failures' : 'Generation complete',
        detail: `${ok} created · ${skipped} skipped · ${failed} failed`,
      })
      void qc.invalidateQueries({ queryKey: ['month', yearMonth] })
    },
    onError: (err) =>
      setNotice({
        tone: 'error',
        title: 'Generation failed',
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

  const failedResults = generationResults?.filter((result) => result.error) ?? []
  const skippedResults = generationResults?.filter((result) => result.skipped) ?? []
  const confirmationContent =
    confirmation === 'generate'
      ? {
          title: 'Generate missing puzzles?',
          description: `Generate missing ${
            modeFilter === 'all' ? 'puzzles' : MODE_LABELS[modeFilter] ?? modeFilter
          } for ${yearMonth}? LMS days can take several minutes each.`,
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
      setGenerationResults(null)
      setNotice({
        tone: 'info',
        title: 'Generation in progress',
        detail: 'This can take several minutes. Keep this page open.',
      })
      generateMut.mutate()
    }
    if (action === 'lock') lockMut.mutate()
    if (action === 'unlock') unlockMut.mutate()
  }

  return (
    <div className="page month-page">
      <header className="topbar board-heading">
        <div>
          <p className="eyebrow">Content operations</p>
          <h1>Monthly quiz board</h1>
          <p className="muted">Review, generate, and publish the daily puzzle schedule.</p>
        </div>
        <div className="admin-session">
          <span>
            Signed in as <strong>{adminName}</strong>
          </span>
          <button type="button" className="ghost" onClick={onLogout}>
            Log out
          </button>
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
                  setGenerationResults(null)
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
            <div className="action-group">
              <span className="action-group-label">Generate</span>
              <button
                type="button"
                disabled={generateMut.isPending}
                onClick={() => setConfirmation('generate')}
              >
                {generateMut.isPending ? 'Generating…' : 'Generate missing'}
              </button>
            </div>
            <div className="action-group">
              <span className="action-group-label">Publish controls</span>
              <div className="button-pair">
                <button
                  type="button"
                  className="danger-outline"
                  disabled={lockMut.isPending}
                  onClick={() => setConfirmation('lock')}
                >
                  {lockMut.isPending ? 'Locking…' : 'Lock month'}
                </button>
                <button
                  type="button"
                  className="ghost"
                  disabled={unlockMut.isPending}
                  onClick={() => setConfirmation('unlock')}
                >
                  {unlockMut.isPending ? 'Unlocking…' : 'Unlock'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </SectionCard>

      {matrix && (
        <div className="summary" aria-label="Filter board by status">
          <button
            type="button"
            className={`summary-total${statusFilter === 'all' ? ' active' : ''}`}
            onClick={() => setStatusFilter('all')}
          >
            <strong>{visibleSummary.total}</strong>
            <span>scheduled</span>
          </button>
          {(['missing', 'generated', 'approved', 'locked'] as const).map((status) => (
            <button
              type="button"
              key={status}
              className={`summary-status${statusFilter === status ? ' active' : ''}`}
              onClick={() => setStatusFilter((current) => (current === status ? 'all' : status))}
            >
              <StatusBadge status={status} />
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
              ? 'Select any populated cell to open its editor.'
              : `Highlighting ${statusFilter} puzzles. Select the active filter again to clear it.`
          }
          className="board-card"
        >
          <div className="board-wrap">
            <table className="board">
              <thead>
                <tr>
                  <th>Mode</th>
                  {matrix.dates.map((date) => (
                    <th
                      key={date}
                      className={date === todayDate() ? 'today-column' : ''}
                      title={new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
                        weekday: 'long',
                        month: 'long',
                        day: 'numeric',
                      })}
                    >
                      <span>{new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' })}</span>
                      <strong>{date.slice(-2)}</strong>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {modes.map((modeId) => (
                  <tr key={modeId}>
                    <th title={modeId}>
                      <span className="mode-name">{MODE_LABELS[modeId] ?? modeId}</span>
                    </th>
                    {matrix.dates.map((date) => {
                      const cell = cellMap.get(`${date}|${modeId}`)
                      const status = cell?.status ?? 'missing'
                      const dimmed = statusFilter !== 'all' && statusFilter !== status
                      const detail = [
                        MODE_LABELS[modeId] ?? modeId,
                        date,
                        status,
                        cell?.version ? `version ${cell.version}` : null,
                        cell?.snippet,
                      ]
                        .filter(Boolean)
                        .join(' · ')
                      if (status === 'missing') {
                        return (
                          <td
                            key={date}
                            className={`${statusClass(status)}${date === todayDate() ? ' today-column' : ''}${dimmed ? ' cell-dimmed' : ''}`}
                            title={detail}
                          >
                            <span className="cell-status-letter" aria-label="Missing">—</span>
                          </td>
                        )
                      }
                      return (
                        <td
                          key={date}
                          className={`${statusClass(status)}${date === todayDate() ? ' today-column' : ''}${dimmed ? ' cell-dimmed' : ''}`}
                          title={detail}
                        >
                          <Link to={`/d/${date}/${modeId}`} aria-label={`Edit ${detail}`}>
                            <span className="cell-status-letter">{status[0]!.toUpperCase()}</span>
                            {cell?.version && <small>v{cell.version}</small>}
                          </Link>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="legend">
            <span>Hover for puzzle details</span>
            <StatusBadge status="missing" compact />
            <StatusBadge status="generated" compact />
            <StatusBadge status="approved" compact />
            <StatusBadge status="locked" compact />
          </div>
        </SectionCard>
      )}

      {generationResults && (
        <SectionCard
          title="Generation results"
          description={`${generationResults.filter((result) => result.ok).length} created, ${
            skippedResults.length
          } skipped, ${failedResults.length} failed.`}
          className="results-card"
        >
          {failedResults.length > 0 ? (
            <div className="result-list">
              {failedResults.map((result) => (
                <div className="result-row result-failed" key={`${result.date}|${result.modeId}`}>
                  <StatusBadge status="failed" compact />
                  <div>
                    <strong>
                      {result.date} · {MODE_LABELS[result.modeId] ?? result.modeId}
                    </strong>
                    <p>{result.error}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty-result">No generation failures.</p>
          )}
          {skippedResults.length > 0 && (
            <details className="skipped-results">
              <summary>{skippedResults.length} skipped puzzles</summary>
              <ul>
                {skippedResults.map((result) => (
                  <li key={`${result.date}|${result.modeId}`}>
                    {result.date} · {MODE_LABELS[result.modeId] ?? result.modeId}: {result.skipped}
                  </li>
                ))}
              </ul>
            </details>
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
