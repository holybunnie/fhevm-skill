// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import { FHE, euint64, externalEuint64, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

interface IConfidentialToken {
    function transfer(address to, euint64 amount) external returns (euint64);
}

// Dirty contract — AP-009 violation: ignores transfer return, uses requested amount
contract SilentFailureBidding is ZamaEthereumConfig {
    IConfidentialToken public token;
    mapping(address => euint64) public bids;
    euint64 public highestBid;

    constructor(address _token) {
        token = IConfidentialToken(_token);
    }

    function placeBid(externalEuint64 encBid, bytes calldata proof) external {
        euint64 bidAmount = FHE.fromExternal(encBid, proof);

        // AP-009 VIOLATION: ignores return value of transfer
        token.transfer(address(this), bidAmount);

        // Uses the requested bidAmount instead of actual transferred amount
        ebool isHigher = FHE.gt(bidAmount, highestBid);
        highestBid = FHE.select(isHigher, bidAmount, highestBid);
        bids[msg.sender] = bidAmount;

        FHE.allowThis(highestBid);
        FHE.allowThis(bids[msg.sender]);
        FHE.allow(bids[msg.sender], msg.sender);
    }
}
