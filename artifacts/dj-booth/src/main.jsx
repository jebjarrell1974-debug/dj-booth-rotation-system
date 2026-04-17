import React from 'react'
import ReactDOM from 'react-dom/client'
import { initErrorCapture } from '@/lib/errorCapture'
import { startHealthMonitoring } from '@/lib/systemHealth'
import App from '@/App.jsx'
import '@/index.css'

initErrorCapture();
startHealthMonitoring();

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
