import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, FileSearch, Globe, Settings, ListChecks,
  Brain, ScanSearch, ChevronLeft, ChevronRight, Layers, CalendarRange,
} from 'lucide-react'
import { cn } from '../../lib/utils'
import vdkLogo from '../../assets/vdk-logo.svg'

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/aanbestedingen', label: 'Aanbestedingen', icon: FileSearch },
  { to: '/aanbestedingskalender', label: 'Aanbestedingskalender', icon: CalendarRange },
  { to: '/pipeline', label: 'Pipeline', icon: Layers },
  { to: '/tracking', label: 'Tracking', icon: ScanSearch },
  { to: '/bronnen', label: 'Bronnen', icon: Globe },
  { to: '/criteria', label: 'Criteria', icon: ListChecks },
  { to: '/ai-vragen', label: 'AI Vragen', icon: Brain },
  { to: '/instellingen', label: 'Instellingen', icon: Settings },
]

interface AppSidebarProps {
  open: boolean
  onToggle: () => void
}

export function AppSidebar({ open, onToggle }: AppSidebarProps) {
  return (
    <aside
      className={cn(
        'flex flex-col border-r transition-all duration-300 ease-in-out',
        'bg-[var(--sidebar-background)] text-[var(--sidebar-foreground)]',
        open ? 'w-64' : 'w-16'
      )}
    >
      {/* Logo area */}
      <div className={cn(
        'flex items-center border-b border-[var(--sidebar-border)]',
        open ? 'px-4 py-4 gap-3' : 'justify-center py-4'
      )}>
        {open ? (
          <img
            src={vdkLogo}
            alt="Van de Kreeke Groep"
            className="h-10 w-auto"
          />
        ) : (
          /* Collapsed: show just the 3 red hexagons from the logo */
          <div className="flex flex-col items-center gap-0.5">
            <div className="h-2.5 w-2.5 rotate-45 bg-[#ea0029]" />
            <div className="flex gap-0.5">
              <div className="h-2.5 w-2.5 rotate-45 bg-[#ea0029]" />
              <div className="h-2.5 w-2.5 rotate-45 bg-[#ea0029]" />
            </div>
          </div>
        )}
      </div>

      {/* TenderTracker label */}
      {open && (
        <div className="px-4 py-2 border-b border-[var(--sidebar-border)]">
          <p className="text-[11px] font-bold tracking-wider uppercase text-[var(--sidebar-primary)]">
            TenderTracker
          </p>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                'hover:bg-[var(--sidebar-accent)] hover:text-[var(--sidebar-accent-foreground)]',
                isActive
                  ? 'bg-[var(--sidebar-accent)] text-[var(--sidebar-primary)]'
                  : 'text-[var(--sidebar-foreground)]/70',
                !open && 'justify-center px-0'
              )
            }
          >
            <item.icon className="h-5 w-5 flex-shrink-0" />
            {open && <span className="truncate">{item.label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={onToggle}
        className="flex items-center justify-center gap-2 border-t border-[var(--sidebar-border)] px-4 py-3 text-xs text-[var(--sidebar-foreground)]/50 hover:text-[var(--sidebar-foreground)]/80 transition-colors"
      >
        {open ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        {open && <span>Inklappen</span>}
      </button>
    </aside>
  )
}
