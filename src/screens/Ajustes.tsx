import { useState, type FormEvent } from 'react'
import { AmountField, FieldError, FieldNote, FormActions, SelectField, TextField } from '../components/fields'
import { FooterHint, Panel } from '../components/hud'
import { StageHeader } from '../components/StageHeader'
import { updateSettings } from '../db/buckets'
import type { Settings } from '../db/types'
import { useMoneyData } from '../db/useMoneyData'
import { isoToDate, todayIso } from '../lib/dates'
import { formatDate } from '../lib/format'
import { parseAmount } from '../lib/parseAmount'

const text = (value: number | null | undefined) => (value === null || value === undefined ? '' : String(value))

function SettingsForm({ settings }: { settings: Settings }) {
  const [foreign, setForeign] = useState(settings.foreign_income ?? false)
  const [dayRate, setDayRate] = useState(text(settings.cad_day_rate))
  const [fx, setFx] = useState(text(settings.fx_rate))
  const [buffer, setBuffer] = useState(text(settings.buffer_mxn))
  const [retirement, setRetirement] = useState(text(Math.round(settings.second_income_rule.retirement_pct * 1000) / 10))
  const [travel, setTravel] = useState(text(settings.second_income_rule.travel_mxn))
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  const optional = (value: string) => (value.trim() === '' ? null : parseAmount(value))

  async function submit(event: FormEvent) {
    event.preventDefault()
    const dayRateValue = optional(dayRate)
    const fxValue = optional(fx)
    const bufferValue = parseAmount(buffer || '0')
    const retirementValue = parseAmount(retirement || '0')
    const travelValue = parseAmount(travel || '0')
    if (foreign && dayRate.trim() !== '' && (dayRateValue === null || dayRateValue <= 0)) return setError('Revisa la tarifa por día.')
    if (foreign && fx.trim() !== '' && (fxValue === null || fxValue <= 0)) return setError('Revisa el tipo de cambio.')
    if (bufferValue === null || bufferValue < 0) return setError('El colchón no puede ser negativo.')
    if (retirementValue === null || retirementValue < 0 || retirementValue > 100) return setError('El porcentaje de retiro va de 0 a 100.')
    if (travelValue === null || travelValue < 0) return setError('Revisa el monto de viajes.')

    setSaving(true)
    try {
      const fxChanged = foreign && fxValue !== settings.fx_rate
      await updateSettings(settings, {
        foreign_income: foreign,
        ...(foreign ? { cad_day_rate: dayRateValue, fx_rate: fxValue } : {}),
        ...(fxChanged ? { fx_source: fxValue === null ? null : 'manual', fx_date: fxValue === null ? null : todayIso() } : {}),
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

      <p className="field-label">Moneda del ingreso</p>
      <SelectField
        label="Recibo mi ingreso en"
        value={foreign ? 'CAD' : 'MXN'}
        onChange={(v) => { setForeign(v === 'CAD'); setSaved(false); setError(null) }}
        options={[
          { value: 'MXN', label: 'Pesos (MXN)' },
          { value: 'CAD', label: 'Pesos y dólares canadienses (CAD)' },
        ]}
      />
      {foreign ? (
        <>
          <div className="field-row">
            <TextField label="Tipo de cambio (MXN por CAD)" value={fx} onChange={touch(setFx)} inputMode="decimal" placeholder="13.50" mono />
            <AmountField label="Tarifa por día (CAD, opcional)" value={dayRate} onChange={touch(setDayRate)} />
          </div>
          <FieldNote>
            {settings.fx_rate && settings.fx_date
              ? `Último tipo de cambio guardado el ${formatDate(isoToDate(settings.fx_date))}. Se sugiere en cada ingreso en CAD y lo puedes cambiar ahí.`
              : 'Sin tipo de cambio guardado. Al registrar un ingreso en CAD se te pedirá.'}
          </FieldNote>
        </>
      ) : (
        <FieldNote>Registras tus ingresos en pesos, ya convertidos.</FieldNote>
      )}

      {error && <FieldError>{error}</FieldError>}
      {saved && <FieldNote>Guardado.</FieldNote>}
      <FormActions submitLabel="Guardar ajustes" saving={saving} />
    </form>
  )
}

export function Ajustes() {
  const { loaded, settings } = useMoneyData()
  if (!loaded) return null

  return (
    <div className="stage-grid stage-grid--single">
      <div className="stage-main stage-narrow">
        <StageHeader title="Ajustes" />
        <Panel title="Ajustes">
          {settings ? <SettingsForm key={settings.updated_at} settings={settings} /> : <FooterHint>Los ajustes se están preparando.</FooterHint>}
        </Panel>
        <FooterHint>Todo se guarda solo en este dispositivo.</FooterHint>
      </div>
    </div>
  )
}
