import { useRef, useState, type ReactNode } from 'react'
import { TrashIcon } from './icons'
import styles from './SwipeableRow.module.css'

const REVEAL = 88 // px of red "Delete" revealed when open
const TAP_SLOP = 8 // px before a drag counts as a swipe (not a tap)

interface Props {
  children: ReactNode
  onDelete: () => void
}

/**
 * iOS-style swipe-to-delete. Drag the row left to reveal a red Delete button;
 * tap it to remove. A normal tap (no horizontal drag) passes through to the
 * child link, and vertical drags leave page scrolling untouched.
 */
export function SwipeableRow({ children, onDelete }: Props) {
  const [dx, setDx] = useState(0)
  const [open, setOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const g = useRef<{ x: number; y: number; base: number; moved: boolean; horiz: boolean } | null>(
    null,
  )
  const suppressClick = useRef(false)

  const onPointerDown = (e: React.PointerEvent) => {
    g.current = { x: e.clientX, y: e.clientY, base: open ? -REVEAL : 0, moved: false, horiz: false }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const s = g.current
    if (!s) return
    const dX = e.clientX - s.x
    const dY = e.clientY - s.y
    if (!s.horiz) {
      if (Math.abs(dX) > TAP_SLOP && Math.abs(dX) > Math.abs(dY)) {
        s.horiz = true
        setDragging(true)
        e.currentTarget.setPointerCapture(e.pointerId)
      } else if (Math.abs(dY) > TAP_SLOP) {
        g.current = null // vertical scroll — let the page handle it
        return
      } else {
        return
      }
    }
    s.moved = true
    setDx(Math.max(-REVEAL, Math.min(0, s.base + dX)))
  }

  const onPointerUp = () => {
    const s = g.current
    g.current = null
    setDragging(false)
    if (!s || !s.moved) return
    suppressClick.current = true
    const shouldOpen = dx <= -REVEAL / 2
    setOpen(shouldOpen)
    setDx(shouldOpen ? -REVEAL : 0)
  }

  const close = () => {
    setOpen(false)
    setDx(0)
  }

  const onClickCapture = (e: React.MouseEvent) => {
    if (suppressClick.current) {
      suppressClick.current = false
      e.preventDefault()
      e.stopPropagation()
      return
    }
    if (open) {
      e.preventDefault()
      e.stopPropagation()
      close()
    }
  }

  return (
    <div className={styles.row}>
      <button
        className={styles.delete}
        style={{ width: REVEAL }}
        tabIndex={open ? 0 : -1}
        aria-hidden={!open}
        aria-label="Delete"
        onClick={() => {
          onDelete()
          close()
        }}
      >
        <TrashIcon size={20} />
        <span>Delete</span>
      </button>
      <div
        className={styles.fg}
        style={{ transform: `translateX(${dx}px)`, transition: dragging ? 'none' : undefined }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={onClickCapture}
      >
        {children}
      </div>
    </div>
  )
}
