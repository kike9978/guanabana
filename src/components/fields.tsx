import type { HTMLAttributes, ReactNode } from 'react'

export function TextField({
  label,
  value,
  onChange,
  type = 'text',
  inputMode,
  placeholder,
  invalid = false,
  mono = false,
  max,
  autoFocus,
  list,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'date'
  inputMode?: HTMLAttributes<HTMLInputElement>['inputMode']
  placeholder?: string
  invalid?: boolean
  mono?: boolean
  max?: string
  autoFocus?: boolean
  list?: string
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        className={`input${mono ? ' mono' : ''}`}
        type={type}
        inputMode={inputMode}
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        max={max}
        autoFocus={autoFocus}
        list={list}
        aria-invalid={invalid}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

export function AmountField(props: { label: string; value: string; onChange: (value: string) => void; invalid?: boolean; autoFocus?: boolean }) {
  return <TextField {...props} inputMode="decimal" placeholder="0.00" mono />
}

export interface Option {
  value: string
  label: string
}

export function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: Option[]
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <select className="input" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export function ChoiceField<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: T
  onChange: (value: T) => void
  options: readonly { value: T; label: string }[]
}) {
  return (
    <div className="field" role="radiogroup" aria-label={label}>
      <span className="field-label">{label}</span>
      <div className="choice-row">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={option.value === value}
            className="choice"
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function FormActions({
  submitLabel,
  onCancel,
  cancelLabel = 'Cancelar',
  saving = false,
}: {
  submitLabel: string
  onCancel?: () => void
  cancelLabel?: string
  saving?: boolean
}) {
  return (
    <div className="verb-row">
      <button type="submit" className="verb-button verb-primary" disabled={saving}>
        <span className="key-glyph">A</span>
        {submitLabel}
      </button>
      {onCancel && (
        <button type="button" className="verb-button" onClick={onCancel}>
          <span className="key-glyph">B</span>
          {cancelLabel}
        </button>
      )}
    </div>
  )
}

export function FieldError({ children }: { children: ReactNode }) {
  return <p className="field-error">{children}</p>
}

export function RangeField({
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  value: number
  display: string
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}) {
  return (
    <label className="field range-field">
      <span className="field-label">
        {label}
        <span className="range-value mono">{display}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  )
}

export function FieldNote({ children }: { children: ReactNode }) {
  return <p className="field-note">{children}</p>
}
