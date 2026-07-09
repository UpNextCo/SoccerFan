import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { api, MODE_LABELS, type CellStatus, type MonthCell } from './api'

function statusClass(status: CellStatus): string {
  return `cell cell-${status}`
}

function defaultYearMonth(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export function MonthBoard({
  adminName,
  onLogout,
}: {
  adminName: string
  onLogout: () => void
}) {
  const [yearMonth, setYearMonth] = useState(defaultYearMonth)
  const [modeFilter, setModeFilter] = useState<string>('all')
  const [log, setLog] = useState<string | null>(null)
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
      setLog(`Generate done: ${ok} created, ${skipped} skipped, ${failed} failed`)
      void qc.invalidateQueries({ queryKey: ['month', yearMonth] })
    },
    onError: (err) => setLog(err instanceof Error ? err.message : 'Generate failed'),
  })

  const lockMut = useMutation({
    mutationFn: () => api.lockMonth(yearMonth),
    onSuccess: (data) => {
      setLog(`Locked ${data.updated} puzzles`)
      void qc.invalidateQueries({ queryKey: ['month', yearMonth] })
    },
    onError: (err) => setLog(err instanceof Error ? err.message : 'Lock failed'),
  })

  const unlockMut = useMutation({
    mutationFn: () => api.unlockMonth(yearMonth),
    onSuccess: (data) => {
      setLog(`Unlocked → generated (${data.updated} rows now generated)`)
      void qc.invalidateQueries({ queryKey: ['month', yearMonth] })
    },
    onError: (err) => setLog(err instanceof Error ? err.message : 'Unlock failed'),
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

  return (
    <div className="page">
      <header className="topbar">
        <div>
          <h1>Monthly Quiz Ops</h1>
          <p className="muted">Signed in as {adminName}</p>
        </div>
        <button type="button" className="ghost" onClick={onLogout}>
          Log out
        </button>
      </header>

      <section className="toolbar">
        <label>
          Month
          <input
            type="month"
            value={yearMonth}
            onChange={(e) => setYearMonth(e.target.value)}
          />
        </label>
        <label>
          Mode
          <select value={modeFilter} onChange={(e) => setModeFilter(e.target.value)}>
            <option value="all">All modes</option>
            {(matrix?.modes ?? Object.keys(MODE_LABELS)).map((m) => (
              <option key={m} value={m}>
                {MODE_LABELS[m] ?? m}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={generateMut.isPending}
          onClick={() => {
            if (
              !confirm(
                `Generate missing puzzles for ${yearMonth}? LMS days can take several minutes each.`
              )
            )
              return
            setLog('Generating… this can take a while')
            generateMut.mutate()
          }}
        >
          {generateMut.isPending ? 'Generating…' : 'Generate missing'}
        </button>
        <button
          type="button"
          className="danger"
          disabled={lockMut.isPending}
          onClick={() => {
            if (!confirm(`Lock all present puzzles in ${yearMonth}? Live ensure/regen will not overwrite them.`))
              return
            lockMut.mutate()
          }}
        >
          Lock month
        </button>
        <button
          type="button"
          className="ghost"
          disabled={unlockMut.isPending}
          onClick={() => {
            if (!confirm(`Unlock month ${yearMonth}? Rows become generated again.`)) return
            unlockMut.mutate()
          }}
        >
          Unlock month
        </button>
      </section>

      {matrix && (
        <div className="summary">
          <span>{matrix.summary.present}/{matrix.summary.total} present</span>
          <span className="dot missing">{matrix.summary.missing} missing</span>
          <span className="dot generated">{matrix.summary.generated} generated</span>
          <span className="dot approved">{matrix.summary.approved} approved</span>
          <span className="dot locked">{matrix.summary.locked} locked</span>
        </div>
      )}

      {log && <p className="log">{log}</p>}
      {monthQuery.isLoading && <p className="muted">Loading month…</p>}
      {monthQuery.error && (
        <p className="error">
          {monthQuery.error instanceof Error ? monthQuery.error.message : 'Failed to load'}
        </p>
      )}

      {matrix && (
        <div className="board-wrap">
          <table className="board">
            <thead>
              <tr>
                <th>Mode</th>
                {matrix.dates.map((d) => (
                  <th key={d}>{d.slice(-2)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {modes.map((modeId) => (
                <tr key={modeId}>
                  <th title={modeId}>{MODE_LABELS[modeId] ?? modeId}</th>
                  {matrix.dates.map((date) => {
                    const cell = cellMap.get(`${date}|${modeId}`)
                    const status = cell?.status ?? 'missing'
                    const title = cell?.snippet || status
                    if (status === 'missing') {
                      return (
                        <td key={date} className={statusClass(status)} title={title}>
                          <span>·</span>
                        </td>
                      )
                    }
                    return (
                      <td key={date} className={statusClass(status)} title={title}>
                        <Link to={`/d/${date}/${modeId}`}>{status[0]!.toUpperCase()}</Link>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="legend muted">
        Cell letters: G generated · A approved · L locked · click a cell to edit
      </p>
    </div>
  )
}
