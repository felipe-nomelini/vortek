'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ApiOutlined,
  AppstoreOutlined,
  DashboardOutlined,
  DollarOutlined,
  FileTextOutlined,
  FundProjectionScreenOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  OrderedListOutlined,
  QuestionCircleOutlined,
  ReloadOutlined,
  SettingOutlined,
  ShopOutlined,
  ShoppingCartOutlined,
  StarOutlined,
  TagsOutlined,
  TeamOutlined,
  TruckOutlined,
  UserOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import {
  Avatar,
  Badge,
  Breadcrumb,
  Button,
  Dropdown,
  Flex,
  Layout,
  Menu,
  Popover,
  Skeleton,
  Space,
  Tooltip,
  Typography,
  message,
} from 'antd';
import type { MenuProps } from 'antd';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

import {
  navigationForRole,
  resolveNavigation,
  type AppNavigationEntry,
  type AppNavigationIcon,
} from '@/lib/app-navigation';
import type { VortekRole } from '@/lib/permissions';
import { benteviColors } from '@/theme/bentevi';
import styles from './AppShell.module.css';

const { Content, Header, Sider } = Layout;
const { Text } = Typography;

const EXPANDED_WIDTH = 240;
const COLLAPSED_WIDTH = 80;

const navigationIcons: Record<AppNavigationIcon, React.ReactNode> = {
  dashboard: <DashboardOutlined />,
  tv: <FundProjectionScreenOutlined />,
  offers: <TagsOutlined />,
  products: <ShoppingCartOutlined />,
  stock: <AppstoreOutlined />,
  customers: <TeamOutlined />,
  suppliers: <TruckOutlined />,
  supplierCredits: <DollarOutlined />,
  orders: <OrderedListOutlined />,
  purchases: <TruckOutlined />,
  invoice: <FileTextOutlined />,
  listings: <ShopOutlined />,
  catalog: <AppstoreOutlined />,
  questions: <QuestionCircleOutlined />,
  reputation: <StarOutlined />,
  claims: <WarningOutlined />,
  settings: <SettingOutlined />,
};

const roleLabels: Record<VortekRole, string> = {
  admin: 'Administrador',
  gerente: 'Gerente',
  operador: 'Operador',
  visualizador: 'Visualizador',
};

interface ShellProfile {
  id: string;
  email?: string;
  nome?: string;
  cargo: VortekRole;
  avatar_url?: string;
}

interface IntegrationStatus {
  label: string;
  status: string;
  on: boolean;
}

function isVortekRole(value: unknown): value is VortekRole {
  return ['admin', 'gerente', 'operador', 'visualizador'].includes(String(value));
}

function toMenuItems(entries: AppNavigationEntry[]): MenuProps['items'] {
  return entries.map((entry) => {
    if (entry.type === 'group') {
      return {
        key: entry.key,
        icon: navigationIcons[entry.icon],
        label: entry.label,
        children: entry.children.map((item) => ({
          key: item.key,
          icon: navigationIcons[item.icon],
          label: <Link href={item.href}>{item.label}</Link>,
        })),
      };
    }

    return {
      key: entry.key,
      icon: navigationIcons[entry.icon],
      label: <Link href={entry.href}>{entry.label}</Link>,
    };
  });
}

function integrationColor(integration: IntegrationStatus): string {
  if (/erro|expirando/i.test(integration.status)) return '#FAAD14';
  return integration.on ? '#52C41A' : '#6B6870';
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '';
  const router = useRouter();
  const [messageApi, messageContext] = message.useMessage();
  const [collapsed, setCollapsed] = useState(false);
  const [openKeys, setOpenKeys] = useState<string[]>([]);
  const [profile, setProfile] = useState<ShellProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [integrationsLoading, setIntegrationsLoading] = useState(true);
  const [integrationsUnavailable, setIntegrationsUnavailable] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const currentNavigation = useMemo(() => resolveNavigation(pathname), [pathname]);
  const menuItems = useMemo(
    () => toMenuItems(navigationForRole(profile?.cargo || null)),
    [profile?.cargo],
  );

  useEffect(() => {
    const controller = new AbortController();

    async function loadProfile() {
      try {
        const response = await fetch('/api/auth/me', {
          cache: 'no-store',
          signal: controller.signal,
        });

        if (response.status === 401) {
          router.replace('/login');
          return;
        }
        if (!response.ok) throw new Error('Falha ao carregar o perfil');

        const data = await response.json();
        setProfile({
          id: String(data.id || ''),
          email: typeof data.email === 'string' ? data.email : undefined,
          nome: typeof data.nome === 'string' ? data.nome : undefined,
          cargo: isVortekRole(data.cargo) ? data.cargo : 'operador',
          avatar_url: typeof data.avatar_url === 'string' ? data.avatar_url : undefined,
        });
      } catch (error) {
        if ((error as Error).name !== 'AbortError') setProfile(null);
      } finally {
        if (!controller.signal.aborted) setProfileLoading(false);
      }
    }

    void loadProfile();
    return () => controller.abort();
  }, [router]);

  const loadIntegrations = useCallback(async () => {
    setIntegrationsLoading(true);
    setIntegrationsUnavailable(false);
    try {
      const response = await fetch('/api/integracoes/status', { cache: 'no-store' });
      if (!response.ok) throw new Error('Falha ao carregar as integrações');
      const data = await response.json();
      const statuses = Array.isArray(data.integracoes)
        ? data.integracoes.filter(
            (item: unknown): item is IntegrationStatus =>
              Boolean(
                item &&
                  typeof item === 'object' &&
                  typeof (item as IntegrationStatus).label === 'string' &&
                  typeof (item as IntegrationStatus).status === 'string' &&
                  typeof (item as IntegrationStatus).on === 'boolean',
              ),
          )
        : [];
      setIntegrations(statuses);
    } catch {
      setIntegrations([]);
      setIntegrationsUnavailable(true);
    } finally {
      setIntegrationsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadIntegrations();
  }, [loadIntegrations]);

  useEffect(() => {
    if (!currentNavigation?.groupKey) return;
    setOpenKeys((current) =>
      current.includes(currentNavigation.groupKey as string)
        ? current
        : [...current, currentNavigation.groupKey as string],
    );
  }, [currentNavigation?.groupKey]);

  async function logout() {
    setLoggingOut(true);
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok) throw new Error('Falha ao encerrar a sessão');
      router.replace('/login');
      router.refresh();
    } catch {
      messageApi.error('Não foi possível sair. Tente novamente.');
      setLoggingOut(false);
    }
  }

  const connectedCount = integrations.filter((integration) => integration.on).length;
  const hasIntegrationWarning = integrations.some((integration) =>
    /erro|expirando/i.test(integration.status),
  );
  const integrationSummary = integrationsLoading
    ? 'Verificando'
    : integrationsUnavailable
      ? 'Indisponível'
      : hasIntegrationWarning
        ? 'Requer atenção'
        : `${connectedCount}/${integrations.length} conectadas`;
  const integrationSummaryColor = integrationsUnavailable
    ? '#FF4D4F'
    : hasIntegrationWarning
      ? '#FAAD14'
      : integrations.length > 0 && connectedCount === integrations.length
        ? '#52C41A'
        : '#8B8790';

  const integrationContent = (
    <div style={{ width: 260 }}>
      <Flex align="center" justify="space-between" style={{ marginBottom: 8 }}>
        <Text strong>Saúde das integrações</Text>
        <Tooltip title="Atualizar integrações">
          <Button
            aria-label="Atualizar integrações"
            icon={<ReloadOutlined />}
            loading={integrationsLoading}
            onClick={() => void loadIntegrations()}
            size="small"
            type="text"
          />
        </Tooltip>
      </Flex>
      {integrationsUnavailable ? (
        <Text type="danger">Não foi possível consultar as integrações.</Text>
      ) : integrationsLoading && integrations.length === 0 ? (
        <Skeleton active paragraph={{ rows: 3 }} title={false} />
      ) : (
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          {integrations.map((integration) => (
            <Flex align="center" gap={8} justify="space-between" key={integration.label}>
              <Space size={8}>
                <Badge color={integrationColor(integration)} />
                <Text>{integration.label}</Text>
              </Space>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {integration.status}
              </Text>
            </Flex>
          ))}
        </Space>
      )}
    </div>
  );

  const profileMenu: MenuProps = {
    items: [
      {
        key: 'identity',
        disabled: true,
        label: (
          <div style={{ maxWidth: 240 }}>
            <Text strong style={{ display: 'block' }}>
              {profile?.nome || profile?.email || 'Perfil indisponível'}
            </Text>
            {profile?.email ? (
              <Text ellipsis type="secondary" style={{ display: 'block', fontSize: 12 }}>
                {profile.email}
              </Text>
            ) : null}
            {profile ? (
              <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                {roleLabels[profile.cargo]}
              </Text>
            ) : null}
          </div>
        ),
      },
      { type: 'divider' },
      {
        key: 'logout',
        danger: true,
        icon: <LogoutOutlined />,
        label: loggingOut ? 'Saindo…' : 'Sair',
        disabled: loggingOut,
        onClick: () => void logout(),
      },
    ],
  };

  const breadcrumbItems = currentNavigation
    ? [
        { title: 'Bentevi' },
        ...(currentNavigation.groupLabel ? [{ title: currentNavigation.groupLabel }] : []),
        { title: currentNavigation.label },
      ]
    : [{ title: 'Bentevi' }];

  return (
    <Layout hasSider style={{ minHeight: '100vh', background: benteviColors.background }}>
      {messageContext}
      <Sider
        collapsed={collapsed}
        collapsedWidth={COLLAPSED_WIDTH}
        trigger={null}
        width={EXPANDED_WIDTH}
        style={{
          background: benteviColors.surface,
          borderRight: `1px solid ${benteviColors.border}`,
          bottom: 0,
          height: '100dvh',
          left: 0,
          overflow: 'hidden',
          position: 'fixed',
          top: 0,
          zIndex: 101,
        }}
      >
        <Flex
          align="center"
          justify="center"
          style={{
            borderBottom: `1px solid ${benteviColors.border}`,
            height: 64,
            paddingInline: collapsed ? 16 : 20,
          }}
        >
          <Image
            alt="Bentevi"
            height={collapsed ? 42 : 38}
            priority
            src={
              collapsed
                ? '/branding/bentevi/bentevi-mark.png'
                : '/branding/bentevi/bentevi-wordmark.png'
            }
            width={collapsed ? 42 : 182}
            style={{ height: collapsed ? 42 : 'auto', objectFit: 'contain', width: collapsed ? 42 : 182 }}
          />
        </Flex>

        <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100dvh - 64px)' }}>
          <Menu
            className={styles.navigation}
            inlineCollapsed={collapsed}
            items={menuItems}
            mode="inline"
            onOpenChange={setOpenKeys}
            openKeys={collapsed ? undefined : openKeys}
            selectedKeys={currentNavigation ? [currentNavigation.key] : []}
            style={{
              background: 'transparent',
              borderInlineEnd: 0,
              flex: 1,
              marginTop: 8,
              minHeight: 0,
              overflowY: 'auto',
            }}
            theme="dark"
          />

          <div
            style={{
              borderTop: `1px solid ${benteviColors.border}`,
              flexShrink: 0,
              padding: collapsed ? 12 : 12,
            }}
          >
            <Popover content={integrationContent} placement="rightBottom" trigger="click">
              <Button
                aria-label={`Integrações: ${integrationSummary}`}
                block
                type="text"
                style={{
                  alignItems: 'center',
                  display: 'flex',
                  height: 44,
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  paddingInline: collapsed ? 0 : 10,
                }}
              >
                <Badge color={integrationSummaryColor} dot offset={[-1, 2]}>
                  <ApiOutlined style={{ color: benteviColors.textSecondary, fontSize: 18 }} />
                </Badge>
                {!collapsed ? (
                  <div style={{ marginLeft: 12, minWidth: 0, textAlign: 'left' }}>
                    <Text style={{ display: 'block', fontSize: 12 }}>Integrações</Text>
                    <Text ellipsis type="secondary" style={{ display: 'block', fontSize: 11 }}>
                      {integrationSummary}
                    </Text>
                  </div>
                ) : null}
              </Button>
            </Popover>
          </div>
        </div>
      </Sider>

      <Layout
        style={{
          background: benteviColors.background,
          marginInlineStart: collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH,
          minWidth: 0,
        }}
      >
        <Header
          style={{
            alignItems: 'center',
            background: benteviColors.surface,
            borderBottom: `1px solid ${benteviColors.border}`,
            display: 'flex',
            height: 64,
            justifyContent: 'space-between',
            lineHeight: 'normal',
            paddingInline: 20,
            position: 'sticky',
            top: 0,
            zIndex: 100,
          }}
        >
          <Flex align="center" gap={12} style={{ minWidth: 0 }}>
            <Tooltip title={collapsed ? 'Expandir navegação' : 'Recolher navegação'}>
              <Button
                aria-label={collapsed ? 'Expandir navegação' : 'Recolher navegação'}
                icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                onClick={() => setCollapsed((value) => !value)}
                size="large"
                type="text"
              />
            </Tooltip>
            <Breadcrumb items={breadcrumbItems} />
          </Flex>

          <Dropdown menu={profileMenu} placement="bottomRight" trigger={['click']}>
            <Button
              aria-label="Abrir menu do usuário"
              loading={profileLoading}
              type="text"
              style={{ height: 48, paddingInline: 8 }}
            >
              {profileLoading ? (
                <Skeleton.Avatar active size="small" />
              ) : (
                <Space size={10}>
                  <Avatar
                    icon={!profile?.avatar_url ? <UserOutlined /> : undefined}
                    size={32}
                    src={profile?.avatar_url}
                    style={{
                      backgroundColor: benteviColors.primary,
                      color: benteviColors.textOnPrimary,
                    }}
                  />
                  <div style={{ maxWidth: 180, textAlign: 'left' }}>
                    <Text ellipsis style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>
                      {profile?.nome || profile?.email || 'Perfil indisponível'}
                    </Text>
                    {profile ? (
                      <Text type="secondary" style={{ display: 'block', fontSize: 11 }}>
                        {roleLabels[profile.cargo]}
                      </Text>
                    ) : null}
                  </div>
                </Space>
              )}
            </Button>
          </Dropdown>
        </Header>

        <Content style={{ minWidth: 0, padding: 24 }}>{children}</Content>
      </Layout>
    </Layout>
  );
}
