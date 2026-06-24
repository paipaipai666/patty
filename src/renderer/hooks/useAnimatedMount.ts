import { useState, useEffect, useRef } from 'react'

export function useAnimatedMount(show: boolean, exitDuration = 200) {
  const [mounted, setMounted] = useState(show)
  const [exiting, setExiting] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

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
      return () => clearTimeout(timerRef.current)
    }
  }, [show, exitDuration])

  return { mounted, exiting }
}
