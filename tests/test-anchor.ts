import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { TestAnchor } from "../target/types/test_anchor";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import { PublicKey, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { assert } from "chai";
import {
  MPL_BUBBLEGUM_PROGRAM_ID,
  findTreeConfigPda,
  mplBubblegum,
  mintV1,
  findLeafAssetIdPda,
  TokenProgramVersion,
  TokenStandard,
  getMetadataArgsSerializer,
  verifyLeaf,
} from "@metaplex-foundation/mpl-bubblegum";

import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  publicKey,
  signerIdentity,
  sol,
  createSignerFromKeypair,
} from "@metaplex-foundation/umi";

import {
  ConcurrentMerkleTreeAccount,
  SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
  SPL_NOOP_PROGRAM_ID,
  getCanopyDepth,
} from "@solana/spl-account-compression";
import {
  MPL_TOKEN_METADATA_PROGRAM_ID,
  findMetadataPda,
} from "@metaplex-foundation/mpl-token-metadata";

import {
  findLeafIndexFromUmiTx,
  loadKeyPair,
  setupAirDrop,
  smartContractSetup,
} from "./helper";
import { join } from "path";

describe("test-anchor", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.TestAnchor as Program<TestAnchor>;
  const umi = createUmi(provider.connection.rpcEndpoint).use(mplBubblegum());

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

  const caller = loadKeyPair(join(__dirname, "..", "wallets", "caller.json"));

  const collector = loadKeyPair(
    join(__dirname, "..", "wallets", "collector.json")
  );

  const centralAuthority = PublicKey.findProgramAddressSync(
    [Buffer.from("central_authority")],
    program.programId
  )[0];

  let metadataAccount = findMetadataPda(umi, {
    mint: publicKey(mintAccount.publicKey),
  })[0];

  const metadataArgs = {
    name: "Land NFT",
    symbol: "",
    uri: "",
    creators: [],
    sellerFeeBasisPoints: 0,
    primarySaleHappened: false,
    isMutable: false,
    editionNonce: null,
    uses: null,
    collection: null,
    tokenProgramVersion: TokenProgramVersion.Original,
    tokenStandard: TokenStandard.NonFungible,
  };

  before(async () => {
    if (provider.connection.rpcEndpoint == "http://0.0.0.0:8899") {
      await setupAirDrop(provider, [centralizedAccount]);

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
    } else {
      let authoritySigner = createSignerFromKeypair(umi, {
        secretKey: centralizedAccount.secretKey,
        publicKey: publicKey(centralizedAccount.publicKey),
      });

      umi.use(signerIdentity(authoritySigner));
    }
  });

  it("should prevent initialization twice", async () => {
    try {
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
    } catch (err: any) {
      if (err["error"]["errorCode"]["code"] != "AlreadyInitialized") {
        throw Error();
      }
    }
  });

  it("should mint a token to a caller", async () => {
    const callerAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      centralizedAccount,
      mintAccount.publicKey,
      caller.publicKey
    );

    const existingCallerAmount = callerAta.amount;

    await program.methods
      .mintToken(new anchor.BN(1))
      .accounts({
        payer: centralizedAccount.publicKey,
        mintAccount: mintAccount.publicKey,
        recipient: caller.publicKey,
        recipientAta: callerAta.address,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([centralizedAccount])
      .rpc();

    assert.equal(
      (await getAccount(provider.connection, callerAta.address)).amount,
      existingCallerAmount + BigInt(100)
    );
  });

  it("should distribute to the land tokens passed", async () => {
    let leafIndex;

    if (provider.connection.rpcEndpoint == "http://0.0.0.0:8899") {
      // Mint Land NFT To Collector
      const mintTx = await mintV1(umi, {
        leafOwner: publicKey(collector.publicKey),
        merkleTree: publicKey(landMerkleTree.publicKey),
        metadata: metadataArgs,
      }).sendAndConfirm(umi);

      const mintTxInfo = await umi.rpc.getTransaction(mintTx.signature, {
        commitment: "confirmed",
      });

      leafIndex = findLeafIndexFromUmiTx(mintTxInfo);
    } else {
      leafIndex = 0;
    }

    if (leafIndex == undefined) {
      throw Error();
    }

    let metadataBuffer = getMetadataArgsSerializer().serialize(metadataArgs);

    let accounts = [collector];

    let accountsToPass = [];
    let leavesData = [];

    for (let account of accounts) {
      // Feature to Pull leafIndex From DB
      let [assetId] = findLeafAssetIdPda(umi, {
        merkleTree: publicKey(landMerkleTree.publicKey),
        leafIndex: 0,
      });

      let asset = await umi.rpc.getAssetProof(assetId);

      let root = new PublicKey(asset.root.toString());

      let index = asset.node_index - Math.pow(2, 14);

      let ata = await getAssociatedTokenAddress(
        mintAccount.publicKey,
        account.publicKey
      );

      // Push Owner First
      accountsToPass.push({
        pubkey: account.publicKey,
        isSigner: false,
        isWritable: true,
      });

      // Push ATA Next
      accountsToPass.push({
        pubkey: ata,
        isSigner: false,
        isWritable: true,
      });

      let leafData = {
        leafIndex: index,
        owner: new PublicKey(collector.publicKey.toString()),
        delegate: new PublicKey(collector.publicKey.toString()),
        root: root,
        leafHash: [...new PublicKey(asset.leaf.toString()).toBytes()],
      };

      leavesData.push(leafData);
    }

    const callerAta = await getAssociatedTokenAddress(
      mintAccount.publicKey,
      caller.publicKey
    );

    const treeConfig = findTreeConfigPda(umi, {
      merkleTree: publicKey(rentalMerkleTree.publicKey),
    })[0];

    let centralizedAccountAta = await getAssociatedTokenAddress(
      mintAccount.publicKey,
      centralizedAccount.publicKey
    );

    const distributeSx = await program.methods
      .distribute(Buffer.from(metadataBuffer), leavesData)
      .accounts({
        payer: centralizedAccount.publicKey,
        mint: mintAccount.publicKey,
        caller: caller.publicKey,
        callerAta: callerAta,
        centralAuthority: centralAuthority,
        treeConfig: treeConfig,
        rentalMerkleTree: rentalMerkleTree.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        bubblegumProgram: MPL_BUBBLEGUM_PROGRAM_ID,
        logWrapper: SPL_NOOP_PROGRAM_ID,
        compressionProgram: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
        landMerkleTree: landMerkleTree.publicKey,
        payerAta: centralizedAccountAta,
      })
      .remainingAccounts(accountsToPass)
      .signers([centralizedAccount, caller, rentalMerkleTree])
      .rpc();
  });
});
