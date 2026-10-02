import React from 'react';
import {createRoot} from 'react-dom/client';
import {App} from './App';
import 'instantsearch.css/components/chat.css';
import './styles.css';
import './integration.css';
createRoot(document.getElementById('root')!).render(<App/>);
