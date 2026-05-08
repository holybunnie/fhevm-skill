# FHEVM Frontend Integration — Sub-Skill

> How to encrypt inputs client-side, call FHEVM contracts, and decrypt results using `@zama-fhe/relayer-sdk` with Vite + React + viem.

## 1. Overview — the off-chain encryption/decryption flow

FHEVM contracts never see plaintext. The full lifecycle:

1. **Client encrypts** — The user's browser encrypts values using the FHE public key from the chain. This produces an encrypted input handle + proof.
2. **Client sends tx** — The encrypted handle and proof are passed as `externalEuint64` + `bytes calldata proof` parameters to the smart contract.
3. **Contract processes** — All computation happens on encrypted data. Results are stored as encrypted handles with ACL grants.
4. **Client decrypts** — Two paths:
   - **`publicDecrypt`** — Anyone can decrypt a handle marked `makePubliclyDecryptable`. No signature needed.
   - **`userDecrypt`** — The user signs an EIP-712 request to prove they have ACL access. The relayer decrypts and returns the cleartext + signature.
5. **Verification (optional)** — The cleartext + relayer signature can be submitted back on-chain via `FHE.checkSignatures` for contracts that need plaintext values.

```
Browser                    Contract                 Coprocessor/Relayer
  |                          |                           |
  |--- encrypt(value) ------>|                           |
  |    (handle + proof)      |                           |
  |                          |-- FHE.add/sub/select ---->|
  |                          |<-- encrypted result ------|
  |                          |-- FHE.allow(user) ------->|
  |                          |                           |
  |--- userDecrypt(handle) ----------------------------->|
  |<-- cleartext + sig ----------------------------------|
```

## 2. Project setup — Vite + React + viem + relayer-sdk

### Install dependencies

```bash
npm create vite@latest my-fhevm-app -- --template react-ts
cd my-fhevm-app
npm install viem @zama-fhe/relayer-sdk
npm install -D @types/node
```

### Environment variables

Create `.env`:

```env
VITE_NETWORK=hardhat          # or "sepolia"
VITE_LENDING_CONTRACT_ADDRESS=0x...
VITE_CUSDT_CONTRACT_ADDRESS=0x...
VITE_RELAYER_URL=https://relayer.testnet.zama.org
```

### viem client setup

```typescript
// src/lib/client.ts
import { createPublicClient, createWalletClient, custom, http } from "viem";
import { hardhat, sepolia } from "viem/chains";

const chain = import.meta.env.VITE_NETWORK === "sepolia" ? sepolia : hardhat;

export const publicClient = createPublicClient({
  chain,
  transport: import.meta.env.VITE_NETWORK === "sepolia"
    ? http()
    : http("http://127.0.0.1:8545"),
});

export function getWalletClient() {
  if (!window.ethereum) throw new Error("No wallet detected");
  return createWalletClient({
    chain,
    transport: custom(window.ethereum),
  });
}

export { chain };
```

### Relayer instance setup

**Critical: You MUST import from `@zama-fhe/relayer-sdk/web`** (the browser bundle), NOT from `@zama-fhe/relayer-sdk` (the Node/CLI entry point). The bare import lacks the WASM initialization and browser-compatible crypto needed for client-side encryption.

```typescript
// src/lib/fhevm.ts
type FhevmInstance = import("@zama-fhe/relayer-sdk/web").FhevmInstance;

let instancePromise: Promise<FhevmInstance> | undefined;

export async function getFhevmInstance(): Promise<FhevmInstance> {
  if (!instancePromise) {
    instancePromise = (async () => {
      const { initSDK, createInstance, SepoliaConfig } = await import("@zama-fhe/relayer-sdk/web");
      await initSDK();
      return createInstance({
        ...SepoliaConfig,
        relayerUrl: import.meta.env.VITE_RELAYER_URL || SepoliaConfig.relayerUrl,
        network: (globalThis as any).ethereum,
      });
    })();
  }
  return instancePromise;
}

export function resetFhevmInstance() {
  instancePromise = undefined;
}
```

**Why this pattern matters:**
1. **`initSDK()`** must be called before `createInstance` — it loads the WASM crypto module. Skipping this causes "Cannot read property" errors when fetching the public key.
2. **`SepoliaConfig`** provides the correct relayer URL (`https://relayer.testnet.zama.org`), chain ID, gateway address, and ACL address. Do not manually configure these.
3. **`network: window.ethereum`** passes the browser wallet provider directly — the SDK uses it to read chain state. Do NOT pass a viem `publicClient` here.
4. **Dynamic `import()`** keeps the WASM bundle out of the initial chunk (it's ~2MB).
5. **Cache the promise**, not the resolved instance — this prevents race conditions if multiple components call `getFhevmInstance()` simultaneously.

**Common bug: using the wrong import path.** Importing from `@zama-fhe/relayer-sdk` (without `/web`) gives you the Node.js entry point, which fails in the browser with "Impossible to fetch public key: wrong relayer url" because it doesn't initialize the WASM module or browser crypto. Always use `@zama-fhe/relayer-sdk/web` for frontend code.

## 3. Encrypting input client-side

The encryption flow has three steps: create an encrypted input builder, add values, encrypt.

### createEncryptedInput

```typescript
import { getFhevmInstance } from "../lib/fhevm";

async function encryptDeposit(
  contractAddress: `0x${string}`,
  userAddress: `0x${string}`,
  amount: bigint,
) {
  const fhevm = await getFhevmInstance();

  // Step 1: Create an encrypted input builder bound to contract + user
  const input = fhevm.createEncryptedInput(contractAddress, userAddress);

  // Step 2: Add the value (type must match the contract parameter)
  input.add64(amount);  // for euint64 parameters

  // Step 3: Encrypt — returns handles[] and inputProof
  const encrypted = await input.encrypt();

  return {
    handle: encrypted.handles[0],    // bytes32 — the encrypted handle
    proof: encrypted.inputProof,      // bytes — the ZK proof
  };
}
```

### Available add methods

| Method | Solidity type | Range |
|--------|--------------|-------|
| `addBool(v)` | `externalEbool` | `true`/`false` |
| `add4(v)` | `externalEuint4` | 0-15 |
| `add8(v)` | `externalEuint8` | 0-255 |
| `add16(v)` | `externalEuint16` | 0-65535 |
| `add32(v)` | `externalEuint32` | 0-2^32-1 |
| `add64(v)` | `externalEuint64` | 0-2^64-1 |
| `add128(v)` | `externalEuint128` | 0-2^128-1 |
| `add256(v)` | `externalEuint256` | 0-2^256-1 |
| `addAddress(v)` | `externalEaddress` | 20-byte address |

### Multiple encrypted inputs in one call

If a contract function takes multiple encrypted parameters, add them in order:

```typescript
const input = fhevm.createEncryptedInput(contractAddress, userAddress);
input.add64(amount1);   // handles[0]
input.add64(amount2);   // handles[1]
const encrypted = await input.encrypt();

// Pass to contract:
// contract.doSomething(encrypted.handles[0], encrypted.handles[1], encrypted.inputProof)
```

The proof covers all handles in a single encrypted input. You only need one `inputProof` per `createEncryptedInput` call.

### Critical: address binding

The encrypted input is bound to `(contractAddress, userAddress)`. If either is wrong:
- Wrong contract address: the contract will reject the handle (ACL mismatch)
- Wrong user address: the proof verification fails

Always use the actual deployed contract address and the connected wallet address.

## 4. Calling the contract with encrypted input

### Using viem

```typescript
import { getWalletClient, publicClient } from "../lib/client";
import { lendingAbi } from "../lib/abis";

async function deposit(amount: bigint) {
  const walletClient = getWalletClient();
  const [account] = await walletClient.getAddresses();
  const contractAddress = import.meta.env.VITE_LENDING_CONTRACT_ADDRESS as `0x${string}`;

  // Encrypt
  const { handle, proof } = await encryptDeposit(contractAddress, account, amount);

  // Send transaction
  const hash = await walletClient.writeContract({
    address: contractAddress,
    abi: lendingAbi,
    functionName: "deposit",
    args: [handle, proof],
    account,
  });

  // Wait for confirmation
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return receipt;
}
```

### ABI considerations

The contract ABI encodes `externalEuint64` as `bytes32` and the proof as `bytes`. Your ABI should reflect this:

```typescript
// src/lib/abis.ts
export const lendingAbi = [
  {
    name: "deposit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "encAmount", type: "bytes32" },
      { name: "proof", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "borrow",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "encAmount", type: "bytes32" },
      { name: "proof", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "repay",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "encAmount", type: "bytes32" },
      { name: "proof", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "getCollateral",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    name: "getDebt",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "bytes32" }],
  },
] as const;
```

## 5. Decryption path 1 — publicDecrypt

For handles where the contract called `FHE.makePubliclyDecryptable(handle)`, anyone can decrypt without a signature.

```typescript
import { getFhevmInstance } from "../lib/fhevm";

async function publicDecryptValue(handle: `0x${string}`): Promise<bigint> {
  const fhevm = await getFhevmInstance();

  // publicDecrypt — no signature needed, works for publicly-marked handles
  const cleartext = await fhevm.publicDecrypt(handle);

  return cleartext;
}
```

**When to use**: Auction results after finalization, public statistics, any value the contract intentionally made public.

**Timing**: The value is only decryptable after the transaction that called `makePubliclyDecryptable` is confirmed and the relayer has processed it. Poll or use an event listener.

## 6. Decryption path 2 — userDecrypt (EIP-712 signature)

For handles where the contract called `FHE.allow(handle, userAddress)`, only that user can decrypt. They must sign an EIP-712 request.

```typescript
import { BrowserProvider } from "ethers";
import { getFhevmInstance } from "../lib/fhevm";

async function userDecryptBalance(
  handles: { handle: `0x${string}`; contractAddress: `0x${string}` }[],
  userAddress: `0x${string}`,
): Promise<bigint[]> {
  const fhevm = await getFhevmInstance();

  // Step 1: Generate a keypair for this decrypt session
  const keypair = fhevm.generateKeypair();

  // Step 2: Build the EIP-712 message
  const contractAddresses = [...new Set(handles.map(h => h.contractAddress))];
  const startTimeStamp = Math.floor(Date.now() / 1000);
  const durationDays = 10;
  const eip712 = fhevm.createEIP712(
    keypair.publicKey, contractAddresses, startTimeStamp, durationDays
  );

  // Step 3: User signs the EIP-712 typed data
  const signer = await new BrowserProvider(window.ethereum).getSigner();
  const signature = await signer.signTypedData(
    eip712.domain,
    { UserDecryptRequestVerification: [...eip712.types.UserDecryptRequestVerification] },
    eip712.message
  );

  // Step 4: Request decryption from the relayer
  return fhevm.userDecrypt(
    handles,
    keypair.privateKey,
    keypair.publicKey,
    signature.replace("0x", ""),
    contractAddresses,
    userAddress,
    startTimeStamp,
    durationDays
  );
}
```

### The EIP-712 domain

The relayer uses a specific EIP-712 domain for decrypt requests:

```
domain: {
  name: "Zama Decryption",
  version: "1",
  chainId: <current chain id>,
  verifyingContract: <relayer contract address>
}
```

**Common bug: EIP-712 domain mismatch on chain switch.** If the user switches networks (e.g., Hardhat to Sepolia), the cached relayer instance still has the old chain's domain. The signature will be rejected. Always recreate the instance when the chain changes:

```typescript
// In your chain-switch handler:
import { resetFhevmInstance } from "../lib/fhevm";

function handleChainSwitch() {
  resetFhevmInstance();  // Force re-creation on next use
}
```

The `resetFhevmInstance()` function is already defined in the `src/lib/fhevm.ts` module above — it sets `instancePromise = undefined` so the next call re-initializes with the new chain's config.

### Caching decrypt keypairs and signatures

The `signTypedData` call prompts the user for a wallet signature. Cache the keypair and signature to avoid repeated popups within the same session:

```typescript
type DecryptSession = {
  keypair: { publicKey: Uint8Array; privateKey: Uint8Array };
  signature: string;
  startTimeStamp: number;
  durationDays: number;
};

const decryptSessionCache = new Map<string, DecryptSession>();

async function getCachedDecryptSession(
  contractAddresses: `0x${string}`[],
  account: `0x${string}`,
  fhevm: FhevmInstance,
): Promise<DecryptSession> {
  const key = `${contractAddresses.sort().join(",")}-${account}`;
  if (decryptSessionCache.has(key)) return decryptSessionCache.get(key)!;

  const keypair = fhevm.generateKeypair();
  const startTimeStamp = Math.floor(Date.now() / 1000);
  const durationDays = 10;
  const eip712 = fhevm.createEIP712(keypair.publicKey, contractAddresses, startTimeStamp, durationDays);

  const { BrowserProvider } = await import("ethers");
  const signer = await new BrowserProvider(window.ethereum).getSigner();
  const signature = await signer.signTypedData(
    eip712.domain,
    { UserDecryptRequestVerification: [...eip712.types.UserDecryptRequestVerification] },
    eip712.message
  );

  const session = { keypair, signature: signature.replace("0x", ""), startTimeStamp, durationDays };
  decryptSessionCache.set(key, session);
  return session;
}
```

**Important**: Clear this cache on chain switch too.

## 7. Submitting decrypted values back on-chain — checkSignatures

When a contract needs a plaintext value derived from an encrypted computation (e.g., to interact with a non-FHE contract), the flow is:

1. Contract marks handle as publicly decryptable
2. Off-chain: relayer decrypts and returns cleartext + signatures
3. On-chain: submit cleartext + signatures to `FHE.checkSignatures`

```solidity
// In the contract:
function settlePlaintext(uint64 clearValue, bytes[] calldata signatures) external {
    // Verify that clearValue is the authentic decryption of the handle
    FHE.checkSignatures(clearValue, signatures);
    // Now safe to use clearValue in plaintext logic
    plainBalance[msg.sender] = clearValue;
}
```

```typescript
// Client-side:
async function submitDecryptedValue(
  contractAddress: `0x${string}`,
  handle: `0x${string}`,
) {
  const fhevm = await getFhevmInstance();

  // Get the decrypted value with proof signatures
  const { value, signatures } = await fhevm.publicDecryptWithProof(handle);

  const walletClient = getWalletClient();
  const [account] = await walletClient.getAddresses();

  const hash = await walletClient.writeContract({
    address: contractAddress,
    abi: settlementAbi,
    functionName: "settlePlaintext",
    args: [value, signatures],
    account,
  });

  return hash;
}
```

## 8. Worked example — ConfidentialLending React component

A complete React component showing deposit + balance view for the lending app:

```tsx
// src/components/LendingPanel.tsx
import { useState } from "react";
import { getFhevmInstance } from "../lib/fhevm";
import { getWalletClient, publicClient } from "../lib/client";
import { lendingAbi } from "../lib/abis";

const LENDING_ADDRESS = import.meta.env.VITE_LENDING_CONTRACT_ADDRESS as `0x${string}`;

export function LendingPanel() {
  const [account, setAccount] = useState<`0x${string}` | null>(null);
  const [depositAmount, setDepositAmount] = useState("");
  const [collateral, setCollateral] = useState<string>("---");
  const [status, setStatus] = useState("");

  // Connect wallet
  async function connect() {
    if (!window.ethereum) {
      setStatus("No wallet detected");
      return;
    }
    const walletClient = getWalletClient();
    const [addr] = await walletClient.requestAddresses();
    setAccount(addr);
    setStatus(`Connected: ${addr.slice(0, 6)}...${addr.slice(-4)}`);
  }

  // Deposit collateral
  async function handleDeposit() {
    if (!account) return;
    setStatus("Encrypting...");

    try {
      const fhevm = await getFhevmInstance();
      const input = fhevm.createEncryptedInput(LENDING_ADDRESS, account);
      input.add64(BigInt(depositAmount));
      const encrypted = await input.encrypt();

      setStatus("Sending transaction...");
      const walletClient = getWalletClient();
      const hash = await walletClient.writeContract({
        address: LENDING_ADDRESS,
        abi: lendingAbi,
        functionName: "deposit",
        args: [encrypted.handles[0], encrypted.inputProof],
        account,
      });

      setStatus("Waiting for confirmation...");
      await publicClient.waitForTransactionReceipt({ hash });
      setStatus("Deposit confirmed!");
      await refreshCollateral();
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
    }
  }

  // Read and decrypt collateral balance
  async function refreshCollateral() {
    if (!account) return;
    setStatus("Reading balance...");

    try {
      // Read the encrypted handle from the contract
      const handle = await publicClient.readContract({
        address: LENDING_ADDRESS,
        abi: lendingAbi,
        functionName: "getCollateral",
        args: [account],
      }) as `0x${string}`;

      if (!handle || handle === "0x" + "0".repeat(64)) {
        setCollateral("0");
        setStatus("Ready");
        return;
      }

      // Decrypt using userDecrypt (requires EIP-712 signature)
      const fhevm = await getFhevmInstance();
      const keypair = fhevm.generateKeypair();
      const contractAddresses = [LENDING_ADDRESS];
      const startTimeStamp = Math.floor(Date.now() / 1000);
      const durationDays = 10;
      const eip712 = fhevm.createEIP712(keypair.publicKey, contractAddresses, startTimeStamp, durationDays);

      const { BrowserProvider } = await import("ethers");
      const signer = await new BrowserProvider(window.ethereum).getSigner();
      const signature = await signer.signTypedData(
        eip712.domain,
        { UserDecryptRequestVerification: [...eip712.types.UserDecryptRequestVerification] },
        eip712.message
      );

      const results = await fhevm.userDecrypt(
        [{ handle, contractAddress: LENDING_ADDRESS }],
        keypair.privateKey,
        keypair.publicKey,
        signature.replace("0x", ""),
        contractAddresses,
        account,
        startTimeStamp,
        durationDays
      );

      setCollateral(results[0].toString());
      setStatus("Ready");
    } catch (err: any) {
      setStatus(`Decrypt error: ${err.message}`);
    }
  }

  return (
    <div className="p-6 max-w-md mx-auto">
      <h2 className="text-xl font-bold mb-4">Confidential Lending</h2>

      {!account ? (
        <button onClick={connect} className="btn-primary">
          Connect Wallet
        </button>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">{status}</p>

          {/* Collateral display */}
          <div className="p-4 bg-gray-100 rounded">
            <p className="text-sm text-gray-500">Your Collateral</p>
            <p className="text-2xl font-mono">{collateral} cUSDT</p>
            <button onClick={refreshCollateral} className="text-sm text-blue-600 underline">
              Refresh
            </button>
          </div>

          {/* Deposit form */}
          <div className="space-y-2">
            <label className="block text-sm font-medium">Deposit Amount</label>
            <input
              type="number"
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
              placeholder="Amount in cUSDT"
              className="w-full p-2 border rounded"
            />
            <button onClick={handleDeposit} className="btn-primary w-full">
              Deposit
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

### Key patterns in this component

1. **Encrypt before send** — `createEncryptedInput` then `add64` then `encrypt` then pass `handles[0]` + `inputProof` to the contract
2. **Read encrypted handle** — `readContract` returns a `bytes32` handle, not the plaintext
3. **Decrypt with user signature** — `generateKeypair` + `createEIP712` + `signTypedData` + `userDecrypt` returns the cleartext
4. **Status feedback** — Each async step updates the UI so the user knows what's happening

## 9. Common frontend bugs and fixes

### Bug 1: Relayer instance stored in React state

```typescript
// WRONG — instance is not serializable, breaks on re-render
const [fhevm, setFhevm] = useState<FhevmInstance | null>(null);
useEffect(() => {
  getFhevmInstance().then(setFhevm);
}, []);

// RIGHT — module-level singleton with cached promise
// See src/lib/fhevm.ts pattern above
```

**Why**: React state triggers re-renders and may clone/serialize the value. The FhevmInstance holds internal crypto state that doesn't survive this.

### Bug 2: EIP-712 domain mismatch after chain switch

```typescript
// WRONG — stale instance after network change
window.ethereum.on("chainChanged", () => {
  // User switched to Sepolia but instance still has Hardhat chain ID
  // All decrypt requests will fail with domain mismatch
});

// RIGHT — reset instance on chain change
window.ethereum.on("chainChanged", () => {
  resetFhevmInstance();
  decryptKeyCache.clear();
  window.location.reload();  // simplest way to reset all state
});
```

**Why**: The relayer validates the EIP-712 domain including `chainId`. A cached instance from chain A will produce signatures that chain B's relayer rejects.

### Bug 3: ACL access errors on decrypt

```
Error: User does not have ACL access to this handle
```

This means the contract did not call `FHE.allow(handle, userAddress)` for the handle you're trying to decrypt. Check:

1. The contract function stores the handle AND calls `FHE.allow(handle, msg.sender)`
2. The handle you're reading is the latest — if the contract updated the value, the old handle is stale
3. You're using the correct user address (the one that interacted with the contract)

### Bug 4: Handle is zero bytes

```typescript
const handle = await publicClient.readContract({ ... });
// handle === "0x0000...0000"
```

The user has no balance/collateral yet. Check before attempting decrypt:

```typescript
if (handle === "0x" + "0".repeat(64)) {
  // No encrypted value stored — show "0" or "N/A"
  return;
}
```

### Bug 5: Transaction reverts with no error message

FHEVM operations that fail ACL checks revert at the coprocessor level, not in Solidity. The revert reason is often empty. Debug checklist:

1. Did the sender encrypt with the correct `(contractAddress, senderAddress)`?
2. Did the contract call `FHE.allowTransient(handle, targetContract)` before passing to another contract?
3. Is the handle initialized? (`FHE.isInitialized` returns false for zero handles)

### Bug 6: Encrypting with wrong address pair

```typescript
// WRONG — using token address for lending contract call
const input = fhevm.createEncryptedInput(TOKEN_ADDRESS, account);

// RIGHT — use the contract you're calling
const input = fhevm.createEncryptedInput(LENDING_ADDRESS, account);
```

The encrypted input is bound to the contract address. If you encrypt for contract A but send to contract B, the proof verification fails.

## 10. Network switching — Hardhat local vs Sepolia

```typescript
// src/lib/network.ts
import { hardhat, sepolia } from "viem/chains";

export type NetworkName = "hardhat" | "sepolia";

export function getChainConfig(network: NetworkName) {
  switch (network) {
    case "sepolia":
      return {
        chain: sepolia,
        transport: "https",
        relayerUrl: "https://relayer.testnet.zama.org",
      };
    case "hardhat":
    default:
      return {
        chain: hardhat,
        transport: "http://127.0.0.1:8545",
        relayerUrl: "http://127.0.0.1:8546",
      };
  }
}
```

When switching networks:
1. Reset the fhevm instance (`resetFhevmInstance()`)
2. Clear decrypt key cache
3. Update the viem clients with the new chain
4. Prompt user to switch in MetaMask: `wallet_switchEthereumChain`

```typescript
async function switchNetwork(chainId: number) {
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: `0x${chainId.toString(16)}` }],
    });
  } catch (err: any) {
    if (err.code === 4902) {
      // Chain not added — prompt to add
      await addNetwork(chainId);
    }
    throw err;
  }
}
```

## 11. TypeScript types for FHEVM frontend

```typescript
// src/types/fhevm.ts

/** Encrypted handle — 32 bytes */
export type EncryptedHandle = `0x${string}`;

/** Encryption result from createEncryptedInput().encrypt() */
export interface EncryptedInput {
  handles: EncryptedHandle[];
  inputProof: `0x${string}`;
}

/** Decryption session from generateKeypair + signTypedData */
export interface DecryptSession {
  keypair: { publicKey: Uint8Array; privateKey: Uint8Array };
  signature: string;
  startTimeStamp: number;
  durationDays: number;
}

/** Supported encrypted types for add methods */
export type FhevmEncryptedType =
  | "ebool"
  | "euint4"
  | "euint8"
  | "euint16"
  | "euint32"
  | "euint64"
  | "euint128"
  | "euint256"
  | "eaddress";
```

## 12. Testing frontend with Hardhat local network

When using the `@fhevm/hardhat-plugin`, the local Hardhat network includes a mock coprocessor that handles encryption/decryption without the full FHE stack.

```bash
# Terminal 1: Start local Hardhat node with fhevm mock
npx hardhat node

# Terminal 2: Deploy contracts
npx hardhat run scripts/deploy.ts --network localhost

# Terminal 3: Start frontend
cd frontend
VITE_NETWORK=hardhat npm run dev
```

The mock coprocessor makes `createEncryptedInput` and `userDecrypt` work locally without a real relayer. Values are "encrypted" with a trivial scheme — fine for development, not for production.

## 13. Production checklist

Before deploying your frontend to production:

- [ ] Use Sepolia (or mainnet) relayer URL, not localhost
- [ ] Contract addresses match the deployed network
- [ ] EIP-712 domain matches the chain (reset instance on switch)
- [ ] Error handling for wallet not connected, wrong network, tx rejection
- [ ] Loading states for encryption (1-3s), tx confirmation (15-30s), decryption (5-10s)
- [ ] Handle zero-value encrypted handles (user has no balance)
- [ ] Clear all caches on network switch
- [ ] Test with MetaMask, WalletConnect, and any other target wallets
- [ ] CSP headers allow connection to relayer URL
- [ ] No plaintext values logged to console in production builds
