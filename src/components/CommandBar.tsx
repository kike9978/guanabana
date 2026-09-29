import { TABS, type TabId } from '../app/navigation'
import { Icon } from './Icon'

export function CommandBar({
  active,
  onSelect,
  onAdd,
}: {
  active: TabId | null
  onSelect: (tab: TabId) => void
  onAdd: () => void
}) {
  return (
    <nav className="command-bar" aria-label="Secciones">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className="command"
          aria-current={active === tab.id ? 'page' : undefined}
          onClick={() => onSelect(tab.id)}
        >
          <Icon name={tab.id} />
          <span className="command-label">{tab.label}</span>
        </button>
      ))}
      <button type="button" className="command command-add" onClick={onAdd} aria-haspopup="dialog">
        <Icon name="add" />
        <span className="command-label">Agregar</span>
      </button>
    </nav>
  )
}
