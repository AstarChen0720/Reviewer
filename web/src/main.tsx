import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { runLocalStorageMigrationOnce } from './storage/repo';
import { startLocalStorageDexieMirror } from './storage/mirror';
import './index.css';

runLocalStorageMigrationOnce().finally(()=>{
  startLocalStorageDexieMirror();
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});
