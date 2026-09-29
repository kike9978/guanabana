export function pickValid<T extends string>(chosen: T | null, options: readonly { value: T }[]): T | undefined {
  if (chosen !== null && options.some((option) => option.value === chosen)) return chosen
  return options[0]?.value
}
