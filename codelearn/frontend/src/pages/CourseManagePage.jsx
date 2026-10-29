import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import './CourseManagePage.css';

const LANG_NAME = { python: 'Python', javascript: 'JavaScript', ruby: 'Ruby' };
const DIFF_COLOR = { easy: '#34d399', medium: '#fbbf24', hard: '#f87171' };

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? '—' : d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Имя пользователя задаёт сам пользователь: ячейки, начинающиеся с = + - @, Excel выполнил бы как формулу
function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return `"${text.replace(/"/g, '""')}"`;
}

function percent(solved, total) {
  return total > 0 ? Math.round((solved / total) * 100) : 0;
}

export default function CourseManagePage({ courseId, onBack, onCourseChanged, onDeleted }) {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [tab, setTab] = useState('members');
  const [toast, setToast] = useState('');
  const toastTimer = useRef(null);

  const [form, setForm] = useState({ title: '', description: '' });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [confirmCode, setConfirmCode] = useState(false);
  const [codeBusy, setCodeBusy] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleted, setDeleted] = useState(null); // название удалённого курса

  const load = useCallback(() => {
    return api.getCourseStats(courseId).then(res => {
      if (res.error) { setLoadError(res.error); return; }
      setData(res);
      setForm({ title: res.course.title, description: res.course.description });
    });
  }, [courseId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  function showToast(text) {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3000);
  }

  // ─── Курс удалён: показываем итог вместо страницы ───
  if (deleted !== null) {
    return (
      <div className="cm-layout">
        <div className="cm-deleted">
          <div className="cm-deleted-icon">✓</div>
          <h1 className="cm-deleted-title">Курс удалён</h1>
          <p className="cm-deleted-text">«{deleted}» и все связанные с ним данные удалены.</p>
          <button className="cm-btn-primary" onClick={onDeleted}>К моим курсам</button>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="cm-layout">
        <div className="cm-deleted">
          <p className="cm-deleted-text">{loadError}</p>
          <button className="cm-btn-secondary" onClick={onBack}>← Назад</button>
        </div>
      </div>
    );
  }

  if (!data) return <div className="cm-layout"><div className="cm-loading">загрузка...</div></div>;

  const { course, members, tasks, totalTasks, summary } = data;
  const unchanged = form.title.trim() === course.title && form.description.trim() === course.description;

  async function handleSave(e) {
    e.preventDefault();
    if (!form.title.trim()) { setFormError('Название не может быть пустым'); return; }
    setSaving(true);
    setFormError('');
    const res = await api.updateCourse(courseId, form);
    setSaving(false);
    if (res.error) { setFormError(res.error); return; }
    setData(d => ({ ...d, course: { ...d.course, title: res.course.title, description: res.course.description } }));
    setForm({ title: res.course.title, description: res.course.description });
    onCourseChanged(res.course.title);
    showToast('Изменения сохранены');
  }

  async function handleNewCode() {
    setCodeBusy(true);
    const res = await api.regenerateAccessCode(courseId);
    setCodeBusy(false);
    setConfirmCode(false);
    if (res.error) { showToast(res.error); return; }
    setData(d => ({ ...d, course: { ...d.course, accessCode: res.accessCode } }));
    showToast('Создан новый код доступа');
  }

  function copyCode() {
    const clip = navigator.clipboard;
    if (!clip) { showToast('Выделите код и скопируйте вручную'); return; }
    clip.writeText(course.accessCode).then(
      () => showToast('Код скопирован'),
      () => showToast('Не удалось скопировать — скопируйте вручную'),
    );
  }

  function exportCsv() {
    const header = ['Участник', 'Решено задач', 'Всего задач', 'Прогресс, %', 'Вступил', 'Последняя активность'];
    const rows = members.map(m => [
      m.username, m.solvedCount, totalTasks, percent(m.solvedCount, totalTasks),
      fmtDate(m.enrolledAt), fmtDate(m.lastActiveAt),
    ]);
    // BOM + «;» — чтобы Excel с русской локалью открыл файл сразу в нормальном виде
    const csv = '\uFEFF' + [header, ...rows].map(r => r.map(csvCell).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${course.title.replace(/[\\/:*?"<>|]+/g, '_')} — участники.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="cm-layout">
      <header className="cm-header">
        <button className="cm-back" onClick={onBack}>← К задачам</button>
        <div className="cm-logo">
          <span style={{ color: 'var(--accent)' }}>&lt;</span>CodeLearn<span style={{ color: 'var(--accent)' }}>/&gt;</span>
        </div>
        <div className="cm-header-spacer" />
      </header>

      <main className="cm-main">
        <div className="cm-title-block">
          <div className="cm-kicker">Управление курсом</div>
          <h1 className="cm-title">{course.title}</h1>
        </div>

        <div className="cm-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'members'} className={`cm-tab ${tab === 'members' ? 'active' : ''}`}
            onClick={() => setTab('members')}>Участники</button>
          <button role="tab" aria-selected={tab === 'settings'} className={`cm-tab ${tab === 'settings' ? 'active' : ''}`}
            onClick={() => setTab('settings')}>Настройки</button>
        </div>

        {tab === 'members' && (
          <>
            <div className="cm-cards">
              <div className="cm-card"><div className="cm-card-num">{summary.memberCount}</div><div className="cm-card-label">участников</div></div>
              <div className="cm-card"><div className="cm-card-num">{summary.avgProgress}%</div><div className="cm-card-label">средний прогресс</div></div>
              <div className="cm-card"><div className="cm-card-num">{summary.completedCount}</div><div className="cm-card-label">прошли весь курс</div></div>
            </div>

            {members.length === 0 ? (
              <div className="cm-empty">
                Пока никто не вступил в курс. Отправьте студентам код доступа:
                <div className="cm-empty-code">{course.accessCode}</div>
              </div>
            ) : (
              <>
                <div className="cm-section-head">
                  <h2 className="cm-h2">Прогресс участников</h2>
                  <button className="cm-btn-secondary" onClick={exportCsv}>⭳ Скачать CSV</button>
                </div>
                <div className="cm-table-wrap">
                  <table className="cm-table">
                    <thead>
                      <tr><th>Участник</th><th>Прогресс</th><th>Последняя активность</th><th>Вступил</th></tr>
                    </thead>
                    <tbody>
                      {members.map(m => {
                        const pct = percent(m.solvedCount, totalTasks);
                        return (
                          <tr key={m.userId}>
                            <td className="cm-user">{m.username}</td>
                            <td>
                              <div className="cm-progress">
                                <div className="cm-bar"><div className="cm-bar-fill" style={{ width: `${pct}%` }} /></div>
                                <span className="cm-progress-text">{m.solvedCount} / {totalTasks}</span>
                              </div>
                            </td>
                            <td className="cm-muted">{fmtDate(m.lastActiveAt)}</td>
                            <td className="cm-muted">{fmtDate(m.enrolledAt)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {tasks.length > 0 && (
                  <>
                    <h2 className="cm-h2" style={{ marginTop: 36 }}>Решаемость задач</h2>
                    <div className="cm-tasklist">
                      {tasks.map((t, i) => {
                        const pct = percent(t.solvedCount, summary.memberCount);
                        return (
                          <div className="cm-taskrow" key={t.id}>
                            <span className="cm-taskrow-num">#{String(i + 1).padStart(2, '0')}</span>
                            <span className="cm-taskrow-title">{t.title}</span>
                            <span className="cm-taskrow-diff" style={{ color: DIFF_COLOR[t.difficulty] }}>●</span>
                            <div className="cm-bar cm-bar-wide"><div className="cm-bar-fill" style={{ width: `${pct}%` }} /></div>
                            <span className="cm-taskrow-count">{t.solvedCount} из {summary.memberCount}</span>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )}

        {tab === 'settings' && (
          <div className="cm-settings">
            <form className="cm-panel" onSubmit={handleSave}>
              <h2 className="cm-h2">Основное</h2>
              <div className="cm-field">
                <label htmlFor="cm-title-input">Название</label>
                <input id="cm-title-input" value={form.title} maxLength={200}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
              </div>
              <div className="cm-field">
                <label htmlFor="cm-desc-input">Описание</label>
                <textarea id="cm-desc-input" rows={3} value={form.description} maxLength={2000}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              </div>
              <div className="cm-hint">
                Язык: {LANG_NAME[course.language] || course.language}. Его нельзя изменить после создания курса:
                к нему привязаны тесты задач.
              </div>
              <div className="cm-actions">
                <span className="cm-error">{formError}</span>
                <button type="submit" className="cm-btn-primary" disabled={saving || unchanged}>
                  {saving ? 'Сохраняю…' : 'Сохранить'}
                </button>
              </div>
            </form>

            <div className="cm-panel">
              <h2 className="cm-h2">Код доступа</h2>
              <div className="cm-code-row">
                <div className="cm-code" data-testid="access-code">{course.accessCode || '—'}</div>
                <button type="button" className="cm-btn-secondary" onClick={copyCode} disabled={!course.accessCode}>Копировать</button>
                {!confirmCode && (
                  <button type="button" className="cm-btn-secondary" onClick={() => setConfirmCode(true)}>Создать новый</button>
                )}
              </div>
              {confirmCode ? (
                <div className="cm-inline-confirm">
                  <span>Старый код перестанет работать. Уже вступившие участники останутся в курсе.</span>
                  <button type="button" className="cm-btn-primary" onClick={handleNewCode} disabled={codeBusy}>
                    {codeBusy ? '…' : 'Создать новый код'}
                  </button>
                  <button type="button" className="cm-btn-secondary" onClick={() => setConfirmCode(false)} disabled={codeBusy}>Отмена</button>
                </div>
              ) : (
                <div className="cm-hint">По этому коду студенты вступают в курс на странице «Мои курсы».</div>
              )}
            </div>

            <div className="cm-panel cm-danger">
              <h2 className="cm-h2 cm-danger-title">Опасная зона</h2>
              <div className="cm-danger-row">
                <div className="cm-hint">
                  Удаление курса стирает все его задачи, тесты, список участников и их прогресс. Отменить это нельзя.
                </div>
                <button type="button" className="cm-btn-danger" onClick={() => setDeleteOpen(true)}>Удалить курс…</button>
              </div>
            </div>
          </div>
        )}
      </main>

      {deleteOpen && (
        <DeleteCourseDialog
          course={course}
          taskCount={totalTasks}
          memberCount={summary.memberCount}
          onCancel={() => setDeleteOpen(false)}
          onConfirm={async typed => {
            const res = await api.deleteCourse(courseId, typed);
            if (res.error) return res.error;
            setDeleteOpen(false);
            setDeleted(course.title);
            return '';
          }}
        />
      )}

      {toast && <div className="cm-toast">{toast}</div>}
    </div>
  );
}

// Окно подтверждения: удалить можно, только вписав точное название курса
function DeleteCourseDialog({ course, taskCount, memberCount, onCancel, onConfirm }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const matches = typed.trim() === course.title.trim();

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  async function submit(e) {
    e.preventDefault();
    if (!matches || busy) return;
    setBusy(true);
    setError('');
    const err = await onConfirm(typed);
    if (err) { setError(err); setBusy(false); }
  }

  return (
    <div className="cm-overlay">
      <form className="cm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="cm-del-title" onSubmit={submit}>
        <h2 id="cm-del-title" className="cm-dialog-title">Вы уверены, что хотите удалить курс?</h2>
        <p className="cm-dialog-text">
          Будет безвозвратно удалено: <b>задач — {taskCount}</b>, <b>участников — {memberCount}</b> вместе с их прогрессом,
          а также все тесты. Студенты потеряют доступ к курсу сразу.
        </p>
        <label className="cm-dialog-label" htmlFor="cm-confirm-input">
          Чтобы подтвердить, введите название курса: <span className="cm-dialog-name">{course.title}</span>
        </label>
        <input id="cm-confirm-input" className="cm-dialog-input" value={typed} autoFocus autoComplete="off"
          onChange={e => { setTyped(e.target.value); setError(''); }} placeholder="Название курса" />
        <div className="cm-dialog-error">{error}</div>
        <div className="cm-dialog-actions">
          <button type="button" className="cm-btn-secondary" onClick={onCancel} disabled={busy}>Отмена</button>
          <button type="submit" className="cm-btn-danger solid" disabled={!matches || busy}>
            {busy ? 'Удаляю…' : 'Удалить курс навсегда'}
          </button>
        </div>
      </form>
    </div>
  );
}
