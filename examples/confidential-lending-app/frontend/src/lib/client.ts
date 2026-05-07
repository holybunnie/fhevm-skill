import { createPublicClient, createWalletClient, custom, http } from "viem";
import { hardhat, sepolia } from "viem/chains";

const network = import.meta.env.VITE_NETWORK || "hardhat";
export const chain = network === "sepolia" ? sepolia : hardhat;

export const publicClient = createPublicClient({
  chain,
  transport: network === "sepolia" ? http() : http("http://127.0.0.1:8545"),
});

export function getWalletClient() {
  if (!window.ethereum) throw new Error("No wallet detected");
  return createWalletClient({
    chain,
    transport: custom(window.ethereum),
  });
}
