package main

import (
	"context"
	"testing"

	acp "github.com/coder/acp-go-sdk"
)

type suggestionRecorder struct {
	sessionUpdater
	methods []string
	params  []any
}

func (r *suggestionRecorder) NotifyExtension(_ context.Context, method string, params any) error {
	r.methods = append(r.methods, method)
	r.params = append(r.params, params)
	return nil
}

func promptSuggestionMeta() map[string]any {
	return map[string]any{"claudeCode": map[string]any{
		"options":            map[string]any{"promptSuggestions": true},
		"emitRawSDKMessages": []any{map[string]any{"type": "prompt_suggestion"}},
	}}
}

// TestMockPromptSuggestionFollowsSessionMeta verifies the mock agent mirrors
// Claude ACP: a session that requested suggestions gets one after each turn.
func TestMockPromptSuggestionFollowsSessionMeta(t *testing.T) {
	rec := &suggestionRecorder{}
	a := &mockAgent{conn: rec, sessions: map[acp.SessionId]bool{}}
	a.recordPromptSuggestionRequest("s-on", promptSuggestionMeta())
	a.recordPromptSuggestionRequest("s-off", nil)

	a.emitPromptSuggestion(context.Background(), "s-on", "hello")
	a.emitPromptSuggestion(context.Background(), "s-off", "hello")
	a.emitPromptSuggestion(context.Background(), "s-on", "please answer /no-suggestion")

	if len(rec.methods) != 1 || rec.methods[0] != "_claude/sdkMessage" {
		t.Fatalf("notifications = %v, want exactly one _claude/sdkMessage", rec.methods)
	}
	payload, ok := rec.params[0].(map[string]any)
	if !ok || payload["sessionId"] != "s-on" {
		t.Fatalf("payload = %#v, want session s-on", rec.params[0])
	}
	message, _ := payload["message"].(map[string]any)
	if message["type"] != "prompt_suggestion" || message["suggestion"] != mockPromptSuggestion {
		t.Fatalf("message = %#v, want prompt_suggestion %q", message, mockPromptSuggestion)
	}
}
