import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type AdminLeagueHit, type AdminTeamHit } from '../api'
import { EntityPicker } from '../components/EntityPicker'
import { nationalityFlag } from '../countryFlags'
import './bingo-lms.css'

const CATEGORY_TYPES = [
  'nationality',
  'playedForClub',
  'playedInLeague',
  'nationClub',
  'clubLeague',
  'nationLeague',
  'clubCombo',
  'wonCompetition',
  'award',
  'statThreshold',
] as const
type CategoryType = (typeof CATEGORY_TYPES)[number]

const CATEGORY_NAMES: Record<CategoryType, string> = {
  nationality: 'Country',
  playedForClub: 'Club',
  playedInLeague: 'League',
  nationClub: 'Club and country',
  clubLeague: 'Club and league',
  nationLeague: 'Country and league',
  clubCombo: 'Two clubs',
  wonCompetition: 'Trophy winner',
  award: 'Award winner',
  statThreshold: 'Stat milestone',
}

const TROPHY_OPTIONS = [
  'Champions League',
  'Europa League',
  'Club World Cup',
  'World Cup',
  'European Championship',
  'Copa América',
  'Premier League',
  'La Liga',
  'Serie A',
  'Bundesliga',
  'Ligue 1',
  'League Cup',
]

const AWARD_OPTIONS = [
  { rule: "Ballon d'Or", title: "Ballon d'Or Winner" },
  { rule: 'European Golden Shoe', title: 'European Golden Boot' },
  { rule: 'World Cup Golden Boot', title: 'World Cup Golden Boot' },
  { rule: 'World Cup Golden Ball', title: 'World Cup Golden Ball' },
]

const STAT_OPTIONS = [
  { rule: 'intl_caps>=100', title: 'International Caps', icon: '100+' },
  { rule: 'intl_goals>=40', title: 'International Goals', icon: '40+' },
  { rule: 'pl_goals>=100', title: 'Premier League Goals', icon: '100+' },
  { rule: 'pl_apps>=250', title: 'Premier League Apps', icon: '250+' },
  { rule: 'cl_apps>=80', title: 'Champions League Apps', icon: '80+' },
  { rule: 'cl_goals>=30', title: 'Champions League Goals', icon: '30+' },
  { rule: 'club_apps>=500', title: 'Career Club Apps', icon: '500+' },
  { rule: 'laliga_apps>=150', title: 'La Liga Apps', icon: '150+' },
  { rule: 'seriea_apps>=150', title: 'Serie A Apps', icon: '150+' },
  { rule: 'top5_leagues>=3', title: 'Top-5 Leagues Played', icon: '3+' },
  { rule: 'top5_clubs>=4', title: 'Top-5 Clubs Played For', icon: '4+' },
  { rule: 'transfer_eur_m>=80', title: 'Transfer Fee €80M', icon: '€80M' },
  { rule: 'transfer_eur_m>=100', title: 'Transfer Fee €100M', icon: '€100M' },
]

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
  flag?: string | null
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
  stats?: Record<string, number>
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

function isCategoryType(value: string | undefined): value is CategoryType {
  return Boolean(value && CATEGORY_TYPES.includes(value as CategoryType))
}

function categoryName(category: Cat): string {
  return isCategoryType(category.type) ? CATEGORY_NAMES[category.type] : 'Custom category'
}

type CatParts = {
  nation?: string
  club?: string
  club2?: string
  league?: string
  trophy?: string
  award?: string
  stat?: string
}

function catParts(category: Cat): CatParts {
  const rule = String(category.matchingRule ?? '')
  const [first, second] = rule.split('|')
  switch (category.type) {
    case 'nationality':
      return { nation: rule || category.flag || undefined }
    case 'playedForClub':
      return { club: rule || undefined }
    case 'playedInLeague':
      return { league: rule || undefined }
    case 'nationClub':
      return { nation: first || category.flag || undefined, club: second || undefined }
    case 'clubLeague':
      return { club: first || undefined, league: second || undefined }
    case 'nationLeague':
      return { nation: first || category.flag || undefined, league: second || undefined }
    case 'clubCombo':
      return { club: first || undefined, club2: second || undefined }
    case 'wonCompetition':
      return { trophy: rule || undefined }
    case 'award':
      return { award: rule || undefined }
    case 'statThreshold':
      return { stat: rule || undefined }
    default:
      return {}
  }
}

function buildCategory(type: CategoryType, parts: CatParts, previous?: Cat): Partial<Cat> {
  const nation = parts.nation?.trim() || ''
  const club = parts.club?.trim() || ''
  const club2 = parts.club2?.trim() || ''
  const league = parts.league?.trim() || ''
  const trophy = parts.trophy?.trim() || ''
  const award = parts.award?.trim() || ''
  const stat = parts.stat?.trim() || ''
  const base = {
    type,
    teamId: previous?.teamId ?? null,
    team2Id: previous?.team2Id ?? null,
    logoUrl: previous?.logoUrl ?? null,
    logo2Url: previous?.logo2Url ?? null,
    flag: null as string | null,
  }

  switch (type) {
    case 'nationality':
      return {
        ...base,
        iconType: 'flag',
        matchingRule: nation,
        iconValue: nation,
        flag: nation || null,
        title: nation || 'Country',
        logoUrl: null,
        logo2Url: null,
      }
    case 'playedForClub':
      return {
        ...base,
        iconType: 'clubBadge',
        matchingRule: club,
        iconValue: club,
        title: club ? `Played for ${club}` : 'Club',
        logo2Url: null,
        flag: null,
      }
    case 'playedInLeague':
      return {
        ...base,
        iconType: 'league',
        matchingRule: league,
        iconValue: league,
        title: league || 'League',
        logoUrl: previous?.type === 'playedInLeague' || previous?.type === 'nationLeague' ? previous.logoUrl : previous?.logo2Url ?? null,
        logo2Url: null,
        flag: null,
      }
    case 'nationClub':
      return {
        ...base,
        iconType: 'nationClub',
        matchingRule: `${nation}|${club}`,
        iconValue: club,
        flag: nation || null,
        title: nation && club ? `${nation} · ${club}` : 'Club and country',
        logo2Url: null,
      }
    case 'clubLeague':
      return {
        ...base,
        iconType: 'clubLeague',
        matchingRule: `${club}|${league}`,
        iconValue: `${club}|${league}`,
        title: club && league ? `${club} · ${league}` : 'Club and league',
        logo2Url: previous?.type === 'playedInLeague' || previous?.type === 'nationLeague' ? previous.logoUrl : previous?.logo2Url ?? null,
        flag: null,
      }
    case 'nationLeague':
      return {
        ...base,
        iconType: 'nationLeague',
        matchingRule: `${nation}|${league}`,
        iconValue: league,
        flag: nation || null,
        title: nation && league ? `${nation} · ${league}` : 'Country and league',
        logoUrl: previous?.type === 'playedInLeague' || previous?.type === 'clubLeague' ? (previous.type === 'clubLeague' ? previous.logo2Url : previous.logoUrl) : previous?.logoUrl ?? null,
        logo2Url: null,
      }
    case 'clubCombo':
      return {
        ...base,
        iconType: 'clubCombo',
        matchingRule: `${club}|${club2}`,
        iconValue: `${club}|${club2}`,
        title: club && club2 ? `${club} & ${club2}` : 'Two clubs',
        flag: null,
      }
    case 'wonCompetition':
      return {
        ...base,
        iconType: 'trophy',
        matchingRule: trophy,
        iconValue: trophy,
        title: trophy ? `${trophy} Winner` : 'Trophy winner',
        logoUrl: null,
        logo2Url: null,
        flag: null,
      }
    case 'award': {
      const option = AWARD_OPTIONS.find((item) => item.rule === award)
      return {
        ...base,
        iconType: 'award',
        matchingRule: award,
        iconValue: award,
        title: option?.title || award || 'Award winner',
        logoUrl: null,
        logo2Url: null,
        flag: null,
      }
    }
    case 'statThreshold': {
      const option = STAT_OPTIONS.find((item) => item.rule === stat) ?? STAT_OPTIONS[0]
      return {
        ...base,
        iconType: 'custom',
        matchingRule: option?.rule ?? '',
        iconValue: option?.icon ?? '',
        title: option?.title || 'Stat milestone',
        logoUrl: null,
        logo2Url: null,
        flag: null,
      }
    }
  }
}

function norm(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

const CLUB_ALIASES: Record<string, string> = {
  'inter milan': 'inter',
  internazionale: 'inter',
  'internazionale milano': 'inter',
  'fc internazionale milano': 'inter',
  'ac milan': 'milan',
  milan: 'milan',
  'bayern munich': 'bayern munchen',
  'bayern munich fc': 'bayern munchen',
  'atletico madrid': 'atletico madrid',
  'atletico de madrid': 'atletico madrid',
  'paris saint germain': 'paris saint germain',
  'paris saint germain fc': 'paris saint germain',
  'paris sg': 'paris saint germain',
  psg: 'paris saint germain',
  'tottenham hotspur': 'tottenham',
  spurs: 'tottenham',
  'manchester utd': 'manchester united',
  'man utd': 'manchester united',
  'man united': 'manchester united',
  'man city': 'manchester city',
  'borussia dortmund': 'borussia dortmund',
  dortmund: 'borussia dortmund',
  bvb: 'borussia dortmund',
  'bayer leverkusen': 'bayer leverkusen',
  leverkusen: 'bayer leverkusen',
  'rb leipzig': 'rb leipzig',
  leipzig: 'rb leipzig',
  'sporting lisbon': 'sporting cp',
  'fc porto': 'porto',
  'fc barcelona': 'barcelona',
  'real madrid cf': 'real madrid',
  'juventus fc': 'juventus',
  'as roma': 'roma',
  'ssc napoli': 'napoli',
  'athletic bilbao': 'athletic club',
  'ath bilbao': 'athletic club',
}

function clubKey(raw: string): string {
  const base = norm(raw)
    .replace(/\bfc\b/g, '')
    .replace(/\bcf\b/g, '')
    .replace(/\bsc\b/g, '')
    .replace(/\bac\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return CLUB_ALIASES[base] ?? base
}

function hasClub(player: Player, club: string): boolean {
  const target = clubKey(club)
  return Boolean(target) && (player.clubs ?? []).some((name) => clubKey(name) === target)
}

function playerMatchesCategory(player: Player, category: Cat): boolean {
  const rule = String(category.matchingRule ?? '')
  switch (category.type) {
    case 'nationality':
      return norm(player.nationality ?? '') === norm(rule)
    case 'playedForClub':
      return hasClub(player, rule)
    case 'nationClub': {
      const [nation, club] = rule.split('|')
      return norm(player.nationality ?? '') === norm(nation ?? '') && hasClub(player, club ?? '')
    }
    case 'clubCombo': {
      const [a, b] = rule.split('|')
      return hasClub(player, a ?? '') && hasClub(player, b ?? '')
    }
    case 'playedInLeague':
      return (player.leagues ?? []).some((league) => norm(league) === norm(rule))
    case 'clubLeague': {
      const [club, league] = rule.split('|')
      return hasClub(player, club ?? '') && (player.leagues ?? []).some((name) => norm(name) === norm(league ?? ''))
    }
    case 'nationLeague': {
      const [nation, league] = rule.split('|')
      return norm(player.nationality ?? '') === norm(nation ?? '') && (player.leagues ?? []).some((name) => norm(name) === norm(league ?? ''))
    }
    case 'wonCompetition':
      return (player.trophies ?? []).some((trophy) => norm(trophy) === norm(rule))
    case 'award':
      return (player.awards ?? []).some((award) => norm(award) === norm(rule))
    case 'statThreshold': {
      const [key, thresholdText] = rule.split('>=')
      const threshold = Number(thresholdText) || 0
      const stats = player.stats ?? {}
      const value =
        stats[key ?? ''] ??
        (key === 'pl_apps' ? player.premierLeagueApps : undefined) ??
        (key === 'top_goals' ? player.topLeagueGoals : undefined) ??
        (key === 'top_apps' ? player.topLeagueApps : undefined) ??
        0
      return Number(value) >= threshold
    }
    default:
      return false
  }
}

function matchReason(player: Player, category: Cat): string {
  const rule = String(category.matchingRule ?? '')
  switch (category.type) {
    case 'nationality':
      return player.nationality || rule
    case 'playedForClub':
      return player.clubs?.find((club) => clubKey(club) === clubKey(rule)) || rule
    case 'nationClub': {
      const [, club] = rule.split('|')
      const matchedClub = player.clubs?.find((name) => clubKey(name) === clubKey(club ?? '')) || club
      return [player.nationality, matchedClub].filter(Boolean).join(' · ')
    }
    case 'clubCombo': {
      const [a, b] = rule.split('|')
      const first = player.clubs?.find((name) => clubKey(name) === clubKey(a ?? '')) || a
      const second = player.clubs?.find((name) => clubKey(name) === clubKey(b ?? '')) || b
      return [first, second].filter(Boolean).join(' + ')
    }
    case 'playedInLeague':
      return player.leagues?.find((league) => norm(league) === norm(rule)) || rule
    case 'clubLeague': {
      const [club, league] = rule.split('|')
      const matchedClub = player.clubs?.find((name) => clubKey(name) === clubKey(club ?? '')) || club
      return [matchedClub, league].filter(Boolean).join(' · ')
    }
    case 'nationLeague': {
      const [, league] = rule.split('|')
      return [player.nationality, league].filter(Boolean).join(' · ')
    }
    case 'wonCompetition':
    case 'award':
      return rule
    case 'statThreshold': {
      const [key, thresholdText] = rule.split('>=')
      const stats = player.stats ?? {}
      const value =
        stats[key ?? ''] ??
        (key === 'pl_apps' ? player.premierLeagueApps : undefined) ??
        (key === 'top_goals' ? player.topLeagueGoals : undefined) ??
        (key === 'top_apps' ? player.topLeagueApps : undefined)
      return value == null ? rule.replace('>=', ' ≥ ') : `${key} ${value} (needs ≥ ${thresholdText})`
    }
    default:
      return 'Matches this square'
  }
}

function playerLabel(player: Player): string {
  return player.name || player.displayName || 'Unknown player'
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
    case 'playedInLeague':
      return `Players who appeared in ${rule || 'this league'}`
    case 'clubLeague':
      return `${first || 'Club'} players who also played in ${second || 'league'}`
    case 'nationLeague':
      return `${first || 'Nationality'} players who appeared in ${second || 'league'}`
    case 'wonCompetition':
      return `Players who won ${rule || 'this competition'}`
    case 'award':
      return `Players who received ${rule || 'this award'}`
    case 'statThreshold':
      return rule ? `Players meeting ${rule.replace('>=', ' ≥ ')}` : 'Players meeting this stat'
    default:
      return 'Custom matching criteria'
  }
}

function categoryIcon(category: Cat) {
  if (category.logoUrl) {
    return (
      <span className="bingo-preview-logos">
        <img src={category.logoUrl} alt="" />
        {category.logo2Url && <img src={category.logo2Url} alt="" />}
        {(category.type === 'nationClub' || category.type === 'nationLeague') && category.flag && (
          <span className="bingo-preview-flag-badge">{nationalityFlag(category.flag)}</span>
        )}
      </span>
    )
  }
  if (category.iconType === 'league' || category.type === 'playedInLeague' || category.type === 'nationLeague') {
    const league = category.type === 'nationLeague' ? String(category.matchingRule ?? '').split('|')[1] : String(category.iconValue || category.matchingRule || '')
    return <span className="bingo-preview-fallback">{league ? league.slice(0, 3).toUpperCase() : 'LG'}</span>
  }
  if (category.flag || category.type === 'nationality') {
    const nationality = category.flag || String(category.matchingRule ?? '')
    return <span className="bingo-preview-flag">{nationalityFlag(nationality)}</span>
  }
  if (category.iconType === 'trophy' || category.type === 'wonCompetition') {
    return <span className="bingo-preview-fallback">🏆</span>
  }
  if (category.iconType === 'award' || category.type === 'award') {
    return <span className="bingo-preview-fallback">🏅</span>
  }
  // Show the full label (e.g. "100+", "€80M"). Truncating to 2 chars made "100+" render as "10".
  const label = String(category.iconValue ?? '●').trim() || '●'
  return <span className="bingo-preview-fallback">{label}</span>
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
  const players = useMemo(() => p.players ?? [], [p.players])
  const latestRef = useRef(p)
  const [activeCategoryIndex, setActiveCategoryIndex] = useState(0)
  const [poolError, setPoolError] = useState<{ message: string; existingIndex?: number } | null>(null)
  const duplicatePlayerGroups = useMemo(() => {
    const byId = new Map<string, { name: string; indices: number[] }>()
    players.forEach((player, index) => {
      if (!player.id) return
      const existing = byId.get(player.id) ?? {
        name: player.name || player.displayName || 'Unknown player',
        indices: [],
      }
      existing.indices.push(index)
      byId.set(player.id, existing)
    })
    return [...byId.entries()]
      .filter(([, group]) => group.indices.length > 1)
      .map(([id, group]) => ({ id, ...group }))
  }, [players])
  const duplicateIndices = useMemo(
    () => new Set(duplicatePlayerGroups.flatMap((group) => group.indices)),
    [duplicatePlayerGroups]
  )
  const matchersByCategory = useMemo(
    () =>
      categories.map((category) =>
        players
          .map((player, index) => ({ player, index }))
          .filter(({ player }) => playerMatchesCategory(player, category))
      ),
    [categories, players]
  )
  const activeMatchers = matchersByCategory[activeCategoryIndex] ?? []
  const matcherIndices = useMemo(
    () => new Set(activeMatchers.map((entry) => entry.index)),
    [activeMatchers]
  )
  useEffect(() => {
    latestRef.current = p
  }, [p])
  useEffect(() => {
    setActiveCategoryIndex((index) => Math.min(index, Math.max(0, categories.length - 1)))
  }, [categories.length])

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

  function moveCategory(idx: number, direction: -1 | 1) {
    const current = latestRef.current
    const nextIdx = idx + direction
    if (nextIdx < 0 || nextIdx >= current.categories.length) return
    const next = [...current.categories]
    ;[next[idx], next[nextIdx]] = [next[nextIdx]!, next[idx]!]
    commit({ ...current, categories: next })
    setActiveCategoryIndex(nextIdx)
  }

  async function pickPoolPlayer(
    idx: number,
    hit: { id: string; name: string; nationality?: string; headshotUrl?: string }
  ) {
    const duplicateIndex = latestRef.current.players.findIndex(
      (player, playerIndex) => playerIndex !== idx && player.id === hit.id
    )
    if (duplicateIndex >= 0) {
      setPoolError({
        message: `${hit.name} is already in pool position ${duplicateIndex + 1}. Choose a different player or swap that existing copy first.`,
        existingIndex: duplicateIndex,
      })
      return
    }
    setPoolError(null)
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

  function changeCategoryType(idx: number, type: CategoryType) {
    const cat = latestRef.current.categories[idx]!
    updateCat(idx, buildCategory(type, catParts(cat), cat))
  }

  function applyParts(idx: number, patch: CatParts, extras: Partial<Cat> = {}) {
    const cat = { ...latestRef.current.categories[idx]!, ...extras }
    const type = isCategoryType(cat.type) ? cat.type : 'playedForClub'
    updateCat(idx, { ...buildCategory(type, { ...catParts(cat), ...patch }, cat), ...extras })
  }

  async function pickClubRule(idx: number, hit: AdminTeamHit, slot: 'primary' | 'secondary' = 'primary') {
    const team = await api.resolveTeam(hit.id)
    const cat = latestRef.current.categories[idx]!
    const parts = catParts(cat)
    if (slot === 'secondary') {
      applyParts(idx, { club2: team.name }, { logo2Url: team.logoUrl, team2Id: team.id })
      return
    }
    applyParts(
      idx,
      { club: team.name, league: parts.league || team.leagueName || undefined },
      { logoUrl: team.logoUrl, teamId: team.id }
    )
  }

  async function pickLeagueRule(idx: number, hit: AdminLeagueHit) {
    const cat = latestRef.current.categories[idx]!
    const extras =
      cat.type === 'clubLeague' ? { logo2Url: hit.logoUrl } : { logoUrl: hit.logoUrl }
    applyParts(idx, { league: hit.name }, extras)
  }

  function pickNationality(idx: number, name: string) {
    applyParts(idx, { nation: name }, { flag: name })
  }

  return (
    <div className="mode-editor">
      <section className="editor-clean-section">
        <header className="editor-section-header">
          <div>
            <strong>Categories ({categories.length})</strong>
            <p className="muted tiny">Select a square to see and swap the pool players it uses.</p>
          </div>
        </header>
        <div className="bingo-board-preview" aria-label="Category board preview">
          {categories.map((category, idx) => {
            const matcherCount = matchersByCategory[idx]?.length ?? 0
            return (
              <button
                type="button"
                key={`preview-${category.id ?? idx}`}
                className={`bingo-preview-tile${idx === activeCategoryIndex ? ' selected' : ''}${matcherCount === 0 ? ' empty' : ''}`}
                onClick={() => setActiveCategoryIndex(idx)}
                aria-pressed={idx === activeCategoryIndex}
              >
                {categoryIcon(category)}
                <span>{category.title || category.label || `Category ${idx + 1}`}</span>
                <span className={`bingo-preview-count${matcherCount === 0 ? ' empty' : matcherCount < 3 ? ' thin' : ''}`}>
                  {matcherCount} player{matcherCount === 1 ? '' : 's'}
                </span>
              </button>
            )
          })}
        </div>
        {categories.map((c, idx) => {
          const type = isCategoryType(c.type) ? c.type : null
          const parts = catParts(c)
          const needsClub = type === 'playedForClub' || type === 'nationClub' || type === 'clubLeague' || type === 'clubCombo'
          const needsClubB = type === 'clubCombo'
          const needsLeague = type === 'playedInLeague' || type === 'clubLeague' || type === 'nationLeague'
          const needsNat = type === 'nationality' || type === 'nationClub' || type === 'nationLeague'
          const squarePlayers = matchersByCategory[idx] ?? []

          return (
            <article
              key={c.id ?? idx}
              className={`bingo-cat bingo-category-card${idx === activeCategoryIndex ? ' active' : ''}`}
            >
              <div className="bingo-category-heading">
                <div className="bingo-category-heading-copy">
                  <span className="editor-clean-number">Category {idx + 1}</span>
                  <strong>{c.title || c.label || `Category ${idx + 1}`}</strong>
                  <div className="bingo-category-summary">
                    <span className="muted tiny">{categoryName(c)} · {ruleSummary(c)}</span>
                  </div>
                </div>
                <div className="editor-icon-actions">
                  <button type="button" className="ghost tiny-btn" disabled={locked || idx === 0} onClick={() => moveCategory(idx, -1)} aria-label={`Move category ${idx + 1} up`}>↑</button>
                  <button type="button" className="ghost tiny-btn" disabled={locked || idx === categories.length - 1} onClick={() => moveCategory(idx, 1)} aria-label={`Move category ${idx + 1} down`}>↓</button>
                </div>
              </div>
              <label className="field">
                Category type
                <select
                  value={type ?? ''}
                  disabled={locked}
                  onChange={(e) => {
                    if (isCategoryType(e.target.value)) changeCategoryType(idx, e.target.value)
                  }}
                >
                  {!type && <option value="">Choose a type</option>}
                  {CATEGORY_TYPES.map((categoryType) => (
                    <option key={categoryType} value={categoryType}>
                      {CATEGORY_NAMES[categoryType]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Category name
                <input
                  value={(c.title as string) ?? (c.label as string) ?? ''}
                  disabled={locked}
                  onChange={(e) => updateCat(idx, { title: e.target.value, label: e.target.value })}
                />
              </label>

              {needsNat && (
                <EntityPicker
                  kind="nationality"
                  label="Country"
                  valueLabel={parts.nation}
                  disabled={locked}
                  onPickNationality={(hit) => pickNationality(idx, hit.name)}
                />
              )}

              {needsClub && !needsClubB && (
                <EntityPicker
                  kind="team"
                  label="Club"
                  valueLabel={parts.club}
                  imageUrl={c.logoUrl}
                  disabled={locked}
                  onPickTeam={(hit) => pickClubRule(idx, hit, 'primary')}
                />
              )}

              {needsClubB && (
                <div className="row">
                  <EntityPicker
                    kind="team"
                    label="Club A"
                    valueLabel={parts.club}
                    imageUrl={c.logoUrl}
                    disabled={locked}
                    onPickTeam={(hit) => pickClubRule(idx, hit, 'primary')}
                  />
                  <EntityPicker
                    kind="team"
                    label="Club B"
                    valueLabel={parts.club2}
                    imageUrl={c.logo2Url}
                    disabled={locked}
                    onPickTeam={(hit) => pickClubRule(idx, hit, 'secondary')}
                  />
                </div>
              )}

              {needsLeague && (
                <EntityPicker
                  kind="league"
                  label="League"
                  valueLabel={parts.league}
                  imageUrl={type === 'clubLeague' ? c.logo2Url : c.logoUrl}
                  disabled={locked}
                  onPickLeague={(hit) => pickLeagueRule(idx, hit)}
                />
              )}

              {type === 'wonCompetition' && (
                <label className="field">
                  Trophy
                  <select
                    value={parts.trophy ?? ''}
                    disabled={locked}
                    onChange={(e) => applyParts(idx, { trophy: e.target.value })}
                  >
                    <option value="">Choose a trophy</option>
                    {TROPHY_OPTIONS.map((trophy) => (
                      <option key={trophy} value={trophy}>{trophy}</option>
                    ))}
                  </select>
                </label>
              )}

              {type === 'award' && (
                <label className="field">
                  Award
                  <select
                    value={parts.award ?? ''}
                    disabled={locked}
                    onChange={(e) => applyParts(idx, { award: e.target.value })}
                  >
                    <option value="">Choose an award</option>
                    {AWARD_OPTIONS.map((award) => (
                      <option key={award.rule} value={award.rule}>{award.title}</option>
                    ))}
                  </select>
                </label>
              )}

              {type === 'statThreshold' && (
                <label className="field">
                  Milestone
                  <select
                    value={parts.stat || STAT_OPTIONS[0]?.rule || ''}
                    disabled={locked}
                    onChange={(e) => applyParts(idx, { stat: e.target.value })}
                  >
                    {STAT_OPTIONS.map((stat) => (
                      <option key={stat.rule} value={stat.rule}>{stat.title}</option>
                    ))}
                  </select>
                </label>
              )}

              {!type && <p className="muted tiny">Pick a category type to set the matching rule.</p>}
              <div className="bingo-square-players">
                <header className="bingo-square-players-header">
                  <div>
                    <strong>Players on this square</strong>
                    <p className="muted tiny">
                      {squarePlayers.length} in the pool
                      {squarePlayers.length === 0
                        ? ' · changing the rule above will pick a different set'
                        : squarePlayers.length < 3
                          ? ' · thin (need 3+)'
                          : ''}
                    </p>
                  </div>
                </header>
                {squarePlayers.length === 0 ? (
                  <p className="editor-inline-warning">
                    No pool players match this square. Change the rule above or swap someone into the
                    player pool.
                  </p>
                ) : (
                  <div className="bingo-square-player-list">
                    {squarePlayers.map(({ player, index }) => (
                      <article
                        key={`${player.id ?? index}-${index}`}
                        className={`bingo-square-player${duplicateIndices.has(index) ? ' duplicate' : ''}`}
                      >
                        <div className="bingo-player-title">
                          {player.headshotUrl ? (
                            <img src={player.headshotUrl} alt="" />
                          ) : (
                            <span className="bingo-player-placeholder" />
                          )}
                          <div>
                            <strong>{playerLabel(player)}</strong>
                            <span className="muted tiny">
                              {matchReason(player, c)}
                              {player.position ? ` · ${player.position}` : ''}
                            </span>
                          </div>
                        </div>
                        <EntityPicker
                          kind="player"
                          label="Swap player"
                          valueLabel={playerLabel(player)}
                          imageUrl={player.headshotUrl}
                          nationality={player.nationality}
                          disabled={locked}
                          onPickPlayer={(hit) => pickPoolPlayer(index, hit)}
                        />
                      </article>
                    ))}
                  </div>
                )}
              </div>
              <details className="editor-advanced">
                <summary>Advanced</summary>
                <div className="advanced-grid">
                  <label className="field">Category key<input value={c.id ?? ''} disabled={locked} onChange={(e) => updateCat(idx, { id: e.target.value })} /></label>
                  <label className="field">Category style<input value={c.type ?? ''} disabled={locked} onChange={(e) => updateCat(idx, { type: e.target.value })} /></label>
                  <label className="field">Icon style<input value={c.iconType ?? ''} disabled={locked} onChange={(e) => updateCat(idx, { iconType: e.target.value })} /></label>
                  <label className="field">Icon detail<input value={c.iconValue ?? ''} disabled={locked} onChange={(e) => updateCat(idx, { iconValue: e.target.value })} /></label>
                  {!needsClub && !needsNat && !needsLeague && type !== 'wonCompetition' && type !== 'award' && type !== 'statThreshold' && (
                    <label className="field">Matching criteria<input value={String(c.matchingRule ?? '')} disabled={locked} onChange={(e) => updateCat(idx, { matchingRule: e.target.value })} /></label>
                  )}
                </div>
              </details>
            </article>
          )
        })}
      </section>

      <details
        className="editor-clean-section player-pool-panel"
        open={duplicatePlayerGroups.length > 0 ? true : undefined}
      >
        <summary>
          Player pool
          <span className="muted tiny">
            {players.length} players · {activeMatchers.length} on the selected square
          </span>
        </summary>
        {duplicatePlayerGroups.length > 0 && (
          <div className="error-box bingo-duplicate-summary" role="alert">
            <strong>
              {duplicatePlayerGroups.length} duplicate player
              {duplicatePlayerGroups.length === 1 ? '' : 's'} to fix
            </strong>
            <ul>
              {duplicatePlayerGroups.map((group) => (
                <li key={group.id}>
                  {group.name} appears in pool positions{' '}
                  {group.indices.map((index) => index + 1).join(', ')}
                </li>
              ))}
            </ul>
          </div>
        )}
        {poolError && (
          <div className="error-box bingo-pool-selection-error" role="alert">
            <span>{poolError.message}</span>
            {poolError.existingIndex !== undefined && (
              <button
                type="button"
                className="quiet-button"
                onClick={() =>
                  document
                    .getElementById(`bingo-player-${poolError.existingIndex}`)
                    ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }
              >
                Show existing player
              </button>
            )}
          </div>
        )}
        <div className="bingo-player-grid player-pool-content">
          {players.map((pl, idx) => {
            const metadata = [
              pl.position,
              pl.nationality ? `${nationalityFlag(pl.nationality)} ${pl.nationality}` : undefined,
              pl.clubs?.length ? `${pl.clubs.length} clubs` : undefined,
              pl.leagues?.length ? `${pl.leagues.length} leagues` : undefined,
            ].filter((value): value is string => Boolean(value))
            return (
              <article
                id={`bingo-player-${idx}`}
                key={`${pl.id ?? idx}-${pl.headshotUrl ?? ''}-${pl.name ?? ''}`}
                className={`bingo-player-card${duplicateIndices.has(idx) ? ' duplicate' : ''}${matcherIndices.has(idx) ? ' matches-square' : ''}`}
              >
                <div className="bingo-player-title">
                  {pl.headshotUrl ? <img src={pl.headshotUrl} alt="" /> : <span className="bingo-player-placeholder" />}
                  <div>
                    <strong>{pl.name || pl.displayName || 'Unknown player'}</strong>
                    <span className="muted tiny">{metadata.join(' · ') || 'Details unavailable'}</span>
                    {matcherIndices.has(idx) && (
                      <span className="bingo-square-match-label">On selected square</span>
                    )}
                    {duplicateIndices.has(idx) && (
                      <span className="bingo-duplicate-label">
                        Duplicate · pool position {idx + 1}
                      </span>
                    )}
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
              </article>
            )
          })}
        </div>
      </details>
    </div>
  )
}
