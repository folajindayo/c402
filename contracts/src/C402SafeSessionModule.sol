// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface ISafe {
    enum Operation {
        Call,
        DelegateCall
    }

    function execTransactionFromModule(address to, uint256 value, bytes calldata data, Operation operation) external returns (bool success);
}

/// @notice Safe module for c402 lender sessions.
/// @dev A Safe enables this module and configures a session signer. The signer
/// can only route native funds from that Safe into C402CreditIntent.paySupplier.
contract C402SafeSessionModule {
    struct Session {
        address signer;
        address creditContract;
        uint256 spendLimit;
        uint256 spent;
        uint256 expiresAt;
        bool revoked;
    }

    mapping(address safe => Session session) public sessions;

    event SessionConfigured(address indexed safe, address indexed signer, address indexed creditContract, uint256 spendLimit, uint256 expiresAt);
    event SessionRevoked(address indexed safe);
    event SupplierPaymentExecuted(address indexed safe, address indexed signer, bytes32 indexed advanceId, uint256 amount);

    error NotSafe();
    error NotSessionSigner();
    error SessionExpired();
    error SessionIsRevoked();
    error SessionMissing();
    error SpendLimitExceeded();
    error InvalidAmount();
    error ModuleExecutionFailed();

    /// @notice Must be called by the Safe itself through a Safe transaction.
    function configureSession(address signer, address creditContract, uint256 spendLimit, uint256 expiresAt) external {
        if (signer == address(0) || creditContract == address(0) || spendLimit == 0 || expiresAt <= block.timestamp) {
            revert InvalidAmount();
        }
        sessions[msg.sender] = Session({
            signer: signer,
            creditContract: creditContract,
            spendLimit: spendLimit,
            spent: 0,
            expiresAt: expiresAt,
            revoked: false
        });
        emit SessionConfigured(msg.sender, signer, creditContract, spendLimit, expiresAt);
    }

    /// @notice Must be called by the Safe itself through a Safe transaction.
    function revokeSession() external {
        Session storage session = sessions[msg.sender];
        if (session.signer == address(0)) revert SessionMissing();
        session.revoked = true;
        emit SessionRevoked(msg.sender);
    }

    function executePaySupplier(
        address safe,
        bytes32 jobId,
        bytes32 advanceId,
        string calldata supplierDomain,
        string calldata purpose,
        uint256 durationSeconds,
        uint256 amount
    ) external {
        Session storage session = sessions[safe];
        if (session.signer == address(0)) revert SessionMissing();
        if (msg.sender != session.signer) revert NotSessionSigner();
        if (session.revoked) revert SessionIsRevoked();
        if (block.timestamp > session.expiresAt) revert SessionExpired();
        if (amount == 0) revert InvalidAmount();
        if (session.spent + amount > session.spendLimit) revert SpendLimitExceeded();

        session.spent += amount;
        bytes memory data = abi.encodeWithSignature(
            "paySupplier(bytes32,bytes32,string,string,uint256)",
            jobId,
            advanceId,
            supplierDomain,
            purpose,
            durationSeconds
        );
        bool ok = ISafe(safe).execTransactionFromModule(session.creditContract, amount, data, ISafe.Operation.Call);
        if (!ok) revert ModuleExecutionFailed();
        emit SupplierPaymentExecuted(safe, msg.sender, advanceId, amount);
    }
}
