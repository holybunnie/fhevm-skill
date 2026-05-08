type FhevmInstance = import("@zama-fhe/relayer-sdk/web").FhevmInstance;

let instancePromise: Promise<FhevmInstance> | undefined;

export async function getFhevmInstance(): Promise<FhevmInstance> {
  if (!instancePromise) {
    instancePromise = (async () => {
      const sdk = await import("@zama-fhe/relayer-sdk/web");
      await sdk.initSDK();
      return sdk.createInstance({
        ...sdk.SepoliaConfig,
        network: window.ethereum,
      });
    })();
  }
  return instancePromise;
}

export function resetFhevmInstance() {
  instancePromise = undefined;
}
