# x-f1-mcp

> MCP server para monitorear Twitter/X en tiempo real durante eventos de Fórmula 1.  
> Complemento de [youtube-channel-mcp](https://github.com/SaOLaUY/youtube-channel-mcp).

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)
[![MCP SDK](https://img.shields.io/badge/MCP%20SDK-1.29-purple)](https://modelcontextprotocol.io/)

---

## ¿Qué hace?

`x-f1-mcp` expone un conjunto de herramientas MCP que permiten a asistentes de IA (Perplexity, Claude, etc.) **buscar y monitorear tweets en tiempo real** sin necesidad de API key de X ni suscripción de pago.

Casos de uso principales:

- Detectar tiempos de qualy o resultados de carrera en segundos después de publicados
- Monitorear cuentas oficiales (@F1, @AlpineF1Team, @francocolapinto) durante una sesión en vivo
- Identificar **gaps de contenido**: qué temas no cubrió todavía la competencia
- Capturar declaraciones del paddock para usar como citas en guiones de video

---

## Herramientas disponibles

| Tool | Descripción |
|---|---|
| `search_tweets` | Búsqueda por keyword — modo `latest` para eventos en vivo, `top` para tendencias |
| `get_user_tweets` | Últimos tweets de una cuenta específica |
| `get_user_profile` | Perfil público: bio, seguidores, verificación |
| `monitor_f1_live` | Monitoreo de sesión en vivo — filtra cuentas oficiales F1 por keywords de sesión |
| `search_competitor_content` | Detecta qué canales competidores ya cubrieron (o no) un tema concreto |
| `get_trending_f1` | Tweets más populares de F1 por región (`global`, `argentina`, `spain`) |
| `get_tweet_by_id` | Obtiene un tweet específico por ID o URL completa |

---

## Requisitos

- [Node.js](https://nodejs.org/) 22 o superior
- Una cuenta de X/Twitter activa (usuario + contraseña + email)
- El repo [youtube-channel-mcp](https://github.com/SaOLaUY/youtube-channel-mcp) (opcional pero recomendado como complemento)

---

## Instalación

```bash
git clone https://github.com/SaOLaUY/x-f1-mcp
cd x-f1-mcp
npm install
cp .env.example .env
```

Completá `.env` con tus datos de X:

```env
X_USERNAME=tu_usuario
X_PASSWORD=tu_contraseña
X_EMAIL=tu_email_de_x
PORT=3001
```

> ⚠️ **Nunca subas el archivo `.env` al repositorio.** Ya está incluido en `.gitignore`.

---

## Uso

### Modo HTTP Streamable (recomendado)

```bash
npm run dev:remote
```

El servidor queda escuchando en `http://localhost:3001/mcp`.

### Modo stdio (Claude Desktop)

```bash
npm run dev:stdio
```

### Build para producción

```bash
npm run build
npm run start:remote
```

---

## Conectar a Perplexity

El proceso es idéntico al de `youtube-channel-mcp`. Agregá el endpoint del servidor como conector MCP personalizado en la configuración de Perplexity, apuntando a:

```
http://localhost:3001/mcp
```

O al host/puerto donde lo hayas deployado.

---

## Deploy con Docker

```bash
npm run build
docker build -t x-f1-mcp .
docker run -p 3001:3001 --env-file .env x-f1-mcp
```

Endpoint disponible en `http://localhost:3001/mcp`.

---

## Health check

```bash
curl http://localhost:3001/health
# → {"ok":true,"service":"x-f1-mcp"}
```

---

## Estructura del proyecto

```
x-f1-mcp/
├── src/
│   ├── server.ts      # Lógica principal — definición de todas las tools
│   ├── remote.ts      # Transporte HTTP Streamable (Express)
│   ├── stdio.ts       # Transporte stdio (Claude Desktop)
│   └── index.ts       # Entry point / re-export
├── .env.example       # Variables de entorno requeridas (sin datos sensibles)
├── .gitignore
├── Dockerfile
├── package.json
└── tsconfig.json
```

---

## Relación con youtube-channel-mcp

| Repo | Fuente de datos | Cuándo usarlo |
|---|---|---|
| [youtube-channel-mcp](https://github.com/SaOLaUY/youtube-channel-mcp) | YouTube Data & Analytics API | Analizar métricas, competencia, ideas de video |
| **x-f1-mcp** | Twitter/X (sin API key) | Monitorear eventos en vivo, detectar gaps en tiempo real |

Usados juntos, permiten un flujo completo: detectar en X que salió un resultado → confirmar que la competencia no lo cubrió en YouTube → generar el guion del video con datos frescos.

---

## Nota sobre `agent-twitter-client`

Este proyecto utiliza [`agent-twitter-client`](https://github.com/elizaos/agent-twitter-client) para autenticarse con una sesión normal de X, sin requerir acceso a la API oficial (que desde 2023 es de pago desde el tier Basic a $100/mes). El paquete simula el comportamiento del cliente web de X usando las credenciales provistas en `.env`.

---

## Licencia

MIT © [Santiago Álvarez](https://github.com/SaOLaUY) — ver [LICENSE](./LICENSE)
