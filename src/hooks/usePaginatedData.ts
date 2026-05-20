/**
 * Hook genérico para páginas paginadas com filtros no backend.
 * Padrão Vortek: todas as listas com >100 registros devem usar este hook.
 */
import { useState, useCallback, useEffect } from 'react';

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UsePaginatedDataOptions {
  endpoint: string;
  pageSize?: number;
  debounceMs?: number;
}

export interface UsePaginatedDataResult<T> {
  data: T[];
  loading: boolean;
  total: number;
  page: number;
  setPage: (p: number) => void;
  params: URLSearchParams;
  setParam: (key: string, value: string | null) => void;
  refresh: () => void;
}

export function usePaginatedData<T>({
  endpoint,
  pageSize = 100,
  debounceMs = 300,
}: UsePaginatedDataOptions): UsePaginatedDataResult<T> {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPageState] = useState(1);
  const [params, setParams] = useState<URLSearchParams>(new URLSearchParams());
  const [searchVersion, setSearchVersion] = useState(0);

  const setParam = useCallback((key: string, value: string | null) => {
    setParams(prev => {
      const next = new URLSearchParams(prev);
      if (value === null || value === '') {
        next.delete(key);
      } else {
        next.set(key, value);
      }
      return next;
    });
    setPageState(1);
    setSearchVersion(v => v + 1);
  }, []);

  const setPage = useCallback((p: number) => {
    setPageState(p);
    setSearchVersion(v => v + 1);
  }, []);

  const refresh = useCallback(() => {
    setSearchVersion(v => v + 1);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(true);
      const query = new URLSearchParams(params);
      query.set('page', String(page));
      query.set('pageSize', String(pageSize));

      fetch(`${endpoint}?${query}`)
        .then(r => r.json())
        .then(json => {
          setData(json.data || []);
          setTotal(json.total || 0);
        })
        .catch(() => {
          setData([]);
          setTotal(0);
        })
        .finally(() => setLoading(false));
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [endpoint, page, pageSize, params, searchVersion, debounceMs]);

  return { data, loading, total, page, setPage, params, setParam, refresh };
}
