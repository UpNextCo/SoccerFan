import { useEffect, useRef } from 'react'
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

type Presentation = {
  layout?: string
  imageUrl?: string
  imageBlur?: number
  careerClubs?: Array<{ name: string; logoUrl?: string }>
  [k: string]: unknown
}

type Q = {
  id: string
  type: string
  slot: number
  signature?: boolean
  prompt: string
  subPrompt?: string
  options: Opt[]
  presentation?: Presentation
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

function sortedQuestions(p: Puzzle): Q[] {
  return [...(p.questions ?? [])].sort((x, y) => x.slot - y.slot)
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
  const questions = sortedQuestions(p)

  // Keep latest puzzle/answer for async pick handlers (avoid stale closures wiping media).
  const latestRef = useRef({ p, a })
  useEffect(() => {
    latestRef.current = { p, a }
  }, [p, a])

  function commit(nextPuzzle: Puzzle, nextAnswer: Answer) {
    latestRef.current = { p: nextPuzzle, a: nextAnswer }
    onChange(nextPuzzle, nextAnswer)
  }

  function updateQuestion(slot: number, patch: Partial<Q>) {
    const { p: curP, a: curA } = latestRef.current
    const nextQs = sortedQuestions(curP).map((q) => (q.slot === slot ? { ...q, ...patch } : q))
    commit({ ...curP, questions: nextQs }, curA)
  }

  function replaceOption(
    questionId: string,
    oldOptId: string,
    nextOpt: Opt,
    extras?: {
      presentation?: Presentation
      answerPatch?: Partial<Ans>
    }
  ) {
    const { p: curP, a: curA } = latestRef.current
    const nextQs = sortedQuestions(curP).map((q) => {
      if (q.id !== questionId) return q
      return {
        ...q,
        options: q.options.map((o) => (o.id === oldOptId ? nextOpt : o)),
        ...(extras?.presentation ? { presentation: extras.presentation } : {}),
      }
    })
    const nextAns: Answer = {
      questions: curA.questions.map((ans) => {
        if (ans.questionId !== questionId) return ans
        const wasCorrect = ans.correctOptionId === oldOptId
        return {
          ...ans,
          ...(wasCorrect ? { correctOptionId: nextOpt.id } : {}),
          ...extras?.answerPatch,
        }
      }),
    }
    commit({ ...curP, questions: nextQs }, nextAns)
  }

  function setCorrectOption(question: Q, optionId: string) {
    const { p: curP, a: curA } = latestRef.current
    const opt = question.options.find((o) => o.id === optionId)
    const nextAns: Answer = {
      questions: curA.questions.map((ans) =>
        ans.questionId === question.id
          ? {
              ...ans,
              correctOptionId: optionId,
              reveal: opt?.label ?? ans.reveal,
            }
          : ans
      ),
    }

    // image_badge blurred header must track the correct club.
    if (question.type === 'image_badge' && opt) {
      const nextQs = sortedQuestions(curP).map((q) => {
        if (q.id !== question.id) return q
        return {
          ...q,
          presentation: {
            ...(q.presentation ?? {}),
            layout: q.presentation?.layout ?? 'image_header',
            imageUrl: opt.teamLogoUrl || q.presentation?.imageUrl,
            imageBlur: q.presentation?.imageBlur ?? 6,
          },
        }
      })
      commit({ ...curP, questions: nextQs }, nextAns)
      return
    }

    commit(curP, nextAns)
  }

  function updateAnswer(questionId: string, patch: Partial<Ans>) {
    const { p: curP, a: curA } = latestRef.current
    commit(curP, {
      questions: curA.questions.map((ans) =>
        ans.questionId === questionId ? { ...ans, ...patch } : ans
      ),
    })
  }

  function correctFor(q: Q): Ans | undefined {
    return a.questions.find((x) => x.questionId === q.id)
  }

  async function pickPlayer(q: Q, oldOpt: Opt, hit: AdminPlayerHit) {
    const nextId = makeOptionId(q.id, hit.id)
    // Optimistic: update name + photo from search hit immediately (fixes stale Raul thumb).
    replaceOption(q.id, oldOpt.id, {
      id: nextId,
      label: hit.name,
      headshotUrl: hit.headshotUrl,
      teamLogoUrl: hit.teamLogoUrl,
      nationality: hit.nationality,
      position: hit.position,
    })

    try {
      const full = (await api.resolvePlayer(hit.id, 'card')) as {
        id: string
        name: string
        nationality?: string
        position?: string
        headshotUrl?: string
        teamLogoUrl?: string
      }
      replaceOption(q.id, nextId, {
        id: makeOptionId(q.id, full.id || hit.id),
        label: full.name || hit.name,
        headshotUrl: full.headshotUrl ?? hit.headshotUrl,
        teamLogoUrl: full.teamLogoUrl ?? hit.teamLogoUrl,
        nationality: full.nationality ?? hit.nationality,
        position: full.position ?? hit.position,
      })
    } catch {
      // optimistic row is enough
    }
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
      id: makeOptionId(q.id, optionKey),
      label: team.name,
      teamLogoUrl: team.logoUrl,
    }

    const { a: curA } = latestRef.current
    const ans = curA.questions.find((x) => x.questionId === q.id)
    const willBeCorrect =
      ans?.correctOptionId === oldOpt.id || ans?.correctOptionId === nextOpt.id

    const presentation =
      q.type === 'image_badge' && willBeCorrect
        ? {
            ...(q.presentation ?? {}),
            layout: 'image_header' as const,
            imageUrl: team.logoUrl,
            imageBlur: q.presentation?.imageBlur ?? 6,
          }
        : undefined

    const answerPatch =
      willBeCorrect
        ? { reveal: team.name, correctOptionId: nextOpt.id }
        : undefined

    replaceOption(q.id, oldOpt.id, nextOpt, { presentation, answerPatch })
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
          onChange={(e) => commit({ ...p, title: e.target.value }, a)}
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

            {q.type === 'image_badge' && (
              <div className="badge-preview">
                <div className="muted tiny">Blurred badge shown in-game (correct club)</div>
                {q.presentation?.imageUrl ? (
                  <img
                    key={q.presentation.imageUrl}
                    src={q.presentation.imageUrl}
                    alt="Badge preview"
                    className="badge-preview-img"
                    style={{ filter: `blur(${Math.max(2, (q.presentation.imageBlur ?? 6) / 2)}px)` }}
                  />
                ) : (
                  <p className="error tiny">No presentation.imageUrl — pick/mark the correct club</p>
                )}
              </div>
            )}

            {Array.isArray(q.presentation?.careerClubs) && q.presentation!.careerClubs!.length > 0 && (
              <fieldset disabled={locked} className="options">
                <legend>Career clubs</legend>
                {q.presentation!.careerClubs!.map((club, idx) => (
                  <EntityPicker
                    key={`${q.id}-club-${idx}-${club.name}-${club.logoUrl ?? ''}`}
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
                <div key={`${q.id}-${o.id}`} className="option-with-picker">
                  <div className="radio-col">
                    <input
                      type="radio"
                      name={`correct-${q.id}`}
                      checked={ans?.correctOptionId === o.id}
                      onChange={() => setCorrectOption(q, o.id)}
                    />
                  </div>
                  {clubMode ? (
                    <EntityPicker
                      key={`team-${o.id}-${o.teamLogoUrl ?? ''}-${o.label}`}
                      kind="team"
                      valueLabel={o.label}
                      imageUrl={o.teamLogoUrl}
                      disabled={locked}
                      onPickTeam={(hit) => pickClub(q, o, hit)}
                    />
                  ) : (
                    <EntityPicker
                      key={`player-${o.id}-${o.headshotUrl ?? ''}-${o.label}`}
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
