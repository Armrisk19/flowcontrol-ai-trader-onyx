// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
interface IFlowVaultFactory { function isVault(address vault) external view returns (bool); function ownerOfVault(address vault) external view returns (address); }
