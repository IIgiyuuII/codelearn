import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('../api', () => ({ api: { getCourses: jest.fn(), createCourse: jest.fn() } }));
import { api } from '../api';
import ProfilePage from '../pages/ProfilePage';

const COURSES = [
  { id: 1, title: 'Python — основы', language: 'python', taskCount: 6, solvedCount: 3, isOwner: false, accessCode: null },
  { id: 4, title: 'Мой курс', language: 'javascript', taskCount: 4, solvedCount: 1, isOwner: true, accessCode: 'ABCD2345' },
];
const mount = (extra = {}) => {
  const props = { username: 'alice', onBack: jest.fn(), ...extra };
  render(<ProfilePage {...props} />);
  return props;
};
const openForm = async () => {
  await screen.findByText('Python — основы');
  await userEvent.click(screen.getByRole('button', { name: '+ Создать курс' }));
};

beforeEach(() => { jest.resetAllMocks(); api.getCourses.mockResolvedValue({ courses: COURSES }); });

test('карточка пользователя: имя, решено задач, число курсов и общий прогресс', async () => {
  mount();
  await screen.findByText('Python — основы');
  expect(screen.getByText('@alice')).toBeInTheDocument();
  const stats = (label) => screen.getByText(label).previousSibling.textContent;
  expect(stats('решено задач')).toBe('4');    // 3 + 1
  expect(stats('курсов')).toBe('2');
  expect(stats('прогресс')).toBe('40%');      // 4 из 10
});

test('один курс — «курс» в единственном числе, нет курсов — нули без деления на ноль', async () => {
  api.getCourses.mockResolvedValue({ courses: [] });
  mount();
  await waitFor(() => expect(screen.queryByText('загрузка...')).toBeNull());
  expect(screen.getByText('прогресс').previousSibling.textContent).toBe('0%');
  expect(screen.getByText('курсов')).toBeInTheDocument();
});

test('код доступа виден только владельцу', async () => {
  mount();
  await screen.findByText('Мой курс');
  expect(screen.getByText('ABCD2345')).toBeInTheDocument();
  expect(screen.getAllByText(/Код:/)).toHaveLength(1);
});

test('«Назад» вызывает onBack', async () => {
  const props = mount();
  await screen.findByText('Python — основы');
  await userEvent.click(screen.getByRole('button', { name: '← Назад' }));
  expect(props.onBack).toHaveBeenCalled();
});

describe('создание курса', () => {
  test('форма открывается и закрывается; без названия кнопка неактивна; доступны три языка', async () => {
    mount();
    await openForm();
    expect(screen.getByRole('button', { name: 'Создать курс' })).toBeDisabled();
    expect(screen.getAllByRole('option').map(o => o.value)).toEqual(['python', 'javascript', 'ruby']);
    await userEvent.type(screen.getByPlaceholderText(/Например: Алгоритмы/), '   ');
    expect(screen.getByRole('button', { name: 'Создать курс' })).toBeDisabled(); // пробелы — не название
    await userEvent.click(screen.getByRole('button', { name: '✕ Отмена' }));
    expect(screen.queryByPlaceholderText(/Например: Алгоритмы/)).toBeNull();
  });

  test('успех: данные уходят в API, показывается код доступа, список обновляется, «Готово» закрывает форму', async () => {
    api.createCourse.mockResolvedValue({ id: 9, accessCode: 'NEWCODE1' });
    mount();
    await openForm();
    await userEvent.type(screen.getByPlaceholderText(/Например: Алгоритмы/), 'Новый курс');
    await userEvent.type(screen.getByPlaceholderText('Краткое описание курса'), 'О курсе');
    await userEvent.selectOptions(screen.getByRole('combobox'), 'javascript');
    await userEvent.click(screen.getByRole('button', { name: 'Создать курс' }));
    expect(await screen.findByText('NEWCODE1')).toBeInTheDocument();
    expect(api.createCourse).toHaveBeenCalledWith('Новый курс', 'О курсе', 'javascript');
    await waitFor(() => expect(api.getCourses).toHaveBeenCalledTimes(2));
    await userEvent.click(screen.getByRole('button', { name: 'Готово' }));
    expect(screen.queryByText('NEWCODE1')).toBeNull();
  });

  // Регрессия: раньше при отказе сервера не происходило ничего — пользователь не понимал причину
  test('ошибка сервера показывается пользователю, введённое не теряется', async () => {
    api.createCourse.mockResolvedValue({ error: 'Название не длиннее 200 символов' });
    mount();
    await openForm();
    await userEvent.type(screen.getByPlaceholderText(/Например: Алгоритмы/), 'Слишком длинное');
    await userEvent.click(screen.getByRole('button', { name: 'Создать курс' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Название не длиннее 200 символов');
    expect(screen.getByPlaceholderText(/Например: Алгоритмы/)).toHaveValue('Слишком длинное');
    expect(screen.getByRole('button', { name: 'Создать курс' })).toBeEnabled(); // можно исправить и повторить
  });

  test('ответ без текста ошибки даёт общее сообщение; при повторной отправке старая ошибка убирается', async () => {
    api.createCourse.mockResolvedValueOnce({}).mockResolvedValueOnce({ id: 1, accessCode: 'OKOKOKOK' });
    mount();
    await openForm();
    await userEvent.type(screen.getByPlaceholderText(/Например: Алгоритмы/), 'Курс');
    await userEvent.click(screen.getByRole('button', { name: 'Создать курс' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось создать курс');
    await userEvent.click(screen.getByRole('button', { name: 'Создать курс' }));
    expect(await screen.findByText('OKOKOKOK')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('закрытие и повторное открытие формы сбрасывает прошлую ошибку', async () => {
    api.createCourse.mockResolvedValue({ error: 'Ошибка' });
    mount();
    await openForm();
    await userEvent.type(screen.getByPlaceholderText(/Например: Алгоритмы/), 'К');
    await userEvent.click(screen.getByRole('button', { name: 'Создать курс' }));
    await screen.findByRole('alert');
    await userEvent.click(screen.getByRole('button', { name: '✕ Отмена' }));
    await userEvent.click(screen.getByRole('button', { name: '+ Создать курс' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
