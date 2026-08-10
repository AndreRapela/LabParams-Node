// __tests__/importacao.3linhas.test.js
const ImportacaoModel = require('../models/ImportacaoModel');
const fs = require('fs');
const csv = require('csv-parser');
const path = require('path');

// Mock do pool
jest.mock('../config/database', () => ({
  connect: jest.fn(),
  query: jest.fn()
}));
jest.mock('../models/AuditLogModel', () => ({ record: jest.fn().mockResolvedValue(null) }));
jest.mock('../models/AmostraModel', () => ({ applyStatusTransition: jest.fn().mockResolvedValue({}) }));

const pool = require('../config/database');

describe('Teste de Importação - 3 Linhas da Planilha', () => {
  
  const arquivoTeste = path.join(__dirname, 'fixtures/teste_3_linhas.csv');
  let logSpy;

  beforeAll(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterAll(() => {
    logSpy.mockRestore();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('deve validar as 3 linhas do arquivo CSV', async () => {
    // Mock das consultas ao banco de dados
    pool.query.mockImplementation((query, params) => {
      // Mock para buscar amostra
      if (query.includes('FROM amostra')) {
        const codigoAmostra = params[0];
        return Promise.resolve({
          rowCount: 1,
          rows: [{
            id: 1,
            codigo_amostra: codigoAmostra,
            numero_da_amostra: params[1],
            matriz_id: 1,
            matriz_nome: 'Água'
          }]
        });
      }
      
      // Mock para buscar matriz
      if (query.includes('FROM matriz')) {
        return Promise.resolve({
          rowCount: 1,
          rows: [{
            id: 1,
            nome: 'Água'
          }]
        });
      }
      
      // Mock para buscar legislação
      if (query.includes('FROM legislacao')) {
        return Promise.resolve({
          rowCount: 1,
          rows: [{
            id: 1,
            nome: 'Portaria 888/2021',
            sigla: 'Portaria 888/2021'
          }]
        });
      }
      
      // Mock para buscar parâmetro
      if (query.includes('FROM parametro')) {
        const nomeParametro = params[0];
        return Promise.resolve({
          rowCount: 1,
          rows: [{
            id: nomeParametro === 'Turbidez' ? 1 : nomeParametro === 'pH' ? 2 : 3,
            nome: nomeParametro,
            unidade_medida: nomeParametro === 'pH' ? '' : 'mg/L',
            tipo: 'Físico-Químico'
          }]
        });
      }

      // Mock para inserir resultado
      if (query.includes('INSERT INTO resultado_analise')) {
        return Promise.resolve({
          rowCount: 1,
          rows: [{
            id: Math.floor(Math.random() * 1000)
          }]
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

    console.log(`\n📊 Total de linhas lidas: ${linhas.length}`);
    expect(linhas.length).toBe(3);

    // Validar cada linha
    const resultados = [];
    for (let i = 0; i < linhas.length; i++) {
      const resultado = await ImportacaoModel.validarLinha(linhas[i], i + 1);
      resultados.push({
        linha: i + 1,
        ...resultado,
        dados: linhas[i]
      });
    }

    // Verificar resultados
    console.log('\n✅ Resultados da Validação:\n');
    resultados.forEach((resultado) => {
      console.log(`Linha ${resultado.linha}:`);
      console.log(`  ✓ Data: ${resultado.dados.datacoleta}`);
      console.log(`  ✓ Valor: ${resultado.dados.valor_medido}`);
      console.log(`  ✓ Parâmetro: ${resultado.dados.parametro}`);
      console.log(`  ✓ Amostra: ${resultado.dados.codigodaamostra}`);
      console.log(`  ✓ Validação: ${resultado.sucesso ? '✅ PASSOU' : '❌ FALHOU'}`);
      if (!resultado.sucesso) {
        console.log(`  ✗ Erro: ${resultado.erro}`);
      }
      console.log('');
    });

    // Todas as linhas devem ter sido validadas com sucesso
    resultados.forEach((resultado, index) => {
      expect(resultado.sucesso).toBe(true);
    });

    // Verificar dados específicos
    expect(resultados[0].dados.parametro).toBe('Turbidez');
    expect(resultados[0].dados.valor_medido).toBe('0.5');
    
    expect(resultados[1].dados.parametro).toBe('pH');
    expect(resultados[1].dados.valor_medido).toBe('1.2');
    
    expect(resultados[2].dados.parametro).toBe('Cloro Residual Livre');
    expect(resultados[2].dados.valor_medido).toBe('0.8');

    console.log('✅ TESTE CONCLUÍDO: Todas as 3 linhas foram validadas com sucesso!\n');
  });

  test('deve processar e inserir as 3 linhas no banco', async () => {
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
            matriz_nome: 'Água'
          }]
        });
      }
      
      // Mock para buscar matriz
      if (query.includes('FROM matriz')) {
        return Promise.resolve({
          rowCount: 1,
          rows: [{ id: 1, nome: 'Água' }]
        });
      }
      
      // Mock para buscar legislação
      if (query.includes('FROM legislacao')) {
        return Promise.resolve({
          rowCount: 1,
          rows: [{
            id: 1,
            nome: 'Portaria 888/2021',
            sigla: 'Portaria 888/2021'
          }]
        });
      }
      
      // Mock para buscar parâmetro
      if (query.includes('FROM parametro')) {
        const nomeParametro = params[0];
        return Promise.resolve({
          rowCount: 1,
          rows: [{
            id: nomeParametro === 'Turbidez' ? 1 : nomeParametro === 'pH' ? 2 : 3,
            nome: nomeParametro,
            unidade_medida: nomeParametro === 'pH' ? '' : 'mg/L',
            tipo: 'Físico-Químico'
          }]
        });
      }

      return Promise.resolve({ rowCount: 0, rows: [] });
    });

    // Mock do client.query para transação
    mockClient.query.mockImplementation((query, params) => {
      const normalized = String(query).toLowerCase();
      if (query === 'BEGIN' || query === 'COMMIT') {
        return Promise.resolve();
      }
      if (normalized.includes('select * from amostra')) {
        return Promise.resolve({
          rowCount: 1,
          rows: [{ id: params[0], status_amostra: 'em_analise', local_atual: 'Bancada' }]
        });
      }
      if (normalized.includes('with contexto as')) {
        return Promise.resolve({
          rowCount: 1,
          rows: [{ id: Math.floor(Math.random() * 1000) }]
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

    console.log('\n📝 Resumo do Processamento:\n');
    console.log(`Total de linhas: ${linhas.length}`);
    console.log(`Linhas validadas: ${dadosValidos.length}`);
    console.log(`Linhas com erro de validação: ${errosValidacao.length}`);
    console.log(`Inseridas no banco: ${resultadoInsercao.inseridos}`);
    console.log(`Erros de inserção: ${resultadoInsercao.erros.length}`);
    console.log(`Taxa de sucesso: ${(resultadoInsercao.inseridos / linhas.length * 100).toFixed(2)}%\n`);

    // Verificar se todas foram processadas
    expect(linhas.length).toBe(3);
    expect(dadosValidos.length).toBe(3);
    expect(errosValidacao.length).toBe(0);
    expect(resultadoInsercao.inseridos).toBe(3);
    expect(resultadoInsercao.erros.length).toBe(0);

    console.log('✅ TESTE CONCLUÍDO: Todas as 3 linhas foram processadas e inseridas com sucesso!\n');
  });

  test('deve verificar estrutura do CSV', () => {
    const conteudoCSV = fs.readFileSync(arquivoTeste, 'utf-8');
    const linhas = conteudoCSV.split('\n').filter(linha => linha.trim() !== '');
    
    console.log('\n📄 Estrutura do Arquivo CSV:\n');
    console.log(`Total de linhas (incluindo cabeçalho): ${linhas.length}`);
    console.log(`Cabeçalho: ${linhas[0]}`);
    console.log('\nDados:');
    for (let i = 1; i < linhas.length; i++) {
      console.log(`Linha ${i}: ${linhas[i]}`);
    }
    console.log('');

    // Verificar estrutura
    expect(linhas.length).toBe(4); // 1 cabeçalho + 3 linhas de dados
    expect(linhas[0]).toContain('datacoleta');
    expect(linhas[0]).toContain('valor_medido');
    expect(linhas[0]).toContain('parametro');
  });
});
