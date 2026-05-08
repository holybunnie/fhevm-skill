import { useState } from "react";
import { toHex } from "viem";
import { getFhevmInstance } from "../lib/fhevm";
import { getWalletClient, publicClient } from "../lib/client";
import { lendingAbi } from "../lib/abis";

const LENDING = import.meta.env.VITE_LENDING_CONTRACT_ADDRESS as `0x${string}`;

export function RepayPanel({ account }: { account: `0x${string}` }) {
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState("");

  async function handleRepay() {
    if (!amount) return;
    setStatus("Encrypting...");
    try {
      const fhevm = await getFhevmInstance();
      const input = fhevm.createEncryptedInput(LENDING, account);
      input.add64(BigInt(amount));
      const encrypted = await input.encrypt();

      setStatus("Sending tx...");
      const walletClient = getWalletClient();
      const hash = await walletClient.writeContract({
        address: LENDING, abi: lendingAbi, functionName: "repay",
        args: [toHex(encrypted.handles[0]), toHex(encrypted.inputProof)], account,
      });

      setStatus("Confirming...");
      await publicClient.waitForTransactionReceipt({ hash });
      setStatus("Repaid!");
      setAmount("");
    } catch (err: any) {
      setStatus(`Error: ${err.message.slice(0, 80)}`);
    }
  }

  return (
    <div className="card">
      <h3 className="font-semibold mb-2">Repay</h3>
      <input
        type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
        placeholder="Amount" className="w-full p-2 border rounded mb-2"
      />
      <button onClick={handleRepay} disabled={!amount} className="btn-primary w-full">
        Repay
      </button>
      {status && <p className="text-xs text-purple-200/60 mt-2">{status}</p>}
    </div>
  );
}
