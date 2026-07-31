// Package types contains types that could be useful to other apps when interacting with this extension.
package types

import "github.com/ethereum/go-ethereum/common"

// ComputePayload is the c402 payload forwarded from the instruction sender.
type ComputePayload struct {
	Protocol                  string                 `json:"protocol"`
	Version                   int                    `json:"version"`
	RequestID                 string                 `json:"requestId"`
	RequirementHash           string                 `json:"requirementHash"`
	EncryptedInput            map[string]interface{} `json:"encryptedInput"`
	ClientOutputEncryptionKey string                 `json:"clientOutputEncryptionKey"`
	InputCommitment           string                 `json:"inputCommitment"`
	Nonce                     string                 `json:"nonce"`
}

// CreditAssessmentResult is the public decision shape encrypted by the c402 API.
type CreditAssessmentResult struct {
	Approved      bool   `json:"approved"`
	MaximumCredit int    `json:"maximumCredit"`
	RiskBand      string `json:"riskBand"`
	ValidUntil    int64  `json:"validUntil"`
}

// CreditAssessmentResponse is emitted in ActionResult.Data. The production c402
// API verifies the TEE-signed ActionResult and then wraps it in a ComputeReceipt.
type CreditAssessmentResponse struct {
	RequestID       string `json:"requestId"`
	InputCommitment string `json:"inputCommitment"`
	OutputSchema    string `json:"outputSchema"`
	Status          string `json:"status"`
}

// State holds the extension's observable state, returned by GET /state.
type State struct {
	AssessmentCount int    `json:"assessmentCount"`
	LastRequestID   string `json:"lastRequestId"`
}

// --- DO NOT MODIFY below this line. ---

// StateResponse is the envelope returned by GET /state.
type StateResponse struct {
	StateVersion common.Hash `json:"stateVersion"`
	State        State       `json:"state"`
}
