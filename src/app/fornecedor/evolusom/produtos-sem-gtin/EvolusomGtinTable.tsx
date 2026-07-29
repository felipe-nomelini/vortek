"use client";

import { useState } from "react";

type Row = {
  sku: string;
  supplierSku: string;
  name: string;
};

type RowMessage = {
  text: string;
  error: boolean;
};

export function EvolusomGtinTable({
  rows,
  token,
  expiresAt,
}: {
  rows: Row[];
  token: string;
  expiresAt: string;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [savingSku, setSavingSku] = useState<string | null>(null);
  const [savedSkus, setSavedSkus] = useState<Set<string>>(new Set());
  const [messages, setMessages] = useState<Record<string, RowMessage>>({});

  async function saveGtin(sku: string) {
    const gtin = values[sku] || "";
    setSavingSku(sku);
    setMessages((current) => ({
      ...current,
      [sku]: { text: "Salvando...", error: false },
    }));

    try {
      const response = await fetch(
        "/api/public/fornecedor/evolusom/gtin",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sku, gtin, token, expiresAt }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "Falha ao salvar GTIN");
      }

      setSavedSkus((current) => new Set(current).add(sku));
      setMessages((current) => ({
        ...current,
        [sku]: { text: "GTIN salvo. Obrigado!", error: false },
      }));
    } catch (error: any) {
      setMessages((current) => ({
        ...current,
        [sku]: {
          text: error?.message || "Falha ao salvar GTIN",
          error: true,
        },
      }));
    } finally {
      setSavingSku(null);
    }
  }

  if (rows.length === 0) {
    return (
      <section style={emptyStyle}>
        Nenhum produto pendente nesta página.
      </section>
    );
  }

  return (
    <section style={tableContainerStyle}>
      <table style={tableStyle}>
        <thead>
          <tr style={{ background: "#1f1f1f", textAlign: "left" }}>
            <th style={cellStyle}>SKU Vortek</th>
            <th style={cellStyle}>SKU Evolusom</th>
            <th style={cellStyle}>Produto</th>
            <th style={cellStyle}>GTIN da embalagem</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const message = messages[row.sku];
            const saved = savedSkus.has(row.sku);
            return (
              <tr key={row.sku} style={{ borderTop: "1px solid #303030" }}>
                <td style={{ ...cellStyle, color: "#69b1ff", fontWeight: 600 }}>
                  {row.sku}
                </td>
                <td style={{ ...cellStyle, color: "#d3adf7", fontWeight: 600 }}>
                  {row.supplierSku || "—"}
                </td>
                <td style={cellStyle}>{row.name}</td>
                <td style={cellStyle}>
                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={formRowStyle}>
                      <input
                        value={values[row.sku] || ""}
                        onChange={(event) =>
                          setValues((current) => ({
                            ...current,
                            [row.sku]: event.target.value,
                          }))
                        }
                        inputMode="numeric"
                        autoComplete="off"
                        maxLength={18}
                        placeholder="8, 12, 13 ou 14 dígitos"
                        aria-label={`GTIN do produto ${row.sku}`}
                        disabled={saved}
                        style={inputStyle}
                      />
                      <button
                        type="button"
                        onClick={() => saveGtin(row.sku)}
                        disabled={savingSku === row.sku || saved}
                        style={{
                          ...buttonStyle,
                          opacity:
                            savingSku === row.sku || saved ? 0.65 : 1,
                        }}
                      >
                        {saved
                          ? "Salvo"
                          : savingSku === row.sku
                            ? "Salvando"
                            : "Salvar"}
                      </button>
                    </div>
                    {message && (
                      <small
                        role={message.error ? "alert" : "status"}
                        style={{
                          color: message.error ? "#ff7875" : "#95de64",
                        }}
                      >
                        {message.text}
                      </small>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

const tableContainerStyle = {
  background: "#141414",
  border: "1px solid #303030",
  borderRadius: 8,
  overflowX: "auto" as const,
};
const tableStyle = {
  width: "100%",
  minWidth: 920,
  borderCollapse: "collapse" as const,
  color: "#f0f0f0",
};
const cellStyle = {
  padding: "14px 16px",
  verticalAlign: "top" as const,
};
const formRowStyle = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap" as const,
};
const inputStyle = {
  minWidth: 205,
  flex: 1,
  background: "#141414",
  border: "1px solid #595959",
  borderRadius: 6,
  color: "#f0f0f0",
  padding: "8px 10px",
};
const buttonStyle = {
  background: "#1677ff",
  border: 0,
  borderRadius: 6,
  color: "#fff",
  cursor: "pointer",
  padding: "8px 14px",
};
const emptyStyle = {
  background: "#141414",
  border: "1px solid #303030",
  borderRadius: 8,
  color: "#95de64",
  padding: 24,
  textAlign: "center" as const,
};
