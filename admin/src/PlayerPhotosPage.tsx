import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type AdminPlayerHit, type AdminPlayerPhoto } from './api'
import { EntityPicker } from './components/EntityPicker'
import { nationalityFlag } from './countryFlags'
import './player-photos.css'

async function prepareHeadshotUpload(file: File): Promise<{ fileBase64: string; mimeType: string }> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 800 / Math.max(bitmap.width, bitmap.height))
  let width = Math.max(1, Math.round(bitmap.width * scale))
  let height = Math.max(1, Math.round(bitmap.height * scale))
  let quality = 0.88

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

export function PlayerPhotosPage() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selected, setSelected] = useState<AdminPlayerPhoto | null>(null)
  const [overrides, setOverrides] = useState<AdminPlayerPhoto[]>([])
  const [busy, setBusy] = useState(false)
  const [loadingOverrides, setLoadingOverrides] = useState(true)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refreshOverrides = useCallback(async () => {
    setLoadingOverrides(true)
    try {
      const result = await api.listPlayerPhotoOverrides(60)
      setOverrides(result.players)
    } catch {
      // Keep the last known list if refresh fails.
    } finally {
      setLoadingOverrides(false)
    }
  }, [])

  useEffect(() => {
    void refreshOverrides()
  }, [refreshOverrides])

  async function pickPlayer(hit: AdminPlayerHit) {
    setError(null)
    setMessage(null)
    setBusy(true)
    try {
      const player = await api.getPlayerPhoto(hit.id)
      setSelected(player)
    } catch (err) {
      setSelected({
        id: hit.id,
        name: hit.name,
        club: hit.club,
        nationality: hit.nationality,
        position: hit.position,
        photoUrl: null,
        headshotUrl: hit.headshotUrl ?? null,
        hasCustomPhoto: false,
      })
      setError(err instanceof Error ? err.message : 'Could not load player photo.')
    } finally {
      setBusy(false)
    }
  }

  async function onFileChosen(file: File | null) {
    if (!file || !selected) return
    setError(null)
    setMessage(null)
    setBusy(true)
    try {
      const prepared = await prepareHeadshotUpload(file)
      const updated = await api.setPlayerPhoto(selected.id, {
        ...prepared,
        filename: file.name,
      })
      setSelected(updated)
      setMessage(`Saved custom photo for ${updated.name}. It will show in search and new puzzles immediately.`)
      await refreshOverrides()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setBusy(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function clearPhoto() {
    if (!selected?.hasCustomPhoto) return
    setError(null)
    setMessage(null)
    setBusy(true)
    try {
      const updated = await api.clearPlayerPhoto(selected.id)
      setSelected(updated)
      setMessage(`Cleared custom photo for ${updated.name}. Default headshot restored.`)
      await refreshOverrides()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not clear photo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="player-photos-page">
      <header className="board-heading">
        <div>
          <p className="eyebrow">Quiz Ops</p>
          <h1>Player photos</h1>
          <p className="muted">
            Search a player, upload a replacement headshot, and it overrides their photo everywhere
            (search, games, and new puzzle content).
          </p>
        </div>
      </header>

      <section className="player-photos-card">
        <h2>Find player</h2>
        <EntityPicker
          kind="player"
          label="Player"
          valueLabel={selected?.name}
          imageUrl={selected?.headshotUrl}
          nationality={selected?.nationality}
          disabled={busy}
          placeholder="Search player…"
          onPickPlayer={(hit) => void pickPlayer(hit)}
        />

        {selected && (
          <div className="player-photo-editor">
            <div className="player-photo-preview">
              {selected.headshotUrl ? (
                <img key={selected.headshotUrl} src={selected.headshotUrl} alt="" />
              ) : (
                <div className="player-photo-empty">No photo</div>
              )}
            </div>
            <div className="player-photo-meta">
              <strong>{selected.name}</strong>
              <p className="muted tiny">
                {[selected.club, selected.nationality ? `${nationalityFlag(selected.nationality)} ${selected.nationality}` : null, selected.position]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <p className={`photo-status${selected.hasCustomPhoto ? ' custom' : ''}`}>
                {selected.hasCustomPhoto ? 'Custom photo active' : 'Using default headshot'}
              </p>
              <div className="player-photo-actions">
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {busy ? 'Working…' : selected.hasCustomPhoto ? 'Replace photo' : 'Upload photo'}
                </button>
                {selected.hasCustomPhoto && (
                  <button type="button" className="ghost" disabled={busy} onClick={() => void clearPhoto()}>
                    Clear custom photo
                  </button>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                hidden
                onChange={(e) => void onFileChosen(e.target.files?.[0] ?? null)}
              />
              <p className="muted tiny">JPEG, PNG, or WebP · max 2.5MB (auto-resized).</p>
            </div>
          </div>
        )}

        {message && <p className="player-photos-banner success">{message}</p>}
        {error && <p className="player-photos-banner error">{error}</p>}
      </section>

      <section className="player-photos-card">
        <header className="player-photos-list-header">
          <h2>Custom overrides</h2>
          <button type="button" className="ghost tiny-btn" disabled={loadingOverrides} onClick={() => void refreshOverrides()}>
            Refresh
          </button>
        </header>
        {loadingOverrides && overrides.length === 0 ? (
          <p className="muted">Loading…</p>
        ) : overrides.length === 0 ? (
          <p className="muted">No custom player photos yet.</p>
        ) : (
          <ul className="player-photo-override-list">
            {overrides.map((player) => (
              <li key={player.id}>
                <button
                  type="button"
                  className="player-photo-override-row"
                  onClick={() => setSelected(player)}
                >
                  {player.headshotUrl ? (
                    <img src={player.headshotUrl} alt="" />
                  ) : (
                    <span className="player-photo-empty small" />
                  )}
                  <span>
                    <strong>{player.name}</strong>
                    <span className="muted tiny">{player.club}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
