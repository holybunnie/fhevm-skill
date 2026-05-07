// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import { FHE, euint64, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

// Dirty contract — AP-011 violation: makePubliclyDecryptable in same function as timestamp check
contract PrematureAuction is ZamaEthereumConfig {
    euint64 public winningBid;
    uint256 public auctionEnd;

    constructor(uint256 _duration) {
        auctionEnd = block.timestamp + _duration;
    }

    // AP-011 VIOLATION: discloses in same function as time check
    function finalizeAuction() external {
        require(block.timestamp > auctionEnd, "Not ended");
        FHE.makePubliclyDecryptable(winningBid);
    }
}
