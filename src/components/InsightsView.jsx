import { useMemo } from 'react';
import {
  formatarPlaca, formatarKM, tempoAtras,
  corDoSeverity, labelSeverity,
} from '../utils/helpers';

export default function InsightsView({ veiculos, estatisticas }) {

  const utilizacao = useMemo(() => {
    const total = veiculos.length || 1;
    const mov = veiculos.filter((v) => v.status === 'em-movimento').length;
    const ign = veiculos.filter((v) => v.status === 'ign-ligada').length;
    const par = veiculos.filter((v) => v.status === 'parado').length;
    const sem = total - mov - ign - par;
    const pct = (n) => ((n / total) * 100).toFixed(0);
    return { mov, ign, par, sem, pctMov: pct(mov), pctIgn: pct(ign), pctPar: pct(par), pctSem: pct(sem) };
  }, [veiculos]);

  const porUF = useMemo(() => {
    const mapa = {};
    veiculos.forEach((v) => { mapa[v.uf || 'S/I'] = (mapa[v.uf || 'S/I'] || 0) + 1; });
    return Object.entries(mapa).sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [veiculos]);
  const maxUF = porUF[0]?.[1] || 1;

  const alertasPorSev = useMemo(() => {
    const c = { critico: 0, alto: 0, medio: 0, info: 0 };
    veiculos.forEach((v) => v.eventos.forEach((e) => { if (c[e.severity] !== undefined) c[e.severity]++; }));
    return c;
  }, [veiculos]);

  const alertasPorTipo = useMemo(() => {
    const mapa = {};
    veiculos.forEach((v) => v.eventos.forEach((e) => {
      if (!mapa[e.descricao]) mapa[e.descricao] = { ...e, qtd: 0 };
      mapa[e.descricao].qtd++;
    }));
    return Object.values(mapa).sort((a, b) => b.qtd - a.qtd).slice(0, 8);
  }, [veiculos]);

  const frotaKM = useMemo(() => {
    return veiculos.filter((v) => v.odometro > 0).sort((a, b) => b.odometro - a.odometro);
  }, [veiculos]);
  const kmTotal = frotaKM.reduce((a, v) => a + v.odometro, 0);

  const topVelocidades = useMemo(() => {
    return veiculos.filter((v) => v.velocidade > 0).sort((a, b) => b.velocidade - a.velocidade).slice(0, 10);
  }, [veiculos]);
  const velMedia = topVelocidades.length > 0
    ? Math.round(topVelocidades.reduce((a, v) => a + v.velocidade, 0) / topVelocidades.length)
    : 0;
  const acima90 = veiculos.filter((v) => v.velocidade > 90).length;

  const paradosIgn = useMemo(() => {
    return veiculos.filter((v) => v.status === 'ign-ligada');
  }, [veiculos]);

  return (
    <div className="insights-container">

      <div className="insights-row indicadores-row">
        <div className="insight-mini-card">
          <div className="mini-valor">{((utilizacao.mov / (veiculos.length || 1)) * 100).toFixed(0)}<small>%</small></div>
          <div className="mini-label">Frota em Operação</div>
        </div>
        <div className="insight-mini-card">
          <div className="mini-valor">{velMedia} <small>km/h</small></div>
          <div className="mini-label">Velocidade Média</div>
        </div>
        <div className={`insight-mini-card ${acima90 > 0 ? 'destaque-vermelho' : ''}`}>
          <div className="mini-valor">{acima90}</div>
          <div className="mini-label">Acima 90 km/h</div>
        </div>
        <div className={`insight-mini-card ${paradosIgn.length > 0 ? 'destaque-amarelo' : ''}`}>
          <div className="mini-valor">{paradosIgn.length}</div>
          <div className="mini-label">Parado c/ Ign. Ligada</div>
        </div>
        <div className="insight-mini-card">
          <div className="mini-valor">{formatarKM(Math.round(kmTotal / (frotaKM.length || 1)))}</div>
          <div className="mini-label">KM Médio da Frota</div>
        </div>
      </div>

      <div className="insights-row insights-row-3">

        {/* Card: Utilização + UF */}
        <div className="insight-card">
          <h3>📊 Utilização da Frota</h3>
          <div className="utilizacao-chart">
            <div className="util-barra-container">
              <div className="util-barra-segmento verde" style={{ width: `${utilizacao.pctMov}%` }} title={`Movimento: ${utilizacao.mov}`} />
              <div className="util-barra-segmento amarelo" style={{ width: `${utilizacao.pctIgn}%` }} title={`Ign. Ligada: ${utilizacao.ign}`} />
              <div className="util-barra-segmento azul" style={{ width: `${utilizacao.pctPar}%` }} title={`Parados: ${utilizacao.par}`} />
              <div className="util-barra-segmento cinza" style={{ width: `${utilizacao.pctSem}%` }} title={`Sem Sinal: ${utilizacao.sem}`} />
            </div>
            <div className="util-legenda">
              <span className="util-item"><span className="dot verde" />{utilizacao.pctMov}% Movimento ({utilizacao.mov})</span>
              <span className="util-item"><span className="dot amarelo" />{utilizacao.pctIgn}% Ign. Ligada ({utilizacao.ign})</span>
              <span className="util-item"><span className="dot azul" />{utilizacao.pctPar}% Parados ({utilizacao.par})</span>
              <span className="util-item"><span className="dot cinza" />{utilizacao.pctSem}% Sem Sinal ({utilizacao.sem})</span>
            </div>
          </div>

          <h4 className="insight-subtitle">📍 Distribuição por UF</h4>
          <div className="uf-bars">
            {porUF.map(([uf, qtd]) => (
              <div key={uf} className="uf-bar-row">
                <span className="uf-label">{uf}</span>
                <div className="uf-bar-track">
                  <div className="uf-bar-fill" style={{ width: `${(qtd / maxUF) * 100}%` }} />
                </div>
                <span className="uf-count">{qtd}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Card: Alertas */}
        <div className="insight-card">
          <h3>🚨 Alertas por Severidade</h3>
          <div className="alerta-severity-grid">
            {['critico', 'alto', 'medio', 'info'].map((sev) => (
              <div key={sev} className="sev-card" style={{ borderColor: corDoSeverity(sev) }}>
                <div className="sev-valor" style={{ color: corDoSeverity(sev) }}>{alertasPorSev[sev]}</div>
                <div className="sev-label">{labelSeverity(sev)}</div>
              </div>
            ))}
          </div>
          <h4>Top Ocorrências</h4>
          <div className="alerta-tipo-lista">
            {alertasPorTipo.map((a, i) => (
              <div key={i} className="alerta-tipo-item">
                <span className="alerta-tipo-icone">{a.icone}</span>
                <span className="alerta-tipo-desc">{a.descricao}</span>
                <span className="alerta-tipo-qtd" style={{ color: corDoSeverity(a.severity) }}>{a.qtd}</span>
              </div>
            ))}
            {alertasPorTipo.length === 0 && <p className="vazio">Nenhum alerta ativo</p>}
          </div>
        </div>

        {/* Card: Velocidade — Risco */}
        <div className="insight-card">
          <h3>🏎️ Velocidade — Risco</h3>
          <div className="insight-summary">
            <span>Média: <strong>{velMedia} km/h</strong></span>
            <span className={acima90 > 0 ? 'txt-vermelho' : ''}>&gt;90: <strong>{acima90}</strong></span>
          </div>
          <div className="vel-lista">
            {topVelocidades.map((v, i) => {
              const cor = v.velocidade > 110 ? '#c9331b' : v.velocidade > 90 ? '#f97316' : '#10b981';
              return (
                <div key={v.veiID} className="vel-item">
                  <span className="vel-pos">#{i + 1}</span>
                  <span className="vel-placa">{formatarPlaca(v.placa)}</span>
                  <span className="vel-local">{v.municipio || '—'}{v.uf ? `/${v.uf}` : ''}</span>
                  <span className="vel-valor" style={{ color: cor }}>{v.velocidade} km/h</span>
                </div>
              );
            })}
            {topVelocidades.length === 0 && <p className="vazio">Nenhum veículo em movimento</p>}
          </div>
        </div>
      </div>

      <div className="insights-row insights-row-2">

        <div className="insight-card">
          <h3>📏 Odômetro da Frota</h3>
          <div className="insight-summary">
            <span>Total: <strong>{formatarKM(kmTotal)}</strong></span>
            <span>Veículos: <strong>{frotaKM.length}</strong></span>
          </div>
          <div className="odo-lista">
            {frotaKM.map((v) => (
              <div key={v.veiID} className="odo-item">
                <span className="odo-placa">{formatarPlaca(v.placa)}</span>
                <span className="odo-km">{formatarKM(v.odometro)}</span>
                <span className="odo-status"><span className="dot-sm" style={{ background: v.statusCor }} /></span>
                <span className="odo-tempo">{tempoAtras(v.dataHora)}</span>
              </div>
            ))}
            {frotaKM.length === 0 && <p className="vazio">Nenhum odômetro disponível</p>}
          </div>
        </div>

        {/* Card: Parados com Ignição Ligada */}
        <div className="insight-card">
          <h3>⚠️ Parados com Ignição Ligada</h3>
          {paradosIgn.length > 0 ? (
            <div className="desperdicio-lista">
              {paradosIgn.map((v) => (
                <div key={v.veiID} className="desperdicio-item">
                  <span className="desp-placa">{formatarPlaca(v.placa)}</span>
                  <span className="desp-local">{v.municipio || '—'}{v.uf ? `/${v.uf}` : ''}</span>
                  <span className="desp-tempo">{tempoAtras(v.dataHora)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="insight-no-data">
              <p>✅ Nenhum veículo parado com ignição ligada</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
