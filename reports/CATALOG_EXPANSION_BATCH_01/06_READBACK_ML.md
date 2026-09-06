# Conferência remota

2 eventos PUBLICADO_VALIDADO. Evidência integral: audit-events.json.

- MLB5193194293: status active, preço 169.63, estoque 9, catálogo MLB21603639, margem 7.7699%. Garantia, identidade e grupo conferidos pelo backend; sem divergência impeditiva.
- MLB7595130266: status active, preço 286.47, estoque 7, catálogo MLB27401683, margem 9.4774%. Garantia, identidade e grupo conferidos pelo backend; sem divergência impeditiva.

Nenhum safety stop registrado.

HTTP 400 do validador contendo exclusivamente avisos shipping.lost_me1_by_user e item.shipping.mandatory_free_shipping é aceito somente quando o payload já exige ME2 e frete grátis. Nenhum erro material foi dispensado.

MLB5193194293: preço R$169.63 → R$169.63; tarifa R$22.05 → R$22.05; frete R$21.75 → R$20.45; margem 7.0035% → 7.7699%.

MLB7595130266: preço R$286.47 → R$286.47; tarifa R$28.65 → R$28.65; frete R$25.55 → R$27.05; margem 10.0010% → 9.4774%.

A medusa foi reconciliada por leitura remota e recálculo após falha no registro de auditoria. O Bravox usa o fluxo corrigido. Consulte incident-reconciliation.md e deployment.json.
