import type { VortekRole } from './permissions';

export type AppNavigationIcon =
  | 'dashboard'
  | 'tv'
  | 'offers'
  | 'products'
  | 'stock'
  | 'customers'
  | 'suppliers'
  | 'supplierCredits'
  | 'orders'
  | 'purchases'
  | 'invoice'
  | 'listings'
  | 'catalog'
  | 'questions'
  | 'reputation'
  | 'claims'
  | 'settings';

export interface AppNavigationItem {
  type: 'item';
  key: string;
  href: string;
  label: string;
  icon: AppNavigationIcon;
  adminOnly?: boolean;
  aliases?: string[];
  matchPrefixes?: string[];
}

export interface AppNavigationGroup {
  type: 'group';
  key: string;
  label: string;
  icon: AppNavigationIcon;
  children: AppNavigationItem[];
}

export type AppNavigationEntry = AppNavigationItem | AppNavigationGroup;

export interface ResolvedNavigation {
  key: string;
  label: string;
  groupKey: string | null;
  groupLabel: string | null;
}

export const APP_NAVIGATION: AppNavigationEntry[] = [
  { type: 'item', key: '/dashboard', href: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
  { type: 'item', key: '/tv', href: '/tv', label: 'TV ao Vivo', icon: 'tv' },
  { type: 'item', key: '/produtos/ofertas', href: '/produtos/ofertas', label: 'Ofertas', icon: 'offers' },
  { type: 'item', key: '/produtos', href: '/produtos', label: 'Produtos', icon: 'products' },
  { type: 'item', key: '/estoque', href: '/estoque', label: 'Estoque', icon: 'stock' },
  { type: 'item', key: '/clientes', href: '/clientes', label: 'Clientes', icon: 'customers' },
  {
    type: 'group',
    key: 'fornecedores-group',
    label: 'Fornecedores',
    icon: 'suppliers',
    children: [
      {
        type: 'item',
        key: '/fornecedores/cadastros',
        href: '/fornecedores/cadastros',
        label: 'Cadastros',
        icon: 'customers',
        matchPrefixes: ['/fornecedores'],
      },
      {
        type: 'item',
        key: '/fornecedores/creditos',
        href: '/fornecedores/creditos',
        label: 'Créditos',
        icon: 'supplierCredits',
        adminOnly: true,
      },
    ],
  },
  {
    type: 'group',
    key: 'pedidos-group',
    label: 'Pedidos',
    icon: 'orders',
    children: [
      { type: 'item', key: '/pedidos', href: '/pedidos', label: 'Vendas', icon: 'products' },
      { type: 'item', key: '/compras', href: '/compras', label: 'Compras', icon: 'purchases' },
    ],
  },
  { type: 'item', key: '/notas-fiscais', href: '/notas-fiscais', label: 'Notas Fiscais', icon: 'invoice' },
  { type: 'item', key: '/anuncios', href: '/anuncios', label: 'Anúncios', icon: 'listings' },
  {
    type: 'group',
    key: 'catalogo-group',
    label: 'Catálogo',
    icon: 'catalog',
    children: [
      {
        type: 'item',
        key: '/catalogo/no-catalogo',
        href: '/catalogo/no-catalogo',
        label: 'No Catálogo',
        icon: 'catalog',
        aliases: ['/catalogo'],
      },
      {
        type: 'item',
        key: '/catalogo/elegiveis',
        href: '/catalogo/elegiveis',
        label: 'Elegíveis',
        icon: 'catalog',
      },
    ],
  },
  { type: 'item', key: '/perguntas', href: '/perguntas', label: 'Perguntas', icon: 'questions' },
  { type: 'item', key: '/reputacao', href: '/reputacao', label: 'Reputação', icon: 'reputation' },
  { type: 'item', key: '/reclamacoes', href: '/reclamacoes', label: 'Reclamações', icon: 'claims' },
  {
    type: 'item',
    key: '/configuracoes',
    href: '/configuracoes',
    label: 'Configurações',
    icon: 'settings',
    adminOnly: true,
  },
];

function isVisible(item: AppNavigationItem, role: VortekRole | null): boolean {
  return !item.adminOnly || role === 'admin';
}

export function navigationForRole(role: VortekRole | null): AppNavigationEntry[] {
  return APP_NAVIGATION.reduce<AppNavigationEntry[]>((visible, entry) => {
    if (entry.type === 'item') {
      if (isVisible(entry, role)) visible.push(entry);
      return visible;
    }

    const children = entry.children.filter((item) => isVisible(item, role));
    if (children.length > 0) visible.push({ ...entry, children });
    return visible;
  }, []);
}

function pathMatchScore(item: AppNavigationItem, pathname: string): number {
  if (pathname === item.key) return 3_000 + item.key.length;
  if (pathname.startsWith(`${item.key}/`)) return 2_000 + item.key.length;

  const alias = item.aliases?.find((candidate) => pathname === candidate);
  if (alias) return 3_000 + alias.length;

  const prefix = item.matchPrefixes?.find(
    (candidate) => pathname === candidate || pathname.startsWith(`${candidate}/`),
  );
  return prefix ? 1_000 + prefix.length : 0;
}

export function resolveNavigation(pathname: string): ResolvedNavigation | null {
  const matches: Array<ResolvedNavigation & { score: number }> = [];

  for (const entry of APP_NAVIGATION) {
    if (entry.type === 'item') {
      const score = pathMatchScore(entry, pathname);
      if (score > 0) {
        matches.push({
          key: entry.key,
          label: entry.label,
          groupKey: null,
          groupLabel: null,
          score,
        });
      }
      continue;
    }

    for (const item of entry.children) {
      const score = pathMatchScore(item, pathname);
      if (score === 0) continue;
      matches.push({
        key: item.key,
        label: item.label,
        groupKey: entry.key,
        groupLabel: entry.label,
        score,
      });
    }
  }

  const resolved = matches.sort((a, b) => b.score - a.score)[0];
  if (!resolved) return null;

  return {
    key: resolved.key,
    label: resolved.label,
    groupKey: resolved.groupKey,
    groupLabel: resolved.groupLabel,
  };
}
