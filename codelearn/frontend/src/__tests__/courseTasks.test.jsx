import React from 'react';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('../api', () => ({
  api: {
    getCourseTasks: jest.fn(), getTaskFull: jest.fn(), addCourseTask: jest.fn(),
    updateTask: jest.fn(), deleteTask: jest.fn(),
  },
}));
// Pyodide в jsdom не нужен: подменяем хук управляемым раннером
const mockRunCode = jest.fn();
let mockEngineLang = null;
jest.mock('../hooks/useCodeEngine', () => ({
  SUPPORTED_LANGUAGES: ['python', 'javascript'], LANGUAGE_NAMES: { python: 'Python', javascript: 'JavaScript', ruby: 'Ruby' },
  useCodeEngine: lang => { mockEngineLang = lang; return { status: 'ready', runCode: mockRunCode }; },
}));

import { api } from '../api';
import CourseTasksPage from '../pages/CourseTasksPage';

const TASKS = [
  { id: 1, title: 'Сумма', topic: 'Основы', difficulty: 'easy' },
  { id: 2, title: 'Факториал', topic: 'Рекурсия', difficulty: 'medium' },
];
const mountPage = (extra = {}) => {
  const props = { courseId: 5, courseTitle: 'Алгоритмы', onSelectTask: jest.fn(), onBack: jest.fn() };
  render(<CourseTasksPage {...props} {...extra} />);
  return props;
};
const asOwner = (language = 'python', tasks = TASKS) =>
  api.getCourseTasks.mockResolvedValue({ tasks, solvedTasks: [1], isOwner: true, course: { id: 5, title: 'Алгоритмы', language } });

beforeEach(() => { jest.resetAllMocks(); });

test('студент не видит элементов управления', async () => {
  api.getCourseTasks.mockResolvedValue({ tasks: TASKS, solvedTasks: [], isOwner: false, course: { language: 'python' } });
  mountPage();
  await screen.findByText('Сумма');
  expect(screen.queryByText(/Добавить задачу/)).toBeNull();
  expect(screen.queryByLabelText('Редактировать')).toBeNull();
  expect(screen.queryByLabelText('Удалить')).toBeNull();
  expect(screen.queryByText(/владелец/)).toBeNull();
});

test('владелец видит кнопки; клик по иконке не открывает задачу, клик по карточке — открывает', async () => {
  asOwner();
  api.getTaskFull.mockResolvedValue({ task: { title: 'Сумма', topic: 'Основы', difficulty: 'easy', description: 'd', starterCode: 'x' }, hiddenTests: 'assert 1', examples: [] });
  const props = mountPage();
  await screen.findByText('Сумма');
  expect(screen.getByText('Вы владелец курса')).toBeInTheDocument();
  expect(screen.getAllByLabelText('Редактировать')).toHaveLength(2);
  await userEvent.click(screen.getAllByLabelText('Редактировать')[0]);
  expect(props.onSelectTask).not.toHaveBeenCalled();           // stopPropagation работает
  await userEvent.click(screen.getByText('Факториал'));
  expect(props.onSelectTask).toHaveBeenCalledWith(2);
});

test('Enter на кнопке-иконке не «нажимает» карточку', async () => {
  asOwner();
  api.deleteTask.mockResolvedValue({});
  const props = mountPage();
  await screen.findByText('Сумма');
  const del = screen.getAllByLabelText('Удалить')[0];
  del.focus(); await userEvent.keyboard('{Enter}');
  expect(props.onSelectTask).not.toHaveBeenCalled();
  expect(screen.getByText('Удалить задачу?')).toBeInTheDocument();
});

test('создание задачи: отправляется нормальный payload, список перезагружается, показывается уведомление', async () => {
  asOwner('python', []);
  api.addCourseTask.mockResolvedValue({ taskId: 9 });
  mountPage();
  await screen.findByText(/пока нет задач/);
  await userEvent.click(screen.getByText('+ Добавить задачу'));
  const dlg = await screen.findByRole('dialog');
  await userEvent.type(within(dlg).getByPlaceholderText('Например: Сумма двух чисел'), 'Квадрат');
  await userEvent.type(within(dlg).getByPlaceholderText(/Напишите функцию/), 'Верните квадрат');
  fireEvent.change(within(dlg).getByPlaceholderText(/assert sum\(2, 3\) == 5/), { target: { value: 'assert sq(3) == 9' } });
  await userEvent.type(within(dlg).getByPlaceholderText('sum(2, 3)'), 'sq(3)');
  await userEvent.type(within(dlg).getByPlaceholderText('5'), '9');
  asOwner('python', [{ id: 9, title: 'Квадрат', topic: 'Общее', difficulty: 'easy' }]);
  await userEvent.click(within(dlg).getByText('Добавить задачу'));
  await waitFor(() => expect(api.addCourseTask).toHaveBeenCalledTimes(1));
  const [cid, payload] = api.addCourseTask.mock.calls[0];
  expect(cid).toBe(5);
  expect(payload).toMatchObject({ title: 'Квадрат', topic: 'Общее', difficulty: 'easy', description: 'Верните квадрат', hiddenTests: 'assert sq(3) == 9' });
  expect(payload.examples).toEqual([{ input: 'sq(3)', output: '9', explanation: '' }]);   // пустые строки не уходят
  await screen.findByText('Задача добавлена');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(await screen.findByText('Квадрат')).toBeInTheDocument();                        // список обновился
});

test('клиентская валидация: без тестов не отправляет и объясняет почему', async () => {
  asOwner('python', []);
  mountPage();
  await userEvent.click(await screen.findByText('+ Добавить задачу'));
  const dlg = await screen.findByRole('dialog');
  await userEvent.type(within(dlg).getByPlaceholderText('Например: Сумма двух чисел'), 'T');
  await userEvent.type(within(dlg).getByPlaceholderText(/Напишите функцию/), 'D');
  await userEvent.click(within(dlg).getByText('Добавить задачу'));
  expect(await within(dlg).findByText(/Добавьте скрытые тесты/)).toBeInTheDocument();
  expect(api.addCourseTask).not.toHaveBeenCalled();
});

test('ошибка сервера показывается в форме, окно не закрывается', async () => {
  asOwner('python', []);
  api.addCourseTask.mockResolvedValue({ error: 'Название не длиннее 200 символов' });
  mountPage();
  await userEvent.click(await screen.findByText('+ Добавить задачу'));
  const dlg = await screen.findByRole('dialog');
  await userEvent.type(within(dlg).getByPlaceholderText('Например: Сумма двух чисел'), 'T');
  await userEvent.type(within(dlg).getByPlaceholderText(/Напишите функцию/), 'D');
  fireEvent.change(within(dlg).getByPlaceholderText(/assert sum\(2, 3\) == 5/), { target: { value: 'assert 1' } });
  await userEvent.click(within(dlg).getByText('Добавить задачу'));
  expect(await within(dlg).findByText('Название не длиннее 200 символов')).toBeInTheDocument();
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

test('редактирование: форма заполняется данными и тестами, PUT уходит с изменениями', async () => {
  asOwner();
  api.getTaskFull.mockResolvedValue({
    task: { id: 1, title: 'Сумма', topic: 'Основы', difficulty: 'easy', description: 'Сложите', starterCode: 'def s(): pass' },
    hiddenTests: 'assert s(1,2)==3', examples: [{ input: 's(1,2)', output: '3', explanation: 'ну' }],
  });
  api.updateTask.mockResolvedValue({});
  mountPage();
  await screen.findByText('Сумма');
  await userEvent.click(screen.getAllByLabelText('Редактировать')[0]);
  const dlg = await screen.findByRole('dialog');
  expect(api.getTaskFull).toHaveBeenCalledWith(1);
  await waitFor(() => expect(within(dlg).getByDisplayValue('Сумма')).toBeInTheDocument());
  expect(within(dlg).getByDisplayValue('assert s(1,2)==3')).toBeInTheDocument();
  expect(within(dlg).getByDisplayValue('s(1,2)')).toBeInTheDocument();
  const title = within(dlg).getByDisplayValue('Сумма');
  await userEvent.clear(title); await userEvent.type(title, 'Сумма двух');
  await userEvent.click(within(dlg).getByText('Сохранить'));
  await waitFor(() => expect(api.updateTask).toHaveBeenCalledTimes(1));
  expect(api.updateTask.mock.calls[0][0]).toBe(1);
  expect(api.updateTask.mock.calls[0][1]).toMatchObject({ title: 'Сумма двух', hiddenTests: 'assert s(1,2)==3', description: 'Сложите' });
  await screen.findByText('Задача обновлена');
});

test('эталон: неверный блокирует сохранение, верный — разрешает; смена тестов сбрасывает проверку', async () => {
  asOwner('python', []);
  api.addCourseTask.mockResolvedValue({});
  mountPage();
  await userEvent.click(await screen.findByText('+ Добавить задачу'));
  const dlg = await screen.findByRole('dialog');
  await userEvent.type(within(dlg).getByPlaceholderText('Например: Сумма двух чисел'), 'T');
  await userEvent.type(within(dlg).getByPlaceholderText(/Напишите функцию/), 'D');
  const tests = within(dlg).getByPlaceholderText(/assert sum\(2, 3\) == 5/);
  fireEvent.change(tests, { target: { value: 'assert f(1) == 2' } });
  fireEvent.change(within(dlg).getByPlaceholderText(/def solve\(/), { target: { value: 'def f(x): return 0' } });

  // сохранить без проверки эталона нельзя
  await userEvent.click(within(dlg).getByText('Добавить задачу'));
  expect(await within(dlg).findByText(/Проверьте тесты на эталонном решении/)).toBeInTheDocument();

  // эталон не проходит
  mockRunCode.mockResolvedValueOnce({ passed: false, status: 'test_failed', output: '', error: 'Тест не пройден' });
  await userEvent.click(within(dlg).getByText(/Проверить тесты на эталоне/));
  expect(await within(dlg).findByText(/Тест не пройден/)).toBeInTheDocument();
  await userEvent.click(within(dlg).getByText('Добавить задачу'));
  expect(api.addCourseTask).not.toHaveBeenCalled();

  // эталон проходит, заготовка — нет
  mockRunCode.mockResolvedValueOnce({ passed: true, status: 'ok', output: '', error: '', durationMs: 4 })
             .mockResolvedValueOnce({ passed: false, status: 'runtime_error', output: '', error: 'NameError' });
  await userEvent.click(within(dlg).getByText(/Проверить тесты на эталоне/));
  expect(await within(dlg).findByText(/Эталон проходит все тесты/)).toBeInTheDocument();

  // меняем тесты → проверка устарела
  fireEvent.change(tests, { target: { value: 'assert f(1) == 1' } });
  expect(within(dlg).queryByText(/Эталон проходит все тесты/)).toBeNull();

  mockRunCode.mockResolvedValueOnce({ passed: true, status: 'ok', output: '', error: '', durationMs: 4 })
             .mockResolvedValueOnce({ passed: false, status: 'runtime_error', output: '', error: 'x' });
  await userEvent.click(within(dlg).getByText(/Проверить тесты на эталоне/));
  await within(dlg).findByText(/Эталон проходит все тесты/);
  await userEvent.click(within(dlg).getByText('Добавить задачу'));
  await waitFor(() => expect(api.addCourseTask).toHaveBeenCalledTimes(1));
  expect(api.addCourseTask.mock.calls[0][1]).not.toHaveProperty('reference'); // эталон на сервер не уходит
});

test('предупреждение, если стартовый код тоже проходит тесты', async () => {
  asOwner('python', []);
  mountPage();
  await userEvent.click(await screen.findByText('+ Добавить задачу'));
  const dlg = await screen.findByRole('dialog');
  fireEvent.change(within(dlg).getByPlaceholderText(/assert sum\(2, 3\) == 5/), { target: { value: 'assert True' } });
  fireEvent.change(within(dlg).getByPlaceholderText(/def solve\(/), { target: { value: 'pass' } });
  mockRunCode.mockResolvedValue({ passed: true, status: 'ok', output: '', error: '', durationMs: 1 });
  await userEvent.click(within(dlg).getByText(/Проверить тесты на эталоне/));
  expect(await within(dlg).findByText(/стартовый код без изменений тоже проходит/)).toBeInTheDocument();
});

test('курс на неподдерживаемом языке (Ruby): предупреждение, секции эталона нет', async () => {
  asOwner('ruby', []);
  mountPage();
  await userEvent.click(await screen.findByText('+ Добавить задачу'));
  const dlg = await screen.findByRole('dialog');
  expect(within(dlg).getByText(/Язык курса — Ruby/)).toBeInTheDocument();
  expect(within(dlg).queryByText(/Эталонное решение/)).toBeNull();
});

describe('курс на JavaScript', () => {
  const openForm = async () => {
    asOwner('javascript', []);
    mountPage();
    await userEvent.click(await screen.findByText('+ Добавить задачу'));
    return screen.findByRole('dialog');
  };

  test('форма подстраивается: JS-заготовка, подсказки про assertEqual, без предупреждения о языке', async () => {
    const dlg = await openForm();
    expect(within(dlg).getByDisplayValue(/function solve\(\) \{/)).toBeInTheDocument();         // стартовый код на JS
    expect(within(dlg).getByPlaceholderText(/assertEqual\(sum\(2, 3\), 5\)/)).toBeInTheDocument();
    expect(within(dlg).getByText(/assertNotEqual/)).toBeInTheDocument();                           // подсказка про помощников
    expect(within(dlg).queryByText(/assert sum\(2, 3\) == 5/)).toBeNull();                          // Python-пример не показан
    expect(within(dlg).queryByText(/Язык курса —/)).toBeNull();                                     // предупреждения нет
    expect(within(dlg).getByText(/Эталонное решение/)).toBeInTheDocument();                         // проверка эталона доступна
    expect(mockEngineLang).toBe('javascript');                                                      // движок выбран по языку курса
  });

  test('Python-курс по-прежнему получает Python-форму и Python-движок', async () => {
    asOwner('python', []);
    mountPage();
    await userEvent.click(await screen.findByText('+ Добавить задачу'));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByDisplayValue(/def solve\(\):/)).toBeInTheDocument();
    expect(within(dlg).getByPlaceholderText(/assert sum\(2, 3\) == 5/)).toBeInTheDocument();
    expect(mockEngineLang).toBe('python');
  });

  test('проверка эталона работает для JS: верный проходит, пустая заготовка — нет, задача сохраняется', async () => {
    const dlg = await openForm();
    api.addCourseTask.mockResolvedValue({});
    await userEvent.type(within(dlg).getByPlaceholderText('Например: Сумма двух чисел'), 'Квадрат');
    await userEvent.type(within(dlg).getByPlaceholderText(/Напишите функцию/), 'Верните квадрат');
    fireEvent.change(within(dlg).getByPlaceholderText(/assertEqual\(sum/), { target: { value: 'assertEqual(sq(3), 9);' } });
    fireEvent.change(within(dlg).getByPlaceholderText(/function solve\(\.\.\.\)/), { target: { value: 'const sq = x => x * x;' } });
    mockRunCode.mockResolvedValueOnce({ passed: true, status: 'ok', output: '', error: '', durationMs: 3 })
               .mockResolvedValueOnce({ passed: false, status: 'runtime_error', output: '', error: 'ReferenceError: sq is not defined' });
    await userEvent.click(within(dlg).getByText(/Проверить тесты на эталоне/));
    expect(await within(dlg).findByText(/Эталон проходит все тесты/)).toBeInTheDocument();
    expect(mockRunCode).toHaveBeenNthCalledWith(1, 'const sq = x => x * x;', 'assertEqual(sq(3), 9);');
    await userEvent.click(within(dlg).getByText('Добавить задачу'));
    await waitFor(() => expect(api.addCourseTask).toHaveBeenCalledTimes(1));
    expect(api.addCourseTask.mock.calls[0][1]).toMatchObject({ title: 'Квадрат', hiddenTests: 'assertEqual(sq(3), 9);' });
  });
});

test('удаление: подтверждение, отмена ничего не делает, подтверждение вызывает API и обновляет список', async () => {
  asOwner();
  api.deleteTask.mockResolvedValue({});
  mountPage();
  await screen.findByText('Сумма');
  await userEvent.click(screen.getAllByLabelText('Удалить')[0]);
  await userEvent.click(screen.getByText('Отмена'));
  expect(api.deleteTask).not.toHaveBeenCalled();
  await userEvent.click(screen.getAllByLabelText('Удалить')[0]);
  asOwner('python', [TASKS[1]]);
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Удалить' }));
  await waitFor(() => expect(api.deleteTask).toHaveBeenCalledWith(1));
  await screen.findByText('Задача удалена');
  await waitFor(() => expect(screen.queryByText('Сумма')).toBeNull());
});

test('Tab в поле кода вставляет 4 пробела', async () => {
  asOwner('python', []);
  mountPage();
  await userEvent.click(await screen.findByText('+ Добавить задачу'));
  const dlg = await screen.findByRole('dialog');
  const tests = within(dlg).getByPlaceholderText(/assert sum\(2, 3\) == 5/);
  await userEvent.click(tests);
  await userEvent.keyboard('if x:{Tab}y');
  expect(tests.value).toBe('if x:    y');
});

test('ошибка загрузки задачи для редактирования показывается и не ломает окно', async () => {
  asOwner();
  api.getTaskFull.mockResolvedValue({ error: 'Изменять задачи может только владелец курса' });
  mountPage();
  await screen.findByText('Сумма');
  await userEvent.click(screen.getAllByLabelText('Редактировать')[0]);
  expect(await screen.findByText('Изменять задачи может только владелец курса')).toBeInTheDocument();
  expect(screen.queryByText('Сохранить')).toBeNull();
});
