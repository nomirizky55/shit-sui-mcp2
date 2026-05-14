import { getFullnodeUrl, SuiClient } from "@mysten/sui/client";
import type { Keypair } from "@mysten/sui/cryptography";
import { Transaction } from "@mysten/sui/transactions";
import { fromBase64, toBase64 } from "@mysten/sui/utils";
import type { AppConfig } from "./config.js";

export const SHIT_DECIMALS = 6;
export const SHIT_MINT_AMOUNT = 10_000_000n * 10n ** BigInt(SHIT_DECIMALS);
export const SHIT_TOTAL_SUPPLY = 1_000_000_000n * 10n ** BigInt(SHIT_DECIMALS);
export const SHIT_PUBLIC_MINT_ALLOCATION = 500_000_000n * 10n ** BigInt(SHIT_DECIMALS);
export const SHIT_LP_ALLOCATION = 500_000_000n * 10n ** BigInt(SHIT_DECIMALS);
export const SHIT_MAX_MINTS_PER_WALLET = 10;

export type MintStatus = {
  network: AppConfig["SUI_NETWORK"];
  packageId: string;
  mintConfigId: string | null;
  feeRecipient: string;
  lpRecipient: string;
  feeMist: string;
  mintAmount: string;
  totalSupply: string;
  publicMintAllocation: string;
  lpAllocation: string;
  maxMintsPerWallet: number;
  symbol: "SHIT";
  decimals: number;
};

export type UserMintStatus = {
  network: AppConfig["SUI_NETWORK"];
  userAddress: string;
  coinType: string;
  rawBalance: string;
  tokenBalance: string;
  mintCount: number;
  remainingMints: number;
  maxMintsPerWallet: number;
  canMint: boolean;
  mintBlockedReason: string | null;
  publicMinted: string | null;
  publicMintedTokens: string | null;
  publicMintRemaining: string | null;
  publicMintRemainingTokens: string | null;
  frozen: boolean | null;
};

export function createSuiClient(config: AppConfig): SuiClient {
  return new SuiClient({
    url: config.SUI_FULLNODE_URL ?? getFullnodeUrl(config.SUI_NETWORK)
  });
}

export function getMintStatus(config: AppConfig): MintStatus {
  return {
    network: config.SUI_NETWORK,
    packageId: config.SUI_PACKAGE_ID,
    mintConfigId: config.SHIT_MINT_CONFIG_ID ?? null,
    feeRecipient: config.FEE_RECIPIENT,
    lpRecipient: config.LP_RECIPIENT,
    feeMist: config.MINT_FEE_MIST.toString(),
    mintAmount: SHIT_MINT_AMOUNT.toString(),
    totalSupply: SHIT_TOTAL_SUPPLY.toString(),
    publicMintAllocation: SHIT_PUBLIC_MINT_ALLOCATION.toString(),
    lpAllocation: SHIT_LP_ALLOCATION.toString(),
    maxMintsPerWallet: SHIT_MAX_MINTS_PER_WALLET,
    symbol: "SHIT",
    decimals: SHIT_DECIMALS
  };
}

export async function assertPackageObjectsExist(client: SuiClient, config: AppConfig): Promise<void> {
  const mintConfigId = requireMintConfigId(config);
  const ids = [config.SUI_PACKAGE_ID, mintConfigId];
  const objects = await client.multiGetObjects({
    ids,
    options: { showType: true }
  });

  const missing = objects
    .map((object, index) => (object.error ? ids[index] : null))
    .filter((id): id is string => id !== null);

  if (missing.length > 0) {
    throw new Error(`Missing configured Sui object(s): ${missing.join(", ")}`);
  }
}

export async function getUserMintStatus(
  client: SuiClient,
  config: AppConfig,
  userAddress: string
): Promise<UserMintStatus> {
  const mintConfigId = requireMintConfigId(config);
  const coinType = getShitCoinType(config);
  const [balance, mintCount, configState] = await Promise.all([
    client.getBalance({ owner: userAddress, coinType }),
    getUserMintCount(client, mintConfigId, userAddress),
    getMintConfigState(client, mintConfigId)
  ]);

  const remainingMints = Math.max(SHIT_MAX_MINTS_PER_WALLET - mintCount, 0);
  const publicMintRemaining =
    configState.publicMinted === null
      ? null
      : (SHIT_PUBLIC_MINT_ALLOCATION - configState.publicMinted).toString();
  const publicMintRemainingRaw = publicMintRemaining === null ? null : BigInt(publicMintRemaining);
  const canMint =
    remainingMints > 0 &&
    configState.frozen !== true &&
    (publicMintRemainingRaw === null || publicMintRemainingRaw >= SHIT_MINT_AMOUNT);

  return {
    network: config.SUI_NETWORK,
    userAddress,
    coinType,
    rawBalance: balance.totalBalance,
    tokenBalance: formatTokenAmount(BigInt(balance.totalBalance)),
    mintCount,
    remainingMints,
    maxMintsPerWallet: SHIT_MAX_MINTS_PER_WALLET,
    canMint,
    mintBlockedReason: getMintBlockedReason(remainingMints, configState.frozen, publicMintRemainingRaw),
    publicMinted: configState.publicMinted?.toString() ?? null,
    publicMintedTokens: configState.publicMinted === null ? null : formatTokenAmount(configState.publicMinted),
    publicMintRemaining,
    publicMintRemainingTokens: publicMintRemainingRaw === null ? null : formatTokenAmount(publicMintRemainingRaw),
    frozen: configState.frozen
  };
}

function requireMintConfigId(config: AppConfig): string {
  if (!config.SHIT_MINT_CONFIG_ID) {
    throw new Error("SHIT_MINT_CONFIG_ID is not configured yet. Run prepare_config first, then set the created MintConfig object id.");
  }

  return config.SHIT_MINT_CONFIG_ID;
}

function getShitCoinType(config: AppConfig): string {
  return `${config.SUI_PACKAGE_ID}::shit_coin::SHIT_COIN`;
}

async function getUserMintCount(client: SuiClient, mintConfigId: string, userAddress: string): Promise<number> {
  const dynamicField = await client.getDynamicFieldObject({
    parentId: mintConfigId,
    name: {
      type: "address",
      value: userAddress
    }
  });

  if (dynamicField.error || !dynamicField.data?.content || dynamicField.data.content.dataType !== "moveObject") {
    return 0;
  }

  return Number(extractMoveField(dynamicField.data.content.fields, "value") ?? 0);
}

async function getMintConfigState(
  client: SuiClient,
  mintConfigId: string
): Promise<{ publicMinted: bigint | null; frozen: boolean | null }> {
  const object = await client.getObject({
    id: mintConfigId,
    options: { showContent: true }
  });

  if (object.error || !object.data?.content || object.data.content.dataType !== "moveObject") {
    return { publicMinted: null, frozen: null };
  }

  const publicMinted = extractMoveField(object.data.content.fields, "public_minted");
  const frozen = extractMoveField(object.data.content.fields, "frozen");

  return {
    publicMinted: typeof publicMinted === "string" || typeof publicMinted === "number" ? BigInt(publicMinted) : null,
    frozen: typeof frozen === "boolean" ? frozen : null
  };
}

function extractMoveField(fields: unknown, key: string): unknown {
  if (fields && typeof fields === "object" && "fields" in fields) {
    const nested = (fields as { fields?: Record<string, unknown> }).fields;
    return nested?.[key];
  }

  if (fields && typeof fields === "object") {
    return (fields as Record<string, unknown>)[key];
  }

  return undefined;
}

function formatTokenAmount(rawAmount: bigint): string {
  const scale = 10n ** BigInt(SHIT_DECIMALS);
  const whole = rawAmount / scale;
  const fraction = rawAmount % scale;
  if (fraction === 0n) {
    return whole.toString();
  }

  return `${whole}.${fraction.toString().padStart(SHIT_DECIMALS, "0").replace(/0+$/, "")}`;
}

function getMintBlockedReason(
  remainingMints: number,
  frozen: boolean | null,
  publicMintRemaining: bigint | null
): string | null {
  if (frozen === true) {
    return "Mint is currently frozen.";
  }

  if (remainingMints <= 0) {
    return "Wallet has reached the 10 mint limit.";
  }

  if (publicMintRemaining !== null && publicMintRemaining < SHIT_MINT_AMOUNT) {
    return "Public mint allocation is sold out.";
  }

  return null;
}

export async function prepareMintTransaction(
  client: SuiClient,
  config: AppConfig,
  recipient: string
): Promise<string> {
  const tx = buildMintTransaction(config, recipient);
  const bytes = await tx.build({ client });
  return toBase64(bytes);
}

export async function prepareSponsoredMintTransaction(
  client: SuiClient,
  config: AppConfig,
  recipient: string,
  sponsor: string
): Promise<string> {
  const tx = buildMintTransaction(config, recipient);
  tx.setGasOwner(sponsor);
  tx.setGasBudget(50_000_000n);

  const bytes = await tx.build({ client });
  return toBase64(bytes);
}

export async function submitSponsoredMintTransaction(
  client: SuiClient,
  sponsorKeypair: Keypair,
  transactionBlock: string,
  userSignature: string
) {
  const bytes = fromBase64(transactionBlock);
  const sponsorSignature = (await sponsorKeypair.signTransaction(bytes)).signature;

  return client.executeTransactionBlock({
    transactionBlock,
    signature: [userSignature, sponsorSignature],
    requestType: "WaitForLocalExecution",
    options: {
      showBalanceChanges: true,
      showEffects: true,
      showObjectChanges: true
    }
  });
}

function buildMintTransaction(config: AppConfig, recipient: string): Transaction {
  const tx = new Transaction();
  tx.setSender(recipient);
  const mintConfigId = requireMintConfigId(config);

  const [feeCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(config.MINT_FEE_MIST)]);

  tx.moveCall({
    target: `${config.SUI_PACKAGE_ID}::shit_coin::mint`,
    arguments: [
      tx.object(mintConfigId),
      feeCoin,
      tx.pure.address(recipient),
      tx.pure.u64(SHIT_MINT_AMOUNT)
    ]
  });

  return tx;
}

export async function prepareConfigTransaction(
  client: SuiClient,
  config: AppConfig,
  sender: string,
  adminCapId: string,
  treasuryCapId: string,
  feeRecipient = config.FEE_RECIPIENT,
  lpRecipient = config.LP_RECIPIENT,
  feeMist = config.MINT_FEE_MIST
): Promise<string> {
  const tx = new Transaction();
  tx.setSender(sender);

  tx.moveCall({
    target: `${config.SUI_PACKAGE_ID}::shit_coin::create_config`,
    arguments: [
      tx.object(adminCapId),
      tx.object(treasuryCapId),
      tx.pure.address(feeRecipient),
      tx.pure.address(lpRecipient),
      tx.pure.u64(feeMist)
    ]
  });

  const bytes = await tx.build({ client });
  return toBase64(bytes);
}
