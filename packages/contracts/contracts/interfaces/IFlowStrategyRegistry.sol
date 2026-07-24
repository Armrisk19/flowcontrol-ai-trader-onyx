// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
interface IFlowStrategyRegistry {
    function feeRecipient(uint256 strategyId) external view returns (address);
    function creatorFeeBps(uint256 strategyId) external view returns (uint16);
    function minimumTier(uint256 strategyId) external view returns (uint8);
    function isActive(uint256 strategyId) external view returns (bool);
}
