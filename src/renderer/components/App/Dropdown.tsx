import { useEffect, useRef, useState } from 'react'
import styles from './Dropdown.module.css'

export interface DropdownOption<T extends string> {
  value: T
  label: string
  /** Group header shown above this option when it differs from the previous one. */
  group?: string
}

interface DropdownProps<T extends string> {
  /** Current value; its option label shows on the closed control. */
  value: T
  options: DropdownOption<T>[]
  onSelect: (value: T, mouse?: { x: number; y: number }) => void
  /** Override the closed-control text (defaults to the selected option's label). */
  display?: string
  /** Editable input filters options by label while open. */
  searchable?: boolean
  searchPlaceholder?: string
  loading?: boolean
  emptyText?: string
  ariaLabel: string
  /** Called when the dropdown opens (e.g. lazy-load the options). */
  onOpen?: () => void
}

/**
 * Shared accessible dropdown: listbox semantics, arrow-key navigation,
 * Enter to select, Esc/click-outside to close. Replaces the three hand-rolled
 * pickers that each re-implemented open/click-outside state.
 */
export function Dropdown<T extends string>({
  value,
  options,
  onSelect,
  display,
  searchable = false,
  searchPlaceholder,
  loading = false,
  emptyText = 'Nothing found',
  ariaLabel,
  onOpen
}: DropdownProps<T>) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const close = () => {
    setOpen(false)
    setSearch('')
  }
  const toggle = () => {
    if (!open) {
      onOpen?.()
      const current = filtered.findIndex((o) => o.value === value)
      setActiveIndex(current >= 0 ? current : 0)
    }
    setOpen(!open)
  }

  // Click-outside closes.
  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const filtered = searchable && search
    ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
    : options

  // Keep the active option visible while navigating by keyboard.
  useEffect(() => {
    if (!open) return
    // scrollIntoView is an enhancement; jsdom (tests) doesn't implement it.
    listRef.current
      ?.querySelector(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView?.({ block: 'nearest' })
  }, [activeIndex, open])

  const pick = (option: DropdownOption<T>, mouse?: { x: number; y: number }) => {
    onSelect(option.value, mouse)
    close()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        toggle()
      }
      return
    }
    switch (e.key) {
      case 'Escape':
        e.preventDefault()
        e.stopPropagation()
        close()
        break
      case 'ArrowDown':
        e.preventDefault()
        setActiveIndex((i) => Math.min(i + 1, filtered.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setActiveIndex((i) => Math.max(i - 1, 0))
        break
      case 'Home':
        e.preventDefault()
        setActiveIndex(0)
        break
      case 'End':
        e.preventDefault()
        setActiveIndex(filtered.length - 1)
        break
      case 'Enter': {
        e.preventDefault()
        const option = filtered[activeIndex]
        if (option) pick(option)
        break
      }
    }
  }

  const shownText = open && searchable ? search : (display ?? options.find((o) => o.value === value)?.label ?? value)

  let lastGroup: string | undefined
  return (
    <div className={styles.dropdown} ref={containerRef}>
      <input
        className={styles.dropdownInput}
        role="combobox"
        aria-expanded={open}
        aria-label={ariaLabel}
        value={shownText}
        placeholder={searchable ? searchPlaceholder : undefined}
        readOnly={!searchable}
        onClick={() => {
          if (!open) toggle()
        }}
        onFocus={() => {
          if (searchable && !open) toggle()
        }}
        onChange={(e) => {
          if (searchable) setSearch(e.target.value)
        }}
        onKeyDown={handleKeyDown}
      />
      {open && (
        <div className={styles.dropdownList} role="listbox" ref={listRef} aria-label={ariaLabel}>
          {loading ? (
            <div className={styles.dropdownEmpty}>Loading…</div>
          ) : filtered.length === 0 ? (
            <div className={styles.dropdownEmpty}>{emptyText}</div>
          ) : (
            filtered.map((option, i) => {
              const groupHeader = option.group !== undefined && option.group !== lastGroup
              lastGroup = option.group ?? lastGroup
              return (
                <div key={option.value}>
                  {groupHeader && (
                    <div className={styles.dropdownGroup} role="presentation">
                      {option.group}
                    </div>
                  )}
                  <div
                    role="option"
                    aria-selected={option.value === value}
                    data-index={i}
                    className={`${styles.dropdownOption} ${option.value === value ? styles.dropdownOptionSelected : ''} ${i === activeIndex ? styles.dropdownOptionActive : ''}`}
                    onMouseEnter={() => setActiveIndex(i)}
                    onMouseDown={(e) => {
                      // mousedown, not click: fires before the input's blur.
                      e.preventDefault()
                      pick(option, { x: e.clientX, y: e.clientY })
                    }}
                  >
                    {option.label}
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
