const TITLE_PATTERN = /^[a-zA-Z0-9 ]+$/;
const UNSUPPORTED_CLAIMS_PATTERN = /\b(?:NF|Nova|Original|Premium|Qualidade)\b/gi;

const SOURCE_ROWS = [
  ['VTK006419', 'MLB4981702293', 'Cafeteira Arno Preferita Inox 750ml 220V Original NF'],
  ['VTK006488', 'MLB6563432358', 'Caixa De Som Philips TAX400 Boombox Bluetooth Original NF'],
  ['VTK006518', 'MLB6563432022', 'Caixa De Som Sumay Goldbox 120W Bluetooth TWS Original NF'],
  ['VTK000783', 'MLB7096943296', 'Cadeira Gamer ThunderX3 TGC12 Azul Ergonomica Premium NF'],
  ['VTK012279', 'MLB7149374856', 'Alto Falante 8 Pol 150W RMS 8 Ohms Profissional Attack NF'],
  ['VTK001128', 'MLB4585881313', 'Amplificador Laney Ministack B Iron 6W Bluetooth Premium'],
  ['VTK006554', 'MLB6563495210', 'Caixa De Som Sumay Fire 1000W Bluetooth Portatil Nova NF'],
  ['VTK006007', 'MLB6618198782', 'Amplificador Para Baixo Laney DB PRE Preto Original NF'],
  ['VTK021855', 'MLB7332768248', 'Caixa Som Vazia 2 Alto Falantes 15 Pol Turbo Duto Nova'],
  ['VTK016151', 'MLB7184760132', 'Pilha AA Alcalina Panasonic 40 Unidades Original NF'],
  ['VTK017264', 'MLB4937404067', 'Alto Falante 6 Pol Pioneer Triaxial 120W Par Original NF'],
  ['VTK012768', 'MLB4880632867', 'Alto Falante 8 Pol 400W RMS Attack Woofer Original NF'],
  ['VTK001132', 'MLB6573246676', 'Amplificador Laney Ministack Lion 6W Bluetooth Azul NF'],
  ['VTK012552', 'MLB4857540461', 'Caixa De Som Edifier R980T Monitor De Referencia Nova NF'],
  ['VTK012638', 'MLB7111654940', 'Amplificador Para Guitarra 10 Pol 40W Vosstorm Original'],
  ['VTK012706', 'MLB7111654764', 'Amplificador Guitarra 12 Pol 100W Vosstorm GX 12 Nova'],
  ['VTK001382', 'MLB4842097755', 'Cafeteira Arno Dolce Gusto Genio S Basic Branca 127V'],
  ['VTK001026', 'MLB4801295297', 'Antena Externa TV 2 em 1 UHF HD Cabo Full HD DTV1500'],
  ['VTK012644', 'MLB4935792261', 'Caixa De Som Passiva Attack VSC83 Cinza Escuro Premium'],
  ['VTK006594', 'MLB4620396985', 'Alicate De Crimpar RJ45 RJ12 RJ11 Storm Profissional'],
  ['VTK001790', 'MLB4800933249', 'Amplificador Guitarra Yamaha GA15II 15W 127V Preto NF'],
  ['VTK000733', 'MLB6573086770', 'Amplificador Frahm Slim 1000 G5 40W RMS Bivolt Original'],
  ['VTK000165', 'MLB7316879806', 'Cadeira Gamer Reclinavel ThunderX3 TGC12 Preta Vermelha'],
  ['VTK000212', 'MLB4846536875', 'Fogao Eletrico Agratto 1 Prato 1500W 220V Cinza Nova'],
  ['VTK019116', 'MLB4937519869', 'Esmerilhadeira Vonder EAV 860N 860W 4 1 2 127V Nova NF'],
  ['VTK006572', 'MLB4850157951', 'Calculadora De Mesa Casio MS20YC 12 Digitos Preta Nova'],
  ['VTK012659', 'MLB4882821579', 'Calculadora Bobina Procalc LP45 Impressao 12 Digitos'],
  ['VTK012651', 'MLB4857635575', 'Calculadora De Mesa Elgin 12 Digitos Verde MV4126 Nova'],
  ['VTK006493', 'MLB4857495481', 'Cafeteira Arno Classic CTC1 600ml Preta 220V Original'],
  ['VTK000395', 'MLB7193721894', 'Cadeira Gamer ThunderX3 Yama1 Vermelha Ergonomica Nova'],
  ['VTK009762', 'MLB4800946713', 'Bateria Acustica Prata NY First Com Banco Premium NF'],
  ['VTK000928', 'MLB6573097258', 'Calculadora Cientifica Casio Classwiz Rosa Original NF'],
  ['VTK006451', 'MLB4857485559', 'Ferro A Seco Arno Drygliss FS31 1100W Preto 220V Nova'],
  ['VTK000974', 'MLB6565317276', 'Air Cooler Fortrek AC15 150W TDP Gamer Original NF'],
  ['VTK005557', 'MLB7111657520', 'Alto Falante 4 Pol Leson JB Flex 110W Par Preto NF'],
  ['VTK001019', 'MLB4790689477', 'Amplificador Violao Laney LA30D Marrom 30W 127V Nova'],
  ['VTK005922', 'MLB6573143552', 'Bocal Para Trompete Yamaha TR 16C4 Standard Original'],
  ['VTK000877', 'MLB4582559287', 'Caixa De Som Aquario Hype 480W Bluetooth Bivolt Nova'],
  ['VTK006419', 'MLB4857481873', 'Cafeteira Dolce Gusto Genio S Basic Branca 220V Nova'],
  ['VTK012485', 'MLB4987961323', 'Caixa De Som Edifier R1280T Madeira Bivolt Premium NF'],
  ['VTK012672', 'MLB4857539501', 'Amplificador De Potencia Mark Audio MK2400 400W RMS NF'],
  ['VTK006436', 'MLB4857485445', 'Espremedor De Frutas Arno Express 750ml Preto 127V NF'],
  ['VTK012385', 'MLB7149331936', 'Caixa Multiuso Amplificada 15W Voxstorm VSU100 USB Nova NF'],
  ['VTK012513', 'MLB4857539465', 'Amplificador De Potencia Mark Audio MK4800 800W RMS Nova NF'],
  ['VTK012784', 'MLB7145210472', 'Amplificador De Potencia Mark Audio MK1200 200W RMS Nova NF'],
  ['VTK012557', 'MLB7111654744', 'Amplificador De Potencia Mark Audio MK3600 600W RMS Nova NF'],
  ['VTK001076', 'MLB4857481641', 'Cadeira Gamer ThunderX3 Solo 360 Loft Cinza Original NF'],
  ['VTK012279', 'MLB4857541269', 'Alto Falante 8 Pol 150W RMS 8 Ohms Profissional Attack NF'],
  ['VTK017609', 'MLB4937398015', 'Amplificador Digital Stetsom 900W 4 Canais 2 Ohms Original'],
  ['VTK018921', 'MLB7247345748', 'Alicate De Crimpar Com Testador HK305 Hikari RJ45 Nova NF'],
  ['VTK012514', 'MLB7149334650', 'Caixa Multiuso Voxstorm 20W Bluetooth USB Portatil Nova NF'],
  ['VTK002333', 'MLB7087408614', 'Bateria Selada 12V 7Ah Unipower VRLA F187 Original NF'],
  ['VTK012637', 'MLB7111643110', 'Amplificador Para Guitarra 8 Pol 25W Vosstorm GX 8 Nova NF'],
  ['VTK000132', 'MLB7009927448', 'Bateria Estacionaria Selada 12V 9Ah Unipower Original NF'],
  ['VTK012554', 'MLB4857541327', 'Alto Falante 6 Pol 150W RMS 8 Ohms Profissional Attack NF'],
  ['VTK012782', 'MLB7127532580', 'Caixa Subwoofer Ativo Mark Audio 1000W 18 Pol Bivolt NF'],
  ['VTK001086', 'MLB4857485847', 'Estante De Canto Multivisao 5 Prateleiras Branca Premium'],
  ['VTK012824', 'MLB4857540439', 'Fritadeira Air Fryer Forno Digital Agratto 12L 127V Nova'],
  ['VTK012247', 'MLB7111657378', 'Pilha Palito AAA Duracell Alcalina 16 Unidades Original'],
  ['VTK012555', 'MLB7111642276', 'Alto Falante Woofer 12 Pol 1300W 2 Ohms Attack Original'],
  ['VTK012393', 'MLB7111708684', 'Cabo De Audio P2 Para P2 3 Metros Wireconex Original NF'],
  ['VTK012168', 'MLB4857638463', 'Cabo De Audio 2 RCA Para P10 Mono Niquel 1 8m MXT Nova'],
  ['VTK006482', 'MLB4842215155', 'Cafeteira Arno Preferita 750ml Vidro 127V Original NF'],
  ['VTK006079', 'MLB4585804329', 'Apoio Para Pes Reliza Robust Ajustavel Preto Premium NF'],
  ['VTK006330', 'MLB7111544270', 'Ar Condicionado Split Agratto Fit Top 12000 Btus 220V NF'],
  ['VTK000636', 'MLB7095602252', 'Ar Condicionado Agratto Inverter Liv Top 12000 Btus 220V'],
  ['VTK017475', 'MLB4947942215', 'Cabo De Rede CAT6 Azul Rolo 305 Metros Qualidade Premium'],
  ['VTK001237', 'MLB7087157020', 'Amplificador Frahm Slim 4500 Optical 4 Canais Bivolt NF'],
  ['VTK006470', 'MLB4842214881', 'Cafeteira Arno Perfectta 600ml Jarra De Vidro 127V Nova'],
  ['VTK006496', 'MLB7087427092', 'Amplificador Frahm Slim 2000 G6 120W Bluetooth Bivolt NF'],
  ['VTK001460', 'MLB4842111899', 'Amplificador Frahm Slim 4100 Optical G5 300W Preto Nova'],
  ['VTK012008', 'MLB7111652080', 'Cabo De Audio P2 P10 3 Metros Wireconex Original Nova NF'],
];

function sanitizeFamilyName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(UNSUPPORTED_CLAIMS_PATTERN, ' ')
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ROWS = SOURCE_ROWS.map(([sku, mlItemId, proposedTitle]) => ({
  sku,
  mlItemId,
  proposedTitle,
  familyName: sanitizeFamilyName(proposedTitle),
}));

module.exports = {
  ROWS,
  TITLE_PATTERN,
  UNSUPPORTED_CLAIMS_PATTERN,
  sanitizeFamilyName,
};
