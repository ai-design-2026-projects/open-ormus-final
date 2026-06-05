export default function OAuthAuthorizedPage() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm flex flex-col items-center gap-6 text-center">
        {/* Icon */}
        <div className="flex h-14 w-14 items-center justify-center rounded-full border border-border bg-muted">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-foreground"
            aria-hidden="true"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>

        {/* Heading */}
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            Connected to OpenOrmus
          </h1>
          <p className="text-sm text-muted-foreground">
            Claude has been granted access to your characters and conversations.
            You can close this tab and return to Claude.
          </p>
        </div>

        {/* Divider */}
        <div className="w-full border-t border-border" />

        {/* What was granted */}
        <ul className="w-full flex flex-col gap-3 text-left text-sm text-muted-foreground">
          {[
            "Create and manage characters",
            "Start and review conversations",
            "Research characters and shows",
          ].map((item) => (
            <li key={item} className="flex items-center gap-3">
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-border">
                <span className="h-1.5 w-1.5 rounded-full bg-foreground" />
              </span>
              {item}
            </li>
          ))}
        </ul>

        {/* Footer */}
        <p className="text-xs text-muted-foreground/60">
          OpenOrmus · Your session is active for 24 hours
        </p>
      </div>
    </div>
  )
}
