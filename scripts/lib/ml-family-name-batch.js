const TITLE_PATTERN = /^[a-zA-Z0-9 ]+$/;

const ROWS = [
  ['VTK012444', 'MLB7149339312', 'Pilha AA Recarregavel 1350mah Rayovac 2 Unidades'],
  ['VTK025847', 'MLB7317384260', 'Pilha AA Alcalina Elgin 8 Unidades'],
  ['VTK012416', 'MLB4898641383', 'Palheta Sax Tenor Vandoren Java 2 Profissional'],
  ['VTK015926', 'MLB7184746248', 'Bateria Alcalina 12V 23A Panasonic 10 Unidades'],
  ['VTK025639', 'MLB4972432413', 'Bateria Moeda CR2032 3V Elgin 10 Unidades'],
  ['VTK015943', 'MLB7184620482', 'Pilha Palito AAA Panasonic Alcalina Premium 10 Unidades'],
  ['VTK015953', 'MLB4903857433', 'Bateria Moeda CR2032 3V Panasonic 100 Unidades'],
  ['VTK012247', 'MLB7111657378', 'Pilha Palito AAA Duracell Alcalina 16 Unidades'],
  ['VTK025684', 'MLB4972449565', 'Pilha AA Elgin Alcalina 16 Unidades'],
  ['VTK016029', 'MLB7381238898', 'Pilha Palito AAA Panasonic Alcalina 192 Unidades'],
  ['VTK025511', 'MLB7296124702', 'Pilha AA Duracell Alcalina 20 Unidades'],
  ['VTK016042', 'MLB4894912759', 'Bateria CR1616 3V Panasonic 20 Unidades'],
  ['VTK025670', 'MLB4972422755', 'Pilha AA Elgin Alcalina 14 Unidades'],
  ['VTK015993', 'MLB4903776529', 'Pilha AA Panasonic Alcalina 16 Unidades'],
  ['VTK025666', 'MLB4972447863', 'Pilha Palito AAA Elgin Alcalina 12 Unidades'],
  ['VTK025470', 'MLB7295987810', 'Bateria Alcalina 23A 12V Duracell 12 Unidades'],
  ['VTK025676', 'MLB4972436409', 'Bateria Alcalina A27 12V Elgin 15 Unidades'],
  ['VTK025692', 'MLB4980593067', 'Bateria Auditiva PR48 Tamanho 13 Elgin 18 Unidades'],
  ['VTK016107', 'MLB7210717982', 'Pilha Palito AAA Panasonic Premium 30 Unidades'],
  ['VTK025505', 'MLB4971628035', 'Pilha AA Duracell Alcalina 192 Unidades'],
  ['VTK016034', 'MLB4923465039', 'Bateria Alcalina 9V Panasonic 2 Unidades'],
  ['VTK016047', 'MLB7184754648', 'Bateria Moeda CR2032 3V Panasonic 20 Unidades'],
  ['VTK025718', 'MLB7297385700', 'Pilha AA Elgin Alcalina 20 Unidades'],
  ['VTK025496', 'MLB4971632129', 'Bateria Alcalina 9V Duracell 18 Unidades'],
  ['VTK025501', 'MLB4971614189', 'Pilha AA Duracell Alcalina 18 Unidades'],
  ['VTK025514', 'MLB7296125294', 'Pilha Palito AAA Duracell Alcalina 20 Unidades'],
  ['VTK025518', 'MLB7296125966', 'Bateria Moeda CR2032 3V Duracell 200 Unidades'],
  ['VTK025524', 'MLB7296152066', 'Pilha AA Duracell Alcalina 24 Unidades'],
  ['VTK016069', 'MLB7330396528', 'Pilha Palito AAA Panasonic Alcalina 24 Unidades'],
  ['VTK025732', 'MLB7297400140', 'Bateria Alcalina 23A 12V Elgin 25 Unidades'],
  ['VTK025531', 'MLB7296153222', 'Bateria Moeda CR2032 3V Duracell 250 Unidades'],
  ['VTK016084', 'MLB4903860425', 'Bateria Moeda CR2032 3V Panasonic 250 Unidades'],
  ['VTK016088', 'MLB7184760484', 'Pilha Palito AAA Panasonic Premium 28 Unidades'],
  ['VTK025740', 'MLB7297400606', 'Bateria Moeda CR2032 3V Elgin 3 Unidades'],
  ['VTK016093', 'MLB4894821149', 'Bateria Moeda CR2032 3V Panasonic 3 Unidades'],
  ['VTK025535', 'MLB7296140946', 'Bateria Alcalina 9V Duracell 30 Unidades'],
  ['VTK025743', 'MLB7297375214', 'Bateria Alcalina 23A 12V Elgin 30 Unidades'],
  ['VTK025746', 'MLB7297401428', 'Bateria Alcalina LR626 AG4 Elgin 30 Unidades'],
  ['VTK016104', 'MLB7184755052', 'Pilha AA Panasonic Alcalina 30 Unidades'],
  ['VTK016180', 'MLB4894918943', 'Bateria Moeda CR1220 3V Panasonic 50 Unidades'],
  ['VTK006361', 'MLB6646381018', 'Ferro De Solda Maxx 130W 220V Brasfort Profissional'],
  ['VTK006362', 'MLB4621152043', 'Ferro De Solda Maxx 130W 127V Brasfort Profissional'],
  ['VTK000045', 'MLB7216666520', 'Bateria Selada 6V 4 5Ah Unipower VRLA Alarme'],
  ['VTK002333', 'MLB7095325256', 'Bateria Selada 12V 7Ah Unipower Para Nobreak'],
  ['VTK000115', 'MLB7086959336', 'Bateria Selada 12V 1 3Ah UP1213 Unipower Alarme Nobreak'],
  ['VTK000546', 'MLB4841980907', 'Bateria Selada 12V 4Ah Powertek EN011A Para Alarme'],
  ['VTK006173', 'MLB4786753035', 'Corda Violao Aco Tagima Resonance 010'],
  ['VTK001528', 'MLB4612539573', 'Corda Guitarra Elixir 011 Nanoweb Longa Duracao'],
  ['VTK000998', 'MLB4620768339', 'Soundbar Gamer Fortrek Sonar Branca Home Theater'],
  ['VTK012122', 'MLB4880565683', 'Alto Falante Woofer 12 Pol 250W RMS 4 Ohms Attack'],
  ['VTK001136', 'MLB4591747155', 'Alicate De Corte Rente Furukawa Soho Plus Vermelho'],
  ['VTK000239', 'MLB4804981929', 'Cadeira Gamer ThunderX3 EC3 Vermelha'],
  ['VTK006473', 'MLB7150553642', 'Cafeteira Eletrica Arno Filtro Semi Automatica Preta 127V'],
  ['VTK006437', 'MLB7149405758', 'Espremedor De Frutas Arno Express 750ml Preto 220V'],
  ['VTK000110', 'MLB7040921798', 'Cavaquinho Acustico Giannini Start CS14 Preto'],
  ['VTK012556', 'MLB7111655878', 'Crossover Ativo Mark Audio EP220 2 Vias Corte Fixo'],
  ['VTK012206', 'MLB7149368676', 'Filtro De Linha Distribuidor Energia Wireconex WPD8D'],
  ['VTK012188', 'MLB7149405472', 'Filtro Linha Energia Wireconex WPD8D Regua Digital'],
  ['VTK006159', 'MLB6646381324', 'Filtro Linha Protetor Surto DPS Iclamper 8 Tomadas'],
  ['VTK000846', 'MLB7009187518', 'Filtro De Linha DPS Clamper Energia 8 Tomadas Transparente'],
  ['VTK000743', 'MLB6573096876', 'Calculadora De Mesa Casio DX 12B 12 Digitos Preta'],
  ['VTK006493', 'MLB7149375450', 'Cafeteira Eletrica Arno Filtro Semi Automatica Preta 220V'],
  ['VTK006419', 'MLB7087438514', 'Cafeteira Arno Preferita 750ml Jarra De Vidro 220V'],
  ['VTK000235', 'MLB7076602922', 'Descanso Suporte Para 6 Microfones ASK M6'],
  ['VTK002507', 'MLB7149376582', 'Expositor Telescopico Para Teclado ASK Preto Par'],
  ['VTK000767', 'MLB7087125024', 'Cabo Microfone Tiaflex 22AWG OFHC Rolo 100m Preto'],
  ['VTK012537', 'MLB4880565639', 'Alto Falante Woofer 10 Pol 150W RMS 8 Ohms Attack'],
  ['VTK018988', 'MLB4937405043', 'Alto Falante Eros E908 Trio Evo 8 450W RMS 8 Ohms'],
  ['VTK000131', 'MLB7236458150', 'Balanca Digital Domestica Brasfort 5Kg Para Alimentos'],
  ['VTK006362', 'MLB6573107140', 'Ferro De Solda Maxx 130W 127V Brasfort Profissional'],
  ['VTK006361', 'MLB6573107760', 'Ferro De Solda Maxx 130W 220V Brasfort Profissional'],
  ['VTK001244', 'MLB6573085652', 'Ferro De Solda Maxx 180W 220V Brasfort Profissional'],
  ['VTK000932', 'MLB6573086292', 'Ferro De Solda Maxx 90W 220V Brasfort Profissional'],
  ['VTK017352', 'MLB7313273030', 'Base Cooler Notebook Evus BPN 03 2 Fans Led Azul USB'],
  ['VTK012013', 'MLB7111661964', 'Conector P10 TS Metal Niquel Wireconex WC 244 10 Unidades'],
  ['VTK012124', 'MLB7330116996', 'Conector P10 Em L Mono Wireconex 10 Unidades Prateado'],
].map(([sku, mlItemId, familyName]) => ({ sku, mlItemId, familyName }));

const KNOWN_FIELD_NOT_UPDATABLE = new Set([
  'MLB7149339312',
  'MLB7317384260',
  'MLB4898641383',
  'MLB7381238898',
  'MLB7210717982',
  'MLB7330396528',
]);

const QUALITY_60_OVERRIDE = new Set(['MLB4894821149']);

function normalizeFamilyName(value) {
  return String(value || '').trim().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function buildFamilyNameUpdate(itemId, familyName) {
  return {
    pathname: `/items/${encodeURIComponent(itemId)}/family_name`,
    body: { family_name: familyName },
  };
}

module.exports = {
  KNOWN_FIELD_NOT_UPDATABLE,
  QUALITY_60_OVERRIDE,
  ROWS,
  TITLE_PATTERN,
  buildFamilyNameUpdate,
  normalizeFamilyName,
};
