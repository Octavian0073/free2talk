package models

import "time"

// Message mirrors the messages table row exactly.
// OriginalText is in the sender's language.
// TranslatedText is in the recipient's language (may equal OriginalText when
// both users share the same language, or when translation failed and the
// original was stored as fallback).
type Message struct {
	ID             string    `json:"id"`
	SenderID       string    `json:"sender_id"`
	RecipientID    string    `json:"recipient_id"`
	OriginalText   string    `json:"original_text"`
	TranslatedText string    `json:"translated_text"`
	SourceLang     string    `json:"source_lang"`
	TargetLang     string    `json:"target_lang"`
	CreatedAt      time.Time `json:"created_at"`
}
