// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISwapAdapter} from "../interfaces/ISwapAdapter.sol";
interface IV2Factory { function getPair(address,address) external view returns(address); }
interface IV2Router { function factory() external view returns(address); function getAmountsOut(uint256,address[] calldata) external view returns(uint256[] memory); function swapExactTokensForTokens(uint256,uint256,address[] calldata,address,uint256) external returns(uint256[] memory); }
contract OnyxV2Adapter is AccessControl,ReentrancyGuard,ISwapAdapter {
    using SafeERC20 for IERC20; bytes32 public constant CALLER_ROLE=keccak256("CALLER_ROLE"); IV2Router public immutable router; IV2Factory public immutable factory;
    constructor(address admin,address router_,address factory_){require(admin!=address(0)&&router_.code.length>0&&factory_.code.length>0,"BAD_INIT");router=IV2Router(router_);factory=IV2Factory(factory_);require(router.factory()==factory_,"FACTORY_MISMATCH");_grantRole(DEFAULT_ADMIN_ROLE,admin);_grantRole(CALLER_ROLE,admin);}
    function quote(address tokenIn,address tokenOut,uint256 amountIn,bytes calldata data) external view returns(uint256 amountOut){address[] memory path=_path(tokenIn,tokenOut,data);_validate(path);uint256[] memory amounts=router.getAmountsOut(amountIn,path);return amounts[amounts.length-1];}
    function swap(address tokenIn,address tokenOut,uint256 amountIn,uint256 minAmountOut,address recipient,bytes calldata data) external onlyRole(CALLER_ROLE) nonReentrant returns(uint256 amountOut){require(recipient!=address(0),"ZERO_RECIPIENT");address[] memory path=_path(tokenIn,tokenOut,data);_validate(path);IERC20(tokenIn).safeTransferFrom(msg.sender,address(this),amountIn);IERC20(tokenIn).forceApprove(address(router),amountIn);uint256 beforeBal=IERC20(tokenOut).balanceOf(recipient);router.swapExactTokensForTokens(amountIn,minAmountOut,path,recipient,block.timestamp+120);amountOut=IERC20(tokenOut).balanceOf(recipient)-beforeBal;require(amountOut>=minAmountOut,"OUTPUT_TOO_LOW");IERC20(tokenIn).forceApprove(address(router),0);}
    function _path(address tokenIn,address tokenOut,bytes calldata data) private pure returns(address[] memory path){if(data.length==0){path=new address[](2);path[0]=tokenIn;path[1]=tokenOut;}else path=abi.decode(data,(address[]));require(path.length>=2&&path.length<=3,"PATH_LENGTH");require(path[0]==tokenIn&&path[path.length-1]==tokenOut,"PATH_ENDPOINTS");}
    function _validate(address[] memory path) private view {for(uint256 i=0;i+1<path.length;i++){address pair=factory.getPair(path[i],path[i+1]);require(pair!=address(0)&&pair.code.length>0,"PAIR_MISSING");}}
}
