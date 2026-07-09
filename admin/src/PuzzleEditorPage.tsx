import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { api, MODE_LABELS } from './api'
import { LmsEditor } from './editors/LmsEditor'
import { GolfEditor } from './editors/GolfEditor'
import { BingoEditor } from './editors/BingoEditor'
import { OneMoreEditor } from './editors/OneMoreEditor'
import { DraftEditor } from './editors/DraftEditor'
import { ClubChainEditor } from './editors/ClubChainEditor'
import { TargetManEditor } from './editors/TargetManEditor'
import { JsonFallbackEditor } from './editors/JsonFallbackEditor'

export function PuzzleEditorPage() {
  const { date = '', modeId = '' } = useParams()
  const qc = useQueryClient()
  const [puzzleJson, setPuzzleJson] = useState<unknown>(null)
  const [answerJson, setAnswerJson] = useState<unknown>(null)
  const [note, setNote] = useState('')
  const [msg, setMsg] = useState<string | null>(null)

  const query = useQuery({
    queryKey: ['puzzle', date, modeId],
    queryFn: () => api.getPuzzle(date, modeId),
    enabled: Boolean(date && modeId),
  })

  useEffect(() => {
    if (query.data) {
      setPuzzleJson(structuredClone(query.data.puzzleJson))
      setAnswerJson(structuredClone(query.data.answerJson))
      setNote(query.data.reviewNote ?? '')
    }
  }, [query.data])

  const saveMut = useMutation({
    mutationFn: () =>
      api.savePuzzle({
        date,
        modeId,
        puzzleJson,
        answerJson,
        reviewNote: note || undefined,
        keepApproved: query.data?.status === 'approved',
      }),
    onSuccess: (data) => {
      if (data.puzzleJson !== undefined) setPuzzleJson(structuredClone(data.puzzleJson))
      if (data.answerJson !== undefined) setAnswerJson(structuredClone(data.answerJson))
      setMsg('Saved')
      void qc.invalidateQueries({ queryKey: ['puzzle', date, modeId] })
    },
    onError: (err) => setMsg(err instanceof Error ? err.message : 'Save failed'),
  })

  const approveMut = useMutation({
    mutationFn: async () => {
      const saved = await api.savePuzzle({
        date,
        modeId,
        puzzleJson,
        answerJson,
        reviewNote: note || undefined,
      })
      if (saved.puzzleJson !== undefined) setPuzzleJson(structuredClone(saved.puzzleJson))
      if (saved.answerJson !== undefined) setAnswerJson(structuredClone(saved.answerJson))
      await api.approvePuzzle(date, modeId, note || undefined)
    },
    onSuccess: () => {
      setMsg('Approved')
      void qc.invalidateQueries({ queryKey: ['puzzle', date, modeId] })
    },
    onError: (err) => setMsg(err instanceof Error ? err.message : 'Approve failed'),
  })

  const lockMut = useMutation({
    mutationFn: () => api.lockPuzzle(date, modeId, note || undefined),
    onSuccess: () => {
      setMsg('Locked')
      void qc.invalidateQueries({ queryKey: ['puzzle', date, modeId] })
    },
    onError: (err) => setMsg(err instanceof Error ? err.message : 'Lock failed'),
  })

  const unlockMut = useMutation({
    mutationFn: () => api.unlockPuzzle(date, modeId),
    onSuccess: () => {
      setMsg('Unlocked')
      void qc.invalidateQueries({ queryKey: ['puzzle', date, modeId] })
    },
    onError: (err) => setMsg(err instanceof Error ? err.message : 'Unlock failed'),
  })

  const regenMut = useMutation({
    mutationFn: () => api.regeneratePuzzle(date, modeId, true),
    onSuccess: (data) => {
      if (data.puzzle) {
        setPuzzleJson(structuredClone(data.puzzle.puzzleJson))
        setAnswerJson(structuredClone(data.puzzle.answerJson))
      }
      setMsg('Regenerated')
      void qc.invalidateQueries({ queryKey: ['puzzle', date, modeId] })
    },
    onError: (err) => setMsg(err instanceof Error ? err.message : 'Regen failed'),
  })

  const locked = query.data?.status === 'locked'
  const yearMonth = date.slice(0, 7)

  return (
    <div className="page editor-page">
      <header className="topbar">
        <div>
          <Link to="/" className="back">
            ← {yearMonth}
          </Link>
          <h1>
            {MODE_LABELS[modeId] ?? modeId} · {date}
          </h1>
          <p className="muted">
            Status: <strong>{query.data?.status ?? '…'}</strong>
            {query.data?.contentHash ? ` · hash ${query.data.contentHash.slice(0, 8)}` : ''}
          </p>
        </div>
        <div className="actions">
          <button type="button" disabled={locked || saveMut.isPending} onClick={() => saveMut.mutate()}>
            Save
          </button>
          <button
            type="button"
            disabled={locked || approveMut.isPending}
            onClick={() => approveMut.mutate()}
          >
            Approve
          </button>
          {locked ? (
            <button type="button" className="ghost" onClick={() => unlockMut.mutate()}>
              Unlock
            </button>
          ) : (
            <button type="button" className="danger" onClick={() => lockMut.mutate()}>
              Lock
            </button>
          )}
          <button
            type="button"
            className="ghost"
            disabled={locked || regenMut.isPending}
            onClick={() => {
              if (!confirm('Regenerate this puzzle? Unsaved edits will be lost.')) return
              regenMut.mutate()
            }}
          >
            {regenMut.isPending ? 'Regen…' : 'Regenerate'}
          </button>
        </div>
      </header>

      <label className="note-field">
        Review note
        <input value={note} onChange={(e) => setNote(e.target.value)} disabled={locked} />
      </label>

      {msg && <p className="log">{msg}</p>}
      {query.isLoading && <p className="muted">Loading puzzle…</p>}
      {query.error && (
        <p className="error">{query.error instanceof Error ? query.error.message : 'Load failed'}</p>
      )}

      {puzzleJson != null && (
        <EditorBody
          modeId={modeId}
          puzzleJson={puzzleJson}
          answerJson={answerJson}
          locked={locked}
          onPuzzle={setPuzzleJson}
          onAnswer={setAnswerJson}
        />
      )}
    </div>
  )
}

function EditorBody({
  modeId,
  puzzleJson,
  answerJson,
  locked,
  onPuzzle,
  onAnswer,
}: {
  modeId: string
  puzzleJson: unknown
  answerJson: unknown
  locked: boolean
  onPuzzle: (v: unknown) => void
  onAnswer: (v: unknown) => void
}) {
  switch (modeId) {
    case 'last_man_standing':
      return (
        <LmsEditor
          puzzle={puzzleJson}
          answer={answerJson}
          locked={locked}
          onChange={(p, a) => {
            onPuzzle(p)
            onAnswer(a)
          }}
        />
      )
    case 'football_golf':
      return (
        <GolfEditor
          puzzle={puzzleJson}
          locked={locked}
          onChange={onPuzzle}
        />
      )
    case 'football_bingo':
      return (
        <BingoEditor
          puzzle={puzzleJson}
          locked={locked}
          onChange={onPuzzle}
        />
      )
    case 'one_more':
      return (
        <OneMoreEditor
          puzzle={puzzleJson}
          answer={answerJson}
          locked={locked}
          onChange={(p, a) => {
            onPuzzle(p)
            onAnswer(a)
          }}
        />
      )
    case 'draft_master':
      return (
        <DraftEditor
          puzzle={puzzleJson}
          locked={locked}
          onChange={onPuzzle}
        />
      )
    case 'club_chain':
      return (
        <ClubChainEditor
          puzzle={puzzleJson}
          answer={answerJson}
          locked={locked}
          onChange={(p, a) => {
            onPuzzle(p)
            onAnswer(a)
          }}
        />
      )
    case 'target_man':
      return (
        <TargetManEditor
          puzzle={puzzleJson}
          answer={answerJson}
          locked={locked}
          onChange={(p, a) => {
            onPuzzle(p)
            onAnswer(a)
          }}
        />
      )
    default:
      return (
        <JsonFallbackEditor
          puzzle={puzzleJson}
          answer={answerJson}
          locked={locked}
          onChange={(p, a) => {
            onPuzzle(p)
            onAnswer(a)
          }}
        />
      )
  }
}
