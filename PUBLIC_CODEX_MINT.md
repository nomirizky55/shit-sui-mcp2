# Public Codex Mint Flow

This is the user-facing Codex flow for public SHIT minting on Sui testnet.

## Endpoint

MCP Streamable HTTP endpoint:

```text
https://curvy-duck-31.loca.lt/mcp
```

Health endpoint:

```text
https://curvy-duck-31.loca.lt/healthz
```

## Auth

The MCP client must send:

```http
Authorization: Bearer <ACCESS_TOKEN>
```

The MCP tools currently also require:

```json
{
  "accessToken": "<ACCESS_TOKEN>"
}
```

Do not publish the access token in public posts. Give it only to users or testers who should be allowed to mint through the sponsor.

## Codex Prompt For Users

Users should be able to say:

```text
Use the delegated_mint tool 1 time for my Sui wallet 0x...
```

or:

```text
Use the delegated_mint tool 10 times for my Sui wallet 0x...
```

Codex should then:

1. Check mint eligibility with `check_user_mint_status`.
2. Interpret `mint 1 SHIT` as 1 mint transaction, worth 10,000,000 SHIT.
3. Interpret `mint 10 SHIT` as 10 mint transactions, worth up to 100,000,000 SHIT.
4. Prepare a sponsored mint with `prepare_sponsored_mint`.
5. Ask the user to sign the transaction block in their Sui wallet.
6. Submit with `submit_sponsored_mint` after the user provides `userSignature`.
7. Repeat prepare/sign/submit for the requested number of mints.
8. Check status again and report the result.

## User-Facing Steps

1. Open Codex with the `SHIT Sui Minter` plugin enabled.
2. Send:

```text
Use the delegated_mint tool 1 time for my Sui wallet 0xYOUR_SUI_ADDRESS
```

or:

```text
Use the delegated_mint tool 10 times for my Sui wallet 0xYOUR_SUI_ADDRESS
```

3. Codex checks whether the wallet can mint.
4. Codex checks whether the wallet has enough remaining mints.
5. Codex prepares a sponsored transaction.
6. User signs the transaction block with a Sui wallet.
7. User gives Codex the resulting signature.
8. Codex submits the transaction and returns the digest.
9. For `mint 10 SHIT`, Codex repeats the sign/submit process up to 10 times.

## Current Limitation

Codex can prepare and submit the sponsored transaction, but the user still needs a wallet-signing step. Do not ask for private keys or seed phrases. The safe handoff is: Codex gives transaction bytes, wallet returns a signature, Codex submits the signed transaction.
