import { useState } from "react";
import { getFhevmInstance } from "../lib/fhevm";
import { getWalletClient, publicClient } from "../lib/client";
import { lendingAbi } from "../lib/abis";

const LENDING = import.meta.env.VITE_LENDING_CONTRACT_ADDRESS as `0x${string}`;

export function BalanceDisplay({ account }: { account: `0x${string}` }) {
  const [collateral, setCollateral] = useState("--");
  const [debt, setDebt] = useState("--");
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const fhevm = await getFhevmInstance();
      const walletClient = getWalletClient();
      const { publicKey, signature } = await fhevm.generateDecryptionKeys(
        LENDING, account, walletClient,
      );

      // Collateral
      const colHandle = await publicClient.readContract({
        address: LENDING, abi: lendingAbi, functionName: "getCollateral", args: [account],
      }) as `0x${string}`;

      if (colHandle && colHandle !== "0x" + "0".repeat(64)) {
        const clear = await fhevm.userDecrypt(colHandle, LENDING, account, { publicKey, signature });
        setCollateral(clear.toString());
      } else {
        setCollateral("0");
      }

      // Debt
      const debtHandle = await publicClient.readContract({
        address: LENDING, abi: lendingAbi, functionName: "getDebt", args: [account],
      }) as `0x${string}`;

      if (debtHandle && debtHandle !== "0x" + "0".repeat(64)) {
        const clear = await fhevm.userDecrypt(debtHandle, LENDING, account, { publicKey, signature });
        setDebt(clear.toString());
      } else {
        setDebt("0");
      }
    } catch (err: any) {
      console.error("Decrypt error:", err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-semibold">Your Position</h3>
        <button onClick={refresh} disabled={loading} className="btn-secondary text-sm">
          {loading ? "Decrypting..." : "Refresh"}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white/5 rounded-lg p-4">
          <p className="text-sm text-purple-300/60">Collateral</p>
          <p className="text-2xl font-mono text-green-300">{collateral} <span className="text-sm text-white/40">cUSDT</span></p>
        </div>
        <div className="bg-white/5 rounded-lg p-4">
          <p className="text-sm text-purple-300/60">Debt</p>
          <p className="text-2xl font-mono text-orange-300">{debt} <span className="text-sm text-white/40">cUSDT</span></p>
        </div>
      </div>
    </div>
  );
}
