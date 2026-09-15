export const CATALOG_IDENTITY_EXPORTS = [
  '01_catalog_identity_audit.csv',
  '02_conflicts_confirmed.csv',
  '03_pending_validation.csv',
  '04_ml_state_anomalies.csv',
  '05_corrected_relations.csv',
  '06_buy_box_economic_conflicts.csv',
  '07_buy_box_attackable_after_cleanup.csv',
  '08_execution_errors.csv',
  '09_before_after_summary.md',
  '10_rollback_manifest.json',
  '11_buy_box_premium_validated.csv',
] as const;

export type CatalogIdentityExportName = (typeof CATALOG_IDENTITY_EXPORTS)[number];
