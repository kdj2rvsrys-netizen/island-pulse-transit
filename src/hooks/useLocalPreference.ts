import { useEffect, useState } from 'react';

export function useLocalPreference<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => {
    try { const saved = localStorage.getItem(key); return saved ? JSON.parse(saved) as T : fallback; }
    catch { return fallback; }
  });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private browsing */ } }, [key, value]);
  return [value, setValue] as const;
}
