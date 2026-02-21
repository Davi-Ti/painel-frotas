import { useState, useMemo } from 'react';
import {
  formatarPlaca, formatarKM, formatarDataHora, formatarTemp, tempoAtras,
  corDoStatus, corDoSeverity, labelSeverity,
} from '../utils/helpers';

// Conta apenas alertas não-informativos de um veículo
function alertasReais(v) {
  return v.eventos.filter((e) => e.severity !== 'info');
}

// ─── COLUNAS ───────────────────────────────────────────────────
// Para adicionar ou remover uma coluna, edite somente este array.
// key       → identificador único
// label     → texto do cabeçalho
// width     → largura CSS (px, %, auto)
// className → classe do <td> (opcional, para estilos específicos)
// thClass   → classe extra do <th> (opcional)
// render    → (veiculo, ctx) => conteúdo da célula
const COLUNAS = [
  {
    key: 'placa',
    label: 'Placa',
    width: '50px',
    className: 'td-placa',
    render: (v) => formatarPlaca(v.placa),
  },
  {
    key: 'bloqueado',
    label: '🔒',
    width: '12px',
    className: 'td-bloqueado mobile-hide',
    thClass: 'mobile-hide',
    render: (v) => {
      const bloq = v.eventos?.some((e) => e.codigo === 'evt3');
      return bloq
        ? <span className="bloq-sim" title="Veículo bloqueado">🔒</span>
        : <span className="bloq-nao" title="Desbloqueado">🔓</span>;
    },
  },
  {
    key: 'status',
    label: 'Status',
    width: '105px',
    render: (v) => (
      <span
        className="badge-status"
        style={{ background: corDoStatus(v.status) + '22', color: corDoStatus(v.status) }}
      >
        {v.statusTexto}
      </span>
    ),
  },
  {
    key: 'motorista',
    label: 'Motorista',
    width: '13%',
    className: 'td-motorista',
    render: (v) => v.motorista || '—',
  },
  {
    key: 'local',
    label: 'Local',
    width: '15%',
    className: 'td-local',
    render: (v) => (
      <>
        {v.municipio || '—'}{v.uf ? `/${v.uf}` : ''}
        {v.rodovia && <small className="td-rodovia">{v.rodovia}</small>}
        {!v.rodovia && v.rua && <small className="td-rodovia">{v.rua}</small>}
      </>
    ),
  },
  {
    key: 'velocidade',
    label: 'Vel.',
    width: '44px',
    className: 'td-vel',
    render: (v) =>
      v.velocidade !== null ? (
        <span style={{ color: v.velocidade > 90 ? '#ef4444' : v.velocidade > 0 ? '#10b981' : '#94a3b8' }}>
          {v.velocidade}
        </span>
      ) : '—',
  },
  {
    key: 'km',
    label: 'KM',
    width: '88px',
    className: 'td-km mobile-hide',
    thClass: 'th-km mobile-hide',
    render: (v) => <strong>{formatarKM(v.odometro)}</strong>,
  },
  {
    key: 'ignicao',
    label: 'Ign.',
    width: '48px',
    className: 'td-ignicao',
    render: (v) => {
      if (v.ignicao === true) return <span className="ign-on">● ON</span>;
      if (v.ignicao === false) return <span className="ign-off">● OFF</span>;
      return <span className="ign-na">—</span>;
    },
  },
  {
    key: 'rpm',
    label: 'RPM',
    width: '56px',
    className: 'td-rpm mobile-hide',
    thClass: 'mobile-hide',
    render: (v) =>
      v.rpm != null ? (
        <span style={{ color: v.rpm > 3000 ? '#ef4444' : v.rpm > 0 ? '#94a3b8' : '#64748b' }}>
          {v.rpm.toLocaleString('pt-BR')}
        </span>
      ) : '—',
  },
  {
    key: 'temp',
    label: 'Temp.',
    width: '56px',
    className: 'td-temp mobile-hide',
    thClass: 'mobile-hide',
    render: (v) => {
      const temps = [v.temperatura1, v.temperatura2, v.temperatura3].filter((t) => t != null);
      return temps.length === 0 ? '—' : temps.map(formatarTemp).join(' / ');
    },
  },
  {
    key: 'carreta',
    label: 'Carreta',
    width: '40px',
    className: 'td-carreta mobile-hide',
    thClass: 'mobile-hide',
    render: (v) => v.carreta || '—',
  },
  {
    key: 'alertas',
    label: 'Alertas',
    width: '120px',
    className: 'td-alertas',
    render: (v, { expandido }) => {
      const reais = alertasReais(v);
      const alertaMedio = reais.length - v.alertaCritico - v.alertaAlto;
      if (reais.length === 0) return <span style={{ color: '#10b981' }}>✅</span>;
      return (
        <div className="alertas-cell">
          {v.alertaCritico > 0 && <span className="alerta-count critico">{v.alertaCritico} 🚨</span>}
          {v.alertaAlto > 0 && <span className="alerta-count alto">{v.alertaAlto} ⚠️</span>}
          {alertaMedio > 0 && <span className="alerta-count medio">{alertaMedio} 🔔</span>}
          {expandido === v.veiID && (
            <div className="alertas-expandido">
              {v.eventos.map((e, i) => (
                <div key={i} className="alerta-expandido-item" style={{ borderLeftColor: corDoSeverity(e.severity) }}>
                  {e.icone} {e.descricao}
                  <span style={{ color: corDoSeverity(e.severity), marginLeft: 6 }}>[{labelSeverity(e.severity)}]</span>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    },
  },
  {
    key: 'atualizacao',
    label: 'Atualiz.',
    width: '60px',
    className: 'td-atualizacao',
    render: (v) => (
      <>
        <span>{formatarDataHora(v.dataHora)}</span>
        {v.dataHora && <small className="tempo-atras">{tempoAtras(v.dataHora)}</small>}
      </>
    ),
  },
];

// ─── FILTROS ───────────────────────────────────────────────────
// Para adicionar ou remover um filtro, edite somente este array.
// Filtros com matchFn usam lógica própria; os demais filtram por v.status === chave.
const FILTROS = [
  { chave: 'todos',         label: 'Todos' },
  { chave: 'em-movimento',  label: '🟢 Movimento' },
  { chave: 'ign-ligada',    label: '🟡 Ign. Ligada' },
  { chave: 'parado',        label: '🔵 Parados' },
  { chave: 'sem-sinal',     label: '⚫ Sem Sinal' },
  { chave: 'alertas',       label: '🚨 Alertas',       matchFn: (v) => alertasReais(v).length > 0 },
  { chave: 'criticos',      label: '🔴 Críticos',      matchFn: (v) => v.alertaCritico > 0 },
  { chave: 'vel-alta',      label: '🏎️ >80 km/h',     matchFn: (v) => v.velocidade != null && v.velocidade > 80 },
  { chave: 'rpm-alto',      label: '🔧 RPM Alto',      matchFn: (v) => v.rpm != null && v.rpm > 2500 },
  { chave: 'com-temp',      label: '🌡️ Com Temp.',     matchFn: (v) => v.temperatura1 != null || v.temperatura2 != null || v.temperatura3 != null },
  { chave: 'sem-motorista', label: '👤 S/ Motorista',   matchFn: (v) => !v.motorista },
];

export default function TabelaView({ veiculos, filtroStatus, setFiltroStatus }) {
  const [busca, setBusca] = useState('');
  const [expandido, setExpandido] = useState(null);

  const lista = useMemo(() => {
    const filtroAtivo = FILTROS.find((f) => f.chave === filtroStatus);

    const filtrados = veiculos.filter((v) => {
      if (filtroAtivo?.matchFn && !filtroAtivo.matchFn(v)) return false;
      if (!filtroAtivo?.matchFn && filtroStatus !== 'todos' && v.status !== filtroStatus) return false;

      if (busca) {
        const t = busca.toLowerCase();
        return [v.placa, v.motorista, v.municipio, v.uf, v.rodovia]
          .some((c) => c && c.toLowerCase().includes(t));
      }
      return true;
    });

    const peso = { 'em-movimento': 1, 'ign-ligada': 3, 'parado': 4, 'sem-sinal': 6 };
    filtrados.sort((a, b) => {
      const pa = peso[a.status] || 5;
      const pb = peso[b.status] || 5;
      if (pa !== pb) return pa - pb;
      const ar = alertasReais(a).length;
      const br = alertasReais(b).length;
      if (ar !== br) return br - ar;
      return (b.velocidade || 0) - (a.velocidade || 0);
    });

    return filtrados;
  }, [veiculos, busca, filtroStatus]);

  const ctx = { expandido, setExpandido };

  // Renderiza card mobile expandível para um veículo
  function renderMobileCard(v) {
    const reais = alertasReais(v);
    const aberto = expandido === v.veiID;
    const bloq = v.eventos?.some((e) => e.codigo === 'evt3');
    const temps = [v.temperatura1, v.temperatura2, v.temperatura3].filter((t) => t != null);

    return (
      <div
        key={v.veiID}
        className={`mob-card ${v.alertaCritico > 0 ? 'mob-critico' : ''} ${aberto ? 'mob-aberto' : ''}`}
        onClick={() => setExpandido(aberto ? null : v.veiID)}
      >
        {/* Linha resumo — sempre visível */}
        <div className="mob-resumo">
          <span className="mob-placa">{formatarPlaca(v.placa)}</span>
          <span className="mob-status-dot" style={{ background: corDoStatus(v.status) }}
            title={v.statusTexto} />
          <span className="mob-local">{v.municipio || '—'}{v.uf ? `/${v.uf}` : ''}</span>
          <span className="mob-vel">
            {v.velocidade != null ? `${v.velocidade} km/h` : '—'}
          </span>
          {reais.length > 0 && (
            <span className="mob-alerta-badge">{reais.length}⚠</span>
          )}
          <span className="mob-chevron">{aberto ? '▲' : '▼'}</span>
        </div>

        {/* Detalhes expandidos */}
        {aberto && (
          <div className="mob-detalhe">
            <div className="mob-detalhe-grid">
              <div className="mob-campo">
                <span className="mob-campo-label">Status</span>
                <span className="badge-status" style={{ background: corDoStatus(v.status) + '22', color: corDoStatus(v.status) }}>
                  {v.statusTexto}
                </span>
              </div>
              <div className="mob-campo">
                <span className="mob-campo-label">Motorista</span>
                <span>{v.motorista || 'Sem motorista'}</span>
              </div>
              <div className="mob-campo">
                <span className="mob-campo-label">Ignição</span>
                <span>{v.ignicao === true ? <span className="ign-on">● ON</span> : v.ignicao === false ? <span className="ign-off">● OFF</span> : '—'}</span>
              </div>
              <div className="mob-campo">
                <span className="mob-campo-label">Bloqueio</span>
                <span>{bloq ? '🔒 Bloqueado' : '🔓 Livre'}</span>
              </div>
              <div className="mob-campo">
                <span className="mob-campo-label">Odômetro</span>
                <span>{formatarKM(v.odometro)}</span>
              </div>
              <div className="mob-campo">
                <span className="mob-campo-label">RPM</span>
                <span>{v.rpm != null ? v.rpm.toLocaleString('pt-BR') : '—'}</span>
              </div>
              {temps.length > 0 && (
                <div className="mob-campo">
                  <span className="mob-campo-label">Temperatura</span>
                  <span>{temps.map(formatarTemp).join(' / ')}</span>
                </div>
              )}
              {v.carreta && (
                <div className="mob-campo">
                  <span className="mob-campo-label">Carreta</span>
                  <span>{v.carreta}</span>
                </div>
              )}
              <div className="mob-campo">
                <span className="mob-campo-label">Local</span>
                <span>{v.municipio || '—'}{v.uf ? `/${v.uf}` : ''}{v.rodovia ? ` — ${v.rodovia}` : v.rua ? ` — ${v.rua}` : ''}</span>
              </div>
              <div className="mob-campo">
                <span className="mob-campo-label">Atualização</span>
                <span>{formatarDataHora(v.dataHora)} {v.dataHora ? `(${tempoAtras(v.dataHora)})` : ''}</span>
              </div>
            </div>

            {/* Alertas */}
            {reais.length > 0 && (
              <div className="mob-alertas">
                <span className="mob-campo-label">Alertas ({reais.length})</span>
                {v.eventos.map((e, i) => (
                  <div key={i} className="alerta-expandido-item" style={{ borderLeftColor: corDoSeverity(e.severity) }}>
                    {e.icone} {e.descricao}
                    <span style={{ color: corDoSeverity(e.severity), marginLeft: 6 }}>[{labelSeverity(e.severity)}]</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="tabela-container">
      <div className="tabela-filtros">
        <input
          type="text"
          placeholder="🔍 Buscar placa, motorista, cidade..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
        {FILTROS.map((f) => (
          <button
            key={f.chave}
            className={`filtro-btn ${filtroStatus === f.chave ? 'ativo' : ''}`}
            onClick={() => setFiltroStatus(f.chave)}
          >
            {f.label}
          </button>
        ))}
        <span className="filtro-contador">{lista.length}/{veiculos.length}</span>
      </div>

      {/* Mobile: lista de cards */}
      <div className="mob-lista">
        {lista.map((v) => renderMobileCard(v))}
        {lista.length === 0 && <div className="td-vazio">Nenhum veículo encontrado</div>}
      </div>

      {/* Desktop: tabela normal */}
      <div className="tabela-scroll desk-only">
        <table>
          <colgroup>
            {COLUNAS.map((col) => (
              <col key={col.key} style={{ width: col.width }} className={col.thClass || ''} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {COLUNAS.map((col) => (
                <th key={col.key} className={col.thClass || ''}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lista.map((v) => {
              const reais = alertasReais(v);
              return (
                <tr
                  key={v.veiID}
                  className={`${v.alertaCritico > 0 ? 'tr-critico' : ''} ${reais.length > 0 ? 'tr-alerta' : ''}`}
                  onClick={() => setExpandido(expandido === v.veiID ? null : v.veiID)}
                >
                  {COLUNAS.map((col) => (
                    <td key={col.key} className={col.className || ''}>
                      {col.render(v, ctx)}
                    </td>
                  ))}
                </tr>
              );
            })}

            {lista.length === 0 && (
              <tr>
                <td colSpan={COLUNAS.length} className="td-vazio">
                  Nenhum veículo encontrado
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
