// Offline SAE J1939 fault-code reference. Client-safe (no imports, no I/O).
//
// The FMI table and the common-SPN table are lifted verbatim from the
// "J1939 SPN FMI FAULT CODE INTERPRETATION" section of NWI Suite's truck
// diagnostic prompt (src/lib/hd/truck-diagnostic.ts). Holding them as data
// rather than only as prompt text means the fault-code panel decodes a code
// with NO API key of any kind — the tech standing at the truck gets the SPN
// meaning and the FMI failure mode instantly, and the model call is only ever
// the enrichment on top.
//
// This table is deliberately small and deliberately not padded out. Every entry
// here came from the field-authored corpus. If an SPN is not listed we say so
// and send the tech to OEM software — we never invent an SPN definition.

export interface FmiEntry {
  fmi:         number
  meaning:     string
  /** What a tech should suspect first when they see this failure mode. */
  fieldAdvice: string
}

export const J1939_FMI: Record<number, FmiEntry> = {
  0:  { fmi: 0,  meaning: 'Data valid but above normal range — reading too high', fieldAdvice: 'Real over-range condition. Verify the reading against a gauge before touching wiring.' },
  1:  { fmi: 1,  meaning: 'Data valid but below normal range — reading too low', fieldAdvice: 'Real under-range condition. Verify the reading against a gauge before touching wiring.' },
  2:  { fmi: 2,  meaning: 'Data erratic, intermittent, or incorrect', fieldAdvice: 'Chafed harness or a backed-out connector pin. Wiggle test the circuit while monitoring.' },
  3:  { fmi: 3,  meaning: 'Voltage above normal or shorted high — check for short to power in wiring', fieldAdvice: 'Almost always a wiring fault. Check connectors and harness before replacing the component.' },
  4:  { fmi: 4,  meaning: 'Voltage below normal or shorted low — check for short to ground in wiring', fieldAdvice: 'Almost always a wiring fault. Check connectors and harness before replacing the component.' },
  5:  { fmi: 5,  meaning: 'Current below normal or open circuit — check for broken wire or connector', fieldAdvice: 'Open circuit. Half-split the circuit to find the break before condemning the component.' },
  6:  { fmi: 6,  meaning: 'Current above normal or grounded circuit — check for short to ground', fieldAdvice: 'Short to ground. Pull the fuse and disconnect loads one at a time to isolate.' },
  7:  { fmi: 7,  meaning: 'Mechanical system not responding properly — mechanical failure not electrical', fieldAdvice: 'Almost always mechanical. Do not chase wiring — check linkage, actuator travel and binding.' },
  8:  { fmi: 8,  meaning: 'Abnormal frequency, pulse width, or period', fieldAdvice: 'Check sensor air gap and signal quality before replacing the sensor.' },
  9:  { fmi: 9,  meaning: 'Abnormal update rate — communication fault between modules', fieldAdvice: 'Check CAN bus wiring, terminating resistors and module power/ground.' },
  10: { fmi: 10, meaning: 'Abnormal rate of change', fieldAdvice: 'Look for an intermittent connection or a sensor losing calibration.' },
  11: { fmi: 11, meaning: 'Root cause not known', fieldAdvice: 'Pull all active and inactive codes — a companion code usually names the real fault.' },
  12: { fmi: 12, meaning: 'Bad intelligent device or component — module failure', fieldAdvice: 'Almost always a module. Confirm power and ground to the module before replacing it.' },
  13: { fmi: 13, meaning: 'Out of calibration', fieldAdvice: 'Calibration or programming required — OEM software is normally needed.' },
  14: { fmi: 14, meaning: 'Special instructions', fieldAdvice: 'Refer to the OEM procedure for this SPN — the meaning is manufacturer specific.' },
  15: { fmi: 15, meaning: 'Data valid but above normal range — least severe', fieldAdvice: 'Early warning. Monitor and address before it escalates.' },
  16: { fmi: 16, meaning: 'Data valid but above normal range — moderately severe', fieldAdvice: 'Address at this service visit — the next stage triggers a derate on many engines.' },
  17: { fmi: 17, meaning: 'Data valid but below normal range — least severe', fieldAdvice: 'Early warning. Monitor and address before it escalates.' },
  18: { fmi: 18, meaning: 'Data valid but below normal range — moderately severe', fieldAdvice: 'Address at this service visit — the next stage triggers a derate on many engines.' },
  19: { fmi: 19, meaning: 'Received network data in error', fieldAdvice: 'A different module is sending bad data. Diagnose the sending module, not this one.' },
  31: { fmi: 31, meaning: 'Condition exists — general fault active', fieldAdvice: 'The condition named by the SPN is currently true. Fix the cause; clearing the code will not remove it.' },
}

export interface SpnEntry {
  spn:     number
  meaning: string
}

export const J1939_COMMON_SPN: Record<number, SpnEntry> = {
  91:   { spn: 91,   meaning: 'Throttle position' },
  94:   { spn: 94,   meaning: 'Fuel delivery pressure' },
  100:  { spn: 100,  meaning: 'Engine oil pressure' },
  101:  { spn: 101,  meaning: 'Crankcase pressure' },
  102:  { spn: 102,  meaning: 'Boost pressure' },
  105:  { spn: 105,  meaning: 'Intake manifold temperature' },
  108:  { spn: 108,  meaning: 'Barometric pressure' },
  110:  { spn: 110,  meaning: 'Coolant temperature' },
  157:  { spn: 157,  meaning: 'Injector metering rail pressure' },
  168:  { spn: 168,  meaning: 'Battery voltage' },
  171:  { spn: 171,  meaning: 'Ambient air temperature' },
  174:  { spn: 174,  meaning: 'Fuel temperature' },
  175:  { spn: 175,  meaning: 'Engine oil temperature' },
  190:  { spn: 190,  meaning: 'Engine RPM' },
  411:  { spn: 411,  meaning: 'EGR differential pressure' },
  412:  { spn: 412,  meaning: 'EGR temperature' },
  1569: { spn: 1569, meaning: 'Engine protection torque derate — engine going into protection mode' },
  3216: { spn: 3216, meaning: 'Aftertreatment SCR intake NOx' },
  3226: { spn: 3226, meaning: 'Aftertreatment SCR outlet NOx' },
  3251: { spn: 3251, meaning: 'DPF differential pressure' },
  3361: { spn: 3361, meaning: 'DEF injector' },
  3363: { spn: 3363, meaning: 'DEF quality' },
  4094: { spn: 4094, meaning: 'Aftertreatment SCR operator inducement — DEF related derate active' },
}

/** SPN 651-658 are the per-cylinder injectors; expressed as a range, not 8 rows. */
export function injectorSpn(spn: number): SpnEntry | null {
  if (spn < 651 || spn > 658) return null
  return { spn, meaning: `Injector, cylinder ${spn - 650}` }
}

export function lookupSpn(spn: number): SpnEntry | null {
  return J1939_COMMON_SPN[spn] ?? injectorSpn(spn)
}

export function lookupFmi(fmi: number): FmiEntry | null {
  return J1939_FMI[fmi] ?? null
}

/**
 * Field rule straight from the corpus: FMI 3 and 4 are almost always wiring,
 * FMI 7 is almost always mechanical, FMI 12 is almost always a module. Surfaced
 * as its own line so a tech reads it before ordering a part.
 */
export function fmiFieldRule(fmi: number): string | null {
  if (fmi === 3 || fmi === 4) return 'FMI 3 and 4 are almost always wiring faults — check connectors and harness before replacing components.'
  if (fmi === 7)  return 'FMI 7 is almost always mechanical, not electrical.'
  if (fmi === 12) return 'FMI 12 is almost always a module failure.'
  return null
}

/** Engine brands the truck prompt carries real field knowledge for. */
export const HD_TRUCK_BRANDS = [
  'Cummins',
  'Detroit Diesel',
  'PACCAR',
  'Mercedes-Benz',
  'Caterpillar',
  'Volvo',
  'Mack',
  'International',
] as const

/** Reefer manufacturers. The two strings must match hd_parts.manufacturer. */
export const HD_REEFER_MANUFACTURERS = [
  'Thermo King',
  'Carrier Transicold',
] as const
