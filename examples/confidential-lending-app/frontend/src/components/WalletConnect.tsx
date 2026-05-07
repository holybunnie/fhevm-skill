export function WalletConnect({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="card text-center py-16">
      <div className="text-5xl mb-4">🔐</div>
      <h2 className="text-xl font-semibold mb-2">Connect your wallet</h2>
      <p className="text-sm text-purple-200/50 mb-6">All balances and transactions are fully encrypted</p>
      <button onClick={onConnect} className="btn-primary text-lg px-8 py-3">
        Connect Wallet
      </button>
    </div>
  );
}
