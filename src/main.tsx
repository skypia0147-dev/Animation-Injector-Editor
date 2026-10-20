import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './WorkspaceApp';
import '@xyflow/react/dist/style.css';
import './style.css';
import './theme.css';
import './ui/details/details.css';
import './graph/graph.css';
import './viewport/viewport.css';
import './ui/finish.css';
import './ui/graphite.css';
import {applyUiScale, storedUiScale} from './ui/uiScale.ts';

applyUiScale(storedUiScale(), false);

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
