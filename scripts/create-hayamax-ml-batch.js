const dotenv = require("dotenv");
dotenv.config({ path: ".env.local" });

const { createClient } = require("@supabase/supabase-js");

const BASE_URL = process.env.BATCH_API_URL || "http://localhost:3000";
const HAYAMAX_DSLITE_ID = "2";
const LIMIT = Number(process.env.BATCH_LIMIT || "10");
const OFFSET = Number(process.env.BATCH_OFFSET || "0");
const DELAY_MS = Number(process.env.BATCH_DELAY_MS || "1500");

const supabase = createClient(
  process.env.SUPABASE_SERVICE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasText(value) {
  return String(value || "").trim().length > 0;
}

function hasPositiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

function hasImage(product) {
  return Array.isArray(product.imagens) && product.imagens.some(hasText);
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function isBlockedMlBrand(product) {
  return /\bwahl\b/.test(
    normalizeText(`${product?.marca || ""} ${product?.nome || ""}`),
  );
}

function isLocalReady(row, linkedProductIds) {
  const product = row.product || {};
  const preferredOffer = row.preferredOffer || {};
  return (
    product.ativo !== false &&
    String(product.ml_status || "") === "sem_anuncio" &&
    !hasText(product.ml_item_id) &&
    !linkedProductIds.has(String(product.id)) &&
    String(preferredOffer.dslite_fornecedor_id || "") === HAYAMAX_DSLITE_ID &&
    hasText(product.sku) &&
    hasText(product.nome) &&
    hasPositiveNumber(product.custo) &&
    hasPositiveNumber(product.estoque) &&
    hasImage(product) &&
    !isBlockedMlBrand(product) &&
    hasText(product.descricao) &&
    hasText(product.gtin) &&
    hasText(product.ncm) &&
    hasText(product.marca) &&
    (hasPositiveNumber(product.peso_bruto) ||
      hasPositiveNumber(product.peso_liq)) &&
    hasPositiveNumber(product.altura) &&
    hasPositiveNumber(product.largura) &&
    hasPositiveNumber(product.profundidade)
  );
}

async function postJson(path, body) {
  const headers = {
    "Content-Type": "application/json",
    "x-local-dev-batch": "true",
  };
  if (process.env.API_SECRET_KEY)
    headers["x-api-key"] = process.env.API_SECRET_KEY;

  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    const message =
      data?.error ||
      data?.erro ||
      data?.message ||
      text ||
      `HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function loadCandidates() {
  const all = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.rpc("search_produtos_paginated", {
      p_search: null,
      p_supplier_dslite_ids: [HAYAMAX_DSLITE_ID],
      p_product_active_status: "ativo",
      p_ml_status: "sem_anuncio",
      p_estoque: "com_estoque",
      p_price_min: null,
      p_price_max: null,
      p_price_field: "cost",
      p_page: page,
      p_page_size: 100,
      p_sort_by: "sku",
      p_sort_order: "asc",
    });
    if (error) throw new Error(error.message);
    const rows = data?.data || [];
    all.push(...rows);
    if (all.length >= Number(data?.total || 0) || rows.length === 0) break;
  }

  const productIds = all.map((row) => row.product?.id).filter(Boolean);
  const linkedProductIds = new Set();
  for (let i = 0; i < productIds.length; i += 200) {
    const { data, error } = await supabase
      .from("anuncios_ml")
      .select("produto_id")
      .in("produto_id", productIds.slice(i, i + 200));
    if (error) throw new Error(error.message);
    for (const row of data || []) linkedProductIds.add(String(row.produto_id));
  }

  return all.filter((row) => isLocalReady(row, linkedProductIds));
}

function missingRequired(attrs) {
  return (attrs || []).filter(
    (attr) => !hasText(attr.value_id) && !hasText(attr.value_name),
  );
}

function categoryRejectReason(product, category, required) {
  const text = normalizeText(
    `${product.nome || ""} ${product.categoria || ""}`,
  );
  const categoryText = normalizeText(
    `${category?.id || ""} ${category?.nome || ""} ${category?.dominio || ""}`,
  );
  const requiredIds = new Set(
    (required || []).map((attr) => String(attr.id || "").toUpperCase()),
  );

  const isElectricWire =
    text.includes("fio paralelo") ||
    /materiais eletricos.*cabos e fios.*fios/.test(text);
  if (isElectricWire) {
    const isGoodElectricCable =
      String(category?.id || "") === "MLB455454" ||
      categoryText.includes("cabos eletricos");
    if (!isGoodElectricCable) {
      return "fio elétrico Hayamax exige categoria Cabos Elétricos (MLB455454)";
    }
  }

  if (
    text.includes("fio paralelo") &&
    (categoryText.includes("adaptador") ||
      requiredIds.has("CABLE_AND_ADAPTER_TYPE"))
  ) {
    return "fio paralelo não deve cair em Cabos e Adaptadores";
  }
  if (text.includes("lubrificante") && categoryText.includes("pc")) {
    return "lubrificante não deve cair em categoria de PC";
  }
  if (
    text.includes("fio") &&
    /microcontrolador|microcontroller/.test(categoryText)
  ) {
    return "fio/cabo não deve cair em Microcontroladores";
  }
  return "";
}

async function prepareCategory(product, category) {
  const produtoId = product.id;
  const schemaData = await postJson("/api/ml/anuncio/schema", {
    produtoId,
    categoriaId: category.id,
    listingType: "gold_pro",
  });
  const schema = schemaData?.schema;
  if (!schema) throw new Error("Schema ML ausente");

  const smartData = await postJson("/api/ml/anuncio/preencher-inteligente", {
    produtoId,
    categoriaId: category.id,
    required_attributes: schema.required_attributes || [],
    optional_attributes: schema.optional_attributes || [],
    description: schema.prefill?.description || product.descricao || "",
  });
  if (!smartData?.success)
    throw new Error(smartData?.error || "Preenchimento inteligente falhou");

  const required =
    smartData.required_attributes || schema.required_attributes || [];
  const optional =
    smartData.optional_attributes || schema.optional_attributes || [];
  const missing = missingRequired(required);
  return { category, schema, smartData, required, optional, missing };
}

async function createOne(row) {
  const product = row.product;
  const produtoId = product.id;

  const categoriesData = await postJson("/api/ml/anuncio/categorias", {
    produtoId,
  });
  const categories = (categoriesData?.categorias || [])
    .filter((category) => category?.id)
    .slice(0, 8);
  if (categories.length === 0) throw new Error("Sem categoria ML prevista");

  const attempts = [];
  let prepared = null;
  for (const candidate of categories) {
    try {
      const current = await prepareCategory(product, candidate);
      const rejectReason = categoryRejectReason(
        product,
        candidate,
        current.required,
      );
      attempts.push({
        category: candidate,
        missing: current.missing.map((attr) => attr.name || attr.id),
        rejectReason: rejectReason || null,
      });
      if (!rejectReason && current.missing.length === 0) {
        prepared = current;
        break;
      }
    } catch (error) {
      attempts.push({ category: candidate, error: error.message });
    }
  }

  if (!prepared) {
    const first =
      attempts.find((attempt) => attempt.missing?.length) || attempts[0];
    const error = new Error(
      first?.missing?.length
        ? `Atributos obrigatórios pendentes: ${first.missing.join(", ")}`
        : first?.error || "Nenhuma categoria ML válida encontrada",
    );
    error.attempts = attempts;
    throw error;
  }

  const { category, schema, smartData, required, optional } = prepared;

  const created = await postJson("/api/ml/anuncio/criar", {
    produtoId,
    categoriaId: category.id,
    listingType: "gold_pro",
    basePrice: schema.prefill?.base_price,
    fiscal: schema.fiscal_fields,
    description:
      smartData.description ||
      schema.prefill?.description ||
      product.descricao ||
      "",
    attributes: [...required, ...optional].map((attr) => ({
      id: attr.id,
      value_id: attr.value_id || "",
      value_name: attr.value_name || "",
    })),
    sale_terms: (schema.sale_terms || []).map((term) => ({
      id: term.id,
      value_id: term.value_id || "",
      value_name: term.value_name || "",
    })),
  });

  if (!created?.success) {
    const message =
      created?.error ||
      (created?.missing_required_attributes?.length
        ? `Atributos obrigatórios pendentes: ${created.missing_required_attributes.map((attr) => attr.name || attr.id).join(", ")}`
        : "Criação retornou sem sucesso");
    const error = new Error(message);
    error.data = created;
    throw error;
  }

  return {
    sku: product.sku,
    produtoId,
    category: {
      id: category.id,
      nome: category.nome,
      dominio: category.dominio,
    },
    anuncio: created.anuncio,
    linked_existing: Boolean(created.linked_existing),
    warnings: created.warnings || [],
  };
}

(async () => {
  const candidates = await loadCandidates();
  const selected = candidates.slice(OFFSET, OFFSET + LIMIT);
  const result = {
    baseUrl: BASE_URL,
    totalCandidates: candidates.length,
    offset: OFFSET,
    limit: LIMIT,
    selected: selected.length,
    created: [],
    failed: [],
  };

  for (const row of selected) {
    const product = row.product;
    try {
      console.log(`[create] ${product.sku} ${product.nome}`);
      const created = await createOne(row);
      result.created.push(created);
      console.log(`[ok] ${product.sku} ${created.anuncio?.id || ""}`);
    } catch (error) {
      result.failed.push({
        sku: product.sku,
        produtoId: product.id,
        nome: product.nome,
        error: error.message,
        status: error.status || null,
        missing:
          error.missing || error.data?.missing_required_attributes || null,
        attempts: error.attempts || null,
      });
      console.log(`[fail] ${product.sku} ${error.message}`);
    }
    await sleep(DELAY_MS);
  }

  console.log(JSON.stringify(result, null, 2));

  if (result.failed.length > Math.max(3, Math.ceil(selected.length * 0.5))) {
    process.exitCode = 2;
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
