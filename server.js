// Servidor Backend — Integração Trucks Control v6.7

'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const fetch = require('node-fetch');
const AdmZip = require('adm-zip');
const zlib = require('zlib');
const { parseStringPromise } = require('xml2js');
const fs = require('fs');

// Configuração

const PORT = process.env.PORT || 3001;
const TC_URL = (process.env.TC_URL || '').trim();
const TC_LOGIN = (process.env.TC_LOGIN || '').trim();
const TC_SENHA = (process.env.TC_SENHA || '').trim();
const TC_URL_VALIDA = /^https?:\/\//i.test(TC_URL);
const CREDENCIAIS_API_OK = Boolean(TC_URL_VALIDA && TC_LOGIN && TC_SENHA);

// Intervalos (ms) — respeitando limites da API
const INTERVALO_MENSAGENS = 35 * 1000;   // API permite 30s min
const INTERVALO_VEICULOS = 5 * 60 * 1000; // API permite 5 min
const TIMEOUT_API = 30 * 1000;

// Logger

const log = {
  info:  (tag, msg) => console.log(`${new Date().toISOString()} [${tag}] ${msg}`),
  warn:  (tag, msg) => console.warn(`${new Date().toISOString()} [${tag}] ⚠ ${msg}`),
  error: (tag, msg) => console.error(`${new Date().toISOString()} [${tag}] ✖ ${msg}`),
};

// Banco de dados em memória + cache em disco

const CACHE_PATH = path.join(__dirname, '.cache-frota.json');

const db = {
  veiculos: {},
  posicoes: {},
  motoristas: {},
  carretas: {},
  ultimoMId: '1',
  ultimaAtualizacao: null,
  contadorCiclos: 0,
};

function carregarCache() {
  try {
    if (fs.existsSync(CACHE_PATH)) {
      const dados = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
      if (dados.veiculos)   db.veiculos = dados.veiculos;
      if (dados.posicoes)   db.posicoes = dados.posicoes;
      if (dados.motoristas) db.motoristas = dados.motoristas;
      if (dados.carretas)   db.carretas = dados.carretas;
      if (dados.ultimoMId)  db.ultimoMId = dados.ultimoMId;

      // Reclassifica eventos do cache com a tabela EVENTOS atual
      // Remove eventos que não existem mais (ex: evt26 Valor Temperatura)
      for (const pos of Object.values(db.posicoes)) {
        if (pos.eventos) {
          pos.eventos = pos.eventos
            .filter((evt) => EVENTOS[evt.codigo])
            .map((evt) => {
              const ref = EVENTOS[evt.codigo];
              return { ...evt, severity: ref.severity, descricao: ref.descricao, icone: ref.icone };
            });
        }
      }

      log.info('Cache', `Carregado: ${Object.keys(db.veiculos).length} veículos, ${Object.keys(db.posicoes).length} posições, ${Object.keys(db.motoristas).length} motoristas`);
    }
  } catch (err) {
    log.warn('Cache', `Falha ao carregar: ${err.message}`);
  }
}

function salvarCache() {
  try {
    const dados = {
      veiculos: db.veiculos,
      posicoes: db.posicoes,
      motoristas: db.motoristas,
      carretas: db.carretas,
      ultimoMId: db.ultimoMId,
      salvoEm: new Date().toISOString(),
    };
    fs.writeFileSync(CACHE_PATH, JSON.stringify(dados));
  } catch (err) {
    log.warn('Cache', `Falha ao salvar: ${err.message}`);
  }
}

// Equipamentos (API v6.7)

const EQUIPAMENTOS = {
  1: 'Satelite System',      2: 'Hybrid System',
  3: 'Light GSM 1',          4: 'Satelite Sky',
  6: 'Smart Híbrido',        7: 'SpyTrack',
  8: 'Smart GSM',            9: 'Slim GSM 1',
  10: 'Light GSM 2',         11: 'Slim GSM 2',
  12: 'Trailer GSM',         13: 'Slim GSM 3',
  14: 'SpyTrack2',           29: 'Rail Patrol',
  33: 'Slim GSM 4',          35: 'Smart2 Híbrido',
  36: 'Smart 2 GSM',         45: 'SmartMid Híbrido',
  46: 'SmartMid GSM',        54: 'Connect Smart GSM',
  55: 'Connect Smart Híbrido',
};

// Eventos — Trucks Control v6.7
// Todos são (opc)[bit], enviados quando diferente do default (0).
// evt4 (ignição) tem lógica especial: -1, 0, 1.

const EVENTOS = {
  // Críticos
  evt5:   { descricao: 'Botão de Pânico',              severity: 'critico', icone: '🆘' },
  evt44:  { descricao: 'Possível Jammer',               severity: 'critico', icone: '📡' },
  evt16:  { descricao: 'Bateria Violada',               severity: 'critico', icone: '🔋' },
  evt110: { descricao: 'Risco Colisão Frontal',         severity: 'critico', icone: '💥' },
  evt105: { descricao: 'Fadiga Motorista',              severity: 'critico', icone: '😴' },
  evt31:  { descricao: 'Pânico Escondido',              severity: 'critico', icone: '🆘' },
  evt95:  { descricao: 'Pânico / Violação Painel',      severity: 'critico', icone: '🆘' },
  evt42:  { descricao: 'Caixa Violada',                 severity: 'critico', icone: '📦' },
  evt8:   { descricao: 'Desengate Carreta 1',           severity: 'critico', icone: '⚠️' },
  evt27:  { descricao: 'Desengate Carreta 2',           severity: 'critico', icone: '⚠️' },

  // Altos
  evt10:  { descricao: 'Trava Baú Destravada',          severity: 'alto', icone: '🔓' },
  evt14:  { descricao: 'Porta Baú Aberta',              severity: 'alto', icone: '📦' },
  evt17:  { descricao: 'Velocímetro Violado',           severity: 'alto', icone: '⚙️' },
  evt28:  { descricao: 'Violação de Painel',            severity: 'alto', icone: '🛠️' },
  evt109: { descricao: 'Distração Motorista',           severity: 'alto', icone: '📱' },
  evt114: { descricao: 'Cinto de Segurança',            severity: 'alto', icone: '🪢' },
  evt34:  { descricao: 'Velocidade Máx. GPS',           severity: 'alto', icone: '🚨' },
  evt72:  { descricao: 'Velocidade Excedida Tacógrafo', severity: 'alto', icone: '🚨' },
  evt18:  { descricao: 'Cabo RS232 Violado',            severity: 'alto', icone: '🔌' },
  evt45:  { descricao: 'Biometria Desconectada',        severity: 'alto', icone: '🖐️' },
  evt46:  { descricao: 'Digital Sinistro s/ Perm.',     severity: 'alto', icone: '🖐️' },
  evt73:  { descricao: 'Caixa Travas Violada',          severity: 'alto', icone: '🔒' },
  evt80:  { descricao: 'Porta Baú 1 Violada',           severity: 'alto', icone: '📦' },
  evt81:  { descricao: 'Porta Baú 2 Violada',           severity: 'alto', icone: '📦' },
  evt82:  { descricao: 'Porta Baú 3 Violada',           severity: 'alto', icone: '📦' },
  evt83:  { descricao: 'Porta Baú 4 Violada',           severity: 'alto', icone: '📦' },
  evt93:  { descricao: 'Violação Elétr. 5ª Roda',       severity: 'alto', icone: '⚡' },
  evt94:  { descricao: 'Violação Pino 5ª Roda',         severity: 'alto', icone: '🔩' },
  evt96:  { descricao: 'Tombamento 5ª Roda',             severity: 'alto', icone: '⚠️' },
  evt98:  { descricao: 'Porta Baú Violada',              severity: 'alto', icone: '📦' },
  evt99:  { descricao: 'Perda de Vídeo',                 severity: 'alto', icone: '📹' },
  evt100: { descricao: 'Mov. Indevido Câmera',          severity: 'alto', icone: '📹' },
  evt101: { descricao: 'Cobertura de Câmera',            severity: 'alto', icone: '📹' },
  evt104: { descricao: 'Desligamento Ilegal',            severity: 'alto', icone: '⛔' },
  evt107: { descricao: 'Uso de Celular',                 severity: 'alto', icone: '📱' },
  evt108: { descricao: 'Uso de Cigarro',                 severity: 'alto', icone: '🚬' },
  evt112: { descricao: 'Distância Insegura',             severity: 'alto', icone: '↔️' },
  evt113: { descricao: 'Bocejo Motorista',               severity: 'alto', icone: '🥱' },
  evt115: { descricao: 'Porta Motorista Não Autoriz.',   severity: 'alto', icone: '🚪' },
  evt116: { descricao: 'Porta Carona Não Autoriz.',      severity: 'alto', icone: '🚪' },
  evt86:  { descricao: 'Movimento s/ GPS Violado',       severity: 'alto', icone: '📡' },
  evt89:  { descricao: 'Desconexão Sirene',              severity: 'alto', icone: '🔊' },

  // Médios
  evt3:   { descricao: 'Veículo Bloqueado',             severity: 'info', icone: '🔒' },
  evt1:   { descricao: 'Alerta de Cabine',               severity: 'medio', icone: '🔔' },
  evt2:   { descricao: 'Sirene Acionada',                severity: 'medio', icone: '🔊' },
  evt6:   { descricao: 'Botão Aviso Cabine',             severity: 'medio', icone: '🔔' },
  evt9:   { descricao: 'Trava 5ª Roda Pressionada',     severity: 'medio', icone: '🔩' },
  evt11:  { descricao: 'Pisca Alerta',                   severity: 'medio', icone: '⚡' },
  evt12:  { descricao: 'Porta Carona Aberta',            severity: 'medio', icone: '🚪' },
  evt13:  { descricao: 'Porta Motorista Aberta',         severity: 'medio', icone: '🚪' },
  evt15:  { descricao: 'Trava Baú Pressionada',          severity: 'medio', icone: '🔒' },
  evt29:  { descricao: 'Teclado Desconectado',           severity: 'medio', icone: '⌨️' },
  evt35:  { descricao: 'RPM Máximo',                     severity: 'medio', icone: '🔧' },
  evt43:  { descricao: 'Bateria Fraca',                  severity: 'medio', icone: '🪫' },
  evt52:  { descricao: 'Saiu Raio de Manobra',           severity: 'medio', icone: '📐' },
  evt53:  { descricao: 'Tempo Manobra Excedido',         severity: 'medio', icone: '⏱️' },
  evt54:  { descricao: 'Tempo Parado Excedido',          severity: 'medio', icone: '⏱️' },
  evt74:  { descricao: 'Tempo Porta Baú 1 Aberta',      severity: 'medio', icone: '⏱️' },
  evt75:  { descricao: 'Tempo Porta Baú 2 Aberta',      severity: 'medio', icone: '⏱️' },
  evt76:  { descricao: 'Tempo Porta Baú 3 Aberta',      severity: 'medio', icone: '⏱️' },
  evt77:  { descricao: 'Tempo Porta Baú 4 Aberta',      severity: 'medio', icone: '⏱️' },
  evt78:  { descricao: 'Porta Cofre Aberta',             severity: 'medio', icone: '🔐' },
  evt79:  { descricao: 'Tempo Porta Cofre Aberta',       severity: 'medio', icone: '⏱️' },
  evt84:  { descricao: 'Abertura de Teclado',            severity: 'medio', icone: '⌨️' },
  evt85:  { descricao: 'Veículo na Chuva',               severity: 'medio', icone: '🌧️' },
  evt87:  { descricao: 'Tempo Porta Motorista',          severity: 'medio', icone: '⏱️' },
  evt88:  { descricao: 'Tempo Porta Carona',             severity: 'medio', icone: '⏱️' },
  evt90:  { descricao: 'Auto-Travamento Baú',            severity: 'medio', icone: '🔒' },
  evt102: { descricao: 'Armazenamento Anormal',          severity: 'medio', icone: '💾' },
  evt103: { descricao: 'Baixa Voltagem',                 severity: 'medio', icone: '🪫' },
  evt106: { descricao: 'Motorista Não Detectado',        severity: 'medio', icone: '👤' },
  evt111: { descricao: 'Inicialização Anormal',          severity: 'medio', icone: '🔄' },
  evt119: { descricao: 'Fleet Drive Conectado',          severity: 'medio', icone: '🔗' },
  evt120: { descricao: 'Fleet Drive Desconectado',       severity: 'medio', icone: '🔌' },

  // Informativos
  evt19:  { descricao: 'Abertura Baú (EDN1)',            severity: 'info', icone: '📦' },
  evt20:  { descricao: 'Solic. Abertura Baú (EDN2)',     severity: 'info', icone: '📦' },
  evt21:  { descricao: 'Entrada Genérica (EDP1)',        severity: 'info', icone: '🔌' },
  evt23:  { descricao: 'Violação Movimento (EVS1)',      severity: 'info', icone: '🚛' },
  evt24:  { descricao: 'Trava/Destrava (SDP1)',          severity: 'info', icone: '🔐' },
  evt25:  { descricao: 'Saída Genérica (SDP2)',          severity: 'info', icone: '🔌' },
  // evt26:  { descricao: 'Valor Temperatura',              severity: 'info', icone: '🌡️' },
  evt30:  { descricao: 'Contra-Senha c/ Sinistro',       severity: 'info', icone: '🔑' },
  evt32:  { descricao: 'Sensor Janela Motorista',        severity: 'info', icone: '🪟' },
  evt33:  { descricao: 'Sensor Janela Carona',           severity: 'info', icone: '🪟' },
  evt36:  { descricao: 'Tentativas Senha Excedidas',     severity: 'info', icone: '🔑' },
  evt37:  { descricao: 'Falha Sensor Temp. 1',           severity: 'info', icone: '🌡️' },
  evt38:  { descricao: 'Falha Sensor Temp. 2',           severity: 'info', icone: '🌡️' },
  evt39:  { descricao: 'Falha Sensor Temp. 3',           severity: 'info', icone: '🌡️' },
  evt40:  { descricao: 'Entrada Ponto Controle',         severity: 'info', icone: '📍' },
  evt41:  { descricao: 'Saída Ponto Controle',           severity: 'info', icone: '📍' },
  evt47:  { descricao: 'Digital Identificada',           severity: 'info', icone: '🖐️' },
  evt48:  { descricao: 'Digital c/ Sinistro',            severity: 'info', icone: '🖐️' },
  evt49:  { descricao: 'Digital s/ Permissão',           severity: 'info', icone: '🖐️' },
  evt50:  { descricao: 'Digital Não Identificada',       severity: 'info', icone: '🖐️' },
  evt51:  { descricao: 'Tempo Autent. Digital',          severity: 'info', icone: '⏱️' },
  evt55:  { descricao: 'Manut. Emergencial (RP)',        severity: 'info', icone: '🛤️' },
  evt56:  { descricao: 'Manut. Via (RP)',                severity: 'info', icone: '🛤️' },
  evt57:  { descricao: 'Reconhec. Alerta (RP)',          severity: 'info', icone: '🛤️' },
  evt58:  { descricao: 'Manut. Hardware (RP)',           severity: 'info', icone: '🛤️' },
  evt59:  { descricao: 'Senha Identificada',             severity: 'info', icone: '🔑' },
  evt60:  { descricao: 'Senha c/ Sinistro',              severity: 'info', icone: '🔑' },
  evt61:  { descricao: 'Senha Não Identificada',         severity: 'info', icone: '🔑' },
  evt62:  { descricao: 'Senha s/ Permissão',             severity: 'info', icone: '🔑' },
  evt63:  { descricao: 'Senha Sinistro s/ Perm.',        severity: 'info', icone: '🔑' },
  evt64:  { descricao: 'Tempo Autent. Senha',            severity: 'info', icone: '⏱️' },
  evt65:  { descricao: 'Digital Manobrista',             severity: 'info', icone: '🖐️' },
  evt67:  { descricao: 'Evento Telemetria',              severity: 'info', icone: '📊' },
  evt91:  { descricao: 'Entrada Ponto Rotograma',        severity: 'info', icone: '🗺️' },
  evt92:  { descricao: 'Saída Ponto Rotograma',          severity: 'info', icone: '🗺️' },
  evt117: { descricao: 'Vínculo de Carreta',             severity: 'info', icone: '🔗' },
  evt118: { descricao: 'Desvínculo de Carreta',          severity: 'info', icone: '🔌' },
  evt121: { descricao: 'Bateria Fleet Drive',            severity: 'info', icone: '🔋' },
};

// Origens da mensagem (campo ori)

const ORIGENS = {
  1: 'Satélite', 2: 'GSM Híbrido', 3: 'GSM City',
  4: 'GSM Light', 5: 'GSM Smart', 6: 'Satélite Smart',
  7: 'LoRa', 8: 'LoRa P2P',
};

// Comunicação com a API

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function enviarXML(xml, label = 'API') {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_API);

  try {
    const resposta = await fetch(TC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8' },
      body: xml,
      signal: controller.signal,
    });

    const buffer = Buffer.from(await resposta.arrayBuffer());
    const xmlTexto = descompactar(buffer);

    if (!xmlTexto.trim().startsWith('<')) {
      throw new Error(`Resposta inesperada: ${xmlTexto.substring(0, 100)}`);
    }

    const resultado = await parseStringPromise(xmlTexto, {
      explicitArray: false,
      ignoreAttrs: false,
      trim: true,
      emptyTag: null,
    });

    if (resultado.ErrorRequest) {
      const erro = resultado.ErrorRequest;
      log.warn(label, `Erro ${erro.codigo}: ${erro.erro}`);
      return null;
    }

    return resultado;
  } finally {
    clearTimeout(timeout);
  }
}

function descompactar(buffer) {
  if (buffer.length > 2 && buffer[0] === 0x50 && buffer[1] === 0x4B) {
    const zip = new AdmZip(buffer);
    const arquivos = zip.getEntries();
    if (arquivos.length > 0) return arquivos[0].getData().toString('utf-8');
  }
  if (buffer.length > 2 && buffer[0] === 0x1F && buffer[1] === 0x8B) {
    return zlib.gunzipSync(buffer).toString('utf-8');
  }
  return buffer.toString('utf-8');
}

function paraArray(valor) {
  if (!valor) return [];
  return Array.isArray(valor) ? valor : [valor];
}

// Polling

async function buscarVeiculos() {
  const xml = `<RequestVeiculo>
  <login>${TC_LOGIN}</login>
  <senha>${TC_SENHA}</senha>
</RequestVeiculo>`;

  try {
    const resultado = await enviarXML(xml, 'Veículos');
    if (!resultado) return;

    const veiculos = paraArray(resultado.ResponseVeiculo?.Veiculo);

    for (const v of veiculos) {
      const eqp = parseInt(v.eqp) || 0;
      db.veiculos[v.veiID] = {
        veiID: v.veiID,
        placa: v.placa || '',
        eqp,
        equipamento: EQUIPAMENTOS[eqp] || `Tipo ${v.eqp}`,
        identificacao: v.ident || '',
        motorista: v.mot || '',
        emManutencao: v.vManut === '1',
        versao: v.vs || null,
        temSensorTemp1: v.st1 === '1',
        temSensorTemp2: v.st2 === '1',
        temSensorTemp3: v.st3 === '1',
        temTecladoMacro: v.tMac === '1',
        podeEnviarComando: v.eCmd === '1',
        temIE: v.dIE === '1',
        ieAtiva: v.IE === '1',
      };
    }

    log.info('Veículos', `${veiculos.length} carregados`);
    salvarCache();
  } catch (erro) {
    log.error('Veículos', erro.message);
  }
}

async function buscarMensagens() {
  const xml = `<RequestMensagemCB>
  <login>${TC_LOGIN}</login>
  <senha>${TC_SENHA}</senha>
  <mId>${db.ultimoMId}</mId>
</RequestMensagemCB>`;

  try {
    const resultado = await enviarXML(xml, 'Mensagens');
    if (!resultado) return;

    const mensagens = paraArray(resultado.ResponseMensagemCB?.MensagemCB);

    if (mensagens.length === 0) {
      log.info('Mensagens', 'Nenhuma nova');
      return;
    }

    let maiorMId = db.ultimoMId;

    for (const msg of mensagens) {
      if (BigInt(msg.mId) > BigInt(maiorMId)) {
        maiorMId = msg.mId;
      }

      // Coordenadas (vírgula → ponto)
      const lat = parseFloat(String(msg.lat || '0').replace(',', '.'));
      const lon = parseFloat(String(msg.lon || '0').replace(',', '.'));

      // Velocidade (-1 = não informada)
      let velocidade = parseInt(msg.vel);
      if (isNaN(velocidade) || velocidade === -1) velocidade = null;

      // Ignição (evt4: 1=ligada, 0=desligada, -1=indeterminado)
      let ignicao = null;
      if (msg.evt4 !== undefined) {
        const val = parseInt(msg.evt4);
        if (val === 1) ignicao = true;
        else if (val === 0) ignicao = false;
      }

      // Campos opcionais numéricos
      const parseOpt = (v) => v !== undefined ? parseInt(v) : null;
      const odometro          = parseOpt(msg.odm);
      const rpm               = parseOpt(msg.rpm);
      const temperatura1      = parseOpt(msg.st1);
      const temperatura2      = parseOpt(msg.st2);
      const temperatura3      = parseOpt(msg.st3);
      const umidade1          = parseOpt(msg.umd1);
      const umidade2          = parseOpt(msg.umd2);
      const umidade3          = parseOpt(msg.umd3);

      // Eventos/Alertas
      const eventos = [];
      for (const [chave, info] of Object.entries(EVENTOS)) {
        if (msg[chave] === 'true' || msg[chave] === '1') {
          eventos.push({
            codigo: chave,
            descricao: info.descricao,
            severity: info.severity,
            icone: info.icone,
          });
        }
      }

      // Campos textuais opcionais
      const alertaTelemetria  = msg.alrtTelem || null;
      const pontoRotograma    = msg.prNome || null;
      const carretaBateria    = parseOpt(msg.carretaBateria);
      const fleetDriveBateria = parseOpt(msg.fleetDriveBateria);

      // Origem e tipo
      const origemCod     = parseOpt(msg.ori);
      const origem        = ORIGENS[origemCod] || null;
      const tipoMsg       = parseOpt(msg.tpMsg);
      const eventoGerador = parseOpt(msg.evtG);

      // Monta posição
      const posicao = {
        mId: msg.mId,
        veiID: msg.veiID,
        placa: msg.placa || '',
        dataHora: msg.dt || '',
        lat, lon,
        municipio: msg.mun || '',
        uf: msg.uf || '',
        rodovia: msg.rod || '',
        rua: msg.rua || '',
        velocidade, ignicao,
        odometro, rpm,
        temperatura1, temperatura2, temperatura3,
        umidade1, umidade2, umidade3,
        alertaTelemetria, eventos,
        macro: msg.dMac || null,
        motorista: msg.mot || null,
        motoristaID: msg.motID || null,
        pontoControle: msg.pcNome || null,
        pontoRotograma,
        carreta: msg.carreta || null,
        carretaBateria, fleetDriveBateria,
        origem, origemCod, tipoMsg, eventoGerador,
      };

      // Se a mensagem traz nome de carreta, atualiza o mapa global
      if (msg.carreta) {
        db.carretas[msg.veiID] = msg.carreta;
      }

      // Merge: preserva campos opcionais do registro anterior
      const existente = db.posicoes[msg.veiID];
      if (!existente || msg.dt >= existente.dataHora) {
        if (existente) {
          const preservar = [
            'odometro', 'rpm',
            'temperatura1', 'temperatura2', 'temperatura3',
            'umidade1', 'umidade2', 'umidade3',
            'carretaBateria', 'fleetDriveBateria',
            'motorista', 'motoristaID', 'carreta',
          ];
          for (const campo of preservar) {
            posicao[campo] = posicao[campo] ?? existente[campo];
          }
        }
        db.posicoes[msg.veiID] = posicao;
      }
    }

    db.ultimoMId = maiorMId;
    db.ultimaAtualizacao = new Date().toISOString();
    db.contadorCiclos++;

    log.info('Mensagens', `${mensagens.length} processadas (mId: ${maiorMId})`);
    salvarCache();
  } catch (erro) {
    log.error('Mensagens', erro.message);
  }
}

async function buscarCarretas(tentativas = 1) {
  const xmlFormatos = [
    `<RequestCarretas>
  <login>${TC_LOGIN}</login>
  <senha>${TC_SENHA}</senha>
</RequestCarretas>`,
    `<RequestCarretas login="${TC_LOGIN}" senha="${TC_SENHA}"/>`,
  ];

  for (let fmt = 0; fmt < xmlFormatos.length; fmt++) {
    for (let i = 0; i < tentativas; i++) {
      if (fmt > 0 || i > 0) await delay(5000);

      try {
        const resultado = await enviarXML(xmlFormatos[fmt], 'Carretas');
        if (!resultado) continue;

        const container = resultado.ResponseCarretas;
        if (!container) continue;

        const itens = paraArray(container.Carretas);
        if (itens.length === 0) return;

        // Monta mapa placa → veiID a partir dos veículos cadastrados
        const placaParaVeiID = {};
        for (const [veiID, v] of Object.entries(db.veiculos)) {
          if (v.placa) {
            placaParaVeiID[v.placa.replace(/-/g, '').toUpperCase()] = veiID;
          }
        }

        const novasCarretas = {};
        let mapeados = 0;

        for (const c of itens) {
          // cavalo = placa do caminhão, carreta = placa/nome da carreta
          const cavaloPlaca = (c.cavalo || '').replace(/-/g, '').toUpperCase();
          const carretaNome = c.carreta || '';
          if (!cavaloPlaca || !carretaNome) continue;

          const veiID = placaParaVeiID[cavaloPlaca];
          if (veiID) {
            novasCarretas[veiID] = carretaNome;
            mapeados++;
          }
        }

        if (mapeados > 0) {
          db.carretas = novasCarretas;
          salvarCache();
        }
        log.info('Carretas', `${itens.length} da API, ${mapeados} vinculadas a veículos`);
        return;
      } catch (erro) {
        log.warn('Carretas', `Tentativa ${fmt + 1}.${i + 1} falhou: ${erro.message}`);
      }
    }
  }

  const qtd = Object.keys(db.carretas).length;
  if (qtd > 0) {
    log.info('Carretas', `API indisponível — mantendo ${qtd} do cache`);
  } else {
    log.warn('Carretas', 'API indisponível e sem dados em cache');
  }
}

async function buscarMotoristas() {
  const xml = `<RequestMotorista>
  <login>${TC_LOGIN}</login>
  <senha>${TC_SENHA}</senha>
</RequestMotorista>`;

  try {
    const resultado = await enviarXML(xml, 'Motoristas');
    if (!resultado) return;

    const motoristas = paraArray(resultado.ResponseMotorista?.Motorista);

    for (const m of motoristas) {
      db.motoristas[m.motID] = {
        motID: m.motID,
        nome: m.mot || '',
        cpf: m.cpf || '',
      };
    }

    log.info('Motoristas', `${motoristas.length} carregados`);
    salvarCache();
  } catch (erro) {
    log.error('Motoristas', erro.message);
  }
}

// Montagem dos dados para o frontend

function montarDadosFrota() {
  const veiculos = [];

  let emMovimento = 0;
  let ignicaoLigadaCount = 0;
  let paradoCount = 0;
  let semSinalCount = 0;
  let totalAlertas = 0;

  const todosIDs = new Set([
    ...Object.keys(db.veiculos),
    ...Object.keys(db.posicoes),
  ]);

  for (const veiID of todosIDs) {
    const veiculo = db.veiculos[veiID] || {};
    const pos = db.posicoes[veiID] || null;

    // Status
    let status = 'sem-sinal';
    let statusTexto = 'Sem Sinal';
    let statusCor = '#6b7280';

    if (pos && pos.dataHora) {
      const vel = pos.velocidade;
      const ign = pos.ignicao;

      if (vel !== null && vel > 0) {
        status = 'em-movimento';
        statusTexto = `Em Movimento (${vel} km/h)`;
        statusCor = '#10b981';
        emMovimento++;
      } else if (ign === true) {
        status = 'ign-ligada';
        statusTexto = 'Parado — Ignição Ligada';
        statusCor = '#f59e0b';
        ignicaoLigadaCount++;
      } else if (ign === false) {
        status = 'parado';
        statusTexto = 'Parado';
        statusCor = '#1436a6';
        paradoCount++;
      } else {
        status = 'indeterminado';
        statusTexto = 'Indeterminado';
        statusCor = '#8b5cf6';
        semSinalCount++;
      }
    } else {
      semSinalCount++;
    }

    // Filtra evt26 (Valor Temperatura) — já exibido como campo próprio, não é alerta
    const alertas = (pos?.eventos || []).filter((a) => a.codigo !== 'evt26');
    totalAlertas += alertas.filter((a) => a.severity !== 'info').length;

    const placa = veiculo.placa || pos?.placa || '';
    const placaLimpa = /^\d+$/.test(placa) ? '' : placa;

    let alertaCritico = 0;
    let alertaAlto = 0;
    alertas.forEach((a) => {
      if (a.severity === 'critico') alertaCritico++;
      if (a.severity === 'alto') alertaAlto++;
    });

    const localResumo = [pos?.municipio, pos?.uf].filter(Boolean).join('/');

    veiculos.push({
      veiID,
      placa: placaLimpa,
      identificacao: veiculo.identificacao || '',
      equipamento: veiculo.equipamento || '',
      motorista: pos?.motorista || veiculo.motorista || '',
      emManutencao: veiculo.emManutencao || false,
      lat: pos?.lat ?? null,
      lon: pos?.lon ?? null,
      municipio: pos?.municipio || '',
      uf: pos?.uf || '',
      rodovia: pos?.rodovia || '',
      rua: pos?.rua || '',
      velocidade: pos?.velocidade ?? null,
      odometro: pos?.odometro ?? null,
      ignicao: pos?.ignicao ?? null,
      dataHora: pos?.dataHora || null,
      eventos: alertas,
      alertaCritico,
      alertaAlto,
      macro: pos?.macro || null,
      carreta: pos?.carreta || db.carretas[veiID] || null,
      carretaBateria: pos?.carretaBateria ?? null,
      localResumo,
      pontoControle: pos?.pontoControle || null,
      pontoRotograma: pos?.pontoRotograma || null,
      rpm: pos?.rpm ?? null,
      temperatura1: pos?.temperatura1 ?? null,
      temperatura2: pos?.temperatura2 ?? null,
      temperatura3: pos?.temperatura3 ?? null,
      umidade1: pos?.umidade1 ?? null,
      umidade2: pos?.umidade2 ?? null,
      umidade3: pos?.umidade3 ?? null,
      fleetDriveBateria: pos?.fleetDriveBateria ?? null,
      alertaTelemetria: pos?.alertaTelemetria || null,
      origem: pos?.origem || null,
      status,
      statusTexto,
      statusCor,
    });
  }

  veiculos.sort((a, b) => {
    if (!a.placa && !b.placa) return 0;
    if (!a.placa) return 1;
    if (!b.placa) return -1;
    return a.placa.localeCompare(b.placa);
  });

  let alertasCriticos = 0;
  let alertasAltos = 0;
  veiculos.forEach((v) => {
    alertasCriticos += v.alertaCritico;
    alertasAltos += v.alertaAlto;
  });

  return {
    veiculos,
    estatisticas: {
      total: veiculos.length,
      emMovimento,
      ignicaoLigada: ignicaoLigadaCount,
      parado: paradoCount,
      semSinal: semSinalCount,
      alertas: totalAlertas,
      alertasCriticos,
      alertasAltos,
    },
    ultimaAtualizacao: db.ultimaAtualizacao,
  };
}

// Agendamento de polling

let intervalos = [];

async function iniciarPolling() {
  log.info('Polling', 'Iniciando consultas à API Trucks Control...');

  carregarCache();

  if (!CREDENCIAIS_API_OK) {
    log.warn(
      'Config',
      'TC_URL/TC_LOGIN/TC_SENHA ausentes ou invalidos no .env. API externa desativada; servindo apenas cache/local.'
    );
    return;
  }

  await buscarVeiculos();
  await delay(2000);
  await buscarMotoristas();
  await delay(2000);
  await buscarCarretas(3);
  await delay(2000);
  await buscarMensagens();

  if (Object.keys(db.veiculos).length === 0) {
    log.warn('Polling', 'Veículos vazio — retentando em 60s...');
    setTimeout(buscarVeiculos, 60 * 1000);
  }

  intervalos.push(setInterval(buscarMensagens, INTERVALO_MENSAGENS));
  intervalos.push(setInterval(async () => {
    await buscarVeiculos();
    await delay(2000);
    await buscarMotoristas();
    await delay(2000);
    await buscarCarretas(2);
  }, INTERVALO_VEICULOS));
}

// Servidor Express

const app = express();

app.use(compression());
app.use(cors());
app.disable('x-powered-by');

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});

app.get('/api/frota', (_req, res) => {
  res.json(montarDadosFrota());
});

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.round(process.uptime()),
    veiculos: Object.keys(db.veiculos).length,
    posicoes: Object.keys(db.posicoes).length,
    motoristas: Object.keys(db.motoristas).length,
    ultimoMId: db.ultimoMId,
    ciclos: db.contadorCiclos,
    ultimaAtualizacao: db.ultimaAtualizacao,
    memoria: {
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + ' MB',
      heap: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
    },
  });
});

const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(path.join(distPath, 'index.html'))) {
  app.use(express.static(distPath, { maxAge: '1d' }));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

const server = app.listen(PORT, async () => {
  log.info('Server', `Painel de Frotas rodando em http://localhost:${PORT}`);
  await iniciarPolling();
});


function encerrar(sinal) {
  log.info('Server', `${sinal} recebido — encerrando...`);
  intervalos.forEach(clearInterval);
  salvarCache();
  server.close(() => {
    log.info('Server', 'Encerrado.');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000);
}

process.on('SIGTERM', () => encerrar('SIGTERM'));
process.on('SIGINT', () => encerrar('SIGINT'));
