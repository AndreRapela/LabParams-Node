// __tests__/importacao.dadosreais.test.js
const ImportacaoModel = require('../models/ImportacaoModel');
const fs = require('fs');
const csv = require('csv-parser');
const path = require('path');

jest.mock('../config/database', () => ({
  connect: jest.fn(),
  query: jest.fn()
}));

const pool = require('../config/database');

describe('Teste de Importação - Arquivo dadosimportacao.csv', () => {
  
  const arquivoTeste = path.join(__dirname, 'fixtures/dadosimportacao.csv');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('deve ler o arquivo dadosimportacao.csv e validar os dados', async () => {
    // Mock do client para transação
    const mockClient = {
      query: jest.fn(),
      release: jest.fn()
    };

    pool.connect = jest.fn().mockResolvedValue(mockClient);

    // Mock das consultas ao banco de dados
    pool.query.mockImplementation((query, params) => {
      // Mock para buscar amostra
      if (query.includes('FROM amostra')) {
        return Promise.resolve({
          rowCount: 1,
          rows: [{
            id: 1,
            codigo_amostra: params[0],
            numero_da_amostra: params[1],
            matriz_id: 1,
            matriz_nome: 'Água Bruta'
          }]
        });
      }
      
      // Mock para buscar matriz
      if (query.includes('FROM matriz')) {
        return Promise.resolve({
          rowCount: 1,
          rows: [{
            id: 1,
            nome: 'Água Bruta'
          }]
        });
      }
      
      // Mock para buscar legislação
      if (query.includes('FROM legislacao')) {
        return Promise.resolve({
          rowCount: 1,
          rows: [{
            id: 1,
            nome: 'Resolução CONAMA nº 357/2005',
            sigla: 'CONAMA nº 357/2005'
          }]
        });
      }
      
      // Mock para buscar parâmetro
      if (query.includes('FROM parametro')) {
        return Promise.resolve({
          rowCount: 1,
          rows: [{
            id: 1,
            nome: 'Clorito',
            unidade_medida: 'mg/L',
            tipo: 'Físico-Químico'
          }]
        });
      }

      return Promise.resolve({ rowCount: 0, rows: [] });
    });

    // Mock do client.query para transação
    mockClient.query.mockImplementation((query) => {
      if (query === 'BEGIN' || query === 'COMMIT') {
        return Promise.resolve();
      }
      if (query.includes('INSERT INTO resultado_analise')) {
        return Promise.resolve({
          rowCount: 1,
          rows: [{ id: 1 }]
        });
      }
      return Promise.resolve({ rowCount: 0, rows: [] });
    });

    // Ler o arquivo CSV
    const linhas = [];
    await new Promise((resolve, reject) => {
      fs.createReadStream(arquivoTeste)
        .pipe(csv())
        .on('data', (linha) => linhas.push(linha))
        .on('end', resolve)
        .on('error', reject);
    });

    console.log('\n=== TESTE DO ARQUIVO dadosimportacao.csv ===\n');
    console.log(`Total de linhas lidas: ${linhas.length}`);
    
    expect(linhas.length).toBe(1);

    // Exibir os dados lidos
    console.log('\nDados do arquivo:');
    console.log(JSON.stringify(linhas[0], null, 2));

    // Validar a linha
    const resultado = await ImportacaoModel.validarLinha(linhas[0], 2);

    console.log('\nResultado da Validação:');
    console.log(`Status: ${resultado.sucesso ? 'SUCESSO' : 'FALHOU'}`);
    
    if (resultado.sucesso) {
      console.log('\nDados validados:');
      console.log(`  - Código da Amostra: ${resultado.dados.codigodaamostra}`);
      console.log(`  - Número da Amostra: ${resultado.dados.numerodaamostra}`);
      console.log(`  - Parâmetro ID: ${resultado.dados.parametro_id}`);
      console.log(`  - Valor Medido: ${resultado.dados.valor_medido}`);
      console.log(`  - Data de Coleta: ${resultado.dados.datacoleta}`);
      console.log(`  - Matriz: ${resultado.dados.matriz}`);
      console.log(`  - Legislação: ${resultado.dados.legislacao}`);
      
      // Verificar se a data foi interpretada corretamente
      const dataColeta = new Date(resultado.dados.datacoleta);
      const ano = dataColeta.getFullYear();
      if (ano < 2000) {
        console.log(`\n  AVISO: Data interpretada como ano ${ano}. A data "11/04/26" foi interpretada como 1926.`);
        console.log(`  Recomendação: Use formato completo "11/04/2026" para datas futuras.`);
      }
    } else {
      console.log(`Erro: ${resultado.erro}`);
    }

    console.log('\n===========================================\n');

    expect(resultado.sucesso).toBe(true);
    expect(resultado.dados.valor_medido).toBe(79.88);
    expect(resultado.dados.codigodaamostra).toBe('AMOSTRA-EFL-001');
    expect(resultado.dados.numerodaamostra).toBe('NA-20251104-001');
    expect(resultado.dados.parametro_id).toBe(1);
  });

  test('deve processar e inserir os dados do arquivo no banco', async () => {
    // Mock do client para transação
    const mockClient = {
      query: jest.fn(),
      release: jest.fn()
    };

    pool.connect = jest.fn().mockResolvedValue(mockClient);

    // Mock das consultas ao banco de dados
    pool.query.mockImplementation((query, params) => {
      if (query.includes('FROM amostra')) {
        return Promise.resolve({
          rowCount: 1,
          rows: [{
            id: 1,
            codigo_amostra: params[0],
            numero_da_amostra: params[1],
            matriz_id: 1,
            matriz_nome: 'Água Bruta'
          }]
        });
      }
      
      if (query.includes('FROM matriz')) {
        return Promise.resolve({
          rowCount: 1,
          rows: [{ id: 1, nome: 'Água Bruta' }]
        });
      }
      
      if (query.includes('FROM legislacao')) {
        return Promise.resolve({
          rowCount: 1,
          rows: [{
            id: 1,
            nome: 'Resolução CONAMA nº 357/2005',
            sigla: 'CONAMA nº 357/2005'
          }]
        });
      }
      
      if (query.includes('FROM parametro')) {
        return Promise.resolve({
          rowCount: 1,
          rows: [{
            id: 1,
            nome: 'Clorito',
            unidade_medida: 'mg/L',
            tipo: 'Físico-Químico'
          }]
        });
      }

      return Promise.resolve({ rowCount: 0, rows: [] });
    });

    mockClient.query.mockImplementation((query) => {
      if (query === 'BEGIN' || query === 'COMMIT') {
        return Promise.resolve();
      }
      if (query.includes('INSERT INTO resultado_analise')) {
        return Promise.resolve({
          rowCount: 1,
          rows: [{ id: 1 }]
        });
      }
      return Promise.resolve({ rowCount: 0, rows: [] });
    });

    // Ler o arquivo CSV
    const linhas = [];
    await new Promise((resolve, reject) => {
      fs.createReadStream(arquivoTeste)
        .pipe(csv())
        .on('data', (linha) => linhas.push(linha))
        .on('end', resolve)
        .on('error', reject);
    });

    // Validar e coletar dados válidos
    const dadosValidos = [];
    const errosValidacao = [];

    for (let i = 0; i < linhas.length; i++) {
      const resultado = await ImportacaoModel.validarLinha(linhas[i], i + 2);
      
      if (resultado.sucesso) {
        dadosValidos.push(resultado.dados);
      } else {
        errosValidacao.push({
          linha: i + 2,
          dados: linhas[i],
          erro: resultado.erro
        });
      }
    }

    // Inserir no banco
    const resultadoInsercao = await ImportacaoModel.inserirLote(dadosValidos);

    console.log('\nResumo do Processamento:');
    console.log(`Total de linhas: ${linhas.length}`);
    console.log(`Linhas validadas: ${dadosValidos.length}`);
    console.log(`Linhas com erro de validação: ${errosValidacao.length}`);
    console.log(`Inseridas no banco: ${resultadoInsercao.inseridos}`);
    console.log(`Erros de inserção: ${resultadoInsercao.erros.length}`);
    console.log(`Taxa de sucesso: ${(resultadoInsercao.inseridos / linhas.length * 100).toFixed(2)}%`);

    expect(linhas.length).toBe(1);
    expect(dadosValidos.length).toBe(1);
    expect(errosValidacao.length).toBe(0);
    expect(resultadoInsercao.inseridos).toBe(1);
    expect(resultadoInsercao.erros.length).toBe(0);

    console.log('\nTESTE CONCLUÍDO: Dados do arquivo dadosimportacao.csv processados com sucesso!\n');
  });

  test('deve verificar estrutura do arquivo CSV', () => {
    const conteudoCSV = fs.readFileSync(arquivoTeste, 'utf-8');
    const linhas = conteudoCSV.split('\n').filter(linha => linha.trim() !== '');
    
    console.log('\nEstrutura do Arquivo CSV:');
    console.log(`Total de linhas (incluindo cabeçalho): ${linhas.length}`);
    console.log(`Cabeçalho: ${linhas[0]}`);
    console.log('\nDados:');
    for (let i = 1; i < linhas.length; i++) {
      console.log(`Linha ${i}: ${linhas[i]}`);
    }

    // Verificar estrutura
    expect(linhas.length).toBe(2); // 1 cabeçalho + 1 linha de dados
    expect(linhas[0]).toContain('valor_medido');
    expect(linhas[0]).toContain('codigodaamostra');
    expect(linhas[0]).toContain('numerodaamostra');
    expect(linhas[0]).toContain('parametro');
    expect(linhas[0]).toContain('datacoleta');
    expect(linhas[0]).toContain('matriz');
    expect(linhas[0]).toContain('legislacao');
  });
});
