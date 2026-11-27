'use client';

import React, { FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { MessageCircle, MessagesSquare, Send, X, Users, User, ArrowLeft, Search, Sparkles } from 'lucide-react';
import { api, API_BASE, ChatMember, ChatMessage } from '../lib/api';

interface FamilyChatDrawerProps {
  familyId?: string | null;
  currentUserId?: string | null;
}

export function FamilyChatDrawer({ familyId, currentUserId }: FamilyChatDrawerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'broadcast' | 'direct'>('broadcast');
  const [selectedRecipient, setSelectedRecipient] = useState<ChatMember | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [members, setMembers] = useState<ChatMember[]>([]);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const [memberSearch, setMemberSearch] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastSeenMsgCountRef = useRef(0);
  const requestSeqRef = useRef(0);
  const inFlightRef = useRef(false);

  // Auto-scroll to bottom of chat
  const scrollToBottom = useCallback((smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  // Fetch family members list
  const loadMembers = useCallback(async () => {
    if (!familyId) return;
    try {
      const data = await api<ChatMember[]>(`/families/${familyId}/chat/members`);
      setMembers(data);
    } catch {
      // Ignored if unauthenticated or not ready
    }
  }, [familyId]);

  // Fetch messages (guarded against stale room overwrites & overlapping polls)
  const loadMessages = useCallback(async (isInitial = false) => {
    if (!familyId) return;
    if (!isInitial && inFlightRef.current) return;
    const seq = ++requestSeqRef.current;
    inFlightRef.current = true;
    try {
      const url = activeTab === 'direct' && selectedRecipient
        ? `/families/${familyId}/chat/messages?recipient_id=${selectedRecipient.user_id}`
        : `/families/${familyId}/chat/messages`;
      const data = await api<ChatMessage[]>(url);
      if (seq !== requestSeqRef.current) return;
      setMessages(data);

      if (isInitial || isOpen) {
        scrollToBottom(!isInitial);
        lastSeenMsgCountRef.current = data.length;
        setUnreadCount(0);
      } else if (data.length > lastSeenMsgCountRef.current) {
        setUnreadCount(data.length - lastSeenMsgCountRef.current);
      }
    } catch {
      // Ignored if network fluctuation
    } finally {
      if (seq === requestSeqRef.current) {
        inFlightRef.current = false;
      }
    }
  }, [familyId, activeTab, selectedRecipient, isOpen, scrollToBottom]);

  // Initial load
  useEffect(() => {
    if (familyId) {
      void loadMembers();
      void loadMessages(true);
    }
  }, [familyId, loadMembers, loadMessages]);

  // Real-time Server-Sent Events (SSE) subscription (pauses when tab is hidden, 30s safety fallback)
  useEffect(() => {
    if (!familyId) return;
    let source: EventSource | null = null;

    const connectStream = () => {
      if (typeof window === 'undefined' || typeof EventSource === 'undefined' || !API_BASE) return;
      if (document.hidden || source) return;
      try {
        source = new EventSource(
          `${API_BASE}/families/${encodeURIComponent(familyId)}/chat/stream`,
          { withCredentials: true },
        );
        source.addEventListener('chat_update', () => {
          void loadMessages(false);
        });
      } catch {
        source = null;
      }
    };

    const disconnectStream = () => {
      if (source) {
        source.close();
        source = null;
      }
    };

    connectStream();

    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void loadMessages(false);
    }, 30000);

    const onVisibility = () => {
      if (document.hidden) {
        disconnectStream();
      } else {
        connectStream();
        void loadMessages(false);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      disconnectStream();
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [familyId, isOpen, loadMessages]);

  // Reset unread count when opened
  useEffect(() => {
    if (isOpen) {
      setUnreadCount(0);
      lastSeenMsgCountRef.current = messages.length;
      setTimeout(() => scrollToBottom(false), 80);
    }
  }, [isOpen, messages.length, scrollToBottom]);

  // Handle message submission
  const handleSendMessage = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    const content = inputText.trim();
    if (!content || !familyId || sending) return;

    setSending(true);
    setSendError('');
    try {
      const payload: { content: string; recipient_id?: string } = { content };
      if (activeTab === 'direct' && selectedRecipient) {
        payload.recipient_id = selectedRecipient.user_id;
      }
      const sentMsg = await api<ChatMessage>(`/families/${familyId}/chat/messages`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      setInputText('');
      setMessages((prev) => [...prev, sentMsg]);
      setTimeout(() => scrollToBottom(true), 50);
    } catch {
      setSendError('Зурвас илгээхэд алдаа гарлаа. Дахин оролдоно уу.');
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSendMessage();
    }
  };

  if (!familyId) return null;

  const roleLabel = (role: string) => {
    if (role === 'owner') return '👑 Эзэмшигч';
    if (role === 'editor') return '✏️ Засварлагч';
    return '👤 Гишүүн';
  };

  return (
    <>
      {/* Floating Messenger Launch Button */}
      {!isOpen && (
        <button
          type="button"
          className="family-chat-fab"
          onClick={() => setIsOpen(true)}
          aria-label="Гэр бүлийн чат нээх"
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            zIndex: 999,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '10px',
            padding: '12px 20px',
            borderRadius: '30px',
            background: 'var(--ui-primary)',
            color: 'var(--ui-primary-contrast)',
            border: '1.5px solid var(--gold-border)',
            boxShadow: 'var(--ui-shadow-md)',
            cursor: 'pointer',
            fontSize: '13.5px',
            fontWeight: 600,
            transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-2px) scale(1.02)';
            e.currentTarget.style.boxShadow = 'var(--ui-shadow-modal)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0) scale(1)';
            e.currentTarget.style.boxShadow = 'var(--ui-shadow-md)';
          }}
        >
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <MessagesSquare size={19} />
            {unreadCount > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: '-8px',
                  right: '-10px',
                  background: 'var(--ui-danger)',
                  color: 'var(--ui-primary-contrast)',
                  fontSize: '10.5px',
                  fontWeight: 700,
                  width: '18px',
                  height: '18px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '2px solid var(--ui-primary)',
                }}
              >
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </div>
          <span>Гэр бүлийн яриа</span>
        </button>
      )}

      {/* Expanded Messenger Window / Drawer */}
      {isOpen && (
        <div
          className="family-chat-panel"
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            width: '390px',
            maxWidth: 'calc(100vw - 32px)',
            height: '560px',
            maxHeight: 'calc(100dvh - 48px)',
            background: 'var(--ui-surface)',
            color: 'var(--ui-text)',
            borderRadius: '20px',
            boxShadow: 'var(--ui-shadow-modal)',
            border: '1px solid var(--ui-border)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            zIndex: 1000,
            animation: 'fadeInUp 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '14px 18px',
              background: 'var(--ui-primary)',
              color: 'var(--ui-primary-contrast)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: '1px solid var(--brand-primary-border)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {activeTab === 'direct' && selectedRecipient ? (
                <button
                  type="button"
                  onClick={() => setSelectedRecipient(null)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--ui-primary-contrast)',
                    cursor: 'pointer',
                    padding: '2px',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                  title="Буцах"
                >
                  <ArrowLeft size={18} />
                </button>
              ) : (
                <div
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '10px',
                    background: 'var(--brand-primary-soft)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <MessageCircle size={18} color="var(--ui-primary-contrast)" />
                </div>
              )}
              <div>
                <h4 style={{ margin: 0, fontSize: '14.5px', fontWeight: 700, letterSpacing: '-0.2px' }}>
                  {activeTab === 'direct' && selectedRecipient
                    ? (selectedRecipient.person_name || selectedRecipient.display_name)
                    : 'Гэр бүлийн танхим'}
                </h4>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', opacity: 0.85 }}>
                  <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--gold-400)', display: 'inline-block' }} />
                  <span>
                    {activeTab === 'direct' && selectedRecipient
                      ? roleLabel(selectedRecipient.role)
                      : `${members.length} гишүүн оролцож байна`}
                  </span>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIsOpen(false)}
              style={{
                background: 'var(--brand-primary-soft)',
                border: 'none',
                color: 'var(--ui-primary-contrast)',
                borderRadius: '8px',
                width: '28px',
                height: '28px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'background 0.15s ease',
              }}
              title="Хаах"
            >
              <X size={16} />
            </button>
          </div>

          {/* Navigation Tabs (Broadcast vs Direct) */}
          <div
            style={{
              display: 'flex',
              borderBottom: '1px solid var(--ui-border)',
              background: 'var(--ui-surface-subtle)',
            }}
          >
            <button
              type="button"
              onClick={() => {
                setActiveTab('broadcast');
                setSelectedRecipient(null);
              }}
              style={{
                flex: 1,
                padding: '9px 12px',
                border: 'none',
                borderBottom: activeTab === 'broadcast' ? '2.5px solid var(--ui-accent-bright)' : '2.5px solid transparent',
                background: 'none',
                fontSize: '12.5px',
                fontWeight: activeTab === 'broadcast' ? 700 : 500,
                color: activeTab === 'broadcast' ? 'var(--ui-text)' : 'var(--ui-text-muted)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
              }}
            >
              <Users size={14} /> Нийтийн яриа
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('direct')}
              style={{
                flex: 1,
                padding: '9px 12px',
                border: 'none',
                borderBottom: activeTab === 'direct' ? '2.5px solid var(--ui-accent-bright)' : '2.5px solid transparent',
                background: 'none',
                fontSize: '12.5px',
                fontWeight: activeTab === 'direct' ? 700 : 500,
                color: activeTab === 'direct' ? 'var(--ui-text)' : 'var(--ui-text-muted)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
              }}
            >
              <User size={14} /> Хувийн зурвас
            </button>
          </div>

          {/* DIRECT TAB: Relative Picker if no recipient selected */}
          {activeTab === 'direct' && !selectedRecipient && (
            <div style={{ flex: 1, overflowY: 'auto', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ position: 'relative' }}>
                <Search size={14} style={{ position: 'absolute', left: '10px', top: '9px', color: 'var(--ui-text-muted)' }} />
                <input
                  type="text"
                  placeholder="Гишүүн хайх…"
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                  className="ui-input"
                  style={{ paddingLeft: '30px', fontSize: '12.5px' }}
                />
              </div>

              <div style={{ fontSize: '11.5px', color: 'var(--ui-text-muted)', margin: '4px 0 2px' }}>
                Зурвас бичих хамаатан, гишүүнээ сонгоно уу:
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {members
                  .filter((m) => m.user_id !== currentUserId)
                  .filter((m) => {
                    if (!memberSearch.trim()) return true;
                    const q = memberSearch.toLowerCase();
                    return m.display_name.toLowerCase().includes(q) || (m.person_name && m.person_name.toLowerCase().includes(q));
                  })
                  .map((m) => (
                    <div
                      key={m.user_id}
                      onClick={() => setSelectedRecipient(m)}
                      style={{
                        padding: '10px 12px',
                        borderRadius: '10px',
                        background: 'var(--ui-surface-subtle)',
                        border: '1px solid var(--ui-border)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div
                          style={{
                            width: '32px',
                            height: '32px',
                            borderRadius: '50%',
                            background: 'var(--ui-info-bg)',
                            color: 'var(--ui-info-text)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 700,
                            fontSize: '12px',
                          }}
                        >
                          {(m.person_name || m.display_name || '?')[0]}
                        </div>
                        <div>
                          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--ui-text)' }}>
                            {m.person_name || m.display_name}
                          </div>
                          {m.person_name && m.person_name !== m.display_name && (
                            <div style={{ fontSize: '10.5px', color: 'var(--ui-text-muted)' }}>{m.display_name}</div>
                          )}
                        </div>
                      </div>
                      <span
                        style={{
                          fontSize: '10.5px',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          background: 'var(--ui-surface-elevated)',
                          border: '1px solid var(--ui-border)',
                          color: 'var(--ui-text-secondary)',
                          fontWeight: 500,
                        }}
                      >
                        {roleLabel(m.role)}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* CHAT MESSAGES BODY (for broadcast OR direct when recipient selected) */}
          {(activeTab === 'broadcast' || (activeTab === 'direct' && selectedRecipient)) && (
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                background: 'var(--ui-bg)',
              }}
            >
              {messages.length === 0 ? (
                <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--ui-text-muted)', padding: '24px 16px' }}>
                  <MessageCircle size={32} style={{ margin: '0 auto 8px', opacity: 0.5 }} />
                  <p style={{ margin: '0 0 4px', fontSize: '13px', fontWeight: 600, color: 'var(--ui-text)' }}>
                    {activeTab === 'broadcast' ? 'Гэр бүлийн яриа эхлээгүй байна' : 'Хувийн зурвас хараахан алга'}
                  </p>
                  <p style={{ margin: 0, fontSize: '11.5px' }}>
                    Та эхний зурвасыг бичиж яриагаа эхлүүлээрэй!
                  </p>
                </div>
              ) : (
                messages.map((msg) => {
                  const isMine = msg.sender_id === currentUserId;
                  const timeFormatted = new Date(msg.created_at).toLocaleTimeString('mn-MN', {
                    hour: '2-digit',
                    minute: '2-digit',
                  });

                  return (
                    <div
                      key={msg.id}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: isMine ? 'flex-end' : 'flex-start',
                      }}
                    >
                      {!isMine && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px', marginLeft: '4px' }}>
                          <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--ui-text)' }}>
                            {msg.sender_name}
                          </span>
                          <span style={{ fontSize: '9.5px', color: 'var(--ui-text-secondary)', background: 'var(--ui-surface-subtle)', border: '1px solid var(--ui-border)', padding: '1px 4px', borderRadius: '4px' }}>
                            {roleLabel(msg.sender_role)}
                          </span>
                        </div>
                      )}

                      <div
                        style={{
                          maxWidth: '82%',
                          padding: '10px 14px',
                          borderRadius: isMine ? '16px 16px 3px 16px' : '16px 16px 16px 3px',
                          background: isMine ? 'var(--ui-primary)' : 'var(--ui-surface)',
                          color: isMine ? 'var(--ui-primary-contrast)' : 'var(--ui-text)',
                          border: isMine ? '1px solid var(--brand-primary-border)' : '1px solid var(--ui-border)',
                          boxShadow: 'var(--ui-shadow-sm)',
                          fontSize: '13px',
                          lineHeight: 1.45,
                          wordBreak: 'break-word',
                          whiteSpace: 'pre-wrap',
                        }}
                      >
                        {msg.content}
                      </div>

                      <span
                        style={{
                          fontSize: '10px',
                          color: 'var(--ui-text-muted)',
                          marginTop: '3px',
                          marginRight: isMine ? '4px' : 0,
                          marginLeft: isMine ? 0 : '4px',
                        }}
                      >
                        {timeFormatted}
                      </span>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>
          )}

          {sendError && (
            <div
              role="alert"
              style={{
                padding: '8px 12px',
                fontSize: '12px',
                background: 'var(--ui-danger-bg)',
                color: 'var(--ui-danger-text)',
                borderTop: '1px solid var(--ui-danger-border)',
              }}
            >
              {sendError}
            </div>
          )}

          {/* INPUT BAR (active when in broadcast OR direct with recipient) */}
          {(activeTab === 'broadcast' || (activeTab === 'direct' && selectedRecipient)) && (
            <form
              onSubmit={handleSendMessage}
              style={{
                padding: '10px 12px',
                borderTop: '1px solid var(--ui-border)',
                background: 'var(--ui-surface)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  activeTab === 'broadcast'
                    ? 'Гэр бүлийнхэндээ зурвас бичих…'
                    : `${selectedRecipient?.person_name || selectedRecipient?.display_name}-д зурвас бичих…`
                }
                disabled={sending}
                style={{
                  flex: 1,
                  padding: '9px 12px',
                  borderRadius: '20px',
                  border: '1px solid var(--ui-input-border)',
                  fontSize: '13px',
                  outline: 'none',
                  background: 'var(--ui-input-bg)',
                  color: 'var(--ui-input-text)',
                }}
              />
              <button
                type="submit"
                disabled={!inputText.trim() || sending}
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  background: !inputText.trim() || sending ? 'var(--ui-border-strong)' : 'var(--ui-primary)',
                  color: 'var(--ui-primary-contrast)',
                  border: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: !inputText.trim() || sending ? 'not-allowed' : 'pointer',
                  transition: 'background 0.15s ease',
                  flexShrink: 0,
                }}
                title="Илгээх (Enter)"
              >
                <Send size={16} />
              </button>
            </form>
          )}
        </div>
      )}
    </>
  );
}
