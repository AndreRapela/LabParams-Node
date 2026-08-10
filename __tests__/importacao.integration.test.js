// __tests__/importacao.integration.test.js
const request = require('supertest');
const path = require('path');

// Mock do pool antes de importar o app
jest.mock('../config/database', () => ({
  connect: jest.fn(),
  query: jest.fn()
}));

const app = require('../index');

describe('Importação - Testes de Integração', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /importacao/resultado-analise', () => {
    test('deve retornar erro 401 sem autenticação', async () => {
      const response = await request(app)
        .post('/importacao/resultado-analise')
        .attach('arquivo', path.join(__dirname, 'fixtures/teste_valido.csv'));

      expect(response.status).toBe(401);
    });
  });

  describe('GET /importacao/template', () => {
    test('deve retornar erro 401 sem autenticação', async () => {
      const response = await request(app)
        .get('/importacao/template?formato=csv');

      expect(response.status).toBe(401);
    });
  });
});
