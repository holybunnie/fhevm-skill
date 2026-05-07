// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import { FHE, euint64 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

// Dirty contract — AP-010 violation: callback without delete before external call
contract ReplayableWithdrawal is ZamaEthereumConfig {
    mapping(uint256 => address) public pendingWithdrawals;
    mapping(uint256 => uint256) public pendingAmounts;

    function requestWithdrawal(uint256 requestId) external {
        pendingWithdrawals[requestId] = msg.sender;
        pendingAmounts[requestId] = 1 ether;
    }

    // AP-010 VIOLATION: no delete before transfer
    function onDecryptedCallback(uint256 requestId) external {
        address recipient = pendingWithdrawals[requestId];
        uint256 amount = pendingAmounts[requestId];
        // External call BEFORE delete — replay vulnerability
        payable(recipient).transfer(amount);
        // Delete happens too late
        delete pendingWithdrawals[requestId];
    }
}
