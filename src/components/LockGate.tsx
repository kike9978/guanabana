import type { ReactNode } from 'react'
import { features } from '../app/features'
import { FooterHint } from './hud'
import { Icon } from './Icon'

export function LockGate({ children }: { children: ReactNode }) {
  if (!features.lock) return children

  return (
    <div className="lock-gate">
      <Icon name="lock" size={32} />
      <FooterHint>Desbloquea Puente para ver tus datos.</FooterHint>
    </div>
  )
}
