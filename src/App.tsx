import { useState } from 'react'
import {
  addLabel,
  prefillFrom,
  SUB_SCREEN_LABEL,
  tabLabel,
  type AddPrefill,
  type AddType,
  type EditableTransaction,
  type Route,
  type SubScreen,
} from './app/navigation'
import { AddSheet } from './components/AddSheet'
import { CommandBar } from './components/CommandBar'
import { LockGate } from './components/LockGate'
import { StatusStrip } from './components/StatusStrip'
import { useLocalDb } from './db/useLocalDb'
import { AddScreen } from './screens/AddScreen'
import { Ahorro } from './screens/Ahorro'
import { Ajustes } from './screens/Ajustes'
import { Compromisos } from './screens/Compromisos'
import { Cuentas } from './screens/Cuentas'
import { Inicio } from './screens/Inicio'
import { Movimientos } from './screens/Movimientos'
import { Prestamos } from './screens/Prestamos'
import { Proyeccion } from './screens/Proyeccion'
import { Tiempo } from './screens/Tiempo'
import './App.css'

function routePath(route: Route): string[] {
  switch (route.kind) {
    case 'tab':
      return [tabLabel(route.tab)]
    case 'add':
      return [
        tabLabel(route.from),
        ...(route.screen ? [SUB_SCREEN_LABEL[route.screen]] : []),
        route.editing ? 'Editar' : 'Agregar',
        addLabel(route.type),
      ]
    case 'screen':
      return [tabLabel(route.from), SUB_SCREEN_LABEL[route.screen]]
  }
}

function App() {
  const db = useLocalDb()
  const [route, setRoute] = useState<Route>({ kind: 'tab', tab: 'inicio' })
  const [addOpen, setAddOpen] = useState(false)

  const currentTab = route.kind === 'tab' ? route.tab : route.from
  const currentScreen = route.kind === 'screen' ? route.screen : undefined
  const back = () =>
    setRoute(route.kind === 'add' && route.screen ? { kind: 'screen', screen: route.screen, from: currentTab } : { kind: 'tab', tab: currentTab })
  const openAdd = (type: AddType, prefill?: AddPrefill) => {
    setAddOpen(false)
    setRoute({ kind: 'add', type, from: currentTab, prefill, screen: currentScreen })
  }
  const openScreen = (screen: SubScreen) => setRoute({ kind: 'screen', screen, from: currentTab })
  const openAccounts = () => openScreen('accounts')
  const openEdit = (tx: EditableTransaction) =>
    setRoute({ kind: 'add', type: tx.type, from: currentTab, prefill: prefillFrom(tx), editing: tx })

  function renderStage() {
    if (route.kind === 'add') {
      return (
        <AddScreen
          key={JSON.stringify(route)}
          type={route.type}
          prefill={route.prefill}
          editing={route.editing}
          onDone={back}
          onNext={(type, prefill) => setRoute({ ...route, type, prefill, editing: undefined })}
          onOpenAccounts={openAccounts}
        />
      )
    }
    if (route.kind === 'screen') {
      if (route.screen === 'accounts') return <Cuentas />
      if (route.screen === 'commitments') return <Compromisos />
      if (route.screen === 'settings') return <Ajustes />
      return <Prestamos onAdd={openAdd} />
    }
    switch (route.tab) {
      case 'inicio':
        return <Inicio onAdd={openAdd} onOpenScreen={openScreen} onOpenAhorro={() => setRoute({ kind: 'tab', tab: 'ahorro' })} />
      case 'tiempo':
        return <Tiempo onAdd={openAdd} onOpenScreen={openScreen} />
      case 'movimientos':
        return <Movimientos onEdit={openEdit} />
      case 'ahorro':
        return <Ahorro onOpenScreen={openScreen} onAdd={openAdd} />
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
        <AddSheet open={addOpen} onClose={() => setAddOpen(false)} onPick={(type) => openAdd(type)} />
      </div>
    </LockGate>
  )
}

export default App
