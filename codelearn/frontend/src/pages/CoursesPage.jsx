import React, { useEffect, useState } from 'react';
import { api } from '../api';
import './CoursesPage.css';

const LANG_ICON = { python: '🐍', ruby: '💎', javascript: '⚡', default: '📚' };
const LANG_COLOR = { python: '#3b82f6', ruby: '#e11d48', javascript: '#eab308', default: '#7c6af7' };

function getInitials(username) {
  return (username || '?').slice(0, 2).toUpperCase();
}
function getAvatarColor(username) {
  const colors = ['#7c6af7','#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4'];
  let hash = 0;
  for (let i = 0; i < (username||'').length; i++) hash = username.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

export default function CoursesPage({ username, onSelectCourse, onProfile, onLogout }) {
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [joinCode, setJoinCode] = useState('');
  const [joinMsg, setJoinMsg] = useState(null);
  const [joiningLoading, setJoiningLoading] = useState(false);

  useEffect(() => {
    load();
  }, []);

  function load() {
    setLoading(true);
    api.getCourses().then(data => {
      setCourses(data.courses || []);
      setLoading(false);
    });
  }

  async function handleJoin(e) {
    e.preventDefault();
    if (!joinCode.trim()) return;
    setJoiningLoading(true);
    setJoinMsg(null);
    const data = await api.joinCourse(joinCode.trim());
    if (data.error) {
      setJoinMsg({ type: 'error', text: data.error });
    } else {
      setJoinMsg({ type: 'success', text: data.message });
      setJoinCode('');
      load();
    }
    setJoiningLoading(false);
  }

  const avatarColor = getAvatarColor(username);

  return (
    <div className="courses-layout">
      <header className="courses-header">
        <div className="courses-logo">
          <span style={{ color: 'var(--accent)' }}>&lt;</span>CodeLearn<span style={{ color: 'var(--accent)' }}>/&gt;</span>
        </div>
        <div className="courses-header-right">
          <button className="courses-avatar" style={{ background: avatarColor }} onClick={onProfile} title="Профиль">
            {getInitials(username)}
          </button>
          <button className="courses-logout" onClick={onLogout}>выйти</button>
        </div>
      </header>

      <main className="courses-main">
        <div className="courses-title-block">
          <h1 className="courses-title">Мои курсы</h1>
          <p className="courses-subtitle">Выбери курс чтобы начать решать задачи</p>
        </div>

        {/* Форма вступления по коду */}
        <div className="courses-join-block">
          <form className="courses-join-form" onSubmit={handleJoin}>
            <input
              className="courses-join-input"
              placeholder="Код доступа к курсу..."
              value={joinCode}
              onChange={e => setJoinCode(e.target.value.toUpperCase())}
              maxLength={8}
            />
            <button className="courses-join-btn" type="submit" disabled={joiningLoading || !joinCode.trim()}>
              {joiningLoading ? '...' : 'Вступить'}
            </button>
          </form>
          {joinMsg && (
            <div className={`courses-join-msg courses-join-msg-${joinMsg.type}`}>{joinMsg.text}</div>
          )}
        </div>

        {/* Список курсов */}
        {loading ? (
          <div className="courses-loading">загрузка...</div>
        ) : (
          <div className="courses-grid">
            {courses.map(course => {
              const color = LANG_COLOR[course.language] || LANG_COLOR.default;
              const icon = LANG_ICON[course.language] || LANG_ICON.default;
              const pct = course.taskCount > 0
                ? Math.round((course.solvedCount / course.taskCount) * 100)
                : 0;

              return (
                <button
                  key={course.id}
                  className="course-card-home"
                  style={{ '--c': color }}
                  onClick={() => onSelectCourse(course.id, course.title)}
                >
                  <div className="course-card-top-bar" />
                  <div className="course-card-body">
                    <div className="course-card-icon">{icon}</div>
                    <div className="course-card-info">
                      <div className="course-card-title">{course.title}</div>
                      {course.description && (
                        <div className="course-card-desc">{course.description}</div>
                      )}
                    </div>
                    {course.isOwner && (
                      <span className="course-card-owner-badge">мой курс</span>
                    )}
                  </div>
                  <div className="course-card-footer">
                    <div className="course-card-progress-bar">
                      <div className="course-card-progress-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="course-card-stats">
                      <span>{course.solvedCount} / {course.taskCount} задач</span>
                      <span className="course-card-pct" style={{ color }}>{pct}%</span>
                    </div>
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
