import { useState } from "react";
import { BrowserProvider } from "ethers";
import { getFhevmInstance } from "../lib/fhevm";
import { publicClient } from "../lib/client";
import { lendingAbi, tokenAbi } from "../lib/abis";

const LENDING = import.meta.env.VITE_LENDING_CONTRACT_ADDRESS as `0x${string}`;
const TOKEN = import.meta.env.VITE_CUSDT_CONTRACT_ADDRESS as `0x${string}`;

const ZERO_HANDLE = ("0x" + "0".repeat(64)) as `0x${string}`;

export function BalanceDisplay({ account }: { account: `0x${string}` }) {
  const [collateral, setCollateral] = useState("--");
  const [debt, setDebt] = useState("--");
  const [tokenBalance, setTokenBalance] = useState("--");
  const [loading, setLoading] = useState(false);
  const [decrypted, setDecrypted] = useState(false);

  function encrypt() {
    setCollateral("--");
    setDebt("--");
    setTokenBalance("--");
    setDecrypted(false);
  }

  async function refresh() {
    setLoading(true);
    try {
      const fhevm = await getFhevmInstance();

      // Read all handles in parallel
      const [colHandle, debtHandle, tokHandle] = await Promise.all([
        publicClient.readContract({
          address: LENDING, abi: lendingAbi, functionName: "getCollateral", args: [account],
        }) as Promise<`0x${string}`>,
        publicClient.readContract({
          address: LENDING, abi: lendingAbi, functionName: "getDebt", args: [account],
        }) as Promise<`0x${string}`>,
        publicClient.readContract({
          address: TOKEN, abi: tokenAbi, functionName: "balanceOf", args: [account],
        }) as Promise<`0x${string}`>,
      ]);

      // Collect non-zero handles
      type Item = { handle: string; contractAddress: string; label: string };
      const items: Item[] = [];
      if (colHandle && colHandle !== ZERO_HANDLE) items.push({ handle: colHandle, contractAddress: LENDING, label: "collateral" });
      if (debtHandle && debtHandle !== ZERO_HANDLE) items.push({ handle: debtHandle, contractAddress: LENDING, label: "debt" });
      if (tokHandle && tokHandle !== ZERO_HANDLE) items.push({ handle: tokHandle, contractAddress: TOKEN, label: "token" });

      if (items.length === 0) {
        setCollateral("0");
        setDebt("0");
        setTokenBalance("0");
        setDecrypted(true);
        setLoading(false);
        return;
      }

      // Generate keypair and EIP-712 signature for decrypt
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const inst = fhevm as any;
      const keypair = inst.generateKeypair();
      const contractAddresses = [...new Set(items.map(i => i.contractAddress))];
      const startTimestamp = Math.floor(Date.now() / 1000);
      const durationDays = 10;
      const eip712 = inst.createEIP712(keypair.publicKey, contractAddresses, startTimestamp, durationDays);

      const signer = await new BrowserProvider(window.ethereum).getSigner();
      const signature = await signer.signTypedData(
        eip712.domain,
        { UserDecryptRequestVerification: [...eip712.types.UserDecryptRequestVerification] },
        eip712.message
      );

      // Decrypt — returns Record<handle_hex, clearValue>
      const results: Record<string, bigint | boolean | string> = await inst.userDecrypt(
        items.map(i => ({ handle: i.handle, contractAddress: i.contractAddress })),
        keypair.privateKey,
        keypair.publicKey,
        signature.replace("0x", ""),
        contractAddresses,
        account,
        startTimestamp,
        durationDays
      );

      // Map results back by handle
      for (const item of items) {
        const val = results[item.handle];
        const display = val != null ? val.toString() : "0";
        if (item.label === "collateral") setCollateral(display);
        if (item.label === "debt") setDebt(display);
        if (item.label === "token") setTokenBalance(display);
      }

      // Set zeros for any we didn't request
      if (!items.find(i => i.label === "collateral")) setCollateral("0");
      if (!items.find(i => i.label === "debt")) setDebt("0");
      if (!items.find(i => i.label === "token")) setTokenBalance("0");
      setDecrypted(true);
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
        {decrypted ? (
          <button onClick={encrypt} className="btn-secondary text-sm">
            Encrypt
          </button>
        ) : (
          <button onClick={refresh} disabled={loading} className="btn-secondary text-sm">
            {loading ? "Decrypting..." : "Decrypt & View"}
          </button>
        )}
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white/5 rounded-lg p-4">
          <p className="text-sm text-purple-300/60">Wallet</p>
          <p className="text-2xl font-mono text-blue-300">{tokenBalance} <span className="text-sm text-white/40">cUSDT</span></p>
        </div>
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
