// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {FlowVault} from "./FlowVault.sol";
contract FlowVaultFactory { address public immutable executionRouter; address public immutable wrappedNative; mapping(address=>address) public vaultOf; mapping(address=>bool) public isVault; mapping(address=>address) public ownerOfVault; event VaultCreated(address indexed owner,address indexed vault);
    constructor(address router,address wrapped){require(router.code.length>0&&wrapped.code.length>0,"BAD_INIT");executionRouter=router;wrappedNative=wrapped;}
    function createVault() external returns(address vault){require(vaultOf[msg.sender]==address(0),"VAULT_EXISTS");bytes32 salt=keccak256(abi.encodePacked(msg.sender));vault=address(new FlowVault{salt:salt}(msg.sender,executionRouter,wrappedNative));vaultOf[msg.sender]=vault;isVault[vault]=true;ownerOfVault[vault]=msg.sender;emit VaultCreated(msg.sender,vault);} function predictVault(address owner) external view returns(address predicted){bytes32 salt=keccak256(abi.encodePacked(owner));bytes memory creation=abi.encodePacked(type(FlowVault).creationCode,abi.encode(owner,executionRouter,wrappedNative));bytes32 hash=keccak256(abi.encodePacked(bytes1(0xff),address(this),salt,keccak256(creation)));predicted=address(uint160(uint256(hash)));}
}
