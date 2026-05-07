import { useState, useEffect } from "react";
import { getWalletClient } from "./lib/client";
import { resetFhevmInstance } from "./lib/fhevm";
import { WalletConnect } from "./components/WalletConnect";
import { NetworkSwitcher } from "./components/NetworkSwitcher";
import { DepositPanel } from "./components/DepositPanel";
import { BorrowPanel } from "./components/BorrowPanel";
import { RepayPanel } from "./components/RepayPanel";
import { BalanceDisplay } from "./components/BalanceDisplay";

export function App() {
  const [account, setAccount] = useState<`0x${string}` | null>(null);

  useEffect(() => {
    if (!window.ethereum) return;
    window.ethereum.on("chainChanged", () => {
      resetFhevmInstance();
      window.location.reload();
    });
    window.ethereum.on("accountsChanged", (accounts: string[]) => {
      if (accounts.length === 0) {
        setAccount(null);
      } else {
        setAccount(accounts[0] as `0x${string}`);
      }
    });
  }, []);

  async function connect() {
    const walletClient = getWalletClient();
    const [addr] = await walletClient.requestAddresses();
    setAccount(addr);
  }

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-3xl mx-auto space-y-8">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-300 to-indigo-300 bg-clip-text text-transparent">
              Confidential Lending
            </h1>
            <p className="text-sm text-purple-300/60 mt-1">Powered by FHEVM — fully encrypted DeFi</p>
          </div>
          <NetworkSwitcher />
        </header>

        {!account ? (
          <WalletConnect onConnect={connect} />
        ) : (
          <>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <p className="text-sm text-purple-200/70">
                {account.slice(0, 6)}...{account.slice(-4)}
              </p>
            </div>

            <BalanceDisplay account={account} />

            <div className="grid gap-6 md:grid-cols-3">
              <DepositPanel account={account} />
              <BorrowPanel account={account} />
              <RepayPanel account={account} />
            </div>
          </>
        )}

        <footer className="text-center text-xs text-white/20 pt-8">
          fhevm-skill demo &middot; Zama Protocol
        </footer>
      </div>
    </div>
  );
}
