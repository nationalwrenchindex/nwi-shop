// GET /api/shop/tools/quickwrench-hd/vin/[vin]
//
// HD truck VIN decode via NHTSA vPIC. Ported from national_wrench_index/src/app/
// api/hd/quickwrench/vin/[vin]/route.ts, with this project's feature gate in
// place of Suite's subscription check.
//
// No AI key needed — this is a public government dataset. It works today and it
// keeps working if every model key is pulled.

import type { NextRequest } from 'next/server'
import { apiFeature } from '@/lib/auth'
import { apiError } from '@/lib/shop/jobs'

type RouteContext = { params: Promise<{ vin: string }> }

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/i

interface NHTSAItem { Variable: string; Value: string | null }

function field(results: NHTSAItem[], name: string): string {
  return results.find((r) => r.Variable === name)?.Value?.trim() ?? ''
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  const { error } = await apiFeature('quickwrench_hd')
  if (error) return error

  const { vin } = await params
  const upperVin = vin.toUpperCase()

  if (!VIN_RE.test(upperVin)) {
    return apiError('VIN not found — enter the vehicle details manually.', 400)
  }

  let decoded: { Results?: NHTSAItem[] }
  try {
    const res = await fetch(
      `https://vpic.nhtsa.dot.gov/api/vehicles/decodevinextended/${upperVin}?format=json`,
      { next: { revalidate: 3600 }, signal: AbortSignal.timeout(12_000) },
    )
    if (!res.ok) throw new Error(`NHTSA ${res.status}`)
    decoded = await res.json()
  } catch (err) {
    console.error('[quickwrench-hd/vin] decode failed', err)
    return apiError('VIN lookup is unavailable right now — enter the vehicle details manually.', 502)
  }

  const results = decoded.Results ?? []
  const errorCode = field(results, 'Error Code')
  const make  = field(results, 'Make')
  const model = field(results, 'Model')
  const year  = field(results, 'Model Year')

  const codes = errorCode.split(',').map((c) => c.trim())
  const fatal = ['6', '7', '8', '9', '10', '11'].some((c) => codes.includes(c))
  if (fatal || (!make && !model)) {
    return apiError('VIN not found — enter the vehicle details manually.', 422)
  }

  // Engine description, displacement first.
  const cylinders    = field(results, 'Engine Number of Cylinders')
  const displacement = field(results, 'Displacement (L)')
  const fuelType     = field(results, 'Fuel Type - Primary')
  const engineModel  = field(results, 'Engine Model')

  let engine = ''
  if (displacement) engine += `${parseFloat(displacement).toFixed(1)}L `
  if (cylinders)    engine += `${cylinders}-cyl `
  if (fuelType && fuelType !== 'Gasoline') engine += `${fuelType} `
  if (engineModel)  engine += engineModel

  return Response.json({
    vehicle: {
      vin:    upperVin,
      year,
      make,
      model,
      engine: engine.trim() || null,
      gvwr:   field(results, 'Gross Vehicle Weight Rating From') || null,
    },
  })
}
