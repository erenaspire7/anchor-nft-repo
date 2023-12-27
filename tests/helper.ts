import {
  Keypair,
  PublicKey,
  SYSVAR_RENT_PUBKEY,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  sol,
  Umi,
  publicKey,
  signerIdentity,
  TransactionWithMeta,
  createSignerFromKeypair,
} from "@metaplex-foundation/umi";
import {
  createTree,
  SPL_NOOP_PROGRAM_ID,
  MPL_BUBBLEGUM_PROGRAM_ID,
} from "@metaplex-foundation/mpl-bubblegum";
import fs from "fs";
import * as anchor from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";
import { deserializeChangeLogEventV1 } from "@solana/spl-account-compression";
import { MPL_TOKEN_METADATA_PROGRAM_ID } from "@metaplex-foundation/mpl-token-metadata";

export const loadKeyPair = (filename) => {
  const decodedKey = new Uint8Array(
    JSON.parse(fs.readFileSync(filename).toString())
  );

  let keyPair = Keypair.fromSecretKey(decodedKey);

  return keyPair;
};

export const setupAirDrop = async (
  provider: anchor.AnchorProvider,
  accounts: Keypair[]
) => {
  const latestBlockHash = await provider.connection.getLatestBlockhash();

  for (let account of accounts) {
    await provider.connection.confirmTransaction({
      blockhash: latestBlockHash.blockhash,
      lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
      signature: await provider.connection.requestAirdrop(
        account.publicKey,
        LAMPORTS_PER_SOL * 1000
      ),
    });
  }
};

export const smartContractSetup = async (
  umi: Umi,
  centralizedAccount: Keypair,
  landMerkleTree: Keypair,
  rentalMerkleTree: Keypair,
  centralAuthority: PublicKey,
  mintAccount: Keypair,
  metadataAccount,
  program
) => {
  let authoritySigner = createSignerFromKeypair(umi, {
    secretKey: centralizedAccount.secretKey,
    publicKey: publicKey(centralizedAccount.publicKey),
  });

  umi.use(signerIdentity(authoritySigner));

  const landMerkleTx = await (
    await createTree(umi, {
      merkleTree: createSignerFromKeypair(umi, {
        secretKey: landMerkleTree.secretKey,
        publicKey: publicKey(landMerkleTree.publicKey),
      }),
      maxDepth: 14,
      maxBufferSize: 64,
    })
  ).sendAndConfirm(umi);

  console.log(
    `rental nft: https://explorer.solana.com/tx/${bs58.encode(
      landMerkleTx.signature
    )}?cluster=custom&customUrl=${encodeURIComponent(umi.rpc.getEndpoint())}`
  );

  const rentalMerkleTx = await (
    await createTree(umi, {
      merkleTree: createSignerFromKeypair(umi, {
        secretKey: rentalMerkleTree.secretKey,
        publicKey: publicKey(rentalMerkleTree.publicKey),
      }),
      maxDepth: 14,
      maxBufferSize: 64,
    })
  ).sendAndConfirm(umi);

  console.log(
    `rental nft: https://explorer.solana.com/tx/${bs58.encode(
      rentalMerkleTx.signature
    )}?cluster=custom&customUrl=${encodeURIComponent(umi.rpc.getEndpoint())}`
  );

  await program.methods
    .initialize()
    .accounts({
      payer: centralizedAccount.publicKey,
      centralAuthority: centralAuthority,
      mintAccount: mintAccount.publicKey,
      metadataAccount: metadataAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
      tokenMetadataProgram: MPL_TOKEN_METADATA_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([centralizedAccount, mintAccount])
    .rpc();
};

export const findLeafIndexFromUmiTx = (txInfo: TransactionWithMeta) => {
  let leafIndex: number | undefined = undefined;

  const relevantIndex = txInfo!.message.instructions.findIndex(
    (instruction) => {
      return (
        txInfo?.message.accounts[instruction.programIndex].toString() ===
        MPL_BUBBLEGUM_PROGRAM_ID.toString()
      );
    }
  );

  const relevantInnerIxs = txInfo!.meta.innerInstructions[
    relevantIndex
  ].instructions.filter((instruction) => {
    return (
      txInfo?.message.accounts[instruction.programIndex].toString() ===
      SPL_NOOP_PROGRAM_ID.toString()
    );
  });

  for (let i = relevantInnerIxs.length - 1; i > 0; i--) {
    try {
      const changeLogEvent = deserializeChangeLogEventV1(
        Buffer.from(relevantInnerIxs[i]?.data!)
      );

      leafIndex = changeLogEvent?.index;
    } catch (__) {
      // do nothing, invalid data is handled just after the for loop
    }
  }

  return leafIndex;
};

export const findAssetId = (merkleTree, leafIndex) => {
  const [assetId] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("asset", "utf8"),
      merkleTree.toBuffer(),
      Uint8Array.from(leafIndex.toArray("le", 8)),
    ],
    new PublicKey(MPL_BUBBLEGUM_PROGRAM_ID)
  );

  return assetId;
};
