import { useRef, useState } from 'react'
import { api, type AdminLeagueHit, type AdminTeamHit } from '../api'
import { EntityPicker } from '../components/EntityPicker'
import './game-editors.css'

type CategoryType =
  | 'nat_club'
  | 'club'
  | 'nationality'
  | 'nat_league'
  | 'award'
  | 'stat'
  | 'managed_by'
  | 'wc_squad'
  | 'club_combo'
  | 'played_with_both'
  | 'final'

type Category = {
  type?: CategoryType | string
  label?: string
  club?: string | null
  leagueId?: number | null
  leagueName?: string | null
  nationality?: string | null
  award?: string | null
  awardPlacements?: string[] | null
  statKey?: string | null
  statMin?: number | null
  manager?: string | null
  managerNorm?: string | null
  wcYear?: number | null
  wcCountry?: string | null
  clubA?: string | null
  clubB?: string | null
  anchorAId?: string | null
  anchorBId?: string | null
  anchorAName?: string | null
  anchorBName?: string | null
  finalCompetition?: string | null
  finalMode?: string | null
  logoUrl?: string | null
}

type Puzzle = {
  category?: Category
  maxPool?: number
  xpCap?: number
  mistakesAllowed?: number
  [k: string]: unknown
}

type Answer = {
  modeId?: string
  validPlayerIds?: string[]
  [k: string]: unknown
}

const TYPE_LABELS: Record<CategoryType, string> = {
  managed_by: 'Managed by',
  wc_squad: 'WC squad (country × year)',
  club_combo: 'Club combo (both)',
  played_with_both: 'Played with A and B',
  final: 'Finals / winners',
  nat_club: 'Nationality + club',
  nat_league: 'Nationality + league',
  nationality: 'Nationality',
  award: 'Award winners',
  stat: 'Stat milestone',
  club: 'Club (manual)',
}

const MANAGER_OPTIONS = [
  { manager: 'Jürgen Klopp', managerNorm: 'jurgen klopp' },
  { manager: 'Zinedine Zidane', managerNorm: 'zinedine zidane' },
  { manager: 'Diego Simeone', managerNorm: 'diego simeone' },
  { manager: 'Sir Alex Ferguson', managerNorm: 'sir alex ferguson' },
  { manager: 'Arsène Wenger', managerNorm: 'arsene wenger' },
  { manager: 'Luis Enrique', managerNorm: 'luis enrique' },
  { manager: 'Louis van Gaal', managerNorm: 'louis van gaal' },
  { manager: 'Fabio Capello', managerNorm: 'fabio capello' },
  { manager: 'Marcello Lippi', managerNorm: 'marcello lippi' },
  { manager: 'Frank Rijkaard', managerNorm: 'frank rijkaard' },
  { manager: 'Hansi Flick', managerNorm: 'hansi flick' },
  { manager: 'Mikel Arteta', managerNorm: 'mikel arteta' },
  { manager: 'Maurizio Sarri', managerNorm: 'maurizio sarri' },
  { manager: 'Julian Nagelsmann', managerNorm: 'julian nagelsmann' },
  { manager: 'Erik ten Hag', managerNorm: 'erik ten hag' },
  { manager: 'Arne Slot', managerNorm: 'arne slot' },
  { manager: 'Xabi Alonso', managerNorm: 'xabi alonso' },
  { manager: 'Didier Deschamps', managerNorm: 'didier deschamps' },
  { manager: 'Vicente del Bosque', managerNorm: 'vicente del bosque' },
  { manager: 'Claudio Ranieri', managerNorm: 'claudio ranieri' },
  { manager: 'Guus Hiddink', managerNorm: 'guus hiddink' },
  { manager: 'Luiz Felipe Scolari', managerNorm: 'luiz felipe scolari' },
] as const

const FINAL_OPTIONS = [
  { competition: 'Champions League', mode: 'scored', label: 'Scored in a Champions League final' },
  { competition: 'Europa League', mode: 'scored', label: 'Scored in a Europa League final' },
  { competition: 'Euro', mode: 'won', label: 'Won a European Championship' },
  { competition: 'World Cup', mode: 'won', label: 'World Cup winners since 1994' },
] as const

/** Keep in sync with backend BACK_YOURSELF_AWARD_DEFS. */
const AWARD_OPTIONS = [
  { award: "Ballon d'Or", label: "Ballon d'Or winners", placements: ['1st'] },
  { award: "Ballon d'Or", label: "Ballon d'Or podium", placements: ['1st', '2nd', '3rd'] },
  { award: 'European Golden Shoe', label: 'European Golden Shoe winners', placements: ['winner'] },
  { award: 'Golden Boy', label: 'Golden Boy winners', placements: ['winner'] },
  { award: "PFA Players' Player of the Year", label: "PFA Players' Player winners", placements: ['winner'] },
  { award: 'Premier League Player of the Season', label: 'PL Player of the Season winners', placements: ['winner'] },
  { award: 'Serie A Footballer of the Year', label: 'Serie A Footballer of the Year winners', placements: ['winner'] },
  { award: 'African Footballer of the Year', label: 'African Footballer of the Year winners', placements: ['winner'] },
  { award: "UEFA Men's Player of the Year", label: "UEFA Men's Player of the Year winners", placements: ['winner'] },
] as const

/** Keep in sync with backend BACK_YOURSELF_STAT_DEFS. */
const STAT_OPTIONS = [
  { key: 'pl_goals', min: 100, label: '100+ Premier League goals' },
  { key: 'cl_goals', min: 30, label: '30+ Champions League goals' },
  { key: 'cl_goals', min: 40, label: '40+ Champions League goals' },
  { key: 'transfer_eur_m', min: 100, label: '€100M+ transfer fee' },
  { key: 'career_hattricks', min: 10, label: '10+ career hat-tricks' },
  { key: 'ucl_red_cards', min: 2, label: '2+ Champions League red cards' },
  { key: 'season_reds', min: 3, label: '3+ reds in a single season' },
  { key: 'intl_caps', min: 150, label: '150+ international caps' },
] as const

function awardOptionValue(award: string, placements: string[]): string {
  return `${award}|${placements.join(',')}`
}

function rebuildLabel(c: Category): string {
  const type = c.type
  if (type === 'club') return c.club ? `${c.club} players` : 'Club players'
  if (type === 'nationality') return c.nationality ? `${c.nationality} internationals` : 'Nationality'
  if (type === 'nat_league') {
    return `${c.nationality ?? '?'} ${c.leagueName ?? 'league'} players`
  }
  if (type === 'nat_club') {
    return `${c.nationality ?? '?'} ${c.club ?? '?'} players`
  }
  if (type === 'award') {
    const hit = AWARD_OPTIONS.find(
      (o) =>
        o.award === c.award
        && JSON.stringify(o.placements) === JSON.stringify(c.awardPlacements ?? o.placements)
    )
    return hit?.label ?? (c.award ? `${c.award} winners` : 'Award winners')
  }
  if (type === 'stat') {
    return STAT_OPTIONS.find((o) => o.key === c.statKey && o.min === c.statMin)?.label
      ?? (c.statKey && c.statMin != null ? `${c.statMin}+ ${c.statKey}` : 'Stat milestone')
  }
  if (type === 'managed_by') return c.manager ? `Managed by ${c.manager}` : 'Managed by…'
  if (type === 'wc_squad') return `${c.wcCountry ?? '?'} World Cup ${c.wcYear ?? '?'}`
  if (type === 'club_combo') return `Played for ${c.clubA ?? '?'} and ${c.clubB ?? '?'}`
  if (type === 'played_with_both') {
    return `Played with ${c.anchorAName ?? '?'} and ${c.anchorBName ?? '?'}`
  }
  if (type === 'final') {
    return FINAL_OPTIONS.find((o) => o.competition === c.finalCompetition && o.mode === c.finalMode)?.label
      ?? 'Finals category'
  }
  return c.label ?? 'Category'
}

function statOptionValue(key: string, min: number): string {
  return `${key}:${min}`
}

function finalOptionValue(competition: string, mode: string): string {
  return `${competition}|${mode}`
}

export function BackYourselfEditor({
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
  const a = (answer && typeof answer === 'object' ? answer : {}) as Answer
  const category = p.category ?? {}
  const type = (category.type as CategoryType) || 'nat_club'
  const needsClub = type === 'club' || type === 'nat_club'
  const needsLeague = type === 'nat_league'
  const needsNat = type === 'nationality' || type === 'nat_league' || type === 'nat_club'
  const needsAward = type === 'award'
  const needsStat = type === 'stat'
  const needsManager = type === 'managed_by'
  const needsWc = type === 'wc_squad'
  const needsCombo = type === 'club_combo'
  const needsPlayedWith = type === 'played_with_both'
  const needsFinal = type === 'final'
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [comboSlot, setComboSlot] = useState<'A' | 'B'>('A')
  const latestRef = useRef({ p, a })
  latestRef.current = { p, a }

  function commit(nextPuzzle: Puzzle, nextAnswer: Answer) {
    latestRef.current = { p: nextPuzzle, a: nextAnswer }
    onChange(nextPuzzle, nextAnswer)
  }

  function updateCategory(patch: Partial<Category>) {
    const merged = { ...category, ...patch }
    const nextCat = { ...merged, label: rebuildLabel(merged) }
    commit({ ...p, category: nextCat }, a)
  }

  async function pickClub(hit: AdminTeamHit) {
    const team = await api.resolveTeam(hit.id)
    if (type === 'club_combo') {
      if (comboSlot === 'A') {
        updateCategory({ clubA: team.name, logoUrl: team.logoUrl })
      } else {
        updateCategory({ clubB: team.name })
      }
      return
    }
    updateCategory({
      club: team.name,
      logoUrl: team.logoUrl,
      leagueId: type === 'club' ? team.leagueId : category.leagueId,
      leagueName: type === 'club' ? team.leagueName : category.leagueName,
    })
  }

  function pickLeague(league: AdminLeagueHit) {
    updateCategory({
      leagueId: league.id,
      leagueName: league.name,
      logoUrl: league.logoUrl,
      club: null,
    })
  }

  async function recalculatePool() {
    setBusy(true)
    setError(null)
    try {
      const result = await api.recomputeBackYourself({
        puzzleJson: latestRef.current.p,
        answerJson: latestRef.current.a,
      })
      commit(result.puzzleJson as Puzzle, result.answerJson as Answer)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to recalculate pool')
    } finally {
      setBusy(false)
    }
  }

  const selectedStat =
    category.statKey && category.statMin != null
      ? statOptionValue(category.statKey, category.statMin)
      : ''

  const selectedAward = awardOptionValue(
    category.award ?? AWARD_OPTIONS[0].award,
    category.awardPlacements ?? [...AWARD_OPTIONS[0].placements]
  )

  const selectedFinal = finalOptionValue(
    category.finalCompetition ?? FINAL_OPTIONS[0].competition,
    category.finalMode ?? FINAL_OPTIONS[0].mode
  )

  return (
    <div className="mode-editor">
      <div className="editor-clean-summary">
        <div>
          <span className="muted tiny">Category</span>
          <strong>{category.label || 'Untitled'}</strong>
        </div>
        <div>
          <span className="muted tiny">Possible</span>
          <strong>{p.maxPool ?? '—'}</strong>
        </div>
        <div>
          <span className="muted tiny">Max XP at</span>
          <strong>{p.xpCap != null ? `${p.xpCap}+` : '—'}</strong>
        </div>
        <div>
          <span className="muted tiny">Valid ids</span>
          <strong>{a.validPlayerIds?.length ?? 0}</strong>
        </div>
        <div>
          <span className="muted tiny">Lives</span>
          <strong>{p.mistakesAllowed ?? 3}</strong>
        </div>
      </div>

      <div className="editor-clean-section">
        <header>
          <strong>Category</strong>
          <span className="muted tiny">Players name people who match this chip</span>
        </header>
        <label className="field compact">
          Type
          <select
            value={type}
            disabled={locked}
            onChange={(e) => {
              const nextType = e.target.value as CategoryType
              const awardDefault = AWARD_OPTIONS[0]
              const statDefault = STAT_OPTIONS[0]
              const managerDefault = MANAGER_OPTIONS[0]
              const finalDefault = FINAL_OPTIONS[0]
              updateCategory({
                type: nextType,
                club: null,
                logoUrl: null,
                leagueId: null,
                leagueName: null,
                nationality: null,
                award: nextType === 'award' ? awardDefault.award : null,
                awardPlacements: nextType === 'award' ? [...awardDefault.placements] : null,
                statKey: nextType === 'stat' ? statDefault.key : null,
                statMin: nextType === 'stat' ? statDefault.min : null,
                manager: nextType === 'managed_by' ? managerDefault.manager : null,
                managerNorm: nextType === 'managed_by' ? managerDefault.managerNorm : null,
                wcYear: nextType === 'wc_squad' ? 2022 : null,
                wcCountry: nextType === 'wc_squad' ? 'France' : null,
                clubA: null,
                clubB: null,
                anchorAId: null,
                anchorBId: null,
                anchorAName: null,
                anchorBName: null,
                finalCompetition: nextType === 'final' ? finalDefault.competition : null,
                finalMode: nextType === 'final' ? finalDefault.mode : null,
              })
            }}
          >
            {(Object.keys(TYPE_LABELS) as CategoryType[]).map((key) => (
              <option key={key} value={key}>
                {TYPE_LABELS[key]}
              </option>
            ))}
          </select>
        </label>
        {needsNat && (
          <EntityPicker
            kind="nationality"
            label="Nationality"
            valueLabel={category.nationality ?? undefined}
            disabled={locked}
            onPickNationality={(hit) => updateCategory({ nationality: hit.name })}
          />
        )}
        {needsClub && (
          <EntityPicker
            kind="team"
            label="Club"
            valueLabel={category.club ?? undefined}
            imageUrl={category.logoUrl}
            disabled={locked}
            onPickTeam={(hit) => void pickClub(hit)}
          />
        )}
        {needsLeague && (
          <EntityPicker
            kind="league"
            label="League"
            valueLabel={category.leagueName ?? undefined}
            imageUrl={category.logoUrl ?? undefined}
            disabled={locked}
            onPickLeague={(hit) => pickLeague(hit)}
          />
        )}
        {needsAward && (
          <label className="field compact">
            Award
            <select
              value={selectedAward}
              disabled={locked}
              onChange={(e) => {
                const [award, placementsStr] = e.target.value.split('|')
                updateCategory({
                  award,
                  awardPlacements: (placementsStr ?? 'winner').split(','),
                })
              }}
            >
              {AWARD_OPTIONS.map((opt) => (
                <option
                  key={awardOptionValue(opt.award, [...opt.placements])}
                  value={awardOptionValue(opt.award, [...opt.placements])}
                >
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {needsStat && (
          <label className="field compact">
            Milestone
            <select
              value={selectedStat || statOptionValue(STAT_OPTIONS[0].key, STAT_OPTIONS[0].min)}
              disabled={locked}
              onChange={(e) => {
                const [key, minStr] = e.target.value.split(':')
                updateCategory({ statKey: key, statMin: Number(minStr) })
              }}
            >
              {STAT_OPTIONS.map((opt) => (
                <option key={statOptionValue(opt.key, opt.min)} value={statOptionValue(opt.key, opt.min)}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {needsManager && (
          <label className="field compact">
            Manager
            <select
              value={category.managerNorm ?? MANAGER_OPTIONS[0].managerNorm}
              disabled={locked}
              onChange={(e) => {
                const hit = MANAGER_OPTIONS.find((m) => m.managerNorm === e.target.value)
                if (!hit) return
                updateCategory({ manager: hit.manager, managerNorm: hit.managerNorm })
              }}
            >
              {MANAGER_OPTIONS.map((m) => (
                <option key={m.managerNorm} value={m.managerNorm}>
                  {m.manager}
                </option>
              ))}
            </select>
          </label>
        )}
        {needsWc && (
          <>
            <label className="field compact">
              Country
              <input
                value={category.wcCountry ?? ''}
                disabled={locked}
                onChange={(e) => updateCategory({ wcCountry: e.target.value, nationality: e.target.value })}
              />
            </label>
            <label className="field compact">
              Year
              <input
                type="number"
                value={category.wcYear ?? ''}
                disabled={locked}
                onChange={(e) => updateCategory({ wcYear: Number(e.target.value) || null })}
              />
            </label>
          </>
        )}
        {needsCombo && (
          <>
            <label className="field compact">
              Picking club
              <select
                value={comboSlot}
                disabled={locked}
                onChange={(e) => setComboSlot(e.target.value as 'A' | 'B')}
              >
                <option value="A">Club A — {category.clubA ?? 'unset'}</option>
                <option value="B">Club B — {category.clubB ?? 'unset'}</option>
              </select>
            </label>
            <EntityPicker
              kind="team"
              label={comboSlot === 'A' ? 'Club A' : 'Club B'}
              valueLabel={(comboSlot === 'A' ? category.clubA : category.clubB) ?? undefined}
              imageUrl={comboSlot === 'A' ? category.logoUrl ?? undefined : undefined}
              disabled={locked}
              onPickTeam={(hit) => void pickClub(hit)}
            />
          </>
        )}
        {needsPlayedWith && (
          <p className="muted tiny">
            Set anchorAId / anchorBId / names via JSON or regenerate. Display:{' '}
            {category.anchorAName ?? '?'} + {category.anchorBName ?? '?'}.
          </p>
        )}
        {needsFinal && (
          <label className="field compact">
            Final chip
            <select
              value={selectedFinal}
              disabled={locked}
              onChange={(e) => {
                const [competition, mode] = e.target.value.split('|')
                updateCategory({ finalCompetition: competition, finalMode: mode })
              }}
            >
              {FINAL_OPTIONS.map((opt) => (
                <option
                  key={finalOptionValue(opt.competition, opt.mode)}
                  value={finalOptionValue(opt.competition, opt.mode)}
                >
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          Display label
          <input
            value={category.label ?? ''}
            disabled={locked}
            onChange={(e) => updateCategory({ label: e.target.value })}
          />
        </label>
        <div className="button-row">
          <button type="button" className="ghost" disabled={locked || busy} onClick={() => void recalculatePool()}>
            {busy ? 'Recalculating…' : 'Recalculate player pool'}
          </button>
        </div>
        {error && <p className="muted tiny" style={{ color: '#b42318' }}>{error}</p>}
        <p className="muted tiny">
          Pool size must stay between 10 and 120. XP maxes at pledge {p.xpCap ?? 40}+ even when the pool is larger. Recalculate after every category change before approving.
        </p>
      </div>
    </div>
  )
}
