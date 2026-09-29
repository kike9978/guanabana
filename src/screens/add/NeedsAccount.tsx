import { FooterHint } from '../../components/hud'

export function NeedsAccount({ onOpenAccounts, message }: { onOpenAccounts: () => void; message?: string }) {
  return (
    <div className="form">
      <FooterHint>{message ?? 'Primero agrega una cuenta, una tarjeta o tu saldo inicial.'}</FooterHint>
      <div className="verb-row">
        <button type="button" className="verb-button verb-primary" onClick={onOpenAccounts}>
          <span className="key-glyph">A</span>
          Ir a cuentas
        </button>
      </div>
    </div>
  )
}
