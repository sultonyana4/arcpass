import type { ButtonProps } from '@/types/components'

export function Button({
  children,
  onClick,
  type = 'button',
  variant = 'primary',
  loading = false,
  disabled = false,
  'aria-label': ariaLabel,
}: ButtonProps) {
  const baseClasses =
    'inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors min-h-[44px] min-w-[44px] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[var(--color-background)]'

  const variantClasses =
    variant === 'primary'
      ? 'bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] focus:ring-[var(--color-accent)]'
      : 'bg-transparent border border-[var(--color-background-border)] text-[var(--color-foreground-secondary)] hover:bg-[var(--color-background-elevated)] focus:ring-[var(--color-background-border)]'

  const disabledClasses = loading || disabled ? 'opacity-50 pointer-events-none' : ''

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={loading || disabled}
      aria-busy={loading ? true : undefined}
      aria-label={ariaLabel}
      className={`${baseClasses} ${variantClasses} ${disabledClasses}`}
    >
      {loading && (
        <span
          className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden="true"
        />
      )}
      {children}
    </button>
  )
}
