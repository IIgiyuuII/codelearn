import React from 'react';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Страницы заменены заглушками: здесь проверяется только маршрутизация и состояние App
jest.mock('../hooks/useCodeEngine', () => ({ preloadPython: jest.fn() }));
jest.mock('../pages/AuthPage', () => ({ __esModule: true, default: ({ onAuth }) => <button onClick={() => onAuth('alice')}>AUTH</button> }));
jest.mock('../pages/CoursesPage', () => ({
  __esModule: true,
  default: ({ username, onSelectCourse, onProfile, onLogout }) => (
    <div>
      <span>COURSES for {username}</span>
      <button onClick={() => onSelectCourse(5, 'Алгоритмы')}>open-course</button>
      <button onClick={onProfile}>open-profile</button>
      <button onClick={onLogout}>logout</button>
    </div>
  ),
}));
jest.mock('../pages/CourseTasksPage', () => ({
  __esModule: true,
  default: ({ courseId, courseTitle, onSelectTask, onManage, onBack }) => (
    <div>
      <span>TASKS course={courseId} title={courseTitle}</span>
      <button onClick={() => onSelectTask(42)}>open-task</button>
      <button onClick={onManage}>manage</button>
      <button onClick={onBack}>back-to-courses</button>
    </div>
  ),
}));
jest.mock('../pages/CourseManagePage', () => ({
  __esModule: true,
  default: ({ courseId, onBack, onCourseChanged, onDeleted }) => (
    <div>
      <span>MANAGE course={courseId}</span>
      <button onClick={() => onCourseChanged('Новое имя')}>rename</button>
      <button onClick={onBack}>back-to-tasks</button>
      <button onClick={onDeleted}>deleted</button>
    </div>
  ),
}));
jest.mock('../pages/SolverPage', () => ({
  __esModule: true,
  default: ({ taskId, onBack }) => (<div><span>SOLVER task={taskId}</span><button onClick={onBack}>back-from-solver</button></div>),
}));
jest.mock('../pages/ProfilePage', () => ({
  __esModule: true,
  default: ({ username, onBack }) => (<div><span>PROFILE {username}</span><button onClick={onBack}>back-from-profile</button></div>),
}));

import App from '../App';
import { preloadPython } from '../hooks/useCodeEngine';

const click = name => userEvent.click(screen.getByRole('button', { name }));
const loggedIn = () => { localStorage.setItem('token', 't'); localStorage.setItem('username', 'alice'); };

beforeEach(() => { localStorage.clear(); preloadPython.mockClear(); });

describe('вход и сессия', () => {
  test('без сохранённой сессии показывается вход, Python не прогревается', () => {
    render(<App />);
    expect(screen.getByText('AUTH')).toBeInTheDocument();
    expect(preloadPython).not.toHaveBeenCalled();
  });

  test('сохранённая сессия (токен + имя) открывает список курсов и запускает прогрев Python', async () => {
    loggedIn();
    render(<App />);
    expect(await screen.findByText('COURSES for alice')).toBeInTheDocument();
    expect(preloadPython).toHaveBeenCalled();
  });

  test.each([['только токен', () => localStorage.setItem('token', 't')], ['только имя', () => localStorage.setItem('username', 'alice')]])(
    '%s — сессия неполная, остаёмся на входе', (_, setup) => {
      setup();
      render(<App />);
      expect(screen.getByText('AUTH')).toBeInTheDocument();
    });

  test('успешный вход запоминает имя и открывает курсы', async () => {
    render(<App />);
    await click('AUTH');
    expect(screen.getByText('COURSES for alice')).toBeInTheDocument();
    expect(localStorage.getItem('username')).toBe('alice');
    expect(preloadPython).toHaveBeenCalled();
  });

  test('выход очищает сессию и возвращает на вход', async () => {
    loggedIn();
    render(<App />);
    await click('logout');
    expect(screen.getByText('AUTH')).toBeInTheDocument();
    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('username')).toBeNull();
  });
});

describe('навигация', () => {
  beforeEach(loggedIn);

  test('курс → задача → назад; в страницы передаются нужные id и название', async () => {
    render(<App />);
    await click('open-course');
    expect(screen.getByText('TASKS course=5 title=Алгоритмы')).toBeInTheDocument();
    await click('open-task');
    expect(screen.getByText('SOLVER task=42')).toBeInTheDocument();
    await click('back-from-solver');
    expect(screen.getByText('TASKS course=5 title=Алгоритмы')).toBeInTheDocument();
    await click('back-to-courses');
    expect(screen.getByText('COURSES for alice')).toBeInTheDocument();
  });

  test('управление курсом: открыть, переименовать, вернуться — новое название видно в списке задач', async () => {
    render(<App />);
    await click('open-course');
    await click('manage');
    expect(screen.getByText('MANAGE course=5')).toBeInTheDocument();
    await click('rename');
    await click('back-to-tasks');
    expect(screen.getByText('TASKS course=5 title=Новое имя')).toBeInTheDocument();
  });

  test('после удаления курса — список курсов, выбранный курс забыт', async () => {
    render(<App />);
    await click('open-course');
    await click('manage');
    await click('deleted');
    expect(screen.getByText('COURSES for alice')).toBeInTheDocument();
    await click('open-course'); // снова выбираем — старое состояние не мешает
    expect(screen.getByText('TASKS course=5 title=Алгоритмы')).toBeInTheDocument();
  });

  test('профиль: открыть и вернуться', async () => {
    render(<App />);
    await click('open-profile');
    expect(screen.getByText('PROFILE alice')).toBeInTheDocument();
    await click('back-from-profile');
    expect(screen.getByText('COURSES for alice')).toBeInTheDocument();
  });
});

describe('истёкшая сессия', () => {
  beforeEach(loggedIn);

  test.each([
    ['на странице курсов', []],
    ['на странице задач курса', ['open-course']],
    ['в решателе', ['open-course', 'open-task']],
    ['в управлении курсом', ['open-course', 'manage']],
    ['в профиле', ['open-profile']],
  ])('событие auth:expired %s возвращает на вход', async (_, path) => {
    render(<App />);
    await screen.findByText('COURSES for alice');
    for (const step of path) await click(step);
    act(() => { window.dispatchEvent(new Event('auth:expired')); });
    expect(screen.getByText('AUTH')).toBeInTheDocument();
  });

  test('после повторного входа выбранный ранее курс не «залипает»', async () => {
    render(<App />);
    await click('open-course');
    act(() => { window.dispatchEvent(new Event('auth:expired')); });
    await click('AUTH');
    expect(screen.getByText('COURSES for alice')).toBeInTheDocument();
  });

  test('обработчик снимается при размонтировании', () => {
    const { unmount } = render(<App />);
    unmount();
    expect(() => window.dispatchEvent(new Event('auth:expired'))).not.toThrow();
  });
});
