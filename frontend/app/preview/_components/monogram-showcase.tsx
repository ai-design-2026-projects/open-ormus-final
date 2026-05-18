import { Monogram, type MonogramShape, type MonogramStatus } from "@/components/ui/monogram"

const NAMES = ["Sherlock Holmes","James Moriarty","Iris Vega","Captain Nemo","Hermione Granger","Furiosa","Ada Wren","Don Quixote","Eleanor Vance"]
const SHAPES: MonogramShape[] = ["rounded","circle","squircle","hexagon","shield","diamond"]
const STATUSES: Array<{ status: MonogramStatus; label: string }> = [
  { status: "ok", label: "ok" },
  { status: "warn", label: "warn" },
  { status: "flag", label: "flag" },
  { status: "public", label: "public" },
]

export function MonogramShowcase() {
  return (
    <div className="flex flex-col gap-10">
      <div>
        <p className="t-meta mb-4">HUE DISTRIBUTION — 9 names, all unique</p>
        <div className="flex gap-4 flex-wrap">
          {NAMES.map((name) => (
            <div key={name} className="flex flex-col items-center gap-2">
              <Monogram name={name} size={48} />
              <span className="t-meta text-center" style={{ maxWidth: 56, wordBreak: "break-word" }}>
                {name.split(" ")[0]}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="t-meta mb-4">6 SHAPES</p>
        <div className="flex gap-6 flex-wrap items-end">
          {SHAPES.map((shape) => (
            <div key={shape} className="flex flex-col items-center gap-2">
              <Monogram name="Sherlock Holmes" size={56} shape={shape} />
              <span className="t-meta">{shape}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="t-meta mb-4">STATUS DOTS</p>
        <div className="flex gap-6 items-end">
          {STATUSES.map(({ status, label }) => (
            <div key={status} className="flex flex-col items-center gap-2">
              <Monogram name="Sherlock Holmes" size={56} status={status} />
              <span className="t-meta">{label}</span>
            </div>
          ))}
          <div className="flex flex-col items-center gap-2">
            <Monogram name="Sherlock Holmes" size={56} ring />
            <span className="t-meta">ring</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <Monogram name="Sherlock Holmes" size={56} flat />
            <span className="t-meta">flat</span>
          </div>
        </div>
      </div>

      <div>
        <p className="t-meta mb-4">SIZE SCALE</p>
        <div className="flex gap-4 items-end">
          {[24,32,40,56,72,96].map((size) => (
            <div key={size} className="flex flex-col items-center gap-2">
              <Monogram name="Iris Vega" size={size} />
              <span className="t-meta">{size}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
