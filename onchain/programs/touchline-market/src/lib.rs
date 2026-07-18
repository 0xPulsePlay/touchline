//! touchline-market — a fixed-odds DEALER market on TxLINE de-margined win probabilities.
//!
//! Product: one-touch barrier markets ("will <side>'s win probability touch B%?"). The house
//! quotes a fair price f = min(1, p/B)·0.87 and takes the other side; a bet is fully collateralized
//! at placement — user stakes S, house escrows its liability L = S·(1/f − 1), so the vault always
//! holds the entire payout S/f and can never be short. Winner claims the whole per-bet escrow.
//!
//! Settlement is RESOLVER-ATTESTED with on-chain evidence: the off-chain resolver runs
//! `@txline/verify` against the MAINNET `daily_batch_roots` PDA (where TxLINE anchors odds), and
//! records the triggering tick's evidence here — message id, timestamp, observed price, and the
//! mainnet root hash it verified against — so ANYONE can independently re-verify the settlement.
//!
//! SAFETY: devnet only, mock SPL tokens (zero real value). Nothing here touches mainnet funds.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint, Transfer as SplTransfer};

declare_id!("6kZYYdZLJcsU2ZBKKthc7BpddUiYdTbAtGigS2bJc53K");

const BPS: u128 = 10_000;

#[program]
pub mod touchline_market {
    use super::*;

    /// One-time global config: admin, the resolver/house authority, and the per-bet stake cap.
    pub fn init_config(ctx: Context<InitConfig>, resolver: Pubkey, bet_cap: u64) -> Result<()> {
        let c = &mut ctx.accounts.config;
        c.admin = ctx.accounts.admin.key();
        c.resolver = resolver;
        c.bet_cap = bet_cap;
        c.bump = ctx.bumps.config;
        Ok(())
    }

    pub fn set_resolver(ctx: Context<AdminOnly>, resolver: Pubkey, bet_cap: u64) -> Result<()> {
        let c = &mut ctx.accounts.config;
        c.resolver = resolver;
        c.bet_cap = bet_cap;
        Ok(())
    }

    /// Open a barrier market. `side`: 0=part1, 1=draw, 2=part2. `barrier_bps`: e.g. 6000 = 60%.
    /// The house authority owns the market and provides liability liquidity per bet.
    pub fn create_market(
        ctx: Context<CreateMarket>,
        fixture_id: i64,
        side: u8,
        barrier_bps: u16,
        cutoff_ts: i64,
    ) -> Result<()> {
        require!(side <= 2, MarketError::BadSide);
        require!(barrier_bps > 0 && barrier_bps < 10_000, MarketError::BadBarrier);
        let m = &mut ctx.accounts.market;
        m.house = ctx.accounts.house.key();
        m.mint = ctx.accounts.mint.key();
        m.fixture_id = fixture_id;
        m.side = side;
        m.barrier_bps = barrier_bps;
        m.cutoff_ts = cutoff_ts;
        m.status = 0; // open
        m.total_stake = 0;
        m.total_payout = 0;
        m.bet_count = 0;
        m.bump = ctx.bumps.market;
        m.vault_bump = ctx.bumps.vault;
        m.evidence = Evidence::default();
        Ok(())
    }

    /// Place a fixed-odds bet against the house. Requires BOTH the user and the house authority to
    /// sign — the house co-signs so the quoted `price_bps` and the per-bet cap are gated by the
    /// dealer, never chosen unilaterally by the user (prevents stale/favourable-price abuse).
    /// Fully collateralized: user stake S in, house liability (payout − S) in, vault holds payout.
    pub fn place_bet(ctx: Context<PlaceBet>, nonce: u64, amount: u64, price_bps: u16) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        {
            let m = &ctx.accounts.market;
            require!(m.status == 0, MarketError::NotOpen);
            require!(now < m.cutoff_ts, MarketError::Closed);
        }
        require!(amount > 0, MarketError::ZeroAmount);
        require!(amount <= ctx.accounts.config.bet_cap, MarketError::OverCap);
        require!(price_bps > 0 && price_bps <= 10_000, MarketError::BadPrice);
        // cross-account checks in-handler (accounts fully loaded here — avoids validation-order reads)
        require_keys_eq!(ctx.accounts.house.key(), ctx.accounts.market.house, MarketError::NotHouse);
        require_keys_eq!(ctx.accounts.user_token.mint, ctx.accounts.market.mint, MarketError::WrongMint);
        require_keys_eq!(ctx.accounts.house_token.mint, ctx.accounts.market.mint, MarketError::WrongMint);
        require_keys_eq!(ctx.accounts.user_token.owner, ctx.accounts.user.key(), MarketError::WrongOwner);
        require_keys_eq!(ctx.accounts.house_token.owner, ctx.accounts.house.key(), MarketError::WrongOwner);

        // payout = amount / price ; liability = payout − amount (both in token base units)
        let payout = (amount as u128)
            .checked_mul(BPS).and_then(|x| x.checked_div(price_bps as u128))
            .ok_or(MarketError::Overflow)? as u64;
        let liability = payout.checked_sub(amount).ok_or(MarketError::Overflow)?;

        // user stake -> vault
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                SplTransfer {
                    from: ctx.accounts.user_token.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
        )?;
        // house liability -> vault (house co-signs this tx)
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                SplTransfer {
                    from: ctx.accounts.house_token.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.house.to_account_info(),
                },
            ),
            liability,
        )?;

        let bet = &mut ctx.accounts.bet;
        bet.market = ctx.accounts.market.key();
        bet.user = ctx.accounts.user.key();
        bet.nonce = nonce;
        bet.amount = amount;
        bet.price_bps = price_bps;
        bet.payout = payout;
        bet.placed_ts = now;
        bet.claimed = false;
        bet.bump = ctx.bumps.bet;

        let m = &mut ctx.accounts.market;
        m.total_stake = m.total_stake.checked_add(amount).ok_or(MarketError::Overflow)?;
        m.total_payout = m.total_payout.checked_add(payout).ok_or(MarketError::Overflow)?;
        m.bet_count = m.bet_count.checked_add(1).ok_or(MarketError::Overflow)?;

        emit!(BetPlaced {
            market: m.key(), user: bet.user, nonce, amount, price_bps, payout,
        });
        Ok(())
    }

    /// Resolve the market (resolver authority only). `outcome`: true = YES (barrier touched).
    /// Records the settlement evidence on-chain for public re-verification. For YES, the evidence
    /// is the anchored odds tick that crossed the barrier; for NO, the fixture-final attestation.
    pub fn resolve(ctx: Context<Resolve>, outcome: bool, ev: Evidence) -> Result<()> {
        let m = &mut ctx.accounts.market;
        require!(m.status == 0, MarketError::AlreadyResolved);
        require_keys_eq!(ctx.accounts.resolver.key(), ctx.accounts.config.resolver, MarketError::NotResolver);
        m.status = if outcome { 1 } else { 2 };
        m.evidence = ev;
        emit!(Resolved { market: m.key(), outcome, message_id: m.evidence.message_id, root_hash: m.evidence.root_hash });
        Ok(())
    }

    /// Claim a winning bet's full escrow. YES → the user claims payout; NO → the house claims it.
    /// The `winner` token account must belong to the side that won.
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let m = &ctx.accounts.market;
        require!(m.status != 0, MarketError::NotResolved);
        let bet = &mut ctx.accounts.bet;
        require!(!bet.claimed, MarketError::AlreadyClaimed);

        let yes = m.status == 1;
        // YES → user wins the payout; NO → house wins the payout. Enforce the right claimant.
        let expected_owner = if yes { bet.user } else { m.house };
        require_keys_eq!(ctx.accounts.winner_token.owner, expected_owner, MarketError::NotWinner);

        let market_key = m.key();
        let seeds: &[&[u8]] = &[b"vault", market_key.as_ref(), &[m.vault_bump]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                SplTransfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.winner_token.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                &[seeds],
            ),
            bet.payout,
        )?;
        bet.claimed = true;
        emit!(Claimed { market: market_key, user: bet.user, payout: bet.payout, to: ctx.accounts.winner_token.owner });
        Ok(())
    }
}

/// On-chain settlement evidence — everything needed to independently re-verify via `@txline/verify`.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct Evidence {
    /// the anchored odds tick's MessageId (padded to 48 bytes; e.g. "1837930444:00003:000323-10021-stab")
    pub message_id: [u8; 48],
    /// the tick timestamp (epoch ms)
    pub ts: i64,
    /// the side's de-margined probability at the tick, in bps (e.g. 6969 = 69.69%)
    pub prob_bps: u16,
    /// the mainnet `daily_batch_roots` 5-min-slot root the resolver verified against
    pub root_hash: [u8; 32],
    /// the mainnet daily_batch_roots PDA the root was read from
    pub pda: Pubkey,
}
impl Default for Evidence {
    fn default() -> Self {
        Self { message_id: [0u8; 48], ts: 0, prob_bps: 0, root_hash: [0u8; 32], pda: Pubkey::default() }
    }
}

#[account]
pub struct Config {
    pub admin: Pubkey,
    pub resolver: Pubkey,
    pub bet_cap: u64,
    pub bump: u8,
}
impl Config { pub const SPACE: usize = 8 + 32 + 32 + 8 + 1; }

#[account]
pub struct Market {
    pub house: Pubkey,
    pub mint: Pubkey,
    pub fixture_id: i64,
    pub side: u8,
    pub barrier_bps: u16,
    pub cutoff_ts: i64,
    pub status: u8, // 0 open, 1 resolved_yes, 2 resolved_no
    pub total_stake: u64,
    pub total_payout: u64,
    pub bet_count: u64,
    pub bump: u8,
    pub vault_bump: u8,
    pub evidence: Evidence,
}
impl Market {
    // 8 disc + 32 + 32 + 8 + 1 + 2 + 8 + 1 + 8 + 8 + 8 + 1 + 1 + evidence(48+8+2+32+32=122)
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 1 + 2 + 8 + 1 + 8 + 8 + 8 + 1 + 1 + 122;
}

#[account]
pub struct Bet {
    pub market: Pubkey,
    pub user: Pubkey,
    pub nonce: u64,
    pub amount: u64,
    pub price_bps: u16,
    pub payout: u64,
    pub placed_ts: i64,
    pub claimed: bool,
    pub bump: u8,
}
impl Bet { pub const SPACE: usize = 8 + 32 + 32 + 8 + 8 + 2 + 8 + 8 + 1 + 1; }

#[derive(Accounts)]
pub struct InitConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = Config::SPACE, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = admin)]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
#[instruction(fixture_id: i64, side: u8, barrier_bps: u16)]
pub struct CreateMarket<'info> {
    #[account(mut)]
    pub house: Signer<'info>,
    pub mint: Account<'info, Mint>,
    #[account(
        init, payer = house, space = Market::SPACE,
        seeds = [b"market".as_ref(), &fixture_id.to_le_bytes(), &[side], &barrier_bps.to_le_bytes()],
        bump
    )]
    pub market: Account<'info, Market>,
    #[account(
        init, payer = house,
        token::mint = mint, token::authority = vault,
        seeds = [b"vault".as_ref(), market.key().as_ref()], bump
    )]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct PlaceBet<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    /// The dealer co-signs every bet — this gates price and cap. Verified == market.house in-handler.
    #[account(mut)]
    pub house: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(mut, seeds = [b"vault".as_ref(), market.key().as_ref()], bump = market.vault_bump)]
    pub vault: Account<'info, TokenAccount>,
    /// mint/owner verified against the market in-handler (avoids validation-order cross-reads)
    #[account(mut)]
    pub user_token: Account<'info, TokenAccount>,
    #[account(mut)]
    pub house_token: Account<'info, TokenAccount>,
    #[account(
        init, payer = user, space = Bet::SPACE,
        seeds = [b"bet".as_ref(), market.key().as_ref(), user.key().as_ref(), &nonce.to_le_bytes()],
        bump
    )]
    pub bet: Account<'info, Bet>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Resolve<'info> {
    pub resolver: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub market: Account<'info, Market>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub claimant: Signer<'info>,
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(mut, seeds = [b"vault".as_ref(), market.key().as_ref()], bump = market.vault_bump)]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [b"bet".as_ref(), market.key().as_ref(), bet.user.as_ref(), &bet.nonce.to_le_bytes()],
        bump = bet.bump,
        has_one = market,
    )]
    pub bet: Account<'info, Bet>,
    #[account(mut, token::mint = market.mint)]
    pub winner_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[event]
pub struct BetPlaced { pub market: Pubkey, pub user: Pubkey, pub nonce: u64, pub amount: u64, pub price_bps: u16, pub payout: u64 }
#[event]
pub struct Resolved { pub market: Pubkey, pub outcome: bool, pub message_id: [u8; 48], pub root_hash: [u8; 32] }
#[event]
pub struct Claimed { pub market: Pubkey, pub user: Pubkey, pub payout: u64, pub to: Pubkey }

#[error_code]
pub enum MarketError {
    #[msg("side must be 0,1,2")] BadSide,
    #[msg("barrier bps must be in (0,10000)")] BadBarrier,
    #[msg("market not open")] NotOpen,
    #[msg("betting closed")] Closed,
    #[msg("amount must be > 0")] ZeroAmount,
    #[msg("amount over per-bet cap")] OverCap,
    #[msg("price bps must be in (0,10000]")] BadPrice,
    #[msg("arithmetic overflow")] Overflow,
    #[msg("signer is not the market house")] NotHouse,
    #[msg("token mint does not match market")] WrongMint,
    #[msg("token account owner mismatch")] WrongOwner,
    #[msg("market already resolved")] AlreadyResolved,
    #[msg("market not resolved")] NotResolved,
    #[msg("signer is not the resolver")] NotResolver,
    #[msg("bet already claimed")] AlreadyClaimed,
    #[msg("token account owner is not the winning side")] NotWinner,
}
