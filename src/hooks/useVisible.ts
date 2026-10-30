import { useEffect, useRef, useState } from 'react'

export function useVisible<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (visible) return
    const element = ref.current
    if (!element) return
    if (!globalThis.IntersectionObserver) { setVisible(true); return }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setVisible(true); observer.disconnect() }
    }, { rootMargin: '150px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [visible])
  return { ref, visible }
}
