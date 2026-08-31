'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Mode = 'password' | 'magic'

export default function LoginForm({ redirectTo }: { redirectTo: string }) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  async function signInWithPassword(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)

    const supabase = createClient()
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })

    if (signInError) {
      setError(signInError.message)
      setBusy(false)
      return
    }

    // refresh() so the server layout re-reads the new session cookie.
    router.replace(redirectTo)
    router.refresh()
  }

  async function sendMagicLink(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)

    const supabase = createClient()
    const callback = new URL('/auth/callback', window.location.origin)
    callback.searchParams.set('next', redirectTo)

    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: callback.toString() },
    })

    if (otpError) {
      setError(otpError.message)
      setBusy(false)
      return
    }

    setSent(true)
    setBusy(false)
  }

  if (sent) {
    return (
      <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
        <p className="text-sm font-semibold text-emerald-900">Check your email</p>
        <p className="mt-1 text-sm text-emerald-800">
          We sent a sign-in link to <strong>{email}</strong>. Open it on this device.
        </p>
        <button
          type="button"
          className="nwi-btn nwi-btn-secondary mt-4"
          onClick={() => {
            setSent(false)
            setMode('password')
          }}
        >
          Back to sign in
        </button>
      </div>
    )
  }

  return (
    <form
      className="mt-6 space-y-4"
      onSubmit={mode === 'password' ? signInWithPassword : sendMagicLink}
    >
      <div>
        <label className="nwi-label" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          className="nwi-input"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@yourshop.com"
        />
      </div>

      {mode === 'password' ? (
        <div>
          <label className="nwi-label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            className="nwi-input"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
      ) : (
        <p className="text-sm text-slate-500">
          No password needed — we&apos;ll email you a one-time sign-in link.
        </p>
      )}

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <button type="submit" className="nwi-btn nwi-btn-primary w-full" disabled={busy}>
        {busy
          ? 'Working…'
          : mode === 'password'
            ? 'Sign in'
            : 'Email me a sign-in link'}
      </button>

      <button
        type="button"
        className="w-full text-sm font-semibold text-slate-600 hover:text-slate-900"
        onClick={() => {
          setMode(mode === 'password' ? 'magic' : 'password')
          setError(null)
        }}
      >
        {mode === 'password'
          ? 'Forgot your password? Email me a link instead'
          : 'Use a password instead'}
      </button>
    </form>
  )
}
