import { FooterHint, GradeCard, Panel } from '../components/hud'
import { StageHeader } from '../components/StageHeader'

const SCENARIOS = [
  { grade: 'Escenario 1', title: 'Conservador' },
  { grade: 'Escenario 2', title: 'Base' },
  { grade: 'Escenario 3', title: 'Optimista' },
]

const REQUIREMENTS = ['Compra', 'Disponible proyectado', 'Pago TDC siguiente']

export function Proyeccion() {
  return (
    <div className="stage-grid stage-grid--single">
      <div className="stage-main">
        <StageHeader title="¿Puedo comprarlo?" share />
        <div className="grade-row">
          {SCENARIOS.map((scenario) => (
            <GradeCard
              key={scenario.title}
              grade={scenario.grade}
              title={scenario.title}
              value="—"
              meta="Tipo de cambio sin definir"
              tone="empty"
            />
          ))}
        </div>
        <Panel title="Requisitos">
          <table className="roster requirements">
            <thead>
              <tr>
                <th scope="col">Concepto</th>
                <th scope="col">Requerido</th>
                <th scope="col">Actual</th>
              </tr>
            </thead>
            <tbody>
              {REQUIREMENTS.map((row) => (
                <tr key={row}>
                  <td>{row}</td>
                  <td className="mono">—</td>
                  <td className="mono">—</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <FooterHint>Escribe un monto y una fecha para saber si puedes comprarlo.</FooterHint>
      </div>
    </div>
  )
}
