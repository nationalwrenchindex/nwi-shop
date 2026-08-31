// Shared display formatting for the financials screens. Plain functions with no
// React so both the server components and the client export block can use them.

const MONEY = new Intl.NumberFormat('en-US', {
  style:                 'currency',
  currency:              'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function formatMoney(value: number): string {
  return MONEY.format(Number.isFinite(value) ? value : 0)
}

export function formatPercent(value: number): string {
  return `${(Number.isFinite(value) ? value : 0).toFixed(1)}%`
}

/**
 * A timestamp as M/D/YYYY, read off the string rather than through `new Date()` so
 * a shop tablet west of UTC does not render a midnight invoice on the day before
 * the one the range query matched it on.
 */
export function formatDate(value: string | null): string {
  if (!value) return '—'
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!m) return '—'
  return `${Number(m[2])}/${Number(m[3])}/${m[1]}`
}
