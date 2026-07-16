import { type ReactNode, useEffect, useRef } from 'react'
import type { CellStatus } from '../api'

type PuzzleStatus = CellStatus | string

const STATUS_LABELS: Record<CellStatus, string> = {
  missing: 'Missing',
  generated: 'Needs review',
  approved: 'Ready',
  locked: 'Locked',
}

export function StatusBadge({
  status,
  compact = false,
}: {
  status: PuzzleStatus
  compact?: boolean
}) {
  const normalized = status.toLowerCase()
  const label =
    normalized in STATUS_LABELS
      ? STATUS_LABELS[normalized as CellStatus]
      : status || 'Unknown'

  return (
    <span className={`status-badge status-${normalized}${compact ? ' status-compact' : ''}`}>
      <span className="status-marker" aria-hidden="true" />
      {label}
    </span>
  )
}

export function SectionCard({
  title,
  description,
  actions,
  className = '',
  children,
}: {
  title?: string
  description?: string
  actions?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <section className={`section-card ${className}`.trim()}>
      {(title || description || actions) && (
        <header className="section-card-header">
          <div>
            {title && <h2>{title}</h2>}
            {description && <p className="muted">{description}</p>}
          </div>
          {actions && <div className="section-card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  )
}

export function ValidationPanel({
  tone,
  title,
  children,
  onDismiss,
}: {
  tone: 'success' | 'error' | 'info'
  title: string
  children?: ReactNode
  onDismiss?: () => void
}) {
  return (
    <div className={`validation-panel validation-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <span className="validation-icon" aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        {children && <div className="validation-detail">{children}</div>}
      </div>
      {onDismiss && (
        <button type="button" className="icon-button" onClick={onDismiss} aria-label="Dismiss notice">
          ×
        </button>
      )}
    </div>
  )
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  danger = false,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog ref={ref} className="confirm-dialog" onCancel={onCancel} onClose={onCancel}>
      <h2>{title}</h2>
      <p className="muted">{description}</p>
      <div className="confirm-actions">
        <button type="button" className="ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className={danger ? 'danger' : ''} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  )
}
