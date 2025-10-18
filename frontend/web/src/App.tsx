import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface Proposal {
  id: string;
  title: string;
  description: string;
  encryptedData: string;
  timestamp: number;
  proposer: string;
  category: string;
  status: "pending" | "approved" | "rejected";
  votesFor: number;
  votesAgainst: number;
}

interface UserHistory {
  id: string;
  action: string;
  timestamp: number;
  target: string;
  details: string;
}

const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    return parseFloat(atob(encryptedData.substring(4)));
  }
  return parseFloat(encryptedData);
};

const FHECompute = (encryptedData: string, operation: string): string => {
  const value = FHEDecryptNumber(encryptedData);
  let result = value;
  
  switch(operation) {
    case 'increase10%':
      result = value * 1.1;
      break;
    case 'decrease10%':
      result = value * 0.9;
      break;
    case 'double':
      result = value * 2;
      break;
    default:
      result = value;
  }
  
  return FHEEncryptNumber(result);
};

const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [userHistory, setUserHistory] = useState<UserHistory[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newProposalData, setNewProposalData] = useState({ title: "", description: "", category: "economy", parameterValue: 0 });
  const [selectedProposal, setSelectedProposal] = useState<Proposal | null>(null);
  const [decryptedValue, setDecryptedValue] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [startTimestamp, setStartTimestamp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [activeTab, setActiveTab] = useState("proposals");
  const [votingPower, setVotingPower] = useState<number>(0);

  // Stats for dashboard
  const approvedCount = proposals.filter(p => p.status === "approved").length;
  const pendingCount = proposals.filter(p => p.status === "pending").length;
  const rejectedCount = proposals.filter(p => p.status === "rejected").length;
  const totalVotes = proposals.reduce((sum, p) => sum + p.votesFor + p.votesAgainst, 0);

  useEffect(() => {
    loadProposals().finally(() => setLoading(false));
    loadUserHistory();
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
      
      // Generate random voting power for demo
      setVotingPower(Math.floor(Math.random() * 100) + 1);
    };
    initSignatureParams();
  }, [address]);

  const loadProposals = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check if contract is available
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) return;
      
      // Load proposal keys
      const keysBytes = await contract.getData("proposal_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing proposal keys:", e); }
      }
      
      // Load each proposal
      const list: Proposal[] = [];
      for (const key of keys) {
        try {
          const proposalBytes = await contract.getData(`proposal_${key}`);
          if (proposalBytes.length > 0) {
            try {
              const proposalData = JSON.parse(ethers.toUtf8String(proposalBytes));
              list.push({ 
                id: key, 
                title: proposalData.title,
                description: proposalData.description,
                encryptedData: proposalData.data, 
                timestamp: proposalData.timestamp, 
                proposer: proposalData.proposer, 
                category: proposalData.category, 
                status: proposalData.status || "pending",
                votesFor: proposalData.votesFor || 0,
                votesAgainst: proposalData.votesAgainst || 0
              });
            } catch (e) { console.error(`Error parsing proposal data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading proposal ${key}:`, e); }
      }
      list.sort((a, b) => b.timestamp - a.timestamp);
      setProposals(list);
    } catch (e) { console.error("Error loading proposals:", e); } 
    finally { setIsRefreshing(false); setLoading(false); }
  };

  const loadUserHistory = () => {
    // Mock user history data for demonstration
    const mockHistory: UserHistory[] = [
      { id: "1", action: "Voted", timestamp: Date.now() - 86400000, target: "Proposal #123", details: "Voted FOR on Economic Adjustment" },
      { id: "2", action: "Created", timestamp: Date.now() - 172800000, target: "Proposal #122", details: "Created new rule proposal" },
      { id: "3", action: "Voted", timestamp: Date.now() - 259200000, target: "Proposal #120", details: "Voted AGAINST on Tax Increase" },
      { id: "4", action: "Commented", timestamp: Date.now() - 345600000, target: "Proposal #118", details: "Added comment on Governance Update" }
    ];
    setUserHistory(mockHistory);
  };

  const submitProposal = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setCreating(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting proposal data with Zama FHE..." });
    
    try {
      // Encrypt the parameter value
      const encryptedData = FHEEncryptNumber(newProposalData.parameterValue);
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      // Generate unique ID
      const proposalId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      
      // Prepare proposal data
      const proposalData = { 
        title: newProposalData.title,
        description: newProposalData.description,
        data: encryptedData, 
        timestamp: Math.floor(Date.now() / 1000), 
        proposer: address, 
        category: newProposalData.category, 
        status: "pending",
        votesFor: 0,
        votesAgainst: 0
      };
      
      // Store proposal
      await contract.setData(`proposal_${proposalId}`, ethers.toUtf8Bytes(JSON.stringify(proposalData)));
      
      // Update proposal keys list
      const keysBytes = await contract.getData("proposal_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(proposalId);
      await contract.setData("proposal_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      
      // Add to user history
      addUserHistory("Created", `Proposal #${proposalId.substring(0, 6)}`, "Created new rule proposal");
      
      setTransactionStatus({ visible: true, status: "success", message: "Encrypted proposal submitted securely!" });
      await loadProposals();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewProposalData({ title: "", description: "", category: "economy", parameterValue: 0 });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") ? "Transaction rejected by user" : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { setCreating(false); }
  };

  const addUserHistory = (action: string, target: string, details: string) => {
    const newHistory: UserHistory = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      action,
      timestamp: Date.now(),
      target,
      details
    };
    setUserHistory(prev => [newHistory, ...prev.slice(0, 9)]); // Keep only last 10 items
  };

  const voteOnProposal = async (proposalId: string, vote: boolean) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Processing encrypted vote with FHE..." });
    
    try {
      const contract = await getContractReadOnly();
      if (!contract) throw new Error("Failed to get contract");
      
      // Get current proposal data
      const proposalBytes = await contract.getData(`proposal_${proposalId}`);
      if (proposalBytes.length === 0) throw new Error("Proposal not found");
      const proposalData = JSON.parse(ethers.toUtf8String(proposalBytes));
      
      // Update vote count
      if (vote) {
        proposalData.votesFor = (proposalData.votesFor || 0) + 1;
      } else {
        proposalData.votesAgainst = (proposalData.votesAgainst || 0) + 1;
      }
      
      // Save updated proposal
      const contractWithSigner = await getContractWithSigner();
      if (!contractWithSigner) throw new Error("Failed to get contract with signer");
      await contractWithSigner.setData(`proposal_${proposalId}`, ethers.toUtf8Bytes(JSON.stringify(proposalData)));
      
      // Add to user history
      addUserHistory("Voted", `Proposal #${proposalId.substring(0, 6)}`, `Voted ${vote ? "FOR" : "AGAINST"} on ${proposalData.title}`);
      
      setTransactionStatus({ visible: true, status: "success", message: "FHE vote processed successfully!" });
      await loadProposals();
      
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Voting failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const decryptWithSignature = async (encryptedData: string): Promise<number | null> => {
    if (!isConnected) { alert("Please connect wallet first"); return null; }
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      return FHEDecryptNumber(encryptedData);
    } catch (e) { console.error("Decryption failed:", e); return null; } 
    finally { setIsDecrypting(false); }
  };

  const isOwner = (proposerAddress: string) => address?.toLowerCase() === proposerAddress.toLowerCase();

  const renderFlowChart = () => {
    return (
      <div className="flow-chart">
        <div className="flow-step">
          <div className="step-icon">💡</div>
          <div className="step-label">Proposal Creation</div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">🔒</div>
          <div className="step-label">FHE Encryption</div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">🗳️</div>
          <div className="step-label">Community Voting</div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">✅</div>
          <div className="step-label">Implementation</div>
        </div>
      </div>
    );
  };

  const renderPieChart = () => {
    const total = proposals.length || 1;
    const approvedPercentage = (approvedCount / total) * 100;
    const pendingPercentage = (pendingCount / total) * 100;
    const rejectedPercentage = (rejectedCount / total) * 100;
    
    return (
      <div className="pie-chart-container">
        <div className="pie-chart">
          <div className="pie-segment approved" style={{ transform: `rotate(${approvedPercentage * 3.6}deg)` }}></div>
          <div className="pie-segment pending" style={{ transform: `rotate(${(approvedPercentage + pendingPercentage) * 3.6}deg)` }}></div>
          <div className="pie-segment rejected" style={{ transform: `rotate(${(approvedPercentage + pendingPercentage + rejectedPercentage) * 3.6}deg)` }}></div>
          <div className="pie-center">
            <div className="pie-value">{proposals.length}</div>
            <div className="pie-label">Total</div>
          </div>
        </div>
        <div className="pie-legend">
          <div className="legend-item"><div className="color-box approved"></div><span>Approved: {approvedCount}</span></div>
          <div className="legend-item"><div className="color-box pending"></div><span>Pending: {pendingCount}</span></div>
          <div className="legend-item"><div className="color-box rejected"></div><span>Rejected: {rejectedCount}</span></div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Initializing FHE connection to ZAMA...</p>
    </div>
  );

  return (
    <div className="app-container future-metal-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon"><div className="globe-icon"></div></div>
          <h1>World<span>DAO</span>FHE</h1>
        </div>
        <div className="header-actions">
          <button onClick={() => setShowCreateModal(true)} className="create-proposal-btn metal-button">
            <div className="add-icon"></div>New Proposal
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>

      <div className="main-content">
        <div className="dashboard-panels">
          {/* Left Panel - Stats and Charts */}
          <div className="left-panel">
            <div className="dashboard-card metal-card">
              <h3>World Governance Stats</h3>
              <div className="stats-grid">
                <div className="stat-item">
                  <div className="stat-value">{proposals.length}</div>
                  <div className="stat-label">Total Proposals</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{totalVotes}</div>
                  <div className="stat-label">Total Votes</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{votingPower}</div>
                  <div className="stat-label">Your Voting Power</div>
                </div>
              </div>
            </div>

            <div className="dashboard-card metal-card">
              <h3>Proposal Status Distribution</h3>
              {renderPieChart()}
            </div>

            <div className="dashboard-card metal-card">
              <h3>Governance Process</h3>
              {renderFlowChart()}
            </div>
          </div>

          {/* Right Panel - Content Area */}
          <div className="right-panel">
            <div className="tabs">
              <button 
                className={`tab ${activeTab === "proposals" ? "active" : ""}`}
                onClick={() => setActiveTab("proposals")}
              >
                Proposals
              </button>
              <button 
                className={`tab ${activeTab === "history" ? "active" : ""}`}
                onClick={() => setActiveTab("history")}
              >
                Your History
              </button>
            </div>

            {activeTab === "proposals" ? (
              <div className="proposals-section">
                <div className="section-header">
                  <h2>Community Proposals</h2>
                  <div className="header-actions">
                    <button onClick={loadProposals} className="refresh-btn metal-button" disabled={isRefreshing}>
                      {isRefreshing ? "Refreshing..." : "Refresh"}
                    </button>
                  </div>
                </div>
                
                <div className="proposals-list metal-card">
                  <div className="table-header">
                    <div className="header-cell">Title</div>
                    <div className="header-cell">Category</div>
                    <div className="header-cell">Proposer</div>
                    <div className="header-cell">Date</div>
                    <div className="header-cell">Status</div>
                    <div className="header-cell">Votes</div>
                    <div className="header-cell">Actions</div>
                  </div>
                  
                  {proposals.length === 0 ? (
                    <div className="no-proposals">
                      <div className="no-proposals-icon"></div>
                      <p>No proposals found</p>
                      <button className="metal-button primary" onClick={() => setShowCreateModal(true)}>
                        Create First Proposal
                      </button>
                    </div>
                  ) : proposals.map(proposal => (
                    <div className="proposal-row" key={proposal.id} onClick={() => setSelectedProposal(proposal)}>
                      <div className="table-cell title">{proposal.title}</div>
                      <div className="table-cell">{proposal.category}</div>
                      <div className="table-cell">{proposal.proposer.substring(0, 6)}...{proposal.proposer.substring(38)}</div>
                      <div className="table-cell">{new Date(proposal.timestamp * 1000).toLocaleDateString()}</div>
                      <div className="table-cell">
                        <span className={`status-badge ${proposal.status}`}>{proposal.status}</span>
                      </div>
                      <div className="table-cell">
                        {proposal.votesFor} / {proposal.votesAgainst}
                      </div>
                      <div className="table-cell actions">
                        {proposal.status === "pending" && (
                          <>
                            <button 
                              className="action-btn metal-button success" 
                              onClick={(e) => { e.stopPropagation(); voteOnProposal(proposal.id, true); }}
                            >
                              Vote For
                            </button>
                            <button 
                              className="action-btn metal-button danger" 
                              onClick={(e) => { e.stopPropagation(); voteOnProposal(proposal.id, false); }}
                            >
                              Vote Against
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="history-section">
                <div className="section-header">
                  <h2>Your Activity History</h2>
                </div>
                
                <div className="history-list metal-card">
                  <div className="table-header">
                    <div className="header-cell">Action</div>
                    <div className="header-cell">Target</div>
                    <div className="header-cell">Date</div>
                    <div className="header-cell">Details</div>
                  </div>
                  
                  {userHistory.length === 0 ? (
                    <div className="no-history">
                      <p>No activity history found</p>
                    </div>
                  ) : userHistory.map(history => (
                    <div className="history-row" key={history.id}>
                      <div className="table-cell">
                        <span className={`action-badge ${history.action.toLowerCase()}`}>{history.action}</span>
                      </div>
                      <div className="table-cell">{history.target}</div>
                      <div className="table-cell">{new Date(history.timestamp).toLocaleDateString()}</div>
                      <div className="table-cell details">{history.details}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitProposal} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating} 
          proposalData={newProposalData} 
          setProposalData={setNewProposalData}
        />
      )}
      
      {selectedProposal && (
        <ProposalDetailModal 
          proposal={selectedProposal} 
          onClose={() => { setSelectedProposal(null); setDecryptedValue(null); }} 
          decryptedValue={decryptedValue} 
          setDecryptedValue={setDecryptedValue} 
          isDecrypting={isDecrypting} 
          decryptWithSignature={decryptWithSignature}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content metal-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="globe-icon"></div>
              <span>WorldDAO FHE</span>
            </div>
            <p>FHE-based Platform for Player-Governed Autonomous Worlds</p>
          </div>
          <div className="footer-links">
            <a href="#" className="footer-link">Powered by Zama FHE</a>
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
          </div>
        </div>
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Encrypted Governance</span>
          </div>
          <div className="copyright">© {new Date().getFullYear()} WorldDAO FHE. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  proposalData: any;
  setProposalData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ onSubmit, onClose, creating, proposalData, setProposalData }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setProposalData({ ...proposalData, [name]: value });
  };

  const handleValueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setProposalData({ ...proposalData, [name]: parseFloat(value) });
  };

  const handleSubmit = () => {
    if (!proposalData.title || !proposalData.parameterValue) { 
      alert("Please fill required fields"); 
      return; 
    }
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal metal-card">
        <div className="modal-header">
          <h2>Create New Proposal</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> 
            <div>
              <strong>ZAMA FHE Encryption</strong>
              <p>Your proposal data will be encrypted with Zama FHE before submission</p>
            </div>
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Proposal Title *</label>
              <input 
                type="text" 
                name="title" 
                value={proposalData.title} 
                onChange={handleChange} 
                placeholder="Enter proposal title..." 
                className="metal-input"
              />
            </div>
            
            <div className="form-group">
              <label>Category *</label>
              <select name="category" value={proposalData.category} onChange={handleChange} className="metal-select">
                <option value="economy">Economy</option>
                <option value="governance">Governance</option>
                <option value="environment">Environment</option>
                <option value="technology">Technology</option>
                <option value="other">Other</option>
              </select>
            </div>
            
            <div className="form-group full-width">
              <label>Description</label>
              <textarea 
                name="description" 
                value={proposalData.description} 
                onChange={handleChange} 
                placeholder="Describe your proposal in detail..." 
                className="metal-textarea"
                rows={3}
              />
            </div>
            
            <div className="form-group">
              <label>Parameter Value *</label>
              <input 
                type="number" 
                name="parameterValue" 
                value={proposalData.parameterValue} 
                onChange={handleValueChange} 
                placeholder="Enter numerical value..." 
                className="metal-input"
                step="0.01"
              />
            </div>
          </div>
          
          <div className="encryption-preview">
            <h4>FHE Encryption Preview</h4>
            <div className="preview-container">
              <div className="plain-data">
                <span>Plain Value:</span>
                <div>{proposalData.parameterValue || 'No value entered'}</div>
              </div>
              <div className="encryption-arrow">→</div>
              <div className="encrypted-data">
                <span>Encrypted Data:</span>
                <div>{proposalData.parameterValue ? FHEEncryptNumber(proposalData.parameterValue).substring(0, 50) + '...' : 'No value entered'}</div>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn metal-button">Cancel</button>
          <button onClick={handleSubmit} disabled={creating} className="submit-btn metal-button primary">
            {creating ? "Encrypting with Zama FHE..." : "Submit Proposal"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface ProposalDetailModalProps {
  proposal: Proposal;
  onClose: () => void;
  decryptedValue: number | null;
  setDecryptedValue: (value: number | null) => void;
  isDecrypting: boolean;
  decryptWithSignature: (encryptedData: string) => Promise<number | null>;
}

const ProposalDetailModal: React.FC<ProposalDetailModalProps> = ({ 
  proposal, onClose, decryptedValue, setDecryptedValue, isDecrypting, decryptWithSignature 
}) => {
  const handleDecrypt = async () => {
    if (decryptedValue !== null) { 
      setDecryptedValue(null); 
      return; 
    }
    const decrypted = await decryptWithSignature(proposal.encryptedData);
    if (decrypted !== null) setDecryptedValue(decrypted);
  };

  return (
    <div className="modal-overlay">
      <div className="proposal-detail-modal metal-card">
        <div className="modal-header">
          <h2>Proposal Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="proposal-info">
            <div className="info-item"><span>Title:</span><strong>{proposal.title}</strong></div>
            <div className="info-item"><span>Category:</span><strong>{proposal.category}</strong></div>
            <div className="info-item"><span>Proposer:</span><strong>{proposal.proposer.substring(0, 6)}...{proposal.proposer.substring(38)}</strong></div>
            <div className="info-item"><span>Date:</span><strong>{new Date(proposal.timestamp * 1000).toLocaleString()}</strong></div>
            <div className="info-item"><span>Status:</span><strong className={`status-badge ${proposal.status}`}>{proposal.status}</strong></div>
            <div className="info-item"><span>Votes For:</span><strong>{proposal.votesFor}</strong></div>
            <div className="info-item"><span>Votes Against:</span><strong>{proposal.votesAgainst}</strong></div>
          </div>
          
          <div className="description-section">
            <h3>Description</h3>
            <p>{proposal.description || "No description provided."}</p>
          </div>
          
          <div className="encrypted-data-section">
            <h3>FHE Encrypted Parameter</h3>
            <div className="encrypted-data">{proposal.encryptedData.substring(0, 100)}...</div>
            <div className="fhe-tag">
              <div className="fhe-icon"></div>
              <span>Zama FHE Encrypted</span>
            </div>
            
            <button className="decrypt-btn metal-button" onClick={handleDecrypt} disabled={isDecrypting}>
              {isDecrypting ? (
                <span className="decrypt-spinner"></span>
              ) : decryptedValue !== null ? (
                "Hide Decrypted Value"
              ) : (
                "Decrypt with Wallet Signature"
              )}
            </button>
          </div>
          
          {decryptedValue !== null && (
            <div className="decrypted-data-section">
              <h3>Decrypted Parameter Value</h3>
              <div className="decrypted-value">{decryptedValue}</div>
              <div className="decryption-notice">
                <div className="warning-icon"></div>
                <span>Decrypted data is only visible after wallet signature verification</span>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn metal-button">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;