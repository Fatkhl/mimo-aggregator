# MIMO Aggregator v3.0

> Smart AI API Key Router & Aggregator — Glassmorphism Dashboard

## Features

- 🔑 **Unlimited API Keys** — Pool unlimited keys with AES-256 encryption
- 🔀 **5 Routing Strategies** — Failover, Round-Robin, Least-Used, Weighted, Sticky
- 🏥 **Health Scoring** — Real-time health monitoring with auto-failover
- 📊 **Glassmorphism Dashboard** — Premium dark UI with real-time WebSocket updates
- 📈 **Analytics** — Charts, per-model breakdown, CSV/JSON export
- 👤 **Client Keys** — Per-client rate limits, model scopes, IP whitelisting
- 🔔 **Webhook Alerts** — Discord, Telegram, generic webhook
- 💾 **Auto Backup** — SQLite backup every 6h, keep last 10
- ⌨️ **Command Palette** — Ctrl+K for quick navigation
- 🐳 **Docker Ready** — One-command deployment

## Quick Start

```bash
git clone https://github.com/Fatkhl/mimo-aggregator.git
cd mimo-aggregator
npm install
npm start
```

Open `http://localhost:3000/dashboard` — login with credentials shown in terminal.

## API Usage

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "x-api-key: YOUR_CLIENT_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4","messages":[{"role":"user","content":"Hello"}]}'
```

## Docker

```bash
docker-compose up -d
```

## License

MIT
