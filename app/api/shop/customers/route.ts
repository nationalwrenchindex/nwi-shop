// GET  /api/shop/customers?q=  - type-ahead search over name, company, phone,
//                                email. Without `q` it returns the newest 50.
// POST /api/shop/customers     - inline customer creation from the job modal.

import type { NextRequest } from 'next/server'
import { apiContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { apiError, asBoolean, asText, readJsonBody, sanitizeSearch } from '@/lib/shop/jobs'
import type { ShopCustomer } from '@/lib/types'

export async function GET(req: NextRequest) {
  const { ctx, error } = await apiContext('manageCustomers')
  if (error) return error

  const supabase = await createClient()
  const raw = req.nextUrl.searchParams.get('q') ?? ''
  const term = sanitizeSearch(raw)

  let query = supabase
    .from('shop_customers')
    .select('*')
    .eq('shop_id', ctx.shop.id)
    .order('last_name', { ascending: true })
    .limit(term ? 20 : 50)

  if (term) {
    const like = `%${term}%`
    query = query.or(
      [
        `first_name.ilike.${like}`,
        `last_name.ilike.${like}`,
        `company.ilike.${like}`,
        `phone.ilike.${like}`,
        `email.ilike.${like}`,
      ].join(','),
    )
  }

  const { data } = await query.returns<ShopCustomer[]>()
  return Response.json({ customers: data ?? [] })
}

export async function POST(req: NextRequest) {
  const { ctx, error } = await apiContext('manageCustomers')
  if (error) return error

  const body = await readJsonBody(req)
  if (!body) return apiError('Expected a JSON object body.', 400)

  const firstName = asText(body.first_name)
  const lastName = asText(body.last_name)
  const company = asText(body.company)
  if (!firstName && !lastName && !company) {
    return apiError('A first name, last name, or company is required.', 400)
  }

  const supabase = await createClient()
  const { data: customer, error: insertError } = await supabase
    .from('shop_customers')
    .insert({
      shop_id:    ctx.shop.id,
      first_name: firstName ?? '',
      last_name:  lastName ?? '',
      company,
      email:      asText(body.email),
      phone:      asText(body.phone),
      address:    asText(body.address),
      city:       asText(body.city),
      state:      asText(body.state),
      zip:        asText(body.zip),
      no_sms:     asBoolean(body.no_sms) ?? false,
      no_email:   asBoolean(body.no_email) ?? false,
      notes:      asText(body.notes),
    })
    .select('*')
    .maybeSingle<ShopCustomer>()

  if (insertError || !customer) {
    return apiError(insertError?.message ?? 'Could not create the customer.', 400)
  }

  return Response.json({ customer }, { status: 201 })
}
