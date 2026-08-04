import { useRef, useState } from 'react'
import { api, type AdminLeagueHit, type AdminTeamHit } from '../api'
import { EntityPicker } from '../components/EntityPicker'
import './game-editors.css'

type CategoryType = 'nat_club' | 'club' | 'nationality' | 'nat_league' | 'award' | 'stat'

type Category = {
  type?: CategoryType | string
  label?: string
  club?: string | null
  leagueId?: number | null
  leagueName?: string | null
  nationality?: string | null
  award?: string | null
  statKey?: string | null
  statMin?: number | null
  logoUrl?: string | null
}

type Puzzle = {
  category?: Category
  maxPool?: number
  mistakesAllowed?: number
  [k: string]: unknown
}

type Answer = {
  modeId?: string
  validPlayerIds?: string[]
  [k: string]: unknown
}

const TYPE_LABELS: Record<CategoryType, string> = {
  nat_club: 'Nationality + club',
  nat_league: 'Nationality + league',
  nationality: 'Nationality',
  award: 'Award winners',
  stat: 'Stat milestone',
  club: 'Club (manual)',
}

/** Keep in sync with backend BACK_YOURSELF_AWARD_DEFS. */
const AWARD_OPTIONS = [
  { award: "Ballon d'Or", label: "Ballon d'Or winners" },
  { award: 'European Golden Shoe', label: 'European Golden Shoe winners' },
  { award: 'Golden Boy', label: 'Golden Boy winners' },
  { award: "PFA Players' Player of the Year", label: "PFA Players' Player winners" },
  { award: 'Premier League Player of the Season', label: 'PL Player of the Season winners' },
  { award: 'Serie A Footballer of the Year', label: 'Serie A Footballer of the Year winners' },
  { award: 'African Footballer of the Year', label: 'African Footballer of the Year winners' },
  { award: "UEFA Men's Player of the Year", label: "UEFA Men's Player of the Year winners" },
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
    return AWARD_OPTIONS.find((o) => o.award === c.award)?.label
      ?? (c.award ? `${c.award} winners` : 'Award winners')
  }
  if (type === 'stat') {
    return STAT_OPTIONS.find((o) => o.key === c.statKey && o.min === c.statMin)?.label
      ?? (c.statKey && c.statMin != null ? `${c.statMin}+ ${c.statKey}` : 'Stat milestone')
  }
  return c.label ?? 'Category'
}

function statOptionValue(key: string, min: number): string {
  return `${key}:${min}`
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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
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

  return (
    <div className="mode-editor">
      <div className="editor-clean-summary">
        <div>
          <span className="muted tiny">Category</span>
          <strong>{category.label || 'Untitled'}</strong>
        </div>
        <div>
          <span className="muted tiny">Max pool</span>
          <strong>{p.maxPool ?? '—'}</strong>
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
              updateCategory({
                type: nextType,
                club: null,
                logoUrl: null,
                leagueId: null,
                leagueName: null,
                nationality: null,
                award: nextType === 'award' ? awardDefault.award : null,
                statKey: nextType === 'stat' ? statDefault.key : null,
                statMin: nextType === 'stat' ? statDefault.min : null,
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
              value={category.award ?? AWARD_OPTIONS[0].award}
              disabled={locked}
              onChange={(e) => updateCategory({ award: e.target.value })}
            >
              {AWARD_OPTIONS.map((opt) => (
                <option key={opt.award} value={opt.award}>
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
          Pool size must stay between 10 and 30 for a fair slider. Recalculate after every category change before approving.
        </p>
      </div>
    </div>
  )
}
