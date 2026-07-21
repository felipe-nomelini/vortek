/**
 * Builds a Mercado Livre description exclusively from product data imported
 * from the supplier. It intentionally never invents specifications, contents
 * of packaging, compatibility, warranty, or measurements.
 */
function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function normalizeLine(value: unknown) {
  return decodeEntities(String(value ?? ""))
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** Converts supplier HTML while retaining its paragraph and list structure. */
export function supplierTextToDescription(value: unknown) {
  const text = decodeEntities(String(value ?? ""))
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/p\s*>/gi, "\n\n")
    .replace(/<\s*p[^>]*>/gi, "")
    .replace(/<\s*li[^>]*>/gi, "• ")
    .replace(/<\s*\/li\s*>/gi, "\n")
    .replace(/<\s*\/?(?:ul|ol)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "");

  return text
    .split("\n")
    .map(normalizeLine)
    .filter(Boolean)
    .filter((line, index, lines) => index === 0 || line !== lines[index - 1])
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function pushUnique(target: string[], value: unknown) {
  const line = normalizeLine(value);
  if (!line) return;
  const normalized = line.toLocaleLowerCase("pt-BR");
  if (!target.some((item) => item.toLocaleLowerCase("pt-BR") === normalized)) {
    target.push(line);
  }
}

export function buildEvidenceBasedMlDescription(produto: any, preferredText?: unknown) {
  const title = normalizeLine(produto?.nome);
  const supplied = supplierTextToDescription(preferredText);
  // Schema output can be sent back during creation. Keep it verbatim instead
  // of wrapping the same verified content a second time.
  if (supplied.includes("Informações confirmadas")) return supplied.slice(0, 5000);
  const supplierDescription = supplierTextToDescription(
    supplied || produto?.descricao || produto?.caracteristicas || produto?.informacoes,
  );
  const lines: string[] = [];

  if (title) lines.push(title);
  if (supplierDescription) lines.push(`\nDescrição do produto\n${supplierDescription}`);

  const confirmed: string[] = [];
  if (normalizeLine(produto?.marca)) pushUnique(confirmed, `Marca: ${normalizeLine(produto.marca)}`);
  if (normalizeLine(produto?.gtin)) pushUnique(confirmed, `GTIN: ${normalizeLine(produto.gtin)}`);
  if (Number(produto?.altura) > 0 && Number(produto?.largura) > 0 && Number(produto?.profundidade) > 0) {
    pushUnique(
      confirmed,
      `Dimensões da embalagem informadas: ${produto.altura} × ${produto.largura} × ${produto.profundidade} cm`,
    );
  }
  if (Number(produto?.peso_bruto) > 0) {
    pushUnique(confirmed, `Peso bruto informado: ${Number(produto.peso_bruto).toLocaleString("pt-BR", { maximumFractionDigits: 3 })} kg`);
  }
  if (confirmed.length) lines.push(`\nInformações confirmadas\n${confirmed.map((line) => `• ${line}`).join("\n")}`);

  // 5,000 is Mercado Livre's description limit used by the existing flow.
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 5000);
}
