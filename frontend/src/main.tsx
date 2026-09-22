import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { storage } from './db';
import { Journal } from './journal';
import './style.css';

const journal = new Journal(storage());
let notifyUpdate = () => {};
let waitingUpdate = false;
const update = registerSW({ onNeedRefresh() { waitingUpdate = true; notifyUpdate(); } });
function Root() {
  const [available, setAvailable] = useState(waitingUpdate);
  notifyUpdate = () => setAvailable(true);
  return <App journal={journal} updateAvailable={available} applyUpdate={() => {
    void journal.flush().then(() => { if (!journal.state.localError) void update(true); });
  }} />;
}
createRoot(document.getElementById('root')!).render(<Root />);
void journal.init();
