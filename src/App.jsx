import { useState, useEffect, useRef } from 'react';
import Header from './components/Header';
import KpiBar from './components/KpiBar';
import MapaView from './components/MapaView';
import TabelaView from './components/TabelaView';
import InsightsView from './components/InsightsView';
import useFleetData from './hooks/useFleetData';

const TELAS = ['mapa', 'tabela', 'insights'];

export default function App() {
  const [telaAtiva, setTelaAtiva] = useState('mapa');
  const [autoCiclo, setAutoCiclo] = useState(false);
  const [fitCounter, setFitCounter] = useState(0);
  const [filtroTabela, setFiltroTabela] = useState('todos');
  const { dados, carregando, erro } = useFleetData();

  // Troca de tela a cada 25s quando auto-ciclo ativo
  useEffect(() => {
    if (!autoCiclo) return;
    const intervalo = setInterval(() => {
      setTelaAtiva((atual) => {
        const i = TELAS.indexOf(atual);
        const proxima = TELAS[(i + 1) % TELAS.length];
        // Quando volta pro mapa, força auto-fit
        if (proxima === 'mapa') {
          setFitCounter((c) => c + 1);
        }
        return proxima;
      });
    }, 25000);
    return () => clearInterval(intervalo);
  }, [autoCiclo]);

  // Tela de carregamento
  if (carregando && !dados) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <p>Conectando à API Trucks Control...</p>
      </div>
    );
  }

  // Tela de erro
  if (erro && !dados) {
    return (
      <div className="loading-screen erro">
        <p>Erro ao conectar: {erro}</p>
        <p className="dica">Verifique se o servidor está rodando (node server.js)</p>
      </div>
    );
  }

  if (!dados) return null;

  // Conta alertas críticos para o badge do header
  const totalCriticos = dados.estatisticas.alertasCriticos || 0;

  return (
    <div className="app">
      <Header
        telaAtiva={telaAtiva}
        setTelaAtiva={setTelaAtiva}
        autoCiclo={autoCiclo}
        setAutoCiclo={setAutoCiclo}
        ultimaAtualizacao={dados.ultimaAtualizacao}
        alertasCriticos={totalCriticos}
        onCriticosClick={() => {
          setFiltroTabela('criticos');
          setTelaAtiva('tabela');
        }}
      />

      <KpiBar
        estatisticas={dados.estatisticas}
        onKpiClick={(filtro) => {
          setFiltroTabela(filtro);
          setTelaAtiva('tabela');
        }}
      />

      <main className="conteudo">
        {telaAtiva === 'mapa' && (
          <MapaView veiculos={dados.veiculos} estatisticas={dados.estatisticas} fitCounter={fitCounter} />
        )}
        {telaAtiva === 'tabela' && (
          <TabelaView veiculos={dados.veiculos} filtroStatus={filtroTabela} setFiltroStatus={setFiltroTabela} />
        )}
        {telaAtiva === 'insights' && (
          <InsightsView veiculos={dados.veiculos} estatisticas={dados.estatisticas} />
        )}
      </main>
    </div>
  );
}
