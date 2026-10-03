import type { ReactNode } from 'react'

/** 可收起的侧栏：收起时只留一条窄边，内容保持挂载（标签页等状态不丢） */
export function Collapsible({ open, onToggle, label, children }: { open: boolean; onToggle(): void; label: string; children: ReactNode }) {
  return (
    <>
      <div className={open ? 'contents' : 'hidden'}>{children}</div>
      {!open && (
        <button
          onClick={onToggle}
          title={`展开${label}`}
          className="flex w-8 shrink-0 flex-col items-center gap-2 border-r border-slate-800 py-3 text-xs text-slate-400 hover:bg-slate-900 hover:text-white"
        >
          <span>»</span>
          <span className="[writing-mode:vertical-rl]">{label}</span>
        </button>
      )}
    </>
  )
}
