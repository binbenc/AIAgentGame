export function Stars({ n, size = 'text-base' }: { n: number; size?: string }) {
  return (
    <span className={`${size} tracking-tight`} aria-label={`${n} 星`}>
      {[1, 2, 3].map((i) => (
        <span key={i} className={i <= n ? 'text-amber-400' : 'text-slate-700'}>
          ★
        </span>
      ))}
    </span>
  )
}
