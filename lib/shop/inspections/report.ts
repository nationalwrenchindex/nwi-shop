// The printable inspection report.
//
// A self-contained HTML document served as text/html with a print button, which
// the browser turns into a PDF. NWI Suite generates its DOT certificate exactly
// this way and it is the right call: no PDF library, no font embedding, no second
// rendering path to keep in sync with the on-screen record. The @media print
// block below is what makes it a document rather than a web page.
//
// EVERY interpolation goes through esc(). Half of what is printed here is text a
// tech typed into a notes field on a tablet, and it lands inside an HTML
// document that a customer opens.

import { AERIAL_CADENCE_LABELS } from './aerial-forms'
import { answersFromRecords, sectionVerdict } from './result'
import type { InspectionFormDef, ItemVerdict, ShopInspection } from './types'

/** Context resolved alongside the row, so the document reads without any joins of its own. */
export interface ReportContext {
  businessName:  string
  vehicleLabel:  string | null
  customerLabel: string | null
  jobNumber:     number | null
}

/** Operator-entered text landing in an HTML document. Nothing skips this. */
export function esc(value: unknown): string {
  if (value == null) return ''
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function str(value: unknown): string | null {
  const s = value == null ? '' : String(value).trim()
  return s.length ? s : null
}

/** Noon avoids the timezone slip that turns a date into yesterday. */
function fmtDay(value: unknown): string {
  const s = str(value)
  if (!s) return '—'
  const d = new Date(`${s.slice(0, 10)}T12:00:00`)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  })
}

function fmtStamp(value: unknown): string | null {
  const s = str(value)
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString('en-US')
}

const VERDICT_CLASS: Record<ItemVerdict, string> = { pass: 'r-pass', fail: 'r-fail', na: 'r-na' }
const VERDICT_LABEL: Record<ItemVerdict, string> = { pass: 'PASS', fail: 'FAIL', na: 'N/A' }

export function reportDocumentId(inspection: ShopInspection): string {
  const prefix = inspection.type === 'dot' ? 'DOT' : 'AER'
  const day = String(inspection.signed_at ?? inspection.created_at).slice(0, 10).replace(/-/g, '')
  return `${prefix}-${day}-${inspection.id.slice(0, 8).toUpperCase()}`
}

export function renderInspectionReport(
  inspection: ShopInspection,
  def: InspectionFormDef,
  context: ReportContext,
): string {
  const answers = answersFromRecords(inspection.items ?? [])
  const deficiencies = inspection.deficiencies ?? []
  const passed = inspection.result !== 'fail'
  const docId = reportDocumentId(inspection)
  const signature = str(inspection.signature_data)
  const signedAt = fmtStamp(inspection.signed_at)
  const lockedAt = fmtStamp(inspection.locked_at)

  const facts: Array<{ label: string; value: string }> = [
    { label: 'Unit Number',     value: str(inspection.unit_number) ?? '—' },
    { label: 'Vehicle',         value: context.vehicleLabel ?? '—' },
    { label: 'Customer',        value: context.customerLabel ?? '—' },
    { label: 'Carrier',         value: str(inspection.carrier_name) ?? '—' },
    { label: 'Carrier Address', value: str(inspection.carrier_address) ?? '—' },
    { label: 'License Plate',   value: str(inspection.license_plate) ?? '—' },
    { label: 'Odometer / Hours', value: inspection.odometer == null ? '—' : String(inspection.odometer) },
    { label: 'Work Order',      value: context.jobNumber == null ? '—' : `#${context.jobNumber}` },
    { label: 'Inspection Date', value: fmtDay(inspection.signed_at ?? inspection.created_at) },
    { label: 'Document ID',     value: docId },
    { label: 'Inspector',       value: str(inspection.inspector_name) ?? '—' },
    {
      label: 'Cadence',
      value: inspection.cadence ? AERIAL_CADENCE_LABELS[inspection.cadence] : 'Annual / periodic',
    },
  ]

  const sectionRows = def.sections.map((section) => {
    const verdict = sectionVerdict(def, section.id, answers)
    const failed = section.items.filter((item) => answers[section.id]?.[item.id]?.result === 'fail')

    const failLines = failed.map((item) => {
      const note = answers[section.id]?.[item.id]?.notes
      return `
        <div class="fail-line">
          <span class="fail-mark">${item.safetyCritical ? '&#9888;' : '&#10007;'}</span>
          <span>${esc(item.label)}${note ? `<span class="fail-note">Note: ${esc(note)}</span>` : ''}</span>
        </div>`
    }).join('')

    return `
      <div class="sec${verdict === 'fail' ? ' sec-fail' : ''}">
        <div class="sec-head">
          <span class="sec-num">${section.num}</span>
          <span class="sec-label">${esc(section.label)}</span>
          <span class="badge ${VERDICT_CLASS[verdict]}">${VERDICT_LABEL[verdict]}</span>
        </div>
        ${failLines}
      </div>`
  }).join('')

  const deficiencyBlock = deficiencies.length
    ? `
  <div class="box box-fail">
    <h3>Deficiencies Found — ${deficiencies.length}</h3>
    ${deficiencies.map((d) => `
      <p class="viol">
        <strong>${esc(d.section_label)}</strong>${d.safety_critical ? ' <span class="critical">&#9888; SAFETY CRITICAL</span>' : ''}<br>
        ${esc(d.label)}${d.notes ? `<span class="viol-note">${esc(d.notes)}</span>` : ''}
      </p>`).join('')}
  </div>`
    : `
  <div class="box">
    <h3>Deficiencies</h3>
    <p class="muted">No deficiencies were recorded on this inspection.</p>
  </div>`

  const oosBlock = inspection.removed_from_service
    ? `
  <div class="box box-oos">
    <h3>Removed From Service</h3>
    <p class="oos-text">
      This unit was removed from service at the time of inspection. It may not be
      operated until the deficiencies above are repaired and it is re-inspected.
    </p>
  </div>`
    : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(def.title)} ${esc(docId)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #0f172a; background: #f1f5f9; }
  .page { background: #fff; max-width: 820px; margin: 24px auto; padding: 48px; box-shadow: 0 2px 12px rgba(15,23,42,0.12); }
  .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; margin-bottom: 24px; border-bottom: 3px solid #0f172a; padding-bottom: 18px; }
  .brand-name { font-size: 20px; font-weight: 800; letter-spacing: 1px; }
  .brand-sub { font-size: 11px; color: #64748b; margin-top: 3px; }
  .doc-meta { text-align: right; }
  .doc-title { font-size: 14px; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase; }
  .citation { font-size: 11px; color: #64748b; margin-top: 2px; }
  .doc-number { font-size: 18px; font-weight: 700; margin-top: 6px; }
  .doc-meta p { font-size: 11px; color: #475569; margin-top: 3px; }
  .requirement { font-size: 11px; color: #475569; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 12px; margin-bottom: 18px; }
  .result-strip { display: flex; align-items: center; gap: 14px; padding: 12px 16px; border-radius: 6px; margin-bottom: 18px; }
  .result-pass { background: #dcfce7; border: 2px solid rgba(22,163,74,0.35); }
  .result-fail { background: #fee2e2; border: 2px solid rgba(220,38,38,0.35); }
  .result-word { font-size: 28px; font-weight: 800; letter-spacing: 1px; }
  .result-pass .result-word { color: #15803d; }
  .result-fail .result-word { color: #b91c1c; }
  .result-note { font-size: 12px; color: #475569; }
  .info-box { border: 1px solid #e2e8f0; border-radius: 6px; margin-bottom: 18px; }
  .info-box h3, .box h3 { font-size: 11px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; color: #64748b; }
  .info-box h3 { background: #f8fafc; padding: 6px 12px; border-bottom: 1px solid #e2e8f0; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; }
  .fact { padding: 6px 12px; border-bottom: 1px solid #f1f5f9; border-right: 1px solid #f1f5f9; }
  .fact-label { font-size: 8px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }
  .fact-value { font-size: 11px; font-weight: 600; margin-top: 2px; word-break: break-word; }
  .sec { border-bottom: 1px solid #f1f5f9; }
  .sec-fail { background: #fff7f7; }
  .sec-head { display: flex; align-items: center; gap: 8px; padding: 5px 12px; }
  .sec-num { font-size: 9px; color: #94a3b8; width: 18px; text-align: right; flex-shrink: 0; }
  .sec-label { flex: 1; font-size: 11px; }
  .badge { font-size: 9px; font-weight: 700; padding: 2px 8px; border-radius: 9px; }
  .r-pass { background: #dcfce7; color: #15803d; }
  .r-fail { background: #fee2e2; color: #b91c1c; }
  .r-na   { background: #f1f5f9; color: #64748b; }
  .fail-line { display: flex; gap: 6px; margin-left: 38px; padding: 0 12px 5px 0; font-size: 10px; color: #b91c1c; }
  .fail-mark { flex-shrink: 0; }
  .fail-note { display: block; font-size: 9px; color: #7f1d1d; margin-top: 1px; }
  .box { margin-bottom: 18px; padding: 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; }
  .box-fail { background: #fff5f5; border-color: #fecaca; }
  .box-oos { background: #fffbeb; border-color: #fde68a; }
  .oos-text { font-size: 12px; color: #92400e; margin-top: 6px; line-height: 1.5; }
  .box h3 { margin-bottom: 6px; }
  .viol { font-size: 12px; color: #334155; line-height: 1.5; margin-bottom: 8px; }
  .viol-note { display: block; color: #b91c1c; font-size: 11px; margin-top: 2px; }
  .critical { color: #b45309; font-weight: 700; font-size: 10px; }
  .muted { font-size: 12px; color: #64748b; }
  .sign-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 18px; }
  .sign-box { border: 1px solid #e2e8f0; border-radius: 6px; }
  .sign-box h3 { background: #f8fafc; padding: 6px 12px; border-bottom: 1px solid #e2e8f0; font-size: 11px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; color: #64748b; }
  .sign-body { padding: 12px; }
  .sign-label { font-size: 8px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px; }
  .sign-value { font-size: 12px; font-weight: 700; margin-bottom: 8px; }
  .sign-img { max-height: 84px; max-width: 100%; }
  .attest { margin-top: 10px; font-size: 9px; color: #64748b; line-height: 1.45; }
  .footer { margin-top: 26px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 14px; }
  .no-print { text-align: center; margin: 24px 0; }
  .print-btn { background: #0f172a; color: #fff; border: none; padding: 10px 28px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; }
  @media print {
    body { background: #fff; }
    .page { margin: 0; padding: 32px; box-shadow: none; max-width: 100%; }
    .no-print { display: none !important; }
    img { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .sec, .box, .sign-grid { break-inside: avoid; }
  }
</style>
</head>
<body>
<div class="no-print">
  <button class="print-btn" onclick="window.print()">Download / Print PDF</button>
</div>
<div class="page">
  <div class="header">
    <div>
      <div class="brand-name">${esc(context.businessName)}</div>
      <div class="brand-sub">NWI Shop &bull; Compliance Record</div>
    </div>
    <div class="doc-meta">
      <div class="doc-title">${esc(def.title)}</div>
      <div class="citation">${esc(def.citation)}</div>
      <div class="doc-number">${esc(docId)}</div>
      <p>Signed: ${esc(signedAt ?? '—')}</p>
      <p>Record locked: ${esc(lockedAt ?? '—')}</p>
    </div>
  </div>

  <p class="requirement">${esc(def.requirement)}</p>

  <div class="result-strip ${passed ? 'result-pass' : 'result-fail'}">
    <span class="result-word">${passed ? 'PASS' : 'FAIL'}</span>
    <span class="result-note">
      ${deficiencies.length
        ? `${deficiencies.length} deficienc${deficiencies.length === 1 ? 'y' : 'ies'} recorded`
        : 'No deficiencies recorded'}
    </span>
  </div>

  <div class="info-box">
    <h3>Unit &amp; Inspection Information</h3>
    <div class="info-grid">
      ${facts.map((f) => `
      <div class="fact">
        <div class="fact-label">${esc(f.label)}</div>
        <div class="fact-value">${esc(f.value)}</div>
      </div>`).join('')}
    </div>
  </div>

  <div class="info-box">
    <h3>Checklist Results — ${def.sections.length} Sections</h3>
    ${sectionRows}
  </div>

  ${oosBlock}
  ${deficiencyBlock}

  <div class="sign-grid">
    <div class="sign-box">
      <h3>Inspector Certification</h3>
      <div class="sign-body">
        <div class="sign-label">Name</div>
        <div class="sign-value">${esc(str(inspection.inspector_name) ?? '—')}</div>
        <div class="sign-label">Certification #</div>
        <div class="sign-value">${esc(str(inspection.inspector_cert_number) ?? '—')}</div>
        <div class="attest">${esc(attestation(def))}</div>
      </div>
    </div>
    <div class="sign-box">
      <h3>Signature</h3>
      <div class="sign-body">
        ${signature
          ? `<img class="sign-img" src="${esc(signature)}" alt="Inspector signature">
             <div class="attest">Electronically signed${signedAt ? ` ${esc(signedAt)}` : ''}.</div>`
          : `<div class="attest">No signature is stored on this record.</div>`}
      </div>
    </div>
  </div>

  <div class="footer">
    <p>${esc(docId)} &bull; Generated ${esc(fmtStamp(new Date().toISOString()) ?? '')} &bull; NWI Shop</p>
  </div>
</div>
</body>
</html>`
}

function attestation(def: InspectionFormDef): string {
  return def.type === 'dot'
    ? 'I certify that this vehicle has been inspected in accordance with 49 CFR 396.17 and Appendix A to Part 396, and that I am a qualified inspector as defined by 49 CFR 396.19.'
    : 'I certify that this aerial device has been inspected in accordance with OSHA 29 CFR 1926.453 and the applicable ANSI/SAIA A92 standard, and that I am qualified to perform this inspection.'
}
