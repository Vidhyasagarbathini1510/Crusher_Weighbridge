// React entry point. Mounts <App/> and loads Bootstrap 5 styling.
import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import 'bootstrap/dist/css/bootstrap.min.css';
import './styles.css';
import App from './App.jsx';
import { restorePrintSettings } from './utils/printHelper.js';

// HashRouter is used (not BrowserRouter) because Electron loads index.html via
// file://, where path-based routing breaks but hash routing works cleanly.
// Print settings are read back from the database before the first screen
// renders, so the saved template and printer are in place when pages load.
restorePrintSettings().finally(() => {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </HashRouter>
  );
});
