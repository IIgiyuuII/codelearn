import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('../api', () => ({ api: { login: jest.fn(), register: jest.fn() } }));
import { api } from '../api';
import AuthPage from '../pages/AuthPage';

const fill = async (user = 'alice', pass = 'secret') => {
  await userEvent.type(screen.getByPlaceholderText('введите логин'), user);
  await userEvent.type(screen.getByPlaceholderText('введите пароль'), pass);
};
// Кнопка отправки формы: в режиме входа на экране две кнопки «Войти» (вкладка и сама отправка)
const submit = () => document.querySelector('.auth-btn');
const mount = () => { const onAuth = jest.fn(); render(<AuthPage onAuth={onAuth} />); return onAuth; };

beforeEach(() => { jest.resetAllMocks(); localStorage.clear(); });

test('по умолчанию открыт режим входа', () => {
  mount();
  expect(submit()).toHaveTextContent('Войти');
  expect(screen.getByPlaceholderText('введите пароль')).toHaveAttribute('autocomplete', 'current-password');
});

test('вход: данные уходят в api.login, токен сохраняется, имя передаётся в onAuth', async () => {
  api.login.mockResolvedValue({ token: 'jwt-1', username: 'alice' });
  const onAuth = mount();
  await fill();
  await userEvent.click(submit());
  await waitFor(() => expect(onAuth).toHaveBeenCalledWith('alice'));
  expect(api.login).toHaveBeenCalledWith('alice', 'secret');
  expect(api.register).not.toHaveBeenCalled();
  expect(localStorage.getItem('token')).toBe('jwt-1');
});

test('регистрация: вкладка переключает режим, кнопку и автозаполнение; уходит в api.register', async () => {
  api.register.mockResolvedValue({ token: 'jwt-2', username: 'bob' });
  const onAuth = mount();
  await userEvent.click(screen.getByRole('button', { name: 'Регистрация' }));
  expect(screen.getByPlaceholderText('введите пароль')).toHaveAttribute('autocomplete', 'new-password');
  await fill('bob', 'pw');
  await userEvent.click(screen.getByRole('button', { name: 'Создать аккаунт' }));
  await waitFor(() => expect(onAuth).toHaveBeenCalledWith('bob'));
  expect(api.register).toHaveBeenCalledWith('bob', 'pw');
  expect(api.login).not.toHaveBeenCalled();
  expect(localStorage.getItem('token')).toBe('jwt-2');
});

test('ошибка сервера показывается, токен не сохраняется, onAuth не вызывается', async () => {
  api.login.mockResolvedValue({ error: 'Неверный пароль' });
  const onAuth = mount();
  await fill();
  await userEvent.click(submit());
  expect(await screen.findByText('Неверный пароль')).toBeInTheDocument();
  expect(onAuth).not.toHaveBeenCalled();
  expect(localStorage.getItem('token')).toBeNull();
});

test('сообщение об ошибке исчезает при переключении вкладки', async () => {
  api.login.mockResolvedValue({ error: 'Неверный пароль' });
  mount();
  await fill();
  await userEvent.click(submit());
  await screen.findByText('Неверный пароль');
  await userEvent.click(screen.getByRole('button', { name: 'Регистрация' }));
  expect(screen.queryByText('Неверный пароль')).toBeNull();
});

test('исключение при запросе → «Ошибка сети», кнопка снова доступна', async () => {
  api.login.mockRejectedValue(new Error('boom'));
  mount();
  await fill();
  await userEvent.click(submit());
  expect(await screen.findByText('Ошибка сети')).toBeInTheDocument();
  expect(submit()).toBeEnabled();
});

test('пока идёт запрос, кнопка заблокирована (защита от двойной отправки)', async () => {
  let finish;
  api.login.mockReturnValue(new Promise(r => { finish = r; }));
  mount();
  await fill();
  await userEvent.click(submit());
  expect(screen.getByRole('button', { name: '...' })).toBeDisabled();
  finish({ error: 'x' });
  await screen.findByText('x');
});

test('логин и пароль обязательны: браузер не даст отправить пустую форму (required)', () => {
  mount();
  // jsdom не блокирует отправку по required, поэтому проверяем сам атрибут
  expect(screen.getByPlaceholderText('введите логин')).toBeRequired();
  expect(screen.getByPlaceholderText('введите пароль')).toBeRequired();
  expect(screen.getByPlaceholderText('введите пароль')).toHaveAttribute('type', 'password');
});
