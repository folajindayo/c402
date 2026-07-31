// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

contract C402Credit {
    enum JobStatus {
        None,
        Funded,
        Settled,
        Failed
    }

    enum AdvanceStatus {
        None,
        Advanced,
        Repaid,
        Defaulted
    }

    struct Job {
        address buyer;
        address payable agent;
        uint256 escrowAmount;
        JobStatus status;
        bytes32 agentRegistryHash;
        uint256 agentId;
    }

    struct Advance {
        bytes32 jobId;
        address payable supplier;
        uint256 amount;
        uint256 fee;
        uint256 reserve;
        AdvanceStatus status;
        bytes32 purposeHash;
        bytes32 supplierDomainHash;
    }

    address public owner;
    uint256 public lenderVaultBalance;
    uint256 public insuranceReserveBalance;
    uint256 public maxAdvance = 15 ether;
    uint256 public minGrossMarginBps = 3000;
    uint256 public feeBps = 500;
    uint256 public reserveBpsOfFee = 2000;

    mapping(bytes32 => Job) public jobs;
    mapping(bytes32 => Advance) public advances;
    mapping(bytes32 => address payable) public allowedSuppliers;

    event OwnershipTransferred(address indexed previousOwner, address indexed nextOwner);
    event LenderDeposited(address indexed lender, uint256 amount);
    event JobFunded(bytes32 indexed jobId, address indexed buyer, address indexed agent, uint256 escrowAmount, bytes32 agentRegistryHash, uint256 agentId);
    event SupplierSet(bytes32 indexed supplierDomainHash, address indexed supplier, bool allowed);
    event CreditAdvanced(bytes32 indexed advanceId, bytes32 indexed jobId, address indexed supplier, uint256 amount, uint256 fee);
    event JobSettled(bytes32 indexed jobId, bytes32 indexed advanceId, uint256 principal, uint256 fee, uint256 reserve, uint256 agentProceeds);
    event JobFailed(bytes32 indexed jobId, bytes32 indexed advanceId);

    error NotOwner();
    error InvalidAmount();
    error JobExists();
    error JobNotFunded();
    error AdvanceExists();
    error AdvanceNotAdvanced();
    error SupplierNotAllowed();
    error InsufficientVaultLiquidity();
    error AdvanceTooLarge();
    error GrossMarginTooLow();
    error TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address initialOwner) {
        owner = initialOwner == address(0) ? msg.sender : initialOwner;
        emit OwnershipTransferred(address(0), owner);
    }

    receive() external payable {
        depositLenderVault();
    }

    function transferOwnership(address nextOwner) external onlyOwner {
        owner = nextOwner;
        emit OwnershipTransferred(msg.sender, nextOwner);
    }

    function configurePolicy(uint256 nextMaxAdvance, uint256 nextMinGrossMarginBps, uint256 nextFeeBps, uint256 nextReserveBpsOfFee) external onlyOwner {
        maxAdvance = nextMaxAdvance;
        minGrossMarginBps = nextMinGrossMarginBps;
        feeBps = nextFeeBps;
        reserveBpsOfFee = nextReserveBpsOfFee;
    }

    function depositLenderVault() public payable {
        if (msg.value == 0) revert InvalidAmount();
        lenderVaultBalance += msg.value;
        emit LenderDeposited(msg.sender, msg.value);
    }

    function fundJob(bytes32 jobId, address payable agent, string calldata agentRegistry, uint256 agentId) external payable {
        if (msg.value == 0) revert InvalidAmount();
        if (jobs[jobId].status != JobStatus.None) revert JobExists();

        bytes32 agentRegistryHash = keccak256(bytes(agentRegistry));
        jobs[jobId] = Job({
            buyer: msg.sender,
            agent: agent,
            escrowAmount: msg.value,
            status: JobStatus.Funded,
            agentRegistryHash: agentRegistryHash,
            agentId: agentId
        });
        emit JobFunded(jobId, msg.sender, agent, msg.value, agentRegistryHash, agentId);
    }

    function setSupplier(string calldata supplierDomain, address payable supplier, bool allowed) external onlyOwner {
        bytes32 supplierDomainHash = keccak256(bytes(supplierDomain));
        allowedSuppliers[supplierDomainHash] = allowed ? supplier : payable(address(0));
        emit SupplierSet(supplierDomainHash, supplier, allowed);
    }

    function advanceToSupplier(bytes32 jobId, bytes32 advanceId, string calldata supplierDomain, string calldata purpose, uint256 amount) external onlyOwner {
        Job storage job = jobs[jobId];
        if (job.status != JobStatus.Funded) revert JobNotFunded();
        if (advances[advanceId].status != AdvanceStatus.None) revert AdvanceExists();

        bytes32 supplierDomainHash = keccak256(bytes(supplierDomain));
        address payable supplier = allowedSuppliers[supplierDomainHash];
        if (supplier == address(0)) revert SupplierNotAllowed();
        if (amount == 0) revert InvalidAmount();
        if (amount > maxAdvance) revert AdvanceTooLarge();

        uint256 fee = (amount * feeBps) / 10_000;
        uint256 requiredRevenue = amount + fee;
        if (requiredRevenue >= job.escrowAmount) revert AdvanceTooLarge();

        uint256 marginBps = ((job.escrowAmount - requiredRevenue) * 10_000) / job.escrowAmount;
        if (marginBps < minGrossMarginBps) revert GrossMarginTooLow();
        if (amount > lenderVaultBalance) revert InsufficientVaultLiquidity();

        lenderVaultBalance -= amount;
        advances[advanceId] = Advance({
            jobId: jobId,
            supplier: supplier,
            amount: amount,
            fee: fee,
            reserve: (fee * reserveBpsOfFee) / 10_000,
            status: AdvanceStatus.Advanced,
            purposeHash: keccak256(bytes(purpose)),
            supplierDomainHash: supplierDomainHash
        });

        (bool ok, ) = supplier.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit CreditAdvanced(advanceId, jobId, supplier, amount, fee);
    }

    function completeJob(bytes32 jobId, bytes32 advanceId) external onlyOwner {
        Job storage job = jobs[jobId];
        Advance storage advance = advances[advanceId];
        if (job.status != JobStatus.Funded) revert JobNotFunded();
        if (advance.status != AdvanceStatus.Advanced || advance.jobId != jobId) revert AdvanceNotAdvanced();

        uint256 principal = advance.amount;
        uint256 fee = advance.fee;
        uint256 reserve = advance.reserve;
        uint256 agentProceeds = job.escrowAmount - principal - fee;

        lenderVaultBalance += principal + fee - reserve;
        insuranceReserveBalance += reserve;
        job.status = JobStatus.Settled;
        advance.status = AdvanceStatus.Repaid;

        (bool ok, ) = job.agent.call{value: agentProceeds}("");
        if (!ok) revert TransferFailed();
        emit JobSettled(jobId, advanceId, principal, fee, reserve, agentProceeds);
    }

    function failJob(bytes32 jobId, bytes32 advanceId) external onlyOwner {
        Job storage job = jobs[jobId];
        if (job.status != JobStatus.Funded) revert JobNotFunded();
        job.status = JobStatus.Failed;

        Advance storage advance = advances[advanceId];
        if (advance.status == AdvanceStatus.Advanced && advance.jobId == jobId) {
            advance.status = AdvanceStatus.Defaulted;
        }
        emit JobFailed(jobId, advanceId);
    }

    function withdrawReserve(address payable recipient, uint256 amount) external onlyOwner {
        if (amount > insuranceReserveBalance) revert InvalidAmount();
        insuranceReserveBalance -= amount;
        (bool ok, ) = recipient.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
