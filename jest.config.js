// jest.config.js
module.exports = {
  testEnvironment: 'node',
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'models/ImportacaoModel.js',
    'controllers/ImportacaoController.js',
    'routes/ImportacaoRoutes.js'
  ],
  testMatch: [
    '**/__tests__/**/*.test.js',
    '**/?(*.)+(spec|test).js'
  ],
  coverageThreshold: {
    'controllers/ImportacaoController.js': {
      branches: 70,
      functions: 25,
      lines: 70,
      statements: 70
    }
  },
  verbose: true,
  testTimeout: 10000
};
