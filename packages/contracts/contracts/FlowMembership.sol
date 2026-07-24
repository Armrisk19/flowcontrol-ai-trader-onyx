// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {FlowTierManager} from "./FlowTierManager.sol";

contract FlowMembership is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Plan {
        uint96 price;
        uint32 duration;
        bool enabled;
    }

    IERC20 public immutable paymentToken;
    FlowTierManager public immutable tierManager;
    address public treasury;
    mapping(uint8 => Plan) public plans;

    event PlanConfigured(uint8 indexed tier, uint96 price, uint32 duration, bool enabled);
    event Subscribed(address indexed account, uint8 indexed tier, uint256 price, uint64 expiresAt, bool paidNative);
    event TreasurySet(address indexed treasury);

    constructor(address admin, address paymentToken_, address tierManager_, address treasury_) {
        require(admin != address(0) && paymentToken_.code.length > 0 && tierManager_.code.length > 0 && treasury_ != address(0), "BAD_INIT");
        paymentToken = IERC20(paymentToken_);
        tierManager = FlowTierManager(tierManager_);
        treasury = treasury_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function configurePlan(uint8 tier, uint96 price, uint32 duration, bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(tier >= 1 && tier <= 3, "SELF_SERVE_TIER_RANGE");
        require(duration >= 1 days && duration <= 366 days, "DURATION_RANGE");
        require(!enabled || price > 0, "PRICE_REQUIRED");
        plans[tier] = Plan(price, duration, enabled);
        emit PlanConfigured(tier, price, duration, enabled);
    }

    function setTreasury(address treasury_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(treasury_ != address(0), "ZERO_TREASURY");
        treasury = treasury_;
        emit TreasurySet(treasury_);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    function subscribe(uint8 tier) external nonReentrant whenNotPaused {
        Plan memory plan = _plan(tier);
        paymentToken.safeTransferFrom(msg.sender, treasury, plan.price);
        uint64 expiry = _grant(msg.sender, tier, plan.duration);
        emit Subscribed(msg.sender, tier, plan.price, expiry, false);
    }

    function subscribeNative(uint8 tier) external payable nonReentrant whenNotPaused {
        Plan memory plan = _plan(tier);
        require(msg.value == plan.price, "INCORRECT_NATIVE_PAYMENT");
        (bool sent,) = payable(treasury).call{value: msg.value}("");
        require(sent, "TREASURY_TRANSFER_FAILED");
        uint64 expiry = _grant(msg.sender, tier, plan.duration);
        emit Subscribed(msg.sender, tier, plan.price, expiry, true);
    }

    function _plan(uint8 tier) private view returns (Plan memory plan) {
        plan = plans[tier];
        require(plan.enabled, "PLAN_DISABLED");
    }

    function _grant(address account, uint8 tier, uint32 duration) private returns (uint64 expiry) {
        (FlowTierManager.Tier currentTier, uint64 currentExpiry) = tierManager.tierGrant(account);
        require(currentExpiry != type(uint64).max, "PERMANENT_TIER");
        require(currentExpiry < block.timestamp || tier >= uint8(currentTier), "TIER_DOWNGRADE");
        uint64 base = currentExpiry > block.timestamp ? currentExpiry : uint64(block.timestamp);
        expiry = base + duration;
        tierManager.setTierUntil(account, FlowTierManager.Tier(tier), expiry);
    }
}
