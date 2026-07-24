// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
interface IFlowFeeRouter { function distribute(address token,uint256 amount,address creator,uint16 creatorFeeBps,address referrer) external; }
