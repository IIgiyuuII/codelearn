import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import TaskFormModal from './TaskFormModal';
import './CourseTasksPage.css';

const DIFF_LABEL = { easy: 'лёгкая', medium: 'средняя', hard: 'сложная' };
const DIFF_COLOR = { easy: '#34d399', medium: '#fbbf24', hard: '#f87171' };

export default function CourseTasksPage({ courseId, courseTitle, onSelectTask, onBack }) {
  const [tasks, setTasks] = useState([]);
  const [solved, setSolved] = useState([]);
  const [isOwner, setIsOwner] = useState(false);
  const [language, setLanguage] = useState('python');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [modal, setModal] = useState(null);          // { taskId: number | null }
  const [confirmDelete, setConfirmDelete] = useState(null); // задача
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState('');
  const toastTimer = useRef(null);

  const load = useCallback(() => {
    return api.getCourseTasks(courseId).then(data => {
      if (data.error) {
        setLoadError(data.error);
      } else {
        setTasks(data.tasks || []);
        setSolved(data.solvedTasks || []);
        setIsOwner(!!data.isOwner);
        if (data.course && data.course.language) setLanguage(data.course.language);
      }
      setLoading(false);
    });
  }, [courseId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  function showToast(text) {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3000);
  }

  function handleSaved(message) {
    setModal(null);
    showToast(message);
    load();
  }

  async function handleDelete() {
    setDeleting(true);
    const data = await api.deleteTask(confirmDelete.id);
    setDeleting(false);
    setConfirmDelete(null);
    if (data.error) {
      showToast(data.error);
      return;
    }
    showToast('Задача удалена');
    load();
  }

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
          <div>
            <h1 className="ctasks-title">{courseTitle}</h1>
            {isOwner && <div className="ctasks-owner-badge">Вы владелец курса</div>}
          </div>
          {isOwner && (
            <button className="ctasks-add-btn" onClick={() => setModal({ taskId: null })}>+ Добавить задачу</button>
          )}
        </div>

        {loading ? (
          <div className="ctasks-loading">загрузка...</div>
        ) : loadError ? (
          <div className="ctasks-empty">{loadError}</div>
        ) : tasks.length === 0 ? (
          <div className="ctasks-empty">
            {isOwner
              ? 'В курсе пока нет задач. Нажмите «+ Добавить задачу», чтобы создать первую.'
              : 'В этом курсе пока нет задач'}
          </div>
        ) : (
          <div className="ctasks-grid">
            {tasks.map((task, i) => {
              const isSolved = solved.includes(task.id);
              return (
                <div
                  key={task.id}
                  className={`ctask-card ${isSolved ? 'solved' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectTask(task.id)}
                  onKeyDown={e => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectTask(task.id); }
                  }}
                >
                  <div className="ctask-card-top">
                    <span className="ctask-card-num">#{String(i + 1).padStart(2, '0')}</span>
                    <span className="ctask-card-right">
                      {isOwner && (
                        <span className="ctask-card-actions">
                          <button
                            type="button" className="ctask-action" title="Редактировать" aria-label="Редактировать"
                            onClick={e => { e.stopPropagation(); setModal({ taskId: task.id }); }}
                          >✎</button>
                          <button
                            type="button" className="ctask-action danger" title="Удалить" aria-label="Удалить"
                            onClick={e => { e.stopPropagation(); setConfirmDelete(task); }}
                          >🗑</button>
                        </span>
                      )}
                      {isSolved && <span className="ctask-card-check">✓</span>}
                    </span>
                  </div>
                  <div className="ctask-card-title">{task.title}</div>
                  <div className="ctask-card-bottom">
                    <span className="ctask-card-topic">{task.topic}</span>
                    <span className="ctask-card-diff" style={{ color: DIFF_COLOR[task.difficulty] }}>
                      {DIFF_LABEL[task.difficulty]}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {modal && (
        <TaskFormModal
          courseId={courseId}
          language={language}
          taskId={modal.taskId}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      )}

      {confirmDelete && (
        <div className="ctasks-confirm-overlay">
          <div className="ctasks-confirm" role="alertdialog" aria-modal="true">
            <div className="ctasks-confirm-title">Удалить задачу?</div>
            <p className="ctasks-confirm-text">
              «{confirmDelete.title}» будет удалена вместе с тестами и отметками студентов о решении.
              Это действие нельзя отменить.
            </p>
            <div className="ctasks-confirm-actions">
              <button className="tf-btn-secondary" onClick={() => setConfirmDelete(null)} disabled={deleting}>Отмена</button>
              <button className="ctasks-confirm-delete" onClick={handleDelete} disabled={deleting}>
                {deleting ? 'Удаляю…' : 'Удалить'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="ctasks-toast">{toast}</div>}
    </div>
  );
}
