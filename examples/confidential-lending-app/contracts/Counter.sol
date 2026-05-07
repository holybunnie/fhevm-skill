// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

// Smoke-test contract: encrypted counter using FHE operations
contract Counter is ZamaEthereumConfig {
    euint32 private _count;

    function getCount() external view returns (euint32) {
        return _count;
    }

    // AP-003: allowThis so contract can use _count next tx
    // AP-004: allow so caller can decrypt _count off-chain
    function increment(externalEuint32 inputVal, bytes calldata inputProof) external {
        euint32 evalue = FHE.fromExternal(inputVal, inputProof);
        _count = FHE.add(_count, evalue);
        FHE.allowThis(_count);
        FHE.allow(_count, msg.sender);
    }
}
