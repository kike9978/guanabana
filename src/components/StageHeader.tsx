import { features } from '../app/features'
import { Icon } from './Icon'

export function StageHeader({
  title,
  aiBridge = false,
  share = false,
  onAi,
}: {
  title: string
  aiBridge?: boolean
  share?: boolean
  onAi?: () => void
}) {
  const showAi = aiBridge && features.aiBridge
  const showShare = share && features.share

  return (
    <div className="stage-header">
      <h1 className="stage-title">{title}</h1>
      {(showAi || showShare) && (
        <div className="stage-verbs">
          {showAi && (
            <button type="button" className="verb" aria-label="Guanabana IA" onClick={onAi}>
              <Icon name="sparkle" size={18} />
            </button>
          )}
          {showShare && (
            <button type="button" className="verb" aria-label="Compartir">
              <Icon name="share" size={18} />
            </button>
          )}
        </div>
      )}
    </div>
  )
}
