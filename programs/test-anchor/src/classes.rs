use anchor_lang::prelude::*;

#[account]
pub struct CentralStateData {
    pub initialized: bool,
    pub centralized_account: Pubkey,
    pub base_cost: u64,
    pub admin_quota: f64,
}

impl CentralStateData {
    pub const MAX_SIZE: usize = 32 * 3;
}

#[derive(Debug, Clone, AnchorDeserialize, AnchorSerialize)]
pub struct AdditionalLeafData {
    pub leaf_index: u32,
    pub owner: Pubkey,
    pub delegate: Pubkey,
    pub root: Pubkey,
    pub leaf_hash: Option<[u8; 32]>,
}
