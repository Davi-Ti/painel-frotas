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
const PRECOS_CACHE_PATH = path.join(__dirname, '.cache-precos.json');

let precosPostos = {};

function carregarPrecos() {
  try {
    if (fs.existsSync(PRECOS_CACHE_PATH)) {
      precosPostos = JSON.parse(fs.readFileSync(PRECOS_CACHE_PATH, 'utf-8'));
      log.info('Precos', `${Object.keys(precosPostos).length} preços carregados`);
    }
  } catch (err) {
    log.warn('Precos', `Falha ao carregar: ${err.message}`);
  }
}

function salvarPrecos() {
  try {
    fs.writeFileSync(PRECOS_CACHE_PATH, JSON.stringify(precosPostos, null, 2));
  } catch (err) {
    log.warn('Precos', `Falha ao salvar: ${err.message}`);
  }
}

function calcularDistanciaKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

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
app.use(express.json());
app.disable('x-powered-by');

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});

// ── Integração CTF (Cartão de Combustível) ────────────────────────

const CTF_URL_SOAP = 'https://www.portalctf.com.br/portalcopias/wscopia.asmx';
const CTF_USER = (process.env.CTF_USER || '').trim();
const CTF_PASS = (process.env.CTF_PASS || '').trim();
const CTF_GEOCODE_PATH = path.join(__dirname, '.cache-geocode-ctf.json');
const CTF_GEOCODE_POSTO_PATH = path.join(__dirname, '.cache-geocode-postos.json');

// Mapa de código IBGE UF → sigla
const IBGE_UF = {
  11:'RO',12:'AC',13:'AM',14:'RR',15:'PA',16:'AP',17:'TO',
  21:'MA',22:'PI',23:'CE',24:'RN',25:'PB',26:'PE',27:'AL',28:'SE',29:'BA',
  31:'MG',32:'ES',33:'RJ',35:'SP',
  41:'PR',42:'SC',43:'RS',
  50:'MS',51:'MT',52:'GO',53:'DF',
};

function normalizarNome(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
}

// Extrai apenas o "logradouro core" para Nominatim (remove KM, números, ruídos)
function limparEndereco(endereco) {
  if (!endereco) return '';
  return String(endereco)
    .replace(/\s+/g, ' ')
    .replace(/\bN[º°O]?\s*\d+/gi, '')
    .replace(/\bS\/N\b/gi, '')
    .replace(/\bKM\s*[\d.,]+/gi, '')
    .replace(/[,;]+/g, ',')
    .trim();
}

// Adiciona jitter determinístico (~300m–2.5km) ao redor de um centroide,
// para que postos da mesma cidade não se sobreponham no mapa e distâncias
// fiquem visualmente distintas até o geocoding por endereço resolver.
function jitterCidade(lat, lon, postoId) {
  let h = 2166136261; // FNV-1a 32-bit seed
  const str = String(postoId);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const u1 = ((h >>> 0) & 0xffff) / 0xffff;
  const u2 = ((h >>> 16) & 0xffff) / 0xffff;
  const ang = u1 * Math.PI * 2;
  // 0.003 ≈ 330m, 0.022 ≈ 2.4km
  const rad = 0.003 + u2 * 0.019;
  return { lat: lat + Math.sin(ang) * rad, lon: lon + Math.cos(ang) * rad };
}

// Lookup IBGE: 'NOME_NORMALIZADO|UF' → { lat, lon }
let ibgeLookup = null;

async function carregarIBGE() {
  if (ibgeLookup) return ibgeLookup;
  try {
    const resp = await fetch(
      'https://raw.githubusercontent.com/kelvins/municipios-brasileiros/main/csv/municipios.csv',
      { headers: { 'User-Agent': 'PainelFrotas/3.0' } }
    );
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const csv = await resp.text();
    ibgeLookup = {};
    const linhas = csv.split('\n').slice(1); // pula header
    for (const linha of linhas) {
      const partes = linha.split(',');
      if (partes.length < 4) continue;
      const nome = normalizarNome(partes[1]);
      const lat = parseFloat(partes[2]);
      const lon = parseFloat(partes[3]);
      const codUf = parseInt(partes[5]);
      const uf = IBGE_UF[codUf];
      if (!uf || isNaN(lat) || isNaN(lon)) continue;
      ibgeLookup[`${nome}|${uf}`] = { lat, lon };
    }
    log.info('CTF IBGE', `${Object.keys(ibgeLookup).length} municípios carregados`);
  } catch (e) {
    log.warn('CTF IBGE', `Falha: ${e.message}`);
    ibgeLookup = {};
  }
  return ibgeLookup;
}

const ctfCache = {
  postos: null,
  precos: null,
  postosTs: 0,
  precosTs: 0,
  geocode: {},      // 'CIDADE|UF' → { lat, lon } (centroide da cidade — fallback)
  geocodePosto: {}, // postoId → { lat, lon, fonte: 'endereco' | 'cidade' | 'cidade_jitter', falhou? }
};
const CTF_TTL_POSTOS = 60 * 60 * 1000;
const CTF_TTL_PRECOS = 10 * 60 * 1000;

let geocodeQueue = [];           // [cidade, uf] pendentes
let geocodePostoQueue = [];      // [posto] pendentes (geocoding por endereço)
let geocodeAtivo = false;
let geocodePostoAtivo = false;

function carregarGeocodeCache() {
  try {
    if (fs.existsSync(CTF_GEOCODE_PATH)) {
      ctfCache.geocode = JSON.parse(fs.readFileSync(CTF_GEOCODE_PATH, 'utf-8'));
      const total = Object.keys(ctfCache.geocode).length;
      const comCoords = Object.values(ctfCache.geocode).filter(Boolean).length;
      log.info('CTF Geocode', `Cache cidades: ${comCoords}/${total} com coords`);
    }
    if (fs.existsSync(CTF_GEOCODE_POSTO_PATH)) {
      ctfCache.geocodePosto = JSON.parse(fs.readFileSync(CTF_GEOCODE_POSTO_PATH, 'utf-8'));
      const total = Object.keys(ctfCache.geocodePosto).length;
      const porEnd = Object.values(ctfCache.geocodePosto).filter((v) => v && v.fonte === 'endereco').length;
      log.info('CTF Geocode', `Cache postos: ${total} (${porEnd} por endereço, resto por cidade)`);
    }
  } catch (e) {
    log.warn('CTF Geocode', `Falha ao carregar cache: ${e.message}`);
  }
}

function salvarGeocodeCache() {
  try {
    fs.writeFileSync(CTF_GEOCODE_PATH, JSON.stringify(ctfCache.geocode));
  } catch {}
}

function salvarGeocodePostosCache() {
  try {
    fs.writeFileSync(CTF_GEOCODE_POSTO_PATH, JSON.stringify(ctfCache.geocodePosto));
  } catch {}
}

async function geocodificarCidade(cidade, uf) {
  const chave = `${cidade}|${uf}`;
  if (chave in ctfCache.geocode) return ctfCache.geocode[chave];

  // Tenta IBGE primeiro (sem rate limit)
  const lookup = ibgeLookup || {};
  const nomeNorm = normalizarNome(cidade);
  const coordIBGE = lookup[`${nomeNorm}|${uf}`];
  if (coordIBGE) {
    ctfCache.geocode[chave] = coordIBGE;
    return coordIBGE;
  }

  // Fallback: Nominatim
  try {
    const url = `https://nominatim.openstreetmap.org/search?city=${encodeURIComponent(cidade.toLowerCase())}&state=${encodeURIComponent(uf)}&country=Brazil&format=json&limit=1`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'PainelFrotas/3.0 (fleet management; coopertruni)' },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    if (data && data[0]) {
      const coord = { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
      ctfCache.geocode[chave] = coord;
      return coord;
    }
  } catch {}

  ctfCache.geocode[chave] = null;
  return null;
}

// Geocoding por endereço completo via Nominatim — retorna { lat, lon } ou null.
async function geocodificarEndereco(endereco, bairro, cidade, uf) {
  const tentativas = [
    // 1) Endereço + cidade
    { q: `${limparEndereco(endereco)}, ${cidade}, ${uf}, Brasil` },
    // 2) Bairro + cidade
    bairro ? { q: `${bairro}, ${cidade}, ${uf}, Brasil` } : null,
  ].filter(Boolean);

  for (const t of tentativas) {
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(t.q)}&format=json&limit=1&countrycodes=br`;
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'PainelFrotas/3.0 (fleet management; coopertruni)' },
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      if (data && data[0]) {
        const lat = parseFloat(data[0].lat);
        const lon = parseFloat(data[0].lon);
        if (!isNaN(lat) && !isNaN(lon)) return { lat, lon };
      }
    } catch {}
    await delay(800); // respeita limite Nominatim
  }
  return null;
}

async function processarFilaGeocode() {
  if (geocodeAtivo) return;
  geocodeAtivo = true;
  let contador = 0;
  while (geocodeQueue.length > 0) {
    const [cidade, uf] = geocodeQueue.shift();
    const chave = `${cidade}|${uf}`;
    if (!(chave in ctfCache.geocode)) {
      await geocodificarCidade(cidade, uf);
      contador++;
      if (contador % 100 === 0) {
        salvarGeocodeCache();
        log.info('CTF Geocode', `${contador} cidades geocodificadas...`);
      }
      await delay(750); // ~1.3 req/seg, dentro do limite Nominatim
    }
  }
  if (contador > 0) {
    salvarGeocodeCache();
    log.info('CTF Geocode', `Geocoding cidades concluído: ${contador} novas`);
  }
  geocodeAtivo = false;
}

// Processa fila de geocoding POR POSTO (endereço). Roda em background.
async function processarFilaGeocodePostos() {
  if (geocodePostoAtivo) return;
  geocodePostoAtivo = true;
  let contador = 0, sucessos = 0;

  while (geocodePostoQueue.length > 0) {
    const posto = geocodePostoQueue.shift();
    if (!posto || !posto.id) continue;
    if (ctfCache.geocodePosto[posto.id]?.fonte === 'endereco') continue;

    const coord = await geocodificarEndereco(posto.endereco, posto.bairro, posto.cidade, posto.uf);
    if (coord) {
      ctfCache.geocodePosto[posto.id] = { ...coord, fonte: 'endereco' };
      sucessos++;
    } else {
      // mantém entrada existente (cidade/jitter) — só marca como tentado
      const atual = ctfCache.geocodePosto[posto.id] || {};
      ctfCache.geocodePosto[posto.id] = { ...atual, tentadoEndereco: true };
    }
    contador++;

    if (contador % 25 === 0) {
      salvarGeocodePostosCache();
      log.info('CTF Geocode Posto', `${contador} processados (${sucessos} match por endereço)`);
    }
    await delay(1100); // limite Nominatim (~1 req/s)
  }

  if (contador > 0) {
    salvarGeocodePostosCache();
    log.info('CTF Geocode Posto', `Concluído: ${contador} processados, ${sucessos} match por endereço`);
  }
  geocodePostoAtivo = false;
}

async function ctfSOAPCall(codTemplate, qtd = 9999, ponteiro = 0) {
  const envelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Header>
    <SoapLogin xmlns="http://tempuri.org/">
      <login>${CTF_USER}</login>
      <senha>${CTF_PASS}</senha>
    </SoapLogin>
  </soap:Header>
  <soap:Body>
    <RecuperarCopia xmlns="http://tempuri.org/">
      <parametroCopia>
        <Ponteiro>${ponteiro}</Ponteiro>
        <CodTemplate>${codTemplate}</CodTemplate>
        <QtdRegistro>${qtd}</QtdRegistro>
      </parametroCopia>
    </RecuperarCopia>
  </soap:Body>
</soap:Envelope>`;

  const resp = await fetch(CTF_URL_SOAP, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': '"http://tempuri.org/RecuperarCopia"',
    },
    body: envelope,
    agent: new (require('https').Agent)({ rejectUnauthorized: false }),
  });
  if (!resp.ok) throw new Error(`CTF SOAP retornou ${resp.status}`);

  const xml = await resp.text();
  const match = xml.match(/<RecuperarCopiaResult>([\s\S]*?)<\/RecuperarCopiaResult>/);
  if (!match) throw new Error('CTF: RecuperarCopiaResult não encontrado');

  const innerXml = match[1]
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'");

  return parseStringPromise(innerXml, {
    explicitArray: false,
    ignoreAttrs: true,
    trim: true,
    emptyTag: null,
  });
}

async function carregarPostosCTF() {
  const agora = Date.now();
  if (ctfCache.postos && agora - ctfCache.postosTs < CTF_TTL_POSTOS) return ctfCache.postos;

  log.info('CTF', 'Carregando postos credenciados (Template 11)...');
  const data = await ctfSOAP(11);
  const rows = paraArray(data?.POSTOS?.POSTOSRow || []);

  const strVal = (v) => {
    if (!v) return '';
    if (Array.isArray(v)) return String(v[0] || '').trim();
    return String(v).trim();
  };

  const normId = (s) => String(s || '').trim().replace(/^0+(?=\d)/, '');
  const mapa = {};
  for (const r of rows) {
    if (strVal(r.ATIVO) !== 'S') continue;
    const id = normId(strVal(r.COD));
    if (!id) continue;
    mapa[id] = {
      id,
      nome: (strVal(r.FANTASIA) || strVal(r.APELIDO) || strVal(r.RAZAO) || 'Posto CTF'),
      endereco: strVal(r.ENDERECO),
      bairro: strVal(r.BAIRRO),
      cidade: strVal(r.CIDADE).toUpperCase(),
      uf: strVal(Array.isArray(r.UF) ? r.UF[0] : r.UF).toUpperCase().slice(0, 2),
    };
  }

  ctfCache.postos = mapa;
  ctfCache.postosTs = agora;
  log.info('CTF', `${Object.keys(mapa).length} postos ativos carregados`);
  return mapa;
}

// Parse data dd/MM/yyyy HH:mm:ss → timestamp (ms). Retorna 0 em falha.
function parseDtBR(s) {
  if (!s) return 0;
  const m = String(s).match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return 0;
  return new Date(+m[3], +m[2] - 1, +m[1], +m[4] || 0, +m[5] || 0, +m[6] || 0).getTime();
}

// Decodificador CD_COMBUSTIVEL → categoria do nosso schema interno.
// Baseado no Template 39 do CTF. Mapeia tudo para 6 categorias.
function classificarCombustivel(codigo, nomeFallback = '') {
  const cd = String(codigo || '').trim().toUpperCase();
  const nm = String(nomeFallback || '').trim().toUpperCase();

  // Pelo código (T9)
  switch (cd) {
    case 'A': return 'diesel';
    case 'H': return 'diesel_aditivado';
    case 'R': return 'diesel_s50';
    case 'S': return 'diesel_s10';
    case 'T': return 'diesel_s10_aditivado';
    case 'B': return 'gasolina';
    case 'D': return 'gasolina_aditivada';
    case 'F': return 'gasolina_premium';
    case 'C': return 'etanol';
    case 'E': return 'etanol_aditivado';
    case 'U': case 'V': return 'arla';
    case 'G': return 'gnv';
  }
  // Pelo nome (T149)
  if (nm === 'DIESEL S10' || nm === 'DIESEL S-10') return 'diesel_s10';
  if (nm === 'DIESEL S10 ADITIVADO') return 'diesel_s10_aditivado';
  if (nm === 'DIESEL S50') return 'diesel_s50';
  if (nm === 'DIESEL ADITIVADO') return 'diesel_aditivado';
  if (nm.startsWith('DIESEL')) return 'diesel';
  if (nm === 'GASOLINA ADITIVADA') return 'gasolina_aditivada';
  if (nm === 'GASOLINA PREMIUM') return 'gasolina_premium';
  if (nm.startsWith('GASOLINA')) return 'gasolina';
  if (nm === 'ALCOOL ADITIVADO') return 'etanol_aditivado';
  if (nm.startsWith('ALCOOL') || nm.startsWith('ETANOL')) return 'etanol';
  if (nm.includes('ARLA')) return 'arla';
  if (nm.includes('GAS') && nm.includes('VEIC')) return 'gnv';
  return null;
}

// Paginação Template 9 (Abastecimentos) — usa PONTEIRO crescente.
async function carregarAbastecimentosCTF(maxRegs = 30000) {
  const todos = [];
  let ponteiro = 0;
  for (let pagina = 0; pagina < 20 && todos.length < maxRegs; pagina++) {
    const data = await ctfSOAP(9, 9999, ponteiro);
    const rows = paraArray(data?.ABASTECIMENTOS?.ABASTECIMENTOSRow || []);
    if (rows.length === 0) break;
    todos.push(...rows);

    let maxP = ponteiro;
    for (const r of rows) {
      const p = parseInt(Array.isArray(r.PONTEIRO) ? r.PONTEIRO[0] : r.PONTEIRO);
      if (!isNaN(p) && p > maxP) maxP = p;
    }
    if (maxP <= ponteiro) break;
    ponteiro = maxP;
  }
  return todos;
}

// Paginação Template 1346 (RegMasterMacro) — mais cobertura de postos.
async function carregarRegMasterMacroCTF(maxRegs = 50000) {
  const todos = [];
  let ponteiro = 0;
  for (let pagina = 0; pagina < 10 && todos.length < maxRegs; pagina++) {
    const data = await ctfSOAP(1346, 9999, ponteiro);
    const rows = paraArray(data?.RegMasterMacro?.RegMasterMacroRow || []);
    if (rows.length === 0) break;
    todos.push(...rows);

    let maxP = ponteiro;
    for (const r of rows) {
      const p = parseInt(Array.isArray(r.INDICE) ? r.INDICE[0] : (r.INDICE || r.COD));
      if (!isNaN(p) && p > maxP) maxP = p;
    }
    if (maxP <= ponteiro) break;
    ponteiro = maxP;
  }
  return todos;
}

async function ctfSOAP(codTemplate, qtd = 9999, ponteiro = 0) {
  return ctfSOAPCall(codTemplate, qtd, ponteiro);
}

async function carregarPrecosCTF() {
  const agora = Date.now();
  if (ctfCache.precos && agora - ctfCache.precosTs < CTF_TTL_PRECOS) return ctfCache.precos;

  const normId = (s) => String(s || '').trim().replace(/^0+(?=\d)/, '');
  const sval = (v) => Array.isArray(v) ? String(v[0] || '') : String(v || '');
  const mapa = {};

  // ── Template 9: preço REAL de abastecimentos (mais autoritativo) ──
  log.info('CTF', 'Carregando abastecimentos (Template 9 — preços reais)...');
  let totalT9 = 0;
  try {
    const abastecimentos = await carregarAbastecimentosCTF(40000);
    totalT9 = abastecimentos.length;

    for (const r of abastecimentos) {
      const id = normId(sval(r.COD_POSTO));
      if (!id) continue;
      const cat = classificarCombustivel(sval(r.CD_COMBUSTIVEL), sval(r.DC_COMBUSTIVEL));
      if (!cat) continue;
      const valor = parseFloat(sval(r.VL_PRECO_UNITARIO).replace(',', '.'));
      if (!valor || valor < 0.3) continue;

      const dtStr = sval(r.DT_EVENTO) || sval(r.DT_PROCESS) || null;
      const ts = parseDtBR(dtStr);
      if (!ts) continue;

      if (!mapa[id]) mapa[id] = { _ts: {} };
      // Mantém o mais recente por categoria.
      if (!mapa[id]._ts[cat] || ts > mapa[id]._ts[cat]) {
        mapa[id][cat] = valor;
        mapa[id]._ts[cat] = ts;
        mapa[id][`${cat}_dt`] = dtStr;
        if (!mapa[id].atualizado_ts || ts > mapa[id].atualizado_ts) {
          mapa[id].atualizado_ts = ts;
          mapa[id].atualizado = dtStr;
        }
      }
    }
    log.info('CTF', `T9: ${totalT9} abastecimentos → ${Object.keys(mapa).length} postos com preço real`);
  } catch (e) {
    log.warn('CTF', `T9 falhou (continua com T149): ${e.message}`);
  }

  // ── Template 1346: RegMasterMacro (cobertura adicional via master/bomba) ──
  log.info('CTF', 'Carregando RegMasterMacro (Template 1346)...');
  let totalT1346 = 0;
  try {
    const macros = await carregarRegMasterMacroCTF(50000);
    totalT1346 = macros.length;

    for (const r of macros) {
      const id = normId(sval(r.NUMERO_POSTO));
      if (!id) continue;
      const cat = classificarCombustivel(sval(r.CODIGO_COMBUSTIVEL), '');
      if (!cat) continue;
      const valor = parseFloat(sval(r.VALOR_PRECO_LITRO).replace(',', '.'));
      if (!valor || valor < 0.3) continue;

      const dtStr = sval(r.DATA_EVENTO) || sval(r.HoraEvento) || sval(r.DAT_PROCESSAMENTO) || null;
      const ts = parseDtBR(dtStr);
      if (!ts) continue;

      if (!mapa[id]) mapa[id] = { _ts: {} };
      if (!mapa[id]._ts[cat] || ts > mapa[id]._ts[cat]) {
        mapa[id][cat] = valor;
        mapa[id]._ts[cat] = ts;
        mapa[id][`${cat}_dt`] = dtStr;
        if (!mapa[id].atualizado_ts || ts > mapa[id].atualizado_ts) {
          mapa[id].atualizado_ts = ts;
          mapa[id].atualizado = dtStr;
        }
      }
    }
    log.info('CTF', `T1346: ${totalT1346} linhas → ${Object.keys(mapa).length} postos no acumulado`);
  } catch (e) {
    log.warn('CTF', `T1346 falhou: ${e.message}`);
  }

  // ── Template 149: preço bomba (fallback para postos sem abastecimento) ──
  log.info('CTF', 'Carregando preços (Template 149)...');
  const data = await ctfSOAP(149);
  const rowsT149 = paraArray(data?.Preco_Bomba?.Preco_BombaRow || []);
  let usadosT149 = 0;

  for (const r of rowsT149) {
    const id = normId(sval(r.COD_POSTO));
    if (!id) continue;
    const cat = classificarCombustivel(null, sval(r.COMBUSTIVEL));
    if (!cat) continue;
    const valor = parseFloat(sval(r.VALOR_NEW).replace(',', '.'));
    if (!valor || valor < 0.3) continue;

    const dtStr = sval(r.DATA_MUDANCA) || null;
    const ts = parseDtBR(dtStr);

    if (!mapa[id]) mapa[id] = { _ts: {} };

    // Só usa T149 se T9 não tem ESSE combustível, OU se T149 é mais recente.
    const tsAtual = mapa[id]._ts[cat] || 0;
    if (ts > tsAtual) {
      mapa[id][cat] = valor;
      mapa[id]._ts[cat] = ts;
      mapa[id][`${cat}_dt`] = dtStr;
      usadosT149++;
      if (!mapa[id].atualizado_ts || ts > mapa[id].atualizado_ts) {
        mapa[id].atualizado_ts = ts;
        mapa[id].atualizado = dtStr;
      }
    }
  }

  // Limpa metadados internos antes de retornar.
  for (const id in mapa) {
    delete mapa[id]._ts;
    delete mapa[id].atualizado_ts;
  }

  ctfCache.precos = mapa;
  ctfCache.precosTs = agora;
  log.info('CTF', `Preços consolidados: ${Object.keys(mapa).length} postos | T9=${totalT9} | T1346=${totalT1346} | T149=${rowsT149.length} (${usadosT149} usadas)`);
  return mapa;
}

async function iniciarGeocodeBackground() {
  try {
    // Carrega IBGE primeiro (seed de coordenadas sem rate limit)
    await carregarIBGE();

    const postos = await carregarPostosCTF();
    const cidadesUnicas = new Set();
    for (const p of Object.values(postos)) {
      if (p.cidade && p.uf) cidadesUnicas.add(`${p.cidade}|${p.uf}`);
    }

    // Seed em lote com IBGE (sem delay)
    const lookup = ibgeLookup || {};
    let seedadas = 0;
    for (const chave of cidadesUnicas) {
      if (chave in ctfCache.geocode) continue;
      const [cidade, uf] = chave.split('|');
      const nomeNorm = normalizarNome(cidade);
      const coord = lookup[`${nomeNorm}|${uf}`];
      if (coord) {
        ctfCache.geocode[chave] = coord;
        seedadas++;
      }
    }
    if (seedadas > 0) salvarGeocodeCache();
    log.info('CTF Geocode', `${seedadas} cidades seedadas via IBGE`);

    // Pré-gera coordenadas por posto via jitter (resolve "todos no mesmo ponto"
    // de imediato — refino por endereço ocorre sob demanda em background).
    let preGerados = 0;
    for (const p of Object.values(postos)) {
      if (ctfCache.geocodePosto[p.id]?.fonte === 'endereco') continue;
      if (ctfCache.geocodePosto[p.id]?.fonte === 'cidade_jitter') continue;
      const cid = ctfCache.geocode[`${p.cidade}|${p.uf}`];
      if (cid && typeof cid.lat === 'number') {
        const j = jitterCidade(cid.lat, cid.lon, p.id);
        ctfCache.geocodePosto[p.id] = { lat: j.lat, lon: j.lon, fonte: 'cidade_jitter' };
        preGerados++;
      }
    }
    if (preGerados > 0) {
      salvarGeocodePostosCache();
      log.info('CTF Geocode Posto', `${preGerados} postos com coords iniciais via jitter`);
    }

    // Cidades restantes → Nominatim em background
    const pendentes = [...cidadesUnicas]
      .filter((c) => !(c in ctfCache.geocode))
      .map((c) => c.split('|'));
    log.info('CTF Geocode', `${cidadesUnicas.size} cidades únicas, ${pendentes.length} para Nominatim`);
    geocodeQueue.push(...pendentes);
    processarFilaGeocode();
  } catch (e) {
    log.error('CTF Geocode', `Erro ao iniciar: ${e.message}`);
  }
}

// ── Endpoint Postos ───────────────────────────────────────────────

// Resolve a coordenada de UM posto. Estratégia:
//  1) Cache por posto (preferindo fonte=endereco).
//  2) Fallback: centroide da cidade + jitter determinístico (mantém distâncias distintas).
function resolverCoordPosto(posto) {
  const existente = ctfCache.geocodePosto[posto.id];
  if (existente && typeof existente.lat === 'number') {
    return { lat: existente.lat, lon: existente.lon, fonte: existente.fonte || 'cidade' };
  }
  const chaveCid = `${posto.cidade}|${posto.uf}`;
  const cid = ctfCache.geocode[chaveCid];
  if (cid && typeof cid.lat === 'number') {
    const j = jitterCidade(cid.lat, cid.lon, posto.id);
    ctfCache.geocodePosto[posto.id] = { lat: j.lat, lon: j.lon, fonte: 'cidade_jitter' };
    return { lat: j.lat, lon: j.lon, fonte: 'cidade_jitter' };
  }
  return null;
}

// Categorias de combustível suportadas, em ordem de relevância para frota diesel.
const CATEGORIAS_PRECO = [
  'diesel_s10', 'diesel', 'diesel_s10_aditivado', 'diesel_aditivado', 'diesel_s50',
  'arla',
  'gasolina', 'gasolina_aditivada', 'gasolina_premium',
  'etanol', 'etanol_aditivado',
  'gnv',
];

// Constrói um item de posto pronto pro frontend.
function montarPostoItem(posto, coord, distancia, precosMap) {
  const preco = precosMap[posto.id] || {};
  const endStr = [posto.endereco, posto.bairro, posto.cidade, posto.uf]
    .filter(Boolean).filter((s, i, a) => a.indexOf(s) === i).join(', ');

  // Coleta todos os preços disponíveis.
  const precos = {};
  for (const cat of CATEGORIAS_PRECO) {
    if (preco[cat]) precos[cat] = preco[cat];
  }
  const temPrecoFlag = Object.keys(precos).length > 0;

  return {
    id: `ctf_${posto.id}`,
    ctfId: posto.id,
    nome: posto.nome,
    marca: null,
    lat: coord.lat,
    lon: coord.lon,
    distancia: Math.round(distancia * 10) / 10,
    endereco: endStr || null,
    cidade: posto.cidade,
    uf: posto.uf,
    precos,
    // Campos legados (compatibilidade com o popup do mapa).
    preco_diesel: preco.diesel || null,
    preco_diesel_s10: preco.diesel_s10 || null,
    preco_gasolina: preco.gasolina || null,
    preco_arla: preco.arla || null,
    preco_atualizado: preco.atualizado || null,
    geocoded_por: coord.fonte,
    temPreco: temPrecoFlag,
    fonte: 'CTF',
  };
}

app.get('/api/postos', async (req, res) => {
  const { lat, lon, raio = '20000', expandir } = req.query;
  if (!lat || !lon) return res.status(400).json({ erro: 'lat e lon são obrigatórios' });

  const latN = parseFloat(lat);
  const lonN = parseFloat(lon);
  const raioInicial = Math.min(parseInt(raio) || 20000, 200000) / 1000;
  const autoExpandir = expandir !== 'off';

  if (isNaN(latN) || isNaN(lonN)) return res.status(400).json({ erro: 'lat/lon inválidos' });

  try {
    const [postosMap, precosMap] = await Promise.all([
      carregarPostosCTF(),
      carregarPrecosCTF(),
    ]);

    // 1) Geocoding de cidades não cacheadas (background) — só fallback.
    const cidadesParaGeocode = new Set();
    for (const p of Object.values(postosMap)) {
      const chave = `${p.cidade}|${p.uf}`;
      if (p.cidade && p.uf && !(chave in ctfCache.geocode)) cidadesParaGeocode.add(chave);
    }
    if (cidadesParaGeocode.size > 0) {
      geocodeQueue.push(...[...cidadesParaGeocode].map((c) => c.split('|')));
      if (!geocodeAtivo) processarFilaGeocode();
    }

    // 2) Função que coleta postos dentro de um raio dado.
    const coletar = (raioKm) => {
      const lista = [];
      for (const posto of Object.values(postosMap)) {
        const coord = resolverCoordPosto(posto);
        if (!coord) continue;
        const dist = calcularDistanciaKm(latN, lonN, coord.lat, coord.lon);
        if (dist > raioKm) continue;
        lista.push(montarPostoItem(posto, coord, dist, precosMap));
      }
      return lista;
    };

    let raioKm = raioInicial;
    let postos = coletar(raioKm);
    let comPreco = postos.filter((p) => p.temPreco).length;
    let expandiuAuto = false;

    // 3) Auto-expansão: se NENHUM posto com preço foi achado, aumenta raio até achar
    // (até 150km), pra UX nunca dar “nenhum com preço” sem mostrar alternativa.
    if (autoExpandir && comPreco === 0) {
      for (const raioTeste of [Math.max(raioKm, 30), 60, 100, 150]) {
        if (raioTeste <= raioKm) continue;
        const lista = coletar(raioTeste);
        const cp = lista.filter((p) => p.temPreco).length;
        if (cp > 0) {
          raioKm = raioTeste;
          postos = lista;
          comPreco = cp;
          expandiuAuto = true;
          break;
        }
      }
    }

    postos.sort((a, b) => a.distancia - b.distancia);

    // 4) Agenda geocoding por endereço para postos visíveis sem refinamento.
    // Postos visíveis vão pro INÍCIO da fila (alta prioridade).
    const candidatos = postos
      .filter((p) => p.geocoded_por !== 'endereco')
      .slice(0, 60)
      .map((p) => postosMap[p.ctfId])
      .filter(Boolean);

    if (candidatos.length > 0) {
      const jaEnfileirados = new Set(geocodePostoQueue.map((p) => p.id));
      const novos = [];
      for (const c of candidatos) {
        if (!jaEnfileirados.has(c.id) &&
            ctfCache.geocodePosto[c.id]?.fonte !== 'endereco' &&
            !ctfCache.geocodePosto[c.id]?.tentadoEndereco) {
          novos.push(c);
        }
      }
      // unshift para prioridade (postos da região visível vêm antes).
      if (novos.length > 0) geocodePostoQueue.unshift(...novos);
      if (!geocodePostoAtivo) processarFilaGeocodePostos();
    }

    const geocodadas = Object.values(ctfCache.geocode).filter(Boolean).length;
    const totalCidades = Object.keys(ctfCache.geocode).length;
    const totalPostosGeoc = Object.keys(ctfCache.geocodePosto).length;
    const porEndereco = Object.values(ctfCache.geocodePosto).filter((v) => v?.fonte === 'endereco').length;

    log.info('CTF Postos',
      `${postos.length} em ${raioKm}km (preço:${comPreco}, exp:${expandiuAuto}) | geoc cidades:${geocodadas}/${totalCidades} postos:${porEndereco}/${totalPostosGeoc}`
    );

    res.json({
      postos,
      total: postos.length,
      raio: raioKm * 1000,
      raioOriginal: raioInicial * 1000,
      expandiuAuto,
      comPreco,
      geocodeStatus: { geocodadas, totalCidades, postosGeocodificados: totalPostosGeoc, porEndereco },
    });
  } catch (err) {
    log.error('CTF Postos', err.message);
    res.status(502).json({ erro: `Falha ao buscar postos: ${err.message}` });
  }
});

// ─────────────────────────────────────────────────────────────────

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
  carregarGeocodeCache();
  await iniciarPolling();
  if (CTF_USER && CTF_PASS) {
    log.info('CTF', `Credenciais configuradas (${CTF_USER})`);
    setTimeout(iniciarGeocodeBackground, 5000); // inicia após polling estabilizar
  } else {
    log.warn('CTF', 'CTF_USER/CTF_PASS não configurados — postos CTF desabilitados');
  }
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
