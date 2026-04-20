import { Menu, Bell, Moon, Sun } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import vdkLogoDark from '../../assets/vdk-logo-dark.svg'
import { useThemeStore } from '../../stores/theme-store'

const pageTitles: Record<string, string> = {
  '/': 'Dashboard',
  '/aanbestedingen': 'Aanbestedingen',
  '/aanbestedingskalender': 'Aanbestedingskalender',
  '/tracking': 'Tracking',
  '/bronnen': 'Bronnen',
  '/criteria': 'Criteria',
  '/ai-vragen': 'AI Vragen',
  '/instellingen': 'Instellingen',
}

interface HeaderProps {
  onToggleSidebar: () => void
}

export function Header({ onToggleSidebar }: HeaderProps) {
  const location = useLocation()
  const currentPath = location.pathname
  const title = pageTitles[currentPath] || (currentPath.startsWith('/aanbestedingen/') ? 'Aanbesteding Details' : 'TenderTracker')
  const dark = useThemeStore((s) => s.dark)
  const toggle = useThemeStore((s) => s.toggle)

  return (
    <header className="titlebar-drag flex h-14 items-center gap-4 border-b bg-[var(--card)] px-4">
      <button
        onClick={onToggleSidebar}
        className="titlebar-no-drag rounded-lg p-2 hover:bg-[var(--muted)] transition-colors"
      >
        <Menu className="h-5 w-5 text-[var(--muted-foreground)]" />
      </button>

      {/* Logo in header */}
      <img
        src={vdkLogoDark}
        alt="Van de Kreeke Groep"
        className="h-7 w-auto titlebar-no-drag"
      />

      <div className="h-5 w-px bg-[var(--border)]" />

      <div className="flex-1">
        <h2 className="text-lg font-semibold text-[var(--foreground)]">{title}</h2>
      </div>

      <div className="titlebar-no-drag flex items-center gap-2">
        <button
          type="button"
          onClick={toggle}
          title={dark ? 'Schakel naar licht thema' : 'Schakel naar donker thema'}
          aria-label={dark ? 'Licht thema' : 'Donker thema'}
          className="rounded-lg p-2 hover:bg-[var(--muted)] transition-colors text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          {dark
            ? <Sun className="h-5 w-5" />
            : <Moon className="h-5 w-5" />
          }
        </button>
        <button className="relative rounded-lg p-2 hover:bg-[var(--muted)] transition-colors">
          <Bell className="h-5 w-5 text-[var(--muted-foreground)]" />
        </button>
      </div>
    </header>
  )
}
