const MODOS = [
  { valor: 'impressora', rotulo: 'Impressora do Windows', dica: 'Térmica USB instalada com o driver.' },
  { valor: 'arquivo', rotulo: 'Modo teste (.txt)', dica: 'Sem impressora: cada cupom vira um arquivo de texto.' },
  { valor: 'desligado', rotulo: 'Este computador não imprime', dica: 'Use no PDV que não fica no balcão.' },
];

/**
 * Campos da impressora (modo, impressora do Windows, largura, tabela, guilhotina).
 * Usado no painel "Impressora" e na primeira execução.
 */
export function CamposImpressora({ form, impressoras, mudar }) {
  // Nome salvo que não aparece mais no Windows continua na lista (para ver o que estava).
  const opcoes = form.impressora && !impressoras.includes(form.impressora) ? [form.impressora, ...impressoras] : impressoras;
  return (
    <>
      <fieldset className="painel__grupo">
        <legend>Este computador</legend>
        {MODOS.map((m) => (
          <label key={m.valor} className={`opcao opcao--linha ${form.modo === m.valor ? 'opcao--marcada' : ''}`}>
            <input type="radio" name="modo" value={m.valor} checked={form.modo === m.valor}
              onChange={() => mudar('modo', m.valor)} />
            <span>
              <strong>{m.rotulo}</strong>
              <small>{m.dica}</small>
            </span>
          </label>
        ))}
      </fieldset>

      <label className="campo">
        <span>Impressora instalada no Windows</span>
        <select value={form.impressora} disabled={form.modo !== 'impressora'}
          onChange={(e) => mudar('impressora', e.target.value)}>
          <option value="">Escolha…</option>
          {opcoes.map((nome) => (
            <option key={nome} value={nome}>{nome}</option>
          ))}
        </select>
      </label>

      <div className="painel__linha">
        <fieldset className="painel__grupo">
          <legend>Largura do papel</legend>
          {[[48, '80 mm (48 colunas)'], [32, '58 mm (32 colunas)']].map(([v, rotulo]) => (
            <label key={v} className={`opcao ${form.largura === v ? 'opcao--marcada' : ''}`}>
              <input type="radio" name="largura" checked={form.largura === v} onChange={() => mudar('largura', v)} />
              {rotulo}
            </label>
          ))}
        </fieldset>

        <label className="campo">
          <span>Tabela de caracteres</span>
          <select value={form.tabela} onChange={(e) => mudar('tabela', e.target.value)}>
            <option value="cp860">cp860 (português)</option>
            <option value="cp850">cp850 (multilíngue)</option>
          </select>
        </label>

        <label className="opcao opcao--caixa">
          <input type="checkbox" checked={form.guilhotina} onChange={(e) => mudar('guilhotina', e.target.checked)} />
          Cortar o papel (guilhotina)
        </label>

        <label className="opcao opcao--caixa">
          <input type="checkbox" checked={form.qrMapa !== false} onChange={(e) => mudar('qrMapa', e.target.checked)} />
          QR code do mapa no cupom de entrega (para o entregador abrir no celular)
        </label>
      </div>
    </>
  );
}
