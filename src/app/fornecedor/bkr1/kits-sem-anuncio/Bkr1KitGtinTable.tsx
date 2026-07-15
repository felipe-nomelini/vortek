"use client";

import { useState } from "react";

type Row = { sku: string; nome: string; pendencia: string };

export function Bkr1KitGtinTable({ rows, token, expiresAt }: { rows: Row[]; token: string | null; expiresAt: string | null }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [savingSku, setSavingSku] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, { text: string; error: boolean }>>({});
  const canEdit = Boolean(token && expiresAt);

  async function saveGtin(sku: string) {
    const gtin = values[sku] || "";
    setSavingSku(sku);
    setMessages((current) => ({ ...current, [sku]: { text: "Salvando...", error: false } }));
    try {
      const response = await fetch("/api/public/fornecedor/bkr1/kits/gtin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku, gtin, token, expiresAt }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Falha ao salvar GTIN");
      setMessages((current) => ({ ...current, [sku]: { text: "GTIN salvo. Obrigado!", error: false } }));
    } catch (error: any) {
      setMessages((current) => ({ ...current, [sku]: { text: error?.message || "Falha ao salvar GTIN", error: true } }));
    } finally {
      setSavingSku(null);
    }
  }

  return (
    <section style={{ background: "#141414", border: "1px solid #303030", borderRadius: 8, overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: canEdit ? 920 : 680, color: "#f0f0f0" }}>
        <thead><tr style={{ background: "#1f1f1f", textAlign: "left" }}><th style={cellStyle}>SKU</th><th style={cellStyle}>Produto</th><th style={cellStyle}>Pendência para publicar</th>{canEdit && <th style={cellStyle}>GTIN do kit</th>}</tr></thead>
        <tbody>
          {rows.map((row) => {
            const gtinRequired = row.pendencia === "GTIN do kit";
            const message = messages[row.sku];
            return <tr key={row.sku} style={{ borderTop: "1px solid #303030" }}>
              <td style={{ ...cellStyle, color: "#69b1ff", fontWeight: 600 }}>{row.sku}</td><td style={cellStyle}>{row.nome}</td><td style={cellStyle}><span style={{ color: "#ff7875" }}>{row.pendencia}</span></td>
              {canEdit && <td style={cellStyle}>{gtinRequired ? <div style={{ display: "grid", gap: 6 }}><div style={{ display: "flex", gap: 8 }}><input value={values[row.sku] || ""} onChange={(event) => setValues((current) => ({ ...current, [row.sku]: event.target.value }))} inputMode="numeric" placeholder="8 a 14 dígitos" aria-label={`GTIN ${row.sku}`} style={inputStyle} /><button type="button" onClick={() => saveGtin(row.sku)} disabled={savingSku === row.sku} style={buttonStyle}>{savingSku === row.sku ? "Salvando" : "Salvar"}</button></div>{message && <small style={{ color: message.error ? "#ff7875" : "#95de64" }}>{message.text}</small>}</div> : <span style={{ color: "#8c8c8c" }}>Não aplicável</span>}</td>}
            </tr>;
          })}
        </tbody>
      </table>
    </section>
  );
}

const cellStyle = { padding: "14px 16px", verticalAlign: "top" as const };
const inputStyle = { minWidth: 145, background: "#141414", border: "1px solid #595959", borderRadius: 6, color: "#f0f0f0", padding: "7px 9px" };
const buttonStyle = { background: "#1677ff", border: 0, borderRadius: 6, color: "#fff", cursor: "pointer", padding: "7px 12px" };
