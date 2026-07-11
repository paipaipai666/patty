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

  ripple.animate(
    [
      { transform: 'translate(-50%, -50%) scale(0)', opacity: 0.4 },
      { transform: `translate(-50%, -50%) scale(${maxDim / 20})`, opacity: 0 }
    ],
    { duration: 700, easing: 'ease-out', fill: 'forwards' }
  ).onfinish = () => ripple.remove()
}
