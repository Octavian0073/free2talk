// Package translate provides a thin client for the self-hosted LibreTranslate
// REST API. It is intentionally minimal: one method, explicit timeout, no
// retry logic. The caller is responsible for fallback behaviour on error.
package translate

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// Client calls a LibreTranslate instance over HTTP.
type Client struct {
	baseURL    string
	httpClient *http.Client
}

// NewClient returns a Client that talks to the LibreTranslate instance at
// baseURL (e.g. "http://localhost:5000"). A 5-second timeout is enforced on
// every request so a slow or unavailable service never blocks a message send.
func NewClient(baseURL string) *Client {
	return &Client{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 5 * time.Second,
		},
	}
}

type translateRequest struct {
	Q      string `json:"q"`
	Source string `json:"source"`
	Target string `json:"target"`
	Format string `json:"format"`
}

type translateResponse struct {
	TranslatedText string `json:"translatedText"`
}

// Translate sends text to LibreTranslate and returns the translated string.
// Returns an error if the HTTP call fails, times out, or the response is
// malformed. The caller should fall back to the original text on any error.
func (c *Client) Translate(text, sourceLang, targetLang string) (string, error) {
	payload, err := json.Marshal(translateRequest{
		Q:      text,
		Source: sourceLang,
		Target: targetLang,
		Format: "text",
	})
	if err != nil {
		return "", fmt.Errorf("translate: marshal: %w", err)
	}

	resp, err := c.httpClient.Post(
		c.baseURL+"/translate",
		"application/json",
		bytes.NewReader(payload),
	)
	if err != nil {
		return "", fmt.Errorf("translate: request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("translate: status %d", resp.StatusCode)
	}

	var result translateResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("translate: decode: %w", err)
	}

	return result.TranslatedText, nil
}
