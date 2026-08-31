/**
 * Provider raiz do Ant Design.
 * Aplica tema dark, paleta de cores padrão e algoritmo CSS-in-JS.
 * Envolve toda a aplicação no root layout.
 */
'use client';

import '@ant-design/v5-patch-for-react-19';
import { ConfigProvider, theme } from 'antd';
import { StyleProvider } from '@ant-design/cssinjs';
import { benteviColors } from '@/theme/bentevi';

const { darkAlgorithm } = theme;

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <StyleProvider>
      <ConfigProvider
        theme={{
          algorithm: darkAlgorithm,
          token: {
            colorBgBase: benteviColors.background,
            colorBgContainer: benteviColors.surface,
            colorBgElevated: benteviColors.surfaceElevated,
            colorBorder: benteviColors.border,
            colorPrimary: benteviColors.primary,
            colorText: benteviColors.text,
            colorTextSecondary: benteviColors.textSecondary,
            colorTextLightSolid: benteviColors.textOnPrimary,
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
