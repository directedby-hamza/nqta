'use client';
import { useEffect, useState } from 'react';
import { api, message } from './api';
export function useResource<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  async function refresh() {
    setLoading(true);
    try {
      setData(await api<T>(path));
      setError('');
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    let active = true;
    setLoading(true);
    api<T>(path)
      .then((value) => {
        if (active) {
          setData(value);
          setError('');
        }
      })
      .catch((e) => {
        if (active) setError(message(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [path]);
  return { data, error, loading, refresh };
}
