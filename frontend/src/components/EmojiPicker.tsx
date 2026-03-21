import { useEffect, useRef } from 'react'

const EMOJIS = [
  // Smileys
  '😀','😂','🥹','😊','😍','🤣','😅','😭','😤','🥺',
  '😬','🤔','😴','🤗','😎','🙄','😢','😡','🤯','😱',
  '😋','😜','🤪','😇','🥳','🫡','🫠','🤭','😏','😐',
  // Gestures
  '👍','👎','👏','🙌','🤝','👋','🙏','💪','🤞','✌️',
  '👌','🤌','🤙','☝️','🫶','🫂',
  // Hearts & symbols
  '❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','❣️',
  '💯','🔥','✨','🎉','🎊','⭐','🌟','💫','🌈','🎵',
  '🚀','💡','🎮','📱','💬',
  // Nature & animals
  '🌸','🌺','🌻','🌴','🍀','🦋','🐶','🐱','🐻','🦄',
]

interface Props {
  onSelect: (emoji: string) => void
  onClose: () => void
}

export default function EmojiPicker({ onSelect, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return (
    <div
      ref={ref}
      className="absolute bottom-full mb-2 right-0 w-72 max-h-52 overflow-y-auto bg-gray-800 border border-gray-700 rounded-xl p-2 shadow-2xl z-20"
    >
      <div className="grid grid-cols-8 gap-0.5">
        {EMOJIS.map(e => (
          <button
            key={e}
            onClick={() => onSelect(e)}
            className="text-xl p-1.5 hover:bg-gray-700 rounded-lg transition-colors leading-none"
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  )
}
