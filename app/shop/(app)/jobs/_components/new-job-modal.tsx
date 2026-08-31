'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { customerName, vehicleLabel } from '@/lib/shop/jobs'
import type { ShopCustomer, ShopVehicle } from '@/lib/types'

interface JsonResult {
  ok:    boolean
  body:  Record<string, unknown> | null
  error: string | null
}

async function requestJson(url: string, init?: RequestInit): Promise<JsonResult> {
  try {
    const res = await fetch(url, init)
    const parsed: unknown = await res.json().catch(() => null)
    const body =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null
    if (!res.ok) {
      return { ok: false, body, error: typeof body?.error === 'string' ? body.error : 'Request failed.' }
    }
    return { ok: true, body, error: null }
  } catch {
    return { ok: false, body: null, error: 'Network error - nothing was saved.' }
  }
}

function readId(body: Record<string, unknown> | null, key: string): string | null {
  const row = body?.[key]
  if (row && typeof row === 'object' && 'id' in row) {
    const id = (row as { id: unknown }).id
    if (typeof id === 'string') return id
  }
  return null
}

function readRows<T>(body: Record<string, unknown> | null, key: string): T[] {
  const rows = body?.[key]
  return Array.isArray(rows) ? (rows as T[]) : []
}

const EMPTY_CUSTOMER = { first_name: '', last_name: '', company: '', phone: '', email: '' }
const EMPTY_VEHICLE = { year: '', make: '', model: '', unit_number: '', vin: '' }

/** Quick job creation: find or create a customer, then a vehicle, then the job. */
export default function NewJobModal() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ShopCustomer[]>([])
  const [searching, setSearching] = useState(false)
  const [customer, setCustomer] = useState<ShopCustomer | null>(null)
  const [newCustomerMode, setNewCustomerMode] = useState(false)
  const [draftCustomer, setDraftCustomer] = useState({ ...EMPTY_CUSTOMER })

  const [vehicles, setVehicles] = useState<{ forCustomer: string | null; rows: ShopVehicle[] }>({
    forCustomer: null,
    rows: [],
  })
  const [vehicleId, setVehicleId] = useState('')
  const [newVehicleMode, setNewVehicleMode] = useState(false)
  const [draftVehicle, setDraftVehicle] = useState({ ...EMPTY_VEHICLE })

  const [complaint, setComplaint] = useState('')
  const [hours, setHours] = useState('')

  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const reset = useCallback(() => {
    setQuery('')
    setResults([])
    setCustomer(null)
    setNewCustomerMode(false)
    setDraftCustomer({ ...EMPTY_CUSTOMER })
    setVehicles({ forCustomer: null, rows: [] })
    setVehicleId('')
    setNewVehicleMode(false)
    setDraftVehicle({ ...EMPTY_VEHICLE })
    setComplaint('')
    setHours('')
    setError(null)
  }, [])

  // Type-ahead against shop_customers, debounced so a fast typist does not fire
  // a request per keystroke.
  useEffect(() => {
    if (!open || newCustomerMode || customer) return
    const term = query.trim()
    let cancelled = false
    const timer = window.setTimeout(async () => {
      if (term.length < 2) {
        setResults([])
        setSearching(false)
        return
      }
      setSearching(true)
      const res = await requestJson(`/api/shop/customers?q=${encodeURIComponent(term)}`)
      if (cancelled) return
      setResults(readRows<ShopCustomer>(res.body, 'customers'))
      setSearching(false)
    }, 250)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [query, open, newCustomerMode, customer])

  // Vehicles follow the selected customer. The fetched rows are tagged with the
  // customer they belong to so a stale list is never shown against a new pick.
  useEffect(() => {
    if (!customer) return
    const customerId = customer.id
    let cancelled = false
    void (async () => {
      const res = await requestJson(`/api/shop/vehicles?customer_id=${encodeURIComponent(customerId)}`)
      if (cancelled) return
      const rows = readRows<ShopVehicle>(res.body, 'vehicles')
      setVehicles({ forCustomer: customerId, rows })
      setNewVehicleMode(rows.length === 0)
    })()
    return () => {
      cancelled = true
    }
  }, [customer])

  function close() {
    setOpen(false)
    reset()
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (saving) return
    setError(null)

    if (!complaint.trim()) {
      setError('Describe the complaint so the tech knows what they are looking at.')
      return
    }

    setSaving(true)
    try {
      // 1. Customer - existing selection, or created inline.
      let customerId = customer?.id ?? null
      if (newCustomerMode) {
        if (!draftCustomer.first_name.trim() && !draftCustomer.last_name.trim() && !draftCustomer.company.trim()) {
          setError('Enter a name or a company for the new customer.')
          return
        }
        const res = await requestJson('/api/shop/customers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(draftCustomer),
        })
        if (!res.ok) {
          setError(res.error)
          return
        }
        customerId = readId(res.body, 'customer')
      }
      if (!customerId) {
        setError('Pick a customer or add a new one.')
        return
      }

      // 2. Vehicle - optional, but created before the job so the job can point
      //    at it in a single write.
      // A brand-new customer has no vehicles to pick from, so the inline
      // vehicle fields are the only option in that branch.
      let selectedVehicleId: string | null = vehicleId || null
      if (newVehicleMode || newCustomerMode) {
        const hasVehicle =
          draftVehicle.make.trim() || draftVehicle.model.trim() || draftVehicle.unit_number.trim()
        if (hasVehicle) {
          const res = await requestJson('/api/shop/vehicles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...draftVehicle, customer_id: customerId }),
          })
          if (!res.ok) {
            setError(res.error)
            return
          }
          selectedVehicleId = readId(res.body, 'vehicle')
        } else {
          selectedVehicleId = null
        }
      }

      // 3. The job itself, always in `estimate`.
      const jobRes = await requestJson('/api/shop/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: customerId,
          vehicle_id: selectedVehicleId,
          complaint: complaint.trim(),
          estimated_hours: hours.trim() === '' ? null : Number(hours),
        }),
      })
      if (!jobRes.ok) {
        setError(jobRes.error)
        return
      }

      close()
      startTransition(() => router.refresh())
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button type="button" className="nwi-btn nwi-btn-primary" onClick={() => setOpen(true)}>
        + New job
      </button>
    )
  }

  const busy = saving || pending
  const vehicleRows = customer && vehicles.forCustomer === customer.id ? vehicles.rows : []

  return (
    <>
      <button type="button" className="nwi-btn nwi-btn-primary" onClick={() => setOpen(true)}>
        + New job
      </button>

      <div
        className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/60 p-4 sm:p-8"
        role="dialog"
        aria-modal="true"
        aria-label="New job"
      >
        <form
          onSubmit={submit}
          className="nwi-card w-full max-w-2xl shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <h2 className="text-lg font-bold text-slate-900">New job</h2>
            <button type="button" className="nwi-btn nwi-btn-secondary" onClick={close}>
              Cancel
            </button>
          </div>

          <div className="space-y-5 px-5 py-5">
            {/* ---- customer ---- */}
            <section>
              <div className="flex items-center justify-between">
                <span className="nwi-label">Customer</span>
                <button
                  type="button"
                  className="text-sm font-semibold text-slate-700 underline underline-offset-2"
                  onClick={() => {
                    setNewCustomerMode((v) => !v)
                    setCustomer(null)
                    setVehicleId('')
                  }}
                >
                  {newCustomerMode ? 'Search existing' : 'Add new customer'}
                </button>
              </div>

              {newCustomerMode ? (
                <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <input
                    className="nwi-input"
                    placeholder="First name"
                    value={draftCustomer.first_name}
                    onChange={(e) => setDraftCustomer({ ...draftCustomer, first_name: e.target.value })}
                  />
                  <input
                    className="nwi-input"
                    placeholder="Last name"
                    value={draftCustomer.last_name}
                    onChange={(e) => setDraftCustomer({ ...draftCustomer, last_name: e.target.value })}
                  />
                  <input
                    className="nwi-input sm:col-span-2"
                    placeholder="Company (optional)"
                    value={draftCustomer.company}
                    onChange={(e) => setDraftCustomer({ ...draftCustomer, company: e.target.value })}
                  />
                  <input
                    className="nwi-input"
                    placeholder="Phone"
                    value={draftCustomer.phone}
                    onChange={(e) => setDraftCustomer({ ...draftCustomer, phone: e.target.value })}
                  />
                  <input
                    className="nwi-input"
                    placeholder="Email"
                    value={draftCustomer.email}
                    onChange={(e) => setDraftCustomer({ ...draftCustomer, email: e.target.value })}
                  />
                </div>
              ) : customer ? (
                <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2.5">
                  <span className="truncate font-semibold text-slate-900">
                    {customerName(customer)}
                    {customer.phone ? (
                      <span className="ml-2 font-normal text-slate-600">{customer.phone}</span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    className="shrink-0 text-sm font-semibold text-slate-700 underline underline-offset-2"
                    onClick={() => {
                      setCustomer(null)
                      setVehicleId('')
                      setQuery('')
                    }}
                  >
                    Change
                  </button>
                </div>
              ) : (
                <div className="mt-2">
                  <input
                    className="nwi-input"
                    placeholder="Search name, company, or phone"
                    value={query}
                    autoFocus
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  {query.trim().length >= 2 && (
                    <ul className="mt-2 max-h-56 divide-y divide-slate-200 overflow-y-auto rounded-lg border border-slate-300">
                      {searching && results.length === 0 && (
                        <li className="px-3 py-2.5 text-sm text-slate-500">Searching...</li>
                      )}
                      {!searching && results.length === 0 && (
                        <li className="px-3 py-2.5 text-sm text-slate-500">
                          No match. Use &ldquo;Add new customer&rdquo;.
                        </li>
                      )}
                      {results.map((row) => (
                        <li key={row.id}>
                          <button
                            type="button"
                            className="block w-full px-3 py-2.5 text-left hover:bg-slate-100"
                            onClick={() => {
                              setCustomer(row)
                              setResults([])
                            }}
                          >
                            <span className="font-semibold text-slate-900">{customerName(row)}</span>
                            {row.phone && (
                              <span className="ml-2 text-sm text-slate-600">{row.phone}</span>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </section>

            {/* ---- vehicle ---- */}
            <section>
              <div className="flex items-center justify-between">
                <span className="nwi-label">Vehicle</span>
                {customer && vehicleRows.length > 0 && (
                  <button
                    type="button"
                    className="text-sm font-semibold text-slate-700 underline underline-offset-2"
                    onClick={() => setNewVehicleMode((v) => !v)}
                  >
                    {newVehicleMode ? 'Pick existing' : 'Add new vehicle'}
                  </button>
                )}
              </div>

              {!customer && !newCustomerMode ? (
                <p className="mt-2 text-sm text-slate-500">Pick a customer first.</p>
              ) : newVehicleMode || newCustomerMode ? (
                <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <input
                    className="nwi-input"
                    placeholder="Year"
                    inputMode="numeric"
                    value={draftVehicle.year}
                    onChange={(e) => setDraftVehicle({ ...draftVehicle, year: e.target.value })}
                  />
                  <input
                    className="nwi-input"
                    placeholder="Make"
                    value={draftVehicle.make}
                    onChange={(e) => setDraftVehicle({ ...draftVehicle, make: e.target.value })}
                  />
                  <input
                    className="nwi-input"
                    placeholder="Model"
                    value={draftVehicle.model}
                    onChange={(e) => setDraftVehicle({ ...draftVehicle, model: e.target.value })}
                  />
                  <input
                    className="nwi-input"
                    placeholder="Unit #"
                    value={draftVehicle.unit_number}
                    onChange={(e) => setDraftVehicle({ ...draftVehicle, unit_number: e.target.value })}
                  />
                  <input
                    className="nwi-input col-span-2 sm:col-span-4"
                    placeholder="VIN (optional)"
                    value={draftVehicle.vin}
                    onChange={(e) => setDraftVehicle({ ...draftVehicle, vin: e.target.value })}
                  />
                </div>
              ) : (
                <select
                  className="nwi-select mt-2"
                  value={vehicleId}
                  onChange={(e) => setVehicleId(e.target.value)}
                >
                  <option value="">No vehicle</option>
                  {vehicleRows.map((v) => (
                    <option key={v.id} value={v.id}>
                      {vehicleLabel(v)}
                    </option>
                  ))}
                </select>
              )}
            </section>

            {/* ---- the work ---- */}
            <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label className="nwi-label" htmlFor="new-job-complaint">
                  Complaint
                </label>
                <textarea
                  id="new-job-complaint"
                  className="nwi-input"
                  rows={3}
                  placeholder="What is it doing?"
                  value={complaint}
                  onChange={(e) => setComplaint(e.target.value)}
                />
              </div>
              <div>
                <label className="nwi-label" htmlFor="new-job-hours">
                  Estimated hours
                </label>
                <input
                  id="new-job-hours"
                  className="nwi-input"
                  inputMode="decimal"
                  placeholder="2.5"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                />
              </div>
            </section>

            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-800" role="alert">
                {error}
              </p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-4">
            <button type="button" className="nwi-btn nwi-btn-secondary" onClick={close} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="nwi-btn nwi-btn-primary" disabled={busy}>
              {busy ? 'Creating...' : 'Create job'}
            </button>
          </div>
        </form>
      </div>
    </>
  )
}
