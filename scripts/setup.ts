import { loadKeyPair, setupAirDrop, smartContractSetup } from "../tests/helper";
import { join } from "path";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { mplBubblegum } from "@metaplex-foundation/mpl-bubblegum";
import {
  publicKey,
  signerIdentity,
  createSignerFromKeypair,
} from "@metaplex-foundation/umi";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { TestAnchor } from "../target/types/test_anchor";
import { PublicKey } from "@solana/web3.js";
import { findMetadataPda } from "@metaplex-foundation/mpl-token-metadata";
import { homedir } from "os";

const centralizedAccount = loadKeyPair(
  join(__dirname, "..", "wallets", "centralizedAccount.json")
);

const landMerkleTree = loadKeyPair(
  join(__dirname, "..", "wallets", "landMerkleTree.json")
);

const rentalMerkleTree = loadKeyPair(
  join(__dirname, "..", "wallets", "rentalMerkleTree.json")
);

const mintAccount = loadKeyPair(
  join(__dirname, "..", "wallets", "mintAccount.json")
);

const connection = new anchor.web3.Connection(
  "https://devnet.helius-rpc.com/?api-key=887524e6-92b0-4f96-973c-b37a53a9cfe4"
);

const wallet = new anchor.Wallet(
  loadKeyPair(`${homedir()}/.config/solana/id.json`)
);

const provider = new anchor.AnchorProvider(connection, wallet, {});

anchor.setProvider(provider);

const program = anchor.workspace.TestAnchor as Program<TestAnchor>;
const umi = createUmi(provider.connection.rpcEndpoint).use(mplBubblegum());

let authoritySigner = createSignerFromKeypair(umi, {
  secretKey: centralizedAccount.secretKey,
  publicKey: publicKey(centralizedAccount.publicKey),
});

umi.use(signerIdentity(authoritySigner));

const centralAuthority = PublicKey.findProgramAddressSync(
  [Buffer.from("central_authority")],
  program.programId
)[0];

let metadataAccount = findMetadataPda(umi, {
  mint: publicKey(mintAccount.publicKey),
})[0];

(async () => {
  // await setupAirDrop(provider, [centralizedAccount]);
  // Needs Centralized Account To Have SOL

  await smartContractSetup(
    umi,
    centralizedAccount,
    landMerkleTree,
    rentalMerkleTree,
    centralAuthority,
    mintAccount,
    metadataAccount,
    program
  );
})();
