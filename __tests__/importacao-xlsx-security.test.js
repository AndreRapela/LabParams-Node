const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
const writeXlsxFile = require('write-excel-file/node');

const mockReadSheet = jest.fn();
jest.mock('read-excel-file/node', () => {
  const moduleMock = jest.fn();
  moduleMock.readSheet = mockReadSheet;
  return moduleMock;
});

const ImportacaoController = require('../controllers/ImportacaoController');

const CENTRAL_SIGNATURE = 0x02014b50;

function temporaryXlsxPath() {
  return path.join(os.tmpdir(), `sysmlab-xlsx-${randomUUID()}.xlsx`);
}

async function createWorkbook(rows) {
  return writeXlsxFile(rows, {
    columns: Array.from({ length: Math.max(...rows.map((row) => row.length)) }, () => ({ width: 16 })),
  }).toBuffer();
}

function forgeExpandedEntry(buffer, entryName, uncompressedSize) {
  const forged = Buffer.from(buffer);
  for (let cursor = 0; cursor + 46 <= forged.length; cursor += 1) {
    if (forged.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) continue;
    const nameLength = forged.readUInt16LE(cursor + 28);
    const name = forged.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    if (name === entryName) {
      forged.writeUInt32LE(uncompressedSize, cursor + 24);
      return forged;
    }
  }
  throw new Error(`Entrada ${entryName} não encontrada no fixture XLSX.`);
}

describe('proteções de volume da importação XLSX', () => {
  beforeEach(() => {
    mockReadSheet.mockReset();
  });

  test('aceita um XLSX real pequeno e lê somente a primeira planilha', async () => {
    const filePath = temporaryXlsxPath();
    const workbook = await createWorkbook([
      ['datacoleta', 'valor_medido'],
      ['01/01/2026', 1],
    ]);
    fs.writeFileSync(filePath, workbook);
    mockReadSheet.mockResolvedValue([
      ['datacoleta', 'valor_medido'],
      ['01/01/2026', 1],
    ]);

    try {
      await expect(ImportacaoController.lerExcel(filePath)).resolves.toEqual([{
        datacoleta: '01/01/2026',
        valor_medido: '1',
      }]);
      expect(mockReadSheet).toHaveBeenCalledWith(expect.any(Buffer), 1);
    } finally {
      fs.rmSync(filePath, { force: true });
    }
  });

  test('rejeita volume descompactado forjado antes de chamar o parser XLSX', async () => {
    const filePath = temporaryXlsxPath();
    const workbook = await createWorkbook([['cabecalho'], ['valor']]);
    const forged = forgeExpandedEntry(workbook, 'xl/worksheets/sheet1.xml', 30 * 1024 * 1024);
    fs.writeFileSync(filePath, forged);

    try {
      await expect(ImportacaoController.lerExcel(filePath)).rejects.toMatchObject({
        code: 'XLSX_SECURITY_LIMIT',
      });
      expect(mockReadSheet).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(filePath, { force: true });
    }
  });

  test('interrompe XLSX com mais de 5.000 resultados antes de materializá-lo no parser', async () => {
    const filePath = temporaryXlsxPath();
    const rows = [['cabecalho']];
    for (let index = 0; index < 5_001; index += 1) rows.push([`valor-${index}`]);
    fs.writeFileSync(filePath, await createWorkbook(rows));

    try {
      await expect(ImportacaoController.lerExcel(filePath)).rejects.toMatchObject({
        code: 'MAX_IMPORT_ROWS',
      });
      expect(mockReadSheet).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(filePath, { force: true });
    }
  });

  test.each([
    '<!DOCTYPE worksheet SYSTEM "file:///etc/passwd"><worksheet/>',
    '<!ENTITY xxe SYSTEM "file:///etc/passwd"><worksheet/>',
    '<?processar comando="externo"?><worksheet/>',
  ])('rejeita declaração XML ativa antes do parser: %s', (xml) => {
    expect(() => ImportacaoController.analisarTagsXml(
      xml,
      'xl/worksheets/sheet1.xml',
      { cells: 0, sharedStrings: 0, sheetRows: 0, xmlTags: 0 }
    )).toThrow(expect.objectContaining({ code: 'XLSX_SECURITY_LIMIT' }));
    expect(mockReadSheet).not.toHaveBeenCalled();
  });
});
