// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IExecutionRouter {
    function executeSwap(address,address,address,uint256,uint256,uint256,address,bytes calldata) external returns (uint256);
}
interface IWrappedNative is IERC20 {
    function deposit() external payable;
    function withdraw(uint256) external;
}

contract FlowVault is Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public immutable owner;
    address public immutable executionRouter;
    address public immutable wrappedNative;

    address public executor;
    uint64 public executorExpiry;
    uint32 public cooldownSeconds = 3600;
    uint64 public lastTradeAt;
    bool public automationArmed;
    uint16 public maxTradesPerDay = 6;

    mapping(uint256 => uint16) public tradesByDay;
    mapping(address => bool) public tokenAllowed;
    mapping(address => uint256) public maxTradeAmount;
    mapping(address => uint256) public dailySpendCap;
    mapping(address => uint256) public minimumReserve;
    mapping(address => mapping(uint256 => uint256)) public spentByDay;
    mapping(uint256 => bool) public strategyAllowed;

    event ExecutorSet(address indexed executor, uint64 expiry);
    event AutomationArmed(bool armed);
    event TokenPolicySet(address indexed token, bool allowed, uint256 maxTradeAmount, uint256 dailySpendCap, uint256 minimumReserve);
    event StrategyAllowed(uint256 indexed strategyId, bool allowed);
    event SwapRequested(address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut, uint256 strategyId, address indexed caller);
    event Withdrawn(address indexed token, uint256 amount, address indexed recipient);
    event NativeDeposited(uint256 amount);
    event NativeWithdrawn(uint256 amount, address indexed recipient);

    modifier onlyOwner() {
        require(msg.sender == owner, "ONLY_OWNER");
        _;
    }

    modifier trader() {
        require(
            msg.sender == owner || (msg.sender == executor && block.timestamp <= executorExpiry && automationArmed),
            "TRADER_UNAUTHORIZED"
        );
        _;
    }

    constructor(address owner_, address router_, address wrappedNative_) {
        require(owner_ != address(0) && router_.code.length > 0 && wrappedNative_.code.length > 0, "BAD_INIT");
        owner = owner_;
        executionRouter = router_;
        wrappedNative = wrappedNative_;
    }

    function setExecutor(address executor_, uint64 expiry) external onlyOwner {
        _setExecutor(executor_, expiry);
    }

    function revokeExecutor() external onlyOwner {
        executor = address(0);
        executorExpiry = 0;
        automationArmed = false;
        emit ExecutorSet(address(0), 0);
        emit AutomationArmed(false);
    }

    function setAutomationArmed(bool armed) external onlyOwner {
        require(!armed || (executor != address(0) && block.timestamp <= executorExpiry), "EXECUTOR_INACTIVE");
        automationArmed = armed;
        emit AutomationArmed(armed);
    }

    function setGlobalLimits(uint32 cooldown, uint16 tradesPerDay) external onlyOwner {
        _setGlobalLimits(cooldown, tradesPerDay);
    }

    function setTokenPolicy(address token, bool allowed, uint256 perTrade, uint256 perDay, uint256 reserve) external onlyOwner {
        _setTokenPolicy(token, allowed, perTrade, perDay, reserve);
    }

    function setTokenPolicies(
        address[] calldata tokens,
        bool[] calldata allowed,
        uint256[] calldata perTrade,
        uint256[] calldata perDay,
        uint256[] calldata reserve
    ) external onlyOwner {
        uint256 length = tokens.length;
        require(length > 0 && length <= 32, "POLICY_BATCH_RANGE");
        require(allowed.length == length && perTrade.length == length && perDay.length == length && reserve.length == length, "ARRAY_LENGTH");
        for (uint256 i = 0; i < length; i++) {
            _setTokenPolicy(tokens[i], allowed[i], perTrade[i], perDay[i], reserve[i]);
        }
    }

    function setStrategyAllowed(uint256 id, bool allowed) external onlyOwner {
        require(id > 0, "BAD_STRATEGY");
        strategyAllowed[id] = allowed;
        emit StrategyAllowed(id, allowed);
    }

    /** One owner transaction configures limits, strategy, executor, and automation. */
    function configureAutomation(
        uint256 strategyId,
        uint32 cooldown,
        uint16 tradesPerDay,
        address executor_,
        uint64 expiry
    ) external onlyOwner whenNotPaused {
        require(strategyId > 0, "BAD_STRATEGY");
        strategyAllowed[strategyId] = true;
        emit StrategyAllowed(strategyId, true);
        _setGlobalLimits(cooldown, tradesPerDay);
        _setExecutor(executor_, expiry);
        automationArmed = true;
        emit AutomationArmed(true);
    }

    function pause() external onlyOwner {
        automationArmed = false;
        _pause();
        emit AutomationArmed(false);
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function executeSwap(
        address adapter,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 strategyId,
        address referrer,
        bytes calldata adapterData
    ) external trader whenNotPaused nonReentrant returns (uint256 amountOut) {
        require(strategyAllowed[strategyId], "STRATEGY_NOT_ALLOWED");
        require(tokenAllowed[tokenIn] && tokenAllowed[tokenOut], "TOKEN_NOT_ALLOWED");
        require(amountIn <= maxTradeAmount[tokenIn], "VAULT_SIZE_LIMIT");
        require(IERC20(tokenIn).balanceOf(address(this)) >= amountIn + minimumReserve[tokenIn], "RESERVE_REQUIRED");
        require(block.timestamp >= uint256(lastTradeAt) + cooldownSeconds, "COOLDOWN");

        uint256 day = block.timestamp / 1 days;
        require(tradesByDay[day] < maxTradesPerDay, "DAILY_TRADE_CAP");
        uint256 newSpent = spentByDay[tokenIn][day] + amountIn;
        require(newSpent <= dailySpendCap[tokenIn], "DAILY_SPEND_CAP");

        spentByDay[tokenIn][day] = newSpent;
        tradesByDay[day] += 1;
        lastTradeAt = uint64(block.timestamp);
        amountOut = IExecutionRouter(executionRouter).executeSwap(
            adapter, tokenIn, tokenOut, amountIn, minAmountOut, strategyId, referrer, adapterData
        );
        emit SwapRequested(tokenIn, tokenOut, amountIn, amountOut, strategyId, msg.sender);
    }

    function depositNative() external payable onlyOwner nonReentrant {
        require(msg.value > 0, "ZERO_VALUE");
        IWrappedNative(wrappedNative).deposit{value: msg.value}();
        emit NativeDeposited(msg.value);
    }

    function withdrawNative(uint256 amount, address payable recipient) external onlyOwner nonReentrant {
        require(recipient != address(0), "ZERO_RECIPIENT");
        IWrappedNative(wrappedNative).withdraw(amount);
        (bool ok,) = recipient.call{value: amount}("");
        require(ok, "NATIVE_TRANSFER_FAILED");
        emit NativeWithdrawn(amount, recipient);
    }

    function withdraw(address token, uint256 amount, address recipient) external onlyOwner nonReentrant {
        require(recipient != address(0), "ZERO_RECIPIENT");
        IERC20(token).safeTransfer(recipient, amount);
        emit Withdrawn(token, amount, recipient);
    }

    function _setExecutor(address executor_, uint64 expiry) private {
        require(executor_ != address(0) && expiry > block.timestamp && expiry <= block.timestamp + 90 days, "INVALID_EXECUTOR");
        executor = executor_;
        executorExpiry = expiry;
        automationArmed = false;
        emit ExecutorSet(executor_, expiry);
        emit AutomationArmed(false);
    }

    function _setGlobalLimits(uint32 cooldown, uint16 tradesPerDay) private {
        require(cooldown >= 60 && cooldown <= 1 days, "COOLDOWN_RANGE");
        require(tradesPerDay >= 1 && tradesPerDay <= 48, "TRADE_COUNT_RANGE");
        cooldownSeconds = cooldown;
        maxTradesPerDay = tradesPerDay;
    }

    function _setTokenPolicy(address token, bool allowed, uint256 perTrade, uint256 perDay, uint256 reserve) private {
        require(token.code.length > 0, "TOKEN_NO_CODE");
        require(!allowed || (perTrade > 0 && perDay >= perTrade), "INVALID_LIMITS");
        tokenAllowed[token] = allowed;
        maxTradeAmount[token] = perTrade;
        dailySpendCap[token] = perDay;
        minimumReserve[token] = reserve;
        IERC20(token).forceApprove(executionRouter, allowed ? type(uint256).max : 0);
        emit TokenPolicySet(token, allowed, perTrade, perDay, reserve);
    }

    receive() external payable {
        require(msg.sender == wrappedNative, "DIRECT_NATIVE_DISABLED");
    }
}
