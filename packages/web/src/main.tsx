import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { IntroSplash } from './components/IntroSplash';
import './theme.css';

const root = document.getElementById('root');
if (root === null) throw new Error('#root element is missing from index.html');

createRoot(root).render(
  <StrictMode>
    <IntroSplash>
      <App />
    </IntroSplash>
  </StrictMode>,
);
