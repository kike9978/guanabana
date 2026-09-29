import { useEffect, useRef } from 'react'
import { ADD_TYPES, type AddType } from '../app/navigation'
import { FooterHint } from './hud'

export function AddSheet({
  open,
  onClose,
  onPick,
}: {
  open: boolean
  onClose: () => void
  onPick: (type: AddType) => void
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-label="Agregar"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <header className="panel-head">
        <h2 className="panel-title">Agregar</h2>
      </header>
      <ul className="sheet-list">
        {ADD_TYPES.map((type) => (
          <li key={type.id}>
            <button type="button" className="sheet-item" onClick={() => onPick(type.id)}>
              <span className="key-glyph">{type.key}</span>
              <span>{type.label}</span>
            </button>
          </li>
        ))}
      </ul>
      <FooterHint>Elige qué quieres registrar.</FooterHint>
    </dialog>
  )
}
