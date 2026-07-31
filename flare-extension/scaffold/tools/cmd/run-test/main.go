package main

import (
	"encoding/json"
	"flag"
	"strings"
	"time"

	"extension-scaffold/tools/pkg/configs"
	"extension-scaffold/tools/pkg/fccutils"
	"extension-scaffold/tools/pkg/support"
	instrutils "extension-scaffold/tools/pkg/utils"

	"github.com/ethereum/go-ethereum/common"
	"github.com/flare-foundation/go-flare-common/pkg/logger"
	"github.com/pkg/errors"
)

type creditAssessmentResponse struct {
	RequestID       string `json:"requestId"`
	InputCommitment string `json:"inputCommitment"`
	OutputSchema    string `json:"outputSchema"`
	Status          string `json:"status"`
}

func main() {
	af := flag.String("a", configs.AddressesFile, "file with deployed addresses")
	cf := flag.String("c", configs.ChainNodeURL, "chain node url")
	pf := flag.String("p", configs.ExtensionProxyURL, "extension proxy url")
	instructionSenderF := flag.String("instructionSender", "", "instructionSender address")
	flag.Parse()

	instructionSenderAddress := common.HexToAddress(*instructionSenderF)

	testSupport, err := support.DefaultSupport(*af, *cf)
	if err != nil {
		fccutils.FatalWithCause(err)
	}

	logger.Infof("Setting extension ID on instruction sender...")
	err = instrutils.SetExtensionId(testSupport, instructionSenderAddress)
	if err != nil {
		if strings.Contains(err.Error(), "already set") || strings.Contains(err.Error(), "Extension ID already set") {
			logger.Infof("Extension ID already set on contract, continuing")
		} else {
			logger.Errorf("setExtensionId failed: %s", err)
			fccutils.FatalWithCause(errors.Errorf(
				"setExtensionId failed — is the extension registered? Check that pre-build.sh completed successfully. Error: %s", err))
		}
	}

	logger.Infof("Sending CREDIT_SCORE/ASSESS instruction...")
	payload, err := json.Marshal(map[string]interface{}{
		"protocol":                  "c402",
		"version":                   1,
		"requestId":                 "0xtest",
		"requirementHash":           "0xrequirement",
		"encryptedInput":            map[string]interface{}{"ciphertext": "0xencrypted"},
		"clientOutputEncryptionKey": "0xpublic",
		"inputCommitment":           "0xinput",
		"nonce":                     "0xnonce",
	})
	if err != nil {
		fccutils.FatalWithCause(err)
	}

	instructionId, _, err := instrutils.SendAssessCredit(testSupport, instructionSenderAddress, payload)
	if err != nil {
		fccutils.FatalWithCause(err)
	}
	logger.Infof("Instruction sent. ID: %s", instructionId.Hex())

	time.Sleep(5 * time.Second)

	err = verifyAssessCreditResult(*pf, instructionId)
	if err != nil {
		fccutils.FatalWithCause(err)
	}
	logger.Infof("Test passed: CREDIT_SCORE/ASSESS instruction processed successfully")
}

func verifyAssessCreditResult(proxyURL string, instructionId common.Hash) error {
	actionResponse, err := fccutils.ActionResult(proxyURL, instructionId)
	if err != nil {
		return err
	}
	actionResult := actionResponse.Result

	if actionResult.Status == 0 {
		return errors.Errorf("instruction processing failed: %s", actionResult.Log)
	}
	if actionResult.Status == 2 {
		return errors.New("instruction still pending after polling, expected completed")
	}
	if len(actionResult.Data) == 0 {
		return errors.New("expected response data but got none")
	}

	var resp creditAssessmentResponse
	err = json.Unmarshal(actionResult.Data, &resp)
	if err != nil {
		return errors.Errorf("failed to unmarshal response: %s", err)
	}
	if resp.RequestID == "" || resp.InputCommitment == "" || resp.Status != "accepted" {
		return errors.Errorf("unexpected response: %+v", resp)
	}

	logger.Infof("Response data: %+v", resp)
	return nil
}
