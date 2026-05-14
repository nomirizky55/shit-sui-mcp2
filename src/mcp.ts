import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { assertAuthorized } from "./auth.js";
import type { AppConfig } from "./config.js";
import { loadSponsorKeypair } from "./sponsor.js";
import {
  assertPackageObjectsExist,
  createSuiClient,
  getMintStatus,
  getUserMintStatus,
  prepareConfigTransaction,
  prepareMintTransaction,
  prepareSponsoredMintTransaction,
  submitSponsoredMintTransaction
} from "./sui.js";

const authShape = {
  accessToken: z.string().optional().describe("Optional OAuth bearer token for private MCP deployments.")
};

function textJson(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

export function createShitMinterMcpServer(config: AppConfig): McpServer {
  const client = createSuiClient(config);
  const server = new McpServer({
    name: "sui-mcp-shit-minter",
    version: "0.1.0"
  });

  server.tool(
    "health",
    "Check that the MCP server is alive and configured for the selected Sui network.",
    authShape,
    async ({ accessToken }) => {
      assertAuthorized(config, accessToken);

      return textJson({
        ok: true,
        service: "sui-mcp-shit-minter",
        network: config.SUI_NETWORK
      });
    }
  );

  server.tool(
    "quote_mint_fee",
    "Return the exact mint fee and amount for the SHIT mint flow.",
    authShape,
    async ({ accessToken }) => {
      assertAuthorized(config, accessToken);

      const status = getMintStatus(config);
      return textJson({
        symbol: status.symbol,
        tokenAmount: "10000000",
        rawTokenAmount: status.mintAmount,
        tokenDecimals: status.decimals,
        totalSupply: "1000000000",
        rawTotalSupply: status.totalSupply,
        publicMintAllocation: "500000000",
        rawPublicMintAllocation: status.publicMintAllocation,
        lpAllocation: "500000000",
        rawLpAllocation: status.lpAllocation,
        maxMintsPerWallet: status.maxMintsPerWallet,
        feeMist: status.feeMist,
        feeSui: "1",
        feeRecipient: status.feeRecipient,
        lpRecipient: status.lpRecipient
      });
    }
  );

  server.tool(
    "check_mint_status",
    "Check configured Sui package, treasury cap, and shared mint config objects.",
    authShape,
    async ({ accessToken }) => {
      assertAuthorized(config, accessToken);
      await assertPackageObjectsExist(client, config);

      return textJson({
        ok: true,
        ...getMintStatus(config)
      });
    }
  );

  server.tool(
    "check_user_mint_status",
    "Check a user's SHIT balance, wallet mint count, remaining mints, and mint eligibility.",
    {
      ...authShape,
      userAddress: z.string().regex(/^0x[a-fA-F0-9]+$/).describe("Sui address to check.")
    },
    async ({ accessToken, userAddress }) => {
      assertAuthorized(config, accessToken);
      await assertPackageObjectsExist(client, config);

      const status = await getUserMintStatus(client, config, userAddress);
      return textJson({
        ok: true,
        ...status
      });
    }
  );

  server.tool(
    "prepare_mint",
    "Prepare an unsigned Sui transaction that pays 1 SUI and mints 10M SHIT to the user's own address.",
    {
      ...authShape,
      userAddress: z.string().regex(/^0x[a-fA-F0-9]+$/).describe("Sui address that signs, pays, and receives the mint.")
    },
    async ({ accessToken, userAddress }) => {
      assertAuthorized(config, accessToken);
      await assertPackageObjectsExist(client, config);

      const transactionBlock = await prepareMintTransaction(client, config, userAddress);

      return textJson({
        kind: "sui_transaction_block",
        network: config.SUI_NETWORK,
        signer: userAddress,
        recipient: userAddress,
        transactionBlock,
        expectedFeeMist: config.MINT_FEE_MIST.toString(),
        expectedMintAmount: "10000000",
        expectedSymbol: "SHIT"
      });
    }
  );

  server.tool(
    "prepare_sponsored_mint",
    "Prepare an unsigned Sui transaction where the user signs as sender/recipient and the configured sponsor pays gas plus the 1 SUI mint fee.",
    {
      ...authShape,
      userAddress: z.string().regex(/^0x[a-fA-F0-9]+$/).describe("Sui address that signs and receives the mint.")
    },
    async ({ accessToken, userAddress }) => {
      assertAuthorized(config, accessToken);
      await assertPackageObjectsExist(client, config);

      const sponsor = loadSponsorKeypair(config).toSuiAddress();
      const transactionBlock = await prepareSponsoredMintTransaction(client, config, userAddress, sponsor);

      return textJson({
        kind: "sponsored_sui_transaction_block",
        network: config.SUI_NETWORK,
        signer: userAddress,
        recipient: userAddress,
        sponsor,
        transactionBlock,
        expectedSponsorPaysFeeMist: config.MINT_FEE_MIST.toString(),
        expectedSponsorGasBudgetMist: "50000000",
        expectedMintAmount: "10000000",
        expectedSymbol: "SHIT",
        nextStep: "Have the user wallet sign transactionBlock, then call submit_sponsored_mint with userSignature."
      });
    }
  );

  server.tool(
    "submit_sponsored_mint",
    "Sign a prepared sponsored mint transaction as the configured sponsor and broadcast it with the user's signature.",
    {
      ...authShape,
      userAddress: z.string().regex(/^0x[a-fA-F0-9]+$/).describe("Sui address that signed and receives the mint."),
      transactionBlock: z.string().min(1).describe("Base64 Sui transaction block returned by prepare_sponsored_mint."),
      userSignature: z.string().min(1).describe("Serialized Sui transaction signature from the user wallet.")
    },
    async ({ accessToken, userAddress, transactionBlock, userSignature }) => {
      assertAuthorized(config, accessToken);

      const sponsor = loadSponsorKeypair(config);
      const expectedTransactionBlock = await prepareSponsoredMintTransaction(client, config, userAddress, sponsor.toSuiAddress());
      if (transactionBlock !== expectedTransactionBlock) {
        throw new Error("Transaction block does not match the expected sponsored mint for this user. Prepare a fresh sponsored mint transaction and sign that exact block.");
      }

      const result = await submitSponsoredMintTransaction(client, sponsor, transactionBlock, userSignature);

      return textJson({
        digest: result.digest,
        status: result.effects?.status,
        sponsor: sponsor.toSuiAddress(),
        balanceChanges: result.balanceChanges,
        objectChanges: result.objectChanges
      });
    }
  );

  server.tool(
    "prepare_config",
    "Prepare an unsigned admin transaction that creates the shared mint config after publishing the Move package.",
    {
      ...authShape,
      sender: z.string().regex(/^0x[a-fA-F0-9]+$/).describe("Admin Sui address that owns the AdminCap."),
      adminCapId: z.string().regex(/^0x[a-fA-F0-9]+$/).describe("AdminCap object id created at package publish time."),
      treasuryCapId: z.string().regex(/^0x[a-fA-F0-9]+$/).describe("TreasuryCap<SHIT_COIN> object id created at package publish time."),
      feeRecipient: z.string().regex(/^0x[a-fA-F0-9]+$/).optional(),
      lpRecipient: z.string().regex(/^0x[a-fA-F0-9]+$/).optional(),
      feeMist: z.string().regex(/^\d+$/).optional()
    },
    async ({ accessToken, sender, adminCapId, treasuryCapId, feeRecipient, lpRecipient, feeMist }) => {
      assertAuthorized(config, accessToken);

      const transactionBlock = await prepareConfigTransaction(
        client,
        config,
        sender,
        adminCapId,
        treasuryCapId,
        feeRecipient,
        lpRecipient,
        feeMist === undefined ? undefined : BigInt(feeMist)
      );

      return textJson({
        kind: "sui_transaction_block",
        network: config.SUI_NETWORK,
        signer: sender,
        transactionBlock,
        creates: "MintConfig",
        lpRecipient: lpRecipient ?? config.LP_RECIPIENT,
        lpAllocation: "500000000"
      });
    }
  );

  return server;
}
