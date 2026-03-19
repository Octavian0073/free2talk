// Package chat manages WebSocket connections and real-time message delivery.
package chat

import (
	"context"
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	// pongWait and pingInterval are only used when the client is connected
	// directly (no proxy). When behind a Vite dev-proxy the proxy consumes
	// WebSocket control frames (ping/pong) and never forwards them, so the
	// backend would close the connection every pongWait. We therefore use a
	// generous timeout; production deployments should sit behind a proper
	// reverse proxy that forwards control frames (nginx with proxy_read_timeout).
	pongWait     = 5 * time.Minute
	pingInterval = 2 * time.Minute

	// 32 KB — large enough for SDP offer/answer payloads (~2–4 KB typical).
	maxMessageSize = 32 * 1024

	sendBufferSize = 256
)

// Client represents one authenticated WebSocket connection.
type Client struct {
	userID string
	conn   *websocket.Conn
	send   chan []byte
}

// Hub maintains the set of currently-connected clients and routes messages.
type Hub struct {
	mu         sync.RWMutex
	clients    map[string]*Client
	register   chan *Client
	unregister chan *Client
	db         *pgxpool.Pool
}

func NewHub(db *pgxpool.Pool) *Hub {
	return &Hub{
		clients:    make(map[string]*Client),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		db:         db,
	}
}

func (h *Hub) Run() {
	for {
		select {
		case c := <-h.register:
			h.mu.Lock()
			if old, ok := h.clients[c.userID]; ok {
				close(old.send)
			}
			h.clients[c.userID] = c
			h.mu.Unlock()

		case c := <-h.unregister:
			h.mu.Lock()
			if current, ok := h.clients[c.userID]; ok && current == c {
				delete(h.clients, c.userID)
				close(c.send)
			}
			h.mu.Unlock()
		}
	}
}

// Deliver queues msg for userID. No-op if the user is offline.
func (h *Hub) Deliver(userID string, msg []byte) {
	h.mu.RLock()
	c, ok := h.clients[userID]
	h.mu.RUnlock()
	if !ok {
		log.Printf("hub: deliver to %s — user not in hub (offline or not connected)", userID)
		return
	}
	select {
	case c.send <- msg:
	default:
		log.Printf("hub: send buffer full for user %s — dropping connection", userID)
		h.unregister <- c
	}
}

// Route relays a signaling message from fromUserID to toUserID.
// It stamps "from_id" with fromUserID server-side so clients cannot spoof
// their identity in signaling messages.
func (h *Hub) Route(fromUserID, toUserID string, raw map[string]any) {
	raw["from_id"] = fromUserID
	delete(raw, "to") // strip internal routing field before forwarding

	payload, err := json.Marshal(raw)
	if err != nil {
		return
	}
	h.Deliver(toUserID, payload)
}

// inboundMsg is the shape of every client→server WS frame.
// "to" is the target userID; "type" determines how it is handled.
type inboundMsg struct {
	Type string `json:"type"`
	To   string `json:"to"`
}

// allowedSignalingTypes is the set of message types clients may send.
// Any other type is silently dropped.
var allowedSignalingTypes = map[string]bool{
	"call_accept": true,
	"call_offer":  true,
	"call_answer": true,
	"call_ice":    true,
	"call_reject": true,
	"call_hangup": true,
}

func (c *Client) writePump(h *Hub) {
	ticker := time.NewTicker(pingInterval)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case msg, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (c *Client) readPump(h *Hub) {
	defer func() {
		h.unregister <- c
		c.conn.Close()
	}()

	c.conn.SetReadLimit(maxMessageSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, data, err := c.conn.ReadMessage()
		if err != nil {
			break
		}

		// Parse just enough to route the message.
		var header inboundMsg
		if err := json.Unmarshal(data, &header); err != nil {
			continue // malformed — ignore
		}

		if !allowedSignalingTypes[header.Type] {
			continue // unknown type — ignore
		}
		if header.To == "" {
			continue // no target — ignore
		}

		// Decode into a generic map so we can stamp from_id and strip "to"
		// before forwarding. The full payload (SDP, ICE candidate, etc.) is
		// preserved because we decode into map[string]any.
		var raw map[string]any
		if err := json.Unmarshal(data, &raw); err != nil {
			continue
		}

		// SECURITY: verify the sender and target are accepted friends before
		// relaying any signaling message. This prevents a connected user from
		// spamming signaling frames at arbitrary other users.
		var areFriends bool
		if err := h.db.QueryRow(context.Background(), `
			SELECT EXISTS(
				SELECT 1 FROM friendships
				WHERE ((sender_id = $1::uuid AND receiver_id = $2::uuid)
				    OR (sender_id = $2::uuid AND receiver_id = $1::uuid))
				  AND status = 'accepted'
			)`, c.userID, header.To,
		).Scan(&areFriends); err != nil || !areFriends {
			continue // not friends — silently drop
		}

		// SECURITY: from_id is set here from the authenticated client's userID.
		// The client cannot supply a different from_id to impersonate another user.
		h.Route(c.userID, header.To, raw)
	}
}
