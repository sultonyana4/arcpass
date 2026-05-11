import { config } from '@/config/env'

export function Footer() {
  return (
    <footer className="border-t border-background-border bg-background-secondary py-6">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
          <p className="text-sm text-foreground-muted">
            ArcPass — Gas Sponsorship Infrastructure for Arc Network
          </p>
          <div className="text-sm text-foreground-muted">
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
