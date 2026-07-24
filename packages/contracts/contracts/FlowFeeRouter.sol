// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
contract FlowFeeRouter is AccessControl,Pausable {
    using SafeERC20 for IERC20; bytes32 public constant DISTRIBUTOR_ROLE=keccak256("DISTRIBUTOR_ROLE");
    address public treasury; address public reserve; uint16 public referralShareBps=1_500; uint16 public reserveShareBps=1_000;
    event FeeDistributed(address indexed token,uint256 total,uint256 treasuryAmount,uint256 reserveAmount,uint256 creatorAmount,uint256 referralAmount);
    constructor(address admin,address treasury_,address reserve_){require(admin!=address(0)&&treasury_!=address(0)&&reserve_!=address(0),"ZERO_ADDRESS");treasury=treasury_;reserve=reserve_;_grantRole(DEFAULT_ADMIN_ROLE,admin);}
    function setDestinations(address t,address r) external onlyRole(DEFAULT_ADMIN_ROLE){require(t!=address(0)&&r!=address(0),"ZERO_ADDRESS");treasury=t;reserve=r;}
    function setShares(uint16 referralBps,uint16 reserveBps) external onlyRole(DEFAULT_ADMIN_ROLE){require(uint256(referralBps)+reserveBps<=3_000,"SHARE_CAP");referralShareBps=referralBps;reserveShareBps=reserveBps;}
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE){_pause();} function unpause() external onlyRole(DEFAULT_ADMIN_ROLE){_unpause();}
    function distribute(address token,uint256 amount,address creator,uint16 creatorFeeBps,address referrer) external onlyRole(DISTRIBUTOR_ROLE) whenNotPaused {
        if(amount==0)return; require(uint256(creatorFeeBps)+referralShareBps+reserveShareBps<=10_000,"INVALID_SPLIT"); IERC20 asset=IERC20(token); asset.safeTransferFrom(msg.sender,address(this),amount);
        uint256 creatorAmount=creator==address(0)?0:amount*creatorFeeBps/10_000; uint256 referralAmount=referrer==address(0)?0:amount*referralShareBps/10_000; uint256 reserveAmount=amount*reserveShareBps/10_000; uint256 treasuryAmount=amount-creatorAmount-referralAmount-reserveAmount;
        if(creatorAmount>0)asset.safeTransfer(creator,creatorAmount);if(referralAmount>0)asset.safeTransfer(referrer,referralAmount);if(reserveAmount>0)asset.safeTransfer(reserve,reserveAmount);asset.safeTransfer(treasury,treasuryAmount);
        emit FeeDistributed(token,amount,treasuryAmount,reserveAmount,creatorAmount,referralAmount);
    }
}
