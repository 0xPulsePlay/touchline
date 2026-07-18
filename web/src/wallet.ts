/**
 * Minimal Phantom connect — no adapter stack. Uses the injected provider; publicKey only
 * (no signing yet — staking flow lands with the market-mechanism decision).
 */

interface PhantomProvider {
  isPhantom?: boolean;
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: { toString(): string } }>;
  disconnect: () => Promise<void>;
}

const KEY = "touchline.wallet";

export function getProvider(): PhantomProvider | null {
  const p = (window as unknown as { solana?: PhantomProvider }).solana;
  return p?.isPhantom ? p : null;
}

export async function connectWallet(): Promise<string | null> {
  const p = getProvider();
  if (!p) {
    window.open("https://phantom.app/", "_blank", "noopener");
    return null;
  }
  const res = await p.connect();
  const pk = res.publicKey.toString();
  localStorage.setItem(KEY, pk);
  return pk;
}

export async function disconnectWallet(): Promise<void> {
  localStorage.removeItem(KEY);
  try {
    await getProvider()?.disconnect();
  } catch {
    /* provider may already be disconnected */
  }
}

export function rememberedWallet(): string | null {
  return localStorage.getItem(KEY);
}

export const shortKey = (pk: string) => `${pk.slice(0, 4)}…${pk.slice(-4)}`;
