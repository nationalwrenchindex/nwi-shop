// Row shapes for the two TorqueWrench tables (migration 009+).
//
// These deliberately live here rather than in @/lib/types: the tables are new
// and owned by this feature area, and lib/types.ts is the shared contract every
// other build area imports. If TorqueWrench becomes core, they move.

/**
 * Lifecycle of one review request.
 *   pending   enqueued, waiting for the send delay to elapse
 *   sent      SMS accepted by Twilio
 *   skipped   deliberately not sent (opted out, no phone, feature off)
 *   failed    three send attempts, all rejected
 *   rated     the customer replied with a star rating
 *   recovery  a low rating routed to the shop instead of Google
 */
export type ReviewRequestStatus =
  | 'pending'
  | 'sent'
  | 'skipped'
  | 'failed'
  | 'rated'
  | 'recovery'

export const REVIEW_STATUS_LABELS: Record<ReviewRequestStatus, string> = {
  pending:  'Waiting to send',
  sent:     'Sent',
  skipped:  'Skipped',
  failed:   'Failed',
  rated:    'Rated',
  recovery: 'Service recovery',
}

/** Tailwind classes for the status pill, matching the job-board palette. */
export const REVIEW_STATUS_PILL: Record<ReviewRequestStatus, string> = {
  pending:  'bg-slate-200 text-slate-800 ring-slate-300',
  sent:     'bg-sky-100 text-sky-900 ring-sky-300',
  skipped:  'bg-slate-100 text-slate-600 ring-slate-300',
  failed:   'bg-rose-100 text-rose-900 ring-rose-300',
  rated:    'bg-emerald-100 text-emerald-900 ring-emerald-400',
  recovery: 'bg-amber-200 text-amber-950 ring-amber-500',
}

export interface ShopReviewRequest {
  id:                         string
  shop_id:                    string
  /** Unique in the database — a job can never be double-enqueued. */
  job_id:                     string
  customer_id:                string | null
  phone:                      string | null
  status:                     ReviewRequestStatus
  send_attempted_at:          string | null
  send_attempts:              number
  sent_at:                    string | null
  clicked_at:                 string | null
  rating:                     number | null
  rated_at:                   string | null
  service_recovery_triggered: boolean
  /** Random, unguessable. This is what /r/[token] looks up. */
  token:                      string
  error:                      string | null
  created_at:                 string
}

export interface ShopReviewSettings {
  shop_id:                string
  is_enabled:             boolean
  google_place_id:        string | null
  service_recovery_phone: string | null
  delay_minutes:          number
  message_template:       string | null
  updated_at:             string | null
}

/** What the settings form posts and what GET returns — no shop_id round trip. */
export interface ReviewSettingsInput {
  is_enabled:             boolean
  google_place_id:        string | null
  service_recovery_phone: string | null
  delay_minutes:          number
  message_template:       string | null
}

export const DEFAULT_DELAY_MINUTES = 60

/** Bounds for delay_minutes. Zero is allowed: some shops want it immediate. */
export const MIN_DELAY_MINUTES = 0
export const MAX_DELAY_MINUTES = 10_080 // one week

export function defaultReviewSettings(shopId: string): ShopReviewSettings {
  return {
    shop_id:                shopId,
    is_enabled:             false,
    google_place_id:        null,
    service_recovery_phone: null,
    delay_minutes:          DEFAULT_DELAY_MINUTES,
    message_template:       null,
    updated_at:             null,
  }
}

/** One row as the dashboard sees it — joined with the job and customer names. */
export interface ReviewRequestRow {
  id:            string
  job_id:        string
  job_number:    number | null
  customer_name: string
  phone:         string | null
  status:        ReviewRequestStatus
  created_at:    string
  sent_at:       string | null
  clicked_at:    string | null
  rating:        number | null
  error:         string | null
}
