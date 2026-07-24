// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISwapAdapter} from "./interfaces/ISwapAdapter.sol";
import {IFlowTokenRegistry} from "./interfaces/IFlowTokenRegistry.sol";
import {IFlowStrategyRegistry} from "./interfaces/IFlowStrategyRegistry.sol";
import {IFlowFeeRouter} from "./interfaces/IFlowFeeRouter.sol";
import {IFlowVaultFactory} from "./interfaces/IFlowVaultFactory.sol";
import {IFlowTierManager} from "./interfaces/IFlowTierManager.sol";
contract FlowExecutionRouter is AccessControl,Pausable,ReentrancyGuard {
    using SafeERC20 for IERC20; bytes32 public constant ADAPTER_ROLE=keccak256("ADAPTER_ROLE");
    IFlowTokenRegistry public immutable tokenRegistry; IFlowStrategyRegistry public immutable strategyRegistry; IFlowFeeRouter public immutable feeRouter; IFlowTierManager public immutable tierManager; IFlowVaultFactory public vaultFactory;
    mapping(uint8=>uint16) public tierFeeBps; mapping(address=>bool) public approvedAdapters;
    event SwapExecuted(address indexed vault,address indexed tokenIn,address indexed tokenOut,uint256 grossIn,uint256 netIn,uint256 fee,uint256 quote,uint256 minOut,uint256 amountOut,uint256 strategyId,address adapter);
    constructor(address admin,address tokenRegistry_,address strategyRegistry_,address feeRouter_,address tierManager_){require(admin!=address(0)&&tokenRegistry_.code.length>0&&strategyRegistry_.code.length>0&&feeRouter_.code.length>0&&tierManager_.code.length>0,"BAD_INIT");tokenRegistry=IFlowTokenRegistry(tokenRegistry_);strategyRegistry=IFlowStrategyRegistry(strategyRegistry_);feeRouter=IFlowFeeRouter(feeRouter_);tierManager=IFlowTierManager(tierManager_);tierFeeBps[0]=25;tierFeeBps[1]=18;tierFeeBps[2]=10;tierFeeBps[3]=8;tierFeeBps[4]=5;_grantRole(DEFAULT_ADMIN_ROLE,admin);_grantRole(ADAPTER_ROLE,admin);}
    function setVaultFactory(address f) external onlyRole(DEFAULT_ADMIN_ROLE){require(address(vaultFactory)==address(0)&&f.code.length>0,"FACTORY_SET_OR_BAD");vaultFactory=IFlowVaultFactory(f);} function setTierFeeBps(uint8 tier,uint16 feeBps) external onlyRole(DEFAULT_ADMIN_ROLE){require(tier<=4&&feeBps<=50,"FEE_CAP");tierFeeBps[tier]=feeBps;}
    function setAdapter(address a,bool approved) external onlyRole(ADAPTER_ROLE){require(!approved||a.code.length>0,"ADAPTER_NO_CODE");approvedAdapters[a]=approved;} function pause() external onlyRole(DEFAULT_ADMIN_ROLE){_pause();} function unpause() external onlyRole(DEFAULT_ADMIN_ROLE){_unpause();}
    function executeSwap(address adapter,address tokenIn,address tokenOut,uint256 amountIn,uint256 minAmountOut,uint256 strategyId,address referrer,bytes calldata adapterData) external nonReentrant whenNotPaused returns(uint256 amountOut){
        require(address(vaultFactory)!=address(0)&&vaultFactory.isVault(msg.sender),"NOT_VAULT");require(approvedAdapters[adapter],"ADAPTER_NOT_APPROVED");require(tokenIn!=tokenOut&&amountIn>0,"INVALID_SWAP");
        IFlowTokenRegistry.TokenConfig memory inCfg=tokenRegistry.getToken(tokenIn);IFlowTokenRegistry.TokenConfig memory outCfg=tokenRegistry.getToken(tokenOut);require(inCfg.exists&&outCfg.exists,"TOKEN_UNKNOWN");require(_tradable(inCfg.status)&&_tradable(outCfg.status),"TOKEN_NOT_TRADABLE");require(amountIn<=inCfg.maxTradeAmount,"REGISTRY_SIZE_LIMIT");require(strategyRegistry.isActive(strategyId),"STRATEGY_INACTIVE");
        address vaultOwner=vaultFactory.ownerOfVault(msg.sender);uint8 tier=tierManager.tierOf(vaultOwner);require(tier>=strategyRegistry.minimumTier(strategyId),"TIER_TOO_LOW");
        IERC20 input=IERC20(tokenIn);input.safeTransferFrom(msg.sender,address(this),amountIn);uint256 fee=amountIn*tierFeeBps[tier]/10_000;uint256 netIn=amountIn-fee;
        uint256 quoted=ISwapAdapter(adapter).quote(tokenIn,tokenOut,netIn,adapterData);uint16 slip=inCfg.maxSlippageBps<outCfg.maxSlippageBps?inCfg.maxSlippageBps:outCfg.maxSlippageBps;uint256 quoteFloor=quoted*(10_000-slip)/10_000;require(minAmountOut>=quoteFloor&&minAmountOut>0,"MIN_OUT_UNSAFE");
        if(fee>0){input.forceApprove(address(feeRouter),fee);feeRouter.distribute(tokenIn,fee,strategyRegistry.feeRecipient(strategyId),strategyRegistry.creatorFeeBps(strategyId),referrer);input.forceApprove(address(feeRouter),0);} input.forceApprove(adapter,netIn);amountOut=ISwapAdapter(adapter).swap(tokenIn,tokenOut,netIn,minAmountOut,msg.sender,adapterData);input.forceApprove(adapter,0);require(amountOut>=minAmountOut,"INSUFFICIENT_OUTPUT");emit SwapExecuted(msg.sender,tokenIn,tokenOut,amountIn,netIn,fee,quoted,minAmountOut,amountOut,strategyId,adapter);
    }
    function _tradable(IFlowTokenRegistry.Status s) private pure returns(bool){return s==IFlowTokenRegistry.Status.ACTIVE||s==IFlowTokenRegistry.Status.LIMITED;}
}
