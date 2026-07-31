package extension

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"extension-scaffold/internal/config"
	"extension-scaffold/pkg/types"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	teetypes "github.com/flare-foundation/tee-node/pkg/types"
	teeutils "github.com/flare-foundation/tee-node/pkg/utils"
)

func toHash(s string) common.Hash { return teeutils.ToHash(s) }

func buildTestAction(opType, opCommand common.Hash, originalMessage []byte) teetypes.Action {
	type dataFixed struct {
		OPType          common.Hash   `json:"opType"`
		OPCommand       common.Hash   `json:"opCommand"`
		OriginalMessage hexutil.Bytes `json:"originalMessage"`
	}

	df := dataFixed{
		OPType:          opType,
		OPCommand:       opCommand,
		OriginalMessage: originalMessage,
	}
	msg, _ := json.Marshal(df)

	return teetypes.Action{
		Data: teetypes.ActionData{
			ID:            common.HexToHash("0x1234"),
			SubmissionTag: "submit",
			Message:       msg,
		},
	}
}

func TestProcessAction_UnknownOPType(t *testing.T) {
	e := &Extension{}
	action := buildTestAction(toHash("UNKNOWN_TYPE"), toHash(config.OPCommandAssessCredit), nil)

	status, body := e.processAction(action)

	if status != http.StatusNotImplemented {
		t.Fatalf("expected status %d, got %d", http.StatusNotImplemented, status)
	}
	if !strings.Contains(string(body), "unsupported op type") {
		t.Fatalf("expected unsupported op type body, got %s", body)
	}
}

func TestProcessAction_UnknownOPCommand(t *testing.T) {
	e := &Extension{}
	action := buildTestAction(toHash(config.OPTypeCreditScore), toHash("UNKNOWN_COMMAND"), nil)

	status, body := e.processAction(action)

	if status != http.StatusNotImplemented {
		t.Fatalf("expected status %d, got %d", http.StatusNotImplemented, status)
	}
	if !strings.Contains(string(body), "unsupported op command") {
		t.Fatalf("expected unsupported op command body, got %s", body)
	}
}

func TestProcessAction_ValidAssessCredit(t *testing.T) {
	e := &Extension{}

	payload, _ := json.Marshal(types.ComputePayload{
		Protocol:                  "c402",
		Version:                   1,
		RequestID:                 "0xabc",
		RequirementHash:           "0xreq",
		EncryptedInput:            map[string]interface{}{"ciphertext": "0xencrypted"},
		ClientOutputEncryptionKey: "0xpublic",
		InputCommitment:           "0xinput",
		Nonce:                     "0xnonce",
	})
	action := buildTestAction(toHash(config.OPTypeCreditScore), toHash(config.OPCommandAssessCredit), payload)

	status, body := e.processAction(action)

	if status != http.StatusOK {
		t.Fatalf("expected status %d, got %d: %s", http.StatusOK, status, body)
	}

	var result teetypes.ActionResult
	if err := json.Unmarshal(body, &result); err != nil {
		t.Fatalf("failed to unmarshal ActionResult: %v", err)
	}
	if result.Status != 1 {
		t.Fatalf("expected ActionResult.Status=1, got %d: %s", result.Status, result.Log)
	}

	var resp types.CreditAssessmentResponse
	if err := json.Unmarshal(result.Data, &resp); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}
	if resp.RequestID != "0xabc" || resp.InputCommitment != "0xinput" || resp.Status != "accepted" {
		t.Fatalf("unexpected response: %+v", resp)
	}
}

func TestProcessAction_RejectsInvalidPayload(t *testing.T) {
	e := &Extension{}
	payload, _ := json.Marshal(types.ComputePayload{Protocol: "c402", Version: 2})
	action := buildTestAction(toHash(config.OPTypeCreditScore), toHash(config.OPCommandAssessCredit), payload)

	status, body := e.processAction(action)

	if status != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, status)
	}
	var result teetypes.ActionResult
	if err := json.Unmarshal(body, &result); err != nil {
		t.Fatalf("failed to unmarshal ActionResult: %v", err)
	}
	if result.Status != 0 {
		t.Fatalf("expected ActionResult.Status=0, got %d", result.Status)
	}
}
