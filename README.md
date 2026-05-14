# Sui MCP SHIT Minter

MCP server prototype for a Sui-native mint flow:

1. Codex or another MCP client calls this server.
2. Each tool is gated by an OAuth bearer token value.
3. The server checks configured Sui package objects.
4. The server prepares an unsigned Sui transaction block.
5. In the standard flow, the user signs and broadcasts with their own Sui wallet.
6. In the sponsored flow, the user signs as sender and the configured sponsor signs/broadcasts as gas owner.
7. `mint()` sends `10,000,000 SHIT` to the user's own Sui address and debits `1 SUI` from the transaction gas coin.

This is intentionally Sui-native. It does not use EIP-7702, EOA delegation, or EVM transaction types.

## Layout

- `move/` - Sui Move package defining the `SHIT` coin and mint function.
- `src/server.ts` - MCP server with standard and sponsored mint tools.
- `src/sui.ts` - Sui transaction builders.
- `src/sponsor.ts` - sponsor signer loader for Sui CLI keystore or `suiprivkey`.
- `.env.example` - Runtime configuration template.

## MCP Tools

- `health` - checks server and network config.
- `quote_mint_fee` - returns the 1 SUI fee and 10M SHIT mint amount.
- `check_mint_status` - checks configured package and shared mint config objects.
- `check_user_mint_status` - checks a user's SHIT balance, mint count, remaining mints, and eligibility.
- `prepare_mint` - returns base64 Sui transaction bytes for the user to sign and execute.
- `prepare_sponsored_mint` - returns base64 Sui transaction bytes where the user signs and the sponsor pays gas/fee.
- `submit_sponsored_mint` - adds the sponsor signature and broadcasts a sponsored mint signed by the user.
- `prepare_config` - returns base64 Sui transaction bytes to create the shared `MintConfig`.

Every tool takes `accessToken`. In a production HTTP MCP deployment, replace this explicit argument with real OAuth middleware that validates the request `Authorization` header.

## Setup

```bash
npm install
cp .env.example .env
```

Fill `.env` after publishing the Move package:

```env
SUI_NETWORK=testnet
SUI_FULLNODE_URL=https://fullnode.testnet.sui.io:443
MCP_OAUTH_BEARER_TOKEN=replace-with-your-oauth-access-token
SUI_PACKAGE_ID=0x...
SHIT_MINT_CONFIG_ID=0x...
MINT_FEE_MIST=1000000000
FEE_RECIPIENT=0x...
LP_RECIPIENT=0x...
SPONSOR_KEYSTORE_PATH=C:\Users\you\.sui\sui_config\sui.keystore
SPONSOR_KEYSTORE_INDEX=0
# or:
# SPONSOR_PRIVATE_KEY=suiprivkey...
```

## Deploy Move Package

From the repo root:

```bash
cd move
sui move build
sui client publish --gas-budget 100000000
```

Record the created package id, `TreasuryCap<SHIT_COIN>`, and `AdminCap`.

Then call `prepare_config` through MCP using the admin address, `AdminCap` id, `TreasuryCap<SHIT_COIN>` id, and LP recipient. Sign and execute the returned transaction bytes with the admin wallet. This mints the 500M SHIT LP allocation to `LP_RECIPIENT` and moves the treasury cap into the shared `MintConfig`, so future user mint transactions do not need to touch an admin-owned object.

Record the created shared `MintConfig` object id in `.env` as `SHIT_MINT_CONFIG_ID`.

## Run MCP Server

```bash
npm run dev
```

For production:

```bash
npm run build
npm start
```

## Run MCP HTTP Server

The HTTP entrypoint uses MCP Streamable HTTP at `/mcp` and a simple health endpoint at `/healthz`.

```bash
npm run build
npm run start:http
```

Default URL:

```text
http://127.0.0.1:3000/mcp
```

Every `/mcp` request must include:

```http
Authorization: Bearer replace-with-your-oauth-access-token
```

HTTP config:

```env
MCP_HTTP_HOST=127.0.0.1
MCP_HTTP_PORT=3000
# Use this when binding to 0.0.0.0 behind a reverse proxy.
MCP_ALLOWED_HOSTS=your-domain.com,localhost
```

For a public deployment, run the Node process behind HTTPS, keep `MCP_OAUTH_BEARER_TOKEN` secret, and bind either to `127.0.0.1` behind Nginx/Caddy or to `0.0.0.0` with `MCP_ALLOWED_HOSTS` set to the public domain.

For permanent deployment with Docker and Caddy, see [DEPLOY.md](./DEPLOY.md).

If you do not have a VPS or domain, use Render instead. See [RENDER_DEPLOY.md](./RENDER_DEPLOY.md).

## Codex Public Mint Plugin

This repo includes a local Codex plugin scaffold at:

```text
plugins/shit-sui-minter
```

It contains:

- `.codex-plugin/plugin.json` - plugin metadata.
- `.mcp.json` - Streamable HTTP MCP endpoint config.
- `skills/shit-sui-mint/SKILL.md` - user-facing mint workflow for Codex.

The plugin points to the current public tunnel:

```text
https://curvy-duck-31.loca.lt/mcp
```

Set `MCP_OAUTH_BEARER_TOKEN` in the Codex environment before using the plugin. Then a user can ask:

```text
Use the delegated_mint tool 1 time for my Sui wallet 0x...
```

Codex should check eligibility, prepare a sponsored mint, ask the user to sign with their Sui wallet, submit the signature, and report the transaction digest.

## Mint Flow

Call `check_user_mint_status` before preparing a mint:

```json
{
  "accessToken": "replace-with-your-oauth-access-token",
  "userAddress": "0xUSER_SUI_ADDRESS"
}
```

The response includes the user's SHIT balance, `mintCount`, `remainingMints`, `canMint`, and `mintBlockedReason`.

Call `prepare_mint` with:

```json
{
  "accessToken": "replace-with-your-oauth-access-token",
  "userAddress": "0xUSER_SUI_ADDRESS"
}
```

The response includes `transactionBlock`, a base64 Sui transaction block. The wallet should sign and execute it on the configured network. The signer and recipient are the same `userAddress`.

## Sponsored Mint Flow

Call `prepare_sponsored_mint` with:

```json
{
  "accessToken": "replace-with-your-oauth-access-token",
  "userAddress": "0xUSER_SUI_ADDRESS"
}
```

The response includes `transactionBlock`. The user wallet signs those bytes, then the MCP client calls `submit_sponsored_mint`:

```json
{
  "accessToken": "replace-with-your-oauth-access-token",
  "userAddress": "0xUSER_SUI_ADDRESS",
  "transactionBlock": "BASE64_TRANSACTION_BLOCK",
  "userSignature": "SERIALIZED_USER_SIGNATURE"
}
```

The server rebuilds the expected transaction for `userAddress`, signs only if it exactly matches `transactionBlock`, then broadcasts both signatures. This lets users mint through Codex/MCP without needing SUI for gas, while the contract still counts the user's signer address for the 10-mint wallet limit.

## Supply Rules

- Max total supply: `1,000,000,000 SHIT`.
- LP allocation: `500,000,000 SHIT`, minted once during `create_config`.
- Public mint allocation: `500,000,000 SHIT`.
- Mint size: `10,000,000 SHIT` per transaction.
- Max wallet mints: `10` mints per signer address.
- Contract enforces `recipient == tx_context::sender`, so a wallet cannot mint to another recipient to bypass the wallet counter.

## Important Notes

- The `TreasuryCap` is stored inside the shared `MintConfig`, which lets users mint through the shared object without requiring an admin signer in the mint transaction.
- The Move contract requires the payment coin to equal `fee_mist`, currently `1_000_000_000` MIST, or 1 SUI.
- The logo URL is a placeholder in `move/sources/shit_coin.move`; replace it before production.
