// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import { FHE, euint64, externalEuint64, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title ConfidentialVote — encrypted voting template
/// @notice Votes are encrypted. Tally disclosed only after voting ends + finality delay.
/// Follows all AP rules. Copy and customize.
contract ConfidentialVote is ZamaEthereumConfig {
    address public owner;
    uint256 public votingEnd;
    uint256 public tallyDisclosedAt;
    uint256 public constant DISCLOSURE_DELAY = 10; // blocks
    bool public tallied;

    euint64 private yesVotes;
    euint64 private noVotes;
    mapping(address => bool) public hasVoted;

    constructor(uint256 _duration) {
        owner = msg.sender;
        votingEnd = block.number + _duration;
    }

    /// @notice Cast an encrypted vote (1 = yes, 0 = no)
    function vote(externalEuint64 encVote, bytes calldata proof) external {
        require(block.number < votingEnd, "Voting ended");
        require(!hasVoted[msg.sender], "Already voted");
        hasVoted[msg.sender] = true;

        euint64 v = FHE.fromExternal(encVote, proof);

        // Clamp to 0 or 1 (AP-012: overflow guard)
        ebool isOne = FHE.eq(v, FHE.asEuint64(1));
        euint64 yesIncrement = FHE.select(isOne, FHE.asEuint64(1), FHE.asEuint64(0)); // AP-001
        euint64 noIncrement = FHE.select(isOne, FHE.asEuint64(0), FHE.asEuint64(1));

        if (FHE.isInitialized(yesVotes)) {
            yesVotes = FHE.add(yesVotes, yesIncrement);
            noVotes = FHE.add(noVotes, noIncrement);
        } else {
            yesVotes = yesIncrement;
            noVotes = noIncrement;
        }

        FHE.allowThis(yesVotes); // AP-003
        FHE.allowThis(noVotes); // AP-003
    }

    /// @notice Tally votes (owner only, after voting ends)
    function tally() external {
        require(msg.sender == owner, "Not owner");
        require(block.number >= votingEnd, "Voting not ended");
        require(!tallied, "Already tallied");
        tallied = true;
        tallyDisclosedAt = block.number;
    }

    /// @notice Disclose results after finality delay (AP-011: two-phase)
    function discloseResults() external {
        require(tallied, "Not tallied");
        require(block.number >= tallyDisclosedAt + DISCLOSURE_DELAY, "Too soon");
        FHE.makePubliclyDecryptable(yesVotes);
        FHE.makePubliclyDecryptable(noVotes);
    }
}
