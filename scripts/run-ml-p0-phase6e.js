#!/usr/bin/env node
// Entrada comercial histórica aposentada na V2; nenhum cliente externo deve ser inicializado.
require('../src/lib/ml/pricing-execution.js').assertPricingExecutionReady();
process.env.ML_P0_PHASE = '6E';
require('./run-ml-p0-phase6c');
