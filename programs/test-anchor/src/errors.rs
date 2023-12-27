use anchor_lang::prelude::*;

#[error_code]

pub enum MyError {
    #[msg("caller should hold more than 100 tokens in account")]
    InsuffientFunds,

    #[msg("SPL Token already initialized!")]
    AlreadyInitialized,

    InvalidAccountsPassed,
}
