import { FooterHint, GradeCard } from '../components/hud'
import { StageHeader } from '../components/StageHeader'
import { formatMoney } from '../lib/format'

const BUCKETS = [
  { grade: 'Apartado 1', title: 'Emergencia' },
  { grade: 'Apartado 2', title: 'Retiro' },
  { grade: 'Apartado 3', title: 'Viaje' },
]

export function Ahorro() {
  return (
    <div className="stage-grid stage-grid--single">
      <div className="stage-main">
        <StageHeader title="Ahorro" share />
        <div className="grade-row">
          {BUCKETS.map((bucket) => (
            <GradeCard
              key={bucket.title}
              grade={bucket.grade}
              title={bucket.title}
              value={formatMoney(0, 'MXN')}
              meta="Sin meta"
              tone="empty"
            />
          ))}
        </div>
        <FooterHint>Tus apartados se llenan con las reglas del primer y segundo ingreso.</FooterHint>
      </div>
    </div>
  )
}
