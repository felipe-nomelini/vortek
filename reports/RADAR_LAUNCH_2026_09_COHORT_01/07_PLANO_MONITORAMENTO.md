# Monitoramento D+7 / D+15 / D+30

Nenhum checkpoint operacional foi agendado: ainda não existem anúncios publicados nesta coorte. Não criar datas fictícias a partir da auditoria.

Ao ocorrer PUBLICADO_VALIDADO, registrar baseline e agendar a partir do timestamp real de cada item:

| Checkpoint | Ação |
|---|---|
| D+7 | Visitas, vendas, conversão, faturamento, contribuição, margem, Buy Box, preço, estoque, qualidade/exposição; zero tráfego fica em observação. |
| D+15 | Repetir métricas; zero tráfego gera ALERTA_AMARELO_SEM_TRAFEGO. |
| D+30 | Repetir métricas e encaminhar ausência de tráfego à auditoria de exposição/qualidade. |

Preservar preço experimental por 30 dias, ressalvadas as exceções expressamente autorizadas na ordem. Qualquer erro crítico pós-publicação interrompe a coorte e exige estado reversível, preferencialmente paused, com confirmação remota.

Sem anúncio publicado, não foi declarada validação de idempotência de publicação, safety stop ou agendamento real dos checkpoints.
