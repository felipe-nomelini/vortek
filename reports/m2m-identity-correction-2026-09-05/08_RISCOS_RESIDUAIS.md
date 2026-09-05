# Riscos e rollback

As 65 avaliações foram revistas com evidências atuais; o universo offline de 1.977 reutiliza a pesquisa anterior, sem nova pesquisa externa pesada. As duas visões possuem datas/fontes distintas e não devem ser tratadas como a mesma fotografia.

Os complementos técnicos foram preenchidos somente para os dois produtos efetivamente pesquisados. Não foi afirmada auditoria técnica completa de todos os produtos. As recotações são fotografias; nova publicação exige novo gate vivo.

O preenchimento legado de 12 meses de garantia de fábrica permanece como risco do fluxo geral, fora da correção de identidade. A coorte não utilizou esse default como comprovação. Nenhum anúncio real foi criado.

Rollback de código: reverter os commits próprios em ordem inversa e usar o deploy oficial. Histórico anterior preservado em `reclassification_baseline.json`; estados novos e eventos em `reclassification_applied.json` e banco. Qualquer restauração deve usar lock e conferir alterações posteriores, sem apagar eventos nem sobrescrever mudanças concorrentes. Sem migração nova nesta correção; histórico do pricing intacto.
