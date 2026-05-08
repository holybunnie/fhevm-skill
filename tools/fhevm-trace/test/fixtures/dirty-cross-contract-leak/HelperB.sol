// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint64 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

// HelperB — receives a handle from ContractA, operates on it, and grants
// the result back to msg.sender (which is ContractA, not the end user).
// This is the OpenZeppelin guide's flagship cross-contract vulnerability:
// if ContractA persistent-allows the handle to HelperB, an attacker proxy P
// can call A.someEntry() and route the handle through, getting ACL access.
contract HelperB is ZamaEthereumConfig {
    function compute(euint64 input) external returns (euint64) {
        euint64 result = FHE.add(input, FHE.asEuint64(1));
        // AP-006-EXT: grants result to msg.sender (ContractA), but since A
        // persistent-allowed the input to B, an attacker proxy calling through A
        // gets the result disclosed.
        FHE.allow(result, msg.sender);
        FHE.allowThis(result);
        return result;
    }
}
