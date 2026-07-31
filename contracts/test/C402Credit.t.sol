// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "../src/C402Credit.sol";

contract C402CreditTest {
    C402Credit private credit;
    address payable private agent = payable(address(0xA11CE));
    address payable private supplier = payable(address(0x5A77));

    function testAdvanceAndRepayNativeTestnetAsset() external {
        credit = new C402Credit(address(this));
        credit.depositLenderVault{value: 50 ether}();
        credit.setSupplier("data.example.com", supplier, true);

        bytes32 jobId = keccak256("job-4021");
        bytes32 advanceId = keccak256("advance-4021");
        credit.fundJob{value: 10 ether}(jobId, agent, "eip155:114:0x8004", 4021);

        uint256 supplierBefore = supplier.balance;
        uint256 agentBefore = agent.balance;

        credit.advanceToSupplier(jobId, advanceId, "data.example.com", "data", 1 ether);
        credit.completeJob(jobId, advanceId);

        assert(supplier.balance == supplierBefore + 1 ether);
        assert(agent.balance == agentBefore + 8.95 ether);
        assert(credit.lenderVaultBalance() == 50.04 ether);
        assert(credit.insuranceReserveBalance() == 0.01 ether);
    }

    function testRejectsUnapprovedSupplier() external {
        credit = new C402Credit(address(this));
        credit.depositLenderVault{value: 50 ether}();
        bytes32 jobId = keccak256("job-4021");
        credit.fundJob{value: 10 ether}(jobId, agent, "eip155:114:0x8004", 4021);

        (bool ok, ) = address(credit).call(abi.encodeWithSelector(
            credit.advanceToSupplier.selector,
            jobId,
            keccak256("advance-4021"),
            "unknown.example.com",
            "data",
            1 ether
        ));

        assert(!ok);
    }

    receive() external payable {}
}
