import React, { useEffect, useState } from 'react';
import { api } from '../api';
import './CourseTasksPage.css';

const DIFF_LABEL = { easy: 'лёгкая', medium: 'средняя', hard: 'сложная' };
const DIFF_COLOR = { easy: '#34d399', medium: '#fbbf24', hard: '#f87171' };

export default function CourseTasksPage({ courseId, courseTitle, onSelectTask, onBack }) {
  const [tasks, setTasks] = useState([]);
  const [solved, setSolved] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getCourseTasks(courseId).then(data => {
      setTasks(data.tasks || []);
      setSolved(data.solvedTasks || []);
      setLoading(false);
    });
  }, [courseId]);

  return (
    <div className="ctasks-layout">
      <header className="ctasks-header">
        <button className="ctasks-back" onClick={onBack}>← Курсы</button>
        <div className="ctasks-logo">
          <span style={{ color: 'var(--accent)' }}>&lt;</span>CodeLearn<span style={{ color: 'var(--accent)' }}>/&gt;</span>
        </div>
        <div className="ctasks-progress">
          <span className="ctasks-progress-num">{solved.length}</span>
          <span style={{ color: 'var(--muted)' }}>/</span>
          <span style={{ color: 'var(--muted)' }}>{tasks.length}</span>
          <span className="ctasks-progress-label">решено</span>
        </div>
      </header>

      <main className="ctasks-main">
        <div className="ctasks-title-block">
          <h1 className="ctasks-title">{courseTitle}</h1>
        </div>

        {loading ? (
          <div className="ctasks-loading">загрузка...</div>
        ) : tasks.length === 0 ? (
          <div className="ctasks-empty">В этом курсе пока нет задач</div>
        ) : (
          <div className="ctasks-grid">
            {tasks.map((task, i) => {
              const isSolved = solved.includes(task.id);
              return (
                <button
                  key={task.id}
                  className={`ctask-card ${isSolved ? 'solved' : ''}`}
                  onClick={() => onSelectTask(task.id)}
                >
                  <div className="ctask-card-top">
                    <span className="ctask-card-num">#{String(i + 1).padStart(2, '0')}</span>
                    {isSolved && <span className="ctask-card-check">✓</span>}
                  </div>
                  <div className="ctask-card-title">{task.title}</div>
                  <div className="ctask-card-bottom">
                    <span className="ctask-card-topic">{task.topic}</span>
                    <span className="ctask-card-diff" style={{ color: DIFF_COLOR[task.difficulty] }}>
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
