import { config } from '@/config/env'

export function Footer() {
  return (
    <footer className="border-t border-background-border bg-background-secondary py-6">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
          <p className="text-sm text-foreground-muted">
            ArcPass — Gas Sponsorship Infrastructure for Arc Network
          </p>
          <div className="flex items-center gap-4 text-sm text-foreground-muted">
            <a
              href="https://docs.arcpass.vibepas.xyz"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="ArcPass Documentation (opens in new tab)"
              className="inline-flex min-h-[44px] items-center gap-1 underline hover:text-foreground transition-colors"
            >
              Documentation
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                />
              </svg>
            </a>
            {config.githubUrl ? (
              <a
                href={config.githubUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="ArcPass GitHub repository (opens in new tab)"
                className="inline-flex min-h-[44px] items-center underline hover:text-foreground transition-colors"
              >
                GitHub
              </a>
            ) : (
              <span>Not configured</span>
            )}
          </div>
        </div>
      </div>
    </footer>
  )
}
