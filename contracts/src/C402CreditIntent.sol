// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Safer c402 Credit primitive where lenders fund one approved supplier
/// payment at a time. The contract never holds a pooled lender vault.
contract C402CreditIntent {
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
        address payable lender;
        address payable supplier;
        uint256 amount;
        uint256 fee;
        uint256 reserve;
        AdvanceStatus status;
        bytes32 purposeHash;
        bytes32 supplierDomainHash;
    }

    address public owner;
    uint256 public insuranceReserveBalance;
    uint256 public maxAdvance = 15 ether;
    uint256 public minGrossMarginBps = 3000;
    uint256 public feeBps = 500;
    uint256 public reserveBpsOfFee = 2000;
    bool public paused;

    mapping(bytes32 => Job) public jobs;
    mapping(bytes32 => Advance) public advances;
    mapping(bytes32 => address payable) public allowedSuppliers;
    mapping(address => uint256) public withdrawable;

    uint256 private locked = 1;

    event OwnershipTransferred(address indexed previousOwner, address indexed nextOwner);
    event Paused(bool paused);
    event JobFunded(bytes32 indexed jobId, address indexed buyer, address indexed agent, uint256 escrowAmount, bytes32 agentRegistryHash, uint256 agentId);
    event SupplierSet(bytes32 indexed supplierDomainHash, address indexed supplier, bool allowed);
    event SupplierPaid(bytes32 indexed advanceId, bytes32 indexed jobId, address indexed lender, address supplier, uint256 amount, uint256 fee);
    event JobSettled(bytes32 indexed jobId, bytes32 indexed advanceId, uint256 principal, uint256 fee, uint256 reserve, uint256 agentProceeds);
    event JobFailed(bytes32 indexed jobId, bytes32 indexed advanceId);
    event Withdrawn(address indexed recipient, uint256 amount);

    error NotOwner();
    error PausedError();
    error ReentrantCall();
    error InvalidAmount();
    error JobExists();
    error JobNotFunded();
    error AdvanceExists();
    error AdvanceNotAdvanced();
    error SupplierNotAllowed();
    error AdvanceTooLarge();
    error GrossMarginTooLow();
    error TransferFailed();

    modifier onlyOwner() {
        _onlyOwner();
        _;
    }

    modifier whenNotPaused() {
        _whenNotPaused();
        _;
    }

    modifier nonReentrant() {
        _nonReentrantBefore();
        _;
        _nonReentrantAfter();
    }

    function _onlyOwner() internal view {
        if (msg.sender != owner) revert NotOwner();
    }

    function _whenNotPaused() internal view {
        if (paused) revert PausedError();
    }

    function _nonReentrantBefore() internal {
        if (locked != 1) revert ReentrantCall();
        locked = 2;
    }

    function _nonReentrantAfter() internal {
        locked = 1;
    }

    constructor(address initialOwner) {
        owner = initialOwner == address(0) ? msg.sender : initialOwner;
        emit OwnershipTransferred(address(0), owner);
    }

    function transferOwnership(address nextOwner) external onlyOwner {
        owner = nextOwner;
        emit OwnershipTransferred(msg.sender, nextOwner);
    }

    function setPaused(bool nextPaused) external onlyOwner {
        paused = nextPaused;
        emit Paused(nextPaused);
    }

    function configurePolicy(uint256 nextMaxAdvance, uint256 nextMinGrossMarginBps, uint256 nextFeeBps, uint256 nextReserveBpsOfFee) external onlyOwner {
        if (nextMinGrossMarginBps > 10_000 || nextFeeBps > 10_000 || nextReserveBpsOfFee > 10_000) revert InvalidAmount();
        maxAdvance = nextMaxAdvance;
        minGrossMarginBps = nextMinGrossMarginBps;
        feeBps = nextFeeBps;
        reserveBpsOfFee = nextReserveBpsOfFee;
    }

    function fundJob(bytes32 jobId, address payable agent, string calldata agentRegistry, uint256 agentId) external payable whenNotPaused {
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

    /// @notice The lender calls this with msg.value. Funds move directly from
    /// the lender's wallet to the approved supplier, while the contract records
    /// a first-repayment claim against the funded job.
    function paySupplier(bytes32 jobId, bytes32 advanceId, string calldata supplierDomain, string calldata purpose) external payable whenNotPaused nonReentrant {
        Job storage job = jobs[jobId];
        if (job.status != JobStatus.Funded) revert JobNotFunded();
        if (advances[advanceId].status != AdvanceStatus.None) revert AdvanceExists();

        bytes32 supplierDomainHash = keccak256(bytes(supplierDomain));
        address payable supplier = allowedSuppliers[supplierDomainHash];
        if (supplier == address(0)) revert SupplierNotAllowed();
        if (msg.value == 0) revert InvalidAmount();
        if (msg.value > maxAdvance) revert AdvanceTooLarge();

        uint256 fee = (msg.value * feeBps) / 10_000;
        uint256 requiredRevenue = msg.value + fee;
        if (requiredRevenue >= job.escrowAmount) revert AdvanceTooLarge();

        uint256 marginBps = ((job.escrowAmount - requiredRevenue) * 10_000) / job.escrowAmount;
        if (marginBps < minGrossMarginBps) revert GrossMarginTooLow();

        advances[advanceId] = Advance({
            jobId: jobId,
            lender: payable(msg.sender),
            supplier: supplier,
            amount: msg.value,
            fee: fee,
            reserve: (fee * reserveBpsOfFee) / 10_000,
            status: AdvanceStatus.Advanced,
            purposeHash: keccak256(bytes(purpose)),
            supplierDomainHash: supplierDomainHash
        });

        (bool ok, ) = supplier.call{value: msg.value}("");
        if (!ok) revert TransferFailed();
        emit SupplierPaid(advanceId, jobId, msg.sender, supplier, msg.value, fee);
    }

    function completeJob(bytes32 jobId, bytes32 advanceId) external onlyOwner nonReentrant {
        Job storage job = jobs[jobId];
        Advance storage advance = advances[advanceId];
        if (job.status != JobStatus.Funded) revert JobNotFunded();
        if (advance.status != AdvanceStatus.Advanced || advance.jobId != jobId) revert AdvanceNotAdvanced();

        uint256 principal = advance.amount;
        uint256 fee = advance.fee;
        uint256 reserve = advance.reserve;
        uint256 agentProceeds = job.escrowAmount - principal - fee;

        job.status = JobStatus.Settled;
        advance.status = AdvanceStatus.Repaid;
        insuranceReserveBalance += reserve;
        withdrawable[advance.lender] += principal + fee - reserve;
        withdrawable[job.agent] += agentProceeds;

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

    function withdraw() external nonReentrant {
        uint256 amount = withdrawable[msg.sender];
        if (amount == 0) revert InvalidAmount();
        withdrawable[msg.sender] = 0;
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Withdrawn(msg.sender, amount);
    }
}
