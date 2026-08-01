// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IERC8004ReputationRegistry {
    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2,
        string calldata endpoint,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external;
}

interface IERC8004ValidationRegistry {
    function validationRequest(address validatorAddress, uint256 agentId, string calldata requestURI, bytes32 requestHash) external;
}

contract C402Erc8004Writer {
    address public owner;
    IERC8004ReputationRegistry public reputationRegistry;
    IERC8004ValidationRegistry public validationRegistry;

    event OwnershipTransferred(address indexed previousOwner, address indexed nextOwner);
    event RegistriesUpdated(address indexed reputationRegistry, address indexed validationRegistry);
    event CreditFeedbackSubmitted(uint256 indexed agentId, int128 value, string tag2, bytes32 feedbackHash);
    event CreditValidationRequested(address indexed validatorAddress, uint256 indexed agentId, bytes32 requestHash);

    error NotOwner();
    error RegistryMissing();

    modifier onlyOwner() {
        _onlyOwner();
        _;
    }

    function _onlyOwner() internal view {
        if (msg.sender != owner) revert NotOwner();
    }

    constructor(address initialOwner, address initialReputationRegistry, address initialValidationRegistry) {
        owner = initialOwner == address(0) ? msg.sender : initialOwner;
        reputationRegistry = IERC8004ReputationRegistry(initialReputationRegistry);
        validationRegistry = IERC8004ValidationRegistry(initialValidationRegistry);
        emit OwnershipTransferred(address(0), owner);
        emit RegistriesUpdated(initialReputationRegistry, initialValidationRegistry);
    }

    function transferOwnership(address nextOwner) external onlyOwner {
        owner = nextOwner;
        emit OwnershipTransferred(msg.sender, nextOwner);
    }

    function setRegistries(address nextReputationRegistry, address nextValidationRegistry) external onlyOwner {
        reputationRegistry = IERC8004ReputationRegistry(nextReputationRegistry);
        validationRegistry = IERC8004ValidationRegistry(nextValidationRegistry);
        emit RegistriesUpdated(nextReputationRegistry, nextValidationRegistry);
    }

    function submitCreditFeedback(
        uint256 agentId,
        int128 value,
        string calldata tag2,
        string calldata endpoint,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external onlyOwner {
        if (address(reputationRegistry) == address(0)) revert RegistryMissing();
        reputationRegistry.giveFeedback(agentId, value, 0, "c402-credit", tag2, endpoint, feedbackURI, feedbackHash);
        emit CreditFeedbackSubmitted(agentId, value, tag2, feedbackHash);
    }

    function requestCreditValidation(address validatorAddress, uint256 agentId, string calldata requestURI, bytes32 requestHash) external onlyOwner {
        if (address(validationRegistry) == address(0)) revert RegistryMissing();
        validationRegistry.validationRequest(validatorAddress, agentId, requestURI, requestHash);
        emit CreditValidationRequested(validatorAddress, agentId, requestHash);
    }
}
