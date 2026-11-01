import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('../api', () => ({ api: { getCourses: jest.fn(), joinCourse: jest.fn() } }));
import { api } from '../api';
import CoursesPage from '../pages/CoursesPage';

const COURSES = [
  { id: 1, title: 'Python — основы', description: 'Базовые алгоритмы', language: 'python', taskCount: 6, solvedCount: 2, isOwner: false },
  { id: 9, title: 'Мой JS', description: '', language: 'javascript', taskCount: 0, solvedCount: 0, isOwner: true },
];
const mount = (extra = {}) => {
  const props = { username: 'alice', onSelectCourse: jest.fn(), onProfile: jest.fn(), onLogout: jest.fn(), ...extra };
  render(<CoursesPage {...props} />);
  return props;
};

beforeEach(() => { jest.resetAllMocks(); api.getCourses.mockResolvedValue({ courses: COURSES }); });

test('показывает загрузку, затем карточки курсов с прогрессом', async () => {
  mount();
  expect(screen.getByText('загрузка...')).toBeInTheDocument();
  const card = (await screen.findByText('Python — основы')).closest('button');
  expect(within(card).getByText('2 / 6 задач')).toBeInTheDocument();
  expect(within(card).getByText('33%')).toBeInTheDocument();
  expect(within(card).getByText('Базовые алгоритмы')).toBeInTheDocument();
  expect(within(card).getByText('🐍')).toBeInTheDocument();
  expect(within(card).queryByText('мой курс')).toBeNull();
});

test('курс владельца помечен, пустой курс не даёт деления на ноль, иконка по языку', async () => {
  mount();
  const card = (await screen.findByText('Мой JS')).closest('button');
  expect(within(card).getByText('мой курс')).toBeInTheDocument();
  expect(within(card).getByText('0 / 0 задач')).toBeInTheDocument();
  expect(within(card).getByText('0%')).toBeInTheDocument();
  expect(within(card).getByText('⚡')).toBeInTheDocument();
});

test('неизвестный язык курса получает значок по умолчанию', async () => {
  api.getCourses.mockResolvedValue({ courses: [{ id: 3, title: 'Экзотика', language: 'cobol', taskCount: 1, solvedCount: 0 }] });
  mount();
  expect(await screen.findByText('📚')).toBeInTheDocument();
});

test('клик по карточке передаёт id и название курса', async () => {
  const props = mount();
  await userEvent.click((await screen.findByText('Мой JS')).closest('button'));
  expect(props.onSelectCourse).toHaveBeenCalledWith(9, 'Мой JS');
});

test('аватар ведёт в профиль, «выйти» вызывает onLogout; на аватаре инициалы', async () => {
  const props = mount({ username: 'alice' });
  await screen.findByText('Python — основы');
  expect(screen.getByTitle('Профиль')).toHaveTextContent('AL');
  await userEvent.click(screen.getByTitle('Профиль'));
  await userEvent.click(screen.getByRole('button', { name: 'выйти' }));
  expect(props.onProfile).toHaveBeenCalled();
  expect(props.onLogout).toHaveBeenCalled();
});

test('ответ без списка курсов не ломает страницу', async () => {
  api.getCourses.mockResolvedValue({ error: 'Нет связи с сервером' });
  mount();
  await waitFor(() => expect(screen.queryByText('загрузка...')).toBeNull());
  expect(screen.getByText('Мои курсы')).toBeInTheDocument();
});

describe('вступление по коду', () => {
  const input = () => screen.getByPlaceholderText('Код доступа к курсу...');

  test('кнопка неактивна без кода; ввод приводится к верхнему регистру и ограничен 8 символами', async () => {
    mount();
    await screen.findByText('Python — основы');
    expect(screen.getByRole('button', { name: 'Вступить' })).toBeDisabled();
    expect(input()).toHaveAttribute('maxLength', '8');
    await userEvent.type(input(), 'abcd2345');
    expect(input()).toHaveValue('ABCD2345');
    expect(screen.getByRole('button', { name: 'Вступить' })).toBeEnabled();
  });

  test('успех: сообщение, поле очищается, список перезагружается', async () => {
    api.joinCourse.mockResolvedValue({ message: 'Вы вступили в курс «Алгоритмы»' });
    mount();
    await screen.findByText('Python — основы');
    await userEvent.type(input(), 'abcd2345');
    await userEvent.click(screen.getByRole('button', { name: 'Вступить' }));
    expect(await screen.findByText('Вы вступили в курс «Алгоритмы»')).toBeInTheDocument();
    expect(api.joinCourse).toHaveBeenCalledWith('ABCD2345');
    expect(input()).toHaveValue('');
    await waitFor(() => expect(api.getCourses).toHaveBeenCalledTimes(2));
  });

  test('ошибка: показывается текст сервера, код остаётся для исправления, список не перезагружается', async () => {
    api.joinCourse.mockResolvedValue({ error: 'Курс с таким кодом не найден' });
    mount();
    await screen.findByText('Python — основы');
    await userEvent.type(input(), 'ZZZZZZZZ');
    await userEvent.click(screen.getByRole('button', { name: 'Вступить' }));
    expect(await screen.findByText('Курс с таким кодом не найден')).toBeInTheDocument();
    expect(input()).toHaveValue('ZZZZZZZZ');
    expect(api.getCourses).toHaveBeenCalledTimes(1);
  });
});
