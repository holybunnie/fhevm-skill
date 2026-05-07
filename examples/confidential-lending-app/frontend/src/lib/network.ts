import { hardhat, sepolia } from "viem/chains";

export type NetworkName = "hardhat" | "sepolia";

export function getChainConfig(network: NetworkName) {
  switch (network) {
    case "sepolia":
      return { chain: sepolia, rpcUrl: "https://rpc.sepolia.org" };
    case "hardhat":
    default:
      return { chain: hardhat, rpcUrl: "http://127.0.0.1:8545" };
  }
}

export async function switchNetwork(chainId: number) {
  if (!window.ethereum) return;
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: `0x${chainId.toString(16)}` }],
    });
  } catch (err: any) {
    if (err.code === 4902) {
      console.error("Chain not added to wallet");
    }
    throw err;
  }
}
