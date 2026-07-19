import { useEffect, useRef, useState } from 'react'
import {
  api,
  type AdminGolfTemplate,
  type GolfRarity,
  type GolfRuleEvaluation,
  type GolfTowerRule,
} from '../api'
import { EntityPicker } from '../components/EntityPicker'
import { canonicalRuleKey, golfRulesSemanticallyEqual } from './golfRuleUtils'
import './game-editors.css'
import './golf-editor.css'

type Answer = {
  id?: string
  name: string
  aliases?: string[]
  rarity?: GolfRarity | string
  headshotUrl?: string
  [k: string]: unknown
}

type Hole = {
  id?: string
  holeNumber: number
  prompt: string
  par: number
  target?: number
  category?: string
  hints?: string[]
  answers: Answer[]
  rule?: GolfTowerRule
  templateId?: string
  [k: string]: unknown
}

type Puzzle = {
  holes: Hole[]
  totalPar?: number
  [k: string]: unknown
}

const RARITIES = ['common', 'uncommon', 'rare', 'ultraRare'] as const
const REQUIRED_HOLE_COUNT = 5
const TEMPLATE_CATEGORY_ORDER = [
  'Seasons',
  'Tournaments',
  'Club Eras',
  'Finals',
  'Achievements',
  'Clubs',
  'Transfers',
  'Managers',
] as const
const SEASON_OPTIONS = Array.from({ length: 12 }, (_, index) => {
  const season = 2025 - index
  const start = String(season).slice(2)
  const end = String(season + 1).slice(2)
  return { value: season, label: `${start}/${end}` }
})
const SEASON_LEAGUES = [
  { id: 39, name: 'Premier League' },
  { id: 140, name: 'La Liga' },
  { id: 135, name: 'Serie A' },
  { id: 78, name: 'Bundesliga' },
  { id: 61, name: 'Ligue 1' },
  { id: 2, name: 'Champions League' },
] as const

function leaguesFromRule(rule: GolfTowerRule): string[] {
  if (rule.leaguesPlayed && rule.leaguesPlayed.length > 0) return rule.leaguesPlayed
  return rule.leaguePlayed ? [rule.leaguePlayed] : []
}

type BusyAction = 'template' | 'generate'
type AnswerUpdateState =
  | { holeKey: string; status: 'pending' }
  | { holeKey: string; status: 'success'; count: number }
  | { holeKey: string; status: 'warning' | 'error'; message: string }

const INTEGER_RULE_FIELDS: Array<{
  key: keyof GolfTowerRule
  label: string
  max: number
  prefix?: string
}> = [
  { key: 'minPlApps', label: 'Minimum Premier League appearances', max: 1_000 },
  { key: 'minPlGoals', label: 'Minimum Premier League goals', max: 1_000 },
  { key: 'minPlAssists', label: 'Minimum Premier League assists', max: 1_000 },
  { key: 'minPlYellowCards', label: 'Minimum PL yellow cards', max: 1_000 },
  { key: 'minPlCleanSheets', label: 'Minimum PL clean sheets', max: 1_000 },
  { key: 'minUclApps', label: 'Minimum Champions League appearances', max: 500 },
  { key: 'minUclGoals', label: 'Minimum Champions League goals', max: 500 },
  { key: 'minPeakValueEur', label: 'Minimum peak market value', max: 2_000_000_000, prefix: '€' },
  { key: 'minRecordFeeEur', label: 'Minimum record transfer fee', max: 2_000_000_000, prefix: '€' },
]

function hasRuleSelector(rule: GolfTowerRule | undefined): rule is GolfTowerRule {
  return Boolean(rule && Object.keys(rule).some((key) => key !== 'label'))
}

function normalizeHoles(holes: Hole[]): Hole[] {
  return holes.map((hole, index) => {
    if (hole.rule && !hasRuleSelector(hole.rule)) {
      const { rule: _rule, templateId: _templateId, ...rest } = hole
      return { ...rest, holeNumber: index + 1 }
    }
    return { ...hole, holeNumber: index + 1 }
  })
}

function holeKey(hole: Hole): string {
  return hole.id ? `id:${hole.id}` : `number:${hole.holeNumber}`
}

function cleanRule(rule: GolfTowerRule): GolfTowerRule {
  return Object.fromEntries(
    Object.entries(rule).filter(([, value]) => value !== undefined)
  ) as GolfTowerRule
}

function rarityLabel(rarity: (typeof RARITIES)[number]): string {
  return rarity === 'ultraRare'
    ? 'Very rare'
    : rarity.charAt(0).toUpperCase() + rarity.slice(1)
}

function EvaluationSummary({ evaluation }: { evaluation: GolfRuleEvaluation }) {
  const examples = evaluation.answers.slice(0, 5).map((answer) => answer.name).join(', ')
  return (
    <div className="golf-evaluation">
      <div className="golf-counts">
        <span><strong>{evaluation.counts.total}</strong> answers</span>
        <span><strong>{evaluation.counts.nameable}</strong> well-known</span>
        <span>Par <strong>{evaluation.suggestedPar}</strong></span>
      </div>
      {examples && <p className="tiny muted">e.g. {examples}</p>}
      <p className="tiny muted">
        {evaluation.counts.rarity.common} common · {evaluation.counts.rarity.uncommon} uncommon
        {' · '}{evaluation.counts.rarity.rare} rare · {evaluation.counts.rarity.ultraRare} ultra
      </p>
      {evaluation.qualityWarnings.map((warning) => (
        <p className="warning-box tiny" key={warning}>{warning}</p>
      ))}
    </div>
  )
}

export function GolfEditor({
  puzzle,
  locked,
  onChange,
}: {
  puzzle: unknown
  locked: boolean
  onChange: (puzzle: Puzzle) => void
}) {
  const p = puzzle as Puzzle
  const holes = [...(p.holes ?? [])].sort((a, b) => a.holeNumber - b.holeNumber)
  const puzzleRef = useRef(p)
  const operationRef = useRef(0)
  const answerGenerationRef = useRef(0)
  const answerGenerationTimerRef = useRef<number | null>(null)
  const templateLoadRef = useRef(0)
  const [activeIndex, setActiveIndex] = useState(0)
  const [templates, setTemplates] = useState<AdminGolfTemplate[]>([])
  const [templateDetails, setTemplateDetails] = useState<Record<string, AdminGolfTemplate>>({})
  const [templatesBusy, setTemplatesBusy] = useState(false)
  const [busyAction, setBusyAction] = useState<BusyAction | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [evaluationState, setEvaluationState] = useState<{
    holeKey: string
    evaluation: GolfRuleEvaluation
  } | null>(null)
  const [staleHoleKeys, setStaleHoleKeys] = useState<Set<string>>(() => new Set())
  const [answerUpdateState, setAnswerUpdateState] = useState<AnswerUpdateState | null>(null)
  const activeHole = holes[Math.min(activeIndex, Math.max(holes.length - 1, 0))]
  const activeKey = activeHole ? holeKey(activeHole) : null
  const activeEvaluation =
    evaluationState?.holeKey === activeKey ? evaluationState.evaluation : null
  const activeTemplate = activeHole?.templateId
    ? templateDetails[activeHole.templateId] ??
      templates.find((template) => template.id === activeHole.templateId)
    : undefined
  const otherHoles = holes.filter((hole) => hole.holeNumber !== activeHole?.holeNumber)
  const usedRuleSignatures = new Set(
    otherHoles.flatMap((hole) => {
      const template = hole.templateId
        ? templateDetails[hole.templateId] ?? templates.find((item) => item.id === hole.templateId)
        : undefined
      return template ? [template.ruleSignature] : []
    })
  )
  const usedRuleKeys = new Set(
    otherHoles.map((hole) => canonicalRuleKey(hole.rule)).filter((key): key is string => key !== null)
  )
  const availableTemplates = templates.filter(
    (template) =>
      !usedRuleSignatures.has(template.ruleSignature)
      && !usedRuleKeys.has(canonicalRuleKey(template.rule) ?? '')
  )
  const templatesByCategory = TEMPLATE_CATEGORY_ORDER.map((category) => ({
    category,
    templates: availableTemplates.filter((template) => template.category === category),
  })).filter((group) => group.templates.length > 0)
  const answersStale = activeKey ? staleHoleKeys.has(activeKey) : false
  const activeAnswerUpdate =
    answerUpdateState?.holeKey === activeKey ? answerUpdateState : null
  const mutationsDisabled = locked || busyAction !== null

  useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(holes.length - 1, 0)))
  }, [holes.length])

  useEffect(() => {
    puzzleRef.current = p
  }, [p])

  useEffect(() => () => {
    if (answerGenerationTimerRef.current !== null) {
      window.clearTimeout(answerGenerationTimerRef.current)
    }
    answerGenerationRef.current += 1
  }, [])

  useEffect(() => {
    if (!locked) return
    answerGenerationRef.current += 1
    if (answerGenerationTimerRef.current !== null) {
      window.clearTimeout(answerGenerationTimerRef.current)
      answerGenerationTimerRef.current = null
    }
    operationRef.current += 1
    setBusyAction(null)
    setAnswerUpdateState(null)
  }, [locked])

  useEffect(() => {
    const requestId = ++templateLoadRef.current
    setTemplatesBusy(true)
    void api.listGolfTemplates('', 80)
      .then((rows) => {
        if (requestId !== templateLoadRef.current) return
        setTemplates(rows)
        setTemplateDetails((current) => {
          const next = { ...current }
          rows.forEach((row) => {
            next[row.id] = row
          })
          return next
        })
      })
      .catch((error: unknown) => {
        if (requestId === templateLoadRef.current) {
          setActionError(error instanceof Error ? error.message : 'Could not load Golf templates')
        }
      })
      .finally(() => {
        if (requestId === templateLoadRef.current) setTemplatesBusy(false)
      })
  }, [])

  function commitHoles(nextHoles: Hole[]) {
    const normalized = normalizeHoles(nextHoles)
    const nextPuzzle = {
      ...puzzleRef.current,
      holes: normalized,
      totalPar: normalized.reduce(
        (sum, hole) => sum + (Number.isFinite(hole.par) ? hole.par : 0),
        0
      ),
    }
    puzzleRef.current = nextPuzzle
    onChange(nextPuzzle)
  }

  function updateHole(n: number, patch: Partial<Hole>) {
    cancelScheduledAnswerGeneration()
    commitHoles(
      (puzzleRef.current.holes ?? []).map((h) =>
        h.holeNumber === n ? { ...h, ...patch } : h
      )
    )
  }

  function markAnswersStale(hole: Hole) {
    const key = holeKey(hole)
    setStaleHoleKeys((current) => new Set(current).add(key))
  }

  function clearAnswersStale(key: string) {
    setStaleHoleKeys((current) => {
      const next = new Set(current)
      next.delete(key)
      return next
    })
  }

  function updateRule(hole: Hole, change: (current: GolfTowerRule) => GolfTowerRule) {
    const nextRule = cleanRule(change(hole.rule ?? {}))
    const nextHole = { ...hole, rule: nextRule, templateId: undefined }
    updateHole(hole.holeNumber, { rule: nextRule, templateId: undefined })
    if (!golfRulesSemanticallyEqual(hole.rule, nextRule)) {
      markAnswersStale(hole)
      setEvaluationState((current) => current?.holeKey === holeKey(hole) ? null : current)
      scheduleAutomaticAnswerRefresh(nextHole, nextRule)
    }
  }

  function updateAnswer(n: number, idx: number, patch: Partial<Answer>) {
    const hole = puzzleRef.current.holes.find((h) => h.holeNumber === n)
    if (!hole) return
    const answers = hole.answers.map((a, i) => (i === idx ? { ...a, ...patch } : a))
    updateHole(n, { answers })
    markAnswersStale(hole)
    setAnswerUpdateState({
      holeKey: holeKey(hole),
      status: 'warning',
      message: 'Manual answers changed. Re-select the question or adjust its settings to restore the verified list.',
    })
  }

  async function pickAnswer(
    n: number,
    idx: number,
    hit: { id: string; name: string; headshotUrl?: string }
  ) {
    let resolved = {
      id: hit.id,
      name: hit.name,
      aliases: [] as string[],
      headshotUrl: hit.headshotUrl,
    }
    try {
      const full = (await api.resolvePlayer(hit.id, 'golf')) as {
        id?: string
        name?: string
        aliases?: string[]
        headshotUrl?: string
      }
      resolved = {
        id: full.id || hit.id,
        name: full.name || hit.name,
        aliases: full.aliases ?? [],
        headshotUrl: full.headshotUrl ?? hit.headshotUrl,
      }
    } catch {
      // search hit is enough
    }
    const hole = puzzleRef.current.holes.find((h) => h.holeNumber === n)
    if (!hole?.answers[idx]) return
    const prev = hole.answers[idx]!
    updateAnswer(n, idx, {
      id: resolved.id,
      name: resolved.name,
      aliases: resolved.aliases,
      headshotUrl: resolved.headshotUrl,
      rarity: prev.rarity ?? 'common',
    })
  }

  function addAnswer(n: number) {
    const hole = puzzleRef.current.holes.find((h) => h.holeNumber === n)
    if (!hole) return
    updateHole(n, { answers: [...hole.answers, { name: '', aliases: [], rarity: 'common' }] })
    markAnswersStale(hole)
    setAnswerUpdateState({
      holeKey: holeKey(hole),
      status: 'warning',
      message: 'Manual answers changed. Re-select the question or adjust its settings to restore the verified list.',
    })
  }

  function removeAnswer(n: number, idx: number) {
    const hole = puzzleRef.current.holes.find((h) => h.holeNumber === n)
    if (!hole) return
    updateHole(n, { answers: hole.answers.filter((_, i) => i !== idx) })
    markAnswersStale(hole)
    setAnswerUpdateState({
      holeKey: holeKey(hole),
      status: 'warning',
      message: 'Manual answers changed. Re-select the question or adjust its settings to restore the verified list.',
    })
  }

  function addHole() {
    if (holes.length >= REQUIRED_HOLE_COUNT) return
    cancelScheduledAnswerGeneration()
    commitHoles([
      ...holes,
      {
        holeNumber: holes.length + 1,
        id: `hole-${holes.length + 1}`,
        prompt: '',
        par: 3,
        target: 3,
        category: 'Seasons',
        hints: [],
        answers: [],
      },
    ])
    setActiveIndex(holes.length)
  }

  function moveHole(offset: -1 | 1) {
    const targetIndex = activeIndex + offset
    if (!activeHole || targetIndex < 0 || targetIndex >= holes.length) return
    cancelScheduledAnswerGeneration()
    const next = [...holes]
    ;[next[activeIndex], next[targetIndex]] = [next[targetIndex]!, next[activeIndex]!]
    commitHoles(next)
    setActiveIndex(targetIndex)
  }

  function operationTarget(hole: Hole) {
    return { key: holeKey(hole), id: hole.id, holeNumber: hole.holeNumber }
  }

  function currentOperationHole(target: ReturnType<typeof operationTarget>): Hole | undefined {
    return (puzzleRef.current.holes ?? []).find((hole) =>
      target.id ? hole.id === target.id : hole.holeNumber === target.holeNumber
    )
  }

  function answerGenerationWarning(hole: Hole, rule: GolfTowerRule): string | null {
    const ruleKey = canonicalRuleKey(rule)
    if (!hasRuleSelector(rule) || ruleKey === null || ruleKey === '{}') {
      return 'Choose at least one question option before answers can be updated.'
    }
    const duplicate = (puzzleRef.current.holes ?? []).some((otherHole) =>
      holeKey(otherHole) !== holeKey(hole) && canonicalRuleKey(otherHole.rule) === ruleKey
    )
    return duplicate ? 'This question duplicates another hole. Choose different settings.' : null
  }

  function cancelScheduledAnswerGeneration() {
    answerGenerationRef.current += 1
    if (answerGenerationTimerRef.current !== null) {
      window.clearTimeout(answerGenerationTimerRef.current)
      answerGenerationTimerRef.current = null
    }
    setAnswerUpdateState(null)
  }

  function scheduleAutomaticAnswerRefresh(hole: Hole, rule: GolfTowerRule) {
    cancelScheduledAnswerGeneration()
    const warning = answerGenerationWarning(hole, rule)
    if (warning) {
      setAnswerUpdateState({ holeKey: holeKey(hole), status: 'warning', message: warning })
      return
    }
    const request = answerGenerationRef.current
    setAnswerUpdateState({ holeKey: holeKey(hole), status: 'pending' })
    answerGenerationTimerRef.current = window.setTimeout(() => {
      answerGenerationTimerRef.current = null
      void generateAnswersForHole(hole, rule, request, false)
    }, 725)
  }

  async function generateAnswersForHole(
    requestedHole: Hole,
    requestedRule: GolfTowerRule,
    request: number,
    manual: boolean
  ) {
    const target = operationTarget(requestedHole)
    const expectedRuleKey = canonicalRuleKey(requestedRule)
    const warning = answerGenerationWarning(requestedHole, requestedRule)
    if (warning || expectedRuleKey === null) {
      if (request === answerGenerationRef.current) {
        setAnswerUpdateState({
          holeKey: target.key,
          status: 'warning',
          message: warning ?? 'Complete the question settings before answers can be updated.',
        })
        if (manual) setBusyAction(null)
      }
      return
    }
    const latestBeforeRequest = currentOperationHole(target)
    if (
      request !== answerGenerationRef.current
      || !latestBeforeRequest
      || canonicalRuleKey(latestBeforeRequest.rule) !== expectedRuleKey
    ) {
      if (manual && request === answerGenerationRef.current) setBusyAction(null)
      return
    }

    setActionError(null)
    setAnswerUpdateState({ holeKey: target.key, status: 'pending' })
    try {
      const generated = await api.generateGolfHole({
        prompt: latestBeforeRequest.prompt,
        rule: requestedRule,
        holeNumber: latestBeforeRequest.holeNumber,
        ...(latestBeforeRequest.id ? { holeId: latestBeforeRequest.id } : {}),
      })
      if (request !== answerGenerationRef.current) return
      const current = currentOperationHole(target)
      if (!current || canonicalRuleKey(current.rule) !== expectedRuleKey) return
      const nextHole: Hole = {
        ...current,
        ...generated.hole,
        id: current.id ?? generated.hole.id,
        holeNumber: current.holeNumber,
        prompt: current.prompt,
        templateId: current.templateId,
        hints: [],
      }
      commitHoles((puzzleRef.current.holes ?? []).map((hole) =>
        hole === current ? nextHole : hole
      ))
      const nextKey = holeKey(nextHole)
      setEvaluationState({ holeKey: nextKey, evaluation: generated.evaluation })
      clearAnswersStale(nextKey)
      setAnswerUpdateState({
        holeKey: nextKey,
        status: 'success',
        count: generated.evaluation.answers.length,
      })
    } catch (error) {
      if (request === answerGenerationRef.current) {
        setAnswerUpdateState({
          holeKey: target.key,
          status: 'error',
          message: error instanceof Error ? error.message : 'Could not update possible answers',
        })
      }
    } finally {
      if (manual && request === answerGenerationRef.current) setBusyAction(null)
    }
  }

  async function applyTemplate(template: AdminGolfTemplate) {
    if (!activeHole || mutationsDisabled) return
    cancelScheduledAnswerGeneration()
    const target = operationTarget(activeHole)
    const operation = ++operationRef.current
    setBusyAction('template')
    setActionError(null)
    try {
      const generated = await api.generateGolfHoleFromTemplate({
        templateId: template.id,
        holeNumber: activeHole.holeNumber,
      })
      if (operation !== operationRef.current) return
      const current = currentOperationHole(target)
      if (!current) return
      const nextHole: Hole = {
        ...current,
        ...generated.hole,
        id: current.id ?? generated.hole.id,
        holeNumber: current.holeNumber,
        hints: [],
      }
      commitHoles((puzzleRef.current.holes ?? []).map((hole) =>
        hole === current ? nextHole : hole
      ))
      const nextKey = holeKey(nextHole)
      setTemplateDetails((details) => ({ ...details, [generated.template.id]: generated.template }))
      setEvaluationState({ holeKey: nextKey, evaluation: generated.evaluation })
      clearAnswersStale(nextKey)
      setAnswerUpdateState({
        holeKey: nextKey,
        status: 'success',
        count: generated.evaluation.answers.length,
      })
    } catch (error) {
      if (operation === operationRef.current) {
        setActionError(error instanceof Error ? error.message : 'Could not apply template')
      }
    } finally {
      if (operation === operationRef.current) setBusyAction(null)
    }
  }

  return (
    <div className="mode-editor">
      {holes.length !== REQUIRED_HOLE_COUNT && (
        <p className="warning-box">
          Football Golf must contain exactly {REQUIRED_HOLE_COUNT} consecutive holes
          before it can be approved or published.
        </p>
      )}

      {holes.length === 0 ? (
        <div className="warning-box">
          This course has no holes. Add a hole before saving.
          <div className="editor-toolbar">
            <button type="button" disabled={locked} onClick={addHole}>+ Add first hole</button>
          </div>
        </div>
      ) : (
        <>
          <nav className="hole-nav" aria-label="Golf holes">
            <button
              type="button"
              className="ghost"
              disabled={activeIndex === 0}
              onClick={() => setActiveIndex((index) => index - 1)}
            >
              ← Previous
            </button>
            <div className="hole-tabs">
              {holes.map((hole, index) => (
                <button
                  key={hole.holeNumber}
                  type="button"
                  className={`ghost hole-tab${index === activeIndex ? ' active' : ''}`}
                  onClick={() => setActiveIndex(index)}
                >
                  {hole.holeNumber}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="ghost"
              disabled={activeIndex === holes.length - 1}
              onClick={() => setActiveIndex((index) => index + 1)}
            >
              Next →
            </button>
          </nav>

          {activeHole && (
        <article key={activeHole.holeNumber} className="editor-clean-section golf-hole">
          <header className="golf-hole-header">
            <strong>
              Hole {activeHole.holeNumber} · par {activeHole.par}
            </strong>
            <div className="golf-hole-move">
              <button
                type="button"
                className="ghost tiny-btn"
                disabled={mutationsDisabled || activeIndex === 0}
                onClick={() => moveHole(-1)}
                aria-label="Move hole earlier"
              >
                ←
              </button>
              <button
                type="button"
                className="ghost tiny-btn"
                disabled={mutationsDisabled || activeIndex === holes.length - 1}
                onClick={() => moveHole(1)}
                aria-label="Move hole later"
              >
                →
              </button>
            </div>
          </header>

          <div className="golf-prompt-display">
            {activeHole.prompt.trim() ? (
              <p>{activeHole.prompt}</p>
            ) : (
              <p className="muted">No question yet — pick a template or write a custom one below.</p>
            )}
          </div>

          <div className="golf-meta-row">
            <label className="field">
              Category
              <input
                value={activeHole.category ?? ''}
                disabled={mutationsDisabled}
                onChange={(event) => updateHole(activeHole.holeNumber, { category: event.target.value })}
              />
            </label>
            <label className="field">
              Par
              <input
                type="number"
                value={activeHole.par}
                disabled={mutationsDisabled}
                min={2}
                max={4}
                onChange={(e) => updateHole(activeHole.holeNumber, { par: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              Target
              <input
                type="number"
                value={activeHole.target ?? ''}
                disabled={mutationsDisabled}
                min={1}
                max={4}
                onChange={(e) =>
                  updateHole(activeHole.holeNumber, {
                    target: e.target.value === '' ? undefined : Number(e.target.value),
                  })
                }
              />
            </label>
          </div>

          <section className="golf-rule-composer" aria-labelledby="golf-rule-heading">
            <div className="golf-section-heading">
              <div>
                <h3 id="golf-rule-heading">Change question</h3>
                <p className="muted tiny">Swap a template to update the answer set.</p>
              </div>
            </div>

            {!activeHole.rule && (
              <p className="warning-box">
                This hole needs a template before it can be approved.
              </p>
            )}

            <label className="field golf-template-select">
              Template
              <select
                value=""
                disabled={mutationsDisabled || templatesBusy || availableTemplates.length === 0}
                onChange={(event) => {
                  const template = templates.find((item) => item.id === event.target.value)
                  if (template) void applyTemplate(template)
                }}
              >
                <option value="">
                  {templatesBusy
                    ? 'Loading questions…'
                    : availableTemplates.length === 0
                      ? 'No available questions'
                      : 'Choose a question…'}
                </option>
                {templatesByCategory.map((group) => (
                  <optgroup key={group.category} label={group.category}>
                    {group.templates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.prompt} ({template.validAnswers} answers)
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>

            {!activeEvaluation && activeTemplate && (
              <div className="golf-template-meta">
                <p className="tiny">
                  <strong>{activeTemplate.validAnswers}</strong> possible answers
                  {activeTemplate.sampleAnswers.length > 0
                    ? ` · e.g. ${activeTemplate.sampleAnswers.slice(0, 5).join(', ')}`
                    : ''}
                </p>
              </div>
            )}

            <details className="advanced-panel golf-custom-rule">
              <summary>Custom question</summary>
              <div className="golf-custom-body">
                <label className="field golf-prompt-field">
                  Question
                  <textarea
                    rows={2}
                    value={activeHole.prompt}
                    disabled={mutationsDisabled}
                    placeholder="e.g. Name players who played in Ligue 1 and the Bundesliga."
                    onChange={(e) => {
                      updateHole(activeHole.holeNumber, { prompt: e.target.value })
                      setEvaluationState((current) => current?.holeKey === activeKey ? null : current)
                    }}
                  />
                </label>

                {!activeHole.rule ? (
                  <div className="golf-custom-start">
                    <p className="muted tiny">
                      Write the question above, then add the filters that define who qualifies.
                    </p>
                    <button
                      type="button"
                      className="ghost"
                      disabled={mutationsDisabled}
                      onClick={() => {
                        updateRule(activeHole, () => ({ leaguesPlayed: ['Premier League'] }))
                      }}
                    >
                      Start building filters
                    </button>
                  </div>
                ) : activeHole.rule.validIds ? (
                  <div className="warning-box">
                    This question has a fixed list of {activeHole.rule.validIds.length} possible answers.
                    <div className="editor-toolbar">
                      <button
                        type="button"
                        className="ghost tiny-btn"
                        disabled={mutationsDisabled}
                        onClick={() => updateRule(activeHole, (rule) => {
                          const { validIds: _validIds, ...dynamicRule } = rule
                          return dynamicRule
                        })}
                      >
                        Turn this into an editable question
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="golf-rule-builder">
                    <div className="golf-rule-grid">
                      <div className="field">
                        <span>Nationality</span>
                        <EntityPicker
                          key={`nationality-${activeHole.rule.nationality ?? 'empty'}`}
                          kind="nationality"
                          valueLabel={activeHole.rule.nationality}
                          disabled={mutationsDisabled || activeHole.rule.nonEuropean === true}
                          onPickNationality={(nationality) => updateRule(activeHole, (rule) => ({
                            ...rule,
                            nationality: nationality.name,
                            nonEuropean: undefined,
                          }))}
                        />
                        {activeHole.rule.nationality && (
                          <button type="button" className="ghost tiny-btn" disabled={mutationsDisabled} onClick={() =>
                            updateRule(activeHole, (rule) => ({ ...rule, nationality: undefined }))
                          }>Clear</button>
                        )}
                      </div>
                      <label className="field">
                        Position
                        <select
                          value={activeHole.rule.position ?? ''}
                          disabled={mutationsDisabled}
                          onChange={(event) => updateRule(activeHole, (rule) => ({
                            ...rule,
                            position: event.target.value
                              ? event.target.value as 'Goalkeeper' | 'Defender'
                              : undefined,
                          }))}
                        >
                          <option value="">Any position</option>
                          <option value="Goalkeeper">Goalkeeper</option>
                          <option value="Defender">Defender</option>
                        </select>
                      </label>
                    </div>

                    <div className="field">
                      <span>Leagues</span>
                      <div className="chip-list">
                        {leaguesFromRule(activeHole.rule).map((league) => (
                          <span className="hint-chip" key={league}>
                            {league}
                            <button
                              type="button"
                              disabled={mutationsDisabled}
                              aria-label={`Remove ${league}`}
                              onClick={() => updateRule(activeHole, (rule) => {
                                const next = leaguesFromRule(rule).filter((name) => name !== league)
                                return {
                                  ...rule,
                                  leaguePlayed: undefined,
                                  leaguesPlayed: next.length > 0 ? next : undefined,
                                }
                              })}
                            >×</button>
                          </span>
                        ))}
                      </div>
                      {leaguesFromRule(activeHole.rule).length < 4 && (
                        <EntityPicker
                          kind="league"
                          disabled={mutationsDisabled}
                          placeholder="Add a league…"
                          onPickLeague={(league) => updateRule(activeHole, (rule) => {
                            const next = [...new Set([...leaguesFromRule(rule), league.name])]
                            return {
                              ...rule,
                              leaguePlayed: undefined,
                              leaguesPlayed: next,
                            }
                          })}
                        />
                      )}
                    </div>

                    <div className="field">
                      <span>Clubs</span>
                      <div className="chip-list">
                        {(activeHole.rule.playedFor ?? []).map((club) => (
                          <span className="hint-chip" key={club}>
                            {club}
                            <button
                              type="button"
                              disabled={mutationsDisabled}
                              aria-label={`Remove ${club}`}
                              onClick={() => updateRule(activeHole, (rule) => {
                                const clubs = rule.playedFor?.filter((name) => name !== club) ?? []
                                return { ...rule, playedFor: clubs.length > 0 ? clubs : undefined }
                              })}
                            >×</button>
                          </span>
                        ))}
                      </div>
                      {(activeHole.rule.playedFor?.length ?? 0) < 4 && (
                        <EntityPicker
                          kind="team"
                          disabled={mutationsDisabled}
                          placeholder="Add a club…"
                          onPickTeam={(team) => updateRule(activeHole, (rule) => ({
                            ...rule,
                            playedFor: [...new Set([...(rule.playedFor ?? []), team.name])],
                          }))}
                        />
                      )}
                    </div>

                    <div className="golf-season-block">
                      <h4>Season snapshot</h4>
                      <div className="golf-rule-grid golf-season-grid">
                        <label className="field">
                          Season
                          <select
                            value={activeHole.rule.seasonStat?.season ?? ''}
                            disabled={mutationsDisabled}
                            onChange={(event) => {
                              const season = event.target.value === '' ? undefined : Number(event.target.value)
                              updateRule(activeHole, (rule) => {
                                if (season == null) {
                                  const { seasonStat: _seasonStat, ...rest } = rule
                                  return rest
                                }
                                return {
                                  ...rule,
                                  seasonStat: {
                                    leagueId: rule.seasonStat?.leagueId ?? 39,
                                    season,
                                    metric: rule.seasonStat?.metric ?? 'goals',
                                    minimum: rule.seasonStat?.minimum ?? 1,
                                  },
                                }
                              })
                            }}
                          >
                            <option value="">Any season</option>
                            {SEASON_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        </label>
                        <label className="field">
                          League
                          <select
                            value={activeHole.rule.seasonStat?.leagueId ?? ''}
                            disabled={mutationsDisabled || activeHole.rule.seasonStat?.season == null}
                            onChange={(event) => {
                              const leagueId = Number(event.target.value)
                              updateRule(activeHole, (rule) => ({
                                ...rule,
                                seasonStat: {
                                  leagueId,
                                  season: rule.seasonStat?.season ?? 2024,
                                  metric: rule.seasonStat?.metric ?? 'goals',
                                  minimum: rule.seasonStat?.minimum ?? 1,
                                },
                              }))
                            }}
                          >
                            {SEASON_LEAGUES.map((league) => (
                              <option key={league.id} value={league.id}>{league.name}</option>
                            ))}
                          </select>
                        </label>
                        <label className="field">
                          Stat
                          <select
                            value={activeHole.rule.seasonStat?.metric ?? 'goals'}
                            disabled={mutationsDisabled || activeHole.rule.seasonStat?.season == null}
                            onChange={(event) => updateRule(activeHole, (rule) => ({
                              ...rule,
                              seasonStat: {
                                leagueId: rule.seasonStat?.leagueId ?? 39,
                                season: rule.seasonStat?.season ?? 2024,
                                metric: event.target.value as 'goals' | 'assists' | 'appearances',
                                minimum: rule.seasonStat?.minimum ?? 1,
                              },
                            }))}
                          >
                            <option value="goals">Goals</option>
                            <option value="assists">Assists</option>
                            <option value="appearances">Appearances</option>
                          </select>
                        </label>
                        <label className="field">
                          Minimum
                          <input
                            type="number"
                            min={1}
                            max={1000}
                            value={activeHole.rule.seasonStat?.minimum ?? ''}
                            disabled={mutationsDisabled || activeHole.rule.seasonStat?.season == null}
                            placeholder="1"
                            onChange={(event) => {
                              const value = event.target.value
                              const parsed = Number(value)
                              updateRule(activeHole, (rule) => ({
                                ...rule,
                                seasonStat: {
                                  leagueId: rule.seasonStat?.leagueId ?? 39,
                                  season: rule.seasonStat?.season ?? 2024,
                                  metric: rule.seasonStat?.metric ?? 'goals',
                                  minimum: value === ''
                                    ? 1
                                    : Math.trunc(Math.max(1, Math.min(1000, parsed))),
                                },
                              }))
                            }}
                          />
                        </label>
                      </div>
                    </div>

                    <div className="golf-rule-toggles">
                      <label>
                        <input
                          type="checkbox"
                          checked={activeHole.rule.nonEuropean === true}
                          disabled={mutationsDisabled || Boolean(activeHole.rule.nationality)}
                          onChange={(event) => updateRule(activeHole, (rule) => ({
                            ...rule,
                            nonEuropean: event.target.checked ? true : undefined,
                            nationality: event.target.checked ? undefined : rule.nationality,
                          }))}
                        />
                        Non-European nationality
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={activeHole.rule.uclWinner === true}
                          disabled={mutationsDisabled}
                          onChange={(event) => updateRule(activeHole, (rule) => ({
                            ...rule,
                            uclWinner: event.target.checked ? true : undefined,
                          }))}
                        />
                        Champions League winner
                      </label>
                    </div>

                    <div className="golf-threshold-grid">
                      {INTEGER_RULE_FIELDS.map((field) => (
                        <label className="field" key={field.key}>
                          {field.label}
                          <span className="golf-number-input">
                            {field.prefix && <span>{field.prefix}</span>}
                            <input
                              type="number"
                              min={0}
                              max={field.max}
                              step={1}
                              value={
                                typeof activeHole.rule?.[field.key] === 'number'
                                  ? String(activeHole.rule[field.key])
                                  : ''
                              }
                              disabled={mutationsDisabled}
                              placeholder="Not set"
                              onChange={(event) => {
                                const value = event.target.value
                                const parsed = Number(value)
                                updateRule(activeHole, (rule) => ({
                                  ...rule,
                                  [field.key]: value === ''
                                    ? undefined
                                    : Math.trunc(Math.max(0, Math.min(field.max, parsed))),
                                }))
                              }}
                            />
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </details>

            {actionError && <p className="error-box">{actionError}</p>}
            {activeAnswerUpdate?.status === 'pending' && (
              <p className="golf-answer-update">Updating possible answers…</p>
            )}
            {activeAnswerUpdate?.status === 'success' && (
              <p className="golf-answer-update success">
                {activeAnswerUpdate.count} possible answers updated.
              </p>
            )}
            {activeAnswerUpdate?.status === 'warning' && (
              <p className="golf-stale-warning">{activeAnswerUpdate.message}</p>
            )}
            {activeAnswerUpdate?.status === 'error' && (
              <div className="error-box golf-answer-error">
                <span>{activeAnswerUpdate.message}</span>
                {activeHole.rule && (
                  <button
                    type="button"
                    className="ghost tiny-btn"
                    disabled={mutationsDisabled}
                    onClick={() => {
                      cancelScheduledAnswerGeneration()
                      const request = answerGenerationRef.current
                      setBusyAction('generate')
                      void generateAnswersForHole(activeHole, activeHole.rule!, request, true)
                    }}
                  >
                    Retry
                  </button>
                )}
              </div>
            )}
            {answersStale && !activeAnswerUpdate && (
              <p className="golf-stale-warning">
                Answers are out of date. Re-select a template, then Run checks.
              </p>
            )}
            {activeEvaluation && <EvaluationSummary evaluation={activeEvaluation} />}
          </section>

          <details className="advanced-panel golf-answers-advanced">
            <summary>Manual answers ({activeHole.answers.length})</summary>
            <p className="warning-box">
              Prefer templates. Run checks will catch answer mismatches.
            </p>
          <fieldset disabled={mutationsDisabled} className="options">
            <legend>Possible answers</legend>
            {activeHole.answers.length === 0 && (
              <p className="warning-box">This hole has no accepted answers.</p>
            )}
            {activeHole.answers.map((ans, idx) => (
              <div key={ans.id ?? idx} className="answer-card option-row stack">
                <div className="row">
                  <EntityPicker
                    key={`${ans.id ?? idx}-${ans.headshotUrl ?? ''}-${ans.name}`}
                    kind="player"
                    valueLabel={ans.name || undefined}
                    imageUrl={ans.headshotUrl}
                    disabled={mutationsDisabled}
                    onPickPlayer={(hit) => pickAnswer(activeHole.holeNumber, idx, hit)}
                  />
                  <select
                    value={RARITIES.includes(ans.rarity as (typeof RARITIES)[number]) ? ans.rarity : 'common'}
                    disabled={mutationsDisabled}
                    aria-label={`Answer ${idx + 1} rarity`}
                    onChange={(e) => updateAnswer(activeHole.holeNumber, idx, { rarity: e.target.value })}
                  >
                    {RARITIES.map((rarity) => <option key={rarity} value={rarity}>{rarityLabel(rarity)}</option>)}
                  </select>
                  <button
                    type="button"
                    className="ghost tiny-btn"
                    disabled={mutationsDisabled}
                    aria-label={`Remove answer ${ans.name || idx + 1}`}
                    title="Remove answer"
                    onClick={() => removeAnswer(activeHole.holeNumber, idx)}
                  >
                    ×
                  </button>
                </div>
                <input
                  value={(ans.aliases ?? []).join(', ')}
                  aria-label={`Accepted spellings for answer ${idx + 1}`}
                  placeholder="Accepted spellings, separated by commas"
                  disabled={mutationsDisabled}
                  onChange={(e) =>
                    updateAnswer(activeHole.holeNumber, idx, {
                      aliases: e.target.value
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </div>
            ))}
            <button type="button" className="ghost" disabled={mutationsDisabled} onClick={() => addAnswer(activeHole.holeNumber)}>
              + Answer
            </button>
          </fieldset>
          </details>
        </article>
          )}
          <div className="editor-toolbar">
            <span className="muted tiny">Hole order and numbering stay synchronized.</span>
            <button
              type="button"
              disabled={mutationsDisabled || holes.length >= REQUIRED_HOLE_COUNT}
              onClick={addHole}
            >
              + Add hole
            </button>
          </div>
        </>
      )}
    </div>
  )
}
