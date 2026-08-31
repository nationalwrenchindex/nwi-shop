'use client'

// Payroll CSV export. This component only builds the URL — the route does the
// arithmetic and the permission check, so nothing here can widen access.

import { useState } from 'react'
import {
  addDays,
  dateKey,
  DEFAULT_WEEK_STARTS_ON,
  startOfWeek,
} from '@/lib/shop/timeclock'

interface TechOption {
  id: string
  name: string
}

interface Props {
  defaultFrom: string
  defaultTo: string
  techs: TechOption[]
  /** Server-rendered "today" so the presets agree with the server's clock. */
  today: string
}

interface Preset {
  label: string
  range: (today: Date) => { from: Date; to: Date }
}

const PRESETS: Preset[] = [
  {
    label: 'This week',
    range: (today) => ({ from: startOfWeek(today, DEFAULT_WEEK_STARTS_ON), to: today }),
  },
  {
    label: 'Last week',
    range: (today) => {
      const thisWeek = startOfWeek(today, DEFAULT_WEEK_STARTS_ON)
      return { from: addDays(thisWeek, -7), to: addDays(thisWeek, -1) }
    },
  },
  {
    label: 'Last 2 weeks',
    range: (today) => {
      const thisWeek = startOfWeek(today, DEFAULT_WEEK_STARTS_ON)
      return { from: addDays(thisWeek, -14), to: addDays(thisWeek, -1) }
    },
  },
  {
    label: 'This month',
    range: (today) => ({
      from: new Date(today.getFullYear(), today.getMonth(), 1),
      to: today,
    }),
  },
  {
    label: 'Last month',
    range: (today) => ({
      from: new Date(today.getFullYear(), today.getMonth() - 1, 1),
      to: new Date(today.getFullYear(), today.getMonth(), 0),
    }),
  },
]

export default function PayrollExport({ defaultFrom, defaultTo, techs, today }: Props) {
  const [from, setFrom] = useState(defaultFrom)
  const [to, setTo] = useState(defaultTo)
  const [techId, setTechId] = useState('')

  const params = new URLSearchParams({ from, to })
  if (techId) params.set('tech_id', techId)
  const href = `/api/shop/timeclock/payroll?${params.toString()}`
  const ready = from !== '' && to !== ''

  function applyPreset(preset: Preset) {
    const base = new Date(`${today}T12:00:00`)
    const range = preset.range(Number.isFinite(base.getTime()) ? base : new Date())
    setFrom(dateKey(range.from))
    setTo(dateKey(range.to))
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-slate-200 p-5 dark:border-slate-800">
      <div>
        <h2 className="text-xl font-bold">Payroll export</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Hours come off the shop clock. Overtime is every hour past 40 in a single
          work week (Sunday to Saturday), paid at 1.5x and flagged per week in the file.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => applyPreset(preset)}
            className="rounded-full border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-900"
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm font-semibold">
          From
          <input
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-base dark:border-slate-700 dark:bg-slate-900"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          To
          <input
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-base dark:border-slate-700 dark:bg-slate-900"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Tech
          <select
            value={techId}
            onChange={(event) => setTechId(event.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-base dark:border-slate-700 dark:bg-slate-900"
          >
            <option value="">All techs</option>
            {techs.map((tech) => (
              <option key={tech.id} value={tech.id}>
                {tech.name}
              </option>
            ))}
          </select>
        </label>

        {ready ? (
          <a
            href={href}
            download
            className="rounded-lg bg-slate-800 px-5 py-2.5 text-base font-semibold text-white hover:bg-slate-700 dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-white"
          >
            Download CSV
          </a>
        ) : (
          <span className="rounded-lg bg-slate-200 px-5 py-2.5 text-base font-semibold text-slate-500 dark:bg-slate-800">
            Download CSV
          </span>
        )}
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        File: nwi-payroll_{from || '____'}_{to || '____'}.csv
      </p>
    </section>
  )
}
