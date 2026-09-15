import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { IntroSplash } from './components/IntroSplash';
import { ErrorBoundary } from './components/ErrorBoundary';
import './theme.css';

const root = document.getElementById('root');
if (root === null) throw new Error('#root element is missing from index.html');

createRoot(root).render(
  <StrictMode>
    {/* OUTSIDE IntroSplash on purpose: a throw from the splash itself has to
        be caught too, and the splash is the one component that can hold the
        whole screen. */}
    <ErrorBoundary>
      <IntroSplash>
        <App />
      </IntroSplash>
    </ErrorBoundary>
  </StrictMode>,
);
