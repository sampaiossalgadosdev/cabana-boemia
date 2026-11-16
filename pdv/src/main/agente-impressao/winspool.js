/**
 * Ponte com o spooler do Windows (winspool.drv) via koffi: envia bytes RAW
 * (ESC/POS) para a impressora instalada, sem passar pelo driver gráfico.
 * Só carrega no Windows; os testes usam um spooler falso.
 */

const RAW = 'RAW';
const JOB_CONTROL_DELETE = 5;
const ERROR_INVALID_PRINTER_NAME = 1801;

let cache = null;

/** @returns {Promise<import('./impressoras.js').Spooler>} */
export async function carregarSpooler() {
  if (process.platform !== 'win32') throw new Error('Impressão RAW só no Windows');
  cache ??= montar((await import('koffi')).default);
  return cache;
}

function montar(koffi) {
  const ws = koffi.load('winspool.drv');
  const k32 = koffi.load('kernel32.dll');

  koffi.pointer('HANDLE_IMPRESSORA', koffi.opaque());
  koffi.struct('DOC_INFO_1W', {
    pDocName: 'const char16_t *',
    pOutputFile: 'const char16_t *',
    pDatatype: 'const char16_t *',
  });
  // Ponteiros como void*: só os campos numéricos interessam.
  const PRINTER_INFO_2W = koffi.struct('PRINTER_INFO_2W', {
    pServerName: 'void *',
    pPrinterName: 'void *',
    pShareName: 'void *',
    pPortName: 'void *',
    pDriverName: 'void *',
    pComment: 'void *',
    pLocation: 'void *',
    pDevMode: 'void *',
    pSepFile: 'void *',
    pPrintProcessor: 'void *',
    pDatatype: 'void *',
    pParameters: 'void *',
    pSecurityDescriptor: 'void *',
    Attributes: 'uint32_t',
    Priority: 'uint32_t',
    DefaultPriority: 'uint32_t',
    StartTime: 'uint32_t',
    UntilTime: 'uint32_t',
    Status: 'uint32_t',
    cJobs: 'uint32_t',
    AveragePPM: 'uint32_t',
  });
  const JOB_INFO_1W = koffi.struct('JOB_INFO_1W', {
    JobId: 'uint32_t',
    pPrinterName: 'void *',
    pMachineName: 'void *',
    pUserName: 'void *',
    pDocument: 'void *',
    pDatatype: 'void *',
    pStatus: 'void *',
    Status: 'uint32_t',
    Priority: 'uint32_t',
    Position: 'uint32_t',
    TotalPages: 'uint32_t',
    PagesPrinted: 'uint32_t',
    Submitted: koffi.array('uint16_t', 8),
  });

  const OpenPrinterW = ws.func(
    'bool __stdcall OpenPrinterW(const char16_t *nome, _Out_ HANDLE_IMPRESSORA *h, void *padrao)',
  );
  const ClosePrinter = ws.func('bool __stdcall ClosePrinter(HANDLE_IMPRESSORA h)');
  const GetPrinterW = ws.func(
    'bool __stdcall GetPrinterW(HANDLE_IMPRESSORA h, uint32_t nivel, _Out_ uint8_t *buf, uint32_t cb, _Out_ uint32_t *precisa)',
  );
  const StartDocPrinterW = ws.func('uint32_t __stdcall StartDocPrinterW(HANDLE_IMPRESSORA h, uint32_t nivel, DOC_INFO_1W *doc)');
  const StartPagePrinter = ws.func('bool __stdcall StartPagePrinter(HANDLE_IMPRESSORA h)');
  const WritePrinter = ws.func(
    'bool __stdcall WritePrinter(HANDLE_IMPRESSORA h, const uint8_t *buf, uint32_t cb, _Out_ uint32_t *escritos)',
  );
  const EndPagePrinter = ws.func('bool __stdcall EndPagePrinter(HANDLE_IMPRESSORA h)');
  const EndDocPrinter = ws.func('bool __stdcall EndDocPrinter(HANDLE_IMPRESSORA h)');
  const GetJobW = ws.func(
    'bool __stdcall GetJobW(HANDLE_IMPRESSORA h, uint32_t id, uint32_t nivel, _Out_ uint8_t *buf, uint32_t cb, _Out_ uint32_t *precisa)',
  );
  const SetJobW = ws.func('bool __stdcall SetJobW(HANDLE_IMPRESSORA h, uint32_t id, uint32_t nivel, void *job, uint32_t comando)');
  const GetLastError = k32.func('uint32_t __stdcall GetLastError()');

  const falha = (onde) => new Error(`${onde} falhou (erro ${GetLastError()} do Windows)`);

  function comImpressora(nome, fn) {
    const h = [null];
    if (!OpenPrinterW(nome, h, null)) {
      const codigo = GetLastError();
      throw new Error(
        codigo === ERROR_INVALID_PRINTER_NAME
          ? `Impressora "${nome}" não encontrada no Windows`
          : `OpenPrinter falhou (erro ${codigo} do Windows)`,
      );
    }
    try {
      return fn(h[0]);
    } finally {
      ClosePrinter(h[0]);
    }
  }

  /** Padrão do Win32: pergunta o tamanho, depois lê. null = não existe (ex.: job já saiu da fila). */
  function lerInfo(ler, tipo) {
    const precisa = [0];
    ler(null, 0, precisa);
    if (!precisa[0]) return null;
    const buf = Buffer.alloc(precisa[0]);
    if (!ler(buf, buf.length, precisa)) return null;
    return koffi.decode(buf, tipo);
  }

  return {
    estado(nome) {
      return comImpressora(nome, (h) => {
        const info = lerInfo((buf, cb, precisa) => GetPrinterW(h, 2, buf, cb, precisa), PRINTER_INFO_2W);
        if (!info) throw falha('GetPrinter');
        return { status: info.Status, atributos: info.Attributes };
      });
    },

    enviar(nome, documento, bytes) {
      return comImpressora(nome, (h) => {
        const jobId = StartDocPrinterW(h, 1, { pDocName: documento, pOutputFile: null, pDatatype: RAW });
        if (!jobId) throw falha('StartDocPrinter');
        try {
          if (!StartPagePrinter(h)) throw falha('StartPagePrinter');
          const escritos = [0];
          if (!WritePrinter(h, bytes, bytes.length, escritos)) throw falha('WritePrinter');
          if (escritos[0] !== bytes.length) throw new Error(`WritePrinter gravou ${escritos[0]} de ${bytes.length} bytes`);
          if (!EndPagePrinter(h)) throw falha('EndPagePrinter');
        } catch (err) {
          EndDocPrinter(h);
          SetJobW(h, jobId, 0, null, JOB_CONTROL_DELETE);
          throw err;
        }
        if (!EndDocPrinter(h)) throw falha('EndDocPrinter');
        return jobId;
      });
    },

    /** null = o trabalho não está mais na fila do Windows. */
    job(nome, id) {
      return comImpressora(nome, (h) => {
        const info = lerInfo((buf, cb, precisa) => GetJobW(h, id, 1, buf, cb, precisa), JOB_INFO_1W);
        return info ? { status: info.Status } : null;
      });
    },

    apagarJob(nome, id) {
      comImpressora(nome, (h) => SetJobW(h, id, 0, null, JOB_CONTROL_DELETE));
    },
  };
}
