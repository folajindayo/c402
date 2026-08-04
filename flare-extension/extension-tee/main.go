package main

import (
	"encoding/json"
	"log"
	"net/http"
)

// This is a minimal handler contract for the Flare FCC scaffold. In a live
// extension, wire this operation into the scaffold's action decoder and use
// enclave-held keys for decrypting input and signing ComputeReceipt.
type CreditScoreAction struct {
	OPType      string          `json:"opType"`
	OPCommand   string          `json:"opCommand"`
	RequestID   string          `json:"requestId"`
	PaymentID   string          `json:"paymentId"`
	PriceAtomic string          `json:"priceAtomic"`
	Payload     json.RawMessage `json:"payload"`
}

func main() {
	http.HandleFunc("/action", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var action CreditScoreAction
		if err := json.NewDecoder(r.Body).Decode(&action); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if action.OPType != "CREDIT_SCORE" || action.OPCommand != "ASSESS" {
			http.Error(w, "unsupported op type or command", http.StatusBadRequest)
			return
		}

		// The official FCC scaffold must provide enclave crypto, model execution,
		// output encryption, and registered TEE receipt signing around this action.
		http.Error(w, "wire this handler into the official Flare FCC scaffold", http.StatusNotImplemented)
	})

	log.Println("c402 FCC credit extension handler listening on :6674")
	log.Fatal(http.ListenAndServe(":6674", nil))
}
