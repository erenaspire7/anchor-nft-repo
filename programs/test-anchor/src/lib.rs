use anchor_lang::prelude::*;

pub mod classes;
pub mod errors;
pub mod instructions;

pub use classes::*;
pub use errors::*;
pub use instructions::*;

declare_id!("29HEqiNgTffmNFgkpL4kUmDDVDSyGgtrSBXzHWiPYC2S");

#[program]
pub mod test_anchor {

    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        handle_initialize(ctx)
    }

    pub fn mint_token(ctx: Context<MintPayload>, amount: u64) -> Result<()> {
        handle_mint_token(ctx, amount)
    }

    pub fn verify<'info>(
        ctx: Context<'_, '_, '_, 'info, VerifyPayload<'info>>,
        metadata_args: Vec<u8>,
        leaf_data: AdditionalLeafData,
    ) -> Result<()> {
        handle_verify(ctx, metadata_args, leaf_data)
    }

    pub fn distribute<'info>(
        ctx: Context<'_, '_, '_, 'info, DistributePayload<'info>>,
        metadata_args: Vec<u8>,
        leaves_data: Vec<AdditionalLeafData>,
    ) -> Result<()> {
        handle_distribute(ctx, metadata_args, leaves_data)
    }
}
