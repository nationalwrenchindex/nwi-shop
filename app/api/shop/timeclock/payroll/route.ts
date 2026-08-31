// GET /api/shop/timeclock/payroll?from=&to=&tech_id=
//
// Payroll CSV export. Guarded on `runPayroll`, and asserted again on
// `viewPayRates` in the body — pay rate and total pay must never be computed
// for a caller who cannot see them, so the gate is checked twice on purpose.
//
// Overtime rule: every minute beyond 40 hours inside a single work week
// (Sunday-Saturday), paid at 1.5x. Never per day.

import type { NextRequest } from 'next/server'
import Papa from 'papaparse'
import { apiContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import {
  buildPayroll,
  DEFAULT_WEEK_STARTS_ON,
  OVERTIME_MULTIPLIER,
  toHours,
} from '@/lib/shop/timeclock'
import { fetchPunches, fetchTechs, fetchTechsByIds, parseRange } from '../_queries'

interface PayrollCsvRow {
  row_type: 'week' | 'tech_total' | 'shop_total'
  tech: string
  week_starting: string
  regular_hours: string
  overtime_hours: string
  total_hours: string
  overtime: string
  pay_rate: string
  regular_pay: string
  overtime_pay: string
  total_pay: string
}

const COLUMNS: (keyof PayrollCsvRow)[] = [
  'row_type',
  'tech',
  'week_starting',
  'regular_hours',
  'overtime_hours',
  'total_hours',
  'overtime',
  'pay_rate',
  'regular_pay',
  'overtime_pay',
  'total_pay',
]

function money(value: number | null): string {
  return value === null ? '' : value.toFixed(2)
}

function hours(minutes: number): string {
  return toHours(minutes).toFixed(2)
}

export async function GET(request: NextRequest): Promise<Response> {
  const auth = await apiContext('runPayroll')
  if (!auth.ctx) return auth.error
  const ctx = auth.ctx

  // Belt and braces: `runPayroll` implies `viewPayRates` in the current matrix,
  // but the money columns are gated on the rate permission itself.
  const includePay = ctx.permissions.viewPayRates
  if (!includePay) {
    return Response.json(
      { error: 'Payroll export requires permission to view pay rates.' },
      { status: 403 },
    )
  }

  const params = request.nextUrl.searchParams
  const now = new Date()
  const range = parseRange(params, now)
  const techId = params.get('tech_id') ?? undefined

  const supabase = await createClient()

  const punches = await fetchPunches(supabase, {
    shopId: ctx.shop.id,
    techId,
    from: range.from,
    to: range.to,
  })

  // Everyone currently on the roster, plus anyone who logged time in the range
  // but has since been deactivated — they still have to be paid.
  const roster = await fetchTechs(supabase, ctx.shop.id)
  const known = new Set(roster.map((tech) => tech.id))
  const departed = await fetchTechsByIds(
    supabase,
    ctx.shop.id,
    punches.map((punch) => punch.tech_id).filter((id) => !known.has(id)),
  )

  const techs = [...roster, ...departed]
    .filter((tech) => (techId ? tech.id === techId : true))
    .sort((a, b) => `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`))

  const payroll = buildPayroll(techs, punches, {
    now,
    weekStartsOn: DEFAULT_WEEK_STARTS_ON,
    includePay,
    overtimeMultiplier: OVERTIME_MULTIPLIER,
  })

  const rows: PayrollCsvRow[] = []
  let shopRegular = 0
  let shopOvertime = 0
  let shopPay = 0

  for (const tech of payroll) {
    for (const week of tech.weeks) {
      rows.push({
        row_type: 'week',
        tech: week.techName,
        week_starting: week.weekStart,
        regular_hours: hours(week.regularMinutes),
        overtime_hours: hours(week.overtimeMinutes),
        total_hours: hours(week.totalMinutes),
        overtime: week.hasOvertime ? 'OVERTIME' : '',
        pay_rate: money(tech.payRate),
        regular_pay: '',
        overtime_pay: '',
        total_pay: '',
      })
    }

    rows.push({
      row_type: 'tech_total',
      tech: tech.techName,
      week_starting: `${range.fromKey} to ${range.toKey}`,
      regular_hours: hours(tech.regularMinutes),
      overtime_hours: hours(tech.overtimeMinutes),
      total_hours: hours(tech.totalMinutes),
      overtime: tech.overtimeMinutes > 0 ? 'OVERTIME' : '',
      pay_rate: money(tech.payRate),
      regular_pay: money(tech.regularPay),
      overtime_pay: money(tech.overtimePay),
      total_pay: money(tech.totalPay),
    })

    shopRegular += tech.regularMinutes
    shopOvertime += tech.overtimeMinutes
    shopPay += tech.totalPay ?? 0
  }

  rows.push({
    row_type: 'shop_total',
    tech: ctx.shop.business_name,
    week_starting: `${range.fromKey} to ${range.toKey}`,
    regular_hours: hours(shopRegular),
    overtime_hours: hours(shopOvertime),
    total_hours: hours(shopRegular + shopOvertime),
    overtime: shopOvertime > 0 ? 'OVERTIME' : '',
    pay_rate: '',
    regular_pay: '',
    overtime_pay: '',
    total_pay: shopPay.toFixed(2),
  })

  const csv = Papa.unparse(rows, { columns: COLUMNS })
  const filename = `nwi-payroll_${range.fromKey}_${range.toKey}.csv`

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
