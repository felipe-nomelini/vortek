import type { Database } from "@/types/database";

export const VORTEK_PERMISSIONS = [
  "tv.read",
  "sales.read",
  "purchases.read",
  "sales.track",
  "sales.whatsapp_label.send",
  "sales.dslite.resume",
  "sales.dslite.create",
  "sales.dslite.label.complete",
  "sales.dslite.shipping.select",
  "sales.internal_shipping.process",
  "sales.dslite.unlink",
  "purchases.payment.confirm",
] as const;

export type VortekPermission = (typeof VORTEK_PERMISSIONS)[number];
export type VortekRole = Database["public"]["Enums"]["user_role"];

const READ_ONLY_PERMISSIONS: VortekPermission[] = [
  "tv.read",
  "sales.read",
  "purchases.read",
  "sales.track",
];

const OPERATIONAL_PERMISSIONS: VortekPermission[] = [
  ...READ_ONLY_PERMISSIONS,
  "sales.whatsapp_label.send",
  "sales.dslite.resume",
  "sales.dslite.create",
  "sales.dslite.label.complete",
  "sales.dslite.shipping.select",
  "sales.internal_shipping.process",
];

const ROLE_PERMISSIONS: Record<VortekRole, VortekPermission[]> = {
  admin: [...VORTEK_PERMISSIONS],
  gerente: [...VORTEK_PERMISSIONS],
  operador: OPERATIONAL_PERMISSIONS,
  visualizador: READ_ONLY_PERMISSIONS,
};

export function permissionsForRole(role: VortekRole): VortekPermission[] {
  return [...ROLE_PERMISSIONS[role]];
}

export function hasPermission(
  role: VortekRole,
  permission: VortekPermission,
): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
