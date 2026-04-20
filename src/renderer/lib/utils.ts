import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export {
  formatDate,
  formatDateTime,
  formatEuropeanDateOnly,
  formatEuropeanDateTime,
} from '../../shared/date-format'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getScoreColor(score?: number | null): string {
  if (score == null) return 'text-muted-foreground'
  if (score >= 70) return 'text-green-600'
  if (score >= 40) return 'text-yellow-600'
  return 'text-red-500'
}

export function getScoreBgColor(score?: number | null): string {
  if (score == null) return 'bg-gray-100'
  if (score >= 70) return 'bg-green-100'
  if (score >= 40) return 'bg-yellow-100'
  return 'bg-red-100'
}

export function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    gevonden: 'Gevonden',
    gekwalificeerd: 'Gekwalificeerd',
    in_aanbieding: 'In aanbieding',
    afgewezen: 'Afgewezen',
    gearchiveerd: 'Gearchiveerd',
  }
  return labels[status] || status
}

export function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    gevonden: 'bg-blue-100 text-blue-700',
    gekwalificeerd: 'bg-green-100 text-green-700',
    in_aanbieding: 'bg-purple-100 text-purple-700',
    afgewezen: 'bg-red-100 text-red-700',
    gearchiveerd: 'bg-gray-100 text-gray-500',
  }
  return colors[status] || 'bg-gray-100 text-gray-500'
}

export function daysUntil(dateStr?: string | null): number | null {
  if (!dateStr) return null
  const diff = new Date(dateStr).getTime() - Date.now()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}
