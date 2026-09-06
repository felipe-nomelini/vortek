# Rollback e preservação

Baseline de código: e54f16ae9f76b021d4288eff970df830bba37951. Preservar package.json e arquivos locais preexistentes. Não usar reset destrutivo.

Código: reverter os commits da adequação em commits novos, na ordem inversa, validar e usar o deploy normal GitHub main → Easypanel. Nunca voltar a autorizar regras removidas silenciosamente: em rollback técnico, manter publicação/reprecificação por confirmação e interromper operações incompatíveis.

Banco: migrations incrementais 20260906010000_commercial_canon_v1.sql e 20260906011000_commercial_canon_material_cost.sql. A segunda remove apenas a invalidação por timestamp isolado; a definição anterior está na primeira migration. O evento CANON_MIGRATED guarda previous_policy e previous_tax; definições anteriores da view/RPC são preservadas no arquivo schema-baseline.sql. Restaurar configurações/definições somente em transação revisada, preservando pricing_events/pricing_evaluations. Não apagar evidências ou novos registros, nem reescrever migrations aplicadas.

Não houve alteração remota de anúncio para desfazer. Filas de garantia/atacado são propostas somente. Experimentos e suas autorizações não foram removidos.

Três scripts locais preexistentes receberam apenas bloqueio no entrypoint, com originais preservados em /tmp/canon-preexisting-*. Remover esse bloqueio tecnicamente restaura o original, mas não restaura autoridade comercial das regras antigas.
