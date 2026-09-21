const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');
const MODEL = 'jev-1.13.0';
const PRICE_PER_INPUT_TOKEN_USD = 0.042 / 1_000_000;
const MAX_CASES = 50;
const MAX_OPTIONS = 25;
const LOW_CONFIDENCE = 0.6;

function loadTypeScriptExports(relativePath) {
  const source = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function('exports', 'require', code)(exports, (name) => {
    throw new Error(`Dependência inesperada em ${relativePath}: ${name}`);
  });
  return exports;
}

// O piloto executa as próprias funções do formulário, sem manter outra cópia das regras.
// Caso a rota mude, falha explicitamente em vez de comparar contra uma regra antiga.
function loadBaseline(predictCategory) {
  const productFacts = loadTypeScriptExports('src/lib/ml-product-facts.ts');
  const identity = loadTypeScriptExports('src/lib/ml-listing-identity.ts');
  const supplierPolicy = loadTypeScriptExports('src/lib/dslite/supplier-policy.ts');
  const route = 'src/app/api/ml/anuncio/preencher-inteligente/route.ts';
  const source = fs.readFileSync(path.join(ROOT, route), 'utf8');
  const ast = ts.createSourceFile(route, source, ts.ScriptTarget.ES2022, true);
  const names = [
    'normalize', 'hasValue', 'selectAllowed', 'applyValue', 'clearValue',
    'isGoldPlatedText', 'mergeCategoryDefinition', 'factForAttribute',
    'isBadPredictionConflict', 'getPredictionMap', 'inferObviousAttribute',
    'fillAttribute', 'validateObviousErrors',
  ];
  const found = new Map(ast.statements.filter(ts.isFunctionDeclaration)
    .filter((statement) => statement.name && names.includes(statement.name.text))
    .map((statement) => [statement.name.text, statement.getText(ast)]));
  for (const name of names) {
    if (!found.has(name)) throw new Error(`Regra atual indisponível: ${name}`);
  }
  const code = ts.transpileModule(
    `${names.map((name) => found.get(name)).join('\n\n')}\nexports.rules = { ${names.join(', ')} };`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const exports = {};
  new Function('bindings', 'exports', `const { applyProductFactsToMlAttribute, isMlCriticalAttributeId, predictCategory } = bindings;\n${code}`)(
    {
      applyProductFactsToMlAttribute: productFacts.applyProductFactsToMlAttribute,
      isMlCriticalAttributeId: identity.isMlIdentityAttribute,
      predictCategory,
    },
    exports,
  );
  return { ...exports.rules, extractMlProductFacts: productFacts.extractMlProductFacts,
    isMlCriticalAttributeId: identity.isMlIdentityAttribute,
    isOperationalDropshippingSupplier: supplierPolicy.isOperationalDropshippingSupplier };
}

function cleanText(input, maxLength) {
  return String(input || '')
    .replace(/https?:\/\/\S+/gi, '[link removido]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[email removido]')
    .replace(/\b(?:\+?55\s*)?\(?\d{2}\)?\s*9?\d{4}[-\s]?\d{4}\b/g, '[telefone removido]')
    .replace(/\b\d{3}[.\s-]?\d{3}[.\s-]?\d{3}[-\s]?\d{2}\b/g, '[documento removido]')
    .replace(/\b\d{2}[.\s-]?\d{3}[.\s-]?\d{3}[\/\s-]?\d{4}[-\s]?\d{2}\b/g, '[documento removido]')
    .replace(/(?:R\$|US\$|\$)\s*\d[\d.,]*/gi, '[preço removido]')
    .replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function buildState(product, supplierEvidence = '') {
  const allowed = {
    product: {
      name: cleanText(product.nome, 240),
      brand: cleanText(product.marca, 100),
      description: cleanText(product.descricao, 1600),
    },
    supplier_evidence: cleanText(supplierEvidence, 900),
  };
  const serialized = JSON.stringify(allowed);
  if (/\b(?:api[_ -]?key|access[_ -]?token|secret|senha|password)\b/i.test(serialized)) {
    throw new Error('Texto com possível credencial; caso excluído');
  }
  return allowed;
}

function eligibleAttribute(attribute, isCritical) {
  return attribute && attribute.value_type === 'list'
    && Array.isArray(attribute.values)
    && attribute.values.length >= 2 && attribute.values.length <= MAX_OPTIONS
    && !attribute.tags?.hidden && !attribute.tags?.fixed
    && !isCritical(attribute.id)
    && attribute.values.every((value) => value?.id && value?.name);
}

function makeQuestion(attribute) {
  const options = { no_evidence: null };
  const values = {};
  for (const [index, value] of attribute.values.entries()) {
    const key = `value_${index}`;
    options[key] = String(value.name);
    values[key] = { id: String(value.id), name: String(value.name) };
  }
  return {
    question: {
      type: 'choice',
      instructions: `Qual valor oficial descreve o atributo "${attribute.name}" deste produto? Use somente fatos explícitos do cadastro e do fornecedor. Se não houver evidência suficiente, escolha no_evidence.`,
      criteria: { ...options, no_evidence: 'O cadastro e o fornecedor não comprovam nenhuma das opções.' },
    },
    values,
  };
}

function parseChoice(payload, key, values) {
  const answer = payload?.answers?.[key];
  if (answer?.type !== 'choice' || typeof answer.choice !== 'string'
    || !Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1
    || !answer.probabilities || typeof answer.probabilities !== 'object') {
    throw new Error('Resposta Choice inválida');
  }
  const permitted = new Set(['no_evidence', ...Object.keys(values)]);
  if (!permitted.has(answer.choice)
    || [...permitted].some((option) => !Number.isFinite(answer.probabilities[option])
      || answer.probabilities[option] < 0 || answer.probabilities[option] > 1)) {
    throw new Error('Resposta fora das opções oficiais');
  }
  return {
    status: answer.confidence < LOW_CONFIDENCE ? 'inconclusive' : 'evaluated',
    choice: answer.choice === 'no_evidence' ? null : values[answer.choice],
    confidence: answer.confidence,
    probabilities: answer.probabilities,
  };
}

async function callJev(state, questions, apiKey, fetchImpl = fetch) {
  const started = performance.now();
  const response = await fetchImpl('https://api.typesafe.ai/v1/systemone', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, state, questions }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`TypeSafe HTTP ${response.status}`);
  const payload = await response.json();
  if (payload?.model !== MODEL || !payload?.answers || !Number.isInteger(payload?.usage?.input_tokens)) {
    throw new Error('Resposta TypeSafe inválida');
  }
  return {
    payload,
    elapsedMs: Math.round(performance.now() - started),
    inputTokens: payload.usage.input_tokens,
    estimatedUsd: payload.usage.input_tokens * PRICE_PER_INPUT_TOKEN_USD,
  };
}

function selectCases(candidates, maxCases = MAX_CASES) {
  const byCategory = new Map();
  for (const row of candidates) {
    const group = byCategory.get(row.categoryId) || [];
    group.push(row);
    byCategory.set(row.categoryId, group);
  }
  const selected = [];
  const productCounts = new Map();
  const categories = [...byCategory.keys()].sort();
  while (selected.length < maxCases) {
    let advanced = false;
    for (const category of categories) {
      const group = byCategory.get(category);
      while (group.length) {
        const row = group.shift();
        if ((productCounts.get(row.productId) || 0) >= 3) continue;
        selected.push(row);
        productCounts.set(row.productId, (productCounts.get(row.productId) || 0) + 1);
        advanced = true;
        break;
      }
      if (selected.length >= maxCases) break;
    }
    if (!advanced) break;
  }
  return selected;
}

module.exports = {
  MODEL, MAX_CASES, buildState, callJev, eligibleAttribute, loadBaseline,
  makeQuestion, parseChoice, selectCases,
};
