const load = require('./load-integration-module');

module.exports = load('src/lib/kit-supply-source.ts', {
  '@/lib/dslite/supplier-policy': {
    loadOperationalDropshippingSupplierIds: async () => new Set(),
  },
});
