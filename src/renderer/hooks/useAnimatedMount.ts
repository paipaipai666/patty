import { useState, useEffect, useRef } from 'react'

export function useAnimatedMount(show: boolean, exitDuration = 200) {
  const [mounted, setMounted] = useState(show)
  const [exiting, setExiting] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (show) {
      setExiting(false)
      setMounted(true)
    } else {
      setExiting(true)
      timerRef.current = setTimeout(() => {
        setMounted(false)
        setExiting(false)
      }, exitDuration)
      return () => {
        if (timerRef.current) clearTimeout(timerRef.current)
      }
    }
  }, [show, exitDuration])

  return { mounted, exiting }
}
