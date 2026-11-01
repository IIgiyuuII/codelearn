import React from 'react';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('../api', () => ({
  api: {
    getCourseStats: jest.fn(), updateCourse: jest.fn(), deleteCourse: jest.fn(),
    regenerateAccessCode: jest.fn(), getCourseTasks: jest.fn(),
  },
}));
jest.mock('../hooks/useCodeEngine', () => ({
  SUPPORTED_LANGUAGES: ['python', 'javascript'], LANGUAGE_NAMES: { python: 'Python', javascript: 'JavaScript', ruby: 'Ruby' },
  useCodeEngine: () => ({ status: 'ready', runCode: jest.fn() }),
}));

import { api } from '../api';
import CourseManagePage from '../pages/CourseManagePage';
import CourseTasksPage from '../pages/CourseTasksPage';

const STATS = {
  course: { id: 7, title: 'Алгоритмы', description: 'Описание', language: 'python', accessCode: 'ABCD2345' },
  totalTasks: 3,
  summary: { memberCount: 2, avgProgress: 67, completedCount: 1 },
  members: [
    { userId: 2, username: 'carol', enrolledAt: '2026-10-01T10:00:00Z', solvedCount: 3, lastActiveAt: '2026-10-20T12:00:00Z' },
    { userId: 3, username: '=HYPERLINK("x")', enrolledAt: '2026-10-02T10:00:00Z', solvedCount: 1, lastActiveAt: null },
  ],
  tasks: [
    { id: 1, title: 'Сумма', difficulty: 'easy', solvedCount: 2 },
    { id: 2, title: 'Факториал', difficulty: 'medium', solvedCount: 1 },
    { id: 3, title: 'Палиндром', difficulty: 'hard', solvedCount: 1 },
  ],
};
const EMPTY = { ...STATS, members: [], tasks: [], totalTasks: 0, summary: { memberCount: 0, avgProgress: 0, completedCount: 0 } };

const mount = (stats = STATS, extra = {}) => {
  api.getCourseStats.mockResolvedValue(stats);
  const props = { courseId: 7, onBack: jest.fn(), onCourseChanged: jest.fn(), onDeleted: jest.fn(), ...extra };
  render(<CourseManagePage {...props} />);
  return props;
};
const openSettings = async () => { await screen.findByText('Управление курсом'); await userEvent.click(screen.getByRole('tab', { name: 'Настройки' })); };

beforeEach(() => { jest.resetAllMocks(); });

describe('вкладка «Участники»', () => {
  test('сводка, таблица с прогрессом и решаемость задач', async () => {
    mount();
    expect(await screen.findByText('carol')).toBeInTheDocument();
    expect(screen.getByText('67%')).toBeInTheDocument();
    expect(screen.getByText('3 / 3')).toBeInTheDocument();
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
    expect(screen.getByText('2 из 2')).toBeInTheDocument();     // «Сумма»: решили оба
    expect(screen.getAllByText('1 из 2')).toHaveLength(2);
    expect(screen.getByText('20.10.2026')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);  // у второго нет активности
  });

  test('пустой курс: подсказка с кодом доступа, без таблицы и CSV', async () => {
    mount(EMPTY);
    expect(await screen.findByText(/Пока никто не вступил/)).toBeInTheDocument();
    expect(screen.getByText('ABCD2345')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText(/Скачать CSV/)).toBeNull();
  });

  test('CSV: BOM, разделитель «;», защита от формул, безопасное имя файла', async () => {
    let blob, filename;
    global.URL.createObjectURL = jest.fn(b => { blob = b; return 'blob:x'; });
    global.URL.revokeObjectURL = jest.fn();
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { filename = this.download; });
    mount({ ...STATS, course: { ...STATS.course, title: 'ООП: курс/1' } });
    await userEvent.click(await screen.findByText(/Скачать CSV/));
    expect(click).toHaveBeenCalled();
    const bytes = new Uint8Array(await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsArrayBuffer(blob); }));
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xEF, 0xBB, 0xBF]);        // UTF-8 BOM для Excel
    const text = new (require('util').TextDecoder)('utf-8').decode(bytes.slice(3));
    const lines = text.split('\r\n');
    expect(lines[0]).toBe('"Участник";"Решено задач";"Всего задач";"Прогресс, %";"Вступил";"Последняя активность"');
    expect(lines[1]).toBe('"carol";"3";"3";"100";"01.10.2026";"20.10.2026"');
    expect(lines[2].startsWith(`"'=HYPERLINK(""x"")"`)).toBe(true);   // формула обезврежена, кавычки экранированы
    expect(lines[2]).toContain('"33"');
    expect(filename).toBe('ООП_ курс_1 — участники.csv');
    click.mockRestore();
  });
});

describe('вкладка «Настройки»', () => {
  test('«Сохранить» неактивна без изменений; сохранение шлёт название и описание и сообщает App', async () => {
    api.updateCourse.mockResolvedValue({ course: { id: 7, title: 'Новое имя', description: 'Описание' } });
    const props = mount();
    await openSettings();
    const save = screen.getByRole('button', { name: 'Сохранить' });
    expect(save).toBeDisabled();
    const title = screen.getByLabelText('Название');
    await userEvent.clear(title); await userEvent.type(title, 'Новое имя');
    expect(save).toBeEnabled();
    await userEvent.click(save);
    await waitFor(() => expect(api.updateCourse).toHaveBeenCalledWith(7, { title: 'Новое имя', description: 'Описание' }));
    await screen.findByText('Изменения сохранены');
    expect(props.onCourseChanged).toHaveBeenCalledWith('Новое имя');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Новое имя');
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
  });

  test('пустое название не отправляется; ошибка сервера показывается', async () => {
    api.updateCourse.mockResolvedValue({ error: 'Название не длиннее 200 символов' });
    mount();
    await openSettings();
    const title = screen.getByLabelText('Название');
    await userEvent.clear(title);
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText('Название не может быть пустым')).toBeInTheDocument();
    expect(api.updateCourse).not.toHaveBeenCalled();
    await userEvent.type(title, 'X');
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText('Название не длиннее 200 символов')).toBeInTheDocument();
  });

  test('язык показан, но не редактируется', async () => {
    mount(); await openSettings();
    expect(screen.getByText(/Язык: Python/)).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  test('новый код: сначала предупреждение, отмена ничего не делает, подтверждение меняет код', async () => {
    api.regenerateAccessCode.mockResolvedValue({ accessCode: 'ZZZZ9999' });
    mount(); await openSettings();
    expect(screen.getByTestId('access-code')).toHaveTextContent('ABCD2345');
    await userEvent.click(screen.getByRole('button', { name: 'Создать новый' }));
    expect(screen.getByText(/Старый код перестанет работать/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(api.regenerateAccessCode).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Создать новый' }));
    await userEvent.click(screen.getByRole('button', { name: 'Создать новый код' }));
    await waitFor(() => expect(screen.getByTestId('access-code')).toHaveTextContent('ZZZZ9999'));
    expect(api.regenerateAccessCode).toHaveBeenCalledWith(7);
    await screen.findByText('Создан новый код доступа');
  });

  test('копирование кода', async () => {
    const writeText = jest.fn().mockResolvedValue();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    mount(); await openSettings();
    await userEvent.click(screen.getByRole('button', { name: 'Копировать' }));
    expect(writeText).toHaveBeenCalledWith('ABCD2345');
    await screen.findByText('Код скопирован');
  });
});

describe('удаление курса', () => {
  const openDialog = async () => {
    await openSettings();
    await userEvent.click(screen.getByRole('button', { name: 'Удалить курс…' }));
    return screen.getByRole('alertdialog');
  };

  test('окно предупреждает, что именно будет удалено, и просит ввести название', async () => {
    mount(); const dlg = await openDialog();
    expect(within(dlg).getByText('Вы уверены, что хотите удалить курс?')).toBeInTheDocument();
    expect(within(dlg).getByText(/задач — 3/)).toBeInTheDocument();
    expect(within(dlg).getByText(/участников — 2/)).toBeInTheDocument();
    expect(within(dlg).getByText('Алгоритмы')).toBeInTheDocument();
    expect(within(dlg).getByRole('button', { name: 'Удалить курс навсегда' })).toBeDisabled();
  });

  test('точное совпадение включает кнопку; неверный регистр — нет', async () => {
    mount(); const dlg = await openDialog();
    const input = within(dlg).getByPlaceholderText('Название курса');
    const btn = within(dlg).getByRole('button', { name: 'Удалить курс навсегда' });
    await userEvent.type(input, 'алгоритмы');  expect(btn).toBeDisabled();
    await userEvent.clear(input);
    await userEvent.type(input, '  Алгоритмы ');  expect(btn).toBeEnabled();
  });

  test('успех: в API уходит введённое название, показывается итог, «К моим курсам» вызывает onDeleted', async () => {
    api.deleteCourse.mockResolvedValue({ message: 'Курс удалён' });
    const props = mount(); const dlg = await openDialog();
    await userEvent.type(within(dlg).getByPlaceholderText('Название курса'), 'Алгоритмы');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Удалить курс навсегда' }));
    await waitFor(() => expect(api.deleteCourse).toHaveBeenCalledWith(7, 'Алгоритмы'));
    expect(await screen.findByText('Курс удалён')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'К моим курсам' }));
    expect(props.onDeleted).toHaveBeenCalled();
  });

  test('Enter в поле отправляет форму, когда название совпало', async () => {
    api.deleteCourse.mockResolvedValue({});
    mount(); const dlg = await openDialog();
    await userEvent.type(within(dlg).getByPlaceholderText('Название курса'), 'Алгоритмы{Enter}');
    await waitFor(() => expect(api.deleteCourse).toHaveBeenCalledTimes(1));
  });

  test('Enter при несовпадении ничего не удаляет', async () => {
    mount(); const dlg = await openDialog();
    await userEvent.type(within(dlg).getByPlaceholderText('Название курса'), 'не то{Enter}');
    expect(api.deleteCourse).not.toHaveBeenCalled();
  });

  test('ошибка сервера: окно остаётся, ошибка видна, можно повторить', async () => {
    api.deleteCourse.mockResolvedValue({ error: 'Не удалось удалить курс' });
    mount(); const dlg = await openDialog();
    await userEvent.type(within(dlg).getByPlaceholderText('Название курса'), 'Алгоритмы');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Удалить курс навсегда' }));
    expect(await within(dlg).findByText('Не удалось удалить курс')).toBeInTheDocument();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(within(dlg).getByRole('button', { name: 'Удалить курс навсегда' })).toBeEnabled();
  });

  test('«Отмена» и Escape закрывают окно без запросов', async () => {
    mount(); let dlg = await openDialog();
    await userEvent.click(within(dlg).getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Удалить курс…' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(api.deleteCourse).not.toHaveBeenCalled();
  });
});

test('чужой курс: ошибка доступа и кнопка «Назад»', async () => {
  api.getCourseStats.mockResolvedValue({ error: 'Управлять курсом может только его владелец' });
  const onBack = jest.fn();
  render(<CourseManagePage courseId={7} onBack={onBack} onCourseChanged={jest.fn()} onDeleted={jest.fn()} />);
  expect(await screen.findByText('Управлять курсом может только его владелец')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '← Назад' }));
  expect(onBack).toHaveBeenCalled();
});

describe('вход на страницу управления из списка задач', () => {
  const tasksPage = (isOwner, onManage) => {
    api.getCourseTasks.mockResolvedValue({ tasks: [], solvedTasks: [], isOwner, course: { language: 'python' } });
    render(<CourseTasksPage courseId={7} courseTitle="Алгоритмы" onSelectTask={jest.fn()} onManage={onManage} onBack={jest.fn()} />);
  };
  test('владелец видит кнопку и попадает на управление', async () => {
    const onManage = jest.fn(); tasksPage(true, onManage);
    await userEvent.click(await screen.findByText('⚙ Управление курсом'));
    expect(onManage).toHaveBeenCalled();
  });
  test('студент кнопки не видит', async () => {
    tasksPage(false, jest.fn());
    await screen.findByText(/пока нет задач/);
    expect(screen.queryByText(/Управление курсом/)).toBeNull();
  });
});
