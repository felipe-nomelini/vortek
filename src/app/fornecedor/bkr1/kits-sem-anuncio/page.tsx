import Link from "next/link";
import { createServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PAGE_SIZE = 100;
const SPECIAL_REQUIREMENTS: Record<string, string> = {
  VTK016250: "Número de peça do dispositivo",
};

type PageProps = {
  searchParams?: { pagina?: string };
};

type KitRow = { produto_id: string };
type ProdutoRow = { id: string; sku: string | null; nome: string | null; gtin: string | null; ml_item_id: string | null };
type PublicRow = { sku: string; nome: string; pendencia: string };

function getPage(value: string | undefined, totalPages: number) {
  const parsed = Number.parseInt(value || "1", 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(Math.max(parsed, 1), Math.max(totalPages, 1));
}

export default async function KitsSemAnuncioPublicPage({ searchParams }: PageProps) {
  const client = createServiceClient();
  const [{ data: kits, error: kitsError }, { data: produtos, error: produtosError }] =
    await Promise.all([
      (client as any).from("produto_kits").select("produto_id").eq("ativo", true),
      client
        .from("produtos")
        .select("id,sku,nome,gtin,ml_item_id")
        .eq("ativo", true)
        .eq("fornecedor", "BKR1")
        .is("ml_item_id", null)
        .order("sku", { ascending: true }),
    ] as any);

  if (kitsError || produtosError) {
    throw new Error(kitsError?.message || produtosError?.message || "Falha ao carregar lista");
  }

  const kitIds = new Set(((kits || []) as KitRow[]).map((kit) => String(kit.produto_id)));
  const rows: PublicRow[] = ((produtos || []) as ProdutoRow[])
    .filter((produto) => kitIds.has(String(produto.id)))
    .map((produto) => ({
      sku: String(produto.sku || ""),
      nome: String(produto.nome || ""),
      pendencia: SPECIAL_REQUIREMENTS[String(produto.sku || "")] || "GTIN do kit",
    }));
  const totalPages = Math.ceil(rows.length / PAGE_SIZE);
  const page = getPage(searchParams?.pagina, totalPages);
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const gtinCount = rows.filter((row) => row.pendencia === "GTIN do kit").length;

  return (
    <main style={{ maxWidth: 1180, margin: "0 auto", padding: "32px 20px 48px" }}>
      <header style={{ marginBottom: 24 }}>
        <p style={{ color: "#8c8c8c", margin: 0 }}>Vortek · BKR1</p>
        <h1 style={{ margin: "8px 0", fontSize: 28 }}>Kits pendentes de anúncio</h1>
        <p style={{ color: "#bfbfbf", margin: 0, lineHeight: 1.6 }}>
          Lista validada no Mercado Livre em 14/07/2026. Cada kit abaixo está sem anúncio porque falta o dado indicado.
        </p>
      </header>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <div style={cardStyle}><strong style={numberStyle}>{rows.length}</strong><span>Kits pendentes</span></div>
        <div style={cardStyle}><strong style={numberStyle}>{gtinCount}</strong><span>Precisam de GTIN do kit</span></div>
        <div style={cardStyle}><strong style={numberStyle}>{rows.length - gtinCount}</strong><span>Outra pendência</span></div>
      </section>

      <section style={{ background: "#141414", border: "1px solid #303030", borderRadius: 8, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 680 }}>
          <thead>
            <tr style={{ background: "#1f1f1f", textAlign: "left" }}>
              <th style={cellStyle}>SKU</th>
              <th style={cellStyle}>Produto</th>
              <th style={cellStyle}>Pendência para publicar</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => (
              <tr key={row.sku} style={{ borderTop: "1px solid #303030" }}>
                <td style={{ ...cellStyle, color: "#69b1ff", fontWeight: 600 }}>{row.sku}</td>
                <td style={cellStyle}>{row.nome}</td>
                <td style={cellStyle}>
                  <span style={{ color: "#ff7875" }}>{row.pendencia}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {totalPages > 1 && (
        <nav style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 12, marginTop: 20 }}>
          {page > 1 ? <Link href={`?pagina=${page - 1}`}>← Anterior</Link> : <span style={{ color: "#595959" }}>← Anterior</span>}
          <span style={{ color: "#bfbfbf" }}>Página {page} de {totalPages}</span>
          {page < totalPages ? <Link href={`?pagina=${page + 1}`}>Próxima →</Link> : <span style={{ color: "#595959" }}>Próxima →</span>}
        </nav>
      )}
    </main>
  );
}

const cardStyle = {
  background: "#141414",
  border: "1px solid #303030",
  borderRadius: 8,
  padding: 16,
  display: "flex",
  flexDirection: "column" as const,
  gap: 4,
  color: "#bfbfbf",
};

const numberStyle = { fontSize: 24, color: "#fff" };
const cellStyle = { padding: "14px 16px", verticalAlign: "top" };
