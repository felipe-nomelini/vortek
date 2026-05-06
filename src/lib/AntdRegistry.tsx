'use client';

import { StyleProvider } from '@ant-design/cssinjs';

export default function AntdRegistry({ children }: { children: React.ReactNode }) {
  return <StyleProvider>{children}</StyleProvider>;
}
