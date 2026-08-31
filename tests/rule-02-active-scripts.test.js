const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const operationalScripts = [
  'scripts/create-profitable-shelf-listings.js',
  'scripts/apply-supplier-pricing-campaign.js',
];

test('scripts operacionais usam contexto tributário e pricing centrais', () => {
  for (const relativePath of operationalScripts) {
    const source = fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
    assert.match(source, /loadPricingTaxRate/);
    assert.match(source, /calculateExactMarginPrice/);
    assert.doesNotMatch(source, /DAS_RATE\s*=/);
    assert.doesNotMatch(source, /(?:tax|das)[A-Za-z_]*\s*=\s*0\.0[45]/i);
  }
});
