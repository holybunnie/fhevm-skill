// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import { FHE, euint64, externalEuint64, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title ConfidentialAuction — sealed-bid auction template
/// @notice Bids are encrypted. Winner disclosed only after finality delay.
/// Follows all AP rules. Copy and customize.
contract ConfidentialAuction is ZamaEthereumConfig {
    address public owner;
    euint64 private highestBid;
    address public highestBidder;
    bool public finalized;
    uint256 public finalizedAt;
    uint256 public constant DISCLOSURE_DELAY = 10; // blocks

    mapping(address => euint64) private _bids;

    constructor() {
        owner = msg.sender;
    }

    /// @notice Place a sealed bid
    function bid(externalEuint64 encAmount, bytes calldata proof) external {
        require(!finalized, "Auction finalized");
        euint64 amount = FHE.fromExternal(encAmount, proof);

        // Update highest bid using select (AP-001: no branching on encrypted)
        if (FHE.isInitialized(highestBid)) {
            ebool isHigher = FHE.gt(amount, highestBid);
            highestBid = FHE.select(isHigher, amount, highestBid);
        } else {
            highestBid = amount;
        }

        _bids[msg.sender] = amount;
        FHE.allowThis(highestBid); // AP-003
        FHE.allowThis(amount); // AP-003
        FHE.allow(amount, msg.sender); // AP-004
    }

    /// @notice Finalize auction (owner only)
    function finalize() external {
        require(msg.sender == owner, "Not owner");
        require(!finalized, "Already finalized");
        finalized = true;
        finalizedAt = block.number;
    }

    /// @notice Disclose results after finality delay (AP-011: two-phase)
    function disclose() external {
        require(finalized, "Not finalized");
        require(block.number >= finalizedAt + DISCLOSURE_DELAY, "Too soon");
        FHE.makePubliclyDecryptable(highestBid);
    }

    function getMyBid(address user) external view returns (euint64) {
        return _bids[user];
    }
}
