use anchor_lang::prelude::*;

use anchor_spl::{
    associated_token::AssociatedToken,
    associated_token::{create, get_associated_token_address, Create},
    metadata::{create_metadata_accounts_v3, CreateMetadataAccountsV3, Metadata},
    token::{mint_to, transfer_checked, Mint, Token, TokenAccount, TransferChecked},
};

use mpl_token_metadata::types::DataV2;

use mpl_bubblegum::{
    instructions::{CreateTreeConfigCpiBuilder, MintV1CpiBuilder},
    types::{MetadataArgs, TokenProgramVersion, TokenStandard},
};

declare_id!("ECzDME4J9w1LvPLwCS1TpKLPHt85CXTVvdgJ3sa3a9Po");

// The program will support only trees of the following parameters:
const MAX_TREE_DEPTH: u32 = 14;
const MAX_TREE_BUFFER_SIZE: u32 = 64;

#[program]
pub mod test_anchor {

    use anchor_spl::token::MintTo;

    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let bump_seed = [ctx.bumps.central_authority];
        let signer_seeds: &[&[&[u8]]] = &[&["central_authority".as_bytes(), &bump_seed.as_ref()]];

        CreateTreeConfigCpiBuilder::new(&ctx.accounts.bubblegum_program.to_account_info())
            .tree_config(&ctx.accounts.tree_config.to_account_info())
            .merkle_tree(&ctx.accounts.merkle_tree.to_account_info())
            .payer(&ctx.accounts.payer.to_account_info())
            .tree_creator(&ctx.accounts.central_authority.to_account_info())
            .log_wrapper(&ctx.accounts.log_wrapper.to_account_info())
            .compression_program(&ctx.accounts.compression_program.to_account_info())
            .system_program(&ctx.accounts.system_program.to_account_info())
            .max_depth(MAX_TREE_DEPTH)
            .max_buffer_size(MAX_TREE_BUFFER_SIZE)
            .invoke_signed(signer_seeds)?;

        create_metadata_accounts_v3(
            CpiContext::new(
                ctx.accounts.token_metadata_program.to_account_info(),
                CreateMetadataAccountsV3 {
                    metadata: ctx.accounts.metadata_account.to_account_info(),
                    mint: ctx.accounts.mint_account.to_account_info(),
                    mint_authority: ctx.accounts.payer.to_account_info(),
                    update_authority: ctx.accounts.payer.to_account_info(),
                    payer: ctx.accounts.payer.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                    rent: ctx.accounts.rent.to_account_info(),
                },
            ),
            DataV2 {
                name: String::from("Test Token"),
                symbol: String::from("TT"),
                uri: String::from("Test URL"),
                seller_fee_basis_points: 0,
                creators: None,
                collection: None,
                uses: None,
            },
            false, // Is mutable
            true,  // Update authority is signer
            None,  // Collection details
        )?;

        Ok(())
    }

    pub fn mint_token(ctx: Context<MintPayload>, amount: u64) -> Result<()> {
        mint_to(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.mint_account.to_account_info(),
                    to: ctx.accounts.recipient_ata.to_account_info(),
                    authority: ctx.accounts.payer.to_account_info(),
                },
            ),
            amount * 10u64.pow(ctx.accounts.mint_account.decimals as u32),
        )?;

        Ok(())
    }

    pub fn distribute<'info>(
        ctx: Context<'_, '_, '_, 'info, DistributePayload<'info>>,
    ) -> Result<()> {
        // Check Balance Of Caller
        if ctx.accounts.caller_ata.amount < 100 {
            return err!(MyError::InsuffientFunds);
        }

        let bump_seed = [ctx.bumps.central_authority];
        let signer_seeds: &[&[&[u8]]] = &[&["central_authority".as_bytes(), &bump_seed.as_ref()]];

        MintV1CpiBuilder::new(&ctx.accounts.bubblegum_program.to_account_info())
            .tree_config(&ctx.accounts.tree_config.to_account_info())
            .leaf_owner(&ctx.accounts.caller.to_account_info())
            .leaf_delegate(&ctx.accounts.caller.to_account_info())
            .merkle_tree(&ctx.accounts.merkle_tree.to_account_info())
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

        let mut nft_atas: Vec<AccountInfo> = Vec::new();

        let accounts = &mut ctx.remaining_accounts.iter();
        let length = accounts.len() / 2;

        for i in 0..length {
            // let nft = next_account_info(accounts)?;
            let owner = next_account_info(accounts)?;
            let ata = next_account_info(accounts)?;

            let expected_ata = get_associated_token_address(owner.key, &ctx.accounts.mint.key());

            msg!(&owner.key.to_string());
            msg!(&expected_ata.to_string());

            // if nft.owner == owner.key {
            if ata.key == &expected_ata {
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

        let decimals = ctx.accounts.mint.decimals as u8;

        let mut percent = 1 as f64 / nft_atas.len() as f64;
        percent = (percent * 10.0 * (decimals as f64)).round() / (10.0 * (decimals as f64));

        let quota = percent * (1 as f64) * f64::powf(10.0, decimals as f64);
        let quota = quota as u64;

        for ata in nft_atas.iter() {
            let _ = transfer_checked(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.caller_ata.to_account_info(),
                        mint: ctx.accounts.mint.to_account_info(),
                        to: ata.to_account_info(),
                        authority: ctx.accounts.caller.to_account_info(),
                    },
                ),
                quota,
                decimals,
            );
        }

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut, signer)]
    pub payer: Signer<'info>,

    #[account(mut, signer)]
    pub merkle_tree: Signer<'info>,

    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + CentralStateData::MAX_SIZE,
        seeds = [b"central_authority"],
        bump
        )]
    pub central_authority: Account<'info, CentralStateData>,

    #[account(
        init_if_needed,
        payer = payer,
        mint::decimals = 2,
        mint::authority = payer.key(),
        mint::freeze_authority = payer.key(),

    )]
    pub mint_account: Account<'info, Mint>,

    /// CHECK: Address validated using constraint
    #[account(mut)]
    pub metadata_account: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,

    pub token_metadata_program: Program<'info, Metadata>,

    pub rent: Sysvar<'info, Rent>,

    /// CHECK: This account is checked in the instruction
    #[account(mut)]
    pub tree_config: UncheckedAccount<'info>,

    /// CHECK: This account is checked in the instruction
    pub bubblegum_program: UncheckedAccount<'info>,

    /// CHECK: This account is checked in the instruction
    pub log_wrapper: UncheckedAccount<'info>,

    /// CHECK: This account is checked in the instruction
    pub compression_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MintPayload<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(mut)]
    pub mint_account: Account<'info, Mint>,

    pub recipient: SystemAccount<'info>,

    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = mint_account,
        associated_token::authority = recipient,
    )]
    pub recipient_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DistributePayload<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

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
    pub merkle_tree: Signer<'info>,

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

#[account]
pub struct CentralStateData {
    pub collection_address: Pubkey,
    pub merkle_tree_address: Option<Pubkey>,
}

impl CentralStateData {
    pub const MAX_SIZE: usize = 32 * 3;
}

#[error_code]
pub enum MyError {
    #[msg("caller should hold more than 100 tokens in account")]
    InsuffientFunds,
}
