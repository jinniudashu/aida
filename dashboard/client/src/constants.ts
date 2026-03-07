export const STATE_COLORS: Record<string, string> = {
  OPEN: '#909399',
  IN_PROGRESS: '#18a058',
  BLOCKED: '#f0a020',
  COMPLETED: '#606266',
  FAILED: '#e88080',
}

export const STATE_PRIORITY: Record<string, number> = {
  FAILED: 4,
  IN_PROGRESS: 3,
  BLOCKED: 2,
  OPEN: 1,
  COMPLETED: 0,
}
