import { chain } from "../lib/client";
import { switchNetwork } from "../lib/network";
import { hardhat, sepolia } from "viem/chains";

export function NetworkSwitcher() {
  async function handleSwitch(chainId: number) {
    try {
      await switchNetwork(chainId);
    } catch {
      // user rejected or chain not added
    }
  }

  return (
    <div className="flex items-center gap-2 text-sm bg-white/5 rounded-full px-4 py-2 border border-white/10">
      <span className="text-purple-300/50">Network:</span>
      <button
        onClick={() => handleSwitch(hardhat.id)}
        className={chain.id === hardhat.id
          ? "text-purple-300 font-bold"
          : "text-purple-300/50 hover:text-purple-200"}
      >
        Hardhat
      </button>
      <span className="text-white/20">|</span>
      <button
        onClick={() => handleSwitch(sepolia.id)}
        className={chain.id === sepolia.id
          ? "text-purple-300 font-bold"
          : "text-purple-300/50 hover:text-purple-200"}
      >
        Sepolia
      </button>
    </div>
  );
}
