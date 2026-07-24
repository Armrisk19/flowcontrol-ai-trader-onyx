// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IFlowTierManager} from "./interfaces/IFlowTierManager.sol";

contract FlowStrategyRegistry is AccessControl {
    bytes32 public constant REVIEWER_ROLE = keccak256("REVIEWER_ROLE");
    uint8 public constant CREATOR_TIER = 3;

    struct StrategyRules {
        uint16 reserveBps;
        uint16 rebalanceThresholdBps;
        uint64 maxTradeUsdE6;
        uint8 maxAssets;
        bool momentumOnly;
        uint32 cooldownSeconds;
        uint16 maxTradesPerDay;
    }

    struct Strategy {
        address creator;
        address payout;
        string metadataURI;
        bytes32 rulesHash;
        uint16 creatorFeeBps;
        uint8 minimumTier;
        bool active;
        StrategyRules rules;
    }

    IFlowTierManager public immutable tierManager;
    uint256 public nextStrategyId = 1;
    mapping(uint256 => Strategy) private _strategies;

    event StrategySubmitted(
        uint256 indexed strategyId,
        address indexed creator,
        bytes32 indexed rulesHash,
        string metadataURI
    );
    event StrategyReviewed(uint256 indexed strategyId, bool active, uint16 creatorFeeBps, uint8 minimumTier);

    constructor(address admin, address tierManager_) {
        require(admin != address(0) && tierManager_.code.length > 0, "BAD_INIT");
        tierManager = IFlowTierManager(tierManager_);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(REVIEWER_ROLE, admin);
    }

    function submitStrategy(
        string calldata metadataURI,
        address payout,
        StrategyRules calldata rules
    ) external returns (uint256 id) {
        require(payout != address(0), "INVALID_PAYOUT");
        require(bytes(metadataURI).length > 0 && bytes(metadataURI).length <= 512, "METADATA_URI_LENGTH");
        require(hasRole(REVIEWER_ROLE, msg.sender) || tierManager.tierOf(msg.sender) >= CREATOR_TIER, "CREATOR_TIER_REQUIRED");
        _validateRules(rules);
        bytes32 hash = hashRules(rules);
        id = nextStrategyId++;
        _strategies[id] = Strategy(msg.sender, payout, metadataURI, hash, 0, 0, false, rules);
        emit StrategySubmitted(id, msg.sender, hash, metadataURI);
    }

    function reviewStrategy(uint256 id, bool active, uint16 feeShareBps, uint8 minimumTier_) external onlyRole(REVIEWER_ROLE) {
        require(_strategies[id].creator != address(0), "UNKNOWN_STRATEGY");
        require(feeShareBps <= 6_000, "CREATOR_SHARE_CAP");
        require(minimumTier_ <= 4, "INVALID_TIER");
        _strategies[id].active = active;
        _strategies[id].creatorFeeBps = feeShareBps;
        _strategies[id].minimumTier = minimumTier_;
        emit StrategyReviewed(id, active, feeShareBps, minimumTier_);
    }

    function hashRules(StrategyRules memory rules) public pure returns (bytes32) {
        return keccak256(abi.encode(
            rules.reserveBps,
            rules.rebalanceThresholdBps,
            rules.maxTradeUsdE6,
            rules.maxAssets,
            rules.momentumOnly,
            rules.cooldownSeconds,
            rules.maxTradesPerDay
        ));
    }

    function getStrategy(uint256 id) external view returns (Strategy memory) {
        return _strategies[id];
    }

    function getRules(uint256 id) external view returns (StrategyRules memory) {
        require(_strategies[id].creator != address(0), "UNKNOWN_STRATEGY");
        return _strategies[id].rules;
    }

    function feeRecipient(uint256 id) external view returns (address) { return _strategies[id].payout; }
    function creatorFeeBps(uint256 id) external view returns (uint16) { return _strategies[id].creatorFeeBps; }
    function minimumTier(uint256 id) external view returns (uint8) { return _strategies[id].minimumTier; }
    function isActive(uint256 id) external view returns (bool) { return _strategies[id].active; }

    function _validateRules(StrategyRules calldata rules) private pure {
        require(rules.reserveBps >= 1_000 && rules.reserveBps <= 9_000, "RESERVE_RANGE");
        require(rules.rebalanceThresholdBps >= 100 && rules.rebalanceThresholdBps <= 3_000, "THRESHOLD_RANGE");
        require(rules.maxTradeUsdE6 >= 5_000_000 && rules.maxTradeUsdE6 <= 100_000_000_000, "TRADE_USD_RANGE");
        require(rules.maxAssets >= 1 && rules.maxAssets <= 12, "ASSET_COUNT_RANGE");
        require(rules.cooldownSeconds >= 60 && rules.cooldownSeconds <= 1 days, "COOLDOWN_RANGE");
        require(rules.maxTradesPerDay >= 1 && rules.maxTradesPerDay <= 48, "TRADE_COUNT_RANGE");
    }
}
