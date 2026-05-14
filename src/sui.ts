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
  runtimePackageId: string;
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
  delegatedRelayer: string | null;
  delegatedRemainingMints: number | null;
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
    runtimePackageId: getRuntimePackageId(config),
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
  const ids = Array.from(new Set([config.SUI_PACKAGE_ID, getRuntimePackageId(config), mintConfigId]));
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
  userAddress: string,
  delegatedRelayer?: string
): Promise<UserMintStatus> {
  const mintConfigId = requireMintConfigId(config);
  const coinType = getShitCoinType(config);
  const [balance, mintCount, configState, delegatedRemainingMints] = await Promise.all([
    client.getBalance({ owner: userAddress, coinType }),
    getUserMintCount(client, mintConfigId, userAddress),
    getMintConfigState(client, mintConfigId),
    delegatedRelayer ? getDelegatedMintCount(client, config, userAddress, delegatedRelayer) : Promise.resolve(null)
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
    frozen: configState.frozen,
    delegatedRelayer: delegatedRelayer ?? null,
    delegatedRemainingMints
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

async function getDelegatedMintCount(
  client: SuiClient,
  config: AppConfig,
  owner: string,
  relayer: string
): Promise<number> {
  const mintConfigId = requireMintConfigId(config);
  const dynamicField = await client.getDynamicFieldObject({
    parentId: mintConfigId,
    name: {
      type: `${getDelegationKeyPackageId(config)}::shit_coin::DelegationKey`,
      value: {
        owner,
        relayer
      }
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

export async function prepareApproveRelayerTransaction(
  client: SuiClient,
  config: AppConfig,
  owner: string,
  relayer: string,
  maxMints: number,
  sponsor?: string
): Promise<string> {
  const tx = new Transaction();
  tx.setSender(owner);
  if (sponsor) {
    tx.setGasOwner(sponsor);
    tx.setGasBudget(50_000_000n);
  }

  const prepaidFeeMist = config.MINT_FEE_MIST * BigInt(maxMints);
  const paymentCoins = await findSuiCoinsForAmount(client, owner, prepaidFeeMist);
  const primaryPaymentCoin = tx.object(paymentCoins[0]);
  if (paymentCoins.length > 1) {
    tx.mergeCoins(
      primaryPaymentCoin,
      paymentCoins.slice(1).map((coinId) => tx.object(coinId))
    );
  }
  const [paymentCoin] = tx.splitCoins(primaryPaymentCoin, [tx.pure.u64(prepaidFeeMist)]);

  tx.moveCall({
    target: `${getRuntimePackageId(config)}::shit_coin::approve_relayer_prepaid`,
    arguments: [
      tx.object(requireMintConfigId(config)),
      paymentCoin,
      tx.pure.address(relayer),
      tx.pure.u64(BigInt(maxMints))
    ]
  });

  const bytes = await tx.build({ client });
  return toBase64(bytes);
}

export async function submitSponsoredApproveRelayerTransaction(
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
      showEffects: true,
      showObjectChanges: true
    }
  });
}

export async function executeDelegatedMintTransaction(
  client: SuiClient,
  config: AppConfig,
  relayerKeypair: Keypair,
  recipient: string
) {
  const tx = new Transaction();
  tx.setSender(relayerKeypair.toSuiAddress());
  tx.setGasBudget(50_000_000n);

  tx.moveCall({
    target: `${getRuntimePackageId(config)}::shit_coin::delegated_mint_prepaid`,
    arguments: [
      tx.object(requireMintConfigId(config)),
      tx.pure.address(recipient),
      tx.pure.u64(SHIT_MINT_AMOUNT)
    ]
  });

  return client.signAndExecuteTransaction({
    signer: relayerKeypair,
    transaction: tx,
    requestType: "WaitForLocalExecution",
    options: {
      showBalanceChanges: true,
      showEffects: true,
      showObjectChanges: true
    }
  });
}

async function findSuiCoinsForAmount(client: SuiClient, owner: string, amount: bigint): Promise<string[]> {
  let cursor: string | null | undefined;
  let total = 0n;
  const coinIds: string[] = [];

  do {
    const page = await client.getCoins({
      owner,
      coinType: "0x2::sui::SUI",
      cursor
    });

    for (const coin of page.data) {
      coinIds.push(coin.coinObjectId);
      total += BigInt(coin.balance);
      if (total >= amount) {
        return coinIds;
      }
    }

    cursor = page.nextCursor;
  } while (cursor);

  throw new Error(`Not enough SUI for the prepaid mint deposit. Need ${amount.toString()} MIST.`);
}

function buildMintTransaction(config: AppConfig, recipient: string): Transaction {
  const tx = new Transaction();
  tx.setSender(recipient);
  const mintConfigId = requireMintConfigId(config);

  const [feeCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(config.MINT_FEE_MIST)]);

  tx.moveCall({
    target: `${getRuntimePackageId(config)}::shit_coin::mint`,
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
    target: `${getRuntimePackageId(config)}::shit_coin::create_config`,
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

function getRuntimePackageId(config: AppConfig): string {
  return config.SUI_RUNTIME_PACKAGE_ID ?? config.SUI_PACKAGE_ID;
}

function getDelegationKeyPackageId(config: AppConfig): string {
  return config.SUI_DELEGATION_KEY_PACKAGE_ID ?? getRuntimePackageId(config);
}
