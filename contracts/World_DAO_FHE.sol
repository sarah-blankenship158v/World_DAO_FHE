pragma solidity ^0.8.24;
import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract WorldGovernanceFHE is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    error NotOwner();
    error NotProvider();
    error Paused();
    error InvalidState();
    error BatchClosed();
    error BatchFull();
    error CooldownActive();
    error InvalidBatch();
    error InvalidRequest();
    error ReplayAttempt();

    address public owner;
    bool public paused;
    uint256 public constant MIN_INTERVAL = 60; // seconds

    mapping(address => bool) public isProvider;
    mapping(address => uint256) public lastActionAt;
    mapping(uint256 => DecryptionContext) public decryptionContexts;
    mapping(uint256 => Batch) public batches;
    mapping(address => uint256) public lastSubmissionBatch;
    mapping(address => uint256) public lastDecryptionRequest;

    euint32 public encryptedVoteSum;
    euint32 public encryptedVoteCount;
    euint32 public encryptedApprovalThreshold;
    euint32 public encryptedQuorumThreshold;

    uint256 public currentBatchId;
    uint256 public modelVersion;
    uint256 public constant MAX_BATCH_SIZE = 100;

    struct DecryptionContext {
        uint256 modelVersion;
        bytes32 stateHash;
        bool processed;
        address requester;
        uint256 batchId;
    }

    struct Batch {
        bool isOpen;
        uint256 proposalId;
        uint256 voteCount;
        uint256 createdAt;
        uint256 closedAt;
    }

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event Paused(address indexed account);
    event Unpaused(address indexed account);
    event CooldownUpdated(uint256 newCooldown);
    event BatchOpened(uint256 indexed batchId, uint256 proposalId);
    event BatchClosed(uint256 indexed batchId);
    event VoteSubmitted(address indexed voter, uint256 indexed batchId);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed batchId, address indexed requester);
    event DecryptionComplete(uint256 indexed requestId, uint256 indexed batchId, uint256 voteSum, uint256 voteCount, bool approved, bool quorate);
    event ThresholdUpdated(uint256 indexed batchId);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier checkCooldown() {
        if (block.timestamp < lastActionAt[msg.sender] + MIN_INTERVAL) {
            revert CooldownActive();
        }
        _;
    }

    constructor() {
        owner = msg.sender;
        modelVersion = 1;
        encryptedVoteSum = FHE.asEuint32(0);
        encryptedVoteCount = FHE.asEuint32(0);
        encryptedApprovalThreshold = FHE.asEuint32(0);
        encryptedQuorumThreshold = FHE.asEuint32(0);
        _openNewBatch(1); // initial batch
    }

    function transferOwnership(address newOwner) public onlyOwner {
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function addProvider(address provider) public onlyOwner {
        isProvider[provider] = true;
        emit ProviderAdded(provider);
    }

    function removeProvider(address provider) public onlyOwner {
        isProvider[provider] = false;
        emit ProviderRemoved(provider);
    }

    function pause() public onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() public onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function setCooldown(uint256 newCooldown) public onlyOwner {
        MIN_INTERVAL = newCooldown;
        emit CooldownUpdated(newCooldown);
    }

    function openNewBatch(uint256 proposalId) public onlyProvider whenNotPaused checkCooldown {
        lastActionAt[msg.sender] = block.timestamp;
        currentBatchId++;
        _openNewBatch(proposalId);
    }

    function _openNewBatch(uint256 proposalId) internal {
        batches[currentBatchId] = Batch({
            isOpen: true,
            proposalId: proposalId,
            voteCount: 0,
            createdAt: block.timestamp,
            closedAt: 0
        });
        emit BatchOpened(currentBatchId, proposalId);
    }

    function closeBatch(uint256 batchId) public onlyProvider whenNotPaused checkCooldown {
        lastActionAt[msg.sender] = block.timestamp;
        Batch storage batch = batches[batchId];
        if (!batch.isOpen) revert BatchClosed();
        batch.isOpen = false;
        batch.closedAt = block.timestamp;
        emit BatchClosed(batchId);
    }

    function submitVote(
        uint256 batchId,
        euint32 encryptedVote,
        euint32 encryptedWeight
    ) public onlyProvider whenNotPaused checkCooldown {
        lastActionAt[msg.sender] = block.timestamp;
        Batch storage batch = batches[batchId];
        if (!batch.isOpen) revert BatchClosed();
        if (batch.voteCount >= MAX_BATCH_SIZE) revert BatchFull();

        _initIfNeeded(encryptedVoteSum);
        _initIfNeeded(encryptedVoteCount);

        encryptedVoteSum = encryptedVoteSum.add(encryptedVote.mul(encryptedWeight));
        encryptedVoteCount = encryptedVoteCount.add(encryptedWeight);

        batch.voteCount++;
        lastSubmissionBatch[msg.sender] = batchId;
        emit VoteSubmitted(msg.sender, batchId);
    }

    function updateThresholds(
        euint32 encryptedApproval,
        euint32 encryptedQuorum
    ) public onlyProvider whenNotPaused checkCooldown {
        lastActionAt[msg.sender] = block.timestamp;
        encryptedApprovalThreshold = encryptedApproval;
        encryptedQuorumThreshold = encryptedQuorum;
        emit ThresholdUpdated(currentBatchId);
    }

    function requestBatchDecryption(uint256 batchId) public whenNotPaused checkCooldown {
        lastActionAt[msg.sender] = block.timestamp;
        Batch storage batch = batches[batchId];
        if (batch.isOpen) revert BatchClosed();

        bytes32[] memory cts = new bytes32[](4);
        cts[0] = FHE.toBytes32(encryptedVoteSum);
        cts[1] = FHE.toBytes32(encryptedVoteCount);
        cts[2] = FHE.toBytes32(encryptedApprovalThreshold);
        cts[3] = FHE.toBytes32(encryptedQuorumThreshold);

        bytes32 stateHash = _hashCiphertexts(cts);
        uint256 requestId = FHE.requestDecryption(cts, this.handleBatchDecryption.selector);

        decryptionContexts[requestId] = DecryptionContext({
            modelVersion: modelVersion,
            stateHash: stateHash,
            processed: false,
            requester: msg.sender,
            batchId: batchId
        });

        lastDecryptionRequest[msg.sender] = requestId;
        emit DecryptionRequested(requestId, batchId, msg.sender);
    }

    function handleBatchDecryption(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        DecryptionContext storage context = decryptionContexts[requestId];
        if (context.processed) revert ReplayAttempt();
        if (context.modelVersion != modelVersion) revert InvalidState();

        Batch storage batch = batches[context.batchId];
        if (batch.isOpen) revert InvalidBatch();

        bytes32[] memory cts = new bytes32[](4);
        cts[0] = FHE.toBytes32(encryptedVoteSum);
        cts[1] = FHE.toBytes32(encryptedVoteCount);
        cts[2] = FHE.toBytes32(encryptedApprovalThreshold);
        cts[3] = FHE.toBytes32(encryptedQuorumThreshold);

        bytes32 currHash = _hashCiphertexts(cts);
        if (currHash != context.stateHash) revert InvalidState();

        FHE.checkSignatures(requestId, cleartexts, proof);

        (uint32 voteSum, uint32 voteCount, uint32 approvalThreshold, uint32 quorumThreshold) = 
            abi.decode(cleartexts, (uint32, uint32, uint32, uint32));

        bool approved = voteSum >= approvalThreshold;
        bool quorate = voteCount >= quorumThreshold;

        context.processed = true;
        emit DecryptionComplete(requestId, context.batchId, voteSum, voteCount, approved, quorate);
    }

    function _hashCiphertexts(bytes32[] memory cts) internal pure returns (bytes32) {
        return keccak256(abi.encode(cts, address(this)));
    }

    function _initIfNeeded(euint32 x) internal returns (euint32) {
        if (!FHE.isInitialized(x)) {
            x = FHE.asEuint32(0);
        }
        return x;
    }

    function _requireInitialized(euint32 x, string memory tag) internal pure {
        if (!FHE.isInitialized(x)) {
            revert(string(abi.encodePacked("Uninitialized: ", tag)));
        }
    }
}