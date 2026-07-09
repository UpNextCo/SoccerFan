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
  presentation?: unknown
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

  function updateOption(slot: number, optId: string, patch: Partial<Opt>) {
    const nextQs = questions.map((q) => {
      if (q.slot !== slot) return q
      return {
        ...q,
        options: q.options.map((o) => (o.id === optId ? { ...o, ...patch } : o)),
      }
    })
    onChange({ ...p, questions: nextQs }, a)
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

            <fieldset disabled={locked} className="options">
              <legend>Options (pick correct)</legend>
              {q.options.map((o) => (
                <div key={o.id} className="option-row">
                  <input
                    type="radio"
                    name={`correct-${q.id}`}
                    checked={ans?.correctOptionId === o.id}
                    onChange={() => updateAnswer(q.id, { correctOptionId: o.id })}
                  />
                  <input
                    className="grow"
                    value={o.label}
                    onChange={(e) => updateOption(q.slot, o.id, { label: e.target.value })}
                  />
                  <span className="muted tiny">{o.id}</span>
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
