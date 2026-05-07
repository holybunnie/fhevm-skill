import { createInstance, SepoliaConfigV2 } from "@zama-fhe/relayer-sdk/web";
import type { FhevmInstance } from "@zama-fhe/relayer-sdk/web";
import { chain } from "./client";

let instance: FhevmInstance | null = null;

export async function getFhevmInstance(): Promise<FhevmInstance> {
  if (instance) return instance;

  if (chain.id !== 11155111) {
    throw new Error(
      "FHEVM encryption requires Sepolia network. " +
      "Switch your wallet to Sepolia to use encrypted operations. " +
      "Local Hardhat FHE is only available via 'npx hardhat test'."
    );
  }

  instance = await createInstance({
    ...SepoliaConfigV2,
    network: window.ethereum,
  });
  return instance;
}

export function resetFhevmInstance() {
  instance = null;
}
