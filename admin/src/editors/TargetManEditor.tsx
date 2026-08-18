import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api, type TargetManCategoryOption, type TargetManPool } from '../api'
import { EntityPicker } from '../components/EntityPicker'
import './game-editors.css'

type Puzzle = {
  categoryLabel?: string
  label?: string
  title?: string
  target?: number
  unit?: string | null
  valueNoun?: string
  offNoun?: string
  categoryId?: string
  pool?: TargetManPool | null
  [k: string]: unknown
}

type TargetFields = {
  categoryId?: string
  target?: number
  [k: string]: unknown
}

type TargetAnswer = {
  modeId?: string
  answer?: TargetFields
  categoryId?: string
  target?: number
  [k: string]: unknown
}

export function TargetManEditor({
  puzzle,
  answer,
  locked,
  onChange,
}: {
  puzzle: unknown
  answer: unknown
  locked: boolean
  onChange: (puzzle: Puzzle, answer: unknown) => void
}) {
  const p = puzzle as Puzzle
  const a = (answer && typeof answer === 'object' ? answer : {}) as TargetAnswer
  const categoryTitle = p.categoryLabel ?? p.title ?? p.label ?? ''
  const [rawText, setRawText] = useState(() => JSON.stringify(answer ?? null, null, 2))
  const [rawError, setRawError] = useState<string | null>(null)
  const categoriesQuery = useQuery({
    queryKey: ['target-man-categories'],
    queryFn: api.listTargetManCategories,
    staleTime: Infinity,
  })
  const pool = p.pool ?? null
  const poolType = pool?.type ?? ''
  const [previewNote, setPreviewNote] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)

  useEffect(() => {
    setRawText(JSON.stringify(answer ?? null, null, 2))
    setRawError(null)
  }, [answer])

  function synchronizedAnswer(nextPuzzle: Puzzle): TargetAnswer {
    const categoryId = nextPuzzle.categoryId ?? ''
    const target = nextPuzzle.target ?? 0
    if (a.answer || a.modeId === 'target_man') {
      return {
        ...a,
        modeId: 'target_man',
        answer: { ...(a.answer ?? {}), categoryId, target },
      }
    }
    return { ...a, categoryId, target }
  }

  function updatePuzzle(patch: Partial<Puzzle>) {
    const nextPuzzle = { ...p, ...patch }
    onChange(nextPuzzle, synchronizedAnswer(nextPuzzle))
  }

  function normalizePool(value: TargetManPool | null | undefined): TargetManPool | null {
    if (!value) return null
    if (value.type === 'nationality' && value.nationality?.trim()) {
      return { type: 'nationality', nationality: value.nationality.trim() }
    }
    if (value.type === 'club' && value.club?.trim()) {
      return {
        type: 'club',
        club: value.club.trim(),
        teamId: typeof value.teamId === 'number' ? value.teamId : null,
      }
    }
    return null
  }

  function commitPuzzle(nextPuzzle: Puzzle) {
    onChange(nextPuzzle, synchronizedAnswer(nextPuzzle))
  }

  function selectCategory(category: TargetManCategoryOption) {
    const nextPool = normalizePool(p.pool)
    const label = nextPool
      ? `${category.label} from ${nextPool.type === 'club' ? nextPool.club : nextPool.nationality} players`
      : category.label
    const nextPuzzle: Puzzle = {
      ...p,
      categoryId: category.id,
      categoryLabel: label,
      title: label,
      label,
      valueNoun: category.valueNoun,
      offNoun: category.offNoun,
      unit: category.unit,
      target: category.suggestedTarget,
      pool: nextPool,
    }
    commitPuzzle(nextPuzzle)
    void refreshPreview(nextPuzzle, nextPool, category.suggestedTarget)
  }

  async function refreshPreview(
    base: Puzzle,
    nextPool: TargetManPool | null,
    fallbackTarget?: number
  ) {
    const categoryId = base.categoryId
    if (!categoryId) return
    setPreviewError(null)
    try {
      const preview = await api.previewTargetMan({ categoryId, pool: nextPool })
      commitPuzzle({
        ...base,
        categoryLabel: preview.label,
        title: preview.label,
        label: preview.label,
        target: preview.suggestedTarget || fallbackTarget,
        pool: nextPool,
      })
      const samples = preview.samplePlayers
        .slice(0, 4)
        .map((player) => `${player.name} ${player.value}`)
        .join(', ')
      setPreviewNote(
        nextPool
          ? `${preview.eligibleCount} eligible players in this pool${samples ? ` — ${samples}` : ''}. Target updated.`
          : null
      )
    } catch (error) {
      setPreviewNote(null)
      setPreviewError(error instanceof Error ? error.message : 'Could not preview this pool')
    }
  }

  function applyPool(nextPool: TargetManPool | null) {
    const category = categoriesQuery.data?.find((option) => option.id === p.categoryId)
    const baseLabel = category?.label ?? categoryTitle
    const nextPuzzle: Puzzle = { ...p, pool: nextPool }
    if (!p.categoryId || !baseLabel) {
      commitPuzzle(nextPuzzle)
      return
    }
    if (!nextPool) {
      commitPuzzle({
        ...nextPuzzle,
        pool: null,
        categoryLabel: baseLabel,
        title: baseLabel,
        label: baseLabel,
        target: category?.suggestedTarget ?? p.target,
      })
      setPreviewNote(null)
      setPreviewError(null)
      return
    }
    if (!normalizePool(nextPool)) {
      commitPuzzle(nextPuzzle)
      setPreviewNote(null)
      return
    }
    void refreshPreview(nextPuzzle, nextPool)
  }

  function applyRaw() {
    try {
      onChange(p, JSON.parse(rawText) as unknown)
      setRawError(null)
    } catch (error) {
      setRawError(error instanceof Error ? error.message : 'Invalid JSON')
    }
  }

  return (
    <div className="mode-editor">
      <div className="editor-clean-summary">
        <div>
          <span className="muted tiny">Category</span>
          <strong>{categoryTitle || 'Unlabelled'}</strong>
        </div>
        <div>
          <span className="muted tiny">Pool</span>
          <strong>
            {pool?.type === 'nationality' && pool.nationality
              ? pool.nationality
              : pool?.type === 'club' && pool.club
                ? pool.club
                : 'Everyone'}
          </strong>
        </div>
        <div>
          <span className="muted tiny">Target</span>
          <strong>{p.target ?? '—'} {p.valueNoun ?? ''}</strong>
        </div>
      </div>
      <div className="editor-clean-section">
        <header>
          <strong>Target Man setup</strong>
          <span className="muted tiny">Changes are kept in sync automatically</span>
        </header>
        <label className="field">
          Category
          <select
            value={p.categoryId ?? ''}
            disabled={locked || categoriesQuery.isLoading}
            onChange={(event) => {
              const category = categoriesQuery.data?.find(
                (option) => option.id === event.target.value
              )
              if (category) selectCategory(category)
            }}
          >
            {!p.categoryId && <option value="">Choose a category</option>}
            {p.categoryId &&
              !categoriesQuery.data?.some((option) => option.id === p.categoryId) && (
                <option value={p.categoryId}>{categoryTitle || p.categoryId}</option>
              )}
            {categoriesQuery.data?.map((category) => (
              <option value={category.id} key={category.id}>
                {category.label}
              </option>
            ))}
          </select>
        </label>
        <p className="muted tiny">
          Changing category also updates the suggested target, units and near-miss wording.
        </p>
        {categoriesQuery.error && (
          <p className="error-box">Categories could not be loaded. Refresh and try again.</p>
        )}
        <label className="field">
          Player pool
          <select
            value={poolType}
            disabled={locked}
            onChange={(event) => {
              const type = event.target.value
              if (type === 'nationality') {
                applyPool({ type: 'nationality', nationality: null })
                return
              }
              if (type === 'club') {
                applyPool({ type: 'club', club: null, teamId: null })
                return
              }
              applyPool(null)
            }}
          >
            <option value="">Everyone</option>
            <option value="nationality">Country</option>
            <option value="club">Club</option>
          </select>
        </label>
        {poolType === 'nationality' && (
          <div className="row">
            <EntityPicker
              kind="nationality"
              label="Country"
              valueLabel={pool?.nationality ?? undefined}
              disabled={locked}
              onPickNationality={(hit) =>
                applyPool({ type: 'nationality', nationality: hit.name })
              }
            />
          </div>
        )}
        {poolType === 'club' && (
          <div className="row">
            <EntityPicker
              kind="team"
              label="Club"
              valueLabel={pool?.club ?? undefined}
              disabled={locked}
              onPickTeam={(hit) =>
                applyPool({ type: 'club', club: hit.name, teamId: hit.id })
              }
            />
          </div>
        )}
        <p className="muted tiny">
          Optional. Narrows who can score — e.g. Premier League Goals from England players.
          The stat itself stays the same.
        </p>
        {previewNote && <p className="muted tiny">{previewNote}</p>}
        {previewError && <p className="error-box">{previewError}</p>}
        <div className="row">
          <label className="field">
            Target
            <input
              type="number"
              value={p.target ?? ''}
              disabled={locked}
              onChange={(e) => updatePuzzle({ target: Number(e.target.value) })}
            />
          </label>
          <label className="field">
            Unit
            <input
              value={p.unit ?? ''}
              disabled={locked}
              onChange={(e) => updatePuzzle({ unit: e.target.value || null })}
            />
          </label>
        </div>
        <div className="row">
          <label className="field">
            Answer unit
            <input
              value={p.valueNoun ?? ''}
              disabled={locked}
              onChange={(e) => updatePuzzle({ valueNoun: e.target.value })}
            />
          </label>
          <label className="field">
            Near-miss wording
            <input
              value={p.offNoun ?? ''}
              disabled={locked}
              onChange={(e) => updatePuzzle({ offNoun: e.target.value })}
            />
          </label>
        </div>
        <details className="advanced-panel">
          <summary>Advanced</summary>
          <p className="muted tiny">
            Developer fallback only. Use these controls only when the standard fields cannot represent the answer.
          </p>
          <label className="field">
            Category key
            <input
              value={p.categoryId ?? ''}
              disabled={locked}
              placeholder="e.g. pl_goals"
              onChange={(e) => updatePuzzle({ categoryId: e.target.value })}
            />
          </label>
          <label className="field">
            Answer data
          <textarea
            rows={9}
            disabled={locked}
            value={rawText}
            aria-invalid={rawError ? true : undefined}
            onChange={(e) => {
              setRawText(e.target.value)
              try {
                JSON.parse(e.target.value)
                setRawError(null)
              } catch (error) {
                setRawError(error instanceof Error ? error.message : 'Invalid JSON')
              }
            }}
          />
          </label>
          {rawError && <p className="error-box">Parse error: {rawError}</p>}
          <div className="json-actions">
            <button type="button" disabled={locked || Boolean(rawError)} onClick={applyRaw}>
              Apply answer data
            </button>
            <button
              type="button"
              className="ghost"
              disabled={locked}
              onClick={() => {
                setRawText(JSON.stringify(answer ?? null, null, 2))
                setRawError(null)
              }}
            >
              Reset
            </button>
          </div>
        </details>
      </div>
    </div>
  )
}
