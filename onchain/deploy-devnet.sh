#!/usr/bin/env bash
# One-command devnet deploy for touchline-market. The ONLY gated step is funding the deployer
# wallet with ~3 devnet SOL (web faucet https://faucet.solana.com — CLI airdrop is rate-limited).
# SAFETY: devnet only, mock SPL tokens. Never touches mainnet.
set -euo pipefail

RPC="${DEVNET_RPC:-https://api.devnet.solana.com}"
WALLET="${SOLANA_WALLET:-$HOME/.config/solana/pulseplay-deploy-authority.json}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

PUBKEY="$(solana-keygen pubkey "$WALLET")"
BAL="$(solana balance "$PUBKEY" --url "$RPC" | awk '{print $1}')"
echo "deployer $PUBKEY → ${BAL} SOL (devnet)"
if awk -v b="$BAL" 'BEGIN { exit !(b + 0 < 2.2) }'; then
  echo "ERROR: need >= 2.2 devnet SOL. Fund $PUBKEY at https://faucet.solana.com and re-run."
  exit 1
fi

[ -f target/deploy/touchline_market.so ] || anchor build
solana program deploy target/deploy/touchline_market.so \
  --program-id target/deploy/touchline_market-keypair.json \
  --keypair "$WALLET" --url "$RPC"
echo "deployed: $(solana-keygen pubkey target/deploy/touchline_market-keypair.json)"
echo "next: rm ../server/.data/{chain,wallets,onchain-ledger}.json  (recreate mints on devnet), then start the API without the local-RPC override."
