# Monitoramento da coorte

Eventos `RADAR_LAUNCH_VALIDATED` persistem baseline e checkpoints individuais D+7, D+15 e D+30. O monitor já existente `sync_ml_pricing_experiment_monitor` chama `monitorRadarLaunch` a cada cinco minutos. Implantação e execução do job verificadas; os checkpoints futuros ainda não venceram.

Medir visitas, vendas, conversão, faturamento, contribuição pela economia corrente, margem, preço, estoque, Buy Box e qualidade/exposição. Dados indisponíveis geram erro explícito e não viram demanda zero. A contribuição pela economia corrente não é lucro histórico contábil.

D+7 sem tráfego: observação. D+15: `ALERTA_AMARELO_SEM_TRAFEGO`. D+30: `AUDITORIA_EXPOSICAO_QUALIDADE`. Deduplicação por coorte/MLB/dia impede duplicação de registros.

Primeiros 30 dias protegidos contra reprecificação por performance. Mudanças de segurança ou custo exigem motivo e memória; não iniciar próximas coortes sem auditoria. Não foi criado envio de mensagens a terceiros pelo monitor Radar.

O EV-430 pausado não integra os experimentos validados; continua na fila de validação de catálogo.
