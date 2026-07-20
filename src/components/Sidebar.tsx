/**
 * Sidebar de navegação principal do Vortek.
 * Exibe menus fixos + indicadores de status das integrações (ML, DSLite, Brasil NFe).
 * Lê o perfil do usuário e status das integrações do localStorage.
 */
'use client';

import { useState, useEffect } from 'react';
import { Layout, Menu, Avatar, Typography } from 'antd';
import type { MenuProps } from 'antd';
import Image from 'next/image';
import Link from 'next/link';
import {
  DashboardOutlined,
  ShoppingCartOutlined,
  OrderedListOutlined,
  SettingOutlined,
  UserOutlined,
  FileTextOutlined,
  ShopOutlined,
  AppstoreOutlined,
  QuestionCircleOutlined,
  StarOutlined,
  WarningOutlined,
  TeamOutlined,
  TruckOutlined,
  FundProjectionScreenOutlined,
} from '@ant-design/icons';
import { usePathname } from 'next/navigation';

const { Sider } = Layout;
const { Text } = Typography;

function menuLink(href: string, label: string) {
  return <Link href={href}>{label}</Link>;
}

const menuItems: MenuProps['items'] = [
  { key: '/dashboard', icon: <DashboardOutlined />, label: menuLink('/dashboard', 'Dashboard') },
  { key: '/tv', icon: <FundProjectionScreenOutlined />, label: menuLink('/tv', 'TV ao Vivo') },
  { key: '/produtos', icon: <ShoppingCartOutlined />, label: menuLink('/produtos', 'Produtos') },
  { key: '/estoque', icon: <AppstoreOutlined />, label: menuLink('/estoque', 'Estoque') },
  { key: '/clientes', icon: <TeamOutlined />, label: menuLink('/clientes', 'Clientes') },
  { key: '/fornecedores', icon: <TruckOutlined />, label: menuLink('/fornecedores', 'Fornecedores') },
  {
    key: 'pedidos-group',
    icon: <OrderedListOutlined />,
    label: 'Pedidos',
    children: [
      { key: '/pedidos', icon: <ShoppingCartOutlined />, label: menuLink('/pedidos', 'Vendas') },
      { key: '/compras', icon: <TruckOutlined />, label: menuLink('/compras', 'Compras') },
    ],
  },
  { key: '/notas-fiscais', icon: <FileTextOutlined />, label: menuLink('/notas-fiscais', 'Notas Fiscais') },
  { key: '/anuncios', icon: <ShopOutlined />, label: menuLink('/anuncios', 'Anúncios') },
  {
    key: 'catalogo-group',
    icon: <AppstoreOutlined />,
    label: 'Catálogo',
    children: [
      { key: '/catalogo/no-catalogo', icon: <AppstoreOutlined />, label: menuLink('/catalogo/no-catalogo', 'No Catálogo') },
      { key: '/catalogo/elegiveis', icon: <AppstoreOutlined />, label: menuLink('/catalogo/elegiveis', 'Elegíveis') },
    ],
  },
  { key: '/perguntas', icon: <QuestionCircleOutlined />, label: menuLink('/perguntas', 'Perguntas') },
  { key: '/reputacao', icon: <StarOutlined />, label: menuLink('/reputacao', 'Reputação') },
  { key: '/reclamacoes', icon: <WarningOutlined />, label: menuLink('/reclamacoes', 'Reclamações') },
  { key: '/configuracoes', icon: <SettingOutlined />, label: menuLink('/configuracoes', 'Configurações') },
];

interface Integracoes {
  ml: boolean;
  dslite: boolean;
}

export default function Sidebar() {
  const pathname = usePathname() || '';
  const [profile, setProfile] = useState({ nome: 'Admin', avatar: '' });
  const [ints, setInts] = useState<Integracoes>({ ml: false, dslite: false });

  useEffect(() => {
    const saved = localStorage.getItem('vortek_user_profile');
    if (saved) setProfile(JSON.parse(saved));
    const savedInts = localStorage.getItem('vortek_integrations');
    if (savedInts) setInts(JSON.parse(savedInts));
    const handler = () => {
      const p = localStorage.getItem('vortek_user_profile');
      if (p) setProfile(JSON.parse(p));
      const i = localStorage.getItem('vortek_integrations');
      if (i) setInts(JSON.parse(i));
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  return (
    <Sider
      width={240}
      style={{
        background: '#141414',
        borderRight: '1px solid #303030',
        height: '100vh',
        position: 'fixed',
        left: 0,
        top: 0,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          height: 64,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderBottom: '1px solid #303030',
          flexShrink: 0,
        }}
      >
        <Image src="/logo.png" alt="Vortek" width={190} height={51} style={{ objectFit: 'contain' }} />
      </div>
      <Menu
        theme="dark"
        mode="inline"
        selectedKeys={[pathname]}
        defaultOpenKeys={[
          ...(pathname.startsWith('/pedidos') || pathname.startsWith('/compras') ? ['pedidos-group'] : []),
          ...(pathname.startsWith('/catalogo') ? ['catalogo-group'] : []),
        ]}
        items={menuItems}
        style={{ background: 'transparent', borderRight: 0, marginTop: 8, flex: 1, overflowY: 'auto' }}
      />
      <div
        style={{
          borderTop: '1px solid #303030',
          padding: '12px 24px',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
          {[
            { key: 'ml', label: 'Mercado Livre', on: ints.ml },
            { key: 'dslite', label: 'DSLite', on: ints.dslite },
          ].map(i => (
            <div key={i.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: 4, background: i.on ? '#52c41a' : '#555' }} />
              <Text style={{ color: '#808080', fontSize: 11 }}>{i.label}</Text>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, borderTop: '1px solid #252525', paddingTop: 10 }}>
          <Avatar size={28} src={profile.avatar || undefined} icon={!profile.avatar ? <UserOutlined /> : undefined} style={{ backgroundColor: '#1677ff' }} />
          <Text style={{ color: '#c0c0c0', fontSize: 13 }}>{profile.nome}</Text>
        </div>
      </div>
    </Sider>
  );
}
