import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Подавляем ResizeObserver loop — известный баг Monaco Editor
// Срабатывает при изменении размера редактора, на работу не влияет
window.addEventListener('error', (e) => {
  if (e.message?.includes('ResizeObserver loop')) {
    e.stopImmediatePropagation();
    e.preventDefault();
    return false;
  }
});

// Перехватываем также через ErrorEvent на window
const origOnError = window.onerror;
window.onerror = function(msg, src, line, col, err) {
  if (typeof msg === 'string' && msg.includes('ResizeObserver')) return true;
  return origOnError?.apply(this, arguments);
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);