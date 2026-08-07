export const MOBILE_PERMISSIONS = [
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

export type MobilePermission = (typeof MOBILE_PERMISSIONS)[number];
export type MobilePermissionRole =
  | "admin"
  | "gerente"
  | "operador"
  | "visualizador";

const READ_ONLY_PERMISSIONS: MobilePermission[] = [
  "tv.read",
  "sales.read",
  "purchases.read",
  "sales.track",
];

const OPERATIONAL_PERMISSIONS: MobilePermission[] = [
  ...READ_ONLY_PERMISSIONS,
  "sales.whatsapp_label.send",
  "sales.dslite.resume",
  "sales.dslite.create",
  "sales.dslite.label.complete",
  "sales.dslite.shipping.select",
  "sales.internal_shipping.process",
];

const ROLE_PERMISSIONS: Record<MobilePermissionRole, MobilePermission[]> = {
  admin: [...MOBILE_PERMISSIONS],
  gerente: [...MOBILE_PERMISSIONS],
  operador: OPERATIONAL_PERMISSIONS,
  visualizador: READ_ONLY_PERMISSIONS,
};

export function mobilePermissionsForRole(
  role: MobilePermissionRole,
): MobilePermission[] {
  return [...ROLE_PERMISSIONS[role]];
}

export function hasMobilePermission(
  role: MobilePermissionRole,
  permission: MobilePermission,
): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
