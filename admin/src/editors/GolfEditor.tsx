import { useEffect, useRef, useState } from 'react'
import {
  api,
  type AdminGolfTemplate,
  type AuthoredGolfHole,
  type GolfAnswer,
  type GolfAnswerSetValidation,
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

type BusyAction = 'template' | 'preview' | 'generate' | 'validate'
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

function summarizeNames(names: string[], limit = 6): string {
  const visible = names.slice(0, limit)
  const remaining = names.length - visible.length
  return `${visible.join(', ')}${remaining > 0 ? `, and ${remaining} more` : ''}`
}

function isGolfRarity(value: string | undefined): value is GolfRarity {
  return RARITIES.some((rarity) => rarity === value)
}

function toAuthoredHole(hole: Hole): AuthoredGolfHole | null {
  if (
    !hole.id ||
    !hole.category ||
    ![2, 3, 4].includes(hole.par) ||
    hole.target == null ||
    !Number.isInteger(hole.target)
  ) {
    return null
  }
  const answers: GolfAnswer[] = []
  for (const answer of hole.answers) {
    if (!answer.id || !isGolfRarity(answer.rarity)) return null
    answers.push({
      id: answer.id,
      name: answer.name,
      aliases: answer.aliases ?? [],
      rarity: answer.rarity,
    })
  }
  return {
    id: hole.id,
    holeNumber: hole.holeNumber,
    par: hole.par as 2 | 3 | 4,
    target: hole.target,
    prompt: hole.prompt,
    category: hole.category,
    answers,
    hints: hole.hints ?? [],
    ...(hasRuleSelector(hole.rule) ? { rule: hole.rule } : {}),
    ...(hole.templateId ? { templateId: hole.templateId } : {}),
  }
}

function EvaluationSummary({ evaluation }: { evaluation: GolfRuleEvaluation }) {
  return (
    <div className="golf-evaluation">
      <div className="golf-counts">
        <span><strong>{evaluation.counts.total}</strong> possible answers</span>
        <span><strong>{evaluation.counts.nameable}</strong> well-known answers</span>
        <span><strong>{evaluation.suggestedPar}</strong> suggested par</span>
        <span><strong>{evaluation.suggestedTarget}</strong> target</span>
      </div>
      <p className="muted tiny">
        Rarity: {evaluation.counts.rarity.common} common · {evaluation.counts.rarity.uncommon} uncommon
        {' · '}{evaluation.counts.rarity.rare} rare · {evaluation.counts.rarity.ultraRare} ultra rare
      </p>
      <p className="tiny">
        <strong>For example:</strong>{' '}
        {evaluation.answers.slice(0, 8).map((answer) => answer.name).join(', ') || 'No matching players'}
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
  const templateSearchRef = useRef(0)
  const [activeIndex, setActiveIndex] = useState(0)
  const [templateQuery, setTemplateQuery] = useState('')
  const [templates, setTemplates] = useState<AdminGolfTemplate[]>([])
  const [templateDetails, setTemplateDetails] = useState<Record<string, AdminGolfTemplate>>({})
  const [templatesBusy, setTemplatesBusy] = useState(false)
  const [busyAction, setBusyAction] = useState<BusyAction | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [evaluationState, setEvaluationState] = useState<{
    holeKey: string
    evaluation: GolfRuleEvaluation
  } | null>(null)
  const [validationState, setValidationState] = useState<{
    holeKey: string
    result: GolfAnswerSetValidation
  } | null>(null)
  const [staleHoleKeys, setStaleHoleKeys] = useState<Set<string>>(() => new Set())
  const [answerUpdateState, setAnswerUpdateState] = useState<AnswerUpdateState | null>(null)
  const activeHole = holes[Math.min(activeIndex, Math.max(holes.length - 1, 0))]
  const computedPar = holes.reduce((sum, hole) => sum + (Number.isFinite(hole.par) ? hole.par : 0), 0)
  const activeKey = activeHole ? holeKey(activeHole) : null
  const activeEvaluation =
    evaluationState?.holeKey === activeKey ? evaluationState.evaluation : null
  const activeValidation =
    validationState?.holeKey === activeKey ? validationState.result : null
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
    const requestId = ++templateSearchRef.current
    const timer = window.setTimeout(() => {
      setTemplatesBusy(true)
      void api.listGolfTemplates(templateQuery, 30)
        .then((rows) => {
          if (requestId !== templateSearchRef.current) return
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
          if (requestId === templateSearchRef.current) {
            setActionError(error instanceof Error ? error.message : 'Could not load Golf templates')
          }
        })
        .finally(() => {
          if (requestId === templateSearchRef.current) setTemplatesBusy(false)
        })
    }, 220)
    return () => window.clearTimeout(timer)
  }, [templateQuery])

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
    setValidationState((current) => current?.holeKey === key ? null : current)
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
      message: 'Manual answers changed. Use Refresh answers to restore the verified list.',
    })
  }

  async function pickAnswer(
    n: number,
    idx: number,
    hit: { id: string; name: string }
  ) {
    let resolved = { id: hit.id, name: hit.name, aliases: [] as string[] }
    try {
      const full = (await api.resolvePlayer(hit.id, 'golf')) as typeof resolved
      resolved = {
        id: full.id || hit.id,
        name: full.name || hit.name,
        aliases: full.aliases ?? [],
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
      message: 'Manual answers changed. Use Refresh answers to restore the verified list.',
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
      message: 'Manual answers changed. Use Refresh answers to restore the verified list.',
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
        category: 'Career',
        hints: [],
        answers: [],
      },
    ])
    setActiveIndex(holes.length)
  }

  function removeHole() {
    if (!activeHole || holes.length <= REQUIRED_HOLE_COUNT) return
    cancelScheduledAnswerGeneration()
    commitHoles(holes.filter((hole) => hole.holeNumber !== activeHole.holeNumber))
    setActiveIndex((index) => Math.max(0, index - 1))
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

  function addHint() {
    if (!activeHole) return
    updateHole(activeHole.holeNumber, { hints: [...(activeHole.hints ?? []), 'New hint'] })
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
      return 'Choose at least one rule option before answers can be updated.'
    }
    const duplicate = (puzzleRef.current.holes ?? []).some((otherHole) =>
      holeKey(otherHole) !== holeKey(hole) && canonicalRuleKey(otherHole.rule) === ruleKey
    )
    return duplicate ? 'This question duplicates another hole. Choose a different rule.' : null
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
          message: warning ?? 'Choose a complete rule before answers can be updated.',
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
      }
      commitHoles((puzzleRef.current.holes ?? []).map((hole) =>
        hole === current ? nextHole : hole
      ))
      const nextKey = holeKey(nextHole)
      setEvaluationState({ holeKey: nextKey, evaluation: generated.evaluation })
      setValidationState(null)
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

  function generateAnswers(hole: Hole) {
    if (!hole.rule || mutationsDisabled) return
    cancelScheduledAnswerGeneration()
    const request = answerGenerationRef.current
    setBusyAction('generate')
    void generateAnswersForHole(hole, hole.rule, request, true)
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
      }
      commitHoles((puzzleRef.current.holes ?? []).map((hole) =>
        hole === current ? nextHole : hole
      ))
      const nextKey = holeKey(nextHole)
      setTemplateDetails((details) => ({ ...details, [generated.template.id]: generated.template }))
      setEvaluationState({ holeKey: nextKey, evaluation: generated.evaluation })
      setValidationState(null)
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

  async function previewRule() {
    if (!activeHole?.rule || busyAction) return
    const target = operationTarget(activeHole)
    const operation = ++operationRef.current
    setBusyAction('preview')
    setActionError(null)
    try {
      const evaluation = await api.previewGolfRule({
        prompt: activeHole.prompt,
        rule: activeHole.rule,
      })
      if (operation !== operationRef.current || !currentOperationHole(target)) return
      setEvaluationState({ holeKey: target.key, evaluation })
    } catch (error) {
      if (operation === operationRef.current) {
        setActionError(error instanceof Error ? error.message : 'Could not preview rule')
      }
    } finally {
      if (operation === operationRef.current) setBusyAction(null)
    }
  }

  async function validateHole() {
    if (!activeHole || busyAction) return
    const authored = toAuthoredHole(activeHole)
    if (!authored) {
      setActionError(
        'This hole is missing required details. Check its category, par, target and accepted answers.'
      )
      return
    }
    const target = operationTarget(activeHole)
    const operation = ++operationRef.current
    setBusyAction('validate')
    setActionError(null)
    try {
      const result = await api.validateGolfHole(authored)
      if (operation !== operationRef.current || !currentOperationHole(target)) return
      setValidationState({ holeKey: target.key, result })
      if (result.valid && !('warning' in result)) clearAnswersStale(target.key)
      if (!result.valid) markAnswersStale(activeHole)
    } catch (error) {
      if (operation === operationRef.current) {
        setActionError(error instanceof Error ? error.message : 'Could not validate hole')
      }
    } finally {
      if (operation === operationRef.current) setBusyAction(null)
    }
  }

  return (
    <div className="mode-editor">
      <div className="editor-summary">
        <div>
          <span className="muted tiny">Five-hole course</span>
          <strong>{holes.length} / {REQUIRED_HOLE_COUNT} holes</strong>
        </div>
        <div>
          <span className="muted tiny">Total par</span>
          <strong>{computedPar}</strong>
        </div>
        <div>
          <span className="muted tiny">Stored total</span>
          <strong>{p.totalPar ?? 'Not set'}</strong>
        </div>
      </div>

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
        <article key={activeHole.holeNumber} className="q-card">
          <header>
            <strong>
              Hole {activeHole.holeNumber} · par {activeHole.par}
            </strong>
            <div className="button-row">
              <button type="button" className="ghost tiny-btn" disabled={mutationsDisabled || activeIndex === 0} onClick={() => moveHole(-1)}>← Move</button>
              <button type="button" className="ghost tiny-btn" disabled={mutationsDisabled || activeIndex === holes.length - 1} onClick={() => moveHole(1)}>Move →</button>
              <button type="button" className="ghost tiny-btn" disabled={mutationsDisabled || holes.length <= REQUIRED_HOLE_COUNT} onClick={removeHole}>Remove hole</button>
            </div>
          </header>
          {holes.length <= REQUIRED_HOLE_COUNT && (
            <p className="muted tiny">
              A publishable course must keep exactly {REQUIRED_HOLE_COUNT} holes; removal is disabled.
            </p>
          )}
          <section className="golf-rule-composer" aria-labelledby="golf-rule-heading">
            <div className="golf-section-heading">
              <div>
                <h3 id="golf-rule-heading">Choose the question</h3>
                <p className="muted tiny">
                  Choose a verified question below. Its full answer set, hints and suggested
                  par are filled in automatically.
                </p>
              </div>
              <span className={`golf-rule-status ${activeHole.rule ? 'structured' : 'legacy'}`}>
                {activeHole.rule ? 'Verified question' : 'Needs a verified question'}
              </span>
            </div>

            {!activeHole.rule && (
              <p className="warning-box">
                This older hole has no verified question attached. Choose one below before
                approving the course.
              </p>
            )}

            <div className="golf-template-picker simple">
              <label className="field">
                Find a question
                <input
                  value={templateQuery}
                  disabled={locked}
                  placeholder="Search questions…"
                  maxLength={120}
                  onChange={(event) => setTemplateQuery(event.target.value)}
                />
              </label>
              <label className="field">
                Verified template
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
                        ? 'No matching questions'
                        : 'Choose a question…'}
                  </option>
                  {availableTemplates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.prompt} ({template.validAnswers} answers)
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {activeHole.templateId && (
              <div className="golf-template-meta">
                <strong>Selected question:</strong>{' '}
                {activeTemplate?.prompt ?? activeHole.prompt}
                {activeTemplate && (
                  <p className="tiny">
                    {activeTemplate.validAnswers} possible answers
                    {activeTemplate.sampleAnswers.length > 0
                      ? ` (${activeTemplate.sampleAnswers.slice(0, 6).join(', ')}${activeTemplate.sampleAnswers.length > 6 ? ', etc.' : ''})`
                      : ''}
                  </p>
                )}
              </div>
            )}

            <details className="advanced-panel golf-custom-rule">
              <summary>Advanced: create a custom question</summary>
              {activeHole.rule ? (
                <div className="golf-rule-builder">
                {activeHole.rule.validIds ? (
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
                  <>
                    <label className="field">
                      Short label (optional)
                      <input
                        value={activeHole.rule.label ?? ''}
                        disabled={mutationsDisabled}
                        maxLength={160}
                        onChange={(event) => updateRule(activeHole, (rule) => ({
                          ...rule,
                          label: event.target.value || undefined,
                        }))}
                      />
                    </label>
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
                          }>Clear nationality</button>
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
                      <div className="field">
                        <span>League played in</span>
                        <EntityPicker
                          key={`league-${activeHole.rule.leaguePlayed ?? 'empty'}`}
                          kind="league"
                          valueLabel={activeHole.rule.leaguePlayed}
                          disabled={mutationsDisabled}
                          onPickLeague={(league) => updateRule(activeHole, (rule) => ({
                            ...rule,
                            leaguePlayed: league.name,
                          }))}
                        />
                        {activeHole.rule.leaguePlayed && (
                          <button type="button" className="ghost tiny-btn" disabled={mutationsDisabled} onClick={() =>
                            updateRule(activeHole, (rule) => ({ ...rule, leaguePlayed: undefined }))
                          }>Clear league</button>
                        )}
                      </div>
                    </div>

                    <div className="field">
                      <span>Played for clubs (all required, maximum 4)</span>
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
                          placeholder="Search club to add…"
                          onPickTeam={(team) => updateRule(activeHole, (rule) => ({
                            ...rule,
                            playedFor: [...new Set([...(rule.playedFor ?? []), team.name])],
                          }))}
                        />
                      )}
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
                  </>
                )}
                </div>
              ) : (
                <div className="golf-custom-start">
                  <p className="muted tiny">
                    Only use this when no verified template fits. Start broad, then add the
                    nationality, club, league or stat filters you need.
                  </p>
                  <button
                    type="button"
                    className="ghost"
                    disabled={mutationsDisabled}
                    onClick={() => {
                      updateRule(activeHole, () => ({ minPlApps: 1 }))
                    }}
                  >
                    Start a custom rule
                  </button>
                </div>
              )}
            </details>

            <div className="golf-rule-actions">
              <button type="button" className="ghost" disabled={!activeHole.rule || busyAction !== null} onClick={() => void previewRule()}>
                {busyAction === 'preview' ? 'Checking…' : 'Check possible answers'}
              </button>
              <button type="button" className="ghost" disabled={mutationsDisabled || !activeHole.rule} onClick={() => generateAnswers(activeHole)}>
                {busyAction === 'generate' ? 'Refreshing…' : 'Refresh answers'}
              </button>
              <button type="button" className="ghost" disabled={busyAction !== null} onClick={() => void validateHole()}>
                {busyAction === 'validate' ? 'Checking…' : 'Check this hole'}
              </button>
            </div>
            {actionError && <p className="error-box">{actionError}</p>}
            {activeAnswerUpdate?.status === 'pending' && (
              <p className="golf-answer-update">Updating possible answers…</p>
            )}
            {activeAnswerUpdate?.status === 'success' && (
              <p className="golf-answer-update success">
                {activeAnswerUpdate.count} possible answers updated automatically.
              </p>
            )}
            {activeAnswerUpdate?.status === 'warning' && (
              <p className="golf-stale-warning">{activeAnswerUpdate.message}</p>
            )}
            {activeAnswerUpdate?.status === 'error' && (
              <div className="error-box golf-answer-error">
                <span>{activeAnswerUpdate.message}</span>
                <button
                  type="button"
                  className="ghost tiny-btn"
                  disabled={mutationsDisabled || !activeHole.rule}
                  onClick={() => generateAnswers(activeHole)}
                >
                  Retry
                </button>
              </div>
            )}
            {answersStale && !activeAnswerUpdate && (
              <p className="golf-stale-warning">
                Answers are stale. Use Refresh answers before approval.
              </p>
            )}
            {activeEvaluation && <EvaluationSummary evaluation={activeEvaluation} />}
            {activeValidation && (
              <div className={activeValidation.valid ? 'golf-validation valid' : 'golf-validation invalid'}>
                {'warning' in activeValidation ? (
                  <p>{activeValidation.warning}</p>
                ) : (
                  <>
                    <strong>{activeValidation.valid ? 'Answer set verified' : 'Answer set does not match the rule'}</strong>
                    <p className="tiny">
                      Stored {activeValidation.storedCount} · expected {activeValidation.expectedCount}
                    </p>
                    {activeValidation.missingAnswerIds.length > 0 && (
                      <p className="tiny">
                        <strong>{activeValidation.missingAnswerIds.length} missing:</strong>{' '}
                        {summarizeNames(activeValidation.missingAnswerIds.map((id) =>
                          activeValidation.evaluation.answers.find((answer) => answer.id === id)?.name ?? 'Unknown player'
                        ))}
                      </p>
                    )}
                    {activeValidation.staleAnswerIds.length > 0 && (
                      <p className="tiny">
                        <strong>{activeValidation.staleAnswerIds.length} no longer matched:</strong>{' '}
                        {summarizeNames(activeValidation.staleAnswerIds.map((id) =>
                          activeHole.answers.find((answer) => answer.id === id)?.name ?? 'Unknown player'
                        ))}
                      </p>
                    )}
                    {!activeValidation.valid &&
                      activeValidation.missingAnswerIds.length === 0 &&
                      activeValidation.staleAnswerIds.length === 0 && (
                        <p className="tiny">The stored answer list contains duplicate player ids.</p>
                      )}
                  </>
                )}
              </div>
            )}
          </section>

          <label className="field">
            Display prompt (editable wording)
            <textarea
              rows={2}
              value={activeHole.prompt}
              disabled={mutationsDisabled}
              onChange={(e) => {
                updateHole(activeHole.holeNumber, { prompt: e.target.value })
                setEvaluationState((current) => current?.holeKey === activeKey ? null : current)
                setValidationState((current) => current?.holeKey === activeKey ? null : current)
              }}
            />
            <span className="muted tiny">Changing display wording keeps the attached rule.</span>
          </label>
          <label className="field">
            Category
            <input
              value={activeHole.category ?? ''}
              disabled={mutationsDisabled}
              onChange={(event) => updateHole(activeHole.holeNumber, { category: event.target.value })}
            />
          </label>
          <div className="row">
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
          <div className="field">
            <span>Hint chips</span>
            <div className="chip-list">
              {(activeHole.hints ?? []).map((hint, index) => (
                <span className="hint-chip" key={`${index}-${hint}`}>
                  {hint || 'Empty hint'}
                  <button
                    type="button"
                    disabled={mutationsDisabled}
                    aria-label={`Remove hint ${index + 1}`}
                    onClick={() =>
                      updateHole(activeHole.holeNumber, {
                        hints: (activeHole.hints ?? []).filter((_, i) => i !== index),
                      })
                    }
                  >
                    ×
                  </button>
                </span>
              ))}
              <button type="button" className="ghost tiny-btn" disabled={mutationsDisabled} onClick={addHint}>+ Hint</button>
            </div>
          </div>
          <label className="field">
            Hints (one per line)
            <textarea
              rows={3}
              value={(activeHole.hints ?? []).join('\n')}
              disabled={mutationsDisabled}
              onChange={(e) =>
                updateHole(activeHole.holeNumber, {
                  hints: e.target.value.split('\n'),
                })
              }
            />
          </label>
          <details className="advanced-panel">
            <summary>Advanced / manual answers ({activeHole.answers.length})</summary>
            <p className="warning-box">
              Manual answer edits can make a rule-backed hole stale. Regenerate or validate after every manual change.
            </p>
          <fieldset disabled={mutationsDisabled} className="options">
            <legend>Answers (search player to set id + aliases)</legend>
            {activeHole.answers.length === 0 && (
              <p className="warning-box">This hole has no accepted answers.</p>
            )}
            {activeHole.answers.map((ans, idx) => (
              <div key={ans.id ?? idx} className="answer-card option-row stack">
                <div className="row">
                  <EntityPicker
                    key={`${ans.id ?? idx}-${ans.name}`}
                    kind="player"
                    valueLabel={ans.name || undefined}
                    disabled={mutationsDisabled}
                    onPickPlayer={(hit) => pickAnswer(activeHole.holeNumber, idx, hit)}
                  />
                  <select
                    value={RARITIES.includes(ans.rarity as (typeof RARITIES)[number]) ? ans.rarity : 'common'}
                    disabled={mutationsDisabled}
                    aria-label={`Answer ${idx + 1} rarity`}
                    onChange={(e) => updateAnswer(activeHole.holeNumber, idx, { rarity: e.target.value })}
                  >
                    {RARITIES.map((rarity) => <option key={rarity} value={rarity}>{rarity}</option>)}
                  </select>
                  <button
                    type="button"
                    className="ghost tiny-btn"
                    disabled={mutationsDisabled}
                    onClick={() => removeAnswer(activeHole.holeNumber, idx)}
                  >
                    ×
                  </button>
                </div>
                <input
                  value={(ans.aliases ?? []).join(', ')}
                  placeholder="Aliases, comma-separated"
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
