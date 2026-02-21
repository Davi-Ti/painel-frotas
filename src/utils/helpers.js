// Formata placa: "ABC1D23" → "ABC-1D23"
export function formatarPlaca(placa) {
  if (!placa || placa.trim() === '') return 'S/Placa';
  if (placa.includes('-')) return placa.toUpperCase();
  if (placa.length === 7) return `${placa.slice(0, 3)}-${placa.slice(3)}`.toUpperCase();
  return placa.toUpperCase();
}

// Formata KM: 123456 → "123.456 km"
export function formatarKM(km) {
  if (km == null) return '---';
  return `${Number(km).toLocaleString('pt-BR')} km`;
}

// Formata temperatura: 25 → "25°C"
export function formatarTemp(temp) {
  if (temp == null) return '---';
  return `${temp}°C`;
}

// Formata data/hora: "05/01/2025 14:30:00" → "05/01 14:30"
export function formatarDataHora(dataHora) {
  if (!dataHora) return '---';
  if (dataHora.includes('/')) {
    const [data, hora] = dataHora.split(' ');
    return `${data.slice(0, 5)} ${hora ? hora.slice(0, 5) : ''}`.trim();
  }
  try {
    return new Date(dataHora).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  } catch { return dataHora; }
}

// Tempo relativo: "há 5 min", "há 2h"
export function tempoAtras(dataHora) {
  if (!dataHora) return '';
  let ts;
  if (dataHora.includes('/')) {
    const [d, h] = dataHora.split(' ');
    const [dia, mes, ano] = d.split('/');
    ts = new Date(`${ano}-${mes}-${dia}T${h || '00:00:00'}`);
  } else {
    ts = new Date(dataHora);
  }
  if (isNaN(ts.getTime())) return '';
  const seg = Math.floor((Date.now() - ts.getTime()) / 1000);
  if (seg < 60) return 'agora';
  if (seg < 3600) return `há ${Math.floor(seg / 60)} min`;
  if (seg < 86400) return `há ${Math.floor(seg / 3600)}h`;
  return `há ${Math.floor(seg / 86400)} dia(s)`;
}

// Cores por status
export function corDoStatus(status) {
  return {
    'em-movimento': '#10b981',
    'ign-ligada':   '#f59e0b',
    'parado':       '#1436a6',
    'indeterminado':'#8b5cf6',
    'sem-sinal':    '#6b7280',
  }[status] || '#6b7280';
}

// Cores por severidade
export function corDoSeverity(sev) {
  return { critico: '#c9331b', alto: '#f97316', medio: '#eab308', info: '#1436a6' }[sev] || '#6b7280';
}

// Label da severidade
export function labelSeverity(sev) {
  return { critico: 'CRÍTICO', alto: 'ALTO', medio: 'MÉDIO', info: 'INFO' }[sev] || sev;
}
