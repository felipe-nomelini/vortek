const crypto = require('crypto');

const DESCRIPTION = `CARREGADOR DE PILHAS TOSHIBA TNHC-6GAE4 CB COM 4 PILHAS AA 2600 mAh

O carregador de pilhas Toshiba TNHC-6GAE4 CB recarrega pilhas Ni-MH nos tamanhos AA e AAA. Este carregador bivolt permite carregar até quatro pilhas simultaneamente e acompanha quatro pilhas recarregáveis Toshiba AA de 2600 mAh.

PRINCIPAIS CARACTERÍSTICAS

- Marca: Toshiba
- Modelo: TNHC-6GAE4 CB
- Tipo: carregador de pilhas AA e AAA
- Composição compatível: Ni-MH
- Capacidade de carga: até 4 pilhas simultaneamente
- Indicador de carga: sim
- Entrada: bivolt automática, compatível com a faixa de 100 a 240 V indicada pelo fabricante
- Pilhas inclusas: 4 unidades AA recarregáveis
- Capacidade das pilhas inclusas: 2600 mAh

CONTEÚDO DA EMBALAGEM

- 1 carregador Toshiba TNHC-6GAE4 CB
- 4 pilhas AA recarregáveis Toshiba de 2600 mAh
- 1 manual

INFORMAÇÕES IMPORTANTES

- Utilize o carregador somente com pilhas recarregáveis Ni-MH nos formatos AA ou AAA.
- Não carrega baterias de 9 V.
- Consulte o manual e respeite os tempos e condições de carregamento indicados pelo fabricante.
- Produto novo.

SKU: VTK000486`;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeAcceptableText(value) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function compareDescription(sent, remote) {
  if (remote === sent) return { result: 'MATCH', material_drift: false };
  if (normalizeAcceptableText(remote) === normalizeAcceptableText(sent)) {
    return { result: 'NORMALIZED_BY_ML', material_drift: false };
  }
  return { result: 'MATERIAL_TEXT_DRIFT', material_drift: true };
}

function validateDescription(value) {
  const failures = [];
  if (!value || value.length > 5000) failures.push('invalid_length');
  if (/<[^>]+>/.test(value)) failures.push('html_not_allowed');
  if (/https?:\/\/|www\./i.test(value)) failures.push('external_link_not_allowed');
  if (/whats\s*app|\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/i.test(value)) failures.push('contact_not_allowed');
  const required = [
    'Toshiba', 'TNHC-6GAE4 CB', 'AA e AAA', 'Ni-MH', '4 pilhas', '2600 mAh',
    'bivolt automática', '100 a 240 V', 'Não carrega baterias de 9 V',
  ];
  for (const marker of required) {
    if (!value.includes(marker)) failures.push(`missing_evidence_marker:${marker}`);
  }
  return { valid: failures.length === 0, failures, characters: value.length, sha256: sha256(value) };
}

function classifyWrite(status) {
  if (status >= 200 && status < 300) return 'DESCRIPTION_POST_SUCCESS';
  if (status === 400 || status === 422) return 'DESCRIPTION_VALIDATION_ERROR';
  if (status === 404 || status === 405) return 'DESCRIPTION_ENDPOINT_MISMATCH';
  return 'DESCRIPTION_API_ERROR';
}

module.exports = {
  DESCRIPTION,
  classifyWrite,
  compareDescription,
  normalizeAcceptableText,
  sha256,
  validateDescription,
};
