// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "../src/C402CreditIntent.sol";

contract C402CreditIntentTest {
    C402CreditIntent private credit;
    address payable private agent = payable(address(0xA11CE));
    address payable private supplier = payable(address(0x5A77));

    function testLenderPaysSupplierDirectlyAndReceivesRepaymentClaim() external {
        credit = new C402CreditIntent(address(this));
        credit.setSupplier("data.example.com", supplier, true);

        bytes32 jobId = keccak256("job-4021");
        bytes32 advanceId = keccak256("advance-4021");
        credit.fundJob{value: 10 ether}(jobId, agent, "eip155:114:0x8004", 4021);

        uint256 supplierBefore = supplier.balance;
        uint256 lenderBefore = address(this).balance;
        uint256 agentBefore = agent.balance;

        credit.paySupplier{value: 1 ether}(jobId, advanceId, "data.example.com", "data");
        assert(supplier.balance == supplierBefore + 1 ether);

        credit.completeJob(jobId, advanceId);
        assert(credit.withdrawable(address(this)) == 1.04 ether);
        assert(credit.withdrawable(agent) == 8.95 ether);
        assert(credit.insuranceReserveBalance() == 0.01 ether);

        credit.withdraw();

        assert(address(this).balance == lenderBefore + 0.04 ether);
        assert(agent.balance == agentBefore);
    }

    function testCompromisedOwnerCannotDrainDormantLenderFunds() external {
        credit = new C402CreditIntent(address(this));

        address payable attacker = payable(address(0xBAD));
        credit.setSupplier("evil.example.com", attacker, true);
        credit.configurePolicy(100 ether, 0, 0, 0);

        bytes32 jobId = keccak256("fake-job");
        bytes32 advanceId = keccak256("fake-advance");
        credit.fundJob{value: 1 ether}(jobId, attacker, "eip155:114:0x8004", 1);

        uint256 attackerBefore = attacker.balance;
        credit.paySupplier{value: 0.5 ether}(jobId, advanceId, "evil.example.com", "data");

        assert(attacker.balance == attackerBefore + 0.5 ether);
        assert(address(credit).balance == 1 ether);
    }

    function testRejectsUnapprovedSupplier() external {
        credit = new C402CreditIntent(address(this));
        bytes32 jobId = keccak256("job-4021");
        credit.fundJob{value: 10 ether}(jobId, agent, "eip155:114:0x8004", 4021);

        (bool ok, ) = address(credit).call{value: 1 ether}(
            abi.encodeWithSelector(credit.paySupplier.selector, jobId, keccak256("advance-4021"), "unknown.example.com", "data")
        );

        assert(!ok);
    }

    receive() external payable {}
}
