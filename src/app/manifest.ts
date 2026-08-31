import type { MetadataRoute } from 'next';

import { benteviColors } from '@/theme/bentevi';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Bentevi',
    short_name: 'Bentevi',
    description: 'Sistema de gestão operacional da Bentevi',
    start_url: '/',
    display: 'standalone',
    background_color: benteviColors.background,
    theme_color: benteviColors.background,
    icons: [
      {
        src: '/branding/bentevi/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/branding/bentevi/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
  };
}
