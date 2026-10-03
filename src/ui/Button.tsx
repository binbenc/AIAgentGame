import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'

const styles: Record<Variant, string> = {
  primary: 'bg-violet-600 hover:bg-violet-500 text-white',
  success: 'bg-emerald-600 hover:bg-emerald-500 text-white',
  secondary: 'bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700',
  ghost: 'hover:bg-slate-800 text-slate-300',
  danger: 'bg-rose-700 hover:bg-rose-600 text-white',
}

export function Button({ variant = 'secondary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`}
    />
  )
}
