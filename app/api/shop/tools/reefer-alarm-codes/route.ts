// GET /api/shop/tools/reefer-alarm-codes — merged reefer alarm lookup.
//
// Gated by apiFeature('reefer_alarm_codes'): heavy-duty or full-service shop, Pro
// tier or better. Read-only; it never writes to the shared hd_* catalogs.
//
// QUERY
//   ?code=18            alarm code. "02", "2", "AL 02" and "p141" all normalize.
//   ?manufacturer=TK    TK | Carrier (also accepts "Thermo King" / "Carrier Transicold")
//   ?q=low oil          free text over code, description, meaning, causes, fix, notes
//   ?limit=25           1-400, default 50
//
// RESPONSE 200 — STABLE SHAPE. QuickWrench HD calls this route; treat it as a
// contract and add fields rather than renaming them.
//   {
//     results: [{
//       code:            string          // "18"
//       manufacturer:    "TK" | "Carrier"
//       group:           "tk" | "tk_dsr" | "carrier" | "carrier_pretrip"
//       groupLabel:      string
//       description:     string
//       severity:        "immediate_action" | "check_specified" | "ok_to_run"
//       severityLabel:   string
//       operatorAction:  string | null    // manufacturer text; null on curated-only rows
//       source:          "catalog" | "catalog+curated" | "curated"
//       unitFamily, displayText, meaning, commonCauses, diagnosticSteps,
//       fieldNotes, commonFix, partsNeeded, safetyWarning,
//       wiringReference:  string | null
//       shorePowerWarning: boolean
//       bookTime, mobileTime: number | null   // hours
//     }],
//     total:      number   // matches before limit
//     degraded:   boolean  // true => curated hd_alarm_codes read failed; catalog only
//     disclaimer: string   // TK 40933-8-CH Rev 15 notice — display it
//   }
//
// ERRORS  401 unauthenticated · 403 { error } wrong shop type or tier.
// `degraded: true` is NOT an error: the compile-time catalog still answered.

import { apiFeature } from '@/lib/auth'
import { lookupAlarms } from '@/lib/shop/reefer/lookup'

export async function GET(request: Request) {
  const { error } = await apiFeature('reefer_alarm_codes')
  if (error) return error

  const params = new URL(request.url).searchParams
  const limit = Number(params.get('limit'))

  const result = await lookupAlarms({
    code:         params.get('code'),
    manufacturer: params.get('manufacturer'),
    q:            params.get('q'),
    limit:        Number.isFinite(limit) && limit > 0 ? limit : undefined,
  })

  return Response.json(result)
}
