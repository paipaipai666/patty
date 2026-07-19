import { create } from 'zustand'

export interface Toast {
  id: number
  message: string
  kind: 'error' | 'info'
}

interface ToastStore {
  toasts: Toast[]
  push: (message: string, kind?: Toast['kind']) => void
  dismiss: (id: number) => void
}

let nextId = 1

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  push: (message, kind = 'error') => {
    const id = nextId++
    set((s) => ({ toasts: [...s.toasts, { id, message, kind }] }))
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, 4500)
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))

/** Fire-and-forget toast for non-component call sites (IPC handlers, stores). */
export function toast(message: string, kind: Toast['kind'] = 'error'): void {
  useToastStore.getState().push(message, kind)
}
