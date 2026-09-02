'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Alert,
  Button,
  Empty,
  Input,
  Select,
  Spin,
  Typography,
} from 'antd';
import type { TableProps } from 'antd';
import {
  MailOutlined,
  PhoneOutlined,
  ReloadOutlined,
  RightOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import ResizableTable from '@/components/ResizableTable';
import {
  appendRemoteSortParams,
  getRemoteSortOrder,
  resolveRemoteSortState,
  type RemoteSortState,
} from '@/lib/remote-sort';
import type { ClienteListItem, ClientesListResponse, ClientesSummary } from '@/types/clientes';
import styles from './clientes.module.css';

const { Text, Title } = Typography;

const EMPTY_SUMMARY: ClientesSummary = { total: 0, pf: 0, pj: 0 };

const typeOptions = [
  { value: 'all', label: 'Todos os tipos' },
  { value: 'F', label: 'Pessoa física' },
  { value: 'J', label: 'Pessoa jurídica' },
];

function formatDocument(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 11) {
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }
  if (digits.length === 14) {
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  }
  return value.trim() || 'Não informado';
}

function personTypeLabel(value: string): string {
  if (value === 'F') return 'Pessoa física';
  if (value === 'J') return 'Pessoa jurídica';
  return 'Não informado';
}

function updatedAtLabel(value: Date | null): string {
  if (!value) return 'Aguardando primeira atualização';
  return `Atualizado às ${value.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

export default function ClientesPage() {
  const [clients, setClients] = useState<ClienteListItem[]>([]);
  const [summary, setSummary] = useState<ClientesSummary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<RemoteSortState>({ sortBy: 'name', sortOrder: 'asc' });
  const [search, setSearch] = useState('');
  const [committedSearch, setCommittedSearch] = useState('');
  const [personType, setPersonType] = useState('');
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const requestSequence = useRef(0);

  const fetchClients = useCallback(async () => {
    const requestId = ++requestSequence.current;
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '100' });
      appendRemoteSortParams(params, sort);
      if (committedSearch) params.set('search', committedSearch);
      if (personType) params.set('tipo', personType);

      const response = await fetch(`/api/clientes?${params.toString()}`, { cache: 'no-store' });
      const payload = await response.json() as Partial<ClientesListResponse> & { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Não foi possível carregar os clientes');
      if (!Array.isArray(payload.data) || !payload.summary) {
        throw new Error('A consulta de clientes retornou um formato inválido');
      }

      if (requestId !== requestSequence.current) return;
      setClients(payload.data);
      setTotal(Number(payload.total || 0));
      setSummary({
        total: Number(payload.summary.total || 0),
        pf: Number(payload.summary.pf || 0),
        pj: Number(payload.summary.pj || 0),
      });
      setUpdatedAt(new Date());
    } catch (cause) {
      if (requestId !== requestSequence.current) return;
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os clientes');
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [committedSearch, page, personType, sort]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (search !== committedSearch) {
        setPage(1);
        setCommittedSearch(search.trim());
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [committedSearch, search]);

  useEffect(() => {
    void fetchClients();
  }, [fetchClients]);

  const selectPersonType = (value: string) => {
    setPersonType(value === 'all' ? '' : value);
    setPage(1);
  };

  const columns: TableProps<ClienteListItem>['columns'] = [
    {
      title: 'Cliente',
      key: 'name',
      width: 320,
      sorter: true,
      sortOrder: getRemoteSortOrder('name', sort),
      render: (_, client) => (
        <div className={styles.clientCell}>
          <Link href={`/clientes/${client.id}`}>{client.name}</Link>
          <span>
            {client.mlNickname ? `@${client.mlNickname}` : 'Nickname não informado'}
            {client.mlId ? ` · ML ${client.mlId}` : ' · ID ML não informado'}
          </span>
        </div>
      ),
    },
    {
      title: 'Tipo',
      dataIndex: 'personType',
      key: 'person_type',
      width: 105,
      sorter: true,
      sortOrder: getRemoteSortOrder('person_type', sort),
      render: (value: string) => <span className={styles.personType}>{personTypeLabel(value)}</span>,
    },
    {
      title: 'Documento',
      dataIndex: 'document',
      key: 'document',
      width: 150,
      sorter: true,
      sortOrder: getRemoteSortOrder('document', sort),
      render: (value: string) => <span className={styles.document}>{formatDocument(value)}</span>,
    },
    {
      title: 'Localização',
      key: 'location',
      width: 300,
      sorter: true,
      sortOrder: getRemoteSortOrder('location', sort),
      render: (_, client) => {
        const structuredLocation = [client.city, client.state].filter(Boolean).join(' - ');
        return (
          <div className={styles.locationCell}>
            <strong>{structuredLocation || 'Localização não estruturada'}</strong>
            <span>{structuredLocation ? client.address : client.address || 'Endereço não informado'}</span>
          </div>
        );
      },
    },
    {
      title: 'Contato',
      key: 'contact',
      width: 180,
      render: (_, client) => client.email || client.phone ? (
        <div className={styles.contactCell}>
          {client.email && <span><MailOutlined />{client.email}</span>}
          {client.phone && <span><PhoneOutlined />{client.phone}</span>}
        </div>
      ) : <span className={styles.missing}>Não informado</span>,
    },
    {
      title: 'Pedidos',
      dataIndex: 'orderCount',
      key: 'orders',
      width: 90,
      align: 'left',
      sorter: true,
      sortOrder: getRemoteSortOrder('orders', sort),
      render: (value: number, client) => client.mlId ? (
        <div className={styles.ordersCell}>
          <strong>{value.toLocaleString('pt-BR')}</strong>
          <span>{value === 1 ? 'pedido' : 'pedidos'}</span>
        </div>
      ) : <span className={styles.missing}>Não vinculado</span>,
    },
    {
      title: 'Ações',
      key: 'actions',
      width: 120,
      fixed: 'right',
      render: (_, client) => (
        <Link href={`/clientes/${client.id}`}>
          <Button size="small" icon={<RightOutlined />} iconPosition="end">Ver cliente</Button>
        </Link>
      ),
    },
  ];

  const handleTableChange: TableProps<ClienteListItem>['onChange'] = (pagination, _filters, sorter) => {
    const nextSort = resolveRemoteSortState(sorter, { sortBy: 'name', sortOrder: 'asc' });
    const sortChanged = nextSort.sortBy !== sort.sortBy || nextSort.sortOrder !== sort.sortOrder;
    setSort(nextSort);
    setPage(sortChanged ? 1 : (pagination.current || 1));
  };

  const activeType = personType || 'all';

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <Title level={2}>Clientes</Title>
          <Text>Compradores, identidade e relacionamento em uma única visão.</Text>
          <small>{updatedAtLabel(updatedAt)}</small>
        </div>
        <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void fetchClients()}>
          Atualizar
        </Button>
      </header>

      <section className={styles.summary} aria-label="Resumo de clientes">
        {[
          { key: 'all', label: 'Total de clientes', value: summary.total, hint: 'cadastros sincronizados' },
          { key: 'F', label: 'Pessoa física', value: summary.pf, hint: 'compradores CPF' },
          { key: 'J', label: 'Pessoa jurídica', value: summary.pj, hint: 'compradores CNPJ' },
        ].map((item) => (
          <button
            key={item.key}
            type="button"
            className={activeType === item.key ? styles.summaryActive : undefined}
            aria-pressed={activeType === item.key}
            onClick={() => selectPersonType(item.key)}
          >
            <span>{item.label}</span>
            <strong>{item.value.toLocaleString('pt-BR')}</strong>
            <small>{item.hint}</small>
          </button>
        ))}
      </section>

      <section className={styles.filterBar} aria-label="Filtros de clientes">
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="Buscar por nome, documento, ID ML, e-mail ou telefone"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onClear={() => {
            setSearch('');
            setCommittedSearch('');
            setPage(1);
          }}
        />
        <Select
          value={activeType}
          options={typeOptions}
          onChange={selectPersonType}
          aria-label="Filtrar por tipo de pessoa"
        />
        {(committedSearch || personType) && (
          <Button onClick={() => {
            setSearch('');
            setCommittedSearch('');
            setPersonType('');
            setPage(1);
          }}>
            Limpar filtros
          </Button>
        )}
      </section>

      {error && (
        <Alert
          type="error"
          showIcon
          message="Não foi possível carregar os clientes"
          description={error}
          action={<Button size="small" onClick={() => void fetchClients()}>Tentar novamente</Button>}
        />
      )}

      <section className={styles.tableCard}>
        <Spin spinning={loading}>
          <ResizableTable<ClienteListItem>
            storageKey="clientes-bentevi-v2"
            rowKey="id"
            dataSource={clients}
            columns={columns}
            pagination={{
              current: page,
              pageSize: 100,
              total,
              showSizeChanger: false,
              showTotal: (value) => `${value.toLocaleString('pt-BR')} cliente${value === 1 ? '' : 's'}`,
            }}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={committedSearch || personType
                    ? 'Nenhum cliente corresponde aos filtros'
                    : 'Nenhum cliente cadastrado'}
                />
              ),
            }}
            onChange={handleTableChange}
            scroll={{ x: 1260 }}
            size="middle"
          />
        </Spin>
      </section>
    </div>
  );
}
