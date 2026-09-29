export function parseAmount(input: string): number | null {
  const cleaned = input.replace(/[\s$,]|MXN/gi, '')
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null
  return Number(cleaned)
}

export function parseDay(input: string): number | null {
  const value = Number(input)
  return Number.isInteger(value) && value >= 1 && value <= 31 ? value : null
}
