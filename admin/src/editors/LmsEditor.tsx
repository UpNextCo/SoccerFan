import { api, type AdminPlayerHit, type AdminTeamHit } from '../api'
import { EntityPicker } from '../components/EntityPicker'

type Opt = {
  id: string
  label: string
  headshotUrl?: string
  teamLogoUrl?: string
  nationality?: string
  position?: string
}

type Q = {
  id: string
  type: string
  slot: number
  signature?: boolean
  prompt: string
  subPrompt?: string
  options: Opt[]
  presentation?: {
    careerClubs?: Array<{ name: string; logoUrl?: string }>
    imageUrl?: string
    [k: string]: unknown
  }
}

type Ans = {
  questionId: string
  correctOptionId: string
  reveal?: string
}

type Puzzle = {
  modeId?: string
  puzzleId?: string
  date?: string
  title?: string
  version?: number
  questions: Q[]
}

type Answer = { questions: Ans[] }

function makeOptionId(questionId: string, key: string): string {
  return `${questionId}-${key}`
}

function isClubQuestion(q: Q): boolean {
  if (q.type === 'which_club' || q.type === 'image_badge') return true
  if (q.type !== 'odd_one_out') return false
  const sub = q.subPrompt?.toLowerCase() ?? ''
  return sub.includes('club')
}

export function LmsEditor({
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
  const a = (answer as Answer) ?? { questions: [] }
  const questions = [...(p.questions ?? [])].sort((x, y) => x.slot - y.slot)

  function updateQuestion(slot: number, patch: Partial<Q>) {
    const nextQs = questions.map((q) => (q.slot === slot ? { ...q, ...patch } : q))
    onChange({ ...p, questions: nextQs }, a)
  }

  function replaceOption(
    question: Q,
    oldOpt: Opt,
    nextOpt: Opt,
    answerPatch?: Partial<Ans>
  ) {
    const nextQs = questions.map((q) => {
      if (q.id !== question.id) return q
      return {
        ...q,
        options: q.options.map((o) => (o.id === oldOpt.id ? nextOpt : o)),
      }
    })
    let nextAns = a
    if (answerPatch || oldOpt.id !== nextOpt.id) {
      nextAns = {
        questions: a.questions.map((ans) => {
          if (ans.questionId !== question.id) return ans
          const wasCorrect = ans.correctOptionId === oldOpt.id
          return {
            ...ans,
            ...(wasCorrect ? { correctOptionId: nextOpt.id } : {}),
            ...answerPatch,
          }
        }),
      }
    }
    onChange({ ...p, questions: nextQs }, nextAns)
  }

  function updateAnswer(questionId: string, patch: Partial<Ans>) {
    const nextAns = {
      questions: a.questions.map((ans) =>
        ans.questionId === questionId ? { ...ans, ...patch } : ans
      ),
    }
    onChange(p, nextAns)
  }

  function correctFor(q: Q): Ans | undefined {
    return a.questions.find((x) => x.questionId === q.id)
  }

  async function pickPlayer(q: Q, oldOpt: Opt, hit: AdminPlayerHit) {
    const resolved = (await api.resolvePlayer(hit.id, 'card')) as {
      id: string
      name: string
      nationality?: string
      position?: string
      headshotUrl?: string
      teamLogoUrl?: string
    }
    const nextOpt: Opt = {
      ...oldOpt,
      id: makeOptionId(q.id, resolved.id),
      label: resolved.name,
      headshotUrl: resolved.headshotUrl,
      teamLogoUrl: resolved.teamLogoUrl,
      nationality: resolved.nationality,
      position: resolved.position,
    }
    replaceOption(q, oldOpt, nextOpt)
  }

  async function pickClub(q: Q, oldOpt: Opt, hit: AdminTeamHit) {
    const team = await api.resolveTeam(hit.id)
    const suffix = oldOpt.id.startsWith(`${q.id}-`) ? oldOpt.id.slice(q.id.length + 1) : oldOpt.id
    let optionKey = String(team.id)
    if (q.type === 'which_club' || (q.type === 'odd_one_out' && isClubQuestion(q))) {
      if (suffix === 'correct' || suffix === 'odd' || /^w\d+$/.test(suffix) || /^m\d+$/.test(suffix)) {
        optionKey = suffix
      }
    } else if (q.type === 'image_badge') {
      optionKey = String(team.id)
    }
    const nextOpt: Opt = {
      ...oldOpt,
      id: makeOptionId(q.id, optionKey),
      label: team.name,
      teamLogoUrl: team.logoUrl,
      headshotUrl: undefined,
    }
    replaceOption(q, oldOpt, nextOpt)
  }

  async function pickCareerClub(q: Q, clubIdx: number, hit: AdminTeamHit) {
    const team = await api.resolveTeam(hit.id)
    const clubs = [...(q.presentation?.careerClubs ?? [])]
    clubs[clubIdx] = { name: team.name, logoUrl: team.logoUrl }
    updateQuestion(q.slot, {
      presentation: { ...(q.presentation ?? {}), careerClubs: clubs },
    })
  }

  return (
    <div className="lms-editor">
      <label className="field">
        Title
        <input
          value={p.title ?? ''}
          disabled={locked}
          onChange={(e) => onChange({ ...p, title: e.target.value }, a)}
        />
      </label>
      <p className="muted">Version {p.version ?? '?'} · {questions.length} questions</p>

      {questions.map((q) => {
        const ans = correctFor(q)
        const clubMode = isClubQuestion(q)
        return (
          <article key={q.id} className="q-card">
            <header>
              <strong>
                Q{q.slot} · {q.type}
                {q.signature ? ' · signature' : ''}
              </strong>
              <span className="muted">{q.id}</span>
            </header>

            <label className="field">
              Prompt
              <textarea
                rows={2}
                value={q.prompt}
                disabled={locked}
                onChange={(e) => updateQuestion(q.slot, { prompt: e.target.value })}
              />
            </label>
            <label className="field">
              Sub-prompt
              <input
                value={q.subPrompt ?? ''}
                disabled={locked}
                onChange={(e) => updateQuestion(q.slot, { subPrompt: e.target.value || undefined })}
              />
            </label>

            {Array.isArray(q.presentation?.careerClubs) && q.presentation!.careerClubs!.length > 0 && (
              <fieldset disabled={locked} className="options">
                <legend>Career clubs</legend>
                {q.presentation!.careerClubs!.map((club, idx) => (
                  <EntityPicker
                    key={`${q.id}-club-${idx}`}
                    kind="team"
                    label={`Club ${idx + 1}`}
                    valueLabel={club.name}
                    imageUrl={club.logoUrl}
                    disabled={locked}
                    onPickTeam={(hit) => pickCareerClub(q, idx, hit)}
                  />
                ))}
              </fieldset>
            )}

            <fieldset disabled={locked} className="options">
              <legend>Options (pick correct · search to replace)</legend>
              {q.options.map((o) => (
                <div key={o.id} className="option-with-picker">
                  <div className="radio-col">
                    <input
                      type="radio"
                      name={`correct-${q.id}`}
                      checked={ans?.correctOptionId === o.id}
                      onChange={() => updateAnswer(q.id, { correctOptionId: o.id })}
                    />
                  </div>
                  {clubMode ? (
                    <EntityPicker
                      kind="team"
                      valueLabel={o.label}
                      imageUrl={o.teamLogoUrl}
                      disabled={locked}
                      onPickTeam={(hit) => pickClub(q, o, hit)}
                    />
                  ) : (
                    <EntityPicker
                      kind="player"
                      valueLabel={o.label}
                      imageUrl={o.headshotUrl}
                      disabled={locked}
                      onPickPlayer={(hit) => pickPlayer(q, o, hit)}
                    />
                  )}
                </div>
              ))}
            </fieldset>

            <label className="field">
              Reveal
              <textarea
                rows={2}
                value={ans?.reveal ?? ''}
                disabled={locked}
                onChange={(e) => updateAnswer(q.id, { reveal: e.target.value })}
              />
            </label>
          </article>
        )
      })}
    </div>
  )
}
