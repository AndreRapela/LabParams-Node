# Prontidão comercial do SYSmLab

## Diagnóstico executivo

O SYSmLab agora cobre o núcleo de um **piloto controlado de LIMS ambiental**: cliente/pedido, cadeia de custódia, métodos, resultados com revisão, assinatura de aplicação, laudo versionado, inventário, equipamentos e QMS/CAPA. Ainda não deve ser anunciado como LIMS completo, validado, acreditado ou pronto para operação irrestrita. A liberação comercial depende de validação com laboratório real, operação segura e definição contratual do escopo.

## Capacidade entregue

### Fluxo laboratorial

- cadastro comercial de clientes, solicitantes e pedidos com prazo/prioridade;
- amostra vinculada ao pedido, matriz e parâmetros esperados;
- status controlados e cadeia de custódia append-only;
- catálogo legal por legislação/matriz/contexto;
- métodos analíticos versionados com aplicabilidade, referência, LD/LQ e incerteza padrão;
- resultados numéricos, qualitativos e informativos com snapshot analítico;
- submissão, revisão, aprovação/rejeição, publicação e reabertura;
- maker-checker, reautenticação e histórico/assinatura imutáveis;
- laudo HTML versionado com hash, QR, verificação pública e motivo de revisão;
- dashboards/alertas considerando apenas resultados publicados.

### Operação da qualidade

- insumos, lotes, validade, estoque mínimo, entrada/saída e ajustes auditados;
- equipamentos, criticidade, calibração, manutenção, bloqueio e rastreio de utilização;
- não conformidade/desvio, investigação, causa raiz, CAPA e eficácia;
- auditoria transversal, arquivamento lógico, health checks e logs estruturados.

## Comparação honesta com o mercado

Plataformas maduras como [LabWare LIMS](https://www.labware.com/lims), [LabVantage LIMS](https://www.labvantage.com/lims/), [STARLIMS](https://www.starlims.com/) e [QBench](https://qbench.com/) normalmente adicionam configuração de workflows, portal do cliente, integrações de instrumentos/ERP, gestão documental, compras, faturamento, notificações, agenda/bancada, analytics/QC avançado, SSO e pacotes de validação.

O diferencial imediato do SYSmLab é um escopo enxuto, em português, com rastreabilidade e regras ambientais integradas. A lacuna está na validação operacional e na amplitude de integrações, não mais na ausência do workflow crítico básico.

## Condições para o primeiro piloto pago

Todas devem ser verificadas e evidenciadas:

1. **Segredos e infraestrutura:** credenciais rotacionadas, ambientes separados, domínio/TLS, backup e restauração testados.
2. **Validação de dados:** catálogo legal, unidades, critérios, métodos e identidade `LAB_*` aprovados pelo responsável técnico.
3. **UAT ponta a ponta:** cenários normais, rejeição, reabertura, revisão de laudo, estoque, calibração e CAPA assinados pelo laboratório piloto.
4. **Perfis e continuidade:** matriz de acesso aprovada, maker-checker ativo e mais de um Gestor treinado.
5. **Operação:** monitoramento, alertas, retenção, suporte, canal de incidente, RPO/RTO e procedimento de mudança definidos.
6. **Segurança:** auditoria de dependências sem vulnerabilidade de produção conhecida, revisão independente/pentest proporcionais ao risco.
7. **Contrato:** escopo, limites, SLA, responsabilidades pelo catálogo/métodos, LGPD e processo de aceite formalizados.

## Gates técnicos disponíveis

O repositório entrega quatro verificações reproduzíveis para a liberação:

- `node scripts/check-migrations.js`: análise léxica, integridade estática, política destrutiva e controles mínimos de segurança das migrations;
- `node scripts/check-supabase-config.js`: padrões seguros de cadastro, senha e TOTP no arquivo de configuração;
- `node scripts/check-production-env.js`: pré-flight seguro das variáveis de produção, sem revelar seus valores;
- `node scripts/verify-database.js`: comparação transacional somente leitura entre histórico/conteúdo disponível, semântica do esquema remoto, drift, privilégios, TLS e invariantes críticos.

O CI executa a validação estática e impede alteração/remoção ou timestamp retroativo de migrations em pull requests e pushes para `main`. Esses gates reduzem erro de implantação, mas não comprovam backup restaurável, UAT, pentest, configuração remota do Supabase ou aprovação do responsável técnico; as evidências devem ser anexadas ao registro de release.

## Limitações que precisam constar na proposta

- implantação segregada por laboratório; não é SaaS multi-tenant;
- documento atual é HTML imprimível, não PDF com certificado digital/ICP-Brasil;
- assinatura confirma senha Supabase e identidade da aplicação, não equivale automaticamente a assinatura qualificada;
- sem portal externo do cliente, orçamento/faturamento, pagamentos ou integração ERP;
- sem integração automática com instrumentos, webhooks ou fila persistente;
- sem gestão documental/SOP completa, qualificação de fornecedor, compras ou rastreio de preparo de reagentes/padrões;
- sem cartas de controle, OOS/OOT dedicado, ensaio de proficiência ou incerteza expandida automatizada;
- sem MFA obrigatório pela aplicação, SSO empresarial ou alta disponibilidade contratual pronta;
- limites legais exigem curadoria e atualização técnica contínua do laboratório.

## Roadmap recomendado

| Fase | Objetivo | Saída verificável |
|---|---|---|
| 1 | Piloto validado | UAT, backup restaurado, segurança, suporte e fluxo completo em uso controlado |
| 2 | Documento e cliente | PDF versionado em storage imutável, assinatura adequada ao requisito, portal e notificações |
| 3 | Produtividade | agenda/bancada, TAT, templates, importação assíncrona, instrumentos, API/webhooks |
| 4 | Qualidade ampliada | gestão documental, fornecedores/compras, QC/cartas, proficiência, OOS/OOT |
| 5 | Produto comercial | onboarding, billing, contratos, telemetria, suporte e indicadores de adoção |
| 6 | SaaS/enterprise | multi-tenancy comprovado, SSO/MFA, HA/DR, internacionalização e pacote de validação |

## ISO/IEC 17025 e validação

O software apoia rastreabilidade, integridade de registros, métodos controlados, equipamentos calibrados, revisão e auditoria. A conformidade depende também de competência, procedimentos, evidências e uso validado. Informações oficiais de acreditação estão na [Cgcre/Inmetro](https://www.gov.br/inmetro/pt-br/assuntos/acreditacao-reconhecimento-bpl/cgcre/acreditacao). Não use afirmações como “certificado ISO 17025” ou “garante conformidade” sem avaliação formal aplicável ao laboratório e ao escopo.

Um pacote de validação comercial deve conter URS/requisitos, avaliação de risco, matriz de rastreabilidade, protocolo e evidências IQ/OQ/PQ ou abordagem equivalente, UAT, desvios, versão aprovada e controle de mudança.

## Critério de pronto para venda

O produto pode ser oferecido como piloto quando escopo e limitações estiverem explícitos, todos os itens de liberação estiverem evidenciados e nenhuma credencial compartilhada permanecer ativa. “LIMS completo” só deve ser usado depois de validar os módulos exigidos pelo nicho, integrações, gestão documental, operação em escala e controles regulatórios contratados.
