import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// React Flow's structural styles come first, so the theme's stylesheets (loaded by the theme module) override them.
import '@xyflow/react/dist/base.css';
import { App } from './App.tsx';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element.');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
