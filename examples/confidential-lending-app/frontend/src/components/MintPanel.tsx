import { useState } from "react";
import { toHex } from "viem";
import { getFhevmInstance } from "../lib/fhevm";
import { getWalletClient, publicClient } from "../lib/client";
import { tokenAbi } from "../lib/abis";

const TOKEN = import.meta.env.VITE_CUSDT_CONTRACT_ADDRESS as `0x${string}`;

export function MintPanel({ account }: { account: `0x${string}` }) {
  const [amount, setAmount] = useState("1000");
  const [status, setStatus] = useState("");

  async function handleMint() {
    if (!amount) return;
    setStatus("Encrypting...");
    try {
      const fhevm = await getFhevmInstance();
      const input = fhevm.createEncryptedInput(TOKEN, account);
      input.add64(BigInt(amount));
      const encrypted = await input.encrypt();

      setStatus("Sending tx...");
      const walletClient = getWalletClient();
      const hash = await walletClient.writeContract({
        address: TOKEN,
        abi: tokenAbi,
        functionName: "mint",
        args: [account, toHex(encrypted.handles[0]), toHex(encrypted.inputProof)],
        account,
      });

      setStatus("Confirming...");
      await publicClient.waitForTransactionReceipt({ hash });
      setStatus("Minted!");
      setAmount("");
    } catch (err: any) {
      setStatus(`Error: ${err.message.slice(0, 80)}`);
    }
  }

  return (
    <div className="card">
      <h3 className="font-semibold mb-2">Mint cUSDT</h3>
      <input
        type="number"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="Amount"
        className="w-full p-2 border rounded mb-2"
      />
      <button
        onClick={handleMint}
        disabled={!amount}
        className="btn-primary w-full"
      >
        Mint
      </button>
      {status && <p className="text-xs text-purple-200/60 mt-2">{status}</p>}
    </div>
  );
}
