'use client';

import { ArrowDownOutlined, ArrowUpOutlined } from '@ant-design/icons';
import { Button, Checkbox, Empty, Pagination, Select, Spin, Table } from 'antd';
import type { CheckboxProps, TablePaginationConfig, TableProps } from 'antd';
import type { ColumnType, ColumnsType, SorterResult, SortOrder } from 'antd/es/table/interface';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import styles from './ResponsiveTable.module.css';

type ResponsiveTableProps<T extends object> = TableProps<T>;
type TableKey = string | number;

interface FlatColumn<T extends object> extends ColumnType<T> {
  mobileKey: string;
  mobileTitle: ReactNode;
}

const ACTION_COLUMN_KEYS = new Set(['action', 'actions', 'acao', 'acoes', 'next_action']);

function columnKey<T extends object>(column: ColumnType<T>, index: number): string {
  if (column.key !== undefined && column.key !== null) return String(column.key);
  if (Array.isArray(column.dataIndex)) return column.dataIndex.map(String).join('.');
  if (column.dataIndex !== undefined && column.dataIndex !== null) return String(column.dataIndex);
  return `column-${index}`;
}

function columnTitle<T extends object>(column: ColumnType<T>): ReactNode {
  return typeof column.title === 'function' ? 'Campo' : (column.title ?? 'Campo');
}

function flattenColumns<T extends object>(columns: ColumnsType<T>): FlatColumn<T>[] {
  return columns.flatMap((column, index) => {
    if ('children' in column && column.children) return flattenColumns(column.children);
    const typed = column as ColumnType<T>;
    return [{ ...typed, mobileKey: columnKey(typed, index), mobileTitle: columnTitle(typed) }];
  }).filter((column) => !column.hidden);
}

function normalizeColumns<T extends object>(columns: ColumnsType<T>, hasSelection: boolean): ColumnsType<T> {
  const visible = columns.filter((column) => !column.hidden);
  const weighted = visible.map((column) => {
    const typed = column as ColumnType<T>;
    const key = columnKey(typed, 0).toLowerCase();
    const original = typeof typed.width === 'number' ? typed.width : 160;
    return { column, key, weight: ACTION_COLUMN_KEYS.has(key) ? Math.max(original, 180) : original };
  });
  const total = weighted.reduce((sum, item) => sum + item.weight, 0) || 1;
  const available = hasSelection ? 94 : 100;

  return weighted.map(({ column, key, weight }) => {
    const typed = column as ColumnType<T>;
    const actionColumn = ACTION_COLUMN_KEYS.has(key);
    return {
      ...column,
      className: [typed.className, actionColumn ? styles.desktopActionCell : ''].filter(Boolean).join(' '),
      fixed: undefined,
      width: `${(weight / total) * available}%`,
    };
  }) as ColumnsType<T>;
}

function valueAtPath<T extends object>(record: T, dataIndex: ColumnType<T>['dataIndex']): unknown {
  if (dataIndex === undefined || dataIndex === null) return undefined;
  const path = Array.isArray(dataIndex) ? dataIndex : [dataIndex];
  return path.reduce<unknown>((value, key) => {
    if (value === null || value === undefined || typeof value !== 'object') return undefined;
    const propertyKey = typeof key === 'number' ? key : String(key);
    return (value as Record<string | number, unknown>)[propertyKey];
  }, record);
}

function renderedChildren(value: ReactNode | { children?: ReactNode }): ReactNode {
  if (value && typeof value === 'object' && !Array.isArray(value) && 'children' in value && !('type' in value)) {
    return value.children;
  }
  return value as ReactNode;
}

function renderCell<T extends object>(column: FlatColumn<T>, record: T, index: number): ReactNode {
  const value = valueAtPath(record, column.dataIndex);
  if (column.render) return renderedChildren(column.render(value, record, index));
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  return '—';
}

function toTableKey(value: unknown, fallback: number): TableKey {
  return typeof value === 'string' || typeof value === 'number' ? value : String(value ?? fallback);
}

function recordKey<T extends object>(rowKey: TableProps<T>['rowKey'], record: T, index: number): TableKey {
  if (typeof rowKey === 'function') return toTableKey(rowKey(record), index);
  if (typeof rowKey === 'string') return toTableKey((record as Record<string, unknown>)[rowKey], index);
  return toTableKey((record as Record<string, unknown>).key, index);
}

function sortDirection(column: ColumnType<object> | undefined): SortOrder {
  return column?.sortOrder === 'ascend' || column?.sortOrder === 'descend' ? column.sortOrder : null;
}

export default function ResponsiveTable<T extends object>({
  columns = [],
  dataSource = [],
  pagination,
  rowKey,
  rowSelection,
  onChange,
  loading,
  className,
  scroll: _scroll,
  tableLayout: _tableLayout,
  ...tableProps
}: ResponsiveTableProps<T>) {
  const flatColumns = useMemo(() => flattenColumns(columns), [columns]);
  const desktopColumns = useMemo(() => normalizeColumns(columns, Boolean(rowSelection)), [columns, rowSelection]);
  const sortableColumns = useMemo(() => flatColumns.filter((column) => Boolean(column.sorter)), [flatColumns]);
  const controlledSortColumn = sortableColumns.find((column) => sortDirection(column as ColumnType<object>));
  const [mobileSortKey, setMobileSortKey] = useState(controlledSortColumn?.mobileKey);
  const [mobileSortOrder, setMobileSortOrder] = useState<SortOrder>(sortDirection(controlledSortColumn as ColumnType<object>) || 'ascend');
  const [internalSelectedKeys, setInternalSelectedKeys] = useState<TableKey[]>([]);

  useEffect(() => {
    if (!controlledSortColumn) return;
    setMobileSortKey(controlledSortColumn.mobileKey);
    setMobileSortOrder(sortDirection(controlledSortColumn as ColumnType<object>) || 'ascend');
  }, [controlledSortColumn]);

  const paginationConfig: TablePaginationConfig | undefined = pagination && typeof pagination === 'object' ? pagination : undefined;
  const currentPage = paginationConfig?.current ?? paginationConfig?.defaultCurrent ?? 1;
  const pageSize = paginationConfig?.pageSize ?? paginationConfig?.defaultPageSize ?? 10;
  const total = paginationConfig?.total ?? dataSource.length;
  const serverPaginated = paginationConfig?.total !== undefined && paginationConfig.total > dataSource.length;
  const mobileRows = pagination === false || serverPaginated
    ? dataSource
    : dataSource.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const selectedKeys = (rowSelection?.selectedRowKeys ?? internalSelectedKeys).map((key, index) => toTableKey(key, index));
  const selectedKeySet = new Set(selectedKeys);
  const selectableMobileRows = mobileRows.filter((record) => !rowSelection?.getCheckboxProps?.(record).disabled);
  const allVisibleSelected = selectableMobileRows.length > 0
    && selectableMobileRows.every((record, index) => selectedKeySet.has(recordKey(rowKey, record, index)));
  const someVisibleSelected = selectableMobileRows.some((record, index) => selectedKeySet.has(recordKey(rowKey, record, index)));

  const currentSorter = (): SorterResult<T> => {
    const column = sortableColumns.find((item) => item.mobileKey === mobileSortKey);
    return column ? {
      column,
      columnKey: column.mobileKey,
      field: column.dataIndex as SorterResult<T>['field'],
      order: mobileSortOrder,
    } : { order: null };
  };

  const notifyTableChange = (nextPagination: TablePaginationConfig, sorter: SorterResult<T>, action: 'paginate' | 'sort') => {
    onChange?.(nextPagination, {}, sorter, { currentDataSource: [...dataSource], action });
  };

  const applyMobileSort = (key: string | undefined, order: SortOrder = mobileSortOrder || 'ascend') => {
    setMobileSortKey(key);
    setMobileSortOrder(order);
    const column = sortableColumns.find((item) => item.mobileKey === key);
    const sorter: SorterResult<T> = column ? {
      column,
      columnKey: column.mobileKey,
      field: column.dataIndex as SorterResult<T>['field'],
      order,
    } : { order: null };
    notifyTableChange({ ...paginationConfig, current: 1, pageSize }, sorter, 'sort');
  };

  const updateSelection = (nextKeys: TableKey[]) => {
    setInternalSelectedKeys(nextKeys);
    const selectedRows = dataSource.filter((record, index) => nextKeys.includes(recordKey(rowKey, record, index)));
    rowSelection?.onChange?.(nextKeys, selectedRows, { type: 'single' });
  };

  const toggleRecord = (record: T, index: number, checked: boolean) => {
    const key = recordKey(rowKey, record, index);
    const nextKeys = checked ? [...new Set([...selectedKeys, key])] : selectedKeys.filter((item) => item !== key);
    updateSelection(nextKeys);
  };

  const toggleVisible = (checked: boolean) => {
    const visibleKeys = selectableMobileRows.map((record, index) => recordKey(rowKey, record, index));
    const nextKeys = checked
      ? [...new Set([...selectedKeys, ...visibleKeys])]
      : selectedKeys.filter((key) => !visibleKeys.includes(key));
    updateSelection(nextKeys);
  };

  const mobilePaginationChange = (page: number, nextPageSize: number) => {
    const nextPagination = { ...paginationConfig, current: page, pageSize: nextPageSize };
    paginationConfig?.onChange?.(page, nextPageSize);
    notifyTableChange(nextPagination, currentSorter(), 'paginate');
  };

  const configuredEmptyText = tableProps.locale?.emptyText;
  const emptyText = typeof configuredEmptyText === 'function'
    ? configuredEmptyText()
    : configuredEmptyText ?? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />;

  return (
    <div className={styles.root}>
      <div className={styles.desktopView}>
        <Table<T>
          {...tableProps}
          className={className}
          columns={desktopColumns}
          dataSource={dataSource}
          pagination={pagination}
          rowKey={rowKey}
          rowSelection={rowSelection}
          onChange={onChange}
          loading={loading}
          tableLayout="fixed"
        />
      </div>

      <div className={styles.mobileView}>
        {(sortableColumns.length > 0 || rowSelection) && (
          <div className={styles.mobileToolbar}>
            {rowSelection && (
              <Checkbox
                checked={allVisibleSelected}
                indeterminate={!allVisibleSelected && someVisibleSelected}
                onChange={(event) => toggleVisible(event.target.checked)}
              >
                Selecionar esta página
              </Checkbox>
            )}
            {sortableColumns.length > 0 && (
              <div className={styles.sortControls}>
                <Select
                  className={styles.sortSelect}
                  aria-label="Ordenar cartões por"
                  placeholder="Ordenar por"
                  allowClear
                  value={mobileSortKey}
                  options={sortableColumns.map((column) => ({
                    value: column.mobileKey,
                    label: column.mobileTitle,
                  }))}
                  onChange={(key) => applyMobileSort(key)}
                />
                <Button
                  aria-label={mobileSortOrder === 'descend' ? 'Ordem decrescente' : 'Ordem crescente'}
                  disabled={!mobileSortKey}
                  icon={mobileSortOrder === 'descend' ? <ArrowDownOutlined /> : <ArrowUpOutlined />}
                  onClick={() => applyMobileSort(mobileSortKey, mobileSortOrder === 'descend' ? 'ascend' : 'descend')}
                />
              </div>
            )}
          </div>
        )}

        <Spin spinning={Boolean(loading)}>
          {mobileRows.length === 0 ? (
            <div className={styles.empty}>{emptyText}</div>
          ) : (
            <div className={styles.cardList}>
              {mobileRows.map((record, index) => {
                const key = recordKey(rowKey, record, index);
                const checkboxProps: CheckboxProps = rowSelection?.getCheckboxProps?.(record) ?? {};
                return (
                  <article className={styles.card} key={key}>
                    {rowSelection && (
                      <div className={styles.cardSelection}>
                        <Checkbox
                          {...checkboxProps}
                          checked={selectedKeySet.has(key)}
                          onChange={(event) => toggleRecord(record, index, event.target.checked)}
                        >
                          Selecionar item
                        </Checkbox>
                      </div>
                    )}
                    {flatColumns.map((column) => {
                      const isAction = ACTION_COLUMN_KEYS.has(column.mobileKey.toLowerCase());
                      return (
                        <div className={`${styles.field} ${isAction ? styles.actionField : ''}`} key={column.mobileKey}>
                          <div className={styles.fieldLabel}>{column.mobileTitle}</div>
                          <div className={styles.fieldValue}>{renderCell(column, record, index)}</div>
                        </div>
                      );
                    })}
                  </article>
                );
              })}
            </div>
          )}
        </Spin>

        {pagination !== false && total > pageSize && (
          <div className={styles.pagination}>
            <Pagination
              {...paginationConfig}
              current={currentPage}
              pageSize={pageSize}
              total={total}
              responsive
              onChange={mobilePaginationChange}
            />
          </div>
        )}
      </div>
    </div>
  );
}
