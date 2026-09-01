// Shared row shape for hd_trailer_reference — a GLOBAL, anon-readable catalog owned by
// the NWI Suite project and shared with NWI Shop through the same Supabase instance.
//
// NWI Shop READS this table and never writes it. Suite's seed route deletes and
// re-inserts the whole catalog, so it is deliberately not ported here: running it from
// Shop would wipe the reference data Suite depends on. The four data modules in this
// directory are the same rows as source, kept alongside the contract so the shape a
// query returns and the shape the data was written in cannot drift apart.

/** Top-level grouping. Also what the reference browser's category filter maps onto. */
export type TrailerSystem =
  | 'Air Brakes'
  | 'Brake Chambers'
  | 'Slack Adjusters'
  | 'Brake Shoes & Drums'
  | 'ABS'
  | 'Electrical'
  | 'Torque Specs'

export interface TrailerReferenceRow {
  /** One of TrailerSystem. Indexed — it is the primary filter in the reference browser. */
  system:       TrailerSystem
  /** The specific part or procedure: 'Type 30 Brake Chamber', 'Haldex Code 1-1'. */
  component:    string
  /** What it is or what the code means. The main free-text search target. */
  description:  string
  /** The spec itself when there is one: '450-500', '0.020-0.040', '120-135'. */
  value:        string | null
  /** Unit for `value`: 'ft-lbs', 'PSI', 'inches', 'ohms'. Null when value is null. */
  units:        string | null
  /** Procedure detail, cautions, diagnosis steps. Null when there is nothing to add. */
  notes:        string | null
  /** 'Trailer' for generic entries; a brand when the spec is brand-specific. */
  manufacturer: string
}
