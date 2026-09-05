#!/usr/bin/env node
if (require.main === module) throw new Error('M2M: execução legada aposentada. Usar Radar e simulação/aprovação canônica; histórico preservado.');
process.env.ML_P0_PHASE = '6D';
require('./run-ml-p0-phase6c');
