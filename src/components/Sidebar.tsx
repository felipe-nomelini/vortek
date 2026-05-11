'use client';

import { useState, useEffect } from 'react';
import { Layout, Menu, Avatar, Typography } from 'antd';
import Image from 'next/image';
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
} from '@ant-design/icons';
import { usePathname, useRouter } from 'next/navigation';

const { Sider } = Layout;
const { Text } = Typography;

const menuItems = [
  { key: '/dashboard', icon: <DashboardOutlined />, label: 'Dashboard' },
  { key: '/produtos', icon: <ShoppingCartOutlined />, label: 'Produtos' },
  { key: '/clientes', icon: <TeamOutlined />, label: 'Clientes' },
  { key: '/fornecedores', icon: <TruckOutlined />, label: 'Fornecedores' },
  { key: '/pedidos', icon: <OrderedListOutlined />, label: 'Pedidos' },
  { key: '/notas-fiscais', icon: <FileTextOutlined />, label: 'Notas Fiscais' },
  { key: '/anuncios', icon: <ShopOutlined />, label: 'Anúncios' },
  { key: '/catalogo', icon: <AppstoreOutlined />, label: 'Catálogo' },
  { key: '/perguntas', icon: <QuestionCircleOutlined />, label: 'Perguntas' },
  { key: '/reputacao', icon: <StarOutlined />, label: 'Reputação' },
  { key: '/reclamacoes', icon: <WarningOutlined />, label: 'Reclamações' },
  { key: '/configuracoes', icon: <SettingOutlined />, label: 'Configurações' },
];

interface Integracoes {
  ml: boolean;
  bling: boolean;
  dslite: boolean;
  brasilnfe: boolean;
}

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [profile, setProfile] = useState({ nome: 'Admin', avatar: '' });
  const [ints, setInts] = useState<Integracoes>({ ml: false, bling: false, dslite: false, brasilnfe: false });

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
        items={menuItems}
        onClick={({ key }) => router.push(key)}
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
            { key: 'bling', label: 'Bling', on: ints.bling },
            { key: 'dslite', label: 'DSLite', on: ints.dslite },
            { key: 'brasilnfe', label: 'Brasil NFe', on: ints.brasilnfe },
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
