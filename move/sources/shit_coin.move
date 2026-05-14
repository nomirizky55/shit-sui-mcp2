module shit_coin::shit_coin;

use sui::coin::{Self, Coin, TreasuryCap};
use sui::dynamic_field as field;
use sui::object::{Self, UID};
use sui::sui::SUI;
use sui::transfer;
use sui::tx_context::{Self, TxContext};
use sui::url::{Self, Url};
use std::option;

public struct SHIT_COIN has drop {}

const EInvalidAmount: u64 = 0;
const EFrozen: u64 = 1;
const EPublicMintSoldOut: u64 = 2;
const EMaxWalletMintsReached: u64 = 3;
const ERecipientMustBeSender: u64 = 4;
const EDelegationNotFound: u64 = 5;
const EDelegationExhausted: u64 = 6;

const DECIMALS: u64 = 1_000_000;
const MINT_AMOUNT: u64 = 10_000_000 * DECIMALS;
const TOTAL_SUPPLY: u64 = 1_000_000_000 * DECIMALS;
const PUBLIC_MINT_ALLOCATION: u64 = 500_000_000 * DECIMALS;
const LP_ALLOCATION: u64 = 500_000_000 * DECIMALS;
const MAX_MINTS_PER_WALLET: u64 = 10;

public struct MintConfig has key {
    id: UID,
    treasury_cap: TreasuryCap<SHIT_COIN>,
    fee_recipient: address,
    fee_mist: u64,
    public_minted: u64,
    lp_recipient: address,
    frozen: bool
}

public struct AdminCap has key {
    id: UID
}

public struct DelegationKey has copy, drop, store {
    owner: address,
    relayer: address
}

fun init(witness: SHIT_COIN, ctx: &mut TxContext) {
    let (treasury_cap, metadata) = coin::create_currency(
        witness,
        6,
        b"SHIT",
        b"SHIT",
        b"Codex MCP mint demo token on Sui.",
        option::some<Url>(url::new_unsafe_from_bytes(b"https://example.com/logo.png")),
        ctx
    );

    transfer::public_freeze_object(metadata);
    transfer::public_transfer(treasury_cap, tx_context::sender(ctx));
    transfer::transfer(AdminCap { id: object::new(ctx) }, tx_context::sender(ctx));
}

public entry fun create_config(
    _admin_cap: &AdminCap,
    mut treasury_cap: TreasuryCap<SHIT_COIN>,
    fee_recipient: address,
    lp_recipient: address,
    fee_mist: u64,
    ctx: &mut TxContext
) {
    let lp_tokens = coin::mint(&mut treasury_cap, LP_ALLOCATION, ctx);
    transfer::public_transfer(lp_tokens, lp_recipient);

    let config = MintConfig {
        id: object::new(ctx),
        treasury_cap,
        fee_recipient,
        fee_mist,
        public_minted: 0,
        lp_recipient,
        frozen: false
    };

    transfer::share_object(config);
}

public entry fun set_frozen(_admin_cap: &AdminCap, config: &mut MintConfig, frozen: bool) {
    config.frozen = frozen;
}

public entry fun set_fee(_admin_cap: &AdminCap, config: &mut MintConfig, fee_recipient: address, fee_mist: u64) {
    config.fee_recipient = fee_recipient;
    config.fee_mist = fee_mist;
}

public fun total_supply(): u64 {
    TOTAL_SUPPLY
}

public fun public_mint_allocation(): u64 {
    PUBLIC_MINT_ALLOCATION
}

public fun lp_allocation(): u64 {
    LP_ALLOCATION
}

public fun max_mints_per_wallet(): u64 {
    MAX_MINTS_PER_WALLET
}

public fun mint_count(config: &MintConfig, wallet: address): u64 {
    if (field::exists<address>(&config.id, wallet)) {
        *field::borrow<address, u64>(&config.id, wallet)
    } else {
        0
    }
}

public fun delegated_mint_count(config: &MintConfig, owner: address, relayer: address): u64 {
    let key = DelegationKey { owner, relayer };
    if (field::exists<DelegationKey>(&config.id, key)) {
        *field::borrow<DelegationKey, u64>(&config.id, key)
    } else {
        0
    }
}

public entry fun approve_relayer(config: &mut MintConfig, relayer: address, max_mints: u64, ctx: &mut TxContext) {
    let owner = tx_context::sender(ctx);
    assert!(max_mints > 0 && max_mints <= MAX_MINTS_PER_WALLET, EInvalidAmount);

    let already_minted = mint_count(config, owner);
    let remaining_wallet_mints = if (already_minted >= MAX_MINTS_PER_WALLET) {
        0
    } else {
        MAX_MINTS_PER_WALLET - already_minted
    };
    let delegated_mints = if (max_mints > remaining_wallet_mints) {
        remaining_wallet_mints
    } else {
        max_mints
    };
    assert!(delegated_mints > 0, EMaxWalletMintsReached);

    let key = DelegationKey { owner, relayer };
    if (field::exists<DelegationKey>(&config.id, key)) {
        let remaining = field::borrow_mut<DelegationKey, u64>(&mut config.id, key);
        *remaining = delegated_mints;
    } else {
        field::add<DelegationKey, u64>(&mut config.id, key, delegated_mints);
    };
}

public entry fun revoke_relayer(config: &mut MintConfig, relayer: address, ctx: &mut TxContext) {
    let owner = tx_context::sender(ctx);
    let key = DelegationKey { owner, relayer };
    if (field::exists<DelegationKey>(&config.id, key)) {
        field::remove<DelegationKey, u64>(&mut config.id, key);
    };
}

public entry fun mint(
    config: &mut MintConfig,
    payment: Coin<SUI>,
    recipient: address,
    amount: u64,
    ctx: &mut TxContext
) {
    let sender = tx_context::sender(ctx);
    assert!(!config.frozen, EFrozen);
    assert!(recipient == sender, ERecipientMustBeSender);
    assert!(amount == MINT_AMOUNT, EInvalidAmount);
    assert!(coin::value(&payment) == config.fee_mist, EInvalidAmount);
    assert!(config.public_minted + amount <= PUBLIC_MINT_ALLOCATION, EPublicMintSoldOut);

    if (field::exists<address>(&config.id, sender)) {
        let count = field::borrow_mut<address, u64>(&mut config.id, sender);
        assert!(*count < MAX_MINTS_PER_WALLET, EMaxWalletMintsReached);
        *count = *count + 1;
    } else {
        field::add<address, u64>(&mut config.id, sender, 1);
    };

    transfer::public_transfer(payment, config.fee_recipient);
    config.public_minted = config.public_minted + amount;

    let minted = coin::mint(&mut config.treasury_cap, amount, ctx);
    transfer::public_transfer(minted, recipient);
}

public entry fun delegated_mint(
    config: &mut MintConfig,
    payment: Coin<SUI>,
    recipient: address,
    amount: u64,
    ctx: &mut TxContext
) {
    let relayer = tx_context::sender(ctx);
    assert!(!config.frozen, EFrozen);
    assert!(amount == MINT_AMOUNT, EInvalidAmount);
    assert!(coin::value(&payment) == config.fee_mist, EInvalidAmount);
    assert!(config.public_minted + amount <= PUBLIC_MINT_ALLOCATION, EPublicMintSoldOut);

    let key = DelegationKey { owner: recipient, relayer };
    assert!(field::exists<DelegationKey>(&config.id, key), EDelegationNotFound);
    let delegated_remaining = field::borrow_mut<DelegationKey, u64>(&mut config.id, key);
    assert!(*delegated_remaining > 0, EDelegationExhausted);
    *delegated_remaining = *delegated_remaining - 1;

    if (field::exists<address>(&config.id, recipient)) {
        let count = field::borrow_mut<address, u64>(&mut config.id, recipient);
        assert!(*count < MAX_MINTS_PER_WALLET, EMaxWalletMintsReached);
        *count = *count + 1;
    } else {
        field::add<address, u64>(&mut config.id, recipient, 1);
    };

    transfer::public_transfer(payment, config.fee_recipient);
    config.public_minted = config.public_minted + amount;

    let minted = coin::mint(&mut config.treasury_cap, amount, ctx);
    transfer::public_transfer(minted, recipient);
}
