'use client';

import { Layout } from 'antd';
import Sidebar from '@/components/Sidebar';

const { Content } = Layout;

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Layout hasSider style={{ minHeight: '100vh', background: '#000000' }}>
      <Sidebar />
      <Layout style={{ marginLeft: 240, background: '#000000' }}>
        <Content style={{ padding: 24 }}>
          {children}
        </Content>
      </Layout>
    </Layout>
  );
}
