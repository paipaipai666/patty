import gsap from 'gsap'

/**
 * Create a radial ripple effect when switching themes.
 * Call from the theme picker's click handler.
 */
export function themeRipple(originX: number, originY: number, newBg: string): void {
  const ripple = document.createElement('div')
  ripple.style.cssText = `
    position: fixed;
    left: ${originX}px;
    top: ${originY}px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: ${newBg};
    transform: translate(-50%, -50%) scale(0);
    pointer-events: none;
    z-index: 99999;
  `
  document.body.appendChild(ripple)

  const maxDim = Math.max(window.innerWidth, window.innerHeight) * 2.5

  gsap.to(ripple, {
    scale: maxDim / 20,
    duration: 0.7,
    ease: 'power2.out',
    onComplete: () => {
      if (ripple.parentNode) ripple.parentNode.removeChild(ripple)
    }
  })
}
