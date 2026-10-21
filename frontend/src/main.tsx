import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { IS_DEMO } from './lib/demo';
import './styles.css';

async function start() {
  if (IS_DEMO) {
    const { installDemoServer } = await import('./demo/demoServer');
    installDemoServer();
  }
  createRoot(document.getElementById('root') as HTMLElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void start();
