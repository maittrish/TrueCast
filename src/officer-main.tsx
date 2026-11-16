import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import OfficerApp from './OfficerApp.tsx';
import './index.css';

createRoot(document.getElementById('officer-root')!).render(
  <StrictMode>
    <OfficerApp />
  </StrictMode>
);
