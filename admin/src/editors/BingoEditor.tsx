import { api, type AdminTeamHit } from '../api'
import { EntityPicker } from '../components/EntityPicker'

type Cat = {
  id?: string
  title?: string
  label?: string
  type?: string
  matchingRule?: string
  iconType?: string
  iconValue?: string
  logoUrl?: string | null
  logo2Url?: string | null
  flag?: string
  [k: string]: unknown
}

type Player = {
  id?: string
  name?: string
  displayName?: string
  headshotUrl?: string | null
  nationality?: string
  clubs?: string[]
  [k: string]: unknown
}

type Puzzle = {
  categories: Cat[]
  players: Player[]
  [k: string]: unknown
}

function leagueFromIconValue(iconValue: string | undefined): string {
  if (!iconValue) return 'Premier League'
  const parts = iconValue.split('|')
  return parts[1] || 'Premier League'
}

export function BingoEditor({
  puzzle,
  locked,
  onChange,
}: {
  puzzle: unknown
  locked: boolean
  onChange: (puzzle: Puzzle) => void
}) {
  const p = puzzle as Puzzle
  const categories = p.categories ?? []
  const players = p.players ?? []

  function updateCat(idx: number, patch: Partial<Cat>) {
    onChange({
      ...p,
      categories: categories.map((c, i) => (i === idx ? { ...c, ...patch } : c)),
    })
  }

  function replacePlayer(idx: number, next: Player) {
    onChange({
      ...p,
      players: players.map((pl, i) => (i === idx ? next : pl)),
    })
  }

  async function pickPoolPlayer(
    idx: number,
    hit: { id: string; name: string; nationality?: string; headshotUrl?: string }
  ) {
    // Optimistic UI update so the thumb changes immediately.
    replacePlayer(idx, {
      ...players[idx],
      id: hit.id,
      name: hit.name,
      nationality: hit.nationality,
      headshotUrl: hit.headshotUrl ?? null,
    })
    try {
      const resolved = (await api.resolvePlayer(hit.id, 'bingo')) as Player
      replacePlayer(idx, resolved)
    } catch {
      // keep optimistic row
    }
  }

  async function pickClubRule(idx: number, hit: AdminTeamHit, slot: 'primary' | 'secondary' = 'primary') {
    const team = await api.resolveTeam(hit.id)
    const cat = categories[idx]!
    const type = cat.type ?? ''

    if (type === 'playedForClub' || cat.iconType === 'clubBadge') {
      updateCat(idx, {
        title: `Played for ${team.name}`,
        matchingRule: team.name,
        iconValue: `${team.name}|${team.leagueName ?? 'Premier League'}`,
        logoUrl: team.logoUrl,
      })
      return
    }

    if (type === 'nationClub' || cat.iconType === 'nationClub') {
      const nation = cat.flag || String(cat.matchingRule ?? '').split('|')[0] || ''
      const rule = `${nation}|${team.name}`
      updateCat(idx, {
        matchingRule: rule,
        iconValue: `${team.name}|${team.leagueName ?? 'Premier League'}`,
        logoUrl: team.logoUrl,
        title: cat.title?.includes('|') ? cat.title : `${nation} · ${team.name}`,
      })
      return
    }

    if (type === 'clubCombo' || cat.iconType === 'clubCombo') {
      const [a, b] = String(cat.matchingRule ?? '').split('|')
      if (slot === 'primary') {
        const nextA = team.name
        const nextB = b || a || ''
        updateCat(idx, {
          matchingRule: `${nextA}|${nextB}`,
          iconValue: `${nextA}|${nextB}`,
          title: `${nextA} & ${nextB}`,
          logoUrl: team.logoUrl,
        })
      } else {
        const nextA = a || team.name
        const nextB = team.name
        updateCat(idx, {
          matchingRule: `${nextA}|${nextB}`,
          iconValue: `${nextA}|${nextB}`,
          title: `${nextA} & ${nextB}`,
          logo2Url: team.logoUrl,
        })
      }
    }
  }

  async function pickNationality(idx: number, name: string) {
    const cat = categories[idx]!
    const type = cat.type ?? ''
    if (type === 'nationality' || cat.iconType === 'flag') {
      updateCat(idx, {
        title: name,
        matchingRule: name,
        iconValue: name,
        flag: name,
      })
      return
    }
    if (type === 'nationClub' || cat.iconType === 'nationClub') {
      const club = String(cat.matchingRule ?? '').split('|')[1] || ''
      updateCat(idx, {
        matchingRule: `${name}|${club}`,
        flag: name,
        title: `${name} · ${club}`,
      })
    }
  }

  return (
    <div className="mode-editor">
      <section className="q-card">
        <header>
          <strong>Categories ({categories.length})</strong>
        </header>
        {categories.map((c, idx) => {
          const type = c.type ?? ''
          const isClub =
            type === 'playedForClub' ||
            type === 'nationClub' ||
            type === 'clubCombo' ||
            c.iconType === 'clubBadge' ||
            c.iconType === 'nationClub' ||
            c.iconType === 'clubCombo'
          const isNat =
            type === 'nationality' ||
            type === 'nationClub' ||
            c.iconType === 'flag' ||
            c.iconType === 'nationClub'
          const ruleParts = String(c.matchingRule ?? '').split('|')

          return (
            <div key={c.id ?? idx} className="bingo-cat">
              <label className="field">
                Title
                <input
                  value={(c.title as string) ?? (c.label as string) ?? ''}
                  disabled={locked}
                  onChange={(e) => updateCat(idx, { title: e.target.value, label: e.target.value })}
                />
              </label>
              <p className="muted tiny">
                {String(c.iconType ?? type)} · rule: <code>{String(c.matchingRule ?? '')}</code>
              </p>

              {isNat && (
                <EntityPicker
                  kind="nationality"
                  label="Nationality"
                  valueLabel={
                    type === 'nationality'
                      ? String(c.matchingRule ?? '')
                      : ruleParts[0] || c.flag || undefined
                  }
                  disabled={locked}
                  onPickNationality={(hit) => pickNationality(idx, hit.name)}
                />
              )}

              {isClub && type !== 'clubCombo' && c.iconType !== 'clubCombo' && (
                <EntityPicker
                  kind="team"
                  label="Club"
                  valueLabel={
                    type === 'playedForClub'
                      ? String(c.matchingRule ?? '')
                      : ruleParts[1] || undefined
                  }
                  imageUrl={c.logoUrl}
                  disabled={locked}
                  onPickTeam={(hit) => pickClubRule(idx, hit, 'primary')}
                />
              )}

              {(type === 'clubCombo' || c.iconType === 'clubCombo') && (
                <div className="row">
                  <EntityPicker
                    kind="team"
                    label="Club A"
                    valueLabel={ruleParts[0] || undefined}
                    imageUrl={c.logoUrl}
                    disabled={locked}
                    onPickTeam={(hit) => pickClubRule(idx, hit, 'primary')}
                  />
                  <EntityPicker
                    kind="team"
                    label="Club B"
                    valueLabel={ruleParts[1] || undefined}
                    imageUrl={c.logo2Url}
                    disabled={locked}
                    onPickTeam={(hit) => pickClubRule(idx, hit, 'secondary')}
                  />
                </div>
              )}

              {!isClub && !isNat && (
                <label className="field">
                  matchingRule
                  <input
                    disabled={locked}
                    value={String(c.matchingRule ?? '')}
                    onChange={(e) => updateCat(idx, { matchingRule: e.target.value })}
                  />
                </label>
              )}
              <span className="muted tiny">league hint: {leagueFromIconValue(c.iconValue)}</span>
            </div>
          )
        })}
      </section>

      <section className="q-card">
        <header>
          <strong>Player pool ({players.length})</strong>
        </header>
        <div className="player-grid">
          {players.map((pl, idx) => (
            <EntityPicker
              key={`${pl.id ?? idx}-${pl.headshotUrl ?? ''}-${pl.name ?? ''}`}
              kind="player"
              valueLabel={(pl.name as string) ?? (pl.displayName as string) ?? undefined}
              imageUrl={pl.headshotUrl}
              nationality={pl.nationality}
              disabled={locked}
              onPickPlayer={(hit) => pickPoolPlayer(idx, hit)}
            />
          ))}
        </div>
      </section>
    </div>
  )
}
