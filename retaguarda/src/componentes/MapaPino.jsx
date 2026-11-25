import { useEffect, useRef, useState } from 'react';
import { linkDoMapa, pinValido } from '@restaurante/shared/mapa';
import { carregarGoogleMaps } from '../lib/googleMaps.js';
import { coordenadaParaTexto, mensagemDaBusca, pinDosCampos, pinMudou } from '../lib/mapa.js';

/**
 * Pino da loja: busca o endereço (pelo servidor), mostra no mapa e deixa
 * arrastar (ou tocar no mapa) até a porta. Sem a chave do mapa, ou se ele não
 * carregar, a posição é digitada (latitude e longitude), com o link para conferir.
 *
 * @param {{ pino: { latitude: number, longitude: number } | null, aoMudar: (p) => void,
 *           config: { chaveWeb: string | null, centro: { latitude: number, longitude: number }, busca: boolean },
 *           buscar: (texto: string) => Promise<{ pin, aproximado, motivo }>, textoInicial?: string }} props
 */
export function MapaPino({ pino, aoMudar, config, buscar, textoInicial = '' }) {
  const caixa = useRef(null);
  const mapa = useRef(null);
  const marcador = useRef(null);
  const aoMudarRef = useRef(aoMudar);
  aoMudarRef.current = aoMudar;
  const [estado, setEstado] = useState(config.chaveWeb ? 'carregando' : 'sem-mapa');
  const [texto, setTexto] = useState(textoInicial);
  const [buscando, setBuscando] = useState(false);
  const [mensagem, setMensagem] = useState(null);
  const [campos, setCampos] = useState({ lat: coordenadaParaTexto(pino?.latitude), lng: coordenadaParaTexto(pino?.longitude) });

  // Carrega o mapa uma vez; chave recusada pelo Google (gm_authFailure) = campos manuais.
  useEffect(() => {
    if (!config.chaveWeb) return undefined;
    let vivo = true;
    window.gm_authFailure = () => vivo && setEstado('sem-mapa');
    carregarGoogleMaps(config.chaveWeb)
      .then((maps) => {
        if (!vivo || !caixa.current) return;
        const inicio = pinValido(pino) ? pino : config.centro;
        mapa.current = new maps.Map(caixa.current, {
          center: { lat: inicio.latitude, lng: inicio.longitude },
          zoom: pinValido(pino) ? 18 : 15,
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: false,
          clickableIcons: false,
          gestureHandling: 'cooperative',
        });
        marcador.current = new maps.Marker({
          map: mapa.current,
          position: { lat: inicio.latitude, lng: inicio.longitude },
          draggable: true,
          visible: pinValido(pino),
          title: 'Arraste até a porta da loja',
        });
        const mover = (latLng) => aoMudarRef.current({ latitude: latLng.lat(), longitude: latLng.lng() });
        marcador.current.addListener('dragend', (e) => mover(e.latLng));
        mapa.current.addListener('click', (e) => mover(e.latLng));
        setEstado('pronto');
      })
      .catch(() => vivo && setEstado('sem-mapa'));
    return () => {
      vivo = false;
    };
    // Só na montagem: o pino seguinte é aplicado pelo efeito abaixo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.chaveWeb]);

  // Pino de fora (busca, campos, "remover") → marcador e campos.
  useEffect(() => {
    // Não reescreve o que a pessoa está digitando quando já é o mesmo pino.
    setCampos((c) => {
      const digitado = pinDosCampos(c.lat, c.lng);
      if (digitado && !pinMudou(digitado, pino)) return c;
      return { lat: coordenadaParaTexto(pino?.latitude), lng: coordenadaParaTexto(pino?.longitude) };
    });
    if (!marcador.current) return;
    if (pinValido(pino)) {
      marcador.current.setPosition({ lat: pino.latitude, lng: pino.longitude });
      marcador.current.setVisible(true);
    } else {
      marcador.current.setVisible(false);
    }
  }, [pino]);

  async function aoBuscar() {
    if (texto.trim().length < 3) return;
    setBuscando(true);
    setMensagem(null);
    try {
      const r = await buscar(texto.trim());
      setMensagem(mensagemDaBusca(r));
      if (r.pin) {
        aoMudar(r.pin);
        mapa.current?.panTo({ lat: r.pin.latitude, lng: r.pin.longitude });
        mapa.current?.setZoom(r.aproximado ? 16 : 18);
      }
    } catch (err) {
      setMensagem({ tipo: 'aviso', texto: err.message });
    } finally {
      setBuscando(false);
    }
  }

  function aoDigitarCampo(campo, valor) {
    const novos = { ...campos, [campo]: valor };
    setCampos(novos);
    const p = pinDosCampos(novos.lat, novos.lng);
    if (p) {
      aoMudar(p);
      mapa.current?.panTo({ lat: p.latitude, lng: p.longitude });
    }
  }

  const link = linkDoMapa(pino);
  return (
    <div className="mapa-pino">
      {config.busca && (
        <div className="mapa-pino__busca">
          <input
            className="entrada"
            aria-label="Endereço da loja para buscar no mapa"
            placeholder="Rua, número, bairro"
            maxLength={300}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                aoBuscar();
              }
            }}
          />
          <button type="button" className="botao" disabled={buscando || texto.trim().length < 3} onClick={aoBuscar}>
            {buscando ? 'Buscando…' : 'Buscar no mapa'}
          </button>
        </div>
      )}
      {mensagem && <p className={mensagem.tipo === 'ok' ? 'campo__ajuda' : 'campo__erro'}>{mensagem.texto}</p>}

      {estado !== 'sem-mapa' && (
        // O Google Maps é dono do conteúdo desta div: nada do React dentro dela.
        <div ref={caixa} className="mapa-pino__mapa" role="application" aria-label="Mapa: toque ou arraste o pino até a porta da loja" />
      )}
      {estado === 'carregando' && <span className="suave">Carregando o mapa…</span>}
      {estado === 'pronto' && <span className="campo__ajuda">Toque no mapa ou arraste o pino até a porta da loja.</span>}

      {estado === 'sem-mapa' && (
        <>
          <span className="campo__ajuda">
            Mapa indisponível. Digite a posição (no Google Maps, toque e segure no lugar e copie os números).
          </span>
          <div className="mapa-pino__campos">
            <input className="entrada" aria-label="Latitude" placeholder="Latitude (ex.: -23,304900)" inputMode="decimal" value={campos.lat} onChange={(e) => aoDigitarCampo('lat', e.target.value)} />
            <input className="entrada" aria-label="Longitude" placeholder="Longitude (ex.: -50,313300)" inputMode="decimal" value={campos.lng} onChange={(e) => aoDigitarCampo('lng', e.target.value)} />
          </div>
        </>
      )}

      <div className="mapa-pino__rodape">
        {pinValido(pino) ? (
          <>
            <span className="suave">
              Pino: {coordenadaParaTexto(pino.latitude)}, {coordenadaParaTexto(pino.longitude)}
            </span>
            <a className="botao botao--texto" href={link} target="_blank" rel="noopener noreferrer">
              Conferir no Google Maps
            </a>
            <button type="button" className="botao botao--texto" onClick={() => aoMudar(null)}>
              Remover pino
            </button>
          </>
        ) : (
          <span className="suave">Sem pino: os pedidos desta loja ficam sem distância.</span>
        )}
      </div>
    </div>
  );
}
