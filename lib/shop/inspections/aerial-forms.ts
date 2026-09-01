// The three aerial-device inspection cadences, ported from the National Wrench
// Index platform. Eight sections are common to all three; frequent appends one
// and annual appends two more, so a change to a shared item lands in all three
// by construction rather than by three people remembering to make the same edit.
//
// The safetyCritical flag marks the items that put a machine out of service on
// failure: structural, control, fall-protection and stability defects. A leaking
// hose or an illegible decal is a deficiency; a cracked weld or a dead emergency
// stop is a machine nobody may operate.

import type { AerialCadence, InspectionFormDef, InspectionSection } from './types'

export const PRE_USE_SECTIONS: InspectionSection[] = [
  {
    id: 'documentation', num: 1, label: 'Pre-Inspection Documentation',
    items: [
      { id: 'annual_current',     label: 'Annual inspection current (within 13 months)', safetyCritical: true },
      { id: 'frequent_current',   label: 'Frequent inspection current (within 3 months or 150 hours)', safetyCritical: true },
      { id: 'manual_present',     label: 'Operator manual present in weather-resistant storage' },
      { id: 'capacity_legible',   label: 'Load capacity chart present and legible' },
      { id: 'previous_reviewed',  label: 'Previous inspection report reviewed' },
    ],
  },
  {
    id: 'structural', num: 2, label: 'Structural Integrity',
    items: [
      { id: 'no_weld_cracks',     label: 'No cracks in welds or structural members', safetyCritical: true },
      { id: 'no_bent_members',    label: 'No bent or damaged boom, arms, turntable or chassis', safetyCritical: true },
      { id: 'no_corrosion',       label: 'No corrosion affecting structural members', safetyCritical: true },
      { id: 'decals_legible',     label: 'Safety decals and placards present and legible' },
    ],
  },
  {
    id: 'hydraulic', num: 3, label: 'Hydraulic and Mechanical Systems',
    items: [
      { id: 'no_hyd_leaks',       label: 'No hydraulic leaks at hoses, fittings or cylinders', safetyCritical: true },
      { id: 'hyd_fluid_level',    label: 'Hydraulic fluid level adequate' },
      { id: 'fuel_battery_level', label: 'Fuel or battery charge level adequate' },
      { id: 'no_foreign_objects', label: 'No foreign objects around base or moving parts' },
    ],
  },
  {
    id: 'controls', num: 4, label: 'Controls and Safety Devices',
    items: [
      { id: 'upper_controls',     label: 'Upper (platform) controls functional', safetyCritical: true },
      { id: 'lower_controls',     label: 'Lower (ground) controls functional', safetyCritical: true },
      { id: 'emergency_stop',     label: 'Emergency stop functional', safetyCritical: true },
      { id: 'limit_switches',     label: 'Limit switches functional', safetyCritical: true },
      { id: 'tilt_alarm',         label: 'Tilt alarm functional', safetyCritical: true },
      { id: 'overload_sensor',    label: 'Overload sensor functional', safetyCritical: true },
      { id: 'horn',               label: 'Horn functional' },
    ],
  },
  {
    id: 'outriggers', num: 5, label: 'Outriggers and Ground Conditions',
    items: [
      { id: 'outriggers_deploy',  label: 'Outriggers deploy and lock correctly', safetyCritical: true },
      { id: 'ground_stable',      label: 'Ground surface adequate and stable', safetyCritical: true },
      { id: 'clear_overhead',     label: 'Area clear of overhead hazards (power lines, structures)', safetyCritical: true },
      { id: 'clear_ground',       label: 'Area clear of ground hazards (holes, debris, drop-offs)', safetyCritical: true },
    ],
  },
  {
    id: 'platform', num: 6, label: 'Platform and Fall Protection',
    items: [
      { id: 'guardrails',         label: 'Guardrails present and undamaged', safetyCritical: true },
      { id: 'entry_gate',         label: 'Entry gate self-closes and latches', safetyCritical: true },
      { id: 'anchor_point',       label: 'Fall arrest anchor point present and rated', safetyCritical: true },
      { id: 'platform_floor',     label: 'Platform floor clean, non-slip and undamaged' },
    ],
  },
  {
    id: 'drive', num: 7, label: 'Drive and Stability',
    items: [
      { id: 'tires',              label: 'Tires inflated and undamaged', safetyCritical: true },
      { id: 'wheels_rims',        label: 'Wheels and rims intact, lugs tight', safetyCritical: true },
      { id: 'brakes',             label: 'Brakes functional', safetyCritical: true },
      { id: 'boom_cradled',       label: 'Boom properly cradled for travel' },
      { id: 'outriggers_stowed',  label: 'Outriggers stowed for travel' },
    ],
  },
  {
    id: 'signoff', num: 8, label: 'Sign-Off',
    items: [
      { id: 'overall_determination', label: 'Overall pass/fail determination made', safetyCritical: true },
      { id: 'deficiencies_noted',    label: 'All deficiencies described in notes' },
      { id: 'removal_assessed',      label: 'Removal from service assessed for any critical deficiency', safetyCritical: true },
      { id: 'inspector_identified',  label: 'Inspector identified and signature captured' },
      { id: 'datetime_recorded',     label: 'Date and time of inspection recorded' },
    ],
  },
]

/** Additional checks for the 3-month / 150-hour frequent inspection (ANSI A92). */
export const FREQUENT_SECTIONS: InspectionSection[] = [
  {
    id: 'frequent_functional', num: 9, label: 'Frequent — Functional and Component Tests',
    items: [
      { id: 'functions_speed',    label: 'All functions tested for speed, smoothness and limits of motion', safetyCritical: true },
      { id: 'lower_override',     label: 'Lower control override test performed', safetyCritical: true },
      { id: 'hyd_pressure',       label: 'Hydraulic pressure checked against specification', safetyCritical: true },
      { id: 'wear_pads',          label: 'Boom wear pads inspected for wear within tolerance' },
      { id: 'cylinders',          label: 'Cylinders inspected for scoring, drift and seal condition', safetyCritical: true },
      { id: 'weld_inspection',    label: 'Structural welds inspected', safetyCritical: true },
      { id: 'electrical_insulation', label: 'Electrical insulation and wiring integrity checked', safetyCritical: true },
      { id: 'load_test_documented',  label: 'Load test performed and documented', safetyCritical: true },
    ],
  },
]

/** Additional checks for the 13-month annual machine inspection (ANSI A92.20). */
export const ANNUAL_SECTIONS: InspectionSection[] = [
  {
    id: 'annual_certification', num: 10, label: 'Annual — Load Test and Certification',
    items: [
      { id: 'load_test_rated',    label: 'Load test performed on platform at rated capacity', safetyCritical: true },
      { id: 'wear_pad_replacement', label: 'Boom wear pad replacement documented' },
      { id: 'hyd_pressure_spec',  label: 'Hydraulic pressure verified against manufacturer specification', safetyCritical: true },
      { id: 'ansi_decal_audit',   label: 'ANSI decal audit completed — all required decals present and legible' },
      { id: 'structural_signoff', label: 'Full structural integrity sign-off by qualified inspector', safetyCritical: true },
    ],
  },
]

export const PRE_USE_FORM: InspectionFormDef = {
  type:     'aerial',
  cadence:  'pre_use',
  title:    'Aerial Pre-Use Inspection',
  citation: 'OSHA 29 CFR 1926.453 · ANSI/SAIA A92.22',
  requirement: 'Required daily, before every shift, by the operator.',
  requiresInspectorCert: false,
  sections: PRE_USE_SECTIONS,
}

export const FREQUENT_FORM: InspectionFormDef = {
  type:     'aerial',
  cadence:  'frequent',
  title:    'Aerial Frequent Inspection',
  citation: 'ANSI/SAIA A92',
  requirement:
    'Required every 3 months or 150 hours of operation, whichever comes first. ' +
    'Must be performed by a qualified mechanic.',
  requiresInspectorCert: false,
  sections: [...PRE_USE_SECTIONS, ...FREQUENT_SECTIONS],
}

export const ANNUAL_FORM: InspectionFormDef = {
  type:     'aerial',
  cadence:  'annual',
  title:    'Aerial Annual Machine Inspection',
  citation: 'ANSI/SAIA A92.20',
  requirement:
    'Required every 13 months. Must be performed by a qualified person; the ' +
    'inspector licence or certification number is required.',
  requiresInspectorCert: true,
  sections: [...PRE_USE_SECTIONS, ...FREQUENT_SECTIONS, ...ANNUAL_SECTIONS],
}

export const AERIAL_FORMS: Record<AerialCadence, InspectionFormDef> = {
  pre_use:  PRE_USE_FORM,
  frequent: FREQUENT_FORM,
  annual:   ANNUAL_FORM,
}

export const AERIAL_CADENCE_LABELS: Record<AerialCadence, string> = {
  pre_use:  'Pre-Use',
  frequent: 'Frequent',
  annual:   'Annual',
}

/**
 * How long each cadence stays valid, for the overdue flag on the list. Frequent
 * also carries a 150-hour limit, which the hour-meter item covers separately —
 * whichever comes first.
 */
export const AERIAL_INTERVAL_DAYS: Record<AerialCadence, number> = {
  pre_use:  1,
  frequent: 90,
  annual:   396, // 13 months
}

export const FREQUENT_INTERVAL_HOURS = 150
