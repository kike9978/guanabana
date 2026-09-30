import { useState } from 'react'
import { PROJECTION_VIEWS, type ProjectionView } from '../app/navigation'
import { Rail } from '../components/hud'
import { StageHeader } from '../components/StageHeader'
import { useMoneyData } from '../db/useMoneyData'
import { Comprar } from './Comprar'
import { Presupuesto } from './Presupuesto'

export function Proyeccion() {
  const data = useMoneyData()
  const [view, setView] = useState<ProjectionView>('buy')
  const header = (
    <>
      <StageHeader title={view === 'budget' ? 'Presupuesto' : '¿Puedo comprarlo?'} share />
      <Rail label="Vista" items={PROJECTION_VIEWS} active={view} onSelect={setView} />
    </>
  )

  if (!data.loaded) return null
  return view === 'budget' ? <Presupuesto data={data} header={header} /> : <Comprar data={data} header={header} />
}
