import { z } from "zod";

const envSchema = z.object({
  SUI_NETWORK: z.enum(["mainnet", "testnet", "devnet", "localnet"]).default("testnet"),
  SUI_FULLNODE_URL: z.string().url().optional(),
  PUBLIC_MCP: z.coerce.boolean().default(false),
  MCP_OAUTH_BEARER_TOKEN: z.string().min(16).optional(),
  SUI_PACKAGE_ID: z.string().regex(/^0x[a-fA-F0-9]+$/),
  SUI_RUNTIME_PACKAGE_ID: z.string().regex(/^0x[a-fA-F0-9]+$/).optional(),
  SUI_DELEGATION_KEY_PACKAGE_ID: z.string().regex(/^0x[a-fA-F0-9]+$/).optional(),
  SHIT_MINT_CONFIG_ID: z.string().regex(/^0x[a-fA-F0-9]+$/).optional(),
  MINT_FEE_MIST: z.coerce.bigint().default(1_000_000_000n),
  FEE_RECIPIENT: z.string().regex(/^0x[a-fA-F0-9]+$/),
  LP_RECIPIENT: z.string().regex(/^0x[a-fA-F0-9]+$/),
  SPONSOR_PRIVATE_KEY: z.string().optional(),
  SPONSOR_KEYSTORE_PATH: z.string().optional(),
  SPONSOR_KEYSTORE_INDEX: z.coerce.number().int().min(0).default(0)
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(): AppConfig {
  return envSchema.parse(process.env);
}
