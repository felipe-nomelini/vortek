/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const auditPath = path.resolve('reports/ml-repair-2026-08-03/reusable-live-audit.json');
const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));

const titles = {
  VTK000059: 'Kit 6 Lubrificantes WD-40 Multiuso Spray 300ml',
  VTK000416: 'Kit 10 Álcool Isopropílico Implastec 500ml 99,8%',
  VTK000270: 'Bateria Selada Unipower UP1270SEG 12V 6,4Ah VRLA',
  VTK000497: 'Kit 12 Limpa Contato Implastec Contactec Spray 350ml',
  VTK001256: 'Kit 6 Copos Philips Walita RI2110 Leitosos Originais',
  VTK000923: 'Cadeira ThunderX3 Solo360 Loft Grafite 150kg',
  VTK000814: 'Cadeira ThunderX3 EAZE Loft Preta Tecido 150kg',
  VTK000870: 'Cadeira ThunderX3 CORE Smart Modern Vermelha 150kg',
  VTK001881: 'Kit 10 Álcool Isopropílico Implastec 500ml 99,8%',
  VTK018587: 'Auxiliar Partida Thork 6310 7500mAh 12V Com Case',
  VTK001030: 'Inversor Hayonik MSW2103 300W 24V Para 127V USB',
  VTK001251: 'Par Caixas Frahm HS5 Outdoor 120W 8 Ohms Brancas',
  VTK002586: 'Kit 30 Álcool Isopropílico Implastec 110ml 99,8%',
  VTK000636: 'Ar-Condicionado Agratto Liv Top Inverter 12000 BTU 220V',
  VTK001235: 'Kit 6 Assadeiras Rochedo Dura+ 37,3x25,4cm Vermelhas',
  VTK000585: 'Antena Externa Aquário LU-30 UHF 14dBi 30 Elementos',
  VTK025467: 'Kit 12 Baterias Auditivas Duracell 13 2 Cartelas',
  VTK025468: 'Kit 12 Baterias Auditivas Duracell 675 2 Cartelas',
  VTK025466: 'Kit 12 Baterias Auditivas Duracell 10 2 Cartelas',
  VTK016187: 'Kit 54 Pilhas Alcalinas AA Panasonic 9 Cartelas',
};

const descriptions = {
  VTK000059: `KIT 6 LUBRIFICANTES WD-40 MULTIUSO 300ML

Conjunto com seis latas de WD-40 Produto Multiusos de 300 ml. Indicado para manutenção doméstica, automotiva e profissional.

PRINCIPAIS FUNÇÕES
- Elimina umidade em componentes elétricos e eletrônicos
- Lubrifica e ajuda a destravar mecanismos de baixo atrito
- Ajuda a prevenir ferrugem em peças metálicas e cromadas
- Pode ser usado em dobradiças, ferramentas, correntes, porcas e parafusos
- Não conduz eletricidade até 12.000 V

CONTEÚDO DA EMBALAGEM
- 6 latas WD-40 Produto Multiusos
- Conteúdo de cada lata: 300 ml

CUIDADOS
- Produto inflamável
- Use em local ventilado e conforme as instruções da embalagem
- Mantenha longe de calor, chamas e do alcance de crianças

SKU: VTK000059`,
  VTK000416: `KIT 10 ÁLCOOIS ISOPROPÍLICOS IMPLASTEC 500ML

Conjunto com dez frascos de álcool isopropílico Implastec com pureza de 99,8%. Indicado para limpeza técnica de componentes eletrônicos e placas de circuito impresso.

CARACTERÍSTICAS
- Marca: Implastec
- Princípio ativo: isopropanol
- Pureza: 99,8%
- Conteúdo por frasco: 500 ml
- Quantidade: 10 frascos
- Cor: incolor
- Ação desengordurante e alta capacidade de solvência

CONTEÚDO DA EMBALAGEM
- 10 frascos de álcool isopropílico Implastec 500 ml

CUIDADOS
- Produto inflamável
- Use máscara, óculos de proteção e mantenha o ambiente ventilado
- Mantenha o recipiente fechado, em local fresco e longe de fontes de ignição

SKU: VTK000416`,
  VTK000270: `BATERIA SELADA UNIPOWER UP1270SEG 12V 6,4AH

Bateria estacionária selada VRLA indicada para aplicações compatíveis de energia de reserva, como alarmes, iluminação de emergência, nobreaks e sistemas de segurança.

ESPECIFICAÇÕES
- Marca: Unipower
- Modelo: UP1270SEG
- Tensão nominal: 12 V
- Capacidade: 6,4 Ah
- Tecnologia: VRLA chumbo-ácido selada
- Dimensões aproximadas: 15 x 10 x 6,5 cm
- Peso bruto aproximado: 2,07 kg

CONTEÚDO DA EMBALAGEM
- 1 bateria estacionária Unipower UP1270SEG

Confirme tensão, capacidade, dimensões e terminais exigidos pelo equipamento antes da compra.

SKU: VTK000270`,
  VTK000497: `KIT 12 LIMPA CONTATO IMPLASTEC CONTACTEC 350ML

Conjunto com doze aerossóis Contactec para limpeza de circuitos e mecanismos eletroeletrônicos desenergizados e em temperatura ambiente.

CARACTERÍSTICAS
- Marca: Implastec
- Linha: Contactec
- Conteúdo por lata: 350 ml
- Quantidade: 12 latas
- Aplicação em circuitos elétricos e eletrônicos desligados
- Limpeza rápida sem necessidade de desmontagem completa

CONTEÚDO DA EMBALAGEM
- 12 latas de limpa contato Implastec Contactec 350 ml

CUIDADOS
- Produto extremamente inflamável
- Não aplique em equipamentos energizados, superfícies quentes ou chamas
- Use máscara e óculos de proteção em local ventilado
- Armazene abaixo de 50 °C e não perfure a embalagem

SKU: VTK000497`,
  VTK001881: `KIT 10 ÁLCOOIS ISOPROPÍLICOS IMPLASTEC 500ML

Conjunto com dez frascos de álcool isopropílico Implastec com pureza de 99,8%, indicado para limpeza técnica e aplicações compatíveis com isopropanol.

CARACTERÍSTICAS
- Marca: Implastec
- Princípio ativo: isopropanol
- Pureza: 99,8%
- Conteúdo por frasco: 500 ml
- Quantidade: 10 frascos
- Cor: incolor

CONTEÚDO DA EMBALAGEM
- 10 frascos de álcool isopropílico Implastec 500 ml

CUIDADOS
- Produto inflamável
- Use máscara, óculos de proteção e mantenha o ambiente ventilado
- Mantenha o recipiente fechado, em local fresco e longe de fontes de ignição

SKU: VTK001881`,
  VTK018587: `AUXILIAR DE PARTIDA THORK 6310 7500MAH

Auxiliar de partida portátil para veículos 12 V, com acumulador de polímero de lítio, saída USB e lanterna integrada.

ESPECIFICAÇÕES
- Marca: Thork by Tech One
- Referência: 6310
- Capacidade: 7.500 mAh
- Tensão de operação e partida: 12 V DC
- Amperagem de pico: 250 a 350 A
- Entrada USB-C: 5 a 9 V DC / 2,1 A
- Saída USB: 5 V DC / 2,1 A
- Tempo aproximado de recarga: 4 a 12 horas
- Temperatura de operação: -20 °C a 50 °C
- Indicador de carga com quatro LEDs
- Lanterna com modos contínuo, pisca e SOS

CONTEÚDO DA EMBALAGEM
- 1 auxiliar de partida Thork 6310
- 1 garra inteligente para conexão à bateria
- 1 case com zíper

Leia as instruções antes do uso e respeite a polaridade indicada.

SKU: VTK018587`,
  VTK001030: `INVERSOR HAYONIK MSW2103 300W 24V PARA 127V

Inversor de onda modificada para converter alimentação 24 V DC em saída 127 V AC. Indicado para aplicações móveis compatíveis, como motorhomes, trailers, embarcações e veículos de serviço.

ESPECIFICAÇÕES
- Marca: Hayonik
- Modelo: MSW2103
- Potência contínua: 300 W
- Potência de pico: 600 W
- Entrada nominal: 24 V DC
- Faixa de funcionamento: 22 a 32 V DC
- Saída: 127 V AC
- Frequência: 60 Hz
- Forma de onda: senoidal modificada
- Eficiência máxima: igual ou superior a 85%
- Saída USB: 5 V / 2,1 A

PROTEÇÕES
- Sobrecarga
- Superaquecimento
- Curto-circuito
- Subtensão e sobretensão

Não é indicado para instalações solares. Confirme a potência e a tensão dos aparelhos antes do uso.

SKU: VTK001030`,
  VTK002586: `KIT 30 ÁLCOOIS ISOPROPÍLICOS IMPLASTEC 110ML

Caixa com trinta frascos de álcool isopropílico Implastec com pureza de 99,8%, indicado para limpeza técnica e aplicações compatíveis com isopropanol.

CARACTERÍSTICAS
- Marca: Implastec
- Princípio ativo: isopropanol
- Pureza: 99,8%
- Conteúdo por frasco: 110 ml
- Quantidade: 30 frascos
- Cor: incolor

CONTEÚDO DA EMBALAGEM
- 30 frascos de álcool isopropílico Implastec 110 ml

CUIDADOS
- Produto inflamável
- Use máscara, óculos de proteção e mantenha o ambiente ventilado
- Mantenha o recipiente fechado, em local fresco e longe de fontes de ignição

SKU: VTK002586`,
  VTK000636: `AR-CONDICIONADO AGRATTO LIV TOP INVERTER 12.000 BTU 220V

Ar-condicionado Split Agratto Liv Top com tecnologia Inverter, indicado para climatização residencial em instalação elétrica 220 V.

CARACTERÍSTICAS
- Marca: Agratto
- Linha: Liv Top
- Capacidade: 12.000 BTU/h
- Tensão: 220 V
- Tecnologia Inverter
- Função ECO
- Serpentina de cobre
- Painel com iluminação LED
- Cor: branca

CONTEÚDO DA EMBALAGEM
- 1 unidade interna evaporadora
- 1 unidade externa condensadora
- Controle remoto e documentação do fabricante

O produto é enviado em duas caixas. A instalação deve ser feita por profissional qualificado e os acessórios de instalação devem ser conferidos conforme o local.

SKU: VTK000636`,
  VTK000585: `ANTENA EXTERNA AQUÁRIO LU-30 30 ELEMENTOS

Antena log periódica para recepção de sinal de TV UHF e HDTV. Possui 30 elementos, ganho de 14 dBi e instalação externa.

ESPECIFICAÇÕES
- Marca: Aquário
- Modelo: LU-30
- Banda: UHF
- Frequência: 470 a 698 MHz
- Ganho: 14 dBi
- Impedância: 75 ohms
- Polarização: horizontal
- Conector: F fêmea dianteiro
- Quantidade de elementos: 30
- Dimensões do produto: 605 x 320 x 25 mm
- Peso do produto: 281 g

CONTEÚDO DA EMBALAGEM
- 1 antena externa Aquário LU-30
- Manual de instalação
- Acessórios de fixação

Não acompanha mastro.

SKU: VTK000585`,
  VTK025467: `KIT 12 BATERIAS AUDITIVAS DURACELL 13

Kit formado por duas cartelas originais Duracell, cada uma com seis baterias auditivas tamanho 13.

CARACTERÍSTICAS
- Marca: Duracell
- Modelo e tamanho: 13
- Formato: botão
- Cor de identificação: laranja
- Não recarregáveis
- Quantidade total: 12 unidades

CONTEÚDO DA EMBALAGEM
- 2 cartelas com 6 baterias cada
- Total: 12 baterias auditivas

Confirme o tamanho utilizado no aparelho auditivo antes da compra.

SKU: VTK025467`,
  VTK025468: `KIT 12 BATERIAS AUDITIVAS DURACELL 675

Kit formado por duas cartelas originais Duracell, cada uma com seis baterias auditivas tamanho 675.

CARACTERÍSTICAS
- Marca: Duracell
- Modelo e tamanho: 675
- Formato: botão
- Cor de identificação: azul
- Não recarregáveis
- Quantidade total: 12 unidades

CONTEÚDO DA EMBALAGEM
- 2 cartelas com 6 baterias cada
- Total: 12 baterias auditivas

Confirme o tamanho utilizado no aparelho auditivo antes da compra.

SKU: VTK025468`,
  VTK025466: `KIT 12 BATERIAS AUDITIVAS DURACELL 10

Kit formado por duas cartelas originais Duracell, cada uma com seis baterias auditivas tamanho 10.

CARACTERÍSTICAS
- Marca: Duracell
- Modelo e tamanho: 10
- Formato: botão
- Não recarregáveis
- Quantidade total: 12 unidades

CONTEÚDO DA EMBALAGEM
- 2 cartelas com 6 baterias cada
- Total: 12 baterias auditivas

Confirme o tamanho utilizado no aparelho auditivo antes da compra.

SKU: VTK025466`,
  VTK016187: `KIT 54 PILHAS ALCALINAS AA PANASONIC

Kit com 54 pilhas alcalinas AA Panasonic, distribuídas em nove cartelas com seis unidades cada.

CARACTERÍSTICAS
- Marca: Panasonic
- Tamanho: AA
- Tecnologia: alcalina
- Formato de venda: kit
- Quantidade de cartelas: 9
- Unidades por cartela: 6
- Quantidade total: 54 pilhas

CONTEÚDO DA EMBALAGEM
- 9 cartelas de pilhas alcalinas AA Panasonic
- Total: 54 pilhas

Confira o tamanho e a quantidade antes da compra.

SKU: VTK016187`,
};

function packageAttributes(product, sku) {
  if (sku === 'VTK018587') return [];
  return [
    ['SELLER_PACKAGE_HEIGHT', `${product.altura} cm`],
    ['SELLER_PACKAGE_WIDTH', `${product.largura} cm`],
    ['SELLER_PACKAGE_LENGTH', `${product.profundidade} cm`],
    ['SELLER_PACKAGE_WEIGHT', `${Math.round(Number(product.peso_bruto) * 1000)} g`],
  ].filter(([, value]) => !value.startsWith('0 ')).map(([id, value_name]) => ({ id, value_name }));
}

const corrections = audit.rows
  .filter((row) => row.live && row.live.catalogListing !== true)
  .map((row) => {
    const isUserProduct = (row.live.tags || []).includes('user_product_listing');
    const attributes = [
      { id: 'SELLER_SKU', value_name: row.sku },
      ...packageAttributes(row.product, row.sku),
    ];
    if (row.sku === 'VTK000497') {
      attributes.push(
        { id: 'SALE_FORMAT', value_name: 'Kit' },
        { id: 'UNITS_PER_PACK', value_name: '12' },
      );
    }
    if (row.sku === 'VTK001235') {
      attributes.push(
        { id: 'BRAND', value_name: 'Rochedo' },
        { id: 'SALE_FORMAT', value_name: 'Kit' },
        { id: 'UNITS_PER_PACK', value_name: '6' },
      );
    }
    if (row.sku === 'VTK016187') {
      attributes.push(
        { id: 'SALE_FORMAT', value_name: 'Kit' },
        { id: 'UNITS_PER_PACK', value_name: '54' },
      );
    }
    return {
      ml_item_id: row.live.id,
      sku: row.sku,
      ...(isUserProduct ? { family_name: titles[row.sku] || row.live.familyName } : { title: titles[row.sku] || row.live.title }),
      description: descriptions[row.sku] || row.description,
      attributes,
    };
  });

const outputPath = path.resolve('reports/ml-repair-2026-08-03/reusable-corrections.json');
fs.writeFileSync(outputPath, `${JSON.stringify({ generated_at: new Date().toISOString(), corrections }, null, 2)}\n`);
console.log(JSON.stringify({ total: corrections.length, outputPath }, null, 2));
