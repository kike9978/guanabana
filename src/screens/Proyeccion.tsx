import { useState } from 'react'
import { PROJECTION_VIEWS, type ProjectionView } from '../app/navigation'
import { Rail } from '../components/hud'
import { StageHeader } from '../components/StageHeader'
import { useMoneyData } from '../db/useMoneyData'
import { Comprar } from './Comprar'
import { Plan } from './Plan'
import { Presupuesto } from './Presupuesto'

const VIEW_TITLE: Record<ProjectionView, string> = {
  buy: '¿Puedo comprarlo?',
  plan: 'Plan',
  budget: 'Presupuesto',
}

export function Proyeccion() {
  const data = useMoneyData()
  const [view, setView] = useState<ProjectionView>('buy')
  const header = (
    <>
      <StageHeader title={VIEW_TITLE[view]} share />
      <Rail label="Vista" items={PROJECTION_VIEWS} active={view} onSelect={setView} />
    </>
  )

  if (!data.loaded) return null
  if (view === 'budget') return <Presupuesto data={data} header={header} />
  if (view === 'plan') return <Plan data={data} header={header} />
  return <Comprar data={data} header={header} onAddedToPlan={() => setView('plan')} />
}
