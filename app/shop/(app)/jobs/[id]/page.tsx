import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { requireShop } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import {
  customerName,
  loadJobDetail,
  money,
  summarizeLineItems,
  toLineItemView,
  toTechOption,
  vehicleLabel,
  JOB_STATUS_ORDER,
  JOB_STATUS_LABELS,
} from '@/lib/shop/jobs'
import type { ShopBay, ShopTech } from '@/lib/types'
import AddLaborForm from '../_components/add-labor-form'
import AdvanceButton from '../_components/advance-button'
import AssignControls from '../_components/assign-controls'
import Elapsed from '../_components/elapsed'
import LineItemsTable from '../_components/line-items-table'
import NotesEditor from '../_components/notes-editor'
import StatusPill from '../_components/status-pill'

export const metadata: Metadata = { title: 'Job' }

function formatDate(value: string | null): string {
  if (!value) return '--'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime())
    ? '--'
    : parsed.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
}

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireShop()
  const supabase = await createClient()

  const canDispatch = ctx.permissions.viewAllJobs
  const detail = await loadJobDetail(supabase, id, {
    shopId: ctx.shop.id,
    techId: canDispatch ? null : ctx.tech.id,
  })
  // A tech asking for someone else's job gets the same 404 as a job that does
  // not exist - the scoping is in the query, not in this branch.
  if (!detail) notFound()

  const { job, customer, vehicle, bay, tech } = detail

  // The single most important redaction in this area: cost and margin are
  // removed here, on the server, before anything renders.
  const showMargins = ctx.permissions.viewMargins
  const lineItems = detail.lineItems.map((row) => toLineItemView(row, showMargins))
  const labor = lineItems.filter((item) => item.type === 'labor')
  const parts = lineItems.filter((item) => item.type === 'part')
  const totals = summarizeLineItems(lineItems, ctx.shop.tax_rate, showMargins)

  // Assignment needs every bay the job could move into. Only fetched for a role
  // that is allowed to dispatch.
  let bays: ShopBay[] = []
  let techs: ShopTech[] = []
  if (canDispatch) {
    const [bayRes, techRes] = await Promise.all([
      supabase
        .from('shop_bays')
        .select('*')
        .eq('shop_id', ctx.shop.id)
        .order('sort_order', { ascending: true })
        .returns<ShopBay[]>(),
      supabase
        .from('shop_techs')
        .select('*')
        .eq('shop_id', ctx.shop.id)
        .eq('active', true)
        .order('first_name', { ascending: true })
        .returns<ShopTech[]>(),
    ])
    bays = bayRes.data ?? []
    techs = techRes.data ?? []
  }

  const statusIndex = JOB_STATUS_ORDER.indexOf(job.status)

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <Link
        href="/shop/jobs"
        className="inline-block text-sm font-semibold text-slate-600 underline-offset-4 hover:underline"
      >
        &larr; Back to the board
      </Link>

      {/* ---- header ---- */}
      <header className="nwi-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-mono text-3xl font-black tracking-tight text-slate-900">
                #{job.job_number}
              </h1>
              <StatusPill status={job.status} size="lg" />
              {job.voided && (
                <span className="rounded-full bg-red-100 px-3 py-1 text-sm font-bold uppercase text-red-800">
                  Voided
                </span>
              )}
            </div>
            <p className="mt-2 text-lg font-semibold text-slate-900">{customerName(customer)}</p>
            <p className="text-sm text-slate-600">{vehicleLabel(vehicle)}</p>
          </div>

          {canDispatch && !job.voided && (
            <AdvanceButton
              jobId={job.id}
              job={{
                status:           job.status,
                bay_id:           job.bay_id,
                assigned_tech_id: job.assigned_tech_id,
                voided:           job.voided,
              }}
            />
          )}
        </div>

        {/* status flow rail */}
        <ol className="mt-4 flex flex-wrap gap-1.5">
          {JOB_STATUS_ORDER.map((status, index) => (
            <li
              key={status}
              className={`rounded px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${
                index <= statusIndex
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-400'
              }`}
            >
              {JOB_STATUS_LABELS[status]}
            </li>
          ))}
        </ol>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <LineItemsTable
            title={`Labor · ${totals.laborHours} hrs`}
            items={labor}
            quantityLabel="Hours"
            showMargins={showMargins}
          />

          {/* Parts arrive through the inventory "use part" flow; labor has no
              other writer, so billing hours depends on this form. */}
          {canDispatch && !job.voided && job.status !== 'invoiced' && (
            <AddLaborForm
              jobId={job.id}
              techs={techs.map(toTechOption)}
              defaultTechId={job.assigned_tech_id}
              laborRate={ctx.shop.labor_rate}
              canSetRate={showMargins}
            />
          )}

          <LineItemsTable
            title="Parts"
            items={parts}
            quantityLabel="Qty"
            showMargins={showMargins}
          />

          <section className="nwi-card p-4 sm:p-5">
            <NotesEditor jobId={job.id} initialNotes={job.notes} />
          </section>
        </div>

        {/* ---- right rail ---- */}
        <div className="space-y-6">
          <section className="nwi-card p-4 sm:p-5">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">Assignment</h3>
            {canDispatch && !job.voided ? (
              <div className="mt-3">
                <AssignControls
                  jobId={job.id}
                  bays={bays}
                  techs={techs.map(toTechOption)}
                  currentBayId={job.bay_id}
                  currentTechId={job.assigned_tech_id}
                />
              </div>
            ) : (
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Bay</dt>
                  <dd className="font-semibold text-slate-900">{bay?.label ?? 'Unassigned'}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500">Tech</dt>
                  <dd className="font-semibold text-slate-900">
                    {tech ? `${tech.first_name} ${tech.last_name}` : 'Unassigned'}
                  </dd>
                </div>
              </dl>
            )}
            {job.bay_assigned_at && (
              <p className="mt-3 flex items-baseline justify-between gap-3 border-t border-slate-200 pt-3 text-sm">
                <span className="text-slate-500">In bay {bay?.label ?? ''}</span>
                <Elapsed
                  since={job.bay_assigned_at}
                  className="font-mono text-lg font-bold text-slate-900 tabular-nums"
                />
              </p>
            )}
          </section>

          <section className="nwi-card p-4 sm:p-5">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">Totals</h3>
            <dl className="mt-3 space-y-2 text-sm">
              <Row label={`Labor (${totals.laborHours} hrs)`} value={money(totals.laborTotal)} />
              <Row label="Parts" value={money(totals.partsTotal)} />
              <Row label="Subtotal" value={money(totals.subtotal)} />
              <Row label="Tax" value={money(totals.tax)} />
              <div className="flex justify-between gap-3 border-t border-slate-200 pt-2 text-base font-bold text-slate-900">
                <dt>Total</dt>
                <dd className="font-mono tabular-nums">{money(totals.total)}</dd>
              </div>
              {/* Cost and margin are only ever present for a role with viewMargins. */}
              {totals.margin !== undefined && (
                <div className="mt-2 space-y-2 border-t border-slate-200 pt-2">
                  <Row label="Cost" value={money(totals.costTotal ?? 0)} />
                  <Row
                    label="Margin"
                    value={`${money(totals.margin)} (${totals.marginPct ?? 0}%)`}
                  />
                </div>
              )}
            </dl>
          </section>

          <section className="nwi-card p-4 sm:p-5">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">Job</h3>
            <dl className="mt-3 space-y-2 text-sm">
              <Row label="Opened" value={formatDate(job.created_at)} />
              <Row label="In bay since" value={formatDate(job.bay_assigned_at)} />
              <Row label="Completed" value={formatDate(job.completed_at)} />
              <Row label="Invoiced" value={formatDate(job.invoiced_at)} />
              <Row
                label="Estimated"
                value={job.estimated_hours === null ? '--' : `${job.estimated_hours} hrs`}
              />
            </dl>
          </section>

          {(job.complaint || job.description) && (
            <section className="nwi-card p-4 sm:p-5">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">
                Complaint
              </h3>
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-800">
                {job.complaint || job.description}
              </p>
            </section>
          )}

          {customer && (
            <section className="nwi-card p-4 sm:p-5">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">Contact</h3>
              <dl className="mt-3 space-y-2 text-sm">
                <Row label="Phone" value={customer.phone ?? '--'} />
                <Row label="Email" value={customer.email ?? '--'} />
                {vehicle?.vin && <Row label="VIN" value={vehicle.vin} />}
                {vehicle?.mileage !== null && vehicle?.mileage !== undefined && (
                  <Row label="Mileage" value={vehicle.mileage.toLocaleString('en-US')} />
                )}
              </dl>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-mono tabular-nums text-slate-900">{value}</dd>
    </div>
  )
}
