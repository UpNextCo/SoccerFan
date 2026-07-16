import { type ReactNode, useState } from 'react'
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

  return (
    <div className="ops-shell">
      <header className="mobile-shell-header">
        <NavLink to="/" className="brand" onClick={() => setMenuOpen(false)}>
          <span className="brand-mark" aria-hidden="true">BK</span>
          <span>Ball Knowledge</span>
        </NavLink>
        <button
          type="button"
          className="mobile-menu-button ghost"
          aria-expanded={menuOpen}
          aria-controls="mobile-ops-nav"
          onClick={() => setMenuOpen((open) => !open)}
        >
          Menu
        </button>
      </header>

      <aside className={`ops-sidebar${menuOpen ? ' is-open' : ''}`} id="mobile-ops-nav">
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
      <div className="ops-content">{children}</div>
    </div>
  )
}
