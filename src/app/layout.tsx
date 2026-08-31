import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import Providers from '@/lib/Providers';
import { benteviColors } from '@/theme/bentevi';
import './globals.css';

const inter = Inter({ subsets: ['latin'], display: 'swap' });

export const metadata: Metadata = {
  title: 'Bentevi',
  description: 'Sistema de gestão operacional da Bentevi',
};

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: benteviColors.background,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className={inter.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
