// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import { FHE, euint64, externalEuint64, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

interface IERC20Confidential {
    function transfer(address to, euint64 amount) external returns (euint64);
    function transferFrom(address from, address to, euint64 amount) external returns (euint64);
}

/// @title ConfidentialLending — hardened template
/// @notice Deposit encrypted collateral, borrow up to 50% LTV, repay.
/// Follows all AP rules. Copy and customize.
contract ConfidentialLending is ZamaEthereumConfig {
    IERC20Confidential public immutable token;

    mapping(address => euint64) private _collateral;
    mapping(address => euint64) private _debt;

    uint64 public constant LTV_NUMERATOR = 50;
    uint64 public constant LTV_DENOMINATOR = 100;

    constructor(address _token) {
        token = IERC20Confidential(_token);
    }

    /// @notice Deposit encrypted collateral
    function deposit(externalEuint64 encAmount, bytes calldata proof) external {
        euint64 amount = FHE.fromExternal(encAmount, proof);
        FHE.allowTransient(amount, address(token)); // AP-006
        euint64 actualDeposited = token.transferFrom(msg.sender, address(this), amount); // AP-009

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
    function borrow(externalEuint64 encAmount, bytes calldata proof) external {
        euint64 requestedAmount = FHE.fromExternal(encAmount, proof);
        euint64 collateral = _collateral[msg.sender];
        euint64 maxBorrow = FHE.div(FHE.mul(collateral, LTV_NUMERATOR), LTV_DENOMINATOR);

        ebool withinLimit = FHE.le(requestedAmount, maxBorrow);
        euint64 actualBorrow = FHE.select(withinLimit, requestedAmount, FHE.asEuint64(0)); // AP-001

        euint64 oldDebt = _debt[msg.sender];
        euint64 newDebt;
        if (FHE.isInitialized(oldDebt)) {
            euint64 projectedDebt = FHE.add(oldDebt, actualBorrow);
            ebool debtWithinLimit = FHE.le(projectedDebt, maxBorrow);
            newDebt = FHE.select(debtWithinLimit, projectedDebt, oldDebt); // AP-001, AP-012
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

        ebool repayingMore = FHE.gt(amount, currentDebt);
        euint64 actualRepay = FHE.select(repayingMore, currentDebt, amount); // AP-001

        euint64 newDebt = FHE.sub(currentDebt, actualRepay);
        _debt[msg.sender] = newDebt;
        FHE.allowThis(newDebt); // AP-003
        FHE.allow(newDebt, msg.sender); // AP-004
    }

    function getCollateral(address user) external view returns (euint64) {
        return _collateral[user];
    }

    function getDebt(address user) external view returns (euint64) {
        return _debt[user];
    }
}
