import { useState } from 'react';
import { formatarPlaca } from '../utils/helpers';

// Frota é diesel — só interessa diesel (todas variantes) e ARLA.
// Outros combustíveis vêm na resposta da API mas não são renderizados.
const COMBUSTIVEIS = {
  diesel_s10:           { label: 'S10',         cls: 'diesel-s10', prioridade: 1, group: 'diesel' },
  diesel:               { label: 'Diesel',      cls: 'diesel',     prioridade: 2, group: 'diesel' },
  diesel_s10_aditivado: { label: 'S10 Adit',    cls: 'diesel-s10', prioridade: 3, group: 'diesel' },
  diesel_aditivado:     { label: 'Diesel Adit', cls: 'diesel',     prioridade: 4, group: 'diesel' },
  diesel_s50:           { label: 'S50',         cls: 'diesel',     prioridade: 5, group: 'diesel' },
  arla:                 { label: 'ARLA',        cls: 'arla',       prioridade: 6, group: 'arla' },
};

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

function idadeRelativa(str) {
  if (!str) return '';
  const m = String(str).match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return '';
  const ts = new Date(+m[3], +m[2] - 1, +m[1]).getTime();
  const dias = Math.floor((Date.now() - ts) / (24 * 60 * 60 * 1000));
  if (dias <= 0) return 'hoje';
  if (dias === 1) return 'ontem';
  if (dias < 7) return `há ${dias}d`;
  if (dias < 30) return `há ${Math.floor(dias / 7)}sem`;
  return `há ${Math.floor(dias / 30)}m`;
}

function listaPrecos(posto) {
  const p = posto.precos || {};
  const fontes = posto.fontes || {};
  return Object.entries(p)
    .map(([k, v]) => ({ key: k, valor: v, fonte: fontes[k] || 'bomba', ...COMBUSTIVEIS[k] }))
    .filter((x) => x.label)
    .sort((a, b) => a.prioridade - b.prioridade);
}

function temPreco(posto) {
  return listaPrecos(posto).length > 0;
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
}) {
  const [ordem, setOrdem] = useState('preco');
  const [apenasComPreco, setApenasComPreco] = useState(true);

  const comPreco = postos.filter(temPreco);
  const semPreco = postos.filter((p) => !temPreco(p));

  const listaFiltrada = apenasComPreco ? comPreco : postos;

  const postosOrdenados = [...listaFiltrada].sort((a, b) => {
    if (ordem === 'preco') {
      const pa = a.precos?.diesel_s10 ?? a.precos?.diesel ?? 9999;
      const pb = b.precos?.diesel_s10 ?? b.precos?.diesel ?? 9999;
      if (pa !== pb) return pa - pb;
      return a.distancia - b.distancia;
    }
    const aP = temPreco(a) ? 0 : 1;
    const bP = temPreco(b) ? 0 : 1;
    if (aP !== bP) return aP - bP;
    return a.distancia - b.distancia;
  });

  // Menor preço por grupo (diesel, gasolina, arla...)
  const melhoresPorGrupo = {};
  comPreco.forEach((p) => {
    listaPrecos(p).forEach(({ valor, group, key }) => {
      // Considera "diesel" e "diesel_s10" do mesmo grupo
      const g = group || key;
      if (!melhoresPorGrupo[g] || valor < melhoresPorGrupo[g].valor) {
        melhoresPorGrupo[g] = { valor, postoId: p.id, key };
      }
    });
  });

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
          🔎 Raio expandido para <strong>{raioMostradoKm} km</strong> — não havia
          postos com preço dentro de {Math.round(raio / 1000)} km.
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
              <small>{semPreco.length} postos credenciados encontrados, mas sem preço bomba publicado</small>
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
            const precos = listaPrecos(posto);
            const pTemPreco = precos.length > 0;
            const eSelecionado = posto.id === postoSelecionadoId;
            const aprox = posto.geocoded_por !== 'endereco';

            // Badges "menor preço" — só quando o posto é vencedor em algum grupo.
            const grupos = [];
            for (const p of precos) {
              const g = p.group || p.key;
              if (melhoresPorGrupo[g]?.postoId === posto.id && !grupos.includes(g)) {
                grupos.push(g);
              }
            }

            return (
              <div
                key={posto.id}
                className={`posto-card${eSelecionado ? ' selecionado' : ''}${grupos.length ? ' melhor-preco' : ''}${!pTemPreco ? ' sem-preco-card' : ''}`}
                onClick={() => onPostoClick(posto)}
              >
                {/* Linha 1: nome + distância */}
                <div className="posto-linha-top">
                  <span className="posto-nome">{posto.nome}</span>
                  <span
                    className="posto-distancia"
                    title={aprox ? 'Localização aproximada (centroide da cidade)' : 'Localização exata (geocoding por endereço)'}
                  >
                    {aprox && <span className="posto-aprox">≈</span>}
                    {formatarDistancia(posto.distancia)}
                  </span>
                </div>

                {/* Linha 2: endereço */}
                {posto.endereco && (
                  <div className="posto-endereco" title={posto.endereco}>{posto.endereco}</div>
                )}

                {/* Linha 3: preços (largura total, vão pra baixo se não couber) */}
                {pTemPreco ? (
                  <div className="posto-precos-grid">
                    {precos.map((p) => (
                      <span
                        key={p.key}
                        className={`preco-chip ${p.cls}${p.fonte === 'acordo' ? ' com-acordo' : ''}`}
                        title={`${p.label}: ${formatarPreco(p.valor)}${p.fonte === 'acordo' ? ' (preço com acordo CTF)' : ' (preço bomba publicado)'}`}
                      >
                        <span className="preco-chip-label">{p.label}</span>
                        <span className="preco-chip-valor">{formatarPreco(p.valor)}</span>
                        {p.fonte === 'acordo' && <span className="preco-chip-fonte" title="Preço com Acordo Especial de Preço (AEP)">★</span>}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="posto-sem-preco-row">sem preço bomba publicado</div>
                )}

                {/* Linha 4: badges de menor preço */}
                {grupos.length > 0 && (
                  <div className="posto-badges">
                    {grupos.map((g) => (
                      <span key={g} className={`badge-melhor-preco ${g}`}>
                        ⭐ menor {g === 'diesel' ? 'diesel' : g === 'arla' ? 'ARLA' : g === 'gasolina' ? 'gasolina' : g}
                      </span>
                    ))}
                  </div>
                )}

                {/* Linha 5: data + botões */}
                <div className="posto-acoes-row">
                  {posto.preco_atualizado && (
                    <span className="posto-preco-data" title={`Última atualização: ${posto.preco_atualizado}`}>
                      📋 {formatarDataCTF(posto.preco_atualizado)} · <em>{idadeRelativa(posto.preco_atualizado)}</em>
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
