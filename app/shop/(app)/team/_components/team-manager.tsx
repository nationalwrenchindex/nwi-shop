'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ROLE_LABELS } from '@/lib/permissions'
import type { ShopRole, ShopTech } from '@/lib/types'

interface FormState {
  first_name: string
  last_name: string
  email: string
  phone: string
  role: ShopRole
  pay_rate: string
  hire_date: string
  active: boolean
}

const BLANK: FormState = {
  first_name: '',
  last_name: '',
  email: '',
  phone: '',
  role: 'tech',
  pay_rate: '',
  hire_date: '',
  active: true,
}

function toForm(tech: ShopTech): FormState {
  return {
    first_name: tech.first_name,
    last_name: tech.last_name,
    email: tech.email ?? '',
    phone: tech.phone ?? '',
    role: tech.role,
    pay_rate: tech.pay_rate === null || tech.pay_rate === undefined ? '' : String(tech.pay_rate),
    hire_date: tech.hire_date ?? '',
    active: tech.active,
  }
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

export default function TeamManager({
  initialTechs,
  canViewPayRates,
  isManager,
  currentTechId,
  seatLimit,
}: {
  initialTechs: ShopTech[]
  canViewPayRates: boolean
  isManager: boolean
  currentTechId: string
  seatLimit: number | null
}) {
  const router = useRouter()
  const [techs, setTechs] = useState<ShopTech[]>(initialTechs)
  const [editing, setEditing] = useState<ShopTech | null>(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState<FormState>(BLANK)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const activeCount = techs.filter((t) => t.active).length
  const atLimit = seatLimit !== null && activeCount >= seatLimit
  const open = adding || editing !== null

  function startAdd() {
    setForm(BLANK)
    setEditing(null)
    setAdding(true)
    setError(null)
  }

  function startEdit(tech: ShopTech) {
    setForm(toForm(tech))
    setAdding(false)
    setEditing(tech)
    setError(null)
  }

  function close() {
    setAdding(false)
    setEditing(null)
    setError(null)
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)

    // pay_rate is only ever placed on the wire by a caller allowed to see it.
    // The API strips it again regardless — this is the UI half of that rule.
    const payload: Record<string, unknown> = {
      first_name: form.first_name,
      last_name: form.last_name,
      email: form.email,
      phone: form.phone,
      role: form.role,
      hire_date: form.hire_date,
      active: form.active,
    }
    if (canViewPayRates) {
      payload.pay_rate = form.pay_rate === '' ? null : Number(form.pay_rate)
    }

    const url = editing ? `/api/shop/team/${editing.id}` : '/api/shop/team'
    const method = editing ? 'PATCH' : 'POST'

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = (await res.json()) as { tech?: ShopTech; error?: string }

      if (!res.ok || !body.tech) {
        setError(body.error ?? 'Something went wrong. Try again.')
        setBusy(false)
        return
      }

      const saved = body.tech
      setTechs((prev) =>
        editing ? prev.map((t) => (t.id === saved.id ? saved : t)) : [...prev, saved],
      )
      close()
      router.refresh()
    } catch {
      setError('Network error. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function toggleActive(tech: ShopTech) {
    setError(null)
    try {
      const res = await fetch(`/api/shop/team/${tech.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !tech.active }),
      })
      const body = (await res.json()) as { tech?: ShopTech; error?: string }
      if (!res.ok || !body.tech) {
        setError(body.error ?? 'Could not update that tech.')
        return
      }
      const saved = body.tech
      setTechs((prev) => prev.map((t) => (t.id === saved.id ? saved : t)))
      router.refresh()
    } catch {
      setError('Network error. Check your connection and try again.')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          {techs.length} {techs.length === 1 ? 'person' : 'people'} on the roster
        </p>
        <button
          type="button"
          className="nwi-btn nwi-btn-primary"
          onClick={startAdd}
          disabled={atLimit}
          title={atLimit ? 'Tech seat limit reached for your plan' : undefined}
        >
          Add tech
        </button>
      </div>

      {atLimit ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          You are using all {seatLimit} tech seats on your plan. Deactivate someone or
          upgrade to add another.
        </p>
      ) : null}

      {error && !open ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {open ? (
        <form onSubmit={submit} className="nwi-card space-y-4 p-5">
          <h2 className="text-lg font-semibold text-slate-900">
            {editing ? `Edit ${editing.first_name} ${editing.last_name}` : 'Add a tech'}
          </h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="nwi-label" htmlFor="first_name">
                First name
              </label>
              <input
                id="first_name"
                className="nwi-input"
                required
                value={form.first_name}
                onChange={(e) => set('first_name', e.target.value)}
              />
            </div>
            <div>
              <label className="nwi-label" htmlFor="last_name">
                Last name
              </label>
              <input
                id="last_name"
                className="nwi-input"
                required
                value={form.last_name}
                onChange={(e) => set('last_name', e.target.value)}
              />
            </div>
            <div>
              <label className="nwi-label" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                className="nwi-input"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
                placeholder="tech@yourshop.com"
              />
            </div>
            <div>
              <label className="nwi-label" htmlFor="phone">
                Phone
              </label>
              <input
                id="phone"
                type="tel"
                className="nwi-input"
                value={form.phone}
                onChange={(e) => set('phone', e.target.value)}
                placeholder="(555) 555-0100"
              />
            </div>
            <div>
              <label className="nwi-label" htmlFor="role">
                Role
              </label>
              <select
                id="role"
                className="nwi-select"
                value={form.role}
                onChange={(e) => set('role', e.target.value as ShopRole)}
              >
                <option value="tech">{ROLE_LABELS.tech}</option>
                <option value="foreman">{ROLE_LABELS.foreman}</option>
                {/* Only a manager can create or promote to manager. */}
                {isManager ? <option value="manager">{ROLE_LABELS.manager}</option> : null}
              </select>
            </div>
            <div>
              <label className="nwi-label" htmlFor="hire_date">
                Hire date
              </label>
              <input
                id="hire_date"
                type="date"
                className="nwi-input"
                value={form.hire_date}
                onChange={(e) => set('hire_date', e.target.value)}
              />
            </div>

            {/* Pay rate exists in the form only for a caller with viewPayRates.
                A foreman never renders this field and never sends the value. */}
            {canViewPayRates ? (
              <div>
                <label className="nwi-label" htmlFor="pay_rate">
                  Pay rate ($/hr)
                </label>
                <input
                  id="pay_rate"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  className="nwi-input"
                  value={form.pay_rate}
                  onChange={(e) => set('pay_rate', e.target.value)}
                  placeholder="32.50"
                />
              </div>
            ) : null}

            <div className="flex items-end">
              <label className="flex items-center gap-3 py-2 text-sm font-medium text-slate-700">
                <input
                  type="checkbox"
                  className="h-5 w-5 rounded border-slate-300"
                  checked={form.active}
                  onChange={(e) => set('active', e.target.checked)}
                  disabled={editing?.id === currentTechId}
                />
                Active
              </label>
            </div>
          </div>

          {error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button type="submit" className="nwi-btn nwi-btn-primary" disabled={busy}>
              {busy ? 'Saving…' : editing ? 'Save changes' : 'Add tech'}
            </button>
            <button
              type="button"
              className="nwi-btn nwi-btn-secondary"
              onClick={close}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      <div className="nwi-card overflow-hidden">
        {techs.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-slate-500">
            No one on the roster yet. Add your first tech to get started.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-semibold">Name</th>
                  <th className="px-5 py-3 font-semibold">Role</th>
                  <th className="px-5 py-3 font-semibold">Contact</th>
                  <th className="px-5 py-3 font-semibold">Hired</th>
                  {canViewPayRates ? (
                    <th className="px-5 py-3 text-right font-semibold">Pay rate</th>
                  ) : null}
                  <th className="px-5 py-3 font-semibold">Status</th>
                  <th className="px-5 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {techs.map((tech) => (
                  <tr key={tech.id} className={tech.active ? '' : 'bg-slate-50 text-slate-500'}>
                    <td className="px-5 py-4 font-semibold text-slate-900">
                      {tech.first_name} {tech.last_name}
                      {tech.id === currentTechId ? (
                        <span className="ml-2 text-xs font-medium text-slate-400">(you)</span>
                      ) : null}
                    </td>
                    <td className="px-5 py-4">{ROLE_LABELS[tech.role]}</td>
                    <td className="px-5 py-4">
                      <span className="block">{tech.email ?? '—'}</span>
                      <span className="block text-slate-500">{tech.phone ?? '—'}</span>
                    </td>
                    <td className="px-5 py-4 whitespace-nowrap">{formatDate(tech.hire_date)}</td>
                    {canViewPayRates ? (
                      <td className="px-5 py-4 text-right tabular-nums">
                        {tech.pay_rate === null || tech.pay_rate === undefined
                          ? '—'
                          : `$${Number(tech.pay_rate).toFixed(2)}`}
                      </td>
                    ) : null}
                    <td className="px-5 py-4">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${
                          tech.active
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        {tech.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          className="nwi-btn nwi-btn-secondary"
                          onClick={() => startEdit(tech)}
                        >
                          Edit
                        </button>
                        {tech.id === currentTechId ? null : (
                          <button
                            type="button"
                            className={
                              tech.active
                                ? 'nwi-btn nwi-btn-danger'
                                : 'nwi-btn nwi-btn-secondary'
                            }
                            onClick={() => toggleActive(tech)}
                          >
                            {tech.active ? 'Deactivate' : 'Reactivate'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
