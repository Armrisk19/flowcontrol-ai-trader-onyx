// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
interface IFlowTokenRegistry {
    enum Status { BLOCKED, WATCHLIST, LIMITED, ACTIVE, PAUSED }
    struct TokenConfig { Status status; uint96 maxTradeAmount; uint16 maxSlippageBps; uint8 decimals; bool exists; }
    function getToken(address token) external view returns (TokenConfig memory);
}
