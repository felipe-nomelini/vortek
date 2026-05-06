'use client';

import { ConfigProvider, theme } from 'antd';
import { StyleProvider } from '@ant-design/cssinjs';

const { darkAlgorithm } = theme;

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <StyleProvider>
      <ConfigProvider
        theme={{
          algorithm: darkAlgorithm,
          token: {
            colorBgBase: '#000000',
            colorBgContainer: '#141414',
            colorPrimary: '#1677ff',
            borderRadius: 8,
          },
        }}
      >
        {children}
      </ConfigProvider>
    </StyleProvider>
  );
}
