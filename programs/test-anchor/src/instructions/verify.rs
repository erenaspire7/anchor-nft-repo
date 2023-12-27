use anchor_lang::prelude::*;

use mpl_bubblegum::{
    hash::{hash_creators, hash_metadata},
    instructions::VerifyLeafCpiBuilder,
    types::{LeafSchema, MetadataArgs},
    utils::get_asset_id,
};

use crate::classes::*;

#[derive(Accounts)]
pub struct VerifyPayload<'info> {
    /// CHECK: This account is checked in the instruction
    pub land_merkle_tree: UncheckedAccount<'info>,

    /// CHECK: This account is checked in the instruction
    pub bubblegum_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,

    /// CHECK: This account is checked in the instruction
    pub log_wrapper: UncheckedAccount<'info>,

    /// CHECK: This account is checked in the instruction
    pub compression_program: UncheckedAccount<'info>,
}

pub fn handle_verify<'info>(
    ctx: Context<'_, '_, '_, 'info, VerifyPayload<'info>>,
    metadata_args: Vec<u8>,
    leaf_data: AdditionalLeafData,
) -> Result<()> {
    let asset_id = get_asset_id(
        ctx.accounts.land_merkle_tree.key,
        leaf_data.leaf_index.into(),
    );

    let metadata = MetadataArgs::try_from_slice(metadata_args.as_slice())?;

    let schema = LeafSchema::V1 {
        id: asset_id,
        owner: leaf_data.owner,
        delegate: leaf_data.delegate,
        nonce: leaf_data.leaf_index.into(),
        data_hash: hash_metadata(&metadata)?,
        creator_hash: hash_creators(&metadata.creators),
    };

    let accounts = &mut ctx.remaining_accounts.iter();

    let mut proofs = Vec::new();

    for account in accounts.into_iter() {
        proofs.push((account, false, false));
    }

    VerifyLeafCpiBuilder::new(&ctx.accounts.bubblegum_program.to_account_info())
        .merkle_tree(&ctx.accounts.land_merkle_tree.to_account_info())
        .root(leaf_data.root.to_bytes())
        .leaf(schema.hash())
        .index(leaf_data.leaf_index)
        .add_remaining_accounts(&proofs)
        .invoke()?;

    Ok(())
}
