import { AppNav } from "@/components/app-shell/AppNav"

export default function UsageLoading() {
  return (
    <div className="min-h-screen bg-background">
      <AppNav />
      <div className="max-w-[560px] mx-auto px-6 md:px-0">
        <div className="flex items-end justify-between py-8 border-b border-hair">
          <div className="flex flex-col gap-2">
            <div className="h-3 w-14 rounded bg-surface-sunk animate-pulse" />
            <div className="h-10 w-44 rounded bg-surface-sunk animate-pulse" />
          </div>
          <div className="h-8 w-44 rounded-lg bg-surface-sunk animate-pulse" />
        </div>
        <div className="py-7 border-b border-hair flex flex-col gap-2">
          <div className="h-3 w-10 rounded bg-surface-sunk animate-pulse" />
          <div className="h-10 w-32 rounded bg-surface-sunk animate-pulse" />
        </div>
        <div className="divide-y divide-hair">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center justify-between py-4">
              <div className="h-4 w-24 rounded bg-surface-sunk animate-pulse" />
              <div className="h-4 w-36 rounded bg-surface-sunk animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
