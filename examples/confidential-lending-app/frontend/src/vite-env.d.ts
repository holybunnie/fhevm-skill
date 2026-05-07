/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NETWORK: string;
  readonly VITE_LENDING_CONTRACT_ADDRESS: string;
  readonly VITE_CUSDT_CONTRACT_ADDRESS: string;
  readonly VITE_RELAYER_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  ethereum?: any;
}
