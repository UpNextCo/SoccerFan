import { type ReactNode, useEffect, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'

export function OpsShell({
  adminName,
  onLogout,
  children,
}: {
  adminName: string
  onLogout: () => void
  children: ReactNode
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const sidebarRef = useRef<HTMLElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const wasMenuOpen = useRef(false)

  useEffect(() => {
    const content = contentRef.current
    if (content) content.inert = menuOpen

    if (!menuOpen) {
      if (wasMenuOpen.current) menuButtonRef.current?.focus()
      wasMenuOpen.current = false
      return
    }

    wasMenuOpen.current = true
    const frame = window.requestAnimationFrame(() => {
      const focusable = getFocusableElements(sidebarRef.current)
      const focusTarget = focusable[0] ?? sidebarRef.current
      focusTarget?.focus()
    })

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setMenuOpen(false)
        return
      }
      if (event.key !== 'Tab') return

      const focusable = getFocusableElements(sidebarRef.current)
      if (focusable.length === 0) {
        event.preventDefault()
        sidebarRef.current?.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [menuOpen])

  useEffect(() => {
    const media = window.matchMedia('(max-width: 800px)')
    const handleChange = () => {
      if (!media.matches) setMenuOpen(false)
    }
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [])

  return (
    <div className="ops-shell">
      <header className="mobile-shell-header">
        <NavLink to="/" className="brand" onClick={() => setMenuOpen(false)}>
          <span className="brand-mark" aria-hidden="true">BK</span>
          <span>Ball Knowledge</span>
        </NavLink>
        <button
          ref={menuButtonRef}
          type="button"
          className="mobile-menu-button ghost"
          aria-expanded={menuOpen}
          aria-controls="mobile-ops-nav"
          onClick={() => setMenuOpen((open) => !open)}
        >
          Menu
        </button>
      </header>

      <aside
        ref={sidebarRef}
        className={`ops-sidebar${menuOpen ? ' is-open' : ''}`}
        id="mobile-ops-nav"
        tabIndex={-1}
      >
        <div>
          <NavLink to="/" className="brand desktop-brand" onClick={() => setMenuOpen(false)}>
            <span className="brand-mark" aria-hidden="true">BK</span>
            <span>Ball Knowledge</span>
          </NavLink>
          <p className="nav-label">Quiz Ops</p>
          <nav aria-label="Primary navigation">
            <NavLink
              to="/"
              end
              className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
              onClick={() => setMenuOpen(false)}
            >
              <span className="nav-icon" aria-hidden="true">▦</span>
              Schedule
            </NavLink>
          </nav>
        </div>
        <div className="account-block">
          <span className="account-avatar" aria-hidden="true">
            {adminName.trim().charAt(0).toUpperCase()}
          </span>
          <div>
            <strong>{adminName}</strong>
            <span>Quiz team</span>
          </div>
          <button type="button" className="logout-button" onClick={onLogout}>
            Log out
          </button>
        </div>
      </aside>

      {menuOpen && (
        <button
          type="button"
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <div ref={contentRef} className="ops-content" aria-hidden={menuOpen || undefined}>
        {children}
      </div>
    </div>
  )
}

function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) return []
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => element.getClientRects().length > 0)
}
