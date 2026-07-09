import React, { useState } from 'react';
import { api } from '../api';
import './AuthPage.css';

export default function AuthPage({ onAuth }) {
  const [mode, setMode] = useState('login'); // login | register
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const fn = mode === 'login' ? api.login : api.register;
      const data = await fn(username, password);
      if (data.error) {
        setError(data.error);
      } else {
        localStorage.setItem('token', data.token);
        onAuth(data.username);
      }
    } catch {
      setError('Ошибка сети');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-bg">
      <div className="auth-grid" />
      <div className="auth-card">
        <div className="auth-logo">
          <span className="auth-logo-bracket">&lt;</span>
          CodeLearn
          <span className="auth-logo-bracket">/&gt;</span>
        </div>
        <p className="auth-tagline">Учись программировать прямо в браузере</p>

        <div className="auth-tabs">
          <button
            className={`auth-tab ${mode === 'login' ? 'active' : ''}`}
            onClick={() => { setMode('login'); setError(''); }}
          >
            Войти
          </button>
          <button
            className={`auth-tab ${mode === 'register' ? 'active' : ''}`}
            onClick={() => { setMode('register'); setError(''); }}
          >
            Регистрация
          </button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="auth-field">
            <label>Логин</label>
            <input
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="введите логин"
              required
              autoComplete="username"
            />
          </div>
          <div className="auth-field">
            <label>Пароль</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="введите пароль"
              required
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </div>

          {error && <div className="auth-error">{error}</div>}

          <button className="auth-btn" type="submit" disabled={loading}>
            {loading ? '...' : mode === 'login' ? 'Войти' : 'Создать аккаунт'}
          </button>
        </form>

        <div className="auth-wasm-badge">
          ⚡ Python выполняется через WebAssembly — прямо в браузере
        </div>
      </div>
    </div>
  );
}
