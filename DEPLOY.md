# Permanent MCP Deployment

This deploys the SHIT Sui MCP server permanently at:

```text
https://mint.your-domain.com/mcp
```

The recommended setup is:

```text
Codex user -> HTTPS domain -> Caddy -> Docker MCP server -> Sui testnet
```

## 1. Prepare VPS

Use an Ubuntu VPS with ports `80` and `443` open.

Install Docker:

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

## 2. Point Domain

Create a DNS `A` record:

```text
mint.your-domain.com -> VPS_PUBLIC_IP
```

Wait until DNS resolves.

## 3. Upload Project

On the VPS:

```bash
mkdir -p ~/shit-sui-mcp
cd ~/shit-sui-mcp
```

Upload this project folder into `~/shit-sui-mcp`.

## 4. Configure Domain

Edit `Caddyfile`:

```text
mint.your-domain.com {
  encode gzip
  reverse_proxy shit-sui-mcp:3000
}
```

Replace `mint.your-domain.com` with your real domain.

## 5. Configure Environment

Create production env:

```bash
cp .env.production.example .env.production
nano .env.production
```

Important:

- Set `MCP_OAUTH_BEARER_TOKEN` to a long random secret.
- Set `SPONSOR_PRIVATE_KEY` to a dedicated funded sponsor wallet.
- Do not use your personal/admin wallet as the sponsor in production.

Generate a token:

```bash
openssl rand -hex 32
```

## 6. Start

```bash
docker compose up -d --build
```

Check:

```bash
docker compose ps
docker compose logs -f shit-sui-mcp
```

Health:

```bash
curl https://mint.your-domain.com/healthz
```

Expected:

```json
{"ok":true,"service":"sui-mcp-shit-minter","transport":"streamable-http","network":"testnet"}
```

## 7. Test MCP Auth

Without token, this should return `401`:

```bash
curl -i https://mint.your-domain.com/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

With token:

```bash
TOKEN="your-token"
curl https://mint.your-domain.com/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"0.1.0"}}}'
```

## 8. Update Codex Plugin

Edit:

```text
plugins/shit-sui-minter/.mcp.json
```

Set:

```json
"url": "https://mint.your-domain.com/mcp"
```

Then configure Codex with the same `MCP_OAUTH_BEARER_TOKEN`.

## 9. Operations

Restart:

```bash
docker compose restart
```

Update:

```bash
docker compose up -d --build
```

Logs:

```bash
docker compose logs -f
```

Stop:

```bash
docker compose down
```

## Production Notes

- Use a dedicated sponsor wallet and keep only limited SUI in it.
- Rotate `MCP_OAUTH_BEARER_TOKEN` if it leaks.
- Add rate limiting before a public campaign.
- Move to Sui mainnet only after token metadata, logo, LP, and admin wallet separation are final.
