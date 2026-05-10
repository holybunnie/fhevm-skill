// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import { FHE, euint64, externalEuint64, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

interface ICUSDTBroken {
    function transfer(address to, euint64 amount) external returns (euint64);
    function balanceOf(address account) external view returns (euint64);
}

/// @title ConfidentialLendingBroken — intentionally buggy for trace/attack testing
/// @notice Contains two bugs: AP-009 (ignored return) and AP-011 (premature disclosure).
contract ConfidentialLendingBroken is ZamaEthereumConfig {
    ICUSDTBroken public immutable token;

    mapping(address => euint64) private _collateral;
    mapping(address => euint64) private _debt;

    uint64 public constant LTV_NUMERATOR = 50;
    uint64 public constant LTV_DENOMINATOR = 100;

    constructor(address _token) {
        token = ICUSDTBroken(_token);
    }

    /// @notice Deposit — BUG: AP-009 ignores transfer return value.
    function deposit(externalEuint64 encAmount, bytes calldata proof) external {
        euint64 amount = FHE.fromExternal(encAmount, proof);
        FHE.allowTransient(amount, address(token));

        // BUG (AP-009): ignores returned actual amount, uses requested amount.
        token.transfer(address(this), amount);

        euint64 oldCollateral = _collateral[msg.sender];
        euint64 newCollateral;
        if (FHE.isInitialized(oldCollateral)) {
            newCollateral = FHE.add(oldCollateral, amount);
        } else {
            newCollateral = amount;
        }
        _collateral[msg.sender] = newCollateral;
        FHE.allowThis(newCollateral);
        FHE.allow(newCollateral, msg.sender);
    }

    /// @notice Borrow up to 50% of collateral.
    function borrow(externalEuint64 encAmount, bytes calldata proof) external {
        euint64 requestedAmount = FHE.fromExternal(encAmount, proof);
        euint64 collateral = _collateral[msg.sender];
        euint64 maxBorrow = FHE.div(FHE.mul(collateral, LTV_NUMERATOR), LTV_DENOMINATOR);

        ebool withinLimit = FHE.le(requestedAmount, maxBorrow);
        euint64 actualBorrow = FHE.select(withinLimit, requestedAmount, FHE.asEuint64(0));

        euint64 oldDebt = _debt[msg.sender];
        euint64 newDebt;
        if (FHE.isInitialized(oldDebt)) {
            euint64 projectedDebt = FHE.add(oldDebt, actualBorrow);
            ebool debtWithinLimit = FHE.le(projectedDebt, maxBorrow);
            newDebt = FHE.select(debtWithinLimit, projectedDebt, oldDebt);
        } else {
            newDebt = actualBorrow;
        }

        _debt[msg.sender] = newDebt;
        FHE.allowThis(newDebt);
        FHE.allow(newDebt, msg.sender);
    }

    /// @notice Repay debt.
    function repay(externalEuint64 encAmount, bytes calldata proof) external {
        euint64 amount = FHE.fromExternal(encAmount, proof);
        euint64 currentDebt = _debt[msg.sender];
        ebool repayingMore = FHE.gt(amount, currentDebt);
        euint64 actualRepay = FHE.select(repayingMore, currentDebt, amount);
        euint64 newDebt = FHE.sub(currentDebt, actualRepay);
        _debt[msg.sender] = newDebt;
        FHE.allowThis(newDebt);
        FHE.allow(newDebt, msg.sender);
    }

    /// @notice BUG (AP-011): premature disclosure in the same tx as time check.
    function liquidate(address user) external {
        require(block.timestamp > 1700000000, "Too early");
        euint64 collateral = _collateral[user];
        FHE.makePubliclyDecryptable(collateral);
    }

    function getCollateral(address user) external view returns (euint64) {
        return _collateral[user];
    }

    function getBalance(address user) external view returns (euint64) {
        return _collateral[user];
    }

    function getDebt(address user) external view returns (euint64) {
        return _debt[user];
    }
}
