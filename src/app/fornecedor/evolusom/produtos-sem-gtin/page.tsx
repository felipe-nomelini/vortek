import type { Metadata } from "next";
import Link from "next/link";
import { createServiceClient } from "@/lib/supabase";
import {
  loadPublicEvolusomMissingGtinRows,
  type PublicEvolusomGtinRow,
} from "@/lib/public-evolusom-gtin";
import { verifyPublicEvolusomGtinToken } from "@/lib/public-evolusom-gtin-links";
import { EvolusomGtinTable } from "./EvolusomGtinTable";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = {
  title: "Produtos sem GTIN · Evolusom",
  robots: { index: false, follow: false },
};

const PAGE_SIZE = 100;

type PageProps = {
  searchParams?: Promise<{
    pagina?: string;
    token?: string;
    expires?: string;
  }>;
};

function getPage(value: string | undefined, totalPages: number) {
  const parsed = Number.parseInt(value || "1", 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(Math.max(parsed, 1), Math.max(totalPages, 1));
}

function buildPageHref(params: {
  page: number;
  token: string;
  expiresAt: string;
}) {
  const query = new URLSearchParams({
    pagina: String(params.page),
    expires: params.expiresAt,
    token: params.token,
  });
  return `?${query.toString()}`;
}

export default async function EvolusomMissingGtinPage(props: PageProps) {
  const searchParams = await props.searchParams;
  const token = searchParams?.token || "";
  const expiresAt = searchParams?.expires || "";
  const canAccess = verifyPublicEvolusomGtinToken(token, expiresAt);

  if (!canAccess) {
    return (
      <main style={mainStyle}>
        <section style={invalidLinkStyle}>
          <p style={{ color: "#8c8c8c", margin: 0 }}>Vortek · Evolusom</p>
          <h1 style={{ color: "#fff", margin: "8px 0" }}>
            Link inválido ou expirado
          </h1>
          <p style={{ color: "#bfbfbf", margin: 0 }}>
            Solicite à Vortek um novo link para cadastrar os códigos GTIN.
          </p>
        </section>
      </main>
    );
  }

  const client = createServiceClient();
  const rows = (await loadPublicEvolusomMissingGtinRows(
    client,
  )) as PublicEvolusomGtinRow[];
  const totalPages = Math.ceil(rows.length / PAGE_SIZE);
  const page = getPage(searchParams?.pagina, totalPages);
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <main style={mainStyle}>
      <header style={{ marginBottom: 24 }}>
        <p style={{ color: "#8c8c8c", margin: 0 }}>Vortek · Evolusom</p>
        <h1 style={{ margin: "8px 0", fontSize: 28, color: "#fff" }}>
          Produtos sem GTIN
        </h1>
        <p style={{ color: "#bfbfbf", margin: 0, lineHeight: 1.6 }}>
          Informe o código de barras presente na embalagem de cada produto.
          Não use SKU, código interno ou GTIN de produto diferente.
        </p>
      </header>

      <section style={summaryStyle}>
        <strong style={{ fontSize: 26, color: "#fff" }}>{rows.length}</strong>
        <span>Produtos aguardando GTIN</span>
      </section>

      <EvolusomGtinTable
        rows={pageRows}
        token={token}
        expiresAt={expiresAt}
      />

      {totalPages > 1 && (
        <nav style={paginationStyle}>
          {page > 1 ? (
            <Link
              href={buildPageHref({
                page: page - 1,
                token,
                expiresAt,
              })}
            >
              ← Anterior
            </Link>
          ) : (
            <span style={{ color: "#595959" }}>← Anterior</span>
          )}
          <span style={{ color: "#bfbfbf" }}>
            Página {page} de {totalPages}
          </span>
          {page < totalPages ? (
            <Link
              href={buildPageHref({
                page: page + 1,
                token,
                expiresAt,
              })}
            >
              Próxima →
            </Link>
          ) : (
            <span style={{ color: "#595959" }}>Próxima →</span>
          )}
        </nav>
      )}
    </main>
  );
}

const mainStyle = {
  maxWidth: 1240,
  margin: "0 auto",
  padding: "32px 20px 48px",
  color: "#f0f0f0",
};
const summaryStyle = {
  width: "fit-content",
  minWidth: 230,
  background: "#141414",
  border: "1px solid #303030",
  borderRadius: 8,
  padding: 16,
  display: "flex",
  flexDirection: "column" as const,
  gap: 4,
  color: "#bfbfbf",
  marginBottom: 20,
};
const paginationStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: 12,
  marginTop: 20,
};
const invalidLinkStyle = {
  maxWidth: 560,
  margin: "80px auto",
  padding: 24,
  background: "#141414",
  border: "1px solid #303030",
  borderRadius: 8,
};
