const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
const ImportacaoController = require('../controllers/ImportacaoController');

describe('limite de memória da importação CSV', () => {
  test('interrompe a leitura assim que ultrapassa 5.000 resultados', async () => {
    const filePath = path.join(os.tmpdir(), `sysmlab-import-${randomUUID()}.csv`);
    const header = 'datacoleta,valor_medido,legislacao,matriz,numerodaamostra,codigodaamostra,parametro\n';
    const row = '01/01/2026,1,Lei,Agua,1,A-1,Parametro\n';
    fs.writeFileSync(filePath, header + row.repeat(5_001), 'utf8');

    try {
      await expect(ImportacaoController.lerCSV(filePath))
        .rejects.toMatchObject({ code: 'MAX_IMPORT_ROWS' });
    } finally {
      fs.rmSync(filePath, { force: true });
    }
  });
});
