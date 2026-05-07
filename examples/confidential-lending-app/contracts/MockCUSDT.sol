// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import { FHE, euint64, externalEuint64, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title MockCUSDT — minimal confidential ERC20 for testing
/// @notice Balances are encrypted as euint64. Transfer silently zeros on insufficient balance.
contract MockCUSDT is ZamaEthereumConfig {
    mapping(address => euint64) private _balances;
    address public owner;

    constructor() {
        owner = msg.sender;
    }

    function mint(address to, externalEuint64 encAmount, bytes calldata proof) external {
        euint64 amount = FHE.fromExternal(encAmount, proof);
        euint64 oldBal = _balances[to];
        euint64 newBal;
        if (FHE.isInitialized(oldBal)) {
            newBal = FHE.add(oldBal, amount);
        } else {
            newBal = amount;
        }
        _balances[to] = newBal;
        FHE.allowThis(newBal); // AP-003
        FHE.allow(newBal, to); // AP-004
    }

    /// @notice Transfer encrypted amount. Returns actual transferred amount.
    /// @dev AP-009: caller MUST use the return value, not the input amount.
    /// Silently zeros if sender has insufficient balance (cannot revert on encrypted check).
    function transfer(address to, euint64 amount) external returns (euint64) {
        require(FHE.isSenderAllowed(amount), "Not allowed on handle"); // AP-007
        euint64 senderBal = _balances[msg.sender];

        // AP-001, AP-002: cannot branch/require on encrypted comparison
        ebool hasEnough = FHE.ge(senderBal, amount);
        euint64 actualAmount = FHE.select(hasEnough, amount, FHE.asEuint64(0)); // AP-009: zero if insufficient

        // Update balances
        _balances[msg.sender] = FHE.sub(senderBal, actualAmount);
        FHE.allowThis(_balances[msg.sender]); // AP-003
        FHE.allow(_balances[msg.sender], msg.sender); // AP-004

        euint64 recipientBal = _balances[to];
        if (FHE.isInitialized(recipientBal)) {
            _balances[to] = FHE.add(recipientBal, actualAmount);
        } else {
            _balances[to] = actualAmount;
        }
        FHE.allowThis(_balances[to]); // AP-003
        FHE.allow(_balances[to], to); // AP-004

        // AP-006: transient allow for the caller to use the returned amount within this tx
        FHE.allowTransient(actualAmount, msg.sender);

        return actualAmount;
    }

    function balanceOf(address account) external view returns (euint64) {
        return _balances[account];
    }

    /// @notice Transfer from a specific sender. Caller must have transient access to the amount handle.
    /// @dev AP-009: returns actual transferred amount (zero if insufficient balance).
    function transferFrom(address from, address to, euint64 amount) external returns (euint64) {
        require(FHE.isSenderAllowed(amount), "Not allowed on handle"); // AP-007
        euint64 senderBal = _balances[from];

        ebool hasEnough = FHE.ge(senderBal, amount);
        euint64 actualAmount = FHE.select(hasEnough, amount, FHE.asEuint64(0));

        _balances[from] = FHE.sub(senderBal, actualAmount);
        FHE.allowThis(_balances[from]);
        FHE.allow(_balances[from], from);

        euint64 recipientBal = _balances[to];
        if (FHE.isInitialized(recipientBal)) {
            _balances[to] = FHE.add(recipientBal, actualAmount);
        } else {
            _balances[to] = actualAmount;
        }
        FHE.allowThis(_balances[to]);
        FHE.allow(_balances[to], to);

        FHE.allowTransient(actualAmount, msg.sender);
        return actualAmount;
    }

    /// @notice Approve a spender to use handles from this contract
    function approveContract(address spender, euint64 amount) external {
        FHE.allowTransient(amount, spender); // AP-006
    }
}
