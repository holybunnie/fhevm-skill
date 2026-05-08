// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint64 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";
import { HelperB } from "./HelperB.sol";

// ContractA — calls HelperB.compute() after persistent-allowing the handle to B.
// This creates the cross-contract ACL leak: an attacker proxy P calling
// A.processValue() causes HelperB to FHE.allow(result, msg.sender=A),
// and since A persistent-allowed the input to B, the chain leaks.
contract ContractA is ZamaEthereumConfig {
    HelperB public helperB;
    mapping(address => euint64) private balances;

    constructor(address _helperB) {
        helperB = HelperB(_helperB);
    }

    function processValue(euint64 value) external returns (euint64) {
        FHE.allowThis(value);
        // AP-006-EXT: persistent allow to external contract — creates cross-contract leak
        FHE.allow(value, address(helperB));
        euint64 result = helperB.compute(value);
        FHE.allowThis(result);
        FHE.allow(result, msg.sender);
        return result;
    }
}
