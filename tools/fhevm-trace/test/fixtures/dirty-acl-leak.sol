// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import { FHE, euint64, externalEuint64 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

interface IFeeHandler {
    function processFee(euint64 amount) external;
}

// Dirty contract — AP-006 violation: persistent allowance to external contract
contract LeakyVault is ZamaEthereumConfig {
    IFeeHandler public feeHandler;
    mapping(address => euint64) private balances;

    constructor(address _feeHandler) {
        feeHandler = IFeeHandler(_feeHandler);
    }

    function deposit(externalEuint64 encAmount, bytes calldata proof) external {
        euint64 amount = FHE.fromExternal(encAmount, proof);
        // AP-006 VIOLATION: persistent allowance to external address
        FHE.allow(amount, address(feeHandler));
        feeHandler.processFee(amount);

        balances[msg.sender] = amount;
        FHE.allowThis(amount);
        FHE.allow(amount, msg.sender);
    }
}
