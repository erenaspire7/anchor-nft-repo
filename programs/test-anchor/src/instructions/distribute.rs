use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::{create, get_associated_token_address, AssociatedToken, Create},
    token::{transfer_checked, Mint, Token, TokenAccount, TransferChecked},
};
use mpl_bubblegum::{
    hash::{hash_creators, hash_metadata},
    instructions::MintV1CpiBuilder,
    types::{LeafSchema, MetadataArgs, TokenProgramVersion, TokenStandard},
    utils::get_asset_id,
};

use crate::classes::*;
use crate::errors::*;

#[derive(Accounts)]
pub struct DistributePayload<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = payer
    )]
    pub payer_ata: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>,

    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = caller
    )]
    pub caller_ata: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + CentralStateData::MAX_SIZE,
        seeds = [b"central_authority"],
        bump
        )]
    pub central_authority: Account<'info, CentralStateData>,

    /// CHECK: This account is checked in the instruction
    #[account(mut)]
    pub tree_config: UncheckedAccount<'info>,

    #[account(mut, signer)]
    pub rental_merkle_tree: Signer<'info>,

    /// CHECK: This account is checked in the instruction
    pub land_merkle_tree: UncheckedAccount<'info>,

    /// CHECK: This account is checked in the instruction
    pub bubblegum_program: UncheckedAccount<'info>,

    /// CHECK: This account is checked in the instruction
    pub log_wrapper: UncheckedAccount<'info>,

    /// CHECK: This account is checked in the instruction
    pub compression_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

pub fn handle_distribute<'info>(
    ctx: Context<'_, '_, '_, 'info, DistributePayload<'info>>,
    metadata_args: Vec<u8>,
    leaves_data: Vec<AdditionalLeafData>,
) -> Result<()> {
    let bump_seed = [ctx.bumps.central_authority];
    let signer_seeds: &[&[&[u8]]] = &[&["central_authority".as_bytes(), &bump_seed.as_ref()]];

    if ctx.accounts.caller_ata.amount < 100 {
        return err!(MyError::InsuffientFunds);
    }

    let mut nft_atas: Vec<AccountInfo> = Vec::new();

    let accounts = &mut ctx.remaining_accounts.iter();

    if accounts.len() % 2 != 0 {
        return err!(MyError::InvalidAccountsPassed);
    }

    let length: usize = accounts.len() / 2;

    let metadata = MetadataArgs::try_from_slice(metadata_args.as_slice())?;

    for index in 0..length {
        let owner = next_account_info(accounts)?;
        let ata = next_account_info(accounts)?;

        let nft_leaf_data = &leaves_data[index];

        let expected_ata = get_associated_token_address(owner.key, &ctx.accounts.mint.key());

        if ata.key == &expected_ata && owner.key.to_string() == nft_leaf_data.owner.to_string() {
            let asset_id = get_asset_id(
                ctx.accounts.land_merkle_tree.key,
                nft_leaf_data.leaf_index.into(),
            );

            let schema = LeafSchema::V1 {
                id: asset_id,
                owner: nft_leaf_data.owner,
                delegate: nft_leaf_data.delegate,
                nonce: nft_leaf_data.leaf_index.into(),
                data_hash: hash_metadata(&metadata)?,
                creator_hash: hash_creators(&metadata.creators),
            };

            if schema.hash() == nft_leaf_data.leaf_hash.unwrap() {
                if **ata.try_borrow_lamports().unwrap() == 0 {
                    let _ = create(CpiContext::new(
                        ctx.accounts.associated_token_program.to_account_info(),
                        Create {
                            payer: ctx.accounts.payer.to_account_info(),
                            associated_token: ata.to_account_info(),
                            authority: owner.to_account_info(),
                            mint: ctx.accounts.mint.to_account_info(),
                            system_program: ctx.accounts.system_program.to_account_info(),
                            token_program: ctx.accounts.token_program.to_account_info(),
                        },
                    ));
                }

                nft_atas.push(ata.to_account_info());
            }
        }
    }

    let decimals = ctx.accounts.mint.decimals as u8;

    // Transfer To Admin
    transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.caller_ata.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.payer_ata.to_account_info(),
                authority: ctx.accounts.caller.to_account_info(),
            },
        ),
        1,
        decimals,
    )?;

    // Transfer To NFT ATAs
    let percent = (1 as f64 - 0.3) / nft_atas.len() as f64;
    let quota = percent * f64::powf(10.0, decimals as f64);

    // Quota per nft
    let quota = quota as u64;

    for ata in nft_atas.iter() {
        let _ = transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.payer_ata.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ata.to_account_info(),
                    authority: ctx.accounts.payer.to_account_info(),
                },
            ),
            quota,
            decimals,
        );
    }

    // Finally Mint the Rental NFT To The Caller
    MintV1CpiBuilder::new(&ctx.accounts.bubblegum_program.to_account_info())
        .tree_config(&ctx.accounts.tree_config.to_account_info())
        .leaf_owner(&ctx.accounts.caller.to_account_info())
        .leaf_delegate(&ctx.accounts.caller.to_account_info())
        .merkle_tree(&ctx.accounts.rental_merkle_tree.to_account_info())
        .payer(&ctx.accounts.payer.to_account_info())
        .tree_creator_or_delegate(&ctx.accounts.central_authority.to_account_info())
        .log_wrapper(&ctx.accounts.log_wrapper.to_account_info())
        .compression_program(&ctx.accounts.compression_program.to_account_info())
        .system_program(&ctx.accounts.system_program.to_account_info())
        .metadata(MetadataArgs {
            name: String::from("Test NFT"),
            symbol: String::from("T-NFT"),
            uri: String::from("Test URL"),
            creators: vec![],
            seller_fee_basis_points: 0,
            primary_sale_happened: false,
            is_mutable: false,
            edition_nonce: None,
            uses: None,
            collection: None,
            token_program_version: TokenProgramVersion::Original,
            token_standard: Some(TokenStandard::NonFungible),
        })
        .invoke_signed(signer_seeds)?;

    Ok(())
}
