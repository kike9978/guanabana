import { useState } from 'react'
import { addLabel, tabLabel, type AddType, type Route } from './app/navigation'
import { AddSheet } from './components/AddSheet'
import { CommandBar } from './components/CommandBar'
import { LockGate } from './components/LockGate'
import { StatusStrip } from './components/StatusStrip'
import { useLocalDb } from './db/useLocalDb'
import { AddScreen } from './screens/AddScreen'
import { Ahorro } from './screens/Ahorro'
import { Cuentas } from './screens/Cuentas'
import { Inicio } from './screens/Inicio'
import { Movimientos } from './screens/Movimientos'
import { Proyeccion } from './screens/Proyeccion'
import { Tiempo } from './screens/Tiempo'
import './App.css'

function routePath(route: Route): string[] {
  switch (route.kind) {
    case 'tab':
      return [tabLabel(route.tab)]
    case 'add':
      return [tabLabel(route.from), 'Agregar', addLabel(route.type)]
    case 'accounts':
      return [tabLabel(route.from), 'Cuentas']
  }
}

function App() {
  const db = useLocalDb()
  const [route, setRoute] = useState<Route>({ kind: 'tab', tab: 'inicio' })
  const [addOpen, setAddOpen] = useState(false)

  const currentTab = route.kind === 'tab' ? route.tab : route.from
  const back = () => setRoute({ kind: 'tab', tab: currentTab })
  const openAdd = (type: AddType) => {
    setAddOpen(false)
    setRoute({ kind: 'add', type, from: currentTab })
  }
  const openAccounts = () => setRoute({ kind: 'accounts', from: currentTab })

  function renderStage() {
    if (route.kind === 'add') return <AddScreen type={route.type} onDone={back} onOpenAccounts={openAccounts} />
    if (route.kind === 'accounts') return <Cuentas />
    switch (route.tab) {
      case 'inicio':
        return <Inicio onAdd={openAdd} onOpenAccounts={openAccounts} />
      case 'tiempo':
        return <Tiempo />
      case 'movimientos':
        return <Movimientos />
      case 'ahorro':
        return <Ahorro />
      case 'proyeccion':
        return <Proyeccion />
    }
  }

  return (
    <LockGate>
      <div className="shell">
        <StatusStrip path={routePath(route)} db={db} />
        <main className="stage">{renderStage()}</main>
        <CommandBar
          active={route.kind === 'tab' ? route.tab : null}
          onSelect={(tab) => setRoute({ kind: 'tab', tab })}
          onAdd={() => setAddOpen(true)}
        />
        <AddSheet open={addOpen} onClose={() => setAddOpen(false)} onPick={openAdd} />
      </div>
    </LockGate>
  )
}

export default App
