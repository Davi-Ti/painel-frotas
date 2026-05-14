import { useState } from 'react';
import { formatarPlaca } from '../utils/helpers';

function formatarDistancia(km) {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

function formatarPreco(val) {
  const n = parseFloat(val);
  if (!val || isNaN(n)) return null;
  return `R$ ${n.toFixed(3).replace('.', ',')}`;
}

function formatarDataCTF(str) {
  if (!str) return null;
  return str.split(' ')[0] || null;
}

function temPreco(posto) {
  return !!(posto.preco_diesel || posto.preco_diesel_s10 || posto.preco_gasolina || posto.preco_arla);
}

function googleMapsURL(origem, posto) {
  const o = `${origem.lat},${origem.lon}`;
  const d = `${posto.lat},${posto.lon}`;
  return `https://www.google.com/maps/dir/?api=1&origin=${o}&destination=${encodeURIComponent(d)}&travelmode=driving`;
}

function wazeURL(posto) {
  return `https://waze.com/ul?ll=${posto.lat},${posto.lon}&navigate=yes`;
}

export default function PostosPanel({
  postos,
  carregando,
  erro,
  veiculo,
  raio,
  raioEfetivo,
  expandiuAuto,
  onRaioChange,
  onFechar,
  postoSelecionadoId,
  onPostoClick,
  geocodeStatus,
  comPreco: comPrecoTotal,
}) {
  const [ordem, setOrdem] = useState('preco');
  const [apenasComPreco, setApenasComPreco] = useState(true);

  const comPreco = postos.filter(temPreco);
  const semPreco = postos.filter((p) => !temPreco(p));

  const listaFiltrada = apenasComPreco ? comPreco : postos;

  const postosOrdenados = [...listaFiltrada].sort((a, b) => {
    if (ordem === 'preco') {
      const pa = a.preco_diesel_s10 ?? a.preco_diesel ?? 9999;
      const pb = b.preco_diesel_s10 ?? b.preco_diesel ?? 9999;
      if (pa !== pb) return pa - pb;
      return a.distancia - b.distancia;
    }
    // distância, mas com preço primeiro
    const aP = temPreco(a) ? 0 : 1;
    const bP = temPreco(b) ? 0 : 1;
    if (aP !== bP) return aP - bP;
    return a.distancia - b.distancia;
  });

  const melhorDiesel = comPreco.reduce((min, p) => {
    const v = p.preco_diesel_s10 ?? p.preco_diesel;
    if (!v) return min;
    return min === null || v < min ? v : min;
  }, null);

  const melhorArla = comPreco.reduce((min, p) => {
    if (!p.preco_arla) return min;
    return min === null || p.preco_arla < min ? p.preco_arla : min;
  }, null);

  const raioMostradoKm = Math.round((raioEfetivo || raio) / 1000);

  return (
    <div className="postos-painel">
      {/* Header */}
      <div className="postos-header">
        <button className="btn-voltar-postos" onClick={onFechar}>← Voltar</button>
        <div className="postos-header-info">
          {veiculo && <span className="postos-veiculo-placa">{formatarPlaca(veiculo.placa)}</span>}
          <span className="postos-titulo">⛽ Postos Credenciados CTF</span>
        </div>
      </div>

      {/* Controles */}
      <div className="postos-controles">
        <select
          className="postos-raio-select"
          value={raio}
          onChange={(e) => onRaioChange(parseInt(e.target.value))}
        >
          <option value={10000}>10 km</option>
          <option value={20000}>20 km</option>
          <option value={30000}>30 km</option>
          <option value={50000}>50 km</option>
          <option value={100000}>100 km</option>
        </select>

        <div className="postos-ordem-toggle">
          <button
            className={`postos-ordem-btn${ordem === 'distancia' ? ' ativo' : ''}`}
            onClick={() => setOrdem('distancia')}
          >
            Distância
          </button>
          <button
            className={`postos-ordem-btn${ordem === 'preco' ? ' ativo' : ''}`}
            onClick={() => setOrdem('preco')}
          >
            Menor Preço
          </button>
        </div>
      </div>

      {/* Filtro com preço */}
      <div className="postos-filtro-bar">
        <button
          className={`postos-filtro-btn${apenasComPreco ? ' ativo' : ''}`}
          onClick={() => setApenasComPreco(true)}
        >
          Com preço <span className="postos-filtro-count">{comPreco.length}</span>
        </button>
        <button
          className={`postos-filtro-btn${!apenasComPreco ? ' ativo' : ''}`}
          onClick={() => setApenasComPreco(false)}
        >
          Todos <span className="postos-filtro-count">{postos.length}</span>
        </button>
      </div>

      {/* Aviso de raio expandido automaticamente */}
      {expandiuAuto && raioMostradoKm > Math.round(raio / 1000) && (
        <div className="postos-aviso-expansao">
          🔎 Raio expandido para <strong>{raioMostradoKm} km</strong> — não havia postos
          com preço cadastrado dentro de {Math.round(raio / 1000)} km.
        </div>
      )}

      {/* Conteúdo */}
      {carregando ? (
        <div className="postos-loading">
          <div className="postos-loading-spinner" />
          <p>Buscando postos credenciados...</p>
        </div>
      ) : erro ? (
        <div className="postos-erro">⚠️ {erro}</div>
      ) : postosOrdenados.length === 0 ? (
        <div className="postos-vazio">
          <span>⛽</span>
          {apenasComPreco && postos.length > 0 ? (
            <>
              <p>Nenhum posto com preço cadastrado neste raio</p>
              <small>{semPreco.length} postos credenciados encontrados (sem preço bomba publicado)</small>
              <button
                className="postos-ver-todos-btn"
                onClick={() => setApenasComPreco(false)}
              >
                Ver {postos.length} postos credenciados
              </button>
            </>
          ) : (
            <p>Nenhum posto credenciado CTF neste raio</p>
          )}
        </div>
      ) : (
        <div className="postos-lista">
          {postosOrdenados.map((posto) => {
            const pTemPreco = temPreco(posto);
            const eOmelhorDiesel =
              melhorDiesel !== null &&
              (posto.preco_diesel === melhorDiesel || posto.preco_diesel_s10 === melhorDiesel);
            const eOmelhorArla = melhorArla !== null && posto.preco_arla === melhorArla;
            const eOmelhor = eOmelhorDiesel || eOmelhorArla;
            const eSelecionado = posto.id === postoSelecionadoId;
            const aprox = posto.geocoded_por !== 'endereco';

            return (
              <div
                key={posto.id}
                className={`posto-card${eSelecionado ? ' selecionado' : ''}${eOmelhor ? ' melhor-preco' : ''}${!pTemPreco ? ' sem-preco-card' : ''}`}
                onClick={() => onPostoClick(posto)}
              >
                <div className="posto-card-resumo">
                  <div className="posto-info">
                    <span className="posto-nome">{posto.nome}</span>
                    {posto.endereco && (
                      <span className="posto-end" title={posto.endereco}>{posto.endereco}</span>
                    )}
                  </div>

                  <div className="posto-meta">
                    <span className="posto-distancia" title={aprox ? 'Localização aproximada (centroide da cidade)' : 'Localização exata (geocoding por endereço)'}>
                      {aprox && <span className="posto-aprox">≈</span>}
                      {formatarDistancia(posto.distancia)}
                    </span>
                    {pTemPreco ? (
                      <div className="posto-precos-mini">
                        {posto.preco_diesel_s10 && (
                          <span className="preco-mini diesel-s10">
                            S10 {formatarPreco(posto.preco_diesel_s10)}
                          </span>
                        )}
                        {posto.preco_diesel && (
                          <span className="preco-mini diesel">
                            D {formatarPreco(posto.preco_diesel)}
                          </span>
                        )}
                        {posto.preco_gasolina && (
                          <span className="preco-mini gasolina">
                            Gas {formatarPreco(posto.preco_gasolina)}
                          </span>
                        )}
                        {posto.preco_arla && (
                          <span className="preco-mini arla">
                            ARLA {formatarPreco(posto.preco_arla)}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="posto-sem-preco">sem preço</span>
                    )}
                    {eOmelhorDiesel && <span className="badge-melhor-preco">Menor diesel</span>}
                    {eOmelhorArla && <span className="badge-melhor-preco arla">Menor ARLA</span>}
                  </div>
                </div>

                <div className="posto-acoes-row">
                  {posto.preco_atualizado && (
                    <span className="posto-preco-data">
                      📋 CTF · {formatarDataCTF(posto.preco_atualizado)}
                    </span>
                  )}
                  {veiculo?.lat && veiculo?.lon && (
                    <div className="posto-nav-btns" onClick={(e) => e.stopPropagation()}>
                      <a
                        className="posto-nav-btn gmaps"
                        href={googleMapsURL(veiculo, posto)}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Abrir rota no Google Maps"
                      >
                        🧭 Rota
                      </a>
                      <a
                        className="posto-nav-btn waze"
                        href={wazeURL(posto)}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Abrir no Waze"
                      >
                        Waze
                      </a>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Rodapé informativo */}
      {!carregando && !erro && postos.length > 0 && (
        <div className="postos-footer">
          <span>
            {comPreco.length} c/ preço · {semPreco.length} s/ preço
          </span>
          {geocodeStatus?.porEndereco > 0 && (
            <span title="Postos com geocoding por endereço (não-aproximado)">
              📍 {geocodeStatus.porEndereco} exatos
            </span>
          )}
        </div>
      )}
    </div>
  );
}
