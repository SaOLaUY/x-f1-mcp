# x-f1-mcp

MCP server para monitorear Twitter/X en tiempo real durante eventos de F1.  
Pensado como complemento de [youtube-channel-mcp](https://github.com/SaOLaUY/youtube-channel-mcp).

> Sin API key de X ni costo mensual — usa sesión de cuenta normal via `agent-twitter-client`.

## Tools disponibles

| Tool | Para qué sirve |
|---|---|
| `search_tweets` | Buscar tweets por keyword en tiempo real |
| `get_user_tweets` | Últimos tweets de una cuenta específica |
| `get_user_profile` | Perfil público de cualquier cuenta |
| `monitor_f1_live` | Monitorear sesión en vivo (qualy, carrera) filtrando cuentas oficiales |
| `search_competitor_content` | Detectar si la competencia ya cubrió un tema |
| `get_trending_f1` | Tendencias F1 por región (global / argentina / spain) |
| `get_tweet_by_id` | Obtener un tweet específico por ID o URL |

## Setup

```bash
git clone https://github.com/TU_USUARIO/x-f1-mcp
cd x-f1-mcp
npm install
cp .env.example .env
# Completar .env con tus credenciales de X
npm run dev:remote   # HTTP streamable en puerto 3001
# o
npm run dev:stdio    # Modo stdio para Claude Desktop
```

## Variables de entorno

```env
X_USERNAME=tu_usuario
X_PASSWORD=tu_contraseña  
X_EMAIL=tu_email_de_x
PORT=3001
```

## Cómo conectarlo a Perplexity

Igual que conectaste el youtube-channel-mcp — apuntá el endpoint MCP a  
`http://localhost:3001/mcp` (o al host donde lo deployés).

## Deploy con Docker

```bash
npm run build
docker build -t x-f1-mcp .
docker run -p 3001:3001 --env-file .env x-f1-mcp
```
