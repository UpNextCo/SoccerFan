import { useEffect, useRef } from 'react'
import { api, type AdminTeamHit } from '../api'
import { EntityPicker } from '../components/EntityPicker'
import { nationalityFlag } from '../countryFlags'
import './bingo-lms.css'

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
  position?: string
  clubs?: string[]
  leagues?: string[]
  trophies?: string[]
  awards?: string[]
  premierLeagueApps?: number | null
  topLeagueGoals?: number | null
  topLeagueApps?: number | null
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

const CATEGORY_NAMES: Record<string, string> = {
  nationality: 'Nationality',
  playedForClub: 'Played for club',
  nationClub: 'Nation + club',
  clubCombo: 'Club combination',
  wonCompetition: 'Competition winner',
  award: 'Award winner',
  statThreshold: 'Stat threshold',
}

function categoryName(category: Cat): string {
  return CATEGORY_NAMES[category.type ?? ''] ?? category.type ?? category.iconType ?? 'Custom'
}

function ruleSummary(category: Cat): string {
  const rule = String(category.matchingRule ?? '')
  const [first, second] = rule.split('|')
  switch (category.type) {
    case 'nationality':
      return `Players representing ${rule || 'a nationality'}`
    case 'playedForClub':
      return `Players who played for ${rule || 'this club'}`
    case 'nationClub':
      return `${first || 'Nationality'} players who played for ${second || 'club'}`
    case 'clubCombo':
      return `Players who represented both ${first || 'club A'} and ${second || 'club B'}`
    case 'wonCompetition':
      return `Players who won ${rule || 'this competition'}`
    case 'award':
      return `Players who received ${rule || 'this award'}`
    case 'statThreshold':
      return rule ? `Players meeting ${rule.replace('>=', ' ≥ ')}` : 'Players meeting this stat'
    default:
      return rule || 'No matching rule set'
  }
}

function categoryIcon(category: Cat) {
  if (category.logoUrl) {
    return (
      <span className="bingo-preview-logos">
        <img src={category.logoUrl} alt="" />
        {category.logo2Url && <img src={category.logo2Url} alt="" />}
      </span>
    )
  }
  if (category.flag || category.type === 'nationality') {
    const nationality = category.flag || String(category.matchingRule ?? '')
    return <span className="bingo-preview-flag">{nationalityFlag(nationality)}</span>
  }
  return <span className="bingo-preview-fallback">{String(category.iconValue ?? '●').slice(0, 2)}</span>
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
  const latestRef = useRef(p)
  useEffect(() => {
    latestRef.current = p
  }, [p])

  function commit(next: Puzzle) {
    latestRef.current = next
    onChange(next)
  }

  function updateCat(idx: number, patch: Partial<Cat>) {
    const current = latestRef.current
    commit({
      ...current,
      categories: (current.categories ?? []).map((c, i) => (i === idx ? { ...c, ...patch } : c)),
    })
  }

  function replacePlayer(idx: number, next: Player) {
    const current = latestRef.current
    commit({
      ...current,
      players: (current.players ?? []).map((pl, i) => (i === idx ? next : pl)),
    })
  }

  function addCategory() {
    const current = latestRef.current
    const nextNumber = (current.categories?.length ?? 0) + 1
    commit({
      ...current,
      categories: [
        ...(current.categories ?? []),
        {
          id: `category-${Date.now()}`,
          title: `Category ${nextNumber}`,
          label: `Category ${nextNumber}`,
          type: 'nationality',
          iconType: 'flag',
          iconValue: '',
          matchingRule: '',
          flag: '',
        },
      ],
    })
  }

  function removeCategory(idx: number) {
    const current = latestRef.current
    if ((current.categories?.length ?? 0) <= 1) return
    commit({ ...current, categories: current.categories.filter((_, i) => i !== idx) })
  }

  function moveCategory(idx: number, direction: -1 | 1) {
    const current = latestRef.current
    const nextIdx = idx + direction
    if (nextIdx < 0 || nextIdx >= current.categories.length) return
    const next = [...current.categories]
    ;[next[idx], next[nextIdx]] = [next[nextIdx]!, next[idx]!]
    commit({ ...current, categories: next })
  }

  async function pickPoolPlayer(
    idx: number,
    hit: { id: string; name: string; nationality?: string; headshotUrl?: string }
  ) {
    // Optimistic UI update so the thumb changes immediately.
    const currentPlayer = latestRef.current.players[idx]
    replacePlayer(idx, {
      ...currentPlayer,
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
    const cat = latestRef.current.categories[idx]!
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
    const cat = latestRef.current.categories[idx]!
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
        <header className="editor-section-header">
          <div>
            <strong>Categories ({categories.length})</strong>
            <p className="muted tiny">Preview the board, then edit each category below.</p>
          </div>
          <button type="button" disabled={locked} onClick={addCategory}>+ Add category</button>
        </header>
        <div className="bingo-board-preview" aria-label="Category board preview">
          {categories.map((category, idx) => (
            <div key={`preview-${category.id ?? idx}`} className="bingo-preview-tile">
              {categoryIcon(category)}
              <span>{category.title || category.label || `Category ${idx + 1}`}</span>
            </div>
          ))}
        </div>
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
            <article key={c.id ?? idx} className="bingo-cat bingo-category-card">
              <div className="bingo-category-heading">
                <div className="bingo-category-number">{idx + 1}</div>
                <div className="bingo-category-heading-copy">
                  <strong>{c.title || c.label || `Category ${idx + 1}`}</strong>
                  <div className="bingo-category-summary">
                    <span className="editor-badge">{categoryName(c)}</span>
                    <span className="muted tiny">{ruleSummary(c)}</span>
                  </div>
                </div>
                <div className="editor-icon-actions">
                  <button type="button" className="ghost tiny-btn" disabled={locked || idx === 0} onClick={() => moveCategory(idx, -1)} aria-label={`Move category ${idx + 1} up`}>↑</button>
                  <button type="button" className="ghost tiny-btn" disabled={locked || idx === categories.length - 1} onClick={() => moveCategory(idx, 1)} aria-label={`Move category ${idx + 1} down`}>↓</button>
                  <button type="button" className="danger tiny-btn" disabled={locked || categories.length <= 1} onClick={() => removeCategory(idx)}>Remove</button>
                </div>
              </div>
              <label className="field">
                Title
                <input
                  value={(c.title as string) ?? (c.label as string) ?? ''}
                  disabled={locked}
                  onChange={(e) => updateCat(idx, { title: e.target.value, label: e.target.value })}
                />
              </label>

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
              <details className="editor-advanced">
                <summary>Advanced</summary>
                <div className="advanced-grid">
                  <label className="field">Category ID<input value={c.id ?? ''} disabled={locked} onChange={(e) => updateCat(idx, { id: e.target.value })} /></label>
                  <label className="field">Type<input value={type} disabled={locked} onChange={(e) => updateCat(idx, { type: e.target.value })} /></label>
                  <label className="field">Icon type<input value={c.iconType ?? ''} disabled={locked} onChange={(e) => updateCat(idx, { iconType: e.target.value })} /></label>
                  <label className="field">Icon value<input value={c.iconValue ?? ''} disabled={locked} onChange={(e) => updateCat(idx, { iconValue: e.target.value })} /></label>
                  <label className="field">Raw matching rule<input value={String(c.matchingRule ?? '')} disabled={locked} onChange={(e) => updateCat(idx, { matchingRule: e.target.value })} /></label>
                  <span className="muted tiny">League hint: {leagueFromIconValue(c.iconValue)}</span>
                </div>
              </details>
            </article>
          )
        })}
      </section>

      <section className="q-card">
        <header>
          <strong>Player pool ({players.length})</strong>
        </header>
        <div className="bingo-player-grid">
          {players.map((pl, idx) => {
            const metadata = [
              pl.position,
              pl.nationality ? `${nationalityFlag(pl.nationality)} ${pl.nationality}` : undefined,
              pl.clubs?.length ? `${pl.clubs.length} clubs` : undefined,
              pl.leagues?.length ? `${pl.leagues.length} leagues` : undefined,
            ].filter((value): value is string => Boolean(value))
            return (
              <article key={`${pl.id ?? idx}-${pl.headshotUrl ?? ''}-${pl.name ?? ''}`} className="bingo-player-card">
                <div className="bingo-player-title">
                  {pl.headshotUrl ? <img src={pl.headshotUrl} alt="" /> : <span className="bingo-player-placeholder" />}
                  <div>
                    <strong>{pl.name || pl.displayName || `Player ${idx + 1}`}</strong>
                    <span className="muted tiny">{metadata.join(' · ') || 'No player metadata'}</span>
                  </div>
                </div>
                <EntityPicker
                  kind="player"
                  label="Swap player"
                  valueLabel={(pl.name as string) ?? (pl.displayName as string) ?? undefined}
                  imageUrl={pl.headshotUrl}
                  nationality={pl.nationality}
                  disabled={locked}
                  onPickPlayer={(hit) => pickPoolPlayer(idx, hit)}
                />
                <details className="editor-advanced">
                  <summary>Advanced</summary>
                  <div className="muted tiny">
                    <div>ID: <code>{pl.id ?? '—'}</code></div>
                    {pl.clubs?.length ? <div>Clubs: {pl.clubs.join(', ')}</div> : null}
                    {pl.trophies?.length ? <div>Trophies: {pl.trophies.join(', ')}</div> : null}
                    {pl.awards?.length ? <div>Awards: {pl.awards.join(', ')}</div> : null}
                    <div>PL apps: {pl.premierLeagueApps ?? '—'} · Top-league apps: {pl.topLeagueApps ?? '—'} · Goals: {pl.topLeagueGoals ?? '—'}</div>
                  </div>
                </details>
              </article>
            )
          })}
        </div>
      </section>
    </div>
  )
}
