import { useEffect, useId, useRef, useState } from 'react'
import {
  api,
  type AdminLeagueHit,
  type AdminNationalityHit,
  type AdminPlayerHit,
  type AdminTeamHit,
} from '../api'

export type EntityKind = 'player' | 'team' | 'league' | 'nationality'

type Props = {
  kind: EntityKind
  label?: string
  valueLabel?: string
  imageUrl?: string | null
  disabled?: boolean
  placeholder?: string
  onPickPlayer?: (player: AdminPlayerHit) => void | Promise<void>
  onPickTeam?: (team: AdminTeamHit) => void | Promise<void>
  onPickLeague?: (league: AdminLeagueHit) => void | Promise<void>
  onPickNationality?: (nat: AdminNationalityHit) => void | Promise<void>
}

type Hit =
  | { kind: 'player'; item: AdminPlayerHit }
  | { kind: 'team'; item: AdminTeamHit }
  | { kind: 'league'; item: AdminLeagueHit }
  | { kind: 'nationality'; item: AdminNationalityHit }

function hitKey(h: Hit): string {
  if (h.kind === 'player') return `p-${h.item.id}`
  if (h.kind === 'team') return `t-${h.item.id}`
  if (h.kind === 'league') return `l-${h.item.id}`
  return `n-${h.item.name}`
}

function hitTitle(h: Hit): string {
  if (h.kind === 'nationality') return h.item.name
  return h.item.name
}

function hitSub(h: Hit): string {
  if (h.kind === 'player') {
    return [h.item.club, h.item.nationality, h.item.position].filter(Boolean).join(' · ')
  }
  if (h.kind === 'team') {
    return [h.item.country, h.item.leagueId != null ? `league ${h.item.leagueId}` : null]
      .filter(Boolean)
      .join(' · ')
  }
  if (h.kind === 'league') return `id ${h.item.id}`
  return 'nationality'
}

function hitImage(h: Hit): string | undefined {
  if (h.kind === 'player') return h.item.headshotUrl ?? h.item.teamLogoUrl
  if (h.kind === 'team') return h.item.logoUrl
  return undefined
}

export function EntityPicker({
  kind,
  label,
  valueLabel,
  imageUrl,
  disabled,
  placeholder,
  onPickPlayer,
  onPickTeam,
  onPickLeague,
  onPickNationality,
}: Props) {
  const listId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)
  const [hits, setHits] = useState<Hit[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  useEffect(() => {
    if (disabled) return
    const trimmed = q.trim()
    const minLen = kind === 'league' ? 0 : 2
    if (trimmed.length < minLen) {
      setHits([])
      setBusy(false)
      return
    }

    let cancelled = false
    setBusy(true)
    setError(null)
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          let next: Hit[] = []
          if (kind === 'player') {
            const rows = await api.searchPlayers(trimmed)
            next = rows.map((item) => ({ kind: 'player', item }))
          } else if (kind === 'team') {
            const rows = await api.searchTeams(trimmed)
            next = rows.map((item) => ({ kind: 'team', item }))
          } else if (kind === 'league') {
            const rows = await api.searchLeagues(trimmed)
            next = rows.map((item) => ({ kind: 'league', item }))
          } else {
            const rows = await api.searchNationalities(trimmed)
            next = rows.map((item) => ({ kind: 'nationality', item }))
          }
          if (!cancelled) setHits(next)
        } catch (err) {
          if (!cancelled) setError(err instanceof Error ? err.message : 'Search failed')
        } finally {
          if (!cancelled) setBusy(false)
        }
      })()
    }, 220)

    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [q, kind, disabled])

  async function select(hit: Hit) {
    setPicking(true)
    setError(null)
    try {
      if (hit.kind === 'player') await onPickPlayer?.(hit.item)
      if (hit.kind === 'team') await onPickTeam?.(hit.item)
      if (hit.kind === 'league') await onPickLeague?.(hit.item)
      if (hit.kind === 'nationality') await onPickNationality?.(hit.item)
      setQ('')
      setHits([])
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply selection')
    } finally {
      setPicking(false)
    }
  }

  const ph =
    placeholder ??
    (kind === 'player'
      ? 'Search player…'
      : kind === 'team'
        ? 'Search club…'
        : kind === 'league'
          ? 'Search league…'
          : 'Search nationality…')

  return (
    <div className="entity-picker" ref={rootRef}>
      {label && <div className="entity-picker-label">{label}</div>}
      {(valueLabel || imageUrl) && (
        <div className="entity-selected">
          {imageUrl ? <img src={imageUrl} alt="" className="entity-thumb" /> : <span className="entity-thumb placeholder" />}
          <span className="entity-selected-name">{valueLabel || '—'}</span>
        </div>
      )}
      <div className="entity-search-wrap">
        <input
          className="entity-search"
          value={q}
          disabled={disabled || picking}
          placeholder={ph}
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          autoComplete="off"
          aria-autocomplete="list"
          aria-controls={listId}
        />
        {(busy || picking) && <span className="entity-busy">{picking ? 'Applying…' : '…'}</span>}
      </div>
      {error && <p className="error tiny">{error}</p>}
      {open && hits.length > 0 && (
        <ul className="entity-results" id={listId} role="listbox">
          {hits.map((hit) => {
            const img = hitImage(hit)
            return (
              <li key={hitKey(hit)}>
                <button type="button" className="entity-result" onClick={() => void select(hit)}>
                  {img ? (
                    <img src={img} alt="" className="entity-thumb" />
                  ) : (
                    <span className="entity-thumb placeholder" />
                  )}
                  <span>
                    <strong>{hitTitle(hit)}</strong>
                    <span className="muted tiny">{hitSub(hit)}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
