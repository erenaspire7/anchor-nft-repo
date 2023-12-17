import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { TestAnchor } from "../target/types/test_anchor";
import {
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAccount,
} from "@solana/spl-token";
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  Keypair,
  SYSVAR_RENT_PUBKEY,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { assert } from "chai";
import {
  MPL_BUBBLEGUM_PROGRAM_ID,
  findTreeConfigPda,
  mplBubblegum,
  createTree,
  mintV1,
} from "@metaplex-foundation/mpl-bubblegum";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  publicKey,
  generateSigner,
  signerIdentity,
  sol,
  none,
} from "@metaplex-foundation/umi";
import {
  createAllocTreeIx,
  SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
  SPL_NOOP_PROGRAM_ID,
} from "@solana/spl-account-compression";
import {
  MPL_TOKEN_METADATA_PROGRAM_ID,
  findMetadataPda,
} from "@metaplex-foundation/mpl-token-metadata";
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";

const setupAirDrop = async (
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

const executeTx = async (
  ix: anchor.web3.TransactionInstruction[],
  authorityWallet: anchor.web3.Keypair,
  provider: anchor.AnchorProvider,
  signers: anchor.web3.Keypair[]
) => {
  const tx = new anchor.web3.Transaction();
  tx.add(...ix);
  tx.feePayer = authorityWallet.publicKey;

  await sendAndConfirmTransaction(provider.connection, tx, signers);
};

describe("test-anchor", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.TestAnchor as Program<TestAnchor>;

  const authorityWallet = anchor.web3.Keypair.generate();
  const merkleTree = anchor.web3.Keypair.generate();
  const mintAccount = anchor.web3.Keypair.generate();
  const caller = anchor.web3.Keypair.generate();
  const collector = anchor.web3.Keypair.generate();

  const centralAuthority = PublicKey.findProgramAddressSync(
    [Buffer.from("central_authority")],
    program.programId
  )[0];

  it("should initialize empty merkle tree", async () => {
    await setupAirDrop(provider, [authorityWallet]);

    const umi = createUmi(provider.connection.rpcEndpoint).use(mplBubblegum());

    const treeConfig = findTreeConfigPda(umi, {
      merkleTree: publicKey(merkleTree.publicKey),
    })[0];

    let metadataAccount = findMetadataPda(umi, {
      mint: publicKey(mintAccount.publicKey),
    })[0];

    const allocTreeIx = await createAllocTreeIx(
      provider.connection,
      merkleTree.publicKey,
      authorityWallet.publicKey,
      { maxDepth: 14, maxBufferSize: 64 },
      11
    );

    const initializeIx = await program.methods
      .initialize()
      .accounts({
        payer: authorityWallet.publicKey,
        centralAuthority: centralAuthority,
        merkleTree: merkleTree.publicKey,
        treeConfig,
        bubblegumProgram: MPL_BUBBLEGUM_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        logWrapper: SPL_NOOP_PROGRAM_ID,
        compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
        mintAccount: mintAccount.publicKey,
        metadataAccount: metadataAccount,
        tokenMetadataProgram: MPL_TOKEN_METADATA_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([authorityWallet, merkleTree, mintAccount])
      .instruction();

    await executeTx([allocTreeIx, initializeIx], authorityWallet, provider, [
      authorityWallet,
      merkleTree,
      mintAccount,
    ]);

    // Make Land NFT

    const customTreeCreator = generateSigner(umi);
    const landMerkleTree = generateSigner(umi);
    umi.use(signerIdentity(customTreeCreator));

    await umi.rpc.airdrop(customTreeCreator.publicKey, sol(1));

    const builder = await createTree(umi, {
      merkleTree: landMerkleTree,
      maxDepth: 14,
      maxBufferSize: 64,
      treeCreator: customTreeCreator,
    });

    await builder.sendAndConfirm(umi);

    const rentalNftTx = await mintV1(umi, {
      leafOwner: publicKey(collector.publicKey),
      merkleTree: landMerkleTree.publicKey,
      metadata: {
        name: "My Compressed NFT",
        uri: "https://example.com/my-cnft.json",
        sellerFeeBasisPoints: 500, // 5%
        collection: none(),
        creators: [
          { address: customTreeCreator.publicKey, verified: false, share: 100 },
        ],
      },
    }).sendAndConfirm(umi);

    const rentalNftSx = bs58.encode(rentalNftTx.signature);

    console.log(
      `rental nft: https://explorer.solana.com/tx/${rentalNftSx}?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899`
    );

    // Mint To Caller

    const callerAta = await getAssociatedTokenAddress(
      mintAccount.publicKey,
      caller.publicKey
    );

    await program.methods
      .mintToken(new anchor.BN(1))
      .accounts({
        payer: authorityWallet.publicKey,
        mintAccount: mintAccount.publicKey,
        recipient: caller.publicKey,
        recipientAta: callerAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([authorityWallet])
      .rpc();

    assert.equal(
      BigInt(100),
      (await getAccount(provider.connection, callerAta)).amount
    );

    const collectorAta = await getAssociatedTokenAddress(
      mintAccount.publicKey,
      collector.publicKey
    );

    let accountsToPass = [
      { pubkey: collector.publicKey, isSigner: false, isWritable: true },
      {
        pubkey: collectorAta,
        isSigner: false,
        isWritable: true,
      },
    ];

    const distributeSx = await program.methods
      .distribute()
      .accounts({
        payer: authorityWallet.publicKey,
        mint: mintAccount.publicKey,
        caller: caller.publicKey,
        callerAta: callerAta,
        centralAuthority: centralAuthority,
        treeConfig: treeConfig,
        merkleTree: merkleTree.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        bubblegumProgram: MPL_BUBBLEGUM_PROGRAM_ID,
        logWrapper: SPL_NOOP_PROGRAM_ID,
        compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
      })
      .remainingAccounts(accountsToPass)
      .signers([authorityWallet, caller, merkleTree])
      .rpc();

    console.log(
      `minted nft: https://explorer.solana.com/tx/${distributeSx}?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899`
    );

    assert.equal(
      (await getAccount(provider.connection, callerAta)).amount,
      BigInt(0)
    );

    assert.equal(
      (await getAccount(provider.connection, collectorAta)).amount,
      BigInt(100)
    );
  });
});
