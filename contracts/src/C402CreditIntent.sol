// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

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
        address token;
        uint256 collateralAmount;
        uint256 lockedCollateral;
        address payable collateralPledger;
        JobStatus status;
        bytes32 agentRegistryHash;
        uint256 agentId;
    }

    struct Advance {
        bytes32 jobId;
        address payable lender;
        address payable supplier;
        address token;
        uint256 amount;
        uint256 fee;
        uint256 reserve;
        uint256 collateralLocked;
        uint256 deadline;
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
    uint256 public minCollateralBps = 2000;
    bool public paused;

    mapping(bytes32 => Job) public jobs;
    mapping(bytes32 => Advance) public advances;
    mapping(bytes32 => address payable) public allowedSuppliers;
    mapping(address => uint256) public withdrawable;
    mapping(address => mapping(address => uint256)) public withdrawableToken;

    uint256 private locked = 1;

    event OwnershipTransferred(address indexed previousOwner, address indexed nextOwner);
    event Paused(bool paused);
    event JobFunded(bytes32 indexed jobId, address indexed buyer, address indexed agent, uint256 escrowAmount, bytes32 agentRegistryHash, uint256 agentId);
    event TokenJobFunded(bytes32 indexed jobId, address indexed token, address indexed buyer, address agent, uint256 escrowAmount, bytes32 agentRegistryHash, uint256 agentId);
    event CollateralPosted(bytes32 indexed jobId, address indexed pledgor, uint256 amount, uint256 totalCollateral);
    event TokenCollateralPosted(bytes32 indexed jobId, address indexed token, address indexed pledgor, uint256 amount, uint256 totalCollateral);
    event SupplierSet(bytes32 indexed supplierDomainHash, address indexed supplier, bool allowed);
    event SupplierPaid(bytes32 indexed advanceId, bytes32 indexed jobId, address indexed lender, address supplier, uint256 amount, uint256 fee, uint256 collateralLocked, uint256 deadline);
    event TokenSupplierPaid(bytes32 indexed advanceId, bytes32 indexed jobId, address indexed token, address lender, address supplier, uint256 amount, uint256 fee, uint256 collateralLocked, uint256 deadline);
    event JobSettled(bytes32 indexed jobId, bytes32 indexed advanceId, uint256 principal, uint256 fee, uint256 reserve, uint256 agentProceeds);
    event JobFailed(bytes32 indexed jobId, bytes32 indexed advanceId);
    event CollateralLiquidated(bytes32 indexed jobId, bytes32 indexed advanceId, address indexed lender, uint256 collateralPaid, uint256 reservePaid, uint256 shortfall);
    event Withdrawn(address indexed recipient, uint256 amount);
    event TokenWithdrawn(address indexed token, address indexed recipient, uint256 amount);

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
    error CollateralInsufficient();
    error AdvanceNotMatured();
    error AdvanceNotLiquidatable();
    error TransferFailed();
    error AssetMismatch();

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

    function configurePolicy(uint256 nextMaxAdvance, uint256 nextMinGrossMarginBps, uint256 nextFeeBps, uint256 nextReserveBpsOfFee, uint256 nextMinCollateralBps) external onlyOwner {
        if (nextMinGrossMarginBps > 10_000 || nextFeeBps > 10_000 || nextReserveBpsOfFee > 10_000 || nextMinCollateralBps > 10_000) revert InvalidAmount();
        maxAdvance = nextMaxAdvance;
        minGrossMarginBps = nextMinGrossMarginBps;
        feeBps = nextFeeBps;
        reserveBpsOfFee = nextReserveBpsOfFee;
        minCollateralBps = nextMinCollateralBps;
    }

    function fundJob(bytes32 jobId, address payable agent, string calldata agentRegistry, uint256 agentId) external payable whenNotPaused {
        if (msg.value == 0) revert InvalidAmount();
        if (jobs[jobId].status != JobStatus.None) revert JobExists();

        bytes32 agentRegistryHash = keccak256(bytes(agentRegistry));
        jobs[jobId] = Job({
            buyer: msg.sender,
            agent: agent,
            escrowAmount: msg.value,
            token: address(0),
            collateralAmount: 0,
            lockedCollateral: 0,
            collateralPledger: payable(address(0)),
            status: JobStatus.Funded,
            agentRegistryHash: agentRegistryHash,
            agentId: agentId
        });
        emit JobFunded(jobId, msg.sender, agent, msg.value, agentRegistryHash, agentId);
    }

    function fundJobToken(bytes32 jobId, address token, uint256 amount, address payable agent, string calldata agentRegistry, uint256 agentId) external whenNotPaused {
        if (token == address(0) || amount == 0) revert InvalidAmount();
        if (jobs[jobId].status != JobStatus.None) revert JobExists();
        _safeTransferFrom(token, msg.sender, address(this), amount);

        bytes32 agentRegistryHash = keccak256(bytes(agentRegistry));
        jobs[jobId] = Job({
            buyer: msg.sender,
            agent: agent,
            escrowAmount: amount,
            token: token,
            collateralAmount: 0,
            lockedCollateral: 0,
            collateralPledger: payable(address(0)),
            status: JobStatus.Funded,
            agentRegistryHash: agentRegistryHash,
            agentId: agentId
        });
        emit TokenJobFunded(jobId, token, msg.sender, agent, amount, agentRegistryHash, agentId);
    }

    function postCollateral(bytes32 jobId) external payable whenNotPaused {
        Job storage job = jobs[jobId];
        if (job.status != JobStatus.Funded) revert JobNotFunded();
        if (job.token != address(0)) revert AssetMismatch();
        if (msg.value == 0) revert InvalidAmount();
        if (job.collateralPledger == address(0)) {
            job.collateralPledger = payable(msg.sender);
        }
        job.collateralAmount += msg.value;
        emit CollateralPosted(jobId, msg.sender, msg.value, job.collateralAmount);
    }

    function postCollateralToken(bytes32 jobId, uint256 amount) external whenNotPaused {
        Job storage job = jobs[jobId];
        if (job.status != JobStatus.Funded) revert JobNotFunded();
        if (job.token == address(0) || amount == 0) revert InvalidAmount();
        _safeTransferFrom(job.token, msg.sender, address(this), amount);
        if (job.collateralPledger == address(0)) {
            job.collateralPledger = payable(msg.sender);
        }
        job.collateralAmount += amount;
        emit TokenCollateralPosted(jobId, job.token, msg.sender, amount, job.collateralAmount);
    }

    function setSupplier(string calldata supplierDomain, address payable supplier, bool allowed) external onlyOwner {
        bytes32 supplierDomainHash = keccak256(bytes(supplierDomain));
        allowedSuppliers[supplierDomainHash] = allowed ? supplier : payable(address(0));
        emit SupplierSet(supplierDomainHash, supplier, allowed);
    }

    /// @notice The lender calls this with msg.value. Funds move directly from
    /// the lender's wallet to the approved supplier, while the contract records
    /// a first-repayment claim against the funded job.
    function paySupplier(bytes32 jobId, bytes32 advanceId, string calldata supplierDomain, string calldata purpose, uint256 durationSeconds) external payable whenNotPaused nonReentrant {
        Job storage job = jobs[jobId];
        if (job.status != JobStatus.Funded) revert JobNotFunded();
        if (job.token != address(0)) revert AssetMismatch();
        if (advances[advanceId].status != AdvanceStatus.None) revert AdvanceExists();
        if (durationSeconds == 0) revert InvalidAmount();

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
        uint256 collateralRequired = (msg.value * minCollateralBps) / 10_000;
        if (job.collateralAmount - job.lockedCollateral < collateralRequired) revert CollateralInsufficient();
        job.lockedCollateral += collateralRequired;

        uint256 deadline = block.timestamp + durationSeconds;
        Advance storage advance = advances[advanceId];
        advance.jobId = jobId;
        advance.lender = payable(msg.sender);
        advance.supplier = supplier;
        advance.amount = msg.value;
        advance.fee = fee;
        advance.reserve = (fee * reserveBpsOfFee) / 10_000;
        advance.collateralLocked = collateralRequired;
        advance.deadline = deadline;
        advance.status = AdvanceStatus.Advanced;
        advance.purposeHash = keccak256(bytes(purpose));
        advance.supplierDomainHash = supplierDomainHash;

        (bool ok, ) = supplier.call{value: msg.value}("");
        if (!ok) revert TransferFailed();
        emit SupplierPaid(advanceId, jobId, msg.sender, supplier, msg.value, fee, collateralRequired, deadline);
    }

    function paySupplierToken(bytes32 jobId, bytes32 advanceId, address token, string calldata supplierDomain, string calldata purpose, uint256 durationSeconds, uint256 amount) external whenNotPaused nonReentrant {
        Job storage job = jobs[jobId];
        if (job.status != JobStatus.Funded) revert JobNotFunded();
        if (job.token != token || token == address(0)) revert AssetMismatch();
        if (advances[advanceId].status != AdvanceStatus.None) revert AdvanceExists();
        if (durationSeconds == 0 || amount == 0) revert InvalidAmount();
        if (amount > maxAdvance) revert AdvanceTooLarge();

        bytes32 supplierDomainHash = keccak256(bytes(supplierDomain));
        address payable supplier = allowedSuppliers[supplierDomainHash];
        if (supplier == address(0)) revert SupplierNotAllowed();

        uint256 fee = (amount * feeBps) / 10_000;
        uint256 requiredRevenue = amount + fee;
        if (requiredRevenue >= job.escrowAmount) revert AdvanceTooLarge();

        uint256 marginBps = ((job.escrowAmount - requiredRevenue) * 10_000) / job.escrowAmount;
        if (marginBps < minGrossMarginBps) revert GrossMarginTooLow();
        uint256 collateralRequired = (amount * minCollateralBps) / 10_000;
        if (job.collateralAmount - job.lockedCollateral < collateralRequired) revert CollateralInsufficient();
        job.lockedCollateral += collateralRequired;

        uint256 deadline = block.timestamp + durationSeconds;
        Advance storage advance = advances[advanceId];
        advance.jobId = jobId;
        advance.lender = payable(msg.sender);
        advance.supplier = supplier;
        advance.token = token;
        advance.amount = amount;
        advance.fee = fee;
        advance.reserve = (fee * reserveBpsOfFee) / 10_000;
        advance.collateralLocked = collateralRequired;
        advance.deadline = deadline;
        advance.status = AdvanceStatus.Advanced;
        advance.purposeHash = keccak256(bytes(purpose));
        advance.supplierDomainHash = supplierDomainHash;

        _safeTransferFrom(token, msg.sender, supplier, amount);
        emit TokenSupplierPaid(advanceId, jobId, token, msg.sender, supplier, amount, fee, collateralRequired, deadline);
    }

    function completeJob(bytes32 jobId, bytes32 advanceId) external onlyOwner nonReentrant {
        Job storage job = jobs[jobId];
        Advance storage advance = advances[advanceId];
        if (job.status != JobStatus.Funded) revert JobNotFunded();
        if (advance.status != AdvanceStatus.Advanced || advance.jobId != jobId) revert AdvanceNotAdvanced();
        if (job.token != advance.token) revert AssetMismatch();

        uint256 principal = advance.amount;
        uint256 fee = advance.fee;
        uint256 reserve = advance.reserve;
        uint256 agentProceeds = job.escrowAmount - principal - fee;

        job.status = JobStatus.Settled;
        advance.status = AdvanceStatus.Repaid;
        job.lockedCollateral -= advance.collateralLocked;
        insuranceReserveBalance += reserve;
        if (job.token == address(0)) {
            withdrawable[advance.lender] += principal + fee - reserve;
            withdrawable[job.agent] += agentProceeds;
        } else {
            withdrawableToken[job.token][advance.lender] += principal + fee - reserve;
            withdrawableToken[job.token][job.agent] += agentProceeds;
        }
        if (job.collateralAmount > 0 && job.lockedCollateral == 0 && job.collateralPledger != address(0)) {
            if (job.token == address(0)) {
                withdrawable[job.collateralPledger] += job.collateralAmount;
            } else {
                withdrawableToken[job.token][job.collateralPledger] += job.collateralAmount;
            }
            job.collateralAmount = 0;
        }

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

    function liquidate(bytes32 advanceId) external nonReentrant {
        Advance storage advance = advances[advanceId];
        if (advance.status != AdvanceStatus.Advanced && advance.status != AdvanceStatus.Defaulted) revert AdvanceNotLiquidatable();
        if (advance.status == AdvanceStatus.Advanced && block.timestamp <= advance.deadline) revert AdvanceNotMatured();

        Job storage job = jobs[advance.jobId];
        uint256 seniorClaim = advance.amount + advance.fee;
        uint256 collateralPaid = advance.collateralLocked;
        if (collateralPaid > seniorClaim) collateralPaid = seniorClaim;
        uint256 remaining = seniorClaim - collateralPaid;
        uint256 reservePaid = insuranceReserveBalance > remaining ? remaining : insuranceReserveBalance;
        uint256 shortfall = remaining - reservePaid;

        if (collateralPaid > 0) {
            job.lockedCollateral -= advance.collateralLocked;
            job.collateralAmount -= collateralPaid;
        }
        insuranceReserveBalance -= reservePaid;
        if (advance.token == address(0)) {
            withdrawable[advance.lender] += collateralPaid + reservePaid;
        } else {
            withdrawableToken[advance.token][advance.lender] += collateralPaid + reservePaid;
        }
        advance.status = AdvanceStatus.Defaulted;
        job.status = JobStatus.Failed;

        emit CollateralLiquidated(advance.jobId, advanceId, advance.lender, collateralPaid, reservePaid, shortfall);
    }

    function withdraw() external nonReentrant {
        uint256 amount = withdrawable[msg.sender];
        if (amount == 0) revert InvalidAmount();
        withdrawable[msg.sender] = 0;
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Withdrawn(msg.sender, amount);
    }

    function withdrawToken(address token) external nonReentrant {
        uint256 amount = withdrawableToken[token][msg.sender];
        if (amount == 0) revert InvalidAmount();
        withdrawableToken[token][msg.sender] = 0;
        _safeTransfer(token, msg.sender, amount);
        emit TokenWithdrawn(token, msg.sender, amount);
    }

    function _safeTransfer(address token, address to, uint256 amount) internal {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.transfer.selector, to, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }
}
