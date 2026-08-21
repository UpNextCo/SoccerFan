import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useBlocker, useParams } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { api, MODE_LABELS, type PuzzleValidationReport } from './api'
import {
  ConfirmDialog,
  StatusBadge,
  ValidationPanel,
} from './components/AdminUi'
import { LmsEditor } from './editors/LmsEditor'
import { GolfEditor } from './editors/GolfEditor'
import { BingoEditor } from './editors/BingoEditor'
import { OneMoreEditor } from './editors/OneMoreEditor'
import { DraftEditor } from './editors/DraftEditor'
import { ClubChainEditor } from './editors/ClubChainEditor'
import { BackYourselfEditor } from './editors/BackYourselfEditor'
import { TargetManEditor } from './editors/TargetManEditor'
import { Darts501Editor } from './editors/Darts501Editor'
import { JsonFallbackEditor } from './editors/JsonFallbackEditor'
import './editors/editor-clean.css'

type EditorSnapshot = {
  puzzleJson: unknown
  answerJson: unknown
  note: string
}

type Notice = {
  tone: 'success' | 'error' | 'info'
  title: string
  detail?: string
}

type Confirmation = 'discard' | 'regenerate' | null

class PartialApprovalError extends Error {
  row: Awaited<ReturnType<typeof api.getPuzzle>> | null

  constructor(message: string, row: Awaited<ReturnType<typeof api.getPuzzle>> | null) {
    super(message)
    this.name = 'PartialApprovalError'
    this.row = row
  }
}

function snapshotKey(snapshot: EditorSnapshot): string {
  return JSON.stringify([snapshot.puzzleJson, snapshot.answerJson, snapshot.note])
}

export function PuzzleEditorPage() {
  const { date = '', modeId = '' } = useParams()
  const qc = useQueryClient()
  const [puzzleJson, setPuzzleJson] = useState<unknown>(null)
  const [answerJson, setAnswerJson] = useState<unknown>(null)
  const [note, setNote] = useState('')
  const [loadedSnapshot, setLoadedSnapshot] = useState<EditorSnapshot | null>(null)
  const [loadedPuzzleKey, setLoadedPuzzleKey] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [confirmation, setConfirmation] = useState<Confirmation>(null)
  const [validationReport, setValidationReport] = useState<PuzzleValidationReport | null>(null)
  const [qualityChecksOpen, setQualityChecksOpen] = useState(true)

  const query = useQuery({
    queryKey: ['puzzle', date, modeId],
    queryFn: () => api.getPuzzle(date, modeId),
    enabled: Boolean(date && modeId),
  })

  const puzzleKey = `${date}:${modeId}`

  function applyServerRow(row: Awaited<ReturnType<typeof api.getPuzzle>>) {
    const loaded = {
      puzzleJson: structuredClone(row.puzzleJson),
      answerJson: structuredClone(row.answerJson),
      note: row.reviewNote ?? '',
    }
    setPuzzleJson(loaded.puzzleJson)
    setAnswerJson(loaded.answerJson)
    setNote(loaded.note)
    setLoadedSnapshot(structuredClone(loaded))
    setLoadedPuzzleKey(puzzleKey)
    qc.setQueryData(['puzzle', date, modeId], row)
  }

  useEffect(() => {
    // Background refetches update status metadata, but never replace an editor
    // that has already been initialized (and may contain local changes).
    if (query.data && loadedPuzzleKey !== puzzleKey) {
      const loaded = {
        puzzleJson: structuredClone(query.data.puzzleJson),
        answerJson: structuredClone(query.data.answerJson),
        note: query.data.reviewNote ?? '',
      }
      setPuzzleJson(loaded.puzzleJson)
      setAnswerJson(loaded.answerJson)
      setNote(loaded.note)
      setLoadedSnapshot(structuredClone(loaded))
      setLoadedPuzzleKey(puzzleKey)
    }
  }, [loadedPuzzleKey, puzzleKey, query.data])

  const currentSnapshot = useMemo(
    () => ({ puzzleJson, answerJson, note }),
    [answerJson, note, puzzleJson]
  )
  const dirty = loadedSnapshot !== null && snapshotKey(currentSnapshot) !== snapshotKey(loadedSnapshot)

  const saveMut = useMutation({
    mutationFn: async (snapshot: EditorSnapshot) => {
      await api.savePuzzle({
        date,
        modeId,
        puzzleJson: snapshot.puzzleJson,
        answerJson: snapshot.answerJson,
        reviewNote: snapshot.note || undefined,
        // Any edit returns the puzzle to generated; it must pass validation and approval again.
        keepApproved: false,
      })
      return api.getPuzzle(date, modeId)
    },
    onSuccess: (row) => {
      applyServerRow(row)
      setNotice({ tone: 'success', title: 'Changes saved', detail: 'The server copy is up to date.' })
    },
    onError: (err) =>
      setNotice({
        tone: 'error',
        title: 'Save failed',
        detail: err instanceof Error ? err.message : 'Please try again.',
      }),
  })

  const approveMut = useMutation({
    mutationFn: async (snapshot: EditorSnapshot) => {
      let saved = false
      try {
        await api.savePuzzle({
          date,
          modeId,
          puzzleJson: snapshot.puzzleJson,
          answerJson: snapshot.answerJson,
          reviewNote: snapshot.note || undefined,
          keepApproved: false,
        })
        saved = true
        await api.approvePuzzle(date, modeId, snapshot.note || undefined)
        return await api.getPuzzle(date, modeId)
      } catch (error) {
        if (!saved) throw error
        let row: Awaited<ReturnType<typeof api.getPuzzle>> | null = null
        try {
          row = await api.getPuzzle(date, modeId)
        } catch {
          // The message below tells the editor a manual refresh is required.
        }
        const reason = error instanceof Error ? error.message : 'Approval request failed'
        throw new PartialApprovalError(reason, row)
      }
    },
    onSuccess: (row) => {
      applyServerRow(row)
      setNotice({
        tone: 'success',
        title: 'Puzzle approved',
        detail: 'Changes were saved before approval.',
      })
    },
    onError: (err) => {
      if (err instanceof PartialApprovalError) {
        if (err.row) applyServerRow(err.row)
        const serverApproved = err.row?.status === 'approved'
        setNotice({
          tone: serverApproved ? 'info' : 'error',
          title: serverApproved
            ? 'Approval response failed, but server is approved'
            : 'Changes saved, but approval failed',
          detail: err.row
            ? `${err.message}. The editor has been reconciled with the server copy (status: ${err.row.status}).`
            : `${err.message}. The saved server state could not be reloaded; refresh before making more changes.`,
        })
        return
      }
      setNotice({
        tone: 'error',
        title: 'Approval failed',
        detail: err instanceof Error ? err.message : 'Please try again.',
      })
    },
  })

  const regenMut = useMutation({
    mutationFn: () => api.regeneratePuzzle(date, modeId, true),
    onSuccess: (data) => {
      if (data.puzzle) {
        const regenerated = {
          puzzleJson: structuredClone(data.puzzle.puzzleJson),
          answerJson: structuredClone(data.puzzle.answerJson),
          note: data.puzzle.reviewNote ?? '',
        }
        setPuzzleJson(regenerated.puzzleJson)
        setAnswerJson(regenerated.answerJson)
        setNote(regenerated.note)
        setLoadedSnapshot(structuredClone(regenerated))
      }
      setNotice({
        tone: 'success',
        title: 'Puzzle regenerated',
        detail: 'The editor now shows the new server copy.',
      })
      void qc.invalidateQueries({ queryKey: ['puzzle', date, modeId] })
    },
    onError: (err) =>
      setNotice({
        tone: 'error',
        title: 'Regeneration failed',
        detail: err instanceof Error ? err.message : 'Please try again.',
      }),
  })

  const validationMut = useMutation({
    mutationFn: (snapshot: EditorSnapshot) =>
      api.validatePuzzleDraft({
        modeId,
        puzzleJson: snapshot.puzzleJson,
        answerJson: snapshot.answerJson,
      }),
    onSuccess: (report) => setValidationReport(report),
    onError: (error) => {
      setValidationReport(null)
      setNotice({
        tone: 'error',
        title: 'Validation failed to run',
        detail: error instanceof Error ? error.message : 'Please try again.',
      })
    },
  })

  const locked = query.data?.status === 'locked'
  const working =
    saveMut.isPending ||
    approveMut.isPending ||
    regenMut.isPending
  const editorReadOnly = locked || working
  const blocker = useBlocker(dirty)

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return
      event.preventDefault()
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [dirty])

  useEffect(() => {
    if (blocker.state !== 'blocked') return
    if (window.confirm('Leave this editor and discard unsaved changes?')) blocker.proceed()
    else blocker.reset()
  }, [blocker])

  useEffect(() => {
    if (dirty) setValidationReport(null)
  }, [dirty, puzzleJson, answerJson])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return
      event.preventDefault()
      if (!editorReadOnly && dirty) saveMut.mutate(currentSnapshot)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentSnapshot, dirty, editorReadOnly, saveMut])

  const discardChanges = () => {
    if (!loadedSnapshot) return
    const restored = structuredClone(loadedSnapshot)
    setPuzzleJson(restored.puzzleJson)
    setAnswerJson(restored.answerJson)
    setNote(restored.note)
    setNotice({ tone: 'info', title: 'Changes discarded', detail: 'Restored the last server copy.' })
  }

  const confirmationContent =
    confirmation === 'discard'
      ? {
          title: 'Discard unsaved changes?',
          description: 'The editor will return to the last version loaded from the server.',
          label: 'Discard changes',
        }
      : {
          title: 'Regenerate this puzzle?',
          description: dirty
            ? 'Regeneration will replace your unsaved edits with a newly generated puzzle.'
            : 'The current puzzle will be replaced with a newly generated version.',
          label: 'Regenerate',
        }

  const confirmAction = () => {
    if (working) return
    const action = confirmation
    setConfirmation(null)
    if (action === 'discard') discardChanges()
    if (action === 'regenerate') regenMut.mutate()
  }

  return (
    <div className="page editor-page">
      <header className="editor-heading">
        <div className="editor-heading-main">
          <Link to="/" className="back">
            <span aria-hidden="true">←</span> Back to schedule
          </Link>
          <div className="editor-title-row">
            <div className="editor-title-copy">
              <h1>{MODE_LABELS[modeId] ?? modeId}</h1>
              <StatusBadge status={query.data?.status ?? 'loading'} />
              {dirty && <span className="dirty-indicator">Unsaved changes</span>}
            </div>
            <div className="editor-title-actions">
              <button
                type="button"
                disabled={working || locked || !dirty}
                onClick={() => saveMut.mutate(currentSnapshot)}
              >
                {saveMut.isPending ? 'Saving…' : 'Save'}
                <span className="key-hint">⌘S</span>
              </button>
              <button
                type="button"
                className="ghost approve-button"
                disabled={working || locked}
                onClick={() => approveMut.mutate(currentSnapshot)}
              >
                {approveMut.isPending ? 'Approving…' : 'Approve'}
              </button>
              <details className="more-menu">
                <summary>More</summary>
                <div className="more-menu-popover">
                  <button
                    type="button"
                    className="quiet-button"
                    disabled={!dirty || working}
                    onClick={() => setConfirmation('discard')}
                  >
                    Discard changes
                  </button>
                  <button
                    type="button"
                    className="quiet-button"
                    disabled={locked || working}
                    onClick={() => setConfirmation('regenerate')}
                  >
                    {regenMut.isPending ? 'Regenerating…' : 'Regenerate puzzle'}
                  </button>
                </div>
              </details>
            </div>
          </div>
          <p className="muted">
            {date
              ? new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })
              : 'Scheduled puzzle'}
          </p>
        </div>
      </header>

      {notice && (
        <ValidationPanel
          tone={notice.tone}
          title={notice.title}
          onDismiss={() => setNotice(null)}
        >
          {notice.detail}
        </ValidationPanel>
      )}
      {query.isLoading && <div className="editor-loading">Loading puzzle editor…</div>}
      {query.error && (
        <ValidationPanel tone="error" title="Puzzle could not be loaded">
          {query.error instanceof Error ? query.error.message : 'Load failed'}
        </ValidationPanel>
      )}

      {puzzleJson != null && (
        <div className="editor-layout">
          <main className="editor-canvas">
            <EditorBody
              modeId={modeId}
              puzzleJson={puzzleJson}
              answerJson={answerJson}
              locked={editorReadOnly}
              onPuzzle={setPuzzleJson}
              onAnswer={setAnswerJson}
            />
          </main>
          <aside className="editor-sidebar">
            <details
              className="secondary-panel"
              open={qualityChecksOpen}
              onToggle={(event) => setQualityChecksOpen(event.currentTarget.open)}
            >
              <summary>
                <span>Quality checks</span>
                <span className="muted tiny">
                  {validationReport == null
                    ? 'Not run'
                    : validationReport.ok
                      ? 'Passed'
                      : 'Needs attention'}
                </span>
              </summary>
              <div className="secondary-panel-content">
                <button
                  type="button"
                  className="ghost"
                  disabled={validationMut.isPending || puzzleJson == null}
                  onClick={() => validationMut.mutate(currentSnapshot)}
                >
                  {validationMut.isPending ? 'Checking…' : 'Run checks'}
                </button>
                {validationReport == null ? (
                  <p className="muted tiny">Run checks after editing and before approval.</p>
                ) : validationReport.issues.length === 0 ? (
                  <ValidationPanel tone="success" title="All checks passed" />
                ) : (
                  <div className="validation-issue-list">
                    <ValidationPanel
                      tone={validationReport.ok ? 'info' : 'error'}
                      title={
                        validationReport.ok
                          ? `${validationReport.issues.length} warning${validationReport.issues.length === 1 ? '' : 's'}`
                          : `${validationReport.issues.filter((issue) => issue.severity === 'error').length} issue${validationReport.issues.filter((issue) => issue.severity === 'error').length === 1 ? '' : 's'} to fix`
                      }
                    />
                    <ul>
                      {validationReport.issues.map((issue, index) => (
                        <li key={`${issue.path}-${index}`} className={`validation-issue issue-${issue.severity}`}>
                          <span>{issue.message}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </details>
            <details className="secondary-panel review-note-panel">
              <summary>
                <span>Team note</span>
                <span className="muted tiny">{note.trim() ? 'Added' : 'Optional'}</span>
              </summary>
              <div className="secondary-panel-content">
                <label className="sr-only" htmlFor="review-note">
                  Team note
                </label>
                <textarea
                  id="review-note"
                  rows={4}
                  placeholder="Add a note for the team…"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  disabled={editorReadOnly}
                />
              </div>
            </details>
            {locked && (
              <ValidationPanel tone="info" title="Read-only">
                This puzzle is locked. Unlock the month from the schedule to edit it.
              </ValidationPanel>
            )}
          </aside>
        </div>
      )}

      <ConfirmDialog
        open={confirmation !== null}
        title={confirmationContent.title}
        description={confirmationContent.description}
        confirmLabel={confirmationContent.label}
        danger
        confirmDisabled={working}
        onConfirm={confirmAction}
        onCancel={() => setConfirmation(null)}
      />
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
    case 'back_yourself':
      return (
        <BackYourselfEditor
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
    case 'darts_501':
      return (
        <Darts501Editor
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
