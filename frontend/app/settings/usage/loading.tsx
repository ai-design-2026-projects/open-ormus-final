export default function UsageLoading() {
  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-6">
        <div className="h-6 w-28 rounded bg-surface-sunk animate-pulse" />
        <div className="h-8 w-48 rounded-lg bg-surface-sunk animate-pulse" />
      </div>
      <div className="border border-hair rounded-xl px-4 divide-y divide-hair">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center justify-between py-4">
            <div className="h-4 w-24 rounded bg-surface-sunk animate-pulse" />
            <div className="h-4 w-40 rounded bg-surface-sunk animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  )
}
