// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

contract FlowTierManager is AccessControl {
    bytes32 public constant TIER_ADMIN_ROLE = keccak256("TIER_ADMIN_ROLE");

    enum Tier { STARTER, FLOW, PRO, CREATOR, PARTNER }

    struct Grant {
        Tier tier;
        uint64 expiresAt;
    }

    mapping(address => Grant) private _grants;

    event TierSet(address indexed account, Tier tier, uint64 expiresAt);

    constructor(address admin) {
        require(admin != address(0), "ZERO_ADMIN");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(TIER_ADMIN_ROLE, admin);
    }

    function setTier(address account, Tier tier) external onlyRole(TIER_ADMIN_ROLE) {
        _setTier(account, tier, type(uint64).max);
    }

    function setTierUntil(address account, Tier tier, uint64 expiresAt) external onlyRole(TIER_ADMIN_ROLE) {
        require(expiresAt > block.timestamp, "EXPIRY_IN_PAST");
        _setTier(account, tier, expiresAt);
    }

    function tierOf(address account) external view returns (Tier) {
        Grant memory grant = _grants[account];
        if (grant.expiresAt < block.timestamp) return Tier.STARTER;
        return grant.tier;
    }

    function tierGrant(address account) external view returns (Tier tier, uint64 expiresAt) {
        Grant memory grant = _grants[account];
        if (grant.expiresAt < block.timestamp) return (Tier.STARTER, grant.expiresAt);
        return (grant.tier, grant.expiresAt);
    }

    function _setTier(address account, Tier tier, uint64 expiresAt) private {
        require(account != address(0), "ZERO_ACCOUNT");
        _grants[account] = Grant(tier, expiresAt);
        emit TierSet(account, tier, expiresAt);
    }
}
