// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import { FHE, euint64, externalEuint64, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

// Clean contract — no anti-pattern violations. Should produce 0 findings.
contract CleanVault is ZamaEthereumConfig {
    mapping(address => euint64) private balances;

    // AP-003 + AP-004: proper allowThis and allow
    function deposit(externalEuint64 encAmount, bytes calldata proof) external {
        euint64 amount = FHE.fromExternal(encAmount, proof);
        euint64 oldBal = balances[msg.sender];
        euint64 newBal;
        if (FHE.isInitialized(oldBal)) {
            newBal = FHE.add(oldBal, amount);
        } else {
            newBal = amount;
        }
        balances[msg.sender] = newBal;
        FHE.allowThis(newBal);
        FHE.allow(newBal, msg.sender);
    }

    // AP-006: transient for inter-contract call (no external call here, just showing correct pattern)
    function getBalance() external view returns (euint64) {
        return balances[msg.sender];
    }
}
