import BendConfig from "../../markets/bend";
import { insertContractAddressInDb, registerContractInJsonDb } from "../../helpers/contracts-helpers";
import {
  deployMockIncentivesController,
  deployBendProxyAdmin,
  deployLendPoolAddressesProviderRegistry,
  deployLendPoolAddressesProvider,
  deployLendPool,
  deployBendUpgradeableProxy,
  deployBNFTRegistry,
  deployGenericBNFTImpl,
  deployBendLibraries,
} from "../../helpers/contracts-deployments";
import { Signer } from "ethers";
import { eContractid, tEthereumAddress, BendPools } from "../../helpers/types";
import { ConfigNames, getTreasuryAddress, loadPoolConfig } from "../../helpers/configuration";
import { waitForTx } from "../../helpers/misc-utils";
import {
  getPoolAdminSigner,
  getEmergencyAdminSigner,
  getBNFTRegistryProxy,
  getLendPool,
} from "../../helpers/contracts-getters";

const buildTestEnv = async (deployer: Signer, secondaryWallet: Signer) => {
  console.time("setup");

  // Admin Account 셋업
  const poolAdmin = await (await getPoolAdminSigner()).getAddress();
  const emergencyAdmin = await (await getEmergencyAdminSigner()).getAddress();
  console.log("Admin accounts:", "poolAdmin:", poolAdmin, "emergencyAdmin:", emergencyAdmin);

  const config = loadPoolConfig(ConfigNames.Bend);
  //////////////////////////////////////////////////////////////////////////////
  console.log("-> Prepare mock external IncentivesController...");
  const mockIncentivesController = await deployMockIncentivesController();
  const incentivesControllerAddress = mockIncentivesController.address;

  //////////////////////////////////////////////////////////////////////////////
  console.log("-> Prepare proxy admin...");
  const bendProxyAdmin = await deployBendProxyAdmin(eContractid.BendProxyAdminTest);
  console.log("bendProxyAdmin:", bendProxyAdmin.address);

  //////////////////////////////////////////////////////////////////////////////
  // !!! MUST BEFORE LendPoolConfigurator which will getBNFTRegistry from address provider when init
  console.log("-> Prepare mock bnft registry...");
  const bnftGenericImpl = await deployGenericBNFTImpl(false);

  const bnftRegistryImpl = await deployBNFTRegistry();
  const initEncodedData = bnftRegistryImpl.interface.encodeFunctionData("initialize", [
    bnftGenericImpl.address,
    config.Mocks.BNftNamePrefix,
    config.Mocks.BNftSymbolPrefix,
  ]);

  const bnftRegistryProxy = await deployBendUpgradeableProxy(
    eContractid.BNFTRegistry,
    bendProxyAdmin.address,
    bnftRegistryImpl.address,
    initEncodedData
  );

  const bnftRegistry = await getBNFTRegistryProxy(bnftRegistryProxy.address);

  await waitForTx(await bnftRegistry.transferOwnership(poolAdmin));

  //////////////////////////////////////////////////////////////////////////////
  console.log("-> Prepare address provider...");
  const addressesProviderRegistry = await deployLendPoolAddressesProviderRegistry();

  const addressesProvider = await deployLendPoolAddressesProvider(BendConfig.MarketId);
  await waitForTx(await addressesProvider.setPoolAdmin(poolAdmin));
  await waitForTx(await addressesProvider.setEmergencyAdmin(emergencyAdmin));

  await waitForTx(
    await addressesProviderRegistry.registerAddressesProvider(addressesProvider.address, BendConfig.ProviderId)
  );

  //////////////////////////////////////////////////////////////////////////////
  // !!! MUST BEFORE LendPoolConfigurator which will getBNFTRegistry from address provider when init
  await waitForTx(await addressesProvider.setBNFTRegistry(bnftRegistry.address));
  await waitForTx(await addressesProvider.setIncentivesController(incentivesControllerAddress));

  //////////////////////////////////////////////////////////////////////////////
  console.log("-> Prepare bend libraries...");
  await deployBendLibraries();

  console.log("-> Prepare lend pool...");
  const lendPoolImpl = await deployLendPool();
  await waitForTx(await addressesProvider.setLendPoolImpl(lendPoolImpl.address, []));
  // configurator will create proxy for implement
  const lendPoolAddress = await addressesProvider.getLendPool();
  const lendPoolProxy = await getLendPool(lendPoolAddress);

  await insertContractAddressInDb(eContractid.LendPool, lendPoolProxy.address);
};
