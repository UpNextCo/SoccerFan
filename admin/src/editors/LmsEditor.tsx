import { useEffect, useRef, useState } from 'react'
import { api, type AdminPlayerHit, type AdminTeamHit } from '../api'
import { EntityPicker } from '../components/EntityPicker'
import './bingo-lms.css'
import './editor-clean.css'

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
const EMPTY_LMS_ANSWER: Answer = { questions: [] }

const QUESTION_TYPES = [
  'higher_lower',
  'career_path',
  'odd_one_out',
  'which_club',
  'image_badge',
  'custom_image',
] as const
type QuestionType = (typeof QUESTION_TYPES)[number]

const FRIENDLY_TYPES: Record<QuestionType, string> = {
  higher_lower: 'Higher or lower',
  career_path: 'Career path',
  odd_one_out: 'Odd one out',
  which_club: 'Which club?',
  image_badge: 'Image badge',
  custom_image: 'Custom image',
}

function isQuestionType(value: string): value is QuestionType {
  return QUESTION_TYPES.some((type) => type === value)
}

function friendlyType(type: string): string {
  return isQuestionType(type) ? FRIENDLY_TYPES[type] : type.replaceAll('_', ' ')
}

function expectedOptionCount(type: string): number {
  return type === 'higher_lower' ? 2 : 4
}

function makeOptionId(questionId: string, key: string): string {
  return `${questionId}-${key}`
}

function isClubQuestion(q: Q): boolean {
  if (q.type === 'which_club' || q.type === 'image_badge') return true
  if (q.type !== 'odd_one_out') return false
  const sub = q.subPrompt?.toLowerCase() ?? ''
  return sub.includes('club')
}

async function prepareImageUpload(file: File): Promise<{ fileBase64: string; mimeType: string }> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
  let width = Math.max(1, Math.round(bitmap.width * scale))
  let height = Math.max(1, Math.round(bitmap.height * scale))
  let quality = 0.86

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('This browser cannot prepare images.')
    context.drawImage(bitmap, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    if (!blob) throw new Error('Could not prepare the image.')
    if (blob.size <= 2.5 * 1024 * 1024) {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('Could not read the prepared image.'))
        reader.readAsDataURL(blob)
      })
      bitmap.close()
      return { fileBase64: dataUrl.split(',')[1] ?? '', mimeType: 'image/jpeg' }
    }
    quality = Math.max(0.65, quality - 0.06)
    width = Math.max(1, Math.round(width * 0.85))
    height = Math.max(1, Math.round(height * 0.85))
  }
  bitmap.close()
  throw new Error('The image is still too large after resizing.')
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
  const a = (answer as Answer | null) ?? EMPTY_LMS_ANSWER
  const questions = sortedQuestions(p)
  const [activeSlot, setActiveSlot] = useState(() => questions[0]?.slot ?? 1)
  const [imageUpload, setImageUpload] = useState<{ slot?: number; state: 'idle' | 'preparing' | 'uploading' | 'error'; error?: string }>({ state: 'idle' })
  const activeQuestion = questions.find((question) => question.slot === activeSlot) ?? questions[0]

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

  function setQuestionType(question: Q, type: QuestionType) {
    const defaultLayout: Record<QuestionType, string> = {
      higher_lower: 'two_up',
      career_path: 'stack',
      odd_one_out: 'grid',
      which_club: 'grid',
      image_badge: 'image_header',
      custom_image: 'image_header',
    }
    if (type === 'custom_image') {
      const { p: curP, a: curA } = latestRef.current
      const options = Array.from({ length: 4 }, (_, index) => ({
        id: makeOptionId(question.id, `custom-${index + 1}`),
        label: `Option ${index + 1}`,
      }))
      const nextQuestions = sortedQuestions(curP).map((item) =>
        item.id === question.id
          ? {
              ...item,
              type,
              options,
              presentation: {
                layout: 'image_header',
                imageUrl: item.type === 'custom_image' ? item.presentation?.imageUrl : undefined,
                imageBlur: 0,
              },
            }
          : item
      )
      const existing = curA.questions.find((item) => item.questionId === question.id)
      const nextRow: Ans = {
        ...(existing ?? { questionId: question.id }),
        questionId: question.id,
        correctOptionId: options[0]!.id,
        reveal: options[0]!.label,
      }
      const nextAnswers = existing
        ? curA.questions.map((item) => (item.questionId === question.id ? nextRow : item))
        : [...curA.questions, nextRow]
      commit({ ...curP, questions: nextQuestions }, { questions: nextAnswers })
      return
    }
    updateQuestion(question.slot, {
      type,
      presentation: { ...(question.presentation ?? {}), layout: defaultLayout[type] },
    })
  }

  function updateCustomOption(question: Q, optionId: string, label: string) {
    const { p: curP, a: curA } = latestRef.current
    const previousLabel = question.options.find((option) => option.id === optionId)?.label
    const nextQuestions = sortedQuestions(curP).map((item) =>
      item.id === question.id
        ? {
            ...item,
            options: item.options.map((option) =>
              option.id === optionId
                ? { ...option, label, teamLogoUrl: undefined }
                : option
            ),
          }
        : item
    )
    const nextAnswers = curA.questions.map((answerRow) =>
      answerRow.questionId === question.id &&
      answerRow.correctOptionId === optionId &&
      (!answerRow.reveal || answerRow.reveal === previousLabel)
        ? { ...answerRow, reveal: label }
        : answerRow
    )
    commit({ ...curP, questions: nextQuestions }, { questions: nextAnswers })
  }

  async function uploadCustomImage(question: Q, file: File) {
    setImageUpload({ slot: question.slot, state: 'preparing' })
    try {
      const prepared = await prepareImageUpload(file)
      setImageUpload({ slot: question.slot, state: 'uploading' })
      const uploaded = await api.uploadLmsImage({
        ...prepared,
        filename: file.name,
      })
      updateQuestion(question.slot, {
        presentation: {
          ...(latestRef.current.p.questions.find((item) => item.id === question.id)?.presentation ?? {}),
          layout: 'image_header',
          imageUrl: uploaded.url,
          imageBlur: 0,
        },
      })
      setImageUpload({ slot: question.slot, state: 'idle' })
    } catch (error) {
      setImageUpload({
        slot: question.slot,
        state: 'error',
        error: error instanceof Error ? error.message : 'Image upload failed.',
      })
    }
  }

  function addOption(question: Q) {
    const nextNumber = question.options.length + 1
    updateQuestion(question.slot, {
      options: [
        ...question.options,
        { id: makeOptionId(question.id, `option-${Date.now()}`), label: `Option ${nextNumber}` },
      ],
    })
  }

  function removeOption(question: Q, optionId: string) {
    if (question.options.length <= 2) return
    const { p: curP, a: curA } = latestRef.current
    const nextOptions = question.options.filter((option) => option.id !== optionId)
    const nextQuestions = sortedQuestions(curP).map((item) =>
      item.id === question.id ? { ...item, options: nextOptions } : item
    )
    const nextAnswers = curA.questions.map((item) =>
      item.questionId === question.id && item.correctOptionId === optionId
        ? {
            ...item,
            correctOptionId: nextOptions[0]?.id ?? '',
            reveal: nextOptions[0]?.label ?? item.reveal,
          }
        : item
    )
    commit({ ...curP, questions: nextQuestions }, { questions: nextAnswers })
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
    const existing = curA.questions.find((ans) => ans.questionId === question.id)
    const nextRow: Ans = {
      ...(existing ?? { questionId: question.id }),
      correctOptionId: optionId,
      reveal: opt?.label ?? existing?.reveal,
    }
    const nextAns: Answer = {
      questions: existing
        ? curA.questions.map((ans) => (ans.questionId === question.id ? nextRow : ans))
        : [...curA.questions, nextRow],
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
    const existing = curA.questions.find((ans) => ans.questionId === questionId)
    const question = curP.questions.find((item) => item.id === questionId)
    const nextRow: Ans = {
      ...(existing ?? {
        questionId,
        correctOptionId: question?.options[0]?.id ?? '',
      }),
      ...patch,
      questionId,
    }
    commit(curP, {
      questions: existing
        ? curA.questions.map((ans) => (ans.questionId === questionId ? nextRow : ans))
        : [...curA.questions, nextRow],
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
      <section className="q-card lms-overview">
        <label className="field">
          Title
          <input
            value={p.title ?? ''}
            disabled={locked}
            onChange={(e) => commit({ ...latestRef.current.p, title: e.target.value }, latestRef.current.a)}
          />
        </label>
        <p className="muted">{questions.length} questions</p>
      </section>

      <nav className="lms-question-nav" aria-label="Question navigator">
        {questions.map((question) => {
          const answerRow = correctFor(question)
          const hasCorrect = Boolean(
            answerRow && question.options.some((option) => option.id === answerRow.correctOptionId)
          )
          const complete = Boolean(question.prompt.trim() && hasCorrect)
          return (
            <button
              key={question.id}
              type="button"
              className={`lms-nav-button${question.slot === activeQuestion?.slot ? ' active' : ''}`}
              onClick={() => setActiveSlot(question.slot)}
              aria-current={question.slot === activeQuestion?.slot ? 'step' : undefined}
            >
              <span>Q{question.slot}</span>
              <span className={`lms-status-dot ${complete ? 'complete' : 'warning'}`} aria-label={complete ? 'Complete' : 'Needs attention'} />
            </button>
          )
        })}
      </nav>

      {activeQuestion ? (() => {
        const q = activeQuestion
        const ans = correctFor(q)
        const clubMode = isClubQuestion(q)
        const hasCorrect = Boolean(ans && q.options.some((option) => option.id === ans.correctOptionId))
        const expectedOptions = expectedOptionCount(q.type)
        const optionCountValid = q.options.length === expectedOptions
        const complete = Boolean(q.prompt.trim() && hasCorrect && optionCountValid)
        return (
          <article key={q.id} className="q-card lms-question-card">
            <header className="lms-question-header">
              <div>
                <div className="lms-question-title">
                  <strong>Question {q.slot}</strong>
                  <span className="muted tiny">{friendlyType(q.type)}</span>
                  {q.signature && <span className="muted tiny">Signature question</span>}
                </div>
                <div className="lms-question-statuses">
                  <span className={complete ? 'editor-clean-status' : 'editor-clean-status warning'}>{complete ? 'Ready' : 'Needs attention'}</span>
                </div>
              </div>
              <div className="editor-icon-actions">
                <button type="button" className="ghost tiny-btn" disabled={q.slot === questions[0]?.slot} onClick={() => setActiveSlot(questions[Math.max(0, questions.findIndex((item) => item.slot === q.slot) - 1)]?.slot ?? q.slot)}>← Previous</button>
                <button type="button" className="ghost tiny-btn" disabled={q.slot === questions.at(-1)?.slot} onClick={() => setActiveSlot(questions[Math.min(questions.length - 1, questions.findIndex((item) => item.slot === q.slot) + 1)]?.slot ?? q.slot)}>Next →</button>
              </div>
            </header>

            <div className="lms-question-controls">
              <label className="field">
                Question type
                <select
                  value={q.type}
                  disabled={locked}
                  onChange={(event) => {
                    if (isQuestionType(event.target.value)) setQuestionType(q, event.target.value)
                  }}
                >
                  {!isQuestionType(q.type) && <option value={q.type}>{friendlyType(q.type)}</option>}
                  {QUESTION_TYPES.map((type) => <option key={type} value={type}>{FRIENDLY_TYPES[type]}</option>)}
                </select>
              </label>
              <label className="lms-signature-control">
                <input type="checkbox" checked={q.signature ?? false} disabled={locked} onChange={(event) => updateQuestion(q.slot, { signature: event.target.checked })} />
                Signature question
              </label>
            </div>

            <label className="field">
              Question
              <textarea
                rows={2}
                value={q.prompt}
                disabled={locked}
                onChange={(e) => updateQuestion(q.slot, { prompt: e.target.value })}
              />
            </label>
            <label className="field">
              Extra context
              <input
                value={q.subPrompt ?? ''}
                disabled={locked}
                onChange={(e) => updateQuestion(q.slot, { subPrompt: e.target.value || undefined })}
              />
            </label>

            {q.type === 'image_badge' && (
              <div className="badge-preview">
                <div className="badge-preview-heading">
                  <div className="muted tiny">Preview shown to players</div>
                </div>
                {q.presentation?.imageUrl ? (
                  <img
                    key={q.presentation.imageUrl}
                    src={q.presentation.imageUrl}
                    alt="Badge preview"
                    className="badge-preview-img"
                    style={{ filter: `blur(${Math.max(2, (q.presentation.imageBlur ?? 6) / 2)}px)` }}
                  />
                ) : (
                  <p className="error tiny">Choose the correct club to create this preview.</p>
                )}
              </div>
            )}

            {q.type === 'custom_image' && (
              <div className="custom-image-panel">
                <div className="muted tiny">Question image</div>
                {q.presentation?.imageUrl ? (
                  <img src={q.presentation.imageUrl} alt="Question preview" className="custom-image-preview" />
                ) : (
                  <div className="custom-image-empty">Choose a kit, stadium, or football photo.</div>
                )}
                <div className="editor-icon-actions">
                  <label className={`ghost tiny-btn${locked ? ' disabled' : ''}`}>
                    {q.presentation?.imageUrl ? 'Replace image' : 'Choose image'}
                    <input
                      className="visually-hidden"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      disabled={locked || (imageUpload.slot === q.slot && imageUpload.state !== 'idle' && imageUpload.state !== 'error')}
                      onChange={(event) => {
                        const file = event.target.files?.[0]
                        if (file) void uploadCustomImage(q, file)
                        event.target.value = ''
                      }}
                    />
                  </label>
                  {q.presentation?.imageUrl && (
                    <button
                      type="button"
                      className="ghost tiny-btn"
                      disabled={locked}
                      onClick={() => updateQuestion(q.slot, {
                        presentation: { ...(q.presentation ?? {}), imageUrl: undefined, imageBlur: 0 },
                      })}
                    >
                      Clear image
                    </button>
                  )}
                </div>
                {imageUpload.slot === q.slot && imageUpload.state === 'preparing' && <p className="muted tiny">Preparing image…</p>}
                {imageUpload.slot === q.slot && imageUpload.state === 'uploading' && <p className="muted tiny">Uploading image…</p>}
                {imageUpload.slot === q.slot && imageUpload.state === 'error' && <p className="error tiny">{imageUpload.error}</p>}
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
              <legend>Possible answers ({q.options.length}/{expectedOptions})</legend>
              {!optionCountValid && (
                <p className="editor-inline-warning">
                  {friendlyType(q.type)} requires exactly {expectedOptions} options. Add or remove options before saving.
                </p>
              )}
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
                  {q.type === 'custom_image' ? (
                    <div className="custom-option-row">
                      {o.teamLogoUrl && (
                        <img src={o.teamLogoUrl} alt="" className="custom-option-badge" />
                      )}
                      <label className="field custom-option-input">
                        Answer {q.options.indexOf(o) + 1}
                        <input
                          value={o.label}
                          disabled={locked}
                          onChange={(event) => updateCustomOption(q, o.id, event.target.value)}
                        />
                      </label>
                    </div>
                  ) : clubMode ? (
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
                      nationality={o.nationality}
                      disabled={locked}
                      onPickPlayer={(hit) => pickPlayer(q, o, hit)}
                    />
                  )}
                  {q.type !== 'custom_image' && <button
                    type="button"
                    className="danger tiny-btn lms-remove-option"
                    disabled={locked || q.options.length <= 2}
                    onClick={() => removeOption(q, o.id)}
                    aria-label={`Remove ${o.label}`}
                  >
                    Remove
                  </button>}
                </div>
              ))}
              {q.type !== 'custom_image' && (
                <button type="button" className="ghost" disabled={locked} onClick={() => addOption(q)}>+ Add option</button>
              )}
            </fieldset>

            <label className="field">
              Answer explanation
              <textarea
                rows={2}
                value={ans?.reveal ?? ''}
                disabled={locked}
                onChange={(e) => updateAnswer(q.id, { reveal: e.target.value })}
              />
            </label>
            <details className="editor-advanced">
              <summary>Advanced</summary>
              <div className="advanced-grid">
                <label className="field">Display style<input value={q.presentation?.layout ?? ''} disabled={locked} onChange={(event) => updateQuestion(q.slot, { presentation: { ...(q.presentation ?? {}), layout: event.target.value } })} /></label>
                {q.presentation?.imageUrl && <label className="field">Image source<input value={q.presentation.imageUrl} disabled={locked} onChange={(event) => updateQuestion(q.slot, { presentation: { ...(q.presentation ?? {}), imageUrl: event.target.value } })} /></label>}
                {(q.type === 'image_badge' || q.type === 'custom_image') && (
                  <label className="field lms-blur-control">
                    Image blur
                    <input
                      type="range"
                      min="0"
                      max="20"
                      step="1"
                      value={q.presentation?.imageBlur ?? (q.type === 'image_badge' ? 6 : 0)}
                      disabled={locked}
                      onChange={(event) => updateQuestion(q.slot, {
                        presentation: { ...(q.presentation ?? {}), imageBlur: Number(event.target.value) },
                      })}
                    />
                    <input
                      type="number"
                      min="0"
                      max="20"
                      value={q.presentation?.imageBlur ?? (q.type === 'image_badge' ? 6 : 0)}
                      disabled={locked}
                      onChange={(event) => updateQuestion(q.slot, {
                        presentation: { ...(q.presentation ?? {}), imageBlur: Number(event.target.value) },
                      })}
                    />
                  </label>
                )}
              </div>
            </details>
          </article>
        )
      })() : <p className="editor-inline-warning">No questions available.</p>}
    </div>
  )
}
