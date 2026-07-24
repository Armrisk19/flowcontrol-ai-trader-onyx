// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IFlowTokenRegistry} from "./interfaces/IFlowTokenRegistry.sol";
contract FlowTokenRegistry is AccessControl, IFlowTokenRegistry {
    bytes32 public constant REGISTRY_ROLE = keccak256("REGISTRY_ROLE");
    mapping(address => TokenConfig) private _tokens;
    address[] private _listed;
    event TokenConfigured(address indexed token, Status status, uint96 maxTradeAmount, uint16 maxSlippageBps, uint8 decimals);
    constructor(address admin) { require(admin != address(0), "ZERO_ADMIN"); _grantRole(DEFAULT_ADMIN_ROLE, admin); _grantRole(REGISTRY_ROLE, admin); }
    function configureToken(address token,Status status,uint96 maxTradeAmount,uint16 maxSlippageBps,uint8 decimals) external onlyRole(REGISTRY_ROLE) {
        require(token.code.length > 0, "TOKEN_NO_CODE"); require(maxSlippageBps <= 500, "SLIPPAGE_CAP"); require(decimals <= 18, "DECIMALS");
        if (!_tokens[token].exists) _listed.push(token);
        _tokens[token] = TokenConfig(status,maxTradeAmount,maxSlippageBps,decimals,true);
        emit TokenConfigured(token,status,maxTradeAmount,maxSlippageBps,decimals);
    }
    function getToken(address token) external view returns (TokenConfig memory) { return _tokens[token]; }
    function listedTokens() external view returns (address[] memory) { return _listed; }
}
