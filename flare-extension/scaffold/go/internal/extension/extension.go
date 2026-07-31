package extension

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"

	"extension-scaffold/internal/config"
	"extension-scaffold/pkg/types"

	"github.com/flare-foundation/go-flare-common/pkg/tee/instruction"
	teetypes "github.com/flare-foundation/tee-node/pkg/types"
	teeutils "github.com/flare-foundation/tee-node/pkg/utils"

	"github.com/flare-foundation/tee-node/pkg/processorutils"
)

type Extension struct {
	mu     sync.RWMutex
	Server *http.Server

	assessmentCount int
	lastRequestID   string
}

// --- DO NOT MODIFY: New(), actionHandler() are boilerplate.
func New(extensionPort, signPort int) *Extension {
	e := &Extension{}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /state", e.stateHandler)
	mux.HandleFunc("POST /action", e.actionHandler)

	e.Server = &http.Server{Addr: fmt.Sprintf(":%d", extensionPort), Handler: mux}
	return e
}

// stateHandler() structure is boilerplate but update the State field mapping to match your Extension fields.
func (e *Extension) stateHandler(w http.ResponseWriter, r *http.Request) {
	e.mu.RLock()
	stateResponse := types.StateResponse{
		StateVersion: teeutils.ToHash(config.Version),
		State: types.State{
			AssessmentCount: e.assessmentCount,
			LastRequestID:   e.lastRequestID,
		},
	}
	e.mu.RUnlock()

	err := json.NewEncoder(w).Encode(stateResponse)
	if err != nil {
		http.Error(w, fmt.Sprintf("sending response: %v", err), http.StatusInternalServerError)
		return
	}
}

func (e *Extension) processAction(action teetypes.Action) (int, []byte) {
	dataFixed, err := processorutils.Parse[instruction.DataFixed](action.Data.Message)
	if err != nil {
		return http.StatusBadRequest, []byte(fmt.Sprintf("decoding fixed data: %v", err))
	}

	switch {
	case dataFixed.OPType == teeutils.ToHash(config.OPTypeCreditScore):
		return e.processCreditScore(action, dataFixed)

	default:
		return http.StatusNotImplemented, []byte(fmt.Sprintf(
			"unsupported op type: received %s, expected %s (%s)",
			dataFixed.OPType.Hex(), teeutils.ToHash(config.OPTypeCreditScore).Hex(), config.OPTypeCreditScore,
		))
	}
}

func (e *Extension) processCreditScore(action teetypes.Action, df *instruction.DataFixed) (int, []byte) {
	switch {
	case df.OPCommand == teeutils.ToHash(config.OPCommandAssessCredit):
		ar := e.processAssessCredit(action, df)
		b, _ := json.Marshal(ar)
		return http.StatusOK, b

	default:
		return http.StatusNotImplemented, []byte(fmt.Sprintf(
			"unsupported op command: received %s, expected %s (%s)",
			df.OPCommand.Hex(),
			teeutils.ToHash(config.OPCommandAssessCredit).Hex(), config.OPCommandAssessCredit,
		))
	}
}

func (e *Extension) processAssessCredit(action teetypes.Action, df *instruction.DataFixed) teetypes.ActionResult {
	var req types.ComputePayload
	dec := json.NewDecoder(bytes.NewReader(df.OriginalMessage))
	dec.DisallowUnknownFields()
	err := dec.Decode(&req)
	if err != nil {
		return buildResult(action, df, nil, 0, fmt.Errorf("decoding request: %w", err))
	}

	if req.Protocol != "c402" || req.Version != 1 {
		return buildResult(action, df, nil, 0, fmt.Errorf("unsupported c402 payload version"))
	}
	if req.RequestID == "" || req.InputCommitment == "" {
		return buildResult(action, df, nil, 0, fmt.Errorf("requestId and inputCommitment are required"))
	}

	e.mu.Lock()
	e.assessmentCount++
	e.lastRequestID = req.RequestID
	e.mu.Unlock()

	resp := types.CreditAssessmentResponse{
		RequestID:       req.RequestID,
		InputCommitment: req.InputCommitment,
		OutputSchema:    "credit-score-v1",
		Status:          "accepted",
	}
	data, _ := json.Marshal(resp)

	return buildResult(action, df, data, 1, nil)
}
