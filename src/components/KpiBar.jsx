export default function KpiBar({ estatisticas, onKpiClick }) {
  if (!estatisticas) return null;

  // filtro = chave usada no TabelaView ao clicar no card
  const kpis = [
    { label: 'Frota Total',   valor: estatisticas.total,           icone: '🚛', cor: 'azul',     filtro: 'todos' },
    { label: 'Em Movimento',  valor: estatisticas.emMovimento,     icone: '✅', cor: 'verde',    filtro: 'em-movimento' },
    { label: 'Ign. Ligada',   valor: estatisticas.ignicaoLigada,   icone: '🔑', cor: 'amarelo',  filtro: 'ign-ligada' },
    { label: 'Parados',       valor: estatisticas.parado,          icone: '🅿️', cor: 'azul',     filtro: 'parado' },
    { label: 'Sem Sinal',     valor: estatisticas.semSinal,        icone: '📡', cor: 'cinza',    filtro: 'sem-sinal' },
    { label: 'Alertas',       valor: estatisticas.alertas,         icone: '⚠️', cor: estatisticas.alertas > 0 ? 'vermelho' : 'verde', filtro: 'alertas' },
    { label: 'Críticos',      valor: estatisticas.alertasCriticos || 0, icone: '🚨', cor: (estatisticas.alertasCriticos || 0) > 0 ? 'vermelho' : 'verde', filtro: 'criticos' },
  ];

  return (
    <div className="kpi-bar">
      {kpis.map((kpi) => (
        <div
          key={kpi.label}
          className={`kpi-card ${kpi.cor}`}
          onClick={() => onKpiClick?.(kpi.filtro)}
          title={`Clique para ver detalhes: ${kpi.label}`}
        >
          <div className={`kpi-icone ${kpi.cor}`}>{kpi.icone}</div>
          <div className="kpi-info">
            <div className="kpi-valor">{kpi.valor}</div>
            <div className="kpi-label">{kpi.label}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
