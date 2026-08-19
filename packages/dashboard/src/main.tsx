import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './globals.css'

const container = document.getElementById('root')
if (!container) throw new Error('Dashboard root element is missing')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
