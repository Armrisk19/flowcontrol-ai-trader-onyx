import { expect } from "chai"; import { ethers } from "hardhat"; import { time } from "@nomicfoundation/hardhat-network-helpers";
describe("FLOWCONTROL mainnet candidate core",function(){
  async function deploy(){const [admin,user,keeper,treasury,reserve,referrer]=await ethers.getSigners();const E=await ethers.getContractFactory("MockERC20");const usdc=await E.deploy("USD Coin","USDC",6);const xcn=await E.deploy("Wrapped XCN","WXCN",18);const W=await ethers.getContractFactory("MockWrappedNative");const wrapped=await W.deploy();const Tier=await ethers.getContractFactory("FlowTierManager");const tier=await Tier.deploy(admin.address);const Token=await ethers.getContractFactory("FlowTokenRegistry");const token=await Token.deploy(admin.address);const Strategy=await ethers.getContractFactory("FlowStrategyRegistry");const strategy=await Strategy.deploy(admin.address,await tier.getAddress());const Fee=await ethers.getContractFactory("FlowFeeRouter");const fee=await Fee.deploy(admin.address,treasury.address,reserve.address);const Exec=await ethers.getContractFactory("FlowExecutionRouter");const exec=await Exec.deploy(admin.address,await token.getAddress(),await strategy.getAddress(),await fee.getAddress(),await tier.getAddress());const Factory=await ethers.getContractFactory("FlowVaultFactory");const factory=await Factory.deploy(await exec.getAddress(),await wrapped.getAddress());await exec.setVaultFactory(await factory.getAddress());await fee.grantRole(await fee.DISTRIBUTOR_ROLE(),await exec.getAddress());const A=await ethers.getContractFactory("MockSwapAdapter");const adapter=await A.deploy();await exec.setAdapter(await adapter.getAddress(),true);await token.configureToken(await usdc.getAddress(),3,1_000_000_000,100,6);await token.configureToken(await xcn.getAddress(),3,ethers.parseEther("1000000"),100,18);await strategy.submitStrategy("ipfs://official",treasury.address,{reserveBps:7000,rebalanceThresholdBps:1000,maxTradeUsdE6:100_000_000,maxAssets:2,momentumOnly:false,cooldownSeconds:21600,maxTradesPerDay:3});await strategy.reviewStrategy(1,true,0,0);await factory.connect(user).createVault();const vault=await ethers.getContractAt("FlowVault",await factory.vaultOf(user.address));return{admin,user,keeper,treasury,reserve,referrer,usdc,xcn,wrapped,tier,token,strategy,fee,exec,factory,adapter,vault};}
  it("executes a quote-bound fee-bearing swap and preserves owner withdrawals",async()=>{const d=await deploy();await d.vault.connect(d.user).setExecutor(d.keeper.address,(await time.latest())+86400);await d.vault.connect(d.user).setAutomationArmed(true);await d.vault.connect(d.user).setGlobalLimits(60,6);await d.vault.connect(d.user).setTokenPolicy(await d.usdc.getAddress(),true,100_000_000,500_000_000,10_000_000);await d.vault.connect(d.user).setTokenPolicy(await d.xcn.getAddress(),true,ethers.parseEther("10000"),ethers.parseEther("50000"),0);await d.vault.connect(d.user).setStrategyAllowed(1,true);await d.usdc.mint(await d.vault.getAddress(),100_000_000);await d.xcn.mint(await d.adapter.getAddress(),ethers.parseEther("100000"));await expect(d.vault.connect(d.keeper).executeSwap(await d.adapter.getAddress(),await d.usdc.getAddress(),await d.xcn.getAddress(),10_000_000,9_900_000,1,d.referrer.address,"0x")).to.emit(d.exec,"SwapExecuted");expect(await d.xcn.balanceOf(await d.vault.getAddress())).to.equal(9_975_000);await d.vault.connect(d.user).withdraw(await d.xcn.getAddress(),1_000_000,d.user.address);expect(await d.xcn.balanceOf(d.user.address)).to.equal(1_000_000);});
  it("rejects a dangerously low min-out",async()=>{const d=await deploy();await d.vault.connect(d.user).setExecutor(d.keeper.address,(await time.latest())+86400);await d.vault.connect(d.user).setAutomationArmed(true);await d.vault.connect(d.user).setGlobalLimits(60,6);await d.vault.connect(d.user).setTokenPolicy(await d.usdc.getAddress(),true,100_000_000,500_000_000,0);await d.vault.connect(d.user).setTokenPolicy(await d.xcn.getAddress(),true,ethers.parseEther("10000"),ethers.parseEther("50000"),0);await d.vault.connect(d.user).setStrategyAllowed(1,true);await d.usdc.mint(await d.vault.getAddress(),100_000_000);await expect(d.vault.connect(d.keeper).executeSwap(await d.adapter.getAddress(),await d.usdc.getAddress(),await d.xcn.getAddress(),10_000_000,1,1,ethers.ZeroAddress,"0x")).to.be.revertedWith("MIN_OUT_UNSAFE");});
  it("lets the owner revoke automation immediately",async()=>{const d=await deploy();await d.vault.connect(d.user).setExecutor(d.keeper.address,(await time.latest())+86400);await d.vault.connect(d.user).setAutomationArmed(true);await d.vault.connect(d.user).revokeExecutor();expect(await d.vault.automationArmed()).to.equal(false);expect(await d.vault.executor()).to.equal(ethers.ZeroAddress);});
  it("sells expiring XCN memberships without giving the membership contract admin powers",async()=>{
    const d=await deploy();
    const Membership=await ethers.getContractFactory("FlowMembership");
    const membership=await Membership.deploy(d.admin.address,await d.xcn.getAddress(),await d.tier.getAddress(),d.treasury.address);
    await d.tier.grantRole(await d.tier.TIER_ADMIN_ROLE(),await membership.getAddress());
    await membership.configurePlan(1,ethers.parseEther("100"),30*86400,true);
    await d.xcn.mint(d.user.address,ethers.parseEther("100"));
    await d.xcn.connect(d.user).approve(await membership.getAddress(),ethers.parseEther("100"));
    await membership.connect(d.user).subscribe(1);
    expect(await d.tier.tierOf(d.user.address)).to.equal(1);
    expect(await d.xcn.balanceOf(d.treasury.address)).to.equal(ethers.parseEther("100"));
    expect(await membership.hasRole(await membership.DEFAULT_ADMIN_ROLE(),d.user.address)).to.equal(false);
  });

  it("requires Creator tier for public strategy submissions and preserves bounded rules",async()=>{
    const d=await deploy();
    const rules={reserveBps:5000,rebalanceThresholdBps:700,maxTradeUsdE6:250_000_000,maxAssets:4,momentumOnly:true,cooldownSeconds:7200,maxTradesPerDay:6};
    await expect(d.strategy.connect(d.user).submitStrategy("ipfs://creator",d.user.address,rules)).to.be.revertedWith("CREATOR_TIER_REQUIRED");
    await d.tier.setTier(d.user.address,3);
    await expect(d.strategy.connect(d.user).submitStrategy("ipfs://creator",d.user.address,rules)).to.emit(d.strategy,"StrategySubmitted");
    const stored=await d.strategy.getRules(2);
    expect(stored.maxAssets).to.equal(4);
    expect(await d.strategy.isActive(2)).to.equal(false);
  });

  it("configures token policies in a bounded batch and arms one selected strategy",async()=>{
    const d=await deploy();
    const expiry=(await time.latest())+86400;
    await d.vault.connect(d.user).setTokenPolicies(
      [await d.usdc.getAddress(),await d.xcn.getAddress()],
      [true,true],[100_000_000,ethers.parseEther("10000")],
      [500_000_000,ethers.parseEther("50000")],[10_000_000,0]
    );
    await d.vault.connect(d.user).configureAutomation(1,3600,6,d.keeper.address,expiry);
    expect(await d.vault.automationArmed()).to.equal(true);
    expect(await d.vault.strategyAllowed(1)).to.equal(true);
    expect(await d.vault.tokenAllowed(await d.xcn.getAddress())).to.equal(true);
  });

});
