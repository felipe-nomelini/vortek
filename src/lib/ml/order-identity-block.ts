export type MlOrderIdentityItem = {
  ml_item_id?: unknown;
  seller_sku?: unknown;
};

export type MlIdentityBlock = {
  ml_item_id?: unknown;
  sku?: unknown;
};

export type MlOrderIdentityBlockMatch = {
  mlItemId: string | null;
  sellerSku: string | null;
  matchedBy: "ml_item_id" | "sku";
};

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

function normalizeSku(value: unknown): string {
  return normalizeText(value).toUpperCase();
}

export function findMlOrderIdentityBlockMatches(
  items: MlOrderIdentityItem[],
  blocks: MlIdentityBlock[],
): MlOrderIdentityBlockMatch[] {
  const blockedItemIds = new Set(
    blocks.map((block) => normalizeText(block.ml_item_id)).filter(Boolean),
  );
  const blockedSkus = new Set(
    blocks.map((block) => normalizeSku(block.sku)).filter(Boolean),
  );

  const matches: MlOrderIdentityBlockMatch[] = [];
  for (const item of items) {
    const mlItemId = normalizeText(item.ml_item_id);
    const sellerSku = normalizeSku(item.seller_sku);
    if (mlItemId && blockedItemIds.has(mlItemId)) {
      matches.push({
        mlItemId,
        sellerSku: sellerSku || null,
        matchedBy: "ml_item_id",
      });
      continue;
    }
    if (sellerSku && blockedSkus.has(sellerSku)) {
      matches.push({
        mlItemId: mlItemId || null,
        sellerSku,
        matchedBy: "sku",
      });
    }
  }
  return matches;
}
