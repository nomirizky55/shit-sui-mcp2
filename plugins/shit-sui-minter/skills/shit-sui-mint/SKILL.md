---
name: shit-sui-mint
description: Use when a user wants to mint SHIT on Sui testnet through Codex, check SHIT mint eligibility, or submit a sponsored SHIT mint. This skill uses the `shit-sui-minter` MCP server.
---

# SHIT Sui Mint

Use the `shit-sui-minter` MCP server for all on-chain status checks and mint transaction preparation/submission.

## User Experience

Keep the flow conversational. The user should not need to see raw JSON unless they ask for it.

If the user asks to mint:

1. Ask for their Sui wallet address if they did not provide one.
2. Parse the requested mint count.
3. Call `check_user_mint_status` with the wallet address.
4. If `canMint` is false, explain `mintBlockedReason` and stop.
5. If the requested count is greater than `remainingMints`, explain the limit and offer to mint only `remainingMints`.
6. For each mint transaction, call `prepare_sponsored_mint`.
7. Ask the user to sign the returned transaction block with their Sui wallet.
8. When the user provides `userSignature`, call `submit_sponsored_mint`.
9. Repeat until the requested count is complete or the wallet reaches its limit.
10. Report all transaction digests, success status, new mint count, and remaining mints.

## Prompt Shortcuts

Interpret these exact user prompts as shortcuts:

- `mint 1 SHIT` means perform 1 mint transaction. The user receives 10,000,000 SHIT.
- `mint 10 SHIT` means perform 10 mint transactions. The user receives up to 100,000,000 SHIT if their wallet has 10 remaining mints.

The number in these prompts is the number of mint transactions, not the raw token quantity. If the user asks for any number between 1 and 10, treat it as that many mint transactions.

## Important Rules

- Network is Sui testnet.
- Mint amount is 10,000,000 SHIT per mint.
- Wallet mint limit is 10.
- Never prepare more transactions than the wallet's `remainingMints`.
- The user address is both signer and recipient.
- Sponsored mint means the server sponsor pays gas and the configured mint fee.
- Never claim a mint succeeded until `submit_sponsored_mint` returns a successful status.
- Do not ask the user for private keys or seed phrases.
- Do not sign on behalf of the user unless a trusted wallet-signing connector is explicitly available.

## Tool Order

Use this order for minting:

1. `check_user_mint_status`
2. `prepare_sponsored_mint`
3. user signs transaction block externally
4. `submit_sponsored_mint`
5. Repeat steps 2-4 for each requested mint transaction
6. `check_user_mint_status`

## Suggested User-Facing Copy

When asking for a signature:

`I prepared the mint transaction. Please sign this transaction block with your Sui wallet. Never share your private key or seed phrase. After your wallet returns the signature, send the signature here so I can submit the mint.`

When mint succeeds:

`Mint successful. You received 10,000,000 SHIT on Sui testnet. Tx digest: <digest>.`

When multiple mints succeed:

`Mint complete. Successfully minted <count> time(s), for a total of <amount> SHIT on Sui testnet. Tx digest: <digests>.`
