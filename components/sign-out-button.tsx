// Plain form POST — sign-out must not be reachable by a link prefetch.
export default function SignOutButton({ className }: { className?: string }) {
  return (
    <form action="/auth/signout" method="post">
      <button
        type="submit"
        className={
          className ??
          'w-full rounded-lg border border-slate-700 px-3 py-2.5 text-sm font-semibold text-slate-300 hover:border-slate-500 hover:text-white'
        }
      >
        Sign out
      </button>
    </form>
  )
}
