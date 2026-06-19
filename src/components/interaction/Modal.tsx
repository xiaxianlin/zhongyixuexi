/**
 * Modal — generic interaction component (pure props, domain-agnostic).
 *
 * The shared shell for every modal in the app: a fixed backdrop + a card with a
 * title bar (h3 + × close) + a content slot + an actions slot. Reused by the
 * paragraph/note/merge/new-book editors so they don't each re-implement the same
 * backdrop/head/actions JSX (project rule: any interaction appearing 2+ times
 * is extracted to this layer).
 *
 * Reuses the existing `bookdetail__modal*` classes — they are `position: fixed`
 * so they work in any view, not just the book-detail page.
 *
 * `onClose` fires on × / backdrop click / Esc. The content/actions are passed as
 * render slots so each caller keeps full control of its inputs and buttons.
 */
import { useEffect, type ReactNode } from 'react'

interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
  /** Bottom action row (buttons). Rendered inside `.bookdetail__modalActions`. */
  actions?: ReactNode
  /** Size variant. 'default' (620px) for editors, 'confirm' (420px) for simple
   *  confirm prompts. Defaults to 'default'. */
  size?: 'default' | 'confirm'
}

export function Modal({ title, onClose, children, actions, size = 'default' }: ModalProps) {
  // Esc closes — one global keydown listener per open modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="bookdetail__modalBackdrop"
      role="dialog"
      aria-modal="true"
      // Click on the backdrop (not the card) closes; stopPropagation on the card
      // prevents a click inside from bubbling up and closing.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className={size === 'confirm' ? 'bookdetail__modal bookdetail__modal--confirm' : 'bookdetail__modal'}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bookdetail__modalHead">
          <h3>{title}</h3>
          <button type="button" onClick={onClose}>
            ×
          </button>
        </div>
        {children}
        {actions && <div className="bookdetail__modalActions">{actions}</div>}
      </div>
    </div>
  )
}
