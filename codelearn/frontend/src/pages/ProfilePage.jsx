import React, { useEffect, useState } from 'react';
import { api } from '../api';
import './ProfilePage.css';

function getInitials(username) { return (username || '?').slice(0, 2).toUpperCase(); }
function getAvatarColor(username) {
  const colors = ['#7c6af7','#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4'];
  let hash = 0;
  for (let i = 0; i < (username||'').length; i++) hash = username.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

const DIFF_COLOR = { easy: '#34d399', medium: '#fbbf24', hard: '#f87171' };
const DIFF_LABEL = { easy: 'лёгкая', medium: 'средняя', hard: 'сложная' };

export default function ProfilePage({ username, onBack }) {
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState({});

  // Создание курса
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ title: '', description: '', language: 'python' });
  const [creating, setCreating] = useState(false);
  const [createResult, setCreateResult] = useState(null); // { accessCode }

  useEffect(() => { load(); }, []);

  function load() {
    setLoading(true);
    api.getCourses().then(data => {
      setCourses(data.courses || []);
      setLoading(false);
    });
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!createForm.title.trim()) return;
    setCreating(true);
    const data = await api.createCourse(createForm.title, createForm.description, createForm.language);
    if (data.accessCode) {
      setCreateResult(data);
      setCreateForm({ title: '', description: '', language: 'python' });
      load();
    }
    setCreating(false);
  }

  const avatarColor = getAvatarColor(username);
  const totalSolved = courses.reduce((s, c) => s + c.solvedCount, 0);
  const totalTasks = courses.reduce((s, c) => s + c.taskCount, 0);

  return (
    <div className="profile-layout">
      <header className="profile-header">
        <button className="profile-back" onClick={onBack}>← Назад</button>
        <div className="profile-header-logo">
          <span style={{ color: 'var(--accent)' }}>&lt;</span>CodeLearn<span style={{ color: 'var(--accent)' }}>/&gt;</span>
        </div>
        <div style={{ width: 80 }} />
      </header>

      <main className="profile-main">
        {/* Карточка пользователя */}
        <div className="profile-card">
          <div className="profile-avatar-lg" style={{ background: avatarColor }}>{getInitials(username)}</div>
          <div className="profile-card-info">
            <div className="profile-username">@{username}</div>
            <div className="profile-stats-row">
              <div className="profile-stat">
                <span className="profile-stat-num">{totalSolved}</span>
                <span className="profile-stat-label">решено задач</span>
              </div>
              <div className="profile-stat-divider" />
              <div className="profile-stat">
                <span className="profile-stat-num">{courses.length}</span>
                <span className="profile-stat-label">{courses.length === 1 ? 'курс' : 'курсов'}</span>
              </div>
              <div className="profile-stat-divider" />
              <div className="profile-stat">
                <span className="profile-stat-num">{totalTasks > 0 ? Math.round(totalSolved/totalTasks*100) : 0}%</span>
                <span className="profile-stat-label">прогресс</span>
              </div>
            </div>
          </div>
        </div>

        {/* Кнопка создать курс */}
        <div className="profile-section-header">
          <div className="profile-section-title">Мои курсы</div>
          <button className="profile-create-btn" onClick={() => { setShowCreate(!showCreate); setCreateResult(null); }}>
            {showCreate ? '✕ Отмена' : '+ Создать курс'}
          </button>
        </div>

        {/* Форма создания курса */}
        {showCreate && (
          <div className="profile-create-form-wrap">
            {createResult ? (
              <div className="profile-create-success">
                <div className="profile-create-success-title">✓ Курс создан!</div>
                <p>Поделитесь этим кодом со студентами:</p>
                <div className="profile-access-code">{createResult.accessCode}</div>
                <button className="profile-create-another" onClick={() => { setCreateResult(null); setShowCreate(false); }}>
                  Готово
                </button>
              </div>
            ) : (
              <form className="profile-create-form" onSubmit={handleCreate}>
                <div className="profile-form-field">
                  <label>Название курса</label>
                  <input
                    value={createForm.title}
                    onChange={e => setCreateForm(f => ({ ...f, title: e.target.value }))}
                    placeholder="Например: Алгоритмы для группы 101"
                    required
                  />
                </div>
                <div className="profile-form-field">
                  <label>Описание (необязательно)</label>
                  <input
                    value={createForm.description}
                    onChange={e => setCreateForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="Краткое описание курса"
                  />
                </div>
                <div className="profile-form-field">
                  <label>Язык программирования</label>
                  <select
                    value={createForm.language}
                    onChange={e => setCreateForm(f => ({ ...f, language: e.target.value }))}
                  >
                    <option value="python">Python 🐍</option>
                    <option value="javascript">JavaScript ⚡</option>
                    <option value="ruby">Ruby 💎</option>
                  </select>
                </div>
                <button className="profile-create-submit" type="submit" disabled={creating || !createForm.title.trim()}>
                  {creating ? 'Создаём...' : 'Создать курс'}
                </button>
              </form>
            )}
          </div>
        )}

        {/* Список курсов */}
        {loading ? (
          <div className="profile-loading">загрузка...</div>
        ) : (
          <div className="profile-courses">
            {courses.map(course => {
              const pct = course.taskCount > 0 ? Math.round((course.solvedCount / course.taskCount) * 100) : 0;
              const isOpen = expanded[course.id];
              return (
                <div key={course.id} className="profile-course-card">
                  <button
                    className="profile-course-header"
                    onClick={() => setExpanded(e => ({ ...e, [course.id]: !e[course.id] }))}
                  >
                    <div className="profile-course-left">
                      <div>
                        <div className="profile-course-title">{course.title}</div>
                        {course.isOwner && course.accessCode && (
                          <div className="profile-course-code">Код: <span>{course.accessCode}</span></div>
                        )}
                      </div>
                    </div>
                    <div className="profile-course-right">
                      <span className="profile-course-count">{course.solvedCount}/{course.taskCount}</span>
                      <span className={`profile-course-chevron ${isOpen ? 'open' : ''}`}>›</span>
                    </div>
                  </button>
                  <div className="profile-course-progress-wrap">
                    <div className="profile-course-progress-bar">
                      <div className="profile-course-progress-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="profile-course-pct">{pct}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
