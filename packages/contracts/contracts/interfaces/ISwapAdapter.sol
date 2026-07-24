// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
interface ISwapAdapter {
    function quote(address tokenIn,address tokenOut,uint256 amountIn,bytes calldata data) external view returns (uint256 amountOut);
    function swap(address tokenIn,address tokenOut,uint256 amountIn,uint256 minAmountOut,address recipient,bytes calldata data) external returns (uint256 amountOut);
}
