# ============================================================
# PAINEL DE FROTAS — Dockerfile (multi-stage)
# ============================================================
#
# Build: docker build -t painel-frotas .
# Run:   docker run -d -p 3001:3001 --env-file .env painel-frotas
#
# ============================================================

# ---- Stage 1: Build do frontend ----
FROM node:22-alpine AS builder

WORKDIR /app

# Copia manifesto e lockfile primeiro (cache de dependências)
COPY package.json pnpm-lock.yaml ./

# Instala pnpm e dependências
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate \
    && pnpm install --frozen-lockfile

# Copia código-fonte
COPY . .

# Build do Vite (gera dist/)
RUN pnpm run build


# ---- Stage 2: Imagem de produção ----
FROM node:22-alpine AS production

LABEL maintainer="Painel Frotas"
LABEL description="Painel de monitoramento de frota - Trucks Control v6.7"

WORKDIR /app

# Cria usuário não-root
RUN addgroup -g 1001 -S appgroup \
    && adduser -S appuser -u 1001 -G appgroup

# Copia manifesto
COPY package.json pnpm-lock.yaml ./

# Instala somente dependências de produção
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate \
    && pnpm install --frozen-lockfile --prod \
    && pnpm store prune

# Copia server.js e o frontend buildado
COPY --from=builder /app/server.js ./
COPY --from=builder /app/dist ./dist

# Garante que appuser possa escrever cache em /app (.cache-*.json)
RUN chown -R appuser:appgroup /app

# Variáveis sensíveis vêm pelo --env-file ou docker-compose
ENV NODE_ENV=production
ENV PORT=3001
# Heap maior evita OOM ao carregar preços CTF (templates 9/149 são grandes)
ENV NODE_OPTIONS=--max-old-space-size=460

# Porta exposta
EXPOSE 3001

# Health-check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3001/api/health || exit 1

# Executa como usuário não-root
USER appuser

CMD ["node", "server.js"]
