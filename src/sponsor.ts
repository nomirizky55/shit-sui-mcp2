import { readFileSync } from "node:fs";
import type { Keypair } from "@mysten/sui/cryptography";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Secp256k1Keypair } from "@mysten/sui/keypairs/secp256k1";
import { Secp256r1Keypair } from "@mysten/sui/keypairs/secp256r1";
import { fromBase64 } from "@mysten/sui/utils";
import type { AppConfig } from "./config.js";

const KEYSTORE_SCHEME = {
  0: "ED25519",
  1: "Secp256k1",
  2: "Secp256r1"
} as const;

type SupportedScheme = (typeof KEYSTORE_SCHEME)[keyof typeof KEYSTORE_SCHEME];

export function loadSponsorKeypair(config: AppConfig): Keypair {
  if (config.SPONSOR_PRIVATE_KEY) {
    const decoded = decodeSuiPrivateKey(config.SPONSOR_PRIVATE_KEY);
    assertSupportedScheme(decoded.scheme);
    return keypairFromSecret(decoded.scheme, decoded.secretKey);
  }

  if (!config.SPONSOR_KEYSTORE_PATH) {
    throw new Error("Sponsor is not configured. Set SPONSOR_PRIVATE_KEY or SPONSOR_KEYSTORE_PATH.");
  }

  const keystore = JSON.parse(readFileSync(config.SPONSOR_KEYSTORE_PATH, "utf8")) as unknown;
  if (!Array.isArray(keystore) || !keystore.every((entry) => typeof entry === "string")) {
    throw new Error("Sui keystore must be a JSON array of base64-encoded keys.");
  }

  const encoded = keystore[config.SPONSOR_KEYSTORE_INDEX];
  if (!encoded) {
    throw new Error(`No sponsor key found at SPONSOR_KEYSTORE_INDEX=${config.SPONSOR_KEYSTORE_INDEX}.`);
  }

  const bytes = fromBase64(encoded);
  const scheme = KEYSTORE_SCHEME[bytes[0] as keyof typeof KEYSTORE_SCHEME];
  if (!scheme) {
    throw new Error("Unsupported Sui keystore signature scheme.");
  }

  return keypairFromSecret(scheme, bytes.slice(1));
}

function assertSupportedScheme(scheme: string): asserts scheme is SupportedScheme {
  if (scheme !== "ED25519" && scheme !== "Secp256k1" && scheme !== "Secp256r1") {
    throw new Error(`Unsupported sponsor signature scheme: ${scheme}.`);
  }
}

function keypairFromSecret(scheme: SupportedScheme, secretKey: Uint8Array): Keypair {
  switch (scheme) {
    case "ED25519":
      return Ed25519Keypair.fromSecretKey(secretKey);
    case "Secp256k1":
      return Secp256k1Keypair.fromSecretKey(secretKey);
    case "Secp256r1":
      return Secp256r1Keypair.fromSecretKey(secretKey);
  }
}
