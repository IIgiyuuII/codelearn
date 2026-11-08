import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import './HintPanel.css';

const LEVEL_NAMES = { 1: 'Намёк', 2: 'Где искать', 3: 'План' };

const normalize = text => (text || '').trim().split(/\s+/).join(' ');

// Подсказка приходит текстом с `кодом` и короткими блоками ```кода```. Разбираем сами, без innerHTML:
// так текст ответа внешней модели не может внедрить в страницу ничего, кроме текста.
function InlineText({ text }) {
  return text.split(/`([^`\n]+)`/g).map((part, i) =>
    i % 2 === 1 ? <code key={i} className="hint-inline">{part}</code> : <React.Fragment key={i}>{part}</React.Fragment>);
}

export function HintText({ text }) {
  const parts = text.split(/```[\w+#.-]*\n?([\s\S]*?)```/g);
  return (
    <div className="hint-text">
      {parts.map((part, i) =>
        i % 2 === 1
          ? <pre key={i} className="hint-code"><code>{part.replace(/\n$/, '')}</code></pre>
          : <InlineText key={i} text={part} />)}
    </div>
  );
}

/**
 * Панель подсказок ИИ в решателе. Если на сервере подсказки не настроены (нет ключа), панель не показывается.
 * Правила (лимиты, уровни, пауза) задаёт сервер — здесь они только отражаются.
 */
export default function HintPanel({ taskId, code, starterCode, lastResult }) {
  const [state, setState] = useState(null);       // { enabled, hints, nextLevel, remaining, cooldownSeconds, maxLevel }
  const [hidden, setHidden] = useState(false);    // загрузка не удалась или подсказки выключены
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState(null);       // { text, code }
  // Пауза между подсказками хранится как момент окончания, а не как «осталось N секунд»: так отсчёт
  // не уходит от реального времени, даже если браузер притормаживает таймеры в фоновой вкладке.
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const lastCard = useRef(null);

  const startCooldown = useCallback(seconds => {
    const t = Date.now();
    setNow(t);
    setCooldownUntil(seconds > 0 ? t + seconds * 1000 : 0);
  }, []);
  const cooldown = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));

  useEffect(() => {
    let alive = true;
    setState(null);
    setHidden(false);
    setError(null);
    setCooldownUntil(0);
    api.getHints(taskId).then(data => {
      if (!alive) return;
      if (data.error || data.enabled === false) { setHidden(true); return; }
      setState(data);
      startCooldown(data.cooldownSeconds || 0);
    });
    return () => { alive = false; };
  }, [taskId, startCooldown]);

  // Пока пауза не кончилась, раз в четверть секунды обновляем «сейчас»; по окончании таймер останавливается сам
  useEffect(() => {
    if (cooldownUntil <= Date.now()) return undefined;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= cooldownUntil) clearInterval(id);
    }, 250);
    return () => clearInterval(id);
  }, [cooldownUntil]);

  const hintCount = state ? state.hints.length : 0;
  useEffect(() => {
    if (hintCount > 0 && lastCard.current && lastCard.current.scrollIntoView) {
      lastCard.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [hintCount]);

  const ask = useCallback(async () => {
    setRequesting(true);
    setError(null);
    const data = await api.requestHint(taskId, { code, lastResult });
    setRequesting(false);
    if (data.error) {
      setError({ text: data.error, code: data.code });
      if (data.retryAfter) startCooldown(data.retryAfter);
      if (data.code === 'limit_task') setState(s => ({ ...s, remaining: 0 }));
      if (data.code === 'hints_disabled') setHidden(true);
      return;
    }
    setState(data.state);
    startCooldown(data.state.cooldownSeconds || 0);
  }, [taskId, code, lastResult, startCooldown]);

  const rate = useCallback(async (hint, value) => {
    const next = hint.helpful === value ? null : value; // повторное нажатие снимает оценку
    const apply = helpful => setState(s => ({ ...s, hints: s.hints.map(h => (h.id === hint.id ? { ...h, helpful } : h)) }));
    apply(next);
    const data = await api.rateHint(hint.id, next);
    if (data.error) apply(hint.helpful); // не сохранилось — возвращаем прежнее значение
  }, []);

  if (hidden || !state) return null;

  const needAttempt = !code.trim() || normalize(code) === normalize(starterCode);
  const noMore = state.remaining <= 0;
  const waiting = cooldown > 0;
  const disabled = requesting || needAttempt || noMore || waiting;

  let note = '';
  if (noMore) note = 'Подсказки по этой задаче закончились.';
  else if (needAttempt) note = 'Сначала напишите решение — потом подсказка будет полезнее.';
  else if (waiting) note = `Следующая подсказка через ${cooldown} с. Подумайте над предыдущей.`;
  else if (!lastResult) note = 'Запустите код — подсказка получится точнее.';

  const label = requesting
    ? 'Думаю…'
    : hintCount >= state.maxLevel ? '💡 Ещё подсказка' : `💡 Подсказка ${state.nextLevel} из ${state.maxLevel}`;

  return (
    <section className="hint-panel" aria-label="Подсказки">
      <div className="hint-head">
        <span className="hint-title">Подсказки ИИ</span>
        <span className="hint-left">осталось {state.remaining}</span>
      </div>

      {state.hints.map((hint, i) => (
        <article className="hint-card" key={hint.id} ref={i === hintCount - 1 ? lastCard : null} data-testid="hint-card">
          <div className="hint-card-head">
            <span className={`hint-level hint-level-${hint.level}`}>{hint.level}. {LEVEL_NAMES[hint.level]}</span>
          </div>
          <HintText text={hint.text} />
          <div className="hint-rate">
            <span className="hint-rate-label">Помогло?</span>
            <button type="button" className={`hint-rate-btn ${hint.helpful === true ? 'on' : ''}`} aria-pressed={hint.helpful === true}
              aria-label="Подсказка помогла" onClick={() => rate(hint, true)}>👍</button>
            <button type="button" className={`hint-rate-btn ${hint.helpful === false ? 'on' : ''}`} aria-pressed={hint.helpful === false}
              aria-label="Подсказка не помогла" onClick={() => rate(hint, false)}>👎</button>
          </div>
        </article>
      ))}

      <button type="button" className="hint-ask" onClick={ask} disabled={disabled}>{label}</button>
      {note && <div className="hint-note">{note}</div>}
      {error && <div className="hint-error" role="alert">{error.text}</div>}

      <p className="hint-footnote">
        Подсказки создаёт ИИ (DeepSeek): для этого код и условие задачи отправляются во внешний сервис.
        Он может ошибаться, а готовое решение не даёт.
      </p>
    </section>
  );
}
