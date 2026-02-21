import { useState, useEffect } from 'react';

export default function Header({
  telaAtiva,
  setTelaAtiva,
  autoCiclo,
  setAutoCiclo,
  ultimaAtualizacao,
  alertasCriticos,
  onCriticosClick,
}) {
  const [horaAtual, setHoraAtual] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setHoraAtual(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const horaFormatada = horaAtual.toLocaleTimeString('pt-BR');

  const atualizacaoTexto = ultimaAtualizacao
    ? `Atualizado ${new Date(ultimaAtualizacao).toLocaleTimeString('pt-BR')}`
    : 'Aguardando...';

  return (
    <header className="header">
      <div className="header-esquerda">
        <div className="logo">
          <img
            src="https://i.imgur.com/bO5gsAW.png"
            alt="Logo"
            className="logo-img"
          />
          <span className="logo-divider" />
          <span className="logo-texto">
            Painel <strong>Frotas</strong>
          </span>
        </div>

        {/* Badge de alertas críticos — clicável */}
        {alertasCriticos > 0 && (
          <div
            className="alerta-badge-header"
            onClick={() => onCriticosClick?.()}
            title="Ver veículos com alertas críticos"
          >
            🚨 {alertasCriticos} CRÍTICO{alertasCriticos > 1 ? 'S' : ''}
          </div>
        )}
      </div>

      <nav className="header-abas">
        <button
          className={telaAtiva === 'mapa' ? 'ativa' : ''}
          onClick={() => setTelaAtiva('mapa')}
        >
          🗺️ Mapa
        </button>
        <button
          className={telaAtiva === 'tabela' ? 'ativa' : ''}
          onClick={() => setTelaAtiva('tabela')}
        >
          📋 Operacional
        </button>
        <button
          className={telaAtiva === 'insights' ? 'ativa' : ''}
          onClick={() => setTelaAtiva('insights')}
        >
          📊 Inteligência
        </button>
      </nav>

      <div className="header-direita">
        <label className="auto-ciclo">
          <input
            type="checkbox"
            checked={autoCiclo}
            onChange={(e) => setAutoCiclo(e.target.checked)}
          />
          TV Auto
        </label>
        <div className="header-tempo">
          <span className="relogio">{horaFormatada}</span>
          <span className="atualizacao">{atualizacaoTexto}</span>
        </div>
      </div>
    </header>
  );
}
