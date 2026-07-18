import { readFileSync } from "node:fs";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import BN from "bn.js";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PROGRAM_ID, IDL_PATH, houseKeypair, connection } from "./config.js";

/** Anchor Program handle for touchline-market, signing as the house/resolver. */
export function loadProgram(conn?: Connection, signer?: Keypair) {
  const c = conn ?? connection();
  const kp = signer ?? houseKeypair();
  const provider = new AnchorProvider(c, new Wallet(kp), { commitment: "confirmed" });
  const idl = JSON.parse(readFileSync(IDL_PATH, "utf8"));
  const program = new Program(idl, provider);
  return { program, provider, conn: c, house: kp };
}

const enc = (s: string) => Buffer.from(s);

export const configPda = () => PublicKey.findProgramAddressSync([enc("config")], PROGRAM_ID)[0];

export const marketPda = (fixtureId: number, side: number, barrierBps: number) => {
  const fid = Buffer.alloc(8); fid.writeBigInt64LE(BigInt(fixtureId));
  const bar = Buffer.alloc(2); bar.writeUInt16LE(barrierBps);
  return PublicKey.findProgramAddressSync(
    [enc("market"), fid, Buffer.from([side]), bar], PROGRAM_ID,
  )[0];
};

export const vaultPda = (market: PublicKey) =>
  PublicKey.findProgramAddressSync([enc("vault"), market.toBuffer()], PROGRAM_ID)[0];

export const betPda = (market: PublicKey, user: PublicKey, nonce: number) => {
  const n = Buffer.alloc(8); n.writeBigUInt64LE(BigInt(nonce));
  return PublicKey.findProgramAddressSync(
    [enc("bet"), market.toBuffer(), user.toBuffer(), n], PROGRAM_ID,
  )[0];
};

export { PROGRAM_ID, TOKEN_PROGRAM_ID, SystemProgram, BN, PublicKey };

/** Pad a MessageId string into the fixed [u8;48] the program stores as evidence. */
export function messageIdBytes(messageId: string): number[] {
  const b = Buffer.alloc(48);
  Buffer.from(messageId).copy(b, 0, 0, Math.min(48, messageId.length));
  return [...b];
}
