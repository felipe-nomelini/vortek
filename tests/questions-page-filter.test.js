const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  filterQuestionsOnCurrentPage,
} = require('../src/lib/ml/questions-page-filter.ts');

const emptyRange = [null, null];
const localDate = (day, hour = 0, minute = 0) => new Date(2026, 7, day, hour, minute).toISOString();
const questions = [
  {
    id: 101,
    itemId: 'MLB1001',
    anuncio: 'Câmera Wi-Fi',
    cliente: 'Usuário 501',
    pergunta: 'Funciona à noite?',
    resposta: 'Sim, possui visão noturna.',
    dataPergunta: localDate(10, 10),
    dataResposta: localDate(10, 11),
  },
  {
    id: 102,
    itemId: 'MLB1002',
    anuncio: 'Sensor de presença',
    cliente: 'Usuário 502',
    pergunta: 'Tem pronta entrega?',
    resposta: null,
    dataPergunta: localDate(11, 23, 30),
    dataResposta: null,
  },
];

function filter(overrides = {}) {
  return filterQuestionsOnCurrentPage(questions, {
    search: '',
    questionDateRange: emptyRange,
    answerDateRange: emptyRange,
    ...overrides,
  });
}

test('busca os campos da página atual sem diferenciar caixa', () => {
  for (const search of ['101', 'mlb1001', 'CÂMERA', 'usuário 501', 'à noite', 'VISÃO NOTURNA']) {
    assert.deepEqual(filter({ search }).map((question) => question.id), [101], search);
  }
});

test('aplica datas inicial e final de forma inclusiva', () => {
  assert.deepEqual(filter({
    questionDateRange: [
      new Date(2026, 7, 11),
      new Date(2026, 7, 11),
    ],
  }).map((question) => question.id), [102]);

  assert.deepEqual(filter({
    answerDateRange: [
      new Date(2026, 7, 10),
      new Date(2026, 7, 10),
    ],
  }).map((question) => question.id), [101]);
});

test('filtro de resposta exclui pergunta ainda sem resposta', () => {
  assert.deepEqual(filter({
    answerDateRange: [new Date(2026, 7, 1), null],
  }).map((question) => question.id), [101]);
});

test('não procura fora do conjunto carregado recebido', () => {
  const secondPageQuestion = { ...questions[0], id: 999, pergunta: 'Somente na página dois' };
  const firstPageResult = filterQuestionsOnCurrentPage(questions, {
    search: 'página dois',
    questionDateRange: emptyRange,
    answerDateRange: emptyRange,
  });
  const secondPageResult = filterQuestionsOnCurrentPage([secondPageQuestion], {
    search: 'página dois',
    questionDateRange: emptyRange,
    answerDateRange: emptyRange,
  });

  assert.deepEqual(firstPageResult, []);
  assert.deepEqual(secondPageResult.map((question) => question.id), [999]);
});

test('interface informa os escopos global e local sem apresentar cards como totais', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../src/app/(app)/perguntas/page.tsx'),
    'utf8',
  );

  assert.match(source, /Status consulta \{visualReview \? 'a amostra protegida' : 'todas as perguntas no Mercado Livre'\}/);
  assert.match(source, /Busca e períodos filtram somente os até \{PAGE_SIZE\} registros desta página/);
  assert.match(source, />Exibidas nesta página</);
  assert.match(source, />Pendentes nesta página</);
  assert.match(source, />Mais antiga nesta página</);
  assert.match(source, />Total global do filtro de status</);
});

test('inbox abre em não respondidas e prioriza a pergunta pendente mais antiga', () => {
  const pageSource = fs.readFileSync(
    path.join(__dirname, '../src/app/(app)/perguntas/page.tsx'),
    'utf8',
  );
  const routeSource = fs.readFileSync(
    path.join(__dirname, '../src/app/api/perguntas/route.ts'),
    'utf8',
  );

  assert.match(pageSource, /useState<QuestionStatus \| ''>\('pendente'\)/);
  assert.match(pageSource, /Caixa de entrada de perguntas/);
  assert.match(pageSource, /Enviar resposta/);
  assert.match(pageSource, /Pergunta em revisão no Mercado Livre/);
  assert.match(pageSource, /Pergunta indisponível para resposta/);
  assert.doesNotMatch(pageSource, /ResizableTable/);
  assert.match(routeSource, /sort_types: status === 'UNANSWERED' \? 'ASC' : 'DESC'/);
  assert.match(routeSource, /thumbnail:/);
});

test('amostra real protegida mantém a API da página e bloqueia ações externas', () => {
  const pageSource = fs.readFileSync(
    path.join(__dirname, '../src/app/(app)/perguntas/page.tsx'),
    'utf8',
  );
  const routeSource = fs.readFileSync(
    path.join(__dirname, '../src/app/api/perguntas/route.ts'),
    'utf8',
  );
  const answerRouteSource = fs.readFileSync(
    path.join(__dirname, '../src/app/api/perguntas/[id]/responder/route.ts'),
    'utf8',
  );
  const reviewSource = fs.readFileSync(
    path.join(__dirname, '../src/lib/ml/questions-visual-review.ts'),
    'utf8',
  );

  assert.match(pageSource, /fetch\(`\/api\/perguntas\?\$\{params\.toString\(\)\}`/);
  assert.match(pageSource, /fetch\(`\/api\/perguntas\/\$\{activeQuestion\.id\}\/responder`/);
  assert.match(pageSource, /Amostra real protegida de produção/);
  assert.match(pageSource, /function showsAnswerComposer/);
  assert.match(pageSource, /const showComposer = showsAnswerComposer\(activeQuestion\)/);
  assert.match(pageSource, /Simulação visual: nenhuma resposta será enviada ao Mercado Livre/);
  assert.match(pageSource, /O botão apenas exibirá um aviso/);
  assert.match(pageSource, /if \(!initializedRef\.current\) params\.set\('initial', '1'\)/);
  assert.match(pageSource, /question\.isHomologationFixture !== true/);
  assert.match(routeSource, /loadQuestionVisualReview\(\)/);
  assert.match(routeSource, /initialRequest: search\.get\('initial'\) === '1'/);
  assert.match(answerRouteSource, /questionId < 0/);
  assert.match(answerRouteSource, /não permite enviar respostas/);
  assert.match(reviewSource, /bnt_d06_visual_review_enabled/);
  assert.match(reviewSource, /bnt_d06_visual_review_questions/);
  assert.match(reviewSource, /EXPECTED_SOURCE = 'production-read-only'/);
  assert.match(reviewSource, /Date\.parse\(payload\.expiresAt\) <= Date\.now\(\)/);
  assert.match(reviewSource, /item\.id < 0/);
  assert.match(reviewSource, /item\.anuncioUrl === null/);
  assert.match(reviewSource, /item\.clienteId === null/);
  assert.match(reviewSource, /item\.isSimulatedPending !== true/);
  assert.match(reviewSource, /simulatedItemCount/);
  assert.match(reviewSource, /item\.status === 'pendente'/);
  assert.match(reviewSource, /item\.mlStatus === 'UNANSWERED'/);
});
