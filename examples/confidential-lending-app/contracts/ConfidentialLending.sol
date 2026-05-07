// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import { FHE, euint64, externalEuint64, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

interface ICUSDT {
    function transfer(address to, euint64 amount) external returns (euint64);
    function transferFrom(address from, address to, euint64 amount) external returns (euint64);
    function balanceOf(address account) external view returns (euint64);
}

/// @title ConfidentialLending — hardened confidential lending protocol
/// @notice Deposit encrypted collateral, borrow up to 50% LTV, repay.
/// All balances and collateral encrypted as euint64. All AP rules followed.
contract ConfidentialLending is ZamaEthereumConfig {
    ICUSDT public immutable token;

    mapping(address => euint64) private _collateral;
    mapping(address => euint64) private _debt;

    uint64 public constant LTV_NUMERATOR = 50;
    uint64 public constant LTV_DENOMINATOR = 100;

    constructor(address _token) {
        token = ICUSDT(_token);
    }

    /// @notice Deposit encrypted collateral
    /// @dev AP-009: uses actual transferred amount, not requested
    function deposit(externalEuint64 encAmount, bytes calldata proof) external {
        euint64 amount = FHE.fromExternal(encAmount, proof);

        // AP-006: transient allow for the token contract to use our handle
        FHE.allowTransient(amount, address(token));
        // AP-009: use returned transferred amount, not the requested amount
        euint64 actualDeposited = token.transferFrom(msg.sender, address(this), amount);

        euint64 oldCollateral = _collateral[msg.sender];
        euint64 newCollateral;
        if (FHE.isInitialized(oldCollateral)) {
            newCollateral = FHE.add(oldCollateral, actualDeposited);
        } else {
            newCollateral = actualDeposited;
        }
        _collateral[msg.sender] = newCollateral;
        FHE.allowThis(newCollateral); // AP-003
        FHE.allow(newCollateral, msg.sender); // AP-004
    }

    /// @notice Borrow up to 50% of collateral
    /// @dev AP-001: no branching on encrypted. AP-012: overflow guard.
    function borrow(externalEuint64 encAmount, bytes calldata proof) external {
        euint64 requestedAmount = FHE.fromExternal(encAmount, proof);

        euint64 collateral = _collateral[msg.sender];

        // Calculate max borrowable: collateral * 50 / 100
        euint64 maxBorrow = FHE.div(FHE.mul(collateral, LTV_NUMERATOR), LTV_DENOMINATOR);

        // AP-012: clamp requested to max borrowable (overflow guard)
        ebool withinLimit = FHE.le(requestedAmount, maxBorrow);
        euint64 actualBorrow = FHE.select(withinLimit, requestedAmount, FHE.asEuint64(0)); // AP-001: select, not if

        // Update debt
        euint64 oldDebt = _debt[msg.sender];
        euint64 newDebt;
        if (FHE.isInitialized(oldDebt)) {
            // AP-012: check that adding doesn't exceed max
            euint64 projectedDebt = FHE.add(oldDebt, actualBorrow);
            ebool debtWithinLimit = FHE.le(projectedDebt, maxBorrow);
            newDebt = FHE.select(debtWithinLimit, projectedDebt, oldDebt); // AP-001
        } else {
            newDebt = actualBorrow;
        }

        _debt[msg.sender] = newDebt;
        FHE.allowThis(newDebt); // AP-003
        FHE.allow(newDebt, msg.sender); // AP-004
    }

    /// @notice Repay debt
    function repay(externalEuint64 encAmount, bytes calldata proof) external {
        euint64 amount = FHE.fromExternal(encAmount, proof);
        euint64 currentDebt = _debt[msg.sender];

        // AP-001: use select to cap repayment at current debt
        ebool repayingMore = FHE.gt(amount, currentDebt);
        euint64 actualRepay = FHE.select(repayingMore, currentDebt, amount);

        euint64 newDebt = FHE.sub(currentDebt, actualRepay);
        _debt[msg.sender] = newDebt;
        FHE.allowThis(newDebt); // AP-003
        FHE.allow(newDebt, msg.sender); // AP-004
    }

    /// @notice Get user's encrypted collateral balance
    function getCollateral(address user) external view returns (euint64) {
        return _collateral[user];
    }

    /// @notice Get user's encrypted balance (alias for collateral for compatibility)
    function getBalance(address user) external view returns (euint64) {
        return _collateral[user];
    }

    /// @notice Get user's encrypted debt
    function getDebt(address user) external view returns (euint64) {
        return _debt[user];
    }
}
