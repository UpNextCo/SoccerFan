import { useEffect, useId, useRef, useState } from 'react'
import {
  api,
  type AdminLeagueHit,
  type AdminNationalityHit,
  type AdminPlayerHit,
  type AdminTeamHit,
} from '../api'
import { nationalityFlag } from '../countryFlags'

export type EntityKind = 'player' | 'team' | 'league' | 'nationality'

type Props = {
  kind: EntityKind
  label?: string
  valueLabel?: string
  imageUrl?: string | null
  nationality?: string | null
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
    const nationality = h.item.nationality
      ? `${nationalityFlag(h.item.nationality)} ${h.item.nationality}`
      : null
    return [h.item.club, nationality, h.item.position].filter(Boolean).join(' · ')
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
  if (h.kind === 'league') {
    return h.item.logoUrl || `https://media.api-sports.io/football/leagues/${h.item.id}.png`
  }
  return undefined
}

export function EntityPicker({
  kind,
  label,
  valueLabel,
  imageUrl,
  nationality,
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
  const [activeIndex, setActiveIndex] = useState(-1)
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
      setActiveIndex(-1)
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
          if (!cancelled) {
            setHits(next)
            setActiveIndex(next.length > 0 ? 0 : -1)
          }
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
      setActiveIndex(-1)
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
  const selectedFlag =
    kind === 'nationality' && valueLabel ? nationalityFlag(valueLabel) : undefined

  return (
    <div className="entity-picker" ref={rootRef}>
      {label && <div className="entity-picker-label">{label}</div>}
      {(valueLabel || imageUrl) && (
        <div className="entity-selected">
          {imageUrl ? (
            <img key={imageUrl} src={imageUrl} alt="" className="entity-thumb" />
          ) : selectedFlag ? (
            <span className="entity-thumb flag" role="img" aria-label={`${valueLabel} flag`}>
              {selectedFlag}
            </span>
          ) : (
            <span className="entity-thumb placeholder" />
          )}
          <span className="entity-selected-name">
            {valueLabel || '—'}
            {kind === 'player' && nationality && (
              <span
                className="entity-inline-flag"
                role="img"
                aria-label={`${nationality} flag`}
                title={nationality}
              >
                {nationalityFlag(nationality)}
              </span>
            )}
          </span>
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
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setOpen(false)
              setActiveIndex(-1)
              return
            }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              if (hits.length === 0) return
              setOpen(true)
              setActiveIndex((current) => {
                if (event.key === 'ArrowDown') return current < hits.length - 1 ? current + 1 : 0
                return current > 0 ? current - 1 : hits.length - 1
              })
              return
            }
            if (event.key === 'Enter' && open && activeIndex >= 0 && hits[activeIndex]) {
              event.preventDefault()
              void select(hits[activeIndex])
            }
          }}
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={open && hits.length > 0}
          aria-activedescendant={
            open && activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined
          }
        />
        {(busy || picking) && <span className="entity-busy">{picking ? 'Applying…' : '…'}</span>}
      </div>
      {error && <p className="error tiny">{error}</p>}
      {open && hits.length > 0 && (
        <ul className="entity-results" id={listId} role="listbox">
          {hits.map((hit, index) => {
            const img = hitImage(hit)
            const flag =
              hit.kind === 'nationality' ? nationalityFlag(hit.item.name) : undefined
            return (
              <li
                key={hitKey(hit)}
                id={`${listId}-option-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                onMouseMove={() => setActiveIndex(index)}
                onMouseDown={(event) => {
                  event.preventDefault()
                  void select(hit)
                }}
              >
                <div className="entity-result">
                  {img ? (
                    <img src={img} alt="" className="entity-thumb" />
                  ) : flag ? (
                    <span
                      className="entity-thumb flag"
                      role="img"
                      aria-label={`${hit.item.name} flag`}
                    >
                      {flag}
                    </span>
                  ) : (
                    <span className="entity-thumb placeholder" />
                  )}
                  <span>
                    <strong>{hitTitle(hit)}</strong>
                    <span className="muted tiny">{hitSub(hit)}</span>
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
