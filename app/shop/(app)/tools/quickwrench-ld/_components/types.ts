// Shapes passed from the QuickWrench LD page (Server Component) into the
// client workspace, plus the small request/response envelopes the client uses.

import type { JobStatus } from '@/lib/types'

/** The vehicle the whole workspace is pointed at. Free-text on purpose: a tech
 *  may type a year/make/model the VIN decoder never saw. */
export interface WorkVehicle {
  vin:    string
  year:   string
  make:   string
  model:  string
  engine: string
  trim:   string
}

export const EMPTY_VEHICLE: WorkVehicle = {
  vin: '', year: '', make: '', model: '', engine: '', trim: '',
}

export function vehicleIsIdentified(v: WorkVehicle): boolean {
  return v.year !== '' && v.make !== '' && v.model !== ''
}

/** An open job the diagnostic can be attached to. */
export interface JobOption {
  id:          string
  job_number:  number
  status:      JobStatus
  /** Complaint or description, already trimmed for the picker. */
  summary:     string
  notes:       string | null
  vehicle:     WorkVehicle | null
}

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  estimate:    'Estimate',
  approved:    'Approved',
  in_progress: 'In progress',
  completed:   'Completed',
  invoiced:    'Invoiced',
}
