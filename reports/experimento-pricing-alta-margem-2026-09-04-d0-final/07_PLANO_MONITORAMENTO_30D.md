# Plano de monitoramento

A task `sync_ml_pricing_experiment_monitor` executará de forma idempotente:

- D+7: segurança e `OBSERVACAO_SEM_TRAFEGO` para zero visitas.
- D+15: leitura intermediária e `ALERTA_AMARELO_SEM_TRAFEGO`.
- D+30: auditoria formal e classificação final.

Se o resultado unitário ficar negativo, o grupo será pausado e receberá `ALERTA_CRITICO_PREJUIZO_EXPERIMENTO`. Após D+30, o bloqueio de preço permanecerá até decisão da Diretoria.

Início de referência: 2026-09-05T00:54:37.677Z. D+7: 2026-09-12T00:54:37.677Z; D+15: 2026-09-20T00:54:37.677Z; D+30: 2026-10-05T00:54:37.677Z.
