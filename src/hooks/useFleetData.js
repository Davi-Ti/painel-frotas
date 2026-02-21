import { useState, useEffect, useRef } from 'react';

const INTERVALO = 30 * 1000;

export default function useFleetData() {
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const intervaloRef = useRef(null);

  useEffect(() => {
    async function buscar() {
      try {
        const resposta = await fetch('/api/frota');

        if (!resposta.ok) {
          throw new Error(`Servidor retornou ${resposta.status}`);
        }

        const json = await resposta.json();
        setDados(json);
        setErro(null);
      } catch (err) {
        console.error('[useFleetData] Erro:', err.message);
        setErro(err.message);
        // Mantém último dado válido em caso de falha
      } finally {
        setCarregando(false);
      }
    }

    buscar();

    intervaloRef.current = setInterval(buscar, INTERVALO);

    return () => {
      if (intervaloRef.current) {
        clearInterval(intervaloRef.current);
      }
    };
  }, []);

  return { dados, carregando, erro };
}
