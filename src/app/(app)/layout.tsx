'use client';

import { Layout } from 'antd';
import Sidebar from '@/components/Sidebar';
import QuestionSoundListener from '@/components/QuestionSoundListener';
import { benteviColors } from '@/theme/bentevi';

const { Content } = Layout;

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Layout hasSider style={{ minHeight: '100vh', background: benteviColors.background }}>
      <QuestionSoundListener />
      <Sidebar />
      <Layout style={{ marginLeft: 240, background: benteviColors.background }}>
        <Content style={{ padding: 24 }}>
          {children}
        </Content>
      </Layout>
    </Layout>
  );
}
