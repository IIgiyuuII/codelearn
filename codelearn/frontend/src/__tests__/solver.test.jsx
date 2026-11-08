import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('@monaco-editor/react', () => ({
  __esModule: true,
  default: ({ value, language, onChange }) => (
    <textarea data-testid="editor" data-language={language} value={value} onChange={e => onChange && onChange(e.target.value)} />
  ),
}));
// Панель подсказок проверяется отдельно (HintPanel.test.jsx); здесь важно, что решатель передаёт ей верные данные
const mockHintProps = jest.fn();
jest.mock('../pages/HintPanel', () => ({
  __esModule: true,
  default: props => { mockHintProps(props); return <div data-testid="hint-panel" />; },
}));
jest.mock('../api', () => ({
  api: { getTask: jest.fn(), getExamples: jest.fn(), getProgress: jest.fn(), getTests: jest.fn(), markSolved: jest.fn() },
}));
const mockRunCode = jest.fn(); const mockCancel = jest.fn(); const mockRetry = jest.fn();
let mockStatus = 'ready';
let mockLangs = [];
jest.mock('../hooks/useCodeEngine', () => ({
  SUPPORTED_LANGUAGES: ['python', 'javascript'], LANGUAGE_NAMES: { python: 'Python', javascript: 'JavaScript', ruby: 'Ruby' },
  useCodeEngine: lang => { mockLangs.push(lang); return { status: mockStatus, runCode: mockRunCode, cancel: mockCancel, retry: mockRetry }; },
}));

import { api } from '../api';
import SolverPage from '../pages/SolverPage';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const popoverTitle = () => document.querySelector('.output-popover-title').textContent;
const RES = (over) => ({ status: 'ok', passed: false, output: '', error: '', durationMs: 12, ...over });

beforeEach(() => {
  jest.resetAllMocks(); mockStatus = 'ready'; mockLangs = [];
  api.getTask.mockResolvedValue({ id: 1, title: 'Квадрат', description: 'd', starterCode: 'def f(x): pass', difficulty: 'easy', topic: 'Т' });
  api.getExamples.mockResolvedValue({ examples: [] });
  api.getProgress.mockResolvedValue({ solvedTasks: [] });
  api.getTests.mockResolvedValue({ tests: 'assert f(2) == 4' });
  api.markSolved.mockResolvedValue({});
});
const mount = async () => { render(<SolverPage taskId={1} onBack={jest.fn()} />); await screen.findByText('Квадрат'); };

test('пока выполняется код, «Запустить» превращается в «Стоп»; Стоп вызывает cancel, «Проверить» заблокирована', async () => {
  const d = deferred(); mockRunCode.mockReturnValue(d.promise);
  await mount();
  await userEvent.click(screen.getByRole('button', { name: '▶ Запустить' }));
  const stop = await screen.findByRole('button', { name: '■ Стоп' });
  expect(screen.getByRole('button', { name: '✓ Проверить' })).toBeDisabled();
  await userEvent.click(stop);
  expect(mockCancel).toHaveBeenCalledTimes(1);
  await act(async () => d.resolve(RES({ status: 'cancelled', error: 'Выполнение остановлено' })));
  expect(await screen.findByRole('button', { name: '▶ Запустить' })).toBeEnabled();
  expect(screen.queryByText(/Ошибка выполнения/)).toBeNull();      // остановка — не ошибка
  expect(screen.queryByTitle('Показать вывод')).toBeNull();
});

test('таймаут при запуске: понятный заголовок и объяснение', async () => {
  mockRunCode.mockResolvedValue(RES({ status: 'timeout', error: 'Превышено время выполнения (10 с). Проверьте код на бесконечные циклы.' }));
  await mount();
  await userEvent.click(screen.getByRole('button', { name: '▶ Запустить' }));
  await screen.findByText(/Превышено время выполнения/);
  expect(popoverTitle()).toBe('⏱ Время выполнения вышло');
  expect(screen.queryByText('✗ Ошибка выполнения')).toBeNull();
});

test('таймаут при проверке: задача НЕ засчитывается', async () => {
  mockRunCode.mockResolvedValue(RES({ status: 'timeout', error: 'Превышено время выполнения (10 с).' }));
  await mount();
  await userEvent.click(screen.getByRole('button', { name: '✓ Проверить' }));
  await screen.findByText(/Превышено время выполнения/);
  expect(popoverTitle()).toBe('⏱ Время выполнения вышло');
  expect(screen.getByText('⏱ Время выполнения вышло', { selector: '.solver-toast' })).toBeInTheDocument();
  expect(api.markSolved).not.toHaveBeenCalled();
  expect(screen.queryByText('Задача решена')).toBeNull();
});

test('остановка во время проверки: ничего не засчитывается, ошибки не показываются', async () => {
  mockRunCode.mockResolvedValue(RES({ status: 'cancelled' }));
  await mount();
  await userEvent.click(screen.getByRole('button', { name: '✓ Проверить' }));
  expect(await screen.findByText('Проверка остановлена')).toBeInTheDocument();
  expect(api.markSolved).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '✓ Проверить' })).toBeEnabled();
});

test('регрессия: верное решение по-прежнему засчитывается', async () => {
  mockRunCode.mockResolvedValue(RES({ status: 'ok', passed: true }));
  await mount();
  await userEvent.click(screen.getByRole('button', { name: '✓ Проверить' }));
  await waitFor(() => expect(api.markSolved).toHaveBeenCalledWith(1));
  expect(await screen.findByText('Задача решена')).toBeInTheDocument();
  expect(mockRunCode).toHaveBeenCalledWith('def f(x): pass', 'assert f(2) == 4');
});

test('регрессия: непройденные тесты и ошибки выполнения различаются по заголовку', async () => {
  mockRunCode.mockResolvedValueOnce(RES({ status: 'test_failed', error: 'Тест не пройден' }));
  await mount();
  await userEvent.click(screen.getByRole('button', { name: '✓ Проверить' }));
  await screen.findByText('Тест не пройден');
  expect(popoverTitle()).toBe('✗ Тесты не пройдены');
  mockRunCode.mockResolvedValueOnce(RES({ status: 'runtime_error', error: 'NameError: x' }));
  await userEvent.click(screen.getByRole('button', { name: '▶ Запустить' }));
  await screen.findByText('NameError: x');
  expect(popoverTitle()).toBe('✗ Ошибка выполнения');
});

test('Python ещё грузится (в том числе после перезапуска): кнопки запуска заблокированы', async () => {
  mockStatus = 'loading';
  await mount();
  expect(screen.getByRole('button', { name: '▶ Запустить' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '✓ Проверить' })).toBeDisabled();
  expect(screen.getByText(/Загрузка Python/)).toBeInTheDocument();
});

test('ошибка загрузки Python: видна кнопка «повторить», она вызывает retry', async () => {
  mockStatus = 'error';
  await mount();
  expect(screen.getByText('Ошибка загрузки Python')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'повторить' }));
  expect(mockRetry).toHaveBeenCalledTimes(1);
});


describe('выбор языка по задаче', () => {
  const withLanguage = (language, extra = {}) =>
    api.getTask.mockResolvedValue({ id: 1, title: 'Квадрат', description: 'd', starterCode: 'x', difficulty: 'easy', topic: 'Т', language, ...extra });

  test('JavaScript-задача: движок javascript, бейдж, статус, подсветка редактора, подпись «Worker»', async () => {
    withLanguage('javascript');
    mockRunCode.mockResolvedValue(RES({ status: 'ok', output: 'hi\n' }));
    await mount();
    expect(mockLangs[0]).toBe(null);                    // пока задача грузится — движок не выбирается (ничего не грузим зря)
    expect(mockLangs[mockLangs.length - 1]).toBe('javascript');
    expect(screen.getByText('JavaScript', { selector: '.solver-lang-badge' })).toBeInTheDocument();
    expect(screen.getByText('JavaScript готов · Web Worker')).toBeInTheDocument();
    expect(screen.getByTestId('editor')).toHaveAttribute('data-language', 'javascript');
    await userEvent.click(screen.getByRole('button', { name: '▶ Запустить' }));
    expect(await screen.findByText(/мс · Worker/)).toBeInTheDocument();
  });

  test('Python-задача: прежнее поведение (бейдж «Python 3», WASM, подсветка python)', async () => {
    withLanguage('python');
    mockRunCode.mockResolvedValue(RES({ status: 'ok', output: 'hi\n' }));
    await mount();
    expect(mockLangs[mockLangs.length - 1]).toBe('python');
    expect(screen.getByText('Python 3', { selector: '.solver-lang-badge' })).toBeInTheDocument();
    expect(screen.getByText('Python готов · WASM')).toBeInTheDocument();
    expect(screen.getByTestId('editor')).toHaveAttribute('data-language', 'python');
    await userEvent.click(screen.getByRole('button', { name: '▶ Запустить' }));
    expect(await screen.findByText(/мс · WASM/)).toBeInTheDocument();
  });

  test('ответ без поля language (старый сервер) трактуется как Python', async () => {
    withLanguage(undefined);
    await mount();
    expect(mockLangs[mockLangs.length - 1]).toBe('python');
  });

  test('язык без движка (Ruby): понятное сообщение, запуск и проверка заблокированы', async () => {
    withLanguage('ruby'); mockStatus = 'unsupported';
    await mount();
    expect(screen.getByText('Запуск Ruby пока не поддерживается')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '▶ Запустить' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '✓ Проверить' })).toBeDisabled();
    expect(screen.getByTestId('editor')).toHaveAttribute('data-language', 'ruby');
  });

  test('JS: ошибка загрузки показывает название языка', async () => {
    withLanguage('javascript'); mockStatus = 'error';
    await mount();
    expect(screen.getByText('Ошибка загрузки JavaScript')).toBeInTheDocument();
  });

  test('JS: проверка идёт тем же путём — вердикт из раннера, задача засчитывается', async () => {
    withLanguage('javascript');
    api.getTests.mockResolvedValue({ tests: 'assertEqual(f(2), 4);' });
    mockRunCode.mockResolvedValue(RES({ status: 'ok', passed: true }));
    await mount();
    await userEvent.click(screen.getByRole('button', { name: '✓ Проверить' }));
    await waitFor(() => expect(api.markSolved).toHaveBeenCalledWith(1));
    expect(mockRunCode).toHaveBeenCalledWith('x', 'assertEqual(f(2), 4);');
  });
});


describe('панель подсказок в решателе', () => {
  const lastProps = () => mockHintProps.mock.calls[mockHintProps.mock.calls.length - 1][0];

  test('панель получает id задачи, стартовый код и текущий код; результата пока нет', async () => {
    await mount();
    expect(screen.getByTestId('hint-panel')).toBeInTheDocument();
    expect(lastProps()).toMatchObject({ taskId: 1, starterCode: 'def f(x): pass', code: 'def f(x): pass', lastResult: null });
  });

  test('изменения в редакторе сразу попадают в панель', async () => {
    await mount();
    await userEvent.clear(screen.getByTestId('editor'));
    await userEvent.type(screen.getByTestId('editor'), 'return 1');
    expect(lastProps().code).toBe('return 1');
    expect(lastProps().starterCode).toBe('def f(x): pass'); // стартовый код не меняется
  });

  test('после запуска с ошибкой панель знает статус и текст', async () => {
    mockRunCode.mockResolvedValue(RES({ status: 'runtime_error', error: 'NameError: x' }));
    await mount();
    await userEvent.click(screen.getByRole('button', { name: '▶ Запустить' }));
    await waitFor(() => expect(lastProps().lastResult).toEqual({ status: 'runtime_error', text: 'NameError: x' }));
  });

  test('после непройденных тестов — test_failed', async () => {
    mockRunCode.mockResolvedValue(RES({ status: 'test_failed', error: 'Тест не пройден' }));
    await mount();
    await userEvent.click(screen.getByRole('button', { name: '✓ Проверить' }));
    await waitFor(() => expect(lastProps().lastResult).toEqual({ status: 'test_failed', text: 'Тест не пройден' }));
  });

  test('после таймаута — timeout; после успешного запуска — ok', async () => {
    mockRunCode.mockResolvedValueOnce(RES({ status: 'timeout', error: 'Превышено время выполнения' }));
    await mount();
    await userEvent.click(screen.getByRole('button', { name: '▶ Запустить' }));
    await waitFor(() => expect(lastProps().lastResult.status).toBe('timeout'));
    mockRunCode.mockResolvedValueOnce(RES({ status: 'ok', output: 'привет\n' }));
    await userEvent.click(screen.getByRole('button', { name: '▶ Запустить' }));
    await waitFor(() => expect(lastProps().lastResult).toEqual({ status: 'ok', text: 'привет\n' }));
  });
});
