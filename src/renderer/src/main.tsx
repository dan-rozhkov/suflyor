import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/nunito'
import './styles/tokens.css'
import './styles/base.css'
import { App } from './App'

// A system theme flip must snap: without this every colour transition fires at once and the switch smears.
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  const css = document.createElement('style')
  css.textContent = '*,*::before,*::after{transition:none !important}'
  document.head.appendChild(css)
  void window.getComputedStyle(document.body).opacity
  requestAnimationFrame(() => css.remove())
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
