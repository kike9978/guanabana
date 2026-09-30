import { useState, type FormEvent } from 'react'
import { CategoryManager } from '../components/CategoryManager'
import { AmountField, FieldError, FieldNote, FormActions, TextField } from '../components/fields'
import { FooterHint, Panel } from '../components/hud'
import { StageHeader } from '../components/StageHeader'
import { updateSettings } from '../db/buckets'
import type { Settings } from '../db/types'
import { useMoneyData } from '../db/useMoneyData'
import { parseAmount } from '../lib/parseAmount'

const text = (value: number | null | undefined) => (value === null || value === undefined ? '' : String(value))

function SettingsForm({ settings }: { settings: Settings }) {
  const [buffer, setBuffer] = useState(text(settings.buffer_mxn))
  const [retirement, setRetirement] = useState(text(Math.round(settings.second_income_rule.retirement_pct * 1000) / 10))
  const [travel, setTravel] = useState(text(settings.second_income_rule.travel_mxn))
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const bufferValue = parseAmount(buffer || '0')
    const retirementValue = parseAmount(retirement || '0')
    const travelValue = parseAmount(travel || '0')
    if (bufferValue === null || bufferValue < 0) return setError('El colchón no puede ser negativo.')
    if (retirementValue === null || retirementValue < 0 || retirementValue > 100) return setError('El porcentaje de retiro va de 0 a 100.')
    if (travelValue === null || travelValue < 0) return setError('Revisa el monto de viajes.')

    setSaving(true)
    try {
      await updateSettings(settings, {
        buffer_mxn: bufferValue,
        second_income_rule: { retirement_pct: retirementValue / 100, travel_mxn: travelValue },
      })
      setSaved(true)
      setError(null)
    } catch {
      setError('No se pudo guardar. Intenta de nuevo.')
    }
    setSaving(false)
  }

  const touch = (setter: (value: string) => void) => (value: string) => {
    setter(value)
    setSaved(false)
    setError(null)
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <p className="field-label">Disponible real</p>
      <AmountField label="Colchón (MXN)" value={buffer} onChange={touch(setBuffer)} />
      <FieldNote>El colchón se descuenta siempre de tu Disponible real.</FieldNote>

      <p className="field-label">Regla del segundo ingreso</p>
      <div className="field-row">
        <TextField label="Retiro (% del ingreso)" value={retirement} onChange={touch(setRetirement)} inputMode="decimal" placeholder="20" mono />
        <AmountField label="Viajes (MXN)" value={travel} onChange={touch(setTravel)} />
      </div>
      <FieldNote>La regla del primer ingreso manda lo que sobra del ingreso anterior a Emergencia.</FieldNote>

      {error && <FieldError>{error}</FieldError>}
      {saved && <FieldNote>Guardado.</FieldNote>}
      <FormActions submitLabel="Guardar ajustes" saving={saving} />
    </form>
  )
}

export function Ajustes() {
  const data = useMoneyData()
  const { loaded, settings } = data
  if (!loaded) return null

  return (
    <div className="stage-grid stage-grid--single">
      <div className="stage-main stage-narrow">
        <StageHeader title="Ajustes" />
        <Panel title="Ajustes">
          {settings ? <SettingsForm key={settings.updated_at} settings={settings} /> : <FooterHint>Los ajustes se están preparando.</FooterHint>}
        </Panel>
        <Panel title="Categorías">
          <CategoryManager data={data} />
        </Panel>
        <FooterHint>Todo se guarda solo en este dispositivo.</FooterHint>
      </div>
    </div>
  )
}
