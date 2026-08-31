// One place to describe the six diagnostic tools, so the Diagnostics index and
// each tool page cannot drift apart. Keyed by ShopFeature, which means adding a
// feature to lib/permissions.ts makes TypeScript demand copy for it here.
//
// Copy only — this file holds no diagnostic data and never should. See the
// warning at the top of tool-placeholder.tsx.

import type { ShopFeature } from '@/lib/permissions'

export interface ToolCopy {
  /** One line on what the tool is for. Shown on the index and as the page subtitle. */
  description: string
  /** What the tool will do once it ships, in plain shop language. */
  planned: string[]
}

export const TOOL_COPY: Record<ShopFeature, ToolCopy> = {
  quickwrench_ld: {
    description: 'Guided diagnostics for cars and light trucks.',
    planned: [
      'Look up an OBD-II code and see what it actually means on this vehicle',
      'Work a symptom down to a likely cause with a guided question flow',
      'Follow the test steps in order, with the readings that rule each cause in or out',
      'Attach what you found to the open job so it lands on the invoice',
    ],
  },
  quickwrench_hd: {
    description: 'Guided diagnostics for Class 6-8 trucks and heavy equipment.',
    planned: [
      'Look up a J1939 or J1587 fault by SPN and FMI and see what the ECU is reporting',
      'Work a symptom down to a likely cause with a guided question flow',
      'Follow the test steps in order, with the readings that rule each cause in or out',
      'Attach what you found to the open job so it lands on the invoice',
    ],
  },
  reefer_alarm_codes: {
    description: 'Alarm code reference for transport refrigeration units.',
    planned: [
      'Look up an alarm code by unit make and model instead of digging for the manual',
      'See what the unit is protecting against and whether the load is at risk',
      'See whether the alarm shuts the unit down, or only logs and keeps running',
      'Attach the alarm and what you did about it to the open job',
    ],
  },
  trailer_abs: {
    description: 'Fault and blink-code reference for trailer ABS systems.',
    planned: [
      'Read a trailer ABS blink code without hunting for the right manufacturer chart',
      'Identify which wheel sensor or modulator the fault points at',
      'Follow the checks for that fault in order, sensor gap through wiring',
      'Attach the fault and the repair to the open job',
    ],
  },
  epa_608: {
    description: 'Refrigerant handling records for EPA Section 608 recordkeeping.',
    planned: [
      'Log refrigerant recovered, charged and reclaimed against the job and the unit',
      'Keep the record tied to the certified tech who did the work',
      'Track cylinder amounts on hand so the log and the shelf agree',
      'Export the log when it is asked for',
    ],
  },
  dot_inspections: {
    description: 'Annual DOT inspection workflow for trucks and trailers.',
    planned: [
      'Work the annual inspection as a checklist instead of loose paper',
      'Record the inspector, the date and the unit on every completed inspection',
      'Flag anything that would place the unit out of service before it leaves',
      'Keep completed inspections on file and pull one back up on request',
    ],
  },
}
