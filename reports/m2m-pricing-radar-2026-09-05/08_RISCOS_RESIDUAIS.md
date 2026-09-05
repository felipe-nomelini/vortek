# Riscos e rollback

1. Taxação está estimada pelo RBT12 operacional; confirmar competência/alíquota/evidência na configuração. Custo variável ausente pode elevar a contribuição estimada. Isso aparece na memória e requer reconhecimento de revisão.
2. Memória tem validade máxima de 24 horas e é invalidada por mudança material/competência/versão. A aprovação recota novamente. O dashboard distingue evidência vencida/incompatível.
3. Falha de fonte ML ou de prova de sincronismo não deve ser convertida em pausa/reprovação automática. O monitor conserva observação e registra a pendência; não classifica estimativa como prejuízo confirmado.
4. Algumas filas ficarão vazias até validar identidade e completar dados; não preencher dados apenas para promover candidatos. Registros em conflitos não significam falta de demanda.
5. O job noturno trabalha em lotes e pode continuar fora da janela de início. Dependência de atualização de ofertas é atendida pelo agendador existente; oferta antiga é explicitamente estimada.
6. Não foi exercitada escrita financeira em anúncio real para testar aprovação: seria uma alteração comercial sem necessidade. Os guardas foram testados em lógica/integração controlada; a leitura viva tem evidência separada.
7. A implantação não reprocessa o histórico contábil em massa. Reavaliações solicitadas pelos fluxos atuais passam a expor ausência de componentes como lucro pendente.

## Backup e reversão

Backup integral anterior: servidor 192.168.1.160, `/opt/supabase-vortek/backups/m2m-pricing-20260905/postgres-before.dump`, 410856560 bytes, permissão 600. Contém dados sensíveis e não foi copiado ao repositório.

Referência anterior de código: b6e1b17eba58f0ec80a3d16357ac7ab2409f56de. Mudanças estão separadas em commits com dependências explícitas. O artefato implantável é a sequência completa validada, não um commit intermediário isolado.

Em rollback, interromper o Radar e manter bloqueadas escritas automáticas de preço. Preferir correção/reversão seletiva pelo fluxo GitHub → Easypanel. As tabelas aditivas podem permanecer para preservar trilha; não apagar eventos/avaliações nem restaurar backup integral sobre pedidos novos. O dump é salvaguarda para restauração planejada, não comando automático. Não reativar as regras antigas de preço como efeito silencioso da reversão.

O teste operacional cobriu um lote de 50 produtos, não toda a execução noturna. A continuidade automática deve ser observada na primeira janela regular, incluindo validade das fontes, cobertura da conta e evolução do checkpoint. A revisão visual do dashboard e a homologação comercial/fiscal permanecem registradas; não são substituídas pelo build.
