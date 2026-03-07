export const STATE_TAG_TYPE: Record<string, 'default' | 'success' | 'warning' | 'error' | 'info'> = {
  OPEN: 'default',
  IN_PROGRESS: 'success',
  BLOCKED: 'warning',
  COMPLETED: 'default',
  FAILED: 'error',
}

export const VALID_TRANSITIONS: Record<string, readonly string[]> = {
  OPEN: ['IN_PROGRESS', 'BLOCKED', 'FAILED'],
  IN_PROGRESS: ['COMPLETED', 'BLOCKED', 'FAILED'],
  BLOCKED: ['OPEN', 'IN_PROGRESS', 'FAILED'],
  COMPLETED: [],
  FAILED: ['OPEN'],
}

export const ALL_STATES = ['OPEN', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'FAILED'] as const

export function formatDate(iso: string | undefined): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleString()
}

export function formatDuration(startTime?: string, endTime?: string): string {
  if (!startTime) return '-'
  const start = new Date(startTime).getTime()
  const end = endTime ? new Date(endTime).getTime() : Date.now()
  const diff = Math.max(0, end - start)
  const h = Math.floor(diff / 3_600_000)
  const m = Math.floor((diff % 3_600_000) / 60_000)
  const s = Math.floor((diff % 60_000) / 1000)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
