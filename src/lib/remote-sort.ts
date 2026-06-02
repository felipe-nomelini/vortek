import type { SortOrder } from 'antd/es/table/interface';
import type { SorterResult } from 'antd/es/table/interface';

export type RemoteSortOrder = 'asc' | 'desc';

export interface RemoteSortState {
  sortBy: string;
  sortOrder: RemoteSortOrder;
}

export function appendRemoteSortParams(params: URLSearchParams, sort: RemoteSortState) {
  if (!sort.sortBy) return;
  params.set('sortBy', sort.sortBy);
  params.set('sortOrder', sort.sortOrder);
}

export function getRemoteSortOrder(columnKey: string, sort: RemoteSortState): SortOrder | undefined {
  if (sort.sortBy !== columnKey) return undefined;
  return sort.sortOrder === 'asc' ? 'ascend' : 'descend';
}

export function resolveRemoteSortState<T>(
  sorter: SorterResult<T> | SorterResult<T>[],
  fallback: RemoteSortState,
): RemoteSortState {
  const normalized = Array.isArray(sorter) ? sorter[0] : sorter;
  const columnKey = normalized?.columnKey;
  const order = normalized?.order;

  if (!columnKey || !order) {
    return fallback;
  }

  return {
    sortBy: String(columnKey),
    sortOrder: order === 'ascend' ? 'asc' : 'desc',
  };
}
