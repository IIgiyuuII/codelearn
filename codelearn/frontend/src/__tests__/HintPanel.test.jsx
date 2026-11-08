import React from 'react';
import { render, screen, act, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('../api', () => ({ api: { getHints: jest.fn(), requestHint: jest.fn(), rateHint: jest.fn() } }));
import { api } from '../api';
import HintPanel, { HintText } from '../pages/HintPanel';

const STARTER = 'def sum(a, b):\n    # Ваш код здесь\n    pass';
const WRONG = 'def sum(a, b):\n    return a - b';
const RESULT = { status: 'test_failed', text: 'Тест не пройден' };

const stateOf = (over = {}) => ({ enabled: true, maxLevel: 3, nextLevel: 1, remaining: 8, cooldownSeconds: 0, hints: [], ...over });
const hint = (id, level, text, helpful = null) => ({ id, level, text, helpful, createdAt: '2026-11-03T10:00:00Z' });

async function mount(props = {}, state = stateOf()) {
  api.getHints.mockResolvedValue(state);
  const all = { taskId: 1, code: WRONG, starterCode: STARTER, lastResult: RESULT, ...props };
  const view = render(<HintPanel {...all} />);
  await screen.findByRole('region', { name: 'Подсказки' }).catch(() => {}); // панели может и не быть
  await act(async () => {});
  return { ...view, props: all };
}
const askButton = () => screen.getByRole('button', { name: /Подсказка \d из 3|Ещё подсказка|Думаю/ });

beforeEach(() => {
  jest.resetAllMocks();
  Element.prototype.scrollIntoView = jest.fn();
});

describe('когда панель скрыта', () => {
  test('пока состояние не загрузилось, ничего не показывается', () => {
    api.getHints.mockReturnValue(new Promise(() => {}));
    render(<HintPanel taskId={1} code={WRONG} starterCode={STARTER} lastResult={null} />);
    expect(screen.queryByRole('region', { name: 'Подсказки' })).toBeNull();
  });

  test('подсказки не настроены на сервере (нет ключа) — панели нет', async () => {
    await mount({}, stateOf({ enabled: false }));
    expect(screen.queryByRole('region', { name: 'Подсказки' })).toBeNull();
    expect(screen.queryByRole('button', { name: /подсказ/i })).toBeNull();
  });

  test('ошибка загрузки состояния — панель молча скрыта, решатель не ломается', async () => {
    api.getHints.mockResolvedValue({ error: 'Нет связи с сервером' });
    render(<HintPanel taskId={1} code={WRONG} starterCode={STARTER} lastResult={null} />);
    await act(async () => {});
    expect(screen.queryByRole('region', { name: 'Подсказки' })).toBeNull();
  });
});

describe('кнопка', () => {
  test('исходное состояние: «Подсказка 1 из 3», осталось 8, истории нет', async () => {
    await mount();
    expect(askButton()).toHaveTextContent('💡 Подсказка 1 из 3');
    expect(askButton()).toBeEnabled();
    expect(screen.getByText('осталось 8')).toBeInTheDocument();
    expect(screen.queryAllByTestId('hint-card')).toHaveLength(0);
    expect(api.getHints).toHaveBeenCalledWith(1);
  });

  test.each([
    ['стартовый код без изменений', STARTER],
    ['стартовый код, отличающийся только пробелами', 'def sum(a,   b):\n\n\n   # Ваш код здесь\n pass\n'],
    ['пустой код', '   '],
  ])('%s: кнопка заблокирована, объяснено почему', async (_, code) => {
    await mount({ code });
    expect(askButton()).toBeDisabled();
    expect(screen.getByText(/Сначала напишите решение/)).toBeInTheDocument();
  });

  test('как только студент меняет код — кнопка включается', async () => {
    const { rerender, props } = await mount({ code: STARTER });
    expect(askButton()).toBeDisabled();
    rerender(<HintPanel {...props} code={WRONG} />);
    expect(askButton()).toBeEnabled();
    expect(screen.queryByText(/Сначала напишите решение/)).toBeNull();
  });

  test('без результата запуска кнопка активна, но есть совет запустить код', async () => {
    await mount({ lastResult: null });
    expect(askButton()).toBeEnabled();
    expect(screen.getByText(/Запустите код/)).toBeInTheDocument();
  });

  test('с результатом запуска совета нет', async () => {
    await mount();
    expect(screen.queryByText(/Запустите код/)).toBeNull();
  });

  test('подсказки по задаче закончились — кнопка заблокирована', async () => {
    await mount({}, stateOf({ remaining: 0, nextLevel: 3, hints: [hint(1, 1, 'а'), hint(2, 2, 'б'), hint(3, 3, 'в')] }));
    expect(askButton()).toBeDisabled();
    expect(screen.getByText(/Подсказки по этой задаче закончились/)).toBeInTheDocument();
    expect(screen.getByText('осталось 0')).toBeInTheDocument();
  });
});

describe('получение подсказки', () => {
  test('в API уходит код и итог последнего запуска; пока ждём — «Думаю…» и блокировка; затем карточка', async () => {
    let finish;
    api.requestHint.mockReturnValue(new Promise(r => { finish = r; }));
    await mount();
    await userEvent.click(askButton());
    expect(api.requestHint).toHaveBeenCalledWith(1, { code: WRONG, lastResult: RESULT });
    expect(askButton()).toHaveTextContent('Думаю…');
    expect(askButton()).toBeDisabled();

    await act(async () => finish({ hint: hint(10, 1, 'Проверьте оператор.'), state: stateOf({ nextLevel: 2, remaining: 7, hints: [hint(10, 1, 'Проверьте оператор.')] }) }));
    const card = screen.getByTestId('hint-card');
    expect(within(card).getByText('1. Намёк')).toBeInTheDocument();
    expect(within(card).getByText('Проверьте оператор.')).toBeInTheDocument();
    expect(askButton()).toHaveTextContent('💡 Подсказка 2 из 3');
    expect(askButton()).toBeEnabled();
    expect(screen.getByText('осталось 7')).toBeInTheDocument();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled(); // новая подсказка прокручивается в поле зрения
  });

  test('история уровней: названия, а после третьей кнопка «Ещё подсказка»', async () => {
    await mount({}, stateOf({ nextLevel: 3, remaining: 5, hints: [hint(1, 1, 'раз'), hint(2, 2, 'два'), hint(3, 3, 'три')] }));
    const cards = screen.getAllByTestId('hint-card');
    expect(cards.map(c => within(c).getByText(/^\d\. /).textContent)).toEqual(['1. Намёк', '2. Где искать', '3. План']);
    expect(askButton()).toHaveTextContent('💡 Ещё подсказка');
  });

  test('ошибка сервера показывается, кнопка остаётся рабочей', async () => {
    api.requestHint.mockResolvedValue({ error: 'Подсказки временно недоступны. Попробуйте позже.', code: 'provider_unavailable' });
    await mount();
    await userEvent.click(askButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('Подсказки временно недоступны');
    expect(askButton()).toBeEnabled();
    expect(screen.queryAllByTestId('hint-card')).toHaveLength(0);
  });

  test('предыдущая ошибка исчезает при новой попытке', async () => {
    api.requestHint.mockResolvedValueOnce({ error: 'Сбой', code: 'provider_busy' })
      .mockResolvedValueOnce({ hint: hint(1, 1, 'ок'), state: stateOf({ nextLevel: 2, remaining: 7, hints: [hint(1, 1, 'ок')] }) });
    await mount();
    await userEvent.click(askButton());
    await screen.findByRole('alert');
    await userEvent.click(askButton());
    await screen.findByText('ок');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('лимит по задаче: сообщение и блокировка кнопки', async () => {
    api.requestHint.mockResolvedValue({ error: 'Подсказки по этой задаче закончились.', code: 'limit_task' });
    await mount();
    await userEvent.click(askButton());
    await screen.findByRole('alert');
    expect(askButton()).toBeDisabled();
    expect(screen.getByText('осталось 0')).toBeInTheDocument();
  });

  test('сервер сообщил, что подсказки выключены, — панель исчезает', async () => {
    api.requestHint.mockResolvedValue({ error: 'Подсказки на сервере не настроены', code: 'hints_disabled' });
    await mount();
    await userEvent.click(askButton());
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Подсказки' })).toBeNull());
  });
});

describe('пауза между подсказками', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const setup = () => userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

  test('пауза от сервера при загрузке: кнопка выключена и отсчитывает секунды, потом включается', async () => {
    await mount({}, stateOf({ cooldownSeconds: 3, hints: [hint(1, 1, 'раз')], nextLevel: 2, remaining: 7 }));
    expect(askButton()).toBeDisabled();
    expect(screen.getByText(/через 3 с/)).toBeInTheDocument();
    await act(async () => { jest.advanceTimersByTime(1000); });
    expect(screen.getByText(/через 2 с/)).toBeInTheDocument();
    await act(async () => { jest.advanceTimersByTime(2000); });
    expect(askButton()).toBeEnabled();
    expect(screen.queryByText(/Следующая подсказка через/)).toBeNull();
  });

  test('вкладка «спала», а время ушло вперёд: пауза заканчивается по реальному времени, а не по числу тиков', async () => {
    await mount({}, stateOf({ cooldownSeconds: 30, hints: [hint(1, 1, 'раз')], nextLevel: 2, remaining: 7 }));
    expect(askButton()).toBeDisabled();
    await act(async () => { jest.setSystemTime(Date.now() + 31000); jest.advanceTimersByTime(250); }); // один тик после долгого сна
    expect(askButton()).toBeEnabled();
    expect(screen.queryByText(/Следующая подсказка через/)).toBeNull();
  });

  test('ответ 429 с retryAfter запускает отсчёт', async () => {
    api.requestHint.mockResolvedValue({ error: 'Подождите 2 с', code: 'cooldown', retryAfter: 2 });
    await mount();
    await setup().click(askButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('Подождите 2 с');
    expect(screen.getByText(/через 2 с/)).toBeInTheDocument();
    expect(askButton()).toBeDisabled();
    await act(async () => { jest.advanceTimersByTime(2000); });
    expect(askButton()).toBeEnabled();
  });

  test('после полученной подсказки пауза из состояния сервера включается сразу', async () => {
    api.requestHint.mockResolvedValue({ hint: hint(1, 1, 'раз'), state: stateOf({ nextLevel: 2, remaining: 7, cooldownSeconds: 15, hints: [hint(1, 1, 'раз')] }) });
    await mount();
    await setup().click(askButton());
    expect(await screen.findByText(/через 15 с/)).toBeInTheDocument();
    expect(askButton()).toBeDisabled();
  });
});

describe('оценка подсказки', () => {
  const withHint = (helpful = null) => stateOf({ nextLevel: 2, remaining: 7, hints: [hint(5, 1, 'Подумайте о знаке.', helpful)] });
  const up = () => screen.getByRole('button', { name: 'Подсказка помогла' });
  const down = () => screen.getByRole('button', { name: 'Подсказка не помогла' });

  test('сохранённая оценка показывается при загрузке', async () => {
    await mount({}, withHint(true));
    expect(up()).toHaveAttribute('aria-pressed', 'true');
    expect(down()).toHaveAttribute('aria-pressed', 'false');
  });

  test('👍 → true, повторный клик снимает оценку, 👎 ставит false', async () => {
    api.rateHint.mockResolvedValue({ ok: true });
    await mount({}, withHint(null));
    await userEvent.click(up());
    expect(api.rateHint).toHaveBeenLastCalledWith(5, true);
    expect(up()).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(up());
    expect(api.rateHint).toHaveBeenLastCalledWith(5, null);
    expect(up()).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(down());
    expect(api.rateHint).toHaveBeenLastCalledWith(5, false);
    expect(down()).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(up()); // смена мнения: сразу true, без промежуточного снятия
    expect(api.rateHint).toHaveBeenLastCalledWith(5, true);
    expect(down()).toHaveAttribute('aria-pressed', 'false');
  });

  test('если оценка не сохранилась, интерфейс возвращает прежнее значение', async () => {
    api.rateHint.mockResolvedValue({ error: 'Нет связи с сервером' });
    await mount({}, withHint(null));
    await userEvent.click(up());
    await waitFor(() => expect(up()).toHaveAttribute('aria-pressed', 'false'));
  });
});

describe('отображение текста подсказки', () => {
  test('`код` в обратных кавычках оформляется, блок ``` — отдельным блоком кода', () => {
    const { container } = render(<HintText text={'Вызовите `len(x)` для списка:\n```python\nlen(x)\n```\nГотово.'} />);
    expect(container.querySelector('code.hint-inline')).toHaveTextContent('len(x)');
    expect(container.querySelector('pre.hint-code code')).toHaveTextContent('len(x)');
    expect(container).toHaveTextContent('Готово.');
  });

  test('HTML из ответа модели выводится как текст и не превращается в элементы', () => {
    const attack = '<img src=x onerror="alert(1)"> <script>alert(2)</script> <b>жирный</b>';
    const { container } = render(<HintText text={attack} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container).toHaveTextContent('<img src=x onerror="alert(1)">');
  });

  test('заметка о скрытом коде показывается обычным текстом', () => {
    render(<HintText text="Идея такая. (фрагмент кода скрыт: подсказка не должна содержать готовое решение)" />);
    expect(screen.getByText(/фрагмент кода скрыт/)).toBeInTheDocument();
  });

  test('разметка не ломается на непарных обратных кавычках', () => {
    const { container } = render(<HintText text="Нечётная ` кавычка и ещё одна `" />);
    expect(container).toHaveTextContent('Нечётная');
  });
});

describe('прочее', () => {
  test('на панели есть предупреждение о передаче кода во внешний сервис', async () => {
    await mount();
    expect(screen.getByText(/DeepSeek/)).toBeInTheDocument();
    expect(screen.getByText(/отправляются во внешний сервис/)).toBeInTheDocument();
  });

  test('при переходе на другую задачу состояние загружается заново', async () => {
    const { rerender, props } = await mount({ taskId: 1 }, stateOf({ hints: [hint(1, 1, 'первая задача')], nextLevel: 2, remaining: 7 }));
    expect(screen.getByText('первая задача')).toBeInTheDocument();
    api.getHints.mockResolvedValue(stateOf({ hints: [hint(2, 1, 'вторая задача')], nextLevel: 2, remaining: 7 }));
    rerender(<HintPanel {...props} taskId={2} />);
    await screen.findByText('вторая задача');
    expect(screen.queryByText('первая задача')).toBeNull();
    expect(api.getHints).toHaveBeenLastCalledWith(2);
  });

  test('запоздавший ответ по прежней задаче не затирает новую', async () => {
    let resolveOld;
    api.getHints.mockReturnValueOnce(new Promise(r => { resolveOld = r; }));
    const { rerender } = render(<HintPanel taskId={1} code={WRONG} starterCode={STARTER} lastResult={null} />);
    api.getHints.mockResolvedValueOnce(stateOf({ hints: [hint(2, 1, 'новая')], nextLevel: 2, remaining: 7 }));
    rerender(<HintPanel taskId={2} code={WRONG} starterCode={STARTER} lastResult={null} />);
    await screen.findByText('новая');
    await act(async () => resolveOld(stateOf({ hints: [hint(1, 1, 'старая')], nextLevel: 2, remaining: 7 })));
    expect(screen.queryByText('старая')).toBeNull();
    expect(screen.getByText('новая')).toBeInTheDocument();
  });
});
