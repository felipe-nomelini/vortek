/**
 * Tabela com colunas redimensionáveis via arrasto lateral.
 * As larguras são salvas no localStorage (chave: `rt_widths_{storageKey}`).
 * Wrapper do Ant Design Table que adiciona componentes de resize nos headers.
 */
'use client';

import { Table } from 'antd';
import { Resizable } from 'react-resizable';
import type { ResizableProps } from 'react-resizable';
import type { TableProps } from 'antd';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';

interface ResizableTableProps<T> extends TableProps<T> {
  storageKey: string;
}

interface ColumnWidths {
  [key: string]: number;
}

function ResizableTitle(props: any) {
  const { onResize, onResizeStop, width, children, ...restProps } = props;

  if (!width) {
    return <th {...restProps}>{children}</th>;
  }

  return (
    <Resizable
      width={width}
      height={0}
      handle={
        <span
          className="rt-resizable-handle"
          onClick={e => e.stopPropagation()}
        />
      }
      onResize={onResize}
      onResizeStop={onResizeStop}
      draggableOpts={{ enableUserSelectHack: false }}
    >
      <th {...restProps} style={{ ...restProps.style, width, userSelect: 'none' }}>
        {children}
      </th>
    </Resizable>
  );
}

function loadWidths(key: string): ColumnWidths {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(`rt_widths_${key}`) || '{}');
  } catch { return {}; }
}

function saveWidths(key: string, widths: ColumnWidths) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(`rt_widths_${key}`, JSON.stringify(widths));
}

export default function ResizableTable<T extends object>({ storageKey, columns, pagination: paginationProp, ...restProps }: ResizableTableProps<T>) {
  const [widths, setWidths] = useState<ColumnWidths>({});
  const loaded = useRef(false);

  const pagination = paginationProp === undefined || paginationProp === false || paginationProp === null
    ? paginationProp
    : { ...paginationProp };

  useEffect(() => {
    if (!loaded.current) {
      setWidths(loadWidths(storageKey));
      loaded.current = true;
    }
  }, [storageKey]);

  const handleResize = useCallback((key: string) =>
    (e: React.SyntheticEvent, { size }: { size: { width: number } }) => {
      setWidths(prev => ({ ...prev, [key]: size.width }));
    }, []);

  const handleResizeStop = useCallback((key: string) =>
    (e: React.SyntheticEvent, { size }: { size: { width: number } }) => {
      const newWidths = { ...widths, [key]: size.width };
      setWidths(newWidths);
      saveWidths(storageKey, newWidths);
    }, [widths, storageKey]);

  if (!columns) return <Table<T> {...restProps} />;

  const processedColumns = columns.map(col => {
    const c = col as any;
    const key = c.key || c.dataIndex || '';
    const savedWidth = widths[key];

    if (!c.width && !savedWidth) return col;

    return {
      ...col,
      width: savedWidth || c.width,
      onHeaderCell: () => ({
        width: savedWidth || c.width,
        onResize: handleResize(key),
        onResizeStop: handleResizeStop(key),
      }),
    } as any;
  });

  const components = {
    header: {
      cell: ResizableTitle,
    },
  };

  return (
    <Table<T>
      components={components}
      columns={processedColumns}
      pagination={pagination}
      {...restProps}
    />
  );
}
