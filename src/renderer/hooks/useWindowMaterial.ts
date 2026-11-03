import { useEffect } from 'react'
import { useSettingsStore } from '../store/settingsStore'
import { getThemeColors } from '../styles/themes'
import type { WindowMaterialRequest } from '../../shared/windowMaterial'

export function useWindowMaterial() {
  const theme = useSettingsStore(state => state.settings.theme)
  const customThemes = useSettingsStore(state => state.settings.customThemes)
  const policy = useSettingsStore(state => state.settings.windowMaterial)
  const loaded = useSettingsStore(state => state.loaded)
  useEffect(() => {
    const root = document.documentElement
    root.dataset.windowMaterial = 'solid'
    if (!loaded) return
    const apply = window.terminalAPI.windowSetMaterial
    if (!apply) return
    const color = getThemeColors(theme, customThemes).ui['--bg-sidebar']
    if (!/^#[\da-f]{6}$/i.test(color)) return
    const background: WindowMaterialRequest['background'] = [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)]
    const brightness = background[0] * 0.2126 + background[1] * 0.7152 + background[2] * 0.0722
    const contrast = window.matchMedia?.('(forced-colors: active)')
    let revision = 0
    let disposed = false
    const refresh = async () => {
      const request = ++revision
      try {
        const material = await apply({ enabled: policy === 'auto' && !contrast?.matches && !document.hidden && document.hasFocus(), appearance: brightness >= 128 ? 'light' : 'dark', background })
        if (!disposed && request === revision) root.dataset.windowMaterial = material
      } catch {
        if (!disposed && request === revision) root.dataset.windowMaterial = 'solid'
      }
    }
    const update = () => { void refresh() }
    update()
    const timer = window.setInterval(() => { if (policy === 'auto' && !document.hidden && document.hasFocus()) update() }, 2000)
    window.addEventListener('focus', update)
    window.addEventListener('blur', update)
    document.addEventListener('visibilitychange', update)
    contrast?.addEventListener('change', update)
    return () => {
      disposed = true
      window.clearInterval(timer)
      window.removeEventListener('focus', update)
      window.removeEventListener('blur', update)
      document.removeEventListener('visibilitychange', update)
      contrast?.removeEventListener('change', update)
      root.dataset.windowMaterial = 'solid'
    }
  }, [theme, customThemes, policy, loaded])
}
