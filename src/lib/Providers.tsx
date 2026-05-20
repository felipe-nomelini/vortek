/**
 * Provider raiz do Ant Design.
 * Aplica tema dark, paleta de cores padrão e algoritmo CSS-in-JS.
 * Envolve toda a aplicação no root layout.
 */
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
          components: {
            Input: { controlHeight: 32 },
            InputNumber: { controlHeight: 32 },
            Select: { controlHeight: 32 },
          },
        }}
      >
        {children}
      </ConfigProvider>
    </StyleProvider>
  );
}
