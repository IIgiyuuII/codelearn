import React, { useEffect, useState } from 'react';
import { api } from '../api';
import './TasksPage.css';

const DIFF_LABEL = { easy: 'лёгкая', medium: 'средняя', hard: 'сложная' };
const DIFF_COLOR = { easy: '#34d399', medium: '#fbbf24', hard: '#f87171' };

function getInitials(username) {
  if (!username) return '?';
  return username.slice(0, 2).toUpperCase();
}

function getAvatarColor(username) {
  const colors = ['#7c6af7', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];
  let hash = 0;
  for (let i = 0; i < (username || '').length; i++) hash = username.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

export default function TasksPage({ username, onSelectTask, onLogout, onProfile }) {
  const [tasks, setTasks] = useState([]);
  const [solved, setSolved] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getTasks().then(data => {
      setTasks(data.tasks || []);
      setSolved(data.solvedTasks || []);
      setLoading(false);
    });
  }, []);

  const avatarColor = getAvatarColor(username);
  const initials = getInitials(username);

  return (
    <div className="tasks-layout">
      <header className="tasks-header">
        <div className="tasks-logo">
          <span style={{ color: 'var(--accent)' }}>&lt;</span>
          CodeLearn
          <span style={{ color: 'var(--accent)' }}>/&gt;</span>
        </div>
        <div className="tasks-header-right">
          <div className="tasks-progress">
            <span className="tasks-progress-num">{solved.length}</span>
            <span className="tasks-progress-sep">/</span>
            <span className="tasks-progress-total">{tasks.length}</span>
            <span className="tasks-progress-label">решено</span>
          </div>

          {/* Аватарка — клик открывает профиль */}
          <button
            className="tasks-avatar"
            style={{ background: avatarColor }}
            onClick={onProfile}
            title={`@${username} — открыть профиль`}
          >
            {initials}
          </button>

          <button className="tasks-logout" onClick={onLogout}>выйти</button>
        </div>
      </header>

      <main className="tasks-main">
        <div className="tasks-title-block">
          <h1 className="tasks-title">Задачи</h1>
          <p className="tasks-subtitle">Python · Выполнение через WebAssembly в вашем браузере</p>
        </div>

        {loading ? (
          <div className="tasks-loading">загрузка...</div>
        ) : (
          <div className="tasks-grid">
            {tasks.map((task, i) => {
              const isSolved = solved.includes(task.id);
              return (
                <button
                  key={task.id}
                  className={`task-card ${isSolved ? 'solved' : ''}`}
                  onClick={() => onSelectTask(task.id)}
                >
                  <div className="task-card-top">
                    <span className="task-card-num">#{String(i + 1).padStart(2, '0')}</span>
                    {isSolved && <span className="task-card-check">✓</span>}
                  </div>
                  <div className="task-card-title">{task.title}</div>
                  <div className="task-card-bottom">
                    <span className="task-card-topic">{task.topic}</span>
                    <span className="task-card-diff" style={{ color: DIFF_COLOR[task.difficulty] }}>
                      {DIFF_LABEL[task.difficulty]}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
