import { useEffect, useMemo, useRef, useState } from 'react'
import {
  api,
  type AdminPlayerHit,
  type OneMoreCandidatePair,
  type OneMoreMetricCandidate,
  type OneMoreMetricCatalogItem,
  type OneMoreMetricPreview,
  type OneMoreVerificationResponse,
  type QuestionTemplate,
} from '../api'
import { EntityPicker } from '../components/EntityPicker'
import './one-more.css'

type Opt = {
  id: string
  name: string
  value: number
  nationality: string
  position: string
  clubs: string
  headshotUrl?: string
  teamId?: number
  teamLogoUrl?: string
  [k: string]: unknown
}

type Round = {
  options: Opt[]
  [k: string]: unknown
}

type Puzzle = {
  modeId?: string
  puzzleId?: string
  date?: string
  metricId?: string
  title?: string
  valueNoun?: string
  minimum?: number
  compareMode?: boolean
  rounds: Round[]
  [k: string]: unknown
}

type Answer = {
  valuesByRound?: Array<Record<string, number>>
  [k: string]: unknown
}

const EMPTY_ANSWER: Answer = {}
const EMPTY_ROUNDS: Round[] = []

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong'
}

function normalizeMetricTitle(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/^who has\s+(?:\d+\+?\s+)?/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function inferMetric(title: string, metrics: OneMoreMetricCatalogItem[]): OneMoreMetricCatalogItem | undefined {
  const normalized = normalizeMetricTitle(title)
  if (!normalized) return undefined
  return metrics.find((metric) => {
    const candidate = normalizeMetricTitle(metric.title)
    return normalized === candidate || normalized.includes(candidate) || candidate.includes(normalized)
  })
}

function candidateToOption(candidate: OneMoreMetricCandidate): Opt {
  return {
    id: candidate.id,
    name: candidate.name,
    value: candidate.value,
    nationality: candidate.nationality,
    position: candidate.position,
    clubs: '',
  }
}

function valuesForRounds(rounds: Round[], answer: Answer): Array<Record<string, number>> {
  return rounds.map((round, roundIndex) => {
    const saved = answer.valuesByRound?.[roundIndex] ?? {}
    return Object.fromEntries(
      round.options
        .map((option) => [option.id, saved[option.id] ?? option.value] as const)
        .filter((entry): entry is readonly [string, number] => typeof entry[1] === 'number')
    )
  })
}

export function OneMoreEditor({
  puzzle,
  answer,
  locked,
  onChange,
}: {
  puzzle: unknown
  answer: unknown
  locked: boolean
  onChange: (puzzle: Puzzle, answer: Answer) => void
}) {
  const p = puzzle as Puzzle
  const a = (answer as Answer | null) ?? EMPTY_ANSWER
  const rounds = p.rounds ?? EMPTY_ROUNDS
  const valuesByRound = useMemo(() => valuesForRounds(rounds, a), [rounds, a])
  const puzzleRef = useRef(p)
  const answerRef = useRef(a)
  const [metrics, setMetrics] = useState<OneMoreMetricCatalogItem[]>([])
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [preview, setPreview] = useState<OneMoreMetricPreview | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [busyRound, setBusyRound] = useState<number | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [candidateWarnings, setCandidateWarnings] = useState<string[]>([])
  const [verification, setVerification] = useState<OneMoreVerificationResponse | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [templates, setTemplates] = useState<QuestionTemplate[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [templateName, setTemplateName] = useState('')
  const [templateBusy, setTemplateBusy] = useState(false)

  useEffect(() => {
    puzzleRef.current = p
    answerRef.current = a
  }, [p, a])

  useEffect(() => {
    let cancelled = false
    void api.oneMoreMetrics()
      .then((items) => {
        if (!cancelled) setMetrics(items)
      })
      .catch((error: unknown) => {
        if (!cancelled) setCatalogError(readableError(error))
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void api.listQuestionTemplates({ mode: 'one_more' })
      .then((items) => {
        if (!cancelled) setTemplates(items.filter((item) => item.status !== 'archived'))
      })
      .catch(() => {
        if (!cancelled) setTemplates([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const inferredMetric = useMemo(
    () => (!p.metricId ? inferMetric(p.title ?? '', metrics) : undefined),
    [p.metricId, p.title, metrics]
  )
  const metricId = p.metricId && metrics.some((metric) => metric.id === p.metricId)
    ? p.metricId
    : inferredMetric?.id ?? ''
  const selectedMetric = metrics.find((metric) => metric.id === metricId)
  const minimum = Number.isFinite(p.minimum) ? Math.max(0, Math.round(p.minimum ?? 0)) : 0
  const compareMode = Boolean(p.compareMode)

  useEffect(() => {
    if (!metricId || rounds.length === 0 || rounds.some((round) => round.options.length !== 2)) {
      setVerification(null)
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      setVerifying(true)
      const pairs = rounds.map((round, roundIndex) => {
        const row = valuesByRound[roundIndex] ?? {}
        return [
          { playerId: round.options[0]!.id, expectedValue: row[round.options[0]!.id] },
          { playerId: round.options[1]!.id, expectedValue: row[round.options[1]!.id] },
        ] as [
          { playerId: string; expectedValue?: number },
          { playerId: string; expectedValue?: number },
        ]
      })
      void api.verifyOneMorePairs({ metricId, threshold: minimum, compareMode, pairs })
        .then((result) => {
          if (!cancelled) setVerification(result)
        })
        .catch(() => {
          if (!cancelled) setVerification(null)
        })
        .finally(() => {
          if (!cancelled) setVerifying(false)
        })
    }, 250)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [metricId, minimum, compareMode, rounds, valuesByRound])

  function commit(nextPuzzle: Puzzle, nextAnswer: Answer = answerRef.current) {
    puzzleRef.current = nextPuzzle
    answerRef.current = nextAnswer
    onChange(nextPuzzle, nextAnswer)
  }

  function updatePuzzle(patch: Partial<Puzzle>) {
    if (locked) return
    commit({ ...puzzleRef.current, ...patch })
  }

  function selectMetric(nextId: string) {
    if (locked) return
    const metric = metrics.find((item) => item.id === nextId)
    setPreview(null)
    setCandidateWarnings([])
    setActionError(null)
    if (!metric) {
      updatePuzzle({ metricId: undefined })
      return
    }
    updatePuzzle({
      metricId: metric.id,
      title: metric.title,
      valueNoun: metric.noun,
      minimum: metric.ladder[0] ?? 0,
    })
  }

  function applyTemplate(templateId: string) {
    if (locked || !templateId) return
    const template = templates.find((item) => item.id === templateId)
    if (!template) return
    const config = template.config
    const templateMetricId = typeof config.metricId === 'string' ? config.metricId : ''
    const threshold = typeof config.threshold === 'number' ? config.threshold : undefined
    const valueNoun = typeof config.valueNoun === 'string' ? config.valueNoun : undefined
    const templateCompare = config.compareMode === true
    updatePuzzle({
      title: template.prompt,
      compareMode: templateCompare,
      ...(templateMetricId ? { metricId: templateMetricId } : {}),
      ...(threshold !== undefined ? { minimum: threshold } : {}),
      ...(valueNoun ? { valueNoun } : {}),
    })
    setPreview(null)
  }

  async function saveTemplate() {
    if (locked || !metricId || !templateName.trim()) return
    setTemplateBusy(true)
    setActionError(null)
    try {
      const created = await api.createQuestionTemplate({
        mode: 'one_more',
        name: templateName.trim(),
        prompt: p.title?.trim() || selectedMetric?.title || 'One More question',
        config: {
          metricId,
          threshold: compareMode ? 0 : minimum,
          compareMode,
          valueNoun: p.valueNoun ?? selectedMetric?.noun ?? '',
        },
        status: 'draft',
      })
      setTemplates((current) => [created, ...current])
      setSelectedTemplateId(created.id)
      setTemplateName('')
    } catch (error) {
      setActionError(readableError(error))
    } finally {
      setTemplateBusy(false)
    }
  }

  async function setTemplateStatus(status: 'active' | 'archived') {
    if (locked || !selectedTemplateId) return
    setTemplateBusy(true)
    setActionError(null)
    try {
      const updated = await api.updateQuestionTemplate(selectedTemplateId, { status })
      if (status === 'archived') {
        setTemplates((current) => current.filter((item) => item.id !== selectedTemplateId))
        setSelectedTemplateId('')
      } else {
        setTemplates((current) =>
          current.map((item) => (item.id === updated.id ? updated : item))
        )
      }
    } catch (error) {
      setActionError(readableError(error))
    } finally {
      setTemplateBusy(false)
    }
  }

  async function loadPreview() {
    if (!metricId) {
      setActionError('Select a metric before previewing.')
      return
    }
    setPreviewing(true)
    setActionError(null)
    try {
      setPreview(await api.previewOneMoreMetric(metricId, minimum))
    } catch (error) {
      setActionError(readableError(error))
    } finally {
      setPreviewing(false)
    }
  }

  function applyPairs(pairs: OneMoreCandidatePair[], metric: OneMoreMetricCatalogItem, threshold: number) {
    const nextRounds: Round[] = pairs.map((pair) => ({
      options: [candidateToOption(pair.options[0]), candidateToOption(pair.options[1])],
    }))
    const nextValues = nextRounds.map((round) =>
      Object.fromEntries(round.options.map((option) => [option.id, option.value]))
    )
    commit(
      {
        ...puzzleRef.current,
        metricId: metric.id,
        title: metric.title,
        valueNoun: metric.noun,
        minimum: threshold,
        rounds: nextRounds,
      },
      { ...answerRef.current, valuesByRound: nextValues }
    )
  }

  async function generateTen() {
    if (locked) return
    if (!metricId) {
      setActionError('Select a metric before generating candidates.')
      return
    }
    setGenerating(true)
    setActionError(null)
    try {
      const result = await api.generateOneMoreCandidates({
        metricId,
        threshold: compareMode ? 0 : minimum,
        compareMode,
        count: 10,
        seed: `${p.date ?? 'ops'}:${Date.now()}`,
      })
      setCandidateWarnings(result.warnings)
      if (result.pairs.length !== 10) {
        setActionError(`Only ${result.pairs.length} suitable pairs were found. Ten are required, so the rounds were left unchanged.`)
        return
      }
      applyPairs(result.pairs, result.metric, result.threshold)
    } catch (error) {
      setActionError(readableError(error))
    } finally {
      setGenerating(false)
    }
  }

  function replaceRound(roundIndex: number, pair: OneMoreCandidatePair) {
    const currentPuzzle = puzzleRef.current
    const currentAnswer = answerRef.current
    const nextOptions = [candidateToOption(pair.options[0]), candidateToOption(pair.options[1])]
    const nextRounds = (currentPuzzle.rounds ?? []).map((round, index) =>
      index === roundIndex ? { ...round, options: nextOptions } : round
    )
    const nextValues = valuesForRounds(currentPuzzle.rounds ?? [], currentAnswer).map((row, index) =>
      index === roundIndex
        ? Object.fromEntries(nextOptions.map((option) => [option.id, option.value]))
        : row
    )
    commit({ ...currentPuzzle, rounds: nextRounds }, { ...currentAnswer, valuesByRound: nextValues })
  }

  async function regenerateRound(roundIndex: number) {
    if (locked || !metricId) return
    setBusyRound(roundIndex)
    setActionError(null)
    try {
      const result = await api.generateOneMoreCandidates({
        metricId,
        threshold: compareMode ? 0 : minimum,
        compareMode,
        count: 30,
        seed: `${p.date ?? 'ops'}:round-${roundIndex}:${Date.now()}`,
      })
      const allCurrentIds = new Set((puzzleRef.current.rounds ?? []).flatMap((round) => round.options.map((option) => option.id)))
      const roundIds = new Set((puzzleRef.current.rounds?.[roundIndex]?.options ?? []).map((option) => option.id))
      const freshPair = result.pairs.find((pair) => pair.options.every((option) => !allCurrentIds.has(option.id)))
        ?? result.pairs.find((pair) => pair.options.every((option) => !roundIds.has(option.id)))
      if (!freshPair) throw new Error('No suitable replacement pair was available. Try again.')
      replaceRound(roundIndex, freshPair)
      setCandidateWarnings(result.warnings)
    } catch (error) {
      setActionError(readableError(error))
    } finally {
      setBusyRound(null)
    }
  }

  async function pickPlayer(roundIndex: number, optionIndex: number, hit: AdminPlayerHit) {
    if (locked || !metricId) throw new Error('Select a metric before swapping a player.')
    setBusyRound(roundIndex)
    try {
      const lookup = await api.lookupOneMorePlayerValue(metricId, hit.id)
      const currentPuzzle = puzzleRef.current
      const currentAnswer = answerRef.current
      const nextOption: Opt = {
        id: hit.id,
        name: hit.name,
        value: lookup.value,
        nationality: hit.nationality,
        position: hit.position,
        clubs: hit.club,
        headshotUrl: hit.headshotUrl,
        teamLogoUrl: hit.teamLogoUrl,
      }
      const nextRounds = (currentPuzzle.rounds ?? []).map((round, index) => {
        if (index !== roundIndex) return round
        return {
          ...round,
          options: round.options.map((option, indexInRound) =>
            indexInRound === optionIndex ? nextOption : option
          ),
        }
      })
      const nextValues = valuesForRounds(currentPuzzle.rounds ?? [], currentAnswer).map((row, index) => {
        if (index !== roundIndex) return row
        const oldId = currentPuzzle.rounds?.[roundIndex]?.options[optionIndex]?.id
        const nextRow = { ...row, [nextOption.id]: nextOption.value }
        if (oldId && oldId !== nextOption.id) delete nextRow[oldId]
        return nextRow
      })
      commit({ ...currentPuzzle, rounds: nextRounds }, { ...currentAnswer, valuesByRound: nextValues })
    } finally {
      setBusyRound(null)
    }
  }

  function updateOverride(roundIndex: number, optionIndex: number, value: number) {
    if (locked) return
    const currentPuzzle = puzzleRef.current
    const currentAnswer = answerRef.current
    const option = currentPuzzle.rounds?.[roundIndex]?.options[optionIndex]
    if (!option) return
    const nextRounds = currentPuzzle.rounds.map((round, index) => ({
      ...round,
      options: index === roundIndex
        ? round.options.map((item, itemIndex) => itemIndex === optionIndex ? { ...item, value } : item)
        : round.options,
    }))
    const nextValues = valuesForRounds(currentPuzzle.rounds, currentAnswer).map((row, index) =>
      index === roundIndex ? { ...row, [option.id]: value } : row
    )
    commit({ ...currentPuzzle, rounds: nextRounds }, { ...currentAnswer, valuesByRound: nextValues })
  }

  function applyVerifiedValues() {
    if (locked || !verification) return
    const currentPuzzle = puzzleRef.current
    const currentAnswer = answerRef.current
    const nextRounds = currentPuzzle.rounds.map((round, roundIndex) => ({
      ...round,
      options: round.options.map((option) => {
        const verified = verification.pairs[roundIndex]?.options.find((item) => item.playerId === option.id)
        return verified?.actualValue == null ? option : { ...option, value: verified.actualValue }
      }),
    }))
    const nextValues = nextRounds.map((round) =>
      Object.fromEntries(round.options.map((option) => [option.id, option.value]))
    )
    commit({ ...currentPuzzle, rounds: nextRounds }, { ...currentAnswer, valuesByRound: nextValues })
  }

  const hasValueMismatch = verification?.pairs.some((pair) =>
    pair.options.some((option) => option.actualValue !== null && !option.valueMatches)
  ) ?? false
  const localWarnings = useMemo(() => {
    const warnings: string[] = []
    if (rounds.length !== 10) warnings.push(`Exactly 10 rounds are required; this puzzle has ${rounds.length}.`)
    const seen = new Set<string>()
    rounds.forEach((round, roundIndex) => {
      if (round.options.length !== 2) {
        warnings.push(`Round ${roundIndex + 1} must contain exactly two players.`)
        return
      }
      const states = round.options.map((option) => {
        if (seen.has(option.id)) warnings.push(`${option.name} appears more than once.`)
        seen.add(option.id)
        const verifiedOption = verification?.pairs[roundIndex]?.options.find((item) => item.playerId === option.id)
        const value = verifiedOption?.actualValue ?? valuesByRound[roundIndex]?.[option.id]
        return typeof value === 'number' ? value : null
      })
      if (states.some((state) => state === null)) {
        warnings.push(`Round ${roundIndex + 1} has a player without a verified value.`)
      } else if (compareMode) {
        if (states[0] === states[1]) {
          warnings.push(`Round ${roundIndex + 1} needs two different totals — the higher one is the answer.`)
        }
      } else if (states.filter((value) => (value as number) >= minimum).length !== 1) {
        warnings.push(`Round ${roundIndex + 1} needs one qualifier and one distractor.`)
      }
    })
    return [...new Set(warnings)]
  }, [rounds, verification, valuesByRound, minimum, compareMode])

  return (
    <div className="mode-editor one-more-editor">
      <section className="q-card one-more-composer">
        <header>
          <div>
            <strong>Question composer</strong>
            <p className="muted tiny">
              {compareMode
                ? 'Choose what to measure, then build ten “who has more” rounds.'
                : 'Choose what to measure, set the target, then build ten rounds.'}
            </p>
          </div>
          {locked && <span className="om-lock-badge">Locked</span>}
        </header>

        {catalogError && <div className="error-box">{catalogError}</div>}
        {!p.metricId && inferredMetric && (
          <div className="om-notice">This older question matches <strong>{inferredMetric.title}</strong>. Review it before making changes.</div>
        )}
        {!metricId && metrics.length > 0 && (
          <div className="warning-box">Choose what this question measures before checking or changing players.</div>
        )}

        <div className="om-template-bar">
          <label className="field">
            Reusable template
            <select
              value={selectedTemplateId}
              disabled={locked || templates.length === 0}
              onChange={(event) => {
                setSelectedTemplateId(event.target.value)
                applyTemplate(event.target.value)
              }}
            >
              <option value="">Load a saved template…</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name} · {template.status}
                </option>
              ))}
            </select>
            {selectedTemplateId && (
              <span className="om-template-save">
                <button
                  type="button"
                  className="ghost"
                  disabled={locked || templateBusy || templates.find((item) => item.id === selectedTemplateId)?.status === 'active'}
                  onClick={() => void setTemplateStatus('active')}
                >
                  Activate
                </button>
                <button
                  type="button"
                  className="ghost"
                  disabled={locked || templateBusy}
                  onClick={() => void setTemplateStatus('archived')}
                >
                  Archive
                </button>
              </span>
            )}
          </label>
          <label className="field">
            Save current setup
            <span className="om-template-save">
              <input
                value={templateName}
                disabled={locked}
                placeholder="Template name"
                onChange={(event) => setTemplateName(event.target.value)}
              />
              <button
                type="button"
                className="ghost"
                disabled={locked || templateBusy || !metricId || !templateName.trim()}
                onClick={() => void saveTemplate()}
              >
                {templateBusy ? 'Saving…' : 'Save template'}
              </button>
            </span>
          </label>
        </div>

        <div className="om-config-grid">
          <label className="field">
            Measure
            <select value={metricId} disabled={locked} onChange={(event) => selectMetric(event.target.value)}>
              <option value="">Select a metric…</option>
              {metrics.map((metric) => <option key={metric.id} value={metric.id}>{metric.title}</option>)}
            </select>
          </label>
          <label className="field om-title-field">
            Question
            <input
              value={p.title ?? ''}
              disabled={locked}
              placeholder="e.g. Premier League goals"
              onChange={(event) => updatePuzzle({ title: event.target.value })}
            />
          </label>
          <label className="field">
            Answer unit
            <input
              value={p.valueNoun ?? ''}
              disabled={locked}
              placeholder="goals"
              onChange={(event) => updatePuzzle({ valueNoun: event.target.value })}
            />
          </label>
          <div className="field om-win-rule">
            Win rule
            <div className="om-format-toggle" role="group" aria-label="Win rule">
              <button
                type="button"
                className={compareMode ? '' : 'selected'}
                disabled={locked}
                onClick={() => {
                  setPreview(null)
                  updatePuzzle({ compareMode: false })
                }}
              >
                Target
              </button>
              <button
                type="button"
                className={compareMode ? 'selected' : ''}
                disabled={locked}
                onClick={() => {
                  setPreview(null)
                  updatePuzzle({ compareMode: true, minimum: 0 })
                }}
              >
                Just more
              </button>
            </div>
          </div>
          {!compareMode && (
            <label className="field">
              Target
              <input
                type="number"
                min={0}
                step={1}
                value={minimum}
                disabled={locked}
                onChange={(event) => updatePuzzle({ minimum: Math.max(0, Math.round(Number(event.target.value))) })}
              />
            </label>
          )}
        </div>

        {compareMode && (
          <div className="om-notice">
            The answer is whoever has more {p.valueNoun || 'of this stat'}. Don’t lock this day until the new app is out — older builds still expect a 15+ style target.
          </div>
        )}

        {selectedMetric && !compareMode && (
          <div className="om-thresholds">
            <span className="muted tiny">Suggested targets</span>
            {selectedMetric.ladder.map((threshold) => (
              <button
                type="button"
                key={threshold}
                className={threshold === minimum ? 'om-threshold active' : 'om-threshold'}
                disabled={locked}
                onClick={() => updatePuzzle({ minimum: threshold })}
              >
                {threshold}+
              </button>
            ))}
          </div>
        )}
        {selectedMetric?.eventBased && (
          <div className="warning-box">Results before roughly 2010 may be incomplete, so older players are limited automatically.</div>
        )}

        <div className="om-actions">
          {!compareMode && (
            <button type="button" className="ghost" disabled={!metricId || previewing} onClick={() => void loadPreview()}>
              {previewing ? 'Checking players…' : 'Check player pool'}
            </button>
          )}
          <button type="button" disabled={locked || !metricId || generating} onClick={() => void generateTen()}>
            {generating ? 'Building rounds…' : 'Build 10 rounds'}
          </button>
          {hasValueMismatch && (
            <button type="button" className="ghost" disabled={locked} onClick={applyVerifiedValues}>Use verified values</button>
          )}
          <span className="muted tiny">{verifying ? 'Checking rounds…' : verification ? `${verification.pairs.filter((pair) => pair.valid).length}/${verification.pairs.length} rounds verified` : ''}</span>
        </div>

        {actionError && <div className="error-box">{actionError}</div>}
        {[...candidateWarnings, ...localWarnings].map((warning) => <div key={warning} className="warning-box">{warning}</div>)}

        {preview && !compareMode && (
          <div className="om-preview">
            <div className="om-preview-stats">
              <div><strong>{preview.counts.qualifying}</strong><span>meet the target</span></div>
              <div><strong>{preview.counts.distractors}</strong><span>below the target</span></div>
              <div><strong>{preview.counts.verifiedPairs}</strong><span>usable pairs</span></div>
              <div><strong>{preview.counts.participating}</strong><span>players checked</span></div>
            </div>
            {preview.suggestedThreshold !== preview.threshold && (
              <p className="om-notice">Suggested target: <strong>{preview.suggestedThreshold}+</strong></p>
            )}
            {preview.warnings.map((warning) => <div key={warning} className="warning-box">{warning}</div>)}
            <div className="om-sample-grid">
              <div>
                <strong>Meets the target</strong>
                <ul>{preview.samples.qualifying.map((candidate) => <li key={candidate.id}>{candidate.name}<b>{candidate.value}</b></li>)}</ul>
              </div>
              <div>
                <strong>Below the target</strong>
                <ul>{preview.samples.distractors.map((candidate) => <li key={candidate.id}>{candidate.name}<b>{candidate.value}</b></li>)}</ul>
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="q-card om-rounds-section">
        <header>
          <div>
            <strong>Rounds {rounds.length}/10</strong>
            <p className="muted tiny">
              {compareMode
                ? 'Every pair needs two different totals — the higher player is the answer.'
                : `Every pair needs exactly one player at or above ${minimum}.`}
            </p>
          </div>
        </header>
        <div className="om-round-list">
          {rounds.map((round, roundIndex) => {
            const pairVerification = verification?.pairs[roundIndex]
            return (
              <article key={roundIndex} className={pairVerification?.valid ? 'om-round valid' : 'om-round'}>
                <div className="om-round-heading">
                  <span className="om-round-number">{roundIndex + 1}</span>
                  <span className={pairVerification?.valid ? 'om-verified valid' : 'om-verified'}>
                    {pairVerification?.valid ? '✓ Verified' : verifying ? 'Checking…' : 'Needs review'}
                  </span>
                  <button
                    type="button"
                    className="ghost om-regenerate"
                    disabled={locked || !metricId || busyRound !== null}
                    onClick={() => void regenerateRound(roundIndex)}
                  >
                    {busyRound === roundIndex ? 'Regenerating…' : 'Regenerate round'}
                  </button>
                </div>
                <div className="om-pair">
                  {round.options.map((option, optionIndex) => {
                    const verifiedOption = pairVerification?.options.find((item) => item.playerId === option.id)
                    const value = verifiedOption?.actualValue ?? valuesByRound[roundIndex]?.[option.id] ?? option.value
                    const otherId = round.options[optionIndex === 0 ? 1 : 0]?.id
                    const otherValue = otherId
                      ? pairVerification?.options.find((item) => item.playerId === otherId)?.actualValue
                        ?? valuesByRound[roundIndex]?.[otherId]
                      : undefined
                    const qualifies = typeof value !== 'number'
                      ? null
                      : compareMode
                        ? (typeof otherValue === 'number' ? value > otherValue : null)
                        : value >= minimum
                    return (
                      <div key={`${option.id}-${optionIndex}`} className={qualifies === true ? 'om-player qualifies' : qualifies === false ? 'om-player distractor' : 'om-player'}>
                        <div className="om-player-state">
                          <span>
                            {compareMode
                              ? (qualifies ? 'More' : qualifies === false ? 'Fewer' : 'No value')
                              : (qualifies ? `At least ${minimum}` : qualifies === false ? `Below ${minimum}` : 'No value')}
                          </span>
                          <strong>{value} {p.valueNoun ?? ''}</strong>
                        </div>
                        <EntityPicker
                          key={`${option.id}-${option.headshotUrl ?? ''}-${option.name}`}
                          kind="player"
                          label={optionIndex === 0 ? 'Player A' : 'Player B'}
                          valueLabel={option.name}
                          imageUrl={option.headshotUrl ?? option.teamLogoUrl}
                          nationality={option.nationality}
                          disabled={locked || busyRound === roundIndex}
                          onPickPlayer={(hit) => pickPlayer(roundIndex, optionIndex, hit)}
                        />
                        <p className="muted tiny">{[option.position, option.clubs].filter(Boolean).join(' · ') || 'Player details unavailable'}</p>
                        {verifiedOption && (
                          <p className={verifiedOption.valueMatches ? 'om-db-value ok' : 'om-db-value mismatch'}>
                            {verifiedOption.valueMatches ? 'Value verified' : `Saved value differs (${verifiedOption.actualValue ?? 'not found'})`}
                          </p>
                        )}
                        <details className="advanced-panel">
                          <summary>Advanced</summary>
                          <div className="warning-box tiny">Manual changes may make the answer inaccurate. Prefer “Use verified values”.</div>
                          <label className="field">
                            Override value
                            <input
                              type="number"
                              min={0}
                              value={valuesByRound[roundIndex]?.[option.id] ?? option.value}
                              disabled={locked}
                              onChange={(event) => updateOverride(roundIndex, optionIndex, Math.max(0, Math.round(Number(event.target.value))))}
                            />
                          </label>
                        </details>
                      </div>
                    )
                  })}
                </div>
                {pairVerification?.errors.map((error) => <p key={error} className="error tiny">{error}</p>)}
              </article>
            )
          })}
        </div>
      </section>
    </div>
  )
}
