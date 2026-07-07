import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import {
  listarFornecedores,
  sincronizarCatalogo,
  type DsliteFornecedorStatus,
} from "@/services/dslite";
import type { Json } from "@/types/database";
import { acquireDomainLock, releaseDomainLock } from "@/lib/sync/domain-lock";

export const maxDuration = 300;

function asText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function extractFornecedorRecord(
  raw: DsliteFornecedorStatus,
): Record<string, unknown> {
  return raw as unknown as Record<string, unknown>;
}

function isDsliteStatusAtivo(value: unknown): boolean {
  return asText(value).toLowerCase() === "ativo";
}

async function syncCatalogoForFornecedores(
  origin: string,
  apiKey: string,
  fornecedorIds: string[],
) {
  if (fornecedorIds.length === 0) {
    return {
      attempted: 0,
      ok: true,
      status: 200,
      message: "Nenhum fornecedor novo para sincronizar catálogo",
    };
  }

  const response = await fetch(`${origin}/api/sync/catalogo`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({ fornecedorIds, pageSize: 200 }),
  });
  const payload = await response.json().catch(() => ({}));

  return {
    attempted: fornecedorIds.length,
    ok: response.ok && payload?.success !== false,
    status: response.status,
    message: String(
      payload?.message ||
        payload?.error ||
        payload?.erro ||
        "Sync de catálogo concluído",
    ),
    records: payload?.records,
    errors: payload?.errors,
  };
}

async function buscarMetadadosFornecedorCatalogo(
  fornecedorId: string,
): Promise<{ nome: string; cnpj: string }> {
  try {
    const response = await sincronizarCatalogo(fornecedorId, 1, 1);
    if (!response) return { nome: "", cnpj: "" };

    const responseAny = response as unknown as Record<string, unknown>;
    const fornecedorObj = (responseAny.fornecedor || {}) as Record<
      string,
      unknown
    >;
    const nome = asText(responseAny.nome || fornecedorObj.nome);
    const cnpj = asText(responseAny.cnpj || fornecedorObj.cnpj);
    return { nome, cnpj };
  } catch {
    return { nome: "", cnpj: "" };
  }
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const apiKey = request.headers.get("x-api-key") || "";
  if (!apiKey || apiKey !== process.env.API_SECRET_KEY) {
    return NextResponse.json({ error: "API key inválida" }, { status: 401 });
  }

  let lockOwnerToken = "";
  let lockAcquired = false;
  const errors: Array<{
    code: string;
    message: string;
    context?: Record<string, unknown>;
  }> = [];
  const domain = "fornecedores:dslite";

  try {
    const lock = await acquireDomainLock({
      domain,
      ownerTask: "sync_dslite_fornecedores",
      ttlSeconds: 20 * 60,
      metadata: { source: "api/sync/fornecedores" },
    });
    lockAcquired = lock.acquired;
    lockOwnerToken = lock.ownerToken;

    if (!lockAcquired) {
      return NextResponse.json(
        {
          success: false,
          domain,
          job: {
            key: "sync_dslite_fornecedores",
            started_at: new Date(startedAt).toISOString(),
            finished_at: new Date().toISOString(),
            lock_acquired: false,
          },
          cursor: null,
          records: { seen: 0, inserted: 0, updated: 0, deactivated: 0 },
          errors: [
            {
              code: "domain_lock_conflict",
              message: `Domínio ${domain} já está em execução`,
            },
          ],
          duration: { ms: Date.now() - startedAt },
        },
        { status: 409 },
      );
    }

    const client = createServiceClient();
    const nowIso = new Date().toISOString();

    const fornecedores = await listarFornecedores();
    if (!fornecedores || fornecedores.length === 0) {
      return NextResponse.json(
        {
          success: false,
          domain,
          job: {
            key: "sync_dslite_fornecedores",
            started_at: new Date(startedAt).toISOString(),
            finished_at: new Date().toISOString(),
            lock_acquired: true,
          },
          cursor: null,
          records: { seen: 0, inserted: 0, updated: 0, deactivated: 0 },
          errors: [
            {
              code: "dslite_fornecedores_empty",
              message: "Falha ao listar fornecedores na DSLite",
            },
          ],
          duration: { ms: Date.now() - startedAt },
        },
        { status: 502 },
      );
    }

    const baseMapped = fornecedores
      .map((raw) => {
        const record = extractFornecedorRecord(raw);
        const dsliteId = asText(
          raw.id || record.fornecedorid || record.id_fornecedor,
        );
        if (!dsliteId) return null;

        return {
          dslite_id: dsliteId,
          apelido: asText(
            raw.apelido || record.apelido_fantasia || record.nickname,
          ),
          status_dslite: asText(raw.status),
          crossdocking: asText(raw.crossdocking),
          dropshipping: asText(raw.dropshipping),
          nome: asText(raw.nome || record.razao_social || record.nome_fantasia),
          cnpj: asText(raw.cnpj || record.cpfcnpj || record.documento),
          endereco: asText(raw.endereco || record.logradouro),
          email: asText(raw.email),
          telefone: asText(raw.telefone || record.fone || record.celular),
          payload_dslite: record as unknown as Json,
          dslite_ultima_sync: nowIso,
          ativo: true,
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    if (baseMapped.length === 0) {
      return NextResponse.json(
        {
          success: false,
          domain,
          job: {
            key: "sync_dslite_fornecedores",
            started_at: new Date(startedAt).toISOString(),
            finished_at: new Date().toISOString(),
            lock_acquired: true,
          },
          cursor: null,
          records: { seen: 0, inserted: 0, updated: 0, deactivated: 0 },
          errors: [
            {
              code: "dslite_fornecedor_missing_identity",
              message: "DSLite retornou fornecedores sem identificação válida",
            },
          ],
          duration: { ms: Date.now() - startedAt },
        },
        { status: 502 },
      );
    }

    const enriquecimentos = await Promise.all(
      baseMapped.map(async (item) => {
        if (
          !isDsliteStatusAtivo(item.status_dslite) ||
          !isDsliteStatusAtivo(item.crossdocking)
        ) {
          return { dslite_id: item.dslite_id, nome: "", cnpj: "" };
        }
        return {
          dslite_id: item.dslite_id,
          ...(await buscarMetadadosFornecedorCatalogo(item.dslite_id)),
        };
      }),
    );
    const enrichMap = new Map(
      enriquecimentos.map((entry) => [entry.dslite_id, entry]),
    );

    const mapped = baseMapped.map((item) => {
      const enrich = enrichMap.get(item.dslite_id);
      const nomeRazaoSocial = asText(enrich?.nome) || asText(item.nome);
      const cnpjFinal = asText(enrich?.cnpj) || asText(item.cnpj);

      return {
        ...item,
        nome: nomeRazaoSocial,
        cnpj: cnpjFinal,
        payload_dslite: {
          ...(item.payload_dslite as Record<string, unknown>),
          _catalogo_enriquecimento: {
            nome: asText(enrich?.nome),
            cnpj: asText(enrich?.cnpj),
          },
        } as Json,
      };
    });

    const dsliteIds = mapped.map((item) => item.dslite_id);
    const { data: existingRows, error: existingError } = await client
      .from("fornecedores")
      .select("id, dslite_id, ativo, telefone, email, endereco")
      .in("dslite_id", dsliteIds);

    if (existingError) {
      throw new Error(
        `Falha ao consultar fornecedores existentes: ${existingError.message}`,
      );
    }

    const existingByDsliteId = new Map(
      (existingRows || [])
        .filter((row) => row.dslite_id)
        .map((row) => [String(row.dslite_id), row]),
    );
    const existingIds = new Set(existingByDsliteId.keys());
    const mappedPreservingManualStatus = mapped.map((row) => {
      const existing = existingByDsliteId.get(String(row.dslite_id));
      const existingTelefone = asText((existing as any)?.telefone);
      const existingEmail = asText((existing as any)?.email);
      const existingEndereco = asText((existing as any)?.endereco);
      return {
        ...row,
        ativo: existing ? existing.ativo !== false : true,
        telefone: asText(row.telefone) || existingTelefone,
        email: asText(row.email) || existingEmail,
        endereco: asText(row.endereco) || existingEndereco,
      };
    });
    const insertedSupplierIds = mapped
      .filter((row) => !existingIds.has(row.dslite_id))
      .map((row) => row.dslite_id);
    const inseridos = insertedSupplierIds.length;
    const atualizados = mapped.length - inseridos;

    const activeCrossdockingIds = mappedPreservingManualStatus
      .filter(
        (row) =>
          row.ativo !== false &&
          isDsliteStatusAtivo(row.status_dslite) &&
          isDsliteStatusAtivo(row.crossdocking),
      )
      .map((row) => row.dslite_id);

    const {
      data: existingProductSuppliers,
      error: existingProductSuppliersError,
    } =
      activeCrossdockingIds.length > 0
        ? await client
            .from("produtos")
            .select("dslite_fornecedor_id")
            .in("dslite_fornecedor_id", activeCrossdockingIds)
        : ({ data: [], error: null } as any);

    if (existingProductSuppliersError) {
      throw new Error(
        `Falha ao consultar produtos por fornecedor: ${existingProductSuppliersError.message}`,
      );
    }

    const { data: existingOfferSuppliers, error: existingOfferSuppliersError } =
      activeCrossdockingIds.length > 0
        ? await client
            .from("produto_fornecedor_ofertas")
            .select("dslite_fornecedor_id")
            .in("dslite_fornecedor_id", activeCrossdockingIds)
        : ({ data: [], error: null } as any);

    if (existingOfferSuppliersError) {
      throw new Error(
        `Falha ao consultar ofertas por fornecedor: ${existingOfferSuppliersError.message}`,
      );
    }

    const suppliersWithCatalogData = new Set([
      ...((existingProductSuppliers || []) as any[])
        .map((row) => String(row.dslite_fornecedor_id || "").trim())
        .filter(Boolean),
      ...((existingOfferSuppliers || []) as any[])
        .map((row) => String(row.dslite_fornecedor_id || "").trim())
        .filter(Boolean),
    ]);
    const activeWithoutCatalogDataIds = activeCrossdockingIds.filter(
      (id) => !suppliersWithCatalogData.has(id),
    );
    const fornecedorIdsParaSyncCatalogo = Array.from(
      new Set([...insertedSupplierIds, ...activeWithoutCatalogDataIds]),
    ).filter((id) => activeCrossdockingIds.includes(id));

    const { error: upsertError } = await client
      .from("fornecedores")
      .upsert(mappedPreservingManualStatus as any, { onConflict: "dslite_id" });

    if (upsertError) {
      throw new Error(
        `Falha no upsert dos fornecedores: ${upsertError.message}`,
      );
    }

    const { data: ativosNoBanco, error: ativosError } = await client
      .from("fornecedores")
      .select("id, dslite_id")
      .eq("ativo", true)
      .not("dslite_id", "is", null);

    if (ativosError) {
      throw new Error(
        `Falha ao listar fornecedores ativos: ${ativosError.message}`,
      );
    }

    const idsAtuais = new Set(dsliteIds);
    const idsParaInativar = (ativosNoBanco || [])
      .filter((row) => row.dslite_id && !idsAtuais.has(row.dslite_id))
      .map((row) => row.id);

    let inativados = 0;
    if (idsParaInativar.length > 0) {
      const { error: deactivateError } = await client
        .from("fornecedores")
        .update({ ativo: false } as any)
        .in("id", idsParaInativar);

      if (deactivateError) {
        throw new Error(
          `Falha ao inativar fornecedores antigos: ${deactivateError.message}`,
        );
      }
      inativados = idsParaInativar.length;
    }

    let autoCatalogSync: Awaited<
      ReturnType<typeof syncCatalogoForFornecedores>
    > | null = null;
    if (fornecedorIdsParaSyncCatalogo.length > 0) {
      autoCatalogSync = await syncCatalogoForFornecedores(
        new URL(request.url).origin,
        apiKey,
        fornecedorIdsParaSyncCatalogo,
      );
      if (!autoCatalogSync.ok) {
        errors.push({
          code: "auto_catalog_sync_failed",
          message: autoCatalogSync.message,
          context: {
            fornecedorIds: fornecedorIdsParaSyncCatalogo,
            status: autoCatalogSync.status,
            errors: autoCatalogSync.errors,
          },
        });
      }
    }

    return NextResponse.json({
      success: errors.length === 0,
      domain,
      job: {
        key: "sync_dslite_fornecedores",
        started_at: new Date(startedAt).toISOString(),
        finished_at: new Date().toISOString(),
        lock_acquired: true,
      },
      cursor: null,
      records: {
        seen: mapped.length,
        inserted: inseridos,
        updated: atualizados,
        deactivated: inativados,
        auto_catalog_suppliers: fornecedorIdsParaSyncCatalogo.length,
      },
      auto_catalog_sync: autoCatalogSync,
      errors,
      duration: { ms: Date.now() - startedAt },
      // Compatibilidade
      message:
        errors.length === 0
          ? "Fornecedores sincronizados com sucesso"
          : "Fornecedores sincronizados com alertas",
      total: mapped.length,
      inseridos,
      atualizados,
      inativados,
      auto_catalog_suppliers: fornecedorIdsParaSyncCatalogo.length,
      erros: fornecedores.length - mapped.length + errors.length,
    });
  } catch (err: any) {
    errors.push({
      code: "fornecedores_sync_unexpected_error",
      message: err?.message || "Erro inesperado no sync de fornecedores",
    });
    return NextResponse.json(
      {
        success: false,
        domain,
        job: {
          key: "sync_dslite_fornecedores",
          started_at: new Date(startedAt).toISOString(),
          finished_at: new Date().toISOString(),
          lock_acquired: lockAcquired,
        },
        cursor: null,
        records: { seen: 0, inserted: 0, updated: 0, deactivated: 0 },
        errors,
        duration: { ms: Date.now() - startedAt },
      },
      { status: 500 },
    );
  } finally {
    if (lockOwnerToken) {
      await releaseDomainLock({
        domain,
        ownerToken: lockOwnerToken,
      }).catch(() => null);
    }
  }
}
