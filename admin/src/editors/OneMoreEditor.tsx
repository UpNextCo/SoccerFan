import { api } from '../api'
import { EntityPicker } from '../components/EntityPicker'

type Opt = {
  id: string
  name?: string
  value?: number
  nationality?: string
  position?: string
  clubs?: string
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
  rounds: Round[]
  [k: string]: unknown
}

type Answer = {
  valuesByRound?: Array<Record<string, number>>
  [k: string]: unknown
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
  const a = (answer as Answer) ?? {}
  const rounds = p.rounds ?? []
  const valuesByRound: Array<Record<string, number>> =
    a.valuesByRound ?? rounds.map(() => ({} as Record<string, number>))

  function replaceOpt(ri: number, oldId: string, next: Opt, keepValue?: number) {
    const nextRounds = rounds.map((r, i) => {
      if (i !== ri) return r
      return {
        ...r,
        options: r.options.map((o) => (o.id === oldId ? next : o)),
      }
    })
    const nextValues = valuesByRound.map((row, i) => {
      if (i !== ri) return row
      const copy = { ...row }
      const prevVal = keepValue ?? copy[oldId] ?? next.value
      if (oldId !== next.id) delete copy[oldId]
      if (typeof prevVal === 'number') copy[next.id] = prevVal
      return copy
    })
    onChange({ ...p, rounds: nextRounds }, { ...a, valuesByRound: nextValues })
  }

  function updateValue(ri: number, optId: string, value: number) {
    const next = valuesByRound.map((row, i) => (i === ri ? { ...row, [optId]: value } : row))
    const nextRounds = rounds.map((r, i) => {
      if (i !== ri) return r
      return {
        ...r,
        options: r.options.map((o) => (o.id === optId ? { ...o, value } : o)),
      }
    })
    onChange({ ...p, rounds: nextRounds }, { ...a, valuesByRound: next })
  }

  async function pickPlayer(ri: number, old: Opt, hit: { id: string; name: string; nationality?: string; position?: string; headshotUrl?: string; teamLogoUrl?: string }) {
    let resolved = {
      id: hit.id,
      name: hit.name,
      nationality: hit.nationality ?? '',
      position: hit.position ?? '',
      clubs: '',
      headshotUrl: hit.headshotUrl,
      teamId: undefined as number | undefined,
      teamLogoUrl: hit.teamLogoUrl,
    }
    try {
      const full = (await api.resolvePlayer(hit.id, 'card')) as typeof resolved
      resolved = {
        id: full.id || hit.id,
        name: full.name || hit.name,
        nationality: full.nationality || hit.nationality || '',
        position: full.position || hit.position || '',
        clubs: full.clubs || '',
        headshotUrl: full.headshotUrl ?? hit.headshotUrl,
        teamId: full.teamId,
        teamLogoUrl: full.teamLogoUrl ?? hit.teamLogoUrl,
      }
    } catch {
      // search hit is enough
    }
    const row = valuesByRound[ri] ?? {}
    const keepValue = row[old.id] ?? old.value
    replaceOpt(
      ri,
      old.id,
      {
        id: resolved.id,
        name: resolved.name,
        nationality: resolved.nationality,
        position: resolved.position,
        clubs: resolved.clubs,
        headshotUrl: resolved.headshotUrl,
        teamId: resolved.teamId,
        teamLogoUrl: resolved.teamLogoUrl,
        value: typeof keepValue === 'number' ? keepValue : old.value,
      },
      typeof keepValue === 'number' ? keepValue : undefined
    )
  }

  return (
    <div className="mode-editor">
      {rounds.map((r, ri) => (
        <article key={ri} className="q-card">
          <header>
            <strong>Round {ri + 1}</strong>
          </header>
          {r.options.map((o) => {
            const row = valuesByRound[ri] ?? {}
            const hidden = row[o.id] ?? o.value ?? ''
            return (
              <div key={o.id} className="option-row stack">
                <EntityPicker
                  key={`${o.id}-${o.headshotUrl ?? ''}-${o.name ?? ''}`}
                  kind="player"
                  valueLabel={o.name}
                  imageUrl={o.headshotUrl}
                  nationality={o.nationality}
                  disabled={locked}
                  onPickPlayer={(hit) => pickPlayer(ri, o, hit)}
                />
                <div className="row">
                  <label className="field">
                    Hidden value
                    <input
                      type="number"
                      value={hidden}
                      disabled={locked}
                      onChange={(e) => updateValue(ri, o.id, Number(e.target.value))}
                    />
                  </label>
                  <span className="muted tiny">{o.id}</span>
                </div>
              </div>
            )
          })}
        </article>
      ))}
    </div>
  )
}
