import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { useCodeEngine, SUPPORTED_LANGUAGES, LANGUAGE_NAMES } from '../hooks/useCodeEngine';
import './TaskFormModal.css';

// Всё, что отличается у разных языков: заготовка кода, подсказки, формат тестов
const LANG_UI = {
  python: {
    starter: 'def solve():\n    # Ваш код здесь\n    pass\n',
    reference: 'def solve(...):\n    ...',
    tests: 'assert sum(2, 3) == 5\nassert sum(0, 0) == 0\nassert sum(-1, 1) == 0, "сумма -1 и 1 должна быть 0"',
    testsHint: (
      <>Обычный Python с <code>assert</code>: функции студента уже определены. Текст после запятой
      в <code>assert</code> студент увидит как подсказку. Строка <code>print(...)</code> в конце не нужна.</>
    ),
    exampleInput: 'sum(2, 3)',
  },
  javascript: {
    starter: 'function solve() {\n  // Ваш код здесь\n}\n',
    reference: 'function solve(...) {\n  ...\n}',
    tests: 'assertEqual(sum(2, 3), 5);\nassertEqual(sum(0, 0), 0);\nassertEqual(sum(-1, 1), 0, "сумма -1 и 1 должна быть 0");',
    testsHint: (
      <>Обычный JavaScript: функции и переменные студента уже определены. Доступны <code>assertEqual(факт, ожидание, сообщение)</code> (сравнивает
      и массивы с объектами), <code>assertNotEqual</code>, <code>assert(условие, сообщение)</code> и <code>assertThrows(функция)</code>. Сообщение студент увидит как подсказку.
      Можно использовать <code>await</code>.</>
    ),
    exampleInput: 'sum(2, 3)',
  },
};
const FALLBACK_UI = LANG_UI.python;

const emptyForm = language => ({
  title: '',
  topic: 'Общее',
  difficulty: 'easy',
  description: '',
  starterCode: (LANG_UI[language] || FALLBACK_UI).starter,
  hiddenTests: '',
});
const EMPTY_EXAMPLE = { input: '', output: '', explanation: '' };

// Tab в полях с кодом вставляет 4 пробела, а не уводит фокус
function handleTab(e, setValue) {
  if (e.key !== 'Tab') return;
  e.preventDefault();
  const el = e.target;
  const { selectionStart: start, selectionEnd: end, value } = el;
  setValue(value.slice(0, start) + '    ' + value.slice(end));
  requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = start + 4; });
}

// Проверка скрытых тестов на эталонном решении. Движок языка запускается только когда эта
// секция показана, то есть для курсов на поддерживаемых языках.
function ReferenceCheck({ language, reference, onReferenceChange, tests, starterCode, check, onCheck }) {
  const { status, runCode } = useCodeEngine(language);
  const [running, setRunning] = useState(false);

  const canRun = status === 'ready' && !running && reference.trim() && tests.trim();

  async function run() {
    setRunning(true);
    const res = await runCode(reference, tests);
    let result;
    if (res.passed) {
      // Заготовка без изменений не должна проходить тесты — иначе задача решается «ничем»
      const starter = await runCode(starterCode, tests);
      result = starter.passed
        ? { kind: 'warn', text: 'Эталон проходит тесты, но и стартовый код без изменений тоже проходит — проверьте тесты.' }
        : { kind: 'ok', text: `Эталон проходит все тесты (${res.durationMs} мс), стартовый код — нет.` };
    } else {
      result = { kind: 'fail', text: [res.output, res.error].filter(Boolean).join('\n') || 'Эталон не прошёл тесты' };
    }
    onCheck(result);
    setRunning(false);
  }

  return (
    <div className="tf-field">
      <label>Эталонное решение <span className="tf-optional">необязательно, не сохраняется</span></label>
      <textarea
        className="tf-code"
        rows={6}
        value={reference}
        onChange={e => onReferenceChange(e.target.value)}
        onKeyDown={e => handleTab(e, onReferenceChange)}
        placeholder={(LANG_UI[language] || FALLBACK_UI).reference}
        spellCheck={false}
      />
      <div className="tf-check-row">
        <button type="button" className="tf-btn-secondary" disabled={!canRun} onClick={run}>
          {running ? 'Проверяю…' : '▶ Проверить тесты на эталоне'}
        </button>
        <span className="tf-hint">
          {status === 'loading' && `${LANGUAGE_NAMES[language]} загружается…`}
          {status === 'error' && `Не удалось загрузить ${LANGUAGE_NAMES[language]}`}
          {status === 'ready' && !reference.trim() && 'Вставьте решение, чтобы убедиться, что тесты верны'}
        </span>
      </div>
      {check && <pre className={`tf-check tf-check-${check.kind}`}>{check.kind === 'ok' ? '✓ ' : check.kind === 'warn' ? '⚠ ' : '✗ '}{check.text}</pre>}
    </div>
  );
}

export default function TaskFormModal({ courseId, language, taskId, onClose, onSaved }) {
  const isEdit = taskId != null;
  const canRun = SUPPORTED_LANGUAGES.includes(language);
  const ui = LANG_UI[language] || FALLBACK_UI;

  const [loading, setLoading] = useState(isEdit);
  const [loadFailed, setLoadFailed] = useState(false);
  const [form, setForm] = useState(() => emptyForm(language));
  const [examples, setExamples] = useState([{ ...EMPTY_EXAMPLE }]);
  const [reference, setReference] = useState('');
  const [check, setCheck] = useState(null); // null | { kind: 'ok' | 'warn' | 'fail', text }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Блокируем прокрутку страницы под окном
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // При редактировании подгружаем задачу целиком (со скрытыми тестами)
  useEffect(() => {
    if (!isEdit) return undefined;
    let alive = true;
    api.getTaskFull(taskId).then(data => {
      if (!alive) return;
      if (data.error) {
        setError(data.error);
        setLoadFailed(true);
      } else {
        const t = data.task;
        setForm({
          title: t.title, topic: t.topic, difficulty: t.difficulty,
          description: t.description, starterCode: t.starterCode,
          hiddenTests: data.hiddenTests || '',
        });
        setExamples(data.examples && data.examples.length ? data.examples : [{ ...EMPTY_EXAMPLE }]);
      }
      setLoading(false);
    });
    return () => { alive = false; };
  }, [taskId, isEdit]);

  function setField(key, value) {
    setForm(f => ({ ...f, [key]: value }));
    if (key === 'hiddenTests' || key === 'starterCode') setCheck(null); // результат проверки устарел
  }
  const onText = key => e => setField(key, e.target.value);
  const setTests = v => setField('hiddenTests', v);
  const setStarter = v => setField('starterCode', v);
  const setRef = v => { setReference(v); setCheck(null); };

  function updateExample(i, key, value) {
    setExamples(list => list.map((ex, idx) => (idx === i ? { ...ex, [key]: value } : ex)));
  }

  function validate() {
    if (!form.title.trim()) return 'Укажите название';
    if (!form.description.trim()) return 'Заполните условие задачи';
    if (!form.hiddenTests.trim()) return 'Добавьте скрытые тесты — без них задачу нельзя проверить';
    const half = examples.find(e => (e.input.trim() === '') !== (e.output.trim() === ''));
    if (half) return 'В каждом примере нужны и входные данные, и ожидаемый результат';
    if (canRun && reference.trim() && !(check && check.kind !== 'fail')) {
      return 'Проверьте тесты на эталонном решении — или очистите поле эталона';
    }
    return '';
  }

  async function handleSave(e) {
    e.preventDefault();
    const problem = validate();
    if (problem) { setError(problem); return; }
    setError('');
    setSaving(true);
    const payload = {
      ...form,
      examples: examples.filter(ex => ex.input.trim() || ex.output.trim()),
    };
    const data = isEdit
      ? await api.updateTask(taskId, payload)
      : await api.addCourseTask(courseId, payload);
    setSaving(false);
    if (data.error) { setError(data.error); return; }
    onSaved(isEdit ? 'Задача обновлена' : 'Задача добавлена');
  }

  return (
    <div className="tf-overlay">
      <div className="tf-modal" role="dialog" aria-modal="true" aria-label={isEdit ? 'Редактирование задачи' : 'Новая задача'}>
        <div className="tf-header">
          <h2 className="tf-title">{isEdit ? 'Редактирование задачи' : 'Новая задача'}</h2>
          <button type="button" className="tf-close" onClick={onClose} aria-label="Закрыть">✕</button>
        </div>

        {loading ? (
          <div className="tf-body"><div className="tf-loading">загрузка…</div></div>
        ) : loadFailed ? (
          <div className="tf-body"><div className="tf-error">{error}</div></div>
        ) : (
          <form onSubmit={handleSave} className="tf-form">
            <div className="tf-body">
              {!canRun && (
                <div className="tf-notice">
                  Язык курса — {LANGUAGE_NAMES[language] || language}. Запуск кода пока поддерживается только для
                  Python и JavaScript: задачу можно создать, но решать её студенты смогут после добавления этого языка.
                </div>
              )}

              <div className="tf-row">
                <div className="tf-field tf-grow">
                  <label>Название</label>
                  <input value={form.title} onChange={onText('title')} maxLength={200} placeholder="Например: Сумма двух чисел" autoFocus />
                </div>
                <div className="tf-field tf-w-topic">
                  <label>Тема</label>
                  <input value={form.topic} onChange={onText('topic')} maxLength={100} />
                </div>
                <div className="tf-field tf-w-diff">
                  <label>Сложность</label>
                  <select value={form.difficulty} onChange={onText('difficulty')}>
                    <option value="easy">лёгкая</option>
                    <option value="medium">средняя</option>
                    <option value="hard">сложная</option>
                  </select>
                </div>
              </div>

              <div className="tf-field">
                <label>Условие</label>
                <textarea rows={5} value={form.description} onChange={onText('description')}
                  placeholder={'Напишите функцию `sum(a, b)`, которая возвращает сумму двух чисел.\nМожно использовать `код` в обратных кавычках.'} />
              </div>

              <div className="tf-field">
                <label>Стартовый код</label>
                <textarea className="tf-code" rows={5} value={form.starterCode}
                  onChange={onText('starterCode')} onKeyDown={e => handleTab(e, setStarter)} spellCheck={false} />
              </div>

              <div className="tf-field">
                <label>Видимые примеры <span className="tf-optional">показываются студенту</span></label>
                <div className="tf-examples">
                  {examples.map((ex, i) => (
                    <div className="tf-example" key={i}>
                      <input className="tf-mono" value={ex.input} placeholder={ui.exampleInput}
                        onChange={e => updateExample(i, 'input', e.target.value)} />
                      <span className="tf-arrow">→</span>
                      <input className="tf-mono" value={ex.output} placeholder="5"
                        onChange={e => updateExample(i, 'output', e.target.value)} />
                      <input value={ex.explanation} placeholder="пояснение (необязательно)"
                        onChange={e => updateExample(i, 'explanation', e.target.value)} />
                      <button type="button" className="tf-remove" title="Убрать пример"
                        onClick={() => setExamples(list => list.filter((_, idx) => idx !== i))}>✕</button>
                    </div>
                  ))}
                  <button type="button" className="tf-btn-secondary tf-add" disabled={examples.length >= 20}
                    onClick={() => setExamples(list => [...list, { ...EMPTY_EXAMPLE }])}>+ Пример</button>
                </div>
              </div>

              <div className="tf-field">
                <label>Скрытые тесты</label>
                <textarea className="tf-code" rows={7} value={form.hiddenTests}
                  onChange={onText('hiddenTests')} onKeyDown={e => handleTab(e, setTests)} spellCheck={false}
                  placeholder={ui.tests} />
                <div className="tf-hint">{ui.testsHint}</div>
              </div>

              {canRun && (
                <ReferenceCheck
                  language={language}
                  reference={reference} onReferenceChange={setRef}
                  tests={form.hiddenTests} starterCode={form.starterCode}
                  check={check} onCheck={setCheck}
                />
              )}
            </div>

            <div className="tf-footer">
              <div className="tf-error">{error}</div>
              <button type="button" className="tf-btn-secondary" onClick={onClose}>Отмена</button>
              <button type="submit" className="tf-btn-primary" disabled={saving}>
                {saving ? 'Сохраняю…' : isEdit ? 'Сохранить' : 'Добавить задачу'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
