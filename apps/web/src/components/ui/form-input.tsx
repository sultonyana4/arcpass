import type { FormInputProps } from '@/types/components'

export function FormInput({
  label,
  name,
  type = 'text',
  placeholder,
  value,
  onChange,
  validationState,
  errorMessage,
}: FormInputProps) {
  const errorId = `${name}-error`

  const borderClass =
    validationState === 'invalid'
      ? 'border-red-500'
      : validationState === 'valid'
        ? 'border-green-500'
        : 'border-[#2e2e2e]'

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={name}
        className="text-sm font-medium text-[#d4d4d4]"
      >
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={validationState === 'invalid' ? true : undefined}
        aria-describedby={validationState === 'invalid' ? errorId : undefined}
        className={`min-h-[44px] w-full rounded-md border bg-[#1a1a1a] px-3 py-2 text-[#ededed] placeholder:text-[#a3a3a3] outline-none transition-colors focus:ring-2 focus:ring-[#6366f1] ${borderClass}`}
      />
      {validationState === 'invalid' && errorMessage && (
        <p
          id={errorId}
          role="alert"
          className="text-sm text-red-500"
        >
          {errorMessage}
        </p>
      )}
    </div>
  )
}
