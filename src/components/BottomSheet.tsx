import { useEffect, useRef, useState, type ReactNode } from 'react'
import styles from './BottomSheet.module.css'

interface Props {
  open: boolean
  onClose: () => void
  /** Enable pointer drag-to-dismiss on the grab handle. */
  draggable?: boolean
  children: ReactNode
}

/**
 * Rounded-top sheet that slides up from the bottom over a scrim. Optional
 * drag-to-dismiss on the handle (release past ~90px closes), ported from the
 * design prototype. The scrim fades as you drag.
 */
export function BottomSheet({ open, onClose, draggable = false, children }: Props) {
  const [dragY, setDragY] = useState(0)
  const [dragging, setDragging] = useState(false)
  const start = useRef<number | null>(null)

  // Reset the drag offset whenever the sheet opens/closes.
  useEffect(() => {
    if (!open) {
      setDragY(0)
      setDragging(false)
    }
  }, [open])

  const onDown = (e: React.PointerEvent) => {
    if (!draggable) return
    start.current = e.clientY
    setDragging(true)
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* not fatal */
    }
  }
  const onMove = (e: React.PointerEvent) => {
    if (start.current == null) return
    setDragY(Math.max(0, e.clientY - start.current))
  }
  const onUp = () => {
    if (start.current == null) return
    const shouldClose = dragY > 90
    start.current = null
    setDragging(false)
    setDragY(0)
    if (shouldClose) onClose()
  }

  return (
    <>
      <div
        className={styles.backdrop}
        style={{
          opacity: open ? Math.max(0, 1 - dragY / 300) : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: dragging ? 'none' : undefined,
        }}
        onClick={onClose}
      />
      <div
        className={styles.sheet}
        style={{
          transform: open ? `translateY(${dragY}px)` : 'translateY(110%)',
          transition: dragging ? 'none' : undefined,
        }}
      >
        <div
          className={styles.grab}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          style={{ cursor: draggable ? 'grab' : 'default', touchAction: 'none' }}
        >
          <div className={styles.grabBar} />
        </div>
        {children}
      </div>
    </>
  )
}
