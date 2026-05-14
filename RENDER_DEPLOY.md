# Deploy to Render

Use this if you do not have a VPS or domain.

Render gives you a public HTTPS URL like:

```text
https://shit-sui-mcp.onrender.com/mcp
```

## 1. Push Project to GitHub

Create a GitHub repo and upload this project.

Do not upload secret files:

- `.env`
- `.env.production`
- Sui keystore files
- private keys

## 2. Create Render Web Service

1. Open Render.
2. Choose `New` -> `Blueprint`.
3. Connect your GitHub repo.
4. Render will read `render.yaml`.
5. Create the service.

## 3. Set Secret Environment Variables

Render will ask for variables marked `sync: false`.

Set:

```text
MCP_OAUTH_BEARER_TOKEN
SPONSOR_PRIVATE_KEY
```

Generate `MCP_OAUTH_BEARER_TOKEN` locally:

```bash
openssl rand -hex 32
```

For `SPONSOR_PRIVATE_KEY`, use a dedicated Sui testnet sponsor wallet in `suiprivkey...` format and fund it with testnet SUI.

Do not use your main/admin wallet as sponsor.

## 4. Deploy

Render will run:

```bash
npm ci && npm run build
npm run start:http
```

Health check path:

```text
/healthz
```

## 5. Test

Replace `<render-url>` with your Render URL.

Health:

```bash
curl https://<render-url>/healthz
```

MCP without token should return `401`:

```bash
curl -i https://<render-url>/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

MCP with token:

```bash
TOKEN="your-token"
curl https://<render-url>/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"0.1.0"}}}'
```

## 6. Update Codex Plugin

Edit:

```text
plugins/shit-sui-minter/.mcp.json
```

Set:

```json
"url": "https://<render-url>/mcp"
```

Then set the same `MCP_OAUTH_BEARER_TOKEN` in the Codex/plugin environment.

## Free Plan Notes

Render free services may sleep when idle. First request after sleep can be slow.

For a public mint campaign, upgrade to a paid always-on plan or use Railway/Fly.io with always-on service.
