import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import PostosPanel from './PostosPanel';
import {
  formatarPlaca, formatarDataHora, formatarKM, formatarTemp,
  tempoAtras, corDoStatus, corDoSeverity, labelSeverity,
} from '../utils/helpers';

function normalizarPlaca(valor = '') {
  return String(valor).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Ajusta zoom para caber todos os veículos
function AutoFitBounds({ posicoes, fitCounter, assinatura }) {
  const map = useMap();
  const assinaturaRef = useRef('');
  const fitRef = useRef(0);
  const primeiroRef = useRef(true);

  useEffect(() => {
    if (posicoes.length === 0) return;
    if (assinatura === assinaturaRef.current && fitCounter === fitRef.current) return;

    assinaturaRef.current = assinatura;
    fitRef.current = fitCounter;

    const primeiro = primeiroRef.current;
    primeiroRef.current = false;

    const timer = setTimeout(() => {
      if (posicoes.length === 1) {
        const unico = posicoes[0];
        map.setView([unico.lat, unico.lon], 16, { animate: !primeiro, duration: primeiro ? 0 : 0.5 });
        return;
      }

      const limites = L.latLngBounds(posicoes.map((p) => [p.lat, p.lon]));
      if (limites.isValid()) {
        map.fitBounds(limites, { padding: [40, 40], maxZoom: 14, animate: !primeiro, duration: primeiro ? 0 : 0.5 });
      }
    }, primeiro ? 50 : 300);

    return () => clearTimeout(timer);
  }, [posicoes, map, fitCounter, assinatura]);

  return null;
}

// Ajusta mapa para mostrar veículo + postos próximos
function FitPostosBounds({ veiLatLon, postos, ativo }) {
  const map = useMap();
  const prevRef = useRef('');

  useEffect(() => {
    if (!ativo || !veiLatLon || postos.length === 0) return;
    const sig = `${veiLatLon[0]},${veiLatLon[1]},${postos.length}`;
    if (sig === prevRef.current) return;
    prevRef.current = sig;

    const pontos = [veiLatLon, ...postos.slice(0, 15).map((p) => [p.lat, p.lon])];
    const limites = L.latLngBounds(pontos);
    if (limites.isValid()) {
      setTimeout(() => map.fitBounds(limites, { padding: [50, 50], maxZoom: 13 }), 200);
    }
  }, [veiLatLon, postos, ativo, map]);

  return null;
}

function criarIcone(cor, placa, temAlerta) {
  const texto = placa && placa !== 'S/Placa' ? placa : '';
  return L.divIcon({
    className: '',
    html: `
      <div style="display:flex;align-items:center;gap:3px;white-space:nowrap;pointer-events:auto">
        <div class="marcador-veiculo" style="background:${cor}">🚛</div>
        ${texto ? `<span class="marcador-placa" style="border-color:${cor}">${temAlerta ? '⚠️' : ''}${texto}</span>` : ''}
      </div>`,
    iconSize: [180, 40],
    iconAnchor: [20, 20],
    popupAnchor: [0, -18],
  });
}

function formatarPrecoMarcador(posto) {
  const v = posto.preco_diesel_s10 ?? posto.preco_diesel;
  if (!v) return null;
  return parseFloat(v).toFixed(3).replace('.', ',');
}

function criarIconePosto(posto, selecionado = false) {
  const preco = formatarPrecoMarcador(posto);
  const sel = selecionado ? ' marcador-posto-sel' : '';
  const html = preco
    ? `<div class="marcador-posto-wrap${sel}"><div class="marcador-preco-tag">${preco}</div><div class="marcador-posto-ico">⛽</div></div>`
    : `<div class="marcador-posto${sel}">⛽</div>`;
  const size = preco ? [60, 52] : [34, 34];
  const anchor = preco ? [30, 46] : [17, 17];
  return L.divIcon({ className: '', html, iconSize: size, iconAnchor: anchor, popupAnchor: [0, -10] });
}

export default function MapaView({ veiculos, fitCounter = 0 }) {
  const [selecionado, setSelecionado] = useState(null);
  const [buscaPlaca, setBuscaPlaca] = useState('');

  // Estado de postos
  const [modoPostos, setModoPostos] = useState(false);
  const [postosVeiculo, setPostosVeiculo] = useState(null);
  const [postos, setPostos] = useState([]);
  const [postosCarregando, setPostosCarregando] = useState(false);
  const [postosErro, setPostosErro] = useState(null);
  const [postoSelecionado, setPostoSelecionado] = useState(null);
  const [raioPostos, setRaioPostos] = useState(30000);
  const [geocodeStatus, setGeocodeStatus] = useState(null);
  const [raioEfetivo, setRaioEfetivo] = useState(30000);
  const [expandiuAuto, setExpandiuAuto] = useState(false);
  const [comPrecoTotal, setComPrecoTotal] = useState(0);

  const noMapa = useMemo(() => {
    return veiculos.filter((v) =>
      v.lat && v.lon && !(v.lat === 0 && v.lon === 0) &&
      v.lat >= -34 && v.lat <= 6 && v.lon >= -74 && v.lon <= -34
    );
  }, [veiculos]);

  const noMapaFiltrado = useMemo(() => {
    const termo = normalizarPlaca(buscaPlaca);
    if (!termo) return noMapa;
    return noMapa.filter((v) => normalizarPlaca(v.placa).includes(termo));
  }, [noMapa, buscaPlaca]);

  const assinaturaMapa = useMemo(() => {
    return noMapaFiltrado.map((v) => v.veiID).sort().join('|');
  }, [noMapaFiltrado]);

  const alertas = useMemo(() => {
    const lista = [];
    veiculos.forEach((v) => {
      v.eventos.forEach((evt) => lista.push({ placa: v.placa, veiID: v.veiID, municipio: v.municipio, uf: v.uf, ...evt }));
    });
    const ordem = { critico: 0, alto: 1, medio: 2, info: 3 };
    return lista.sort((a, b) => (ordem[a.severity] ?? 9) - (ordem[b.severity] ?? 9));
  }, [veiculos]);

  const vei = selecionado ? veiculos.find((v) => v.veiID === selecionado) : null;

  async function buscarPostos(veiculo, raio = raioPostos) {
    if (!veiculo?.lat || !veiculo?.lon) return;
    setModoPostos(true);
    setPostosVeiculo(veiculo);
    setPostosCarregando(true);
    setPostosErro(null);
    setPostos([]);
    setPostoSelecionado(null);

    try {
      const resp = await fetch(`/api/postos?lat=${veiculo.lat}&lon=${veiculo.lon}&raio=${raio}`);
      const data = await resp.json();
      if (data.erro) throw new Error(data.erro);
      setPostos(data.postos || []);
      if (data.geocodeStatus) setGeocodeStatus(data.geocodeStatus);
      setRaioEfetivo(data.raio || raio);
      setExpandiuAuto(!!data.expandiuAuto);
      setComPrecoTotal(data.comPreco || 0);
    } catch (err) {
      setPostosErro(err.message);
    } finally {
      setPostosCarregando(false);
    }
  }

  function sairModoPostos() {
    setModoPostos(false);
    setPostos([]);
    setPostoSelecionado(null);
    setPostosErro(null);
    setPostosVeiculo(null);
  }

  async function mudarRaio(novoRaio) {
    setRaioPostos(novoRaio);
    if (postosVeiculo) await buscarPostos(postosVeiculo, novoRaio);
  }

  const veiLatLon = postosVeiculo?.lat && postosVeiculo?.lon
    ? [postosVeiculo.lat, postosVeiculo.lon]
    : null;

  return (
    <div className={`mapa-layout${modoPostos ? ' postos-ativo' : ''}`}>
      {/* === MAPA === */}
      <div className="mapa-container">
        <div className="mapa-busca">
          <input
            type="text"
            placeholder="Buscar placa..."
            value={buscaPlaca}
            onChange={(e) => setBuscaPlaca(e.target.value)}
          />
          <span className="mapa-busca-contador">{noMapaFiltrado.length}/{noMapa.length}</span>
          {buscaPlaca && (
            <button className="mapa-busca-limpar" onClick={() => setBuscaPlaca('')}>Limpar</button>
          )}
        </div>

        <MapContainer center={[-19.5, -51]} zoom={6.4} scrollWheelZoom zoomControl={false} style={{ height: '100%', width: '100%' }}>
          <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" attribution="&copy; CARTO" />

          {!modoPostos && (
            <AutoFitBounds posicoes={noMapaFiltrado} fitCounter={fitCounter} assinatura={assinaturaMapa} />
          )}

          <FitPostosBounds veiLatLon={veiLatLon} postos={postos} ativo={modoPostos && postos.length > 0} />

          {/* Marcadores de veículos */}
          {noMapaFiltrado.map((v) => (
            <Marker
              key={v.veiID}
              position={[v.lat, v.lon]}
              icon={criarIcone(v.statusCor, formatarPlaca(v.placa), v.eventos.length > 0)}
              zIndexOffset={selecionado === v.veiID ? 500 : 0}
              eventHandlers={{ click: () => { setSelecionado(v.veiID); if (modoPostos) sairModoPostos(); } }}
            >
              <Tooltip direction="top" offset={[0, -22]} className="tooltip-veiculo">
                <strong>{formatarPlaca(v.placa)}</strong> — {v.statusTexto}
              </Tooltip>
              <Popup>
                <div className="popup-header">
                  <span className="popup-placa">{formatarPlaca(v.placa)}</span>
                  <span className="popup-status" style={{ background: v.statusCor + '22', color: v.statusCor }}>{v.statusTexto}</span>
                </div>
                <div className="popup-body">
                  <div className="popup-linha">📍 <strong>{v.municipio || 'S/I'}</strong>{v.uf ? ` - ${v.uf}` : ''}</div>
                  {v.rodovia && <div className="popup-linha">🛣️ {v.rodovia}</div>}
                  {v.velocidade !== null && <div className="popup-linha">🏎️ {v.velocidade} km/h</div>}
                  {v.odometro !== null && <div className="popup-linha">📏 {formatarKM(v.odometro)}</div>}
                  {v.motorista && <div className="popup-linha">👤 {v.motorista}</div>}
                  {v.temperatura1 !== null && <div className="popup-linha">🌡️ {formatarTemp(v.temperatura1)}</div>}
                  <div className="popup-linha">🕐 {formatarDataHora(v.dataHora)} <small>{tempoAtras(v.dataHora)}</small></div>
                  {v.eventos.length > 0 && (
                    <div className="popup-alertas">
                      {v.eventos.map((e, i) => (
                        <span key={i} className="popup-alerta-tag" style={{ color: corDoSeverity(e.severity) }}>{e.icone} {e.descricao}</span>
                      ))}
                    </div>
                  )}
                </div>
              </Popup>
            </Marker>
          ))}

          {/* Marcadores de postos de combustível */}
          {modoPostos && postos.map((posto) => (
            <Marker
              key={posto.id}
              position={[posto.lat, posto.lon]}
              icon={criarIconePosto(posto, postoSelecionado?.id === posto.id)}
              zIndexOffset={postoSelecionado?.id === posto.id ? 1000 : 0}
              eventHandlers={{ click: () => setPostoSelecionado(posto) }}
            >
              <Tooltip direction="top" className="tooltip-veiculo">
                <strong>{posto.nome}</strong>
                {posto.preco_diesel && ` — Diesel R$ ${parseFloat(posto.preco_diesel).toFixed(3)}`}
                <br />{posto.distancia} km
              </Tooltip>
            </Marker>
          ))}
        </MapContainer>

        {/* Legenda */}
        {!modoPostos && (
          <div className="mapa-legenda">
            <div className="legenda-item"><span className="bolinha verde" /> Movimento</div>
            <div className="legenda-item"><span className="bolinha amarelo" /> Ign. Ligada</div>
            <div className="legenda-item"><span className="bolinha azul" /> Parado</div>
            <div className="legenda-item"><span className="bolinha cinza" /> Sem Sinal</div>
          </div>
        )}

        {modoPostos && (
          <div className="mapa-legenda">
            <div className="legenda-item"><span style={{ fontSize: '1rem' }}>🚛</span> Veículo</div>
            <div className="legenda-item"><span style={{ fontSize: '1rem' }}>⛽</span> Posto</div>
            <div className="legenda-item" style={{ color: '#f59e0b' }}>{postos.length} encontrados</div>
          </div>
        )}

        <div className="mapa-stats">
          <strong>{noMapaFiltrado.length}</strong> no mapa
          {buscaPlaca && noMapaFiltrado.length !== noMapa.length && <> · <span>{noMapa.length} total</span></>}
          {veiculos.length - noMapa.length > 0 && <> · <span className="stat-alerta">{veiculos.length - noMapa.length} sem posição</span></>}
        </div>
      </div>

      {/* === PAINEL LATERAL === */}
      <aside className="mapa-painel">
        {/* Modo Postos */}
        {modoPostos && postosVeiculo ? (
          <PostosPanel
            postos={postos}
            carregando={postosCarregando}
            erro={postosErro}
            veiculo={postosVeiculo}
            raio={raioPostos}
            raioEfetivo={raioEfetivo}
            expandiuAuto={expandiuAuto}
            onRaioChange={mudarRaio}
            onFechar={sairModoPostos}
            postoSelecionadoId={postoSelecionado?.id}
            onPostoClick={setPostoSelecionado}
            geocodeStatus={geocodeStatus}
            comPreco={comPrecoTotal}
          />
        ) : vei ? (
          /* Detalhe do veículo */
          <div className="painel-detalhe">
            <div className="painel-detalhe-header">
              <h3>{formatarPlaca(vei.placa)}</h3>
              <button className="btn-fechar" onClick={() => setSelecionado(null)}>✕</button>
            </div>
            <span className="badge-status-lg" style={{ background: vei.statusCor + '22', color: vei.statusCor }}>{vei.statusTexto}</span>
            <div className="painel-campo"><label>Motorista</label><span>{vei.motorista || '—'}</span></div>
            <div className="painel-campo"><label>Local</label><span>{vei.municipio || '—'}{vei.uf ? `/${vei.uf}` : ''}</span></div>
            {vei.rodovia && <div className="painel-campo"><label>Rodovia</label><span>{vei.rodovia}</span></div>}
            <div className="painel-campo"><label>Velocidade</label><span>{vei.velocidade !== null ? `${vei.velocidade} km/h` : '—'}</span></div>
            <div className="painel-campo"><label>Odômetro</label><span>{formatarKM(vei.odometro)}</span></div>
            {vei.temperatura1 !== null && (
              <div className="painel-campo"><label>Temperatura</label><span>{formatarTemp(vei.temperatura1)}</span></div>
            )}
            <div className="painel-campo"><label>Atualização</label><span>{formatarDataHora(vei.dataHora)} {tempoAtras(vei.dataHora)}</span></div>

            {/* Botão buscar postos */}
            {vei.lat && vei.lon ? (
              <button
                className="btn-buscar-postos"
                onClick={() => { buscarPostos(vei); }}
              >
                ⛽ Buscar Postos Próximos
              </button>
            ) : (
              <div className="painel-campo" style={{ opacity: 0.5 }}>
                <span style={{ fontSize: '0.78rem', color: 'var(--texto-muted, #6b7280)' }}>⛽ Posição indisponível para busca de postos</span>
              </div>
            )}

            {vei.eventos.length > 0 && (
              <div className="painel-alertas-detalhe">
                <label>Alertas Ativos</label>
                {vei.eventos.map((e, i) => (
                  <div key={i} className="alerta-row" style={{ borderLeftColor: corDoSeverity(e.severity) }}>
                    <span className="alerta-icone">{e.icone}</span>
                    <span className="alerta-desc">{e.descricao}</span>
                    <span className="alerta-sev" style={{ color: corDoSeverity(e.severity) }}>{labelSeverity(e.severity)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* Central de Alertas */
          <div className="painel-alertas">
            <h3>🚨 Central de Alertas</h3>
            <div className="painel-alertas-contagem">
              <span className="contagem-item critico">{alertas.filter((a) => a.severity === 'critico').length} Críticos</span>
              <span className="contagem-item alto">{alertas.filter((a) => a.severity === 'alto').length} Altos</span>
              <span className="contagem-item medio">{alertas.filter((a) => a.severity === 'medio' || a.severity === 'info').length} Outros</span>
            </div>
            <div className="painel-alertas-lista">
              {alertas.length > 0 ? (
                alertas.slice(0, 25).map((a, i) => (
                  <div
                    key={`${a.veiID}-${i}`}
                    className="alerta-item"
                    style={{ borderLeftColor: corDoSeverity(a.severity) }}
                    onClick={() => setSelecionado(a.veiID)}
                  >
                    <div className="alerta-item-top">
                      <span className="alerta-placa">{formatarPlaca(a.placa)}</span>
                      <span className="alerta-sev-badge" style={{ background: corDoSeverity(a.severity) + '22', color: corDoSeverity(a.severity) }}>{labelSeverity(a.severity)}</span>
                    </div>
                    <div className="alerta-item-desc">{a.icone} {a.descricao}</div>
                    {a.municipio && <div className="alerta-item-local">📍 {a.municipio}{a.uf ? `/${a.uf}` : ''}</div>}
                  </div>
                ))
              ) : (
                <div className="painel-vazio">
                  <span>✅</span>
                  <p>Nenhum alerta ativo</p>
                </div>
              )}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
