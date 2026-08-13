import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'nowen-forge:theme';
const listeners = new Set<() => void>();
let currentTheme: Theme = 'dark';
let initialized = false;

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function storedTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function renderTheme(theme: Theme, persist: boolean) {
  currentTheme = theme;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  if (persist) {
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // LocalStorage may be blocked; the in-memory theme still works.
    }
  }
  listeners.forEach((listener) => listener());
}

export function initializeTheme() {
  if (initialized) return;
  initialized = true;
  renderTheme(storedTheme() || systemTheme(), false);

  const media = window.matchMedia('(prefers-color-scheme: light)');
  media.addEventListener('change', (event) => {
    if (storedTheme()) return;
    renderTheme(event.matches ? 'light' : 'dark', false);
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, () => currentTheme, () => currentTheme);
  return {
    theme,
    toggleTheme: () => renderTheme(theme === 'light' ? 'dark' : 'light', true)
  };
}
