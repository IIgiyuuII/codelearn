import React, { useState, useEffect } from 'react';
import AuthPage from './pages/AuthPage';
import CoursesPage from './pages/CoursesPage';
import CourseTasksPage from './pages/CourseTasksPage';
import CourseManagePage from './pages/CourseManagePage';
import SolverPage from './pages/SolverPage';
import ProfilePage from './pages/ProfilePage';
import { preloadPython } from './hooks/usePyodide';

export default function App() {
  const [page, setPage] = useState('auth');
  const [username, setUsername] = useState('');
  const [selectedCourse, setSelectedCourse] = useState(null); // { id, title }
  const [selectedTask, setSelectedTask] = useState(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    const saved = localStorage.getItem('username');
    if (token && saved) {
      setUsername(saved);
      setPage('courses');
    }
  }, []);

  // Python (Pyodide) начинаем грузить сразу после входа: пока студент выбирает курс и задачу,
  // движок уже готов. Загрузка идёт в фоне (Web Worker) и интерфейс не тормозит.
  useEffect(() => {
    if (page !== 'auth') preloadPython();
  }, [page]);

  // Сессия истекла (api.js получил 401) — возвращаем на страницу входа
  useEffect(() => {
    const onExpired = () => {
      setUsername('');
      setSelectedCourse(null);
      setSelectedTask(null);
      setPage('auth');
    };
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, []);

  function handleAuth(name) {
    setUsername(name);
    localStorage.setItem('username', name);
    setPage('courses');
  }

  function handleLogout() {
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    setUsername('');
    setPage('auth');
  }

  function handleSelectCourse(id, title) {
    setSelectedCourse({ id, title });
    setPage('courseTasks');
  }

  function handleSelectTask(id) {
    setSelectedTask(id);
    setPage('solver');
  }

  if (page === 'auth')        return <AuthPage onAuth={handleAuth} />;
  if (page === 'courses')     return <CoursesPage username={username} onSelectCourse={handleSelectCourse} onProfile={() => setPage('profile')} onLogout={handleLogout} />;
  if (page === 'courseTasks') return <CourseTasksPage courseId={selectedCourse?.id} courseTitle={selectedCourse?.title} onSelectTask={handleSelectTask} onManage={() => setPage('courseManage')} onBack={() => setPage('courses')} />;
  if (page === 'courseManage') return <CourseManagePage courseId={selectedCourse?.id} onBack={() => setPage('courseTasks')} onCourseChanged={title => setSelectedCourse(c => ({ ...c, title }))} onDeleted={() => { setSelectedCourse(null); setPage('courses'); }} />;
  if (page === 'solver')      return <SolverPage taskId={selectedTask} onBack={() => setPage('courseTasks')} />;
  if (page === 'profile')     return <ProfilePage username={username} onBack={() => setPage('courses')} />;

  return null;
}
