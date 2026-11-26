'use client';

import React, { FormEvent, KeyboardEvent, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  Check,
  Crown,
  Edit3,
  MessageCircle,
  MessagesSquare,
  Search,
  Send,
  Shield,
  User,
  Users,
} from 'lucide-react';
import { api, API_BASE, ChatMember, ChatMessage, User as CurrentUser } from '../../lib/api';

function ChatContent() {
  const searchParams = useSearchParams();
  const familyId = searchParams.get('family') || '';
  const initialRecipientId = searchParams.get('user') || '';

  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [activeTab, setActiveTab] = useState<'broadcast' | 'direct'>(initialRecipientId ? 'direct' : 'broadcast');
  const [selectedRecipient, setSelectedRecipient] = useState<ChatMember | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [members, setMembers] = useState<ChatMember[]>([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [mobileShowChat, setMobileShowChat] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom of conversation
  const scrollToBottom = useCallback((smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  // Fetch current user
  useEffect(() => {
    let mounted = true;
    api<CurrentUser>('/auth/me')
      .then((user) => {
        if (mounted) setCurrentUser(user);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  // Fetch family members
  const loadMembers = useCallback(async () => {
    if (!familyId) return;
    try {
      const data = await api<ChatMember[]>(`/families/${familyId}/chat/members`);
      setMembers(data);
      if (initialRecipientId && !selectedRecipient) {
        const found = data.find((m) => m.user_id === initialRecipientId);
        if (found) {
          setSelectedRecipient(found);
          setActiveTab('direct');
          setMobileShowChat(true);
        }
      }
    } catch {
      // Ignored if unauthenticated or network issue
    }
  }, [familyId, initialRecipientId, selectedRecipient]);

  const requestSeqRef = useRef(0);
  const inFlightRef = useRef(false);

  // Fetch messages (guarded against stale room overwrites & overlapping polls)
  const loadMessages = useCallback(async (isInitial = false) => {
    if (!familyId) return;
    if (!isInitial && inFlightRef.current) return;
    const seq = ++requestSeqRef.current;
    inFlightRef.current = true;
    try {
      const url =
        activeTab === 'direct' && selectedRecipient
          ? `/families/${familyId}/chat/messages?recipient_id=${selectedRecipient.user_id}`
          : `/families/${familyId}/chat/messages`;
      const data = await api<ChatMessage[]>(url);
      if (seq !== requestSeqRef.current) return;
      setMessages(data);
      if (isInitial) {
        setTimeout(() => scrollToBottom(false), 50);
      }
    } catch {
      // Ignored
    } finally {
      if (seq === requestSeqRef.current) {
        inFlightRef.current = false;
        if (isInitial) setLoading(false);
      }
    }
  }, [familyId, activeTab, selectedRecipient, scrollToBottom]);

  // Initial load
  useEffect(() => {
    if (familyId) {
      setLoading(true);
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
  }, [familyId, loadMessages]);

  // Scroll to bottom when conversation changes or messages arrive
  useEffect(() => {
    scrollToBottom(true);
  }, [messages.length, activeTab, selectedRecipient, scrollToBottom]);

  // Send message handler
  const handleSendMessage = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    const content = inputText.trim();
    if (!content || !familyId || sending) return;

    setSending(true);
    try {
      const payload: { content: string; recipient_id?: string } = { content };
      if (activeTab === 'direct' && selectedRecipient) {
        payload.recipient_id = selectedRecipient.user_id;
      }
      const sentMsg = await api<ChatMessage>(`/families/${familyId}/chat/messages`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      setMessages((prev) => [...prev, sentMsg]);
      setInputText('');
      setTimeout(() => {
        scrollToBottom(true);
        inputRef.current?.focus();
      }, 50);
    } catch {
      // Failed to send
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSendMessage();
    }
  };

  const roleBadge = (role: string) => {
    if (role === 'owner') {
      return (
        <span
          style={{
            fontSize: '11px',
            color: 'var(--ui-warning-text)',
            background: 'var(--ui-warning-bg)',
            border: '1px solid var(--ui-warning-border)',
            padding: '2px 7px',
            borderRadius: '12px',
            fontWeight: 600,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '3px',
          }}
        >
          <Crown size={11} /> Эзэмшигч
        </span>
      );
    }
    if (role === 'editor') {
      return (
        <span
          style={{
            fontSize: '11px',
            color: 'var(--ui-success-text)',
            background: 'var(--ui-success-bg)',
            border: '1px solid var(--ui-success-border)',
            padding: '2px 7px',
            borderRadius: '12px',
            fontWeight: 600,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '3px',
          }}
        >
          <Edit3 size={11} /> Засварлагч
        </span>
      );
    }
    return (
      <span
        style={{
          fontSize: '11px',
          color: 'var(--ui-text-secondary)',
          background: 'var(--ui-surface-subtle)',
          border: '1px solid var(--ui-border)',
          padding: '2px 7px',
          borderRadius: '12px',
          fontWeight: 500,
          display: 'inline-flex',
          alignItems: 'center',
          gap: '3px',
        }}
      >
        <User size={11} /> Гишүүн
      </span>
    );
  };

  const filteredMembers = useMemo(() => {
    return members
      .filter((m) => m.user_id !== currentUser?.id)
      .filter((m) => {
        if (!memberSearch.trim()) return true;
        const q = memberSearch.toLowerCase();
        return (
          m.display_name.toLowerCase().includes(q) ||
          (m.person_name && m.person_name.toLowerCase().includes(q))
        );
      });
  }, [members, currentUser, memberSearch]);

  if (!familyId) {
    return (
      <main aria-label="Гэр бүлийн яриа" style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--ui-text-muted)' }}>
        <MessagesSquare size={48} style={{ margin: '0 auto 16px', opacity: 0.4 }} />
        <h3 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--ui-text)', margin: '0 0 8px' }}>
          Гэр бүлийн сонголт хийгдээгүй байна
        </h3>
        <p style={{ fontSize: '14px', margin: 0 }}>
          Зурвас харилцахын тулд дээд хэсгээс гэр бүлээ сонгоно уу.
        </p>
      </main>
    );
  }

  return (
    <main
      aria-label="Гэр бүлийн яриа"
      className="chat-shell"
      style={{
        display: 'flex',
        height: 'calc(100vh - 80px)',
        maxHeight: '920px',
        background: 'var(--ui-surface)',
        color: 'var(--ui-text)',
        borderRadius: '16px',
        border: '1px solid var(--ui-border)',
        boxShadow: 'var(--ui-shadow-sm)',
        overflow: 'hidden',
        margin: '0',
      }}
    >
      {/* LEFT COLUMN: ROOMS & DIRECT RECIPIENTS */}
      <div
        style={{
          width: '320px',
          borderRight: '1px solid var(--ui-border)',
          background: 'var(--ui-surface-subtle)',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
        }}
        className={`chat-sidebar${mobileShowChat ? ' chat-contacts-mobile-hidden' : ''}`}
      >
        {/* Header */}
        <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--ui-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: 'var(--ui-text)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <MessagesSquare size={20} style={{ color: 'var(--ui-accent-bright)' }} />
              Гэр бүлийн яриа
            </h2>
            <span style={{ fontSize: '12px', color: 'var(--ui-text-muted)', fontWeight: 600 }}>
              {members.length} гишүүн
            </span>
          </div>

          {/* Search Box */}
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: '10px', top: '10px', color: 'var(--ui-text-muted)' }} />
            <input
              type="text"
              placeholder="Гишүүн хайх…"
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              className="ui-input"
              style={{ paddingLeft: '32px' }}
            />
          </div>
        </div>

        {/* Channels List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
          {/* 1. General Family Broadcast Channel */}
          <div
            onClick={() => {
              setActiveTab('broadcast');
              setSelectedRecipient(null);
              setMobileShowChat(true);
            }}
            style={{
              padding: '12px 14px',
              borderRadius: '12px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              background: activeTab === 'broadcast' ? 'var(--ui-surface-elevated)' : 'transparent',
              border: activeTab === 'broadcast' ? '1px solid var(--ui-border-strong)' : '1px solid transparent',
              boxShadow: activeTab === 'broadcast' ? 'var(--ui-shadow-sm)' : 'none',
              marginBottom: '10px',
              transition: 'all 0.15s ease',
            }}
          >
            <div
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '12px',
                background: 'var(--ui-primary)',
                color: 'var(--ui-primary-contrast)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Users size={20} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--ui-text)', marginBottom: '2px' }}>
                Бүх гэр бүлийн танхим
              </div>
              <div style={{ fontSize: '12px', color: 'var(--ui-text-muted)', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--gold-400)', display: 'inline-block' }} />
                Нийтийн нээлттэй суваг
              </div>
            </div>
          </div>

          <div
            style={{
              fontSize: '11px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '1px',
              color: 'var(--ui-text-muted)',
              margin: '16px 6px 8px',
            }}
          >
            Хувийн зурвас (Direct)
          </div>

          {/* 2. Direct Contacts List */}
          {filteredMembers.length === 0 ? (
            <div style={{ padding: '20px 10px', textAlign: 'center', fontSize: '12.5px', color: 'var(--ui-text-muted)' }}>
              {memberSearch.trim() ? 'Хайлтад тохирох гишүүн олдсонгүй.' : 'Одоогоор өөр гишүүн нэгдээгүй байна.'}
            </div>
          ) : (
            filteredMembers.map((member) => {
              const isSelected = activeTab === 'direct' && selectedRecipient?.user_id === member.user_id;
              const initialLetter = (member.person_name || member.display_name || '?')[0].toUpperCase();

              return (
                <div
                  key={member.user_id}
                  onClick={() => {
                    setActiveTab('direct');
                    setSelectedRecipient(member);
                    setMobileShowChat(true);
                  }}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '10px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    background: isSelected ? 'var(--ui-surface-elevated)' : 'transparent',
                    border: isSelected ? '1px solid var(--ui-border-strong)' : '1px solid transparent',
                    boxShadow: isSelected ? 'var(--ui-shadow-sm)' : 'none',
                    marginBottom: '4px',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div
                    style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '50%',
                      background: isSelected ? 'var(--ui-info-bg)' : 'var(--ui-surface-elevated)',
                      color: isSelected ? 'var(--ui-info-text)' : 'var(--ui-text-secondary)',
                      border: '1px solid var(--ui-border)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '14px',
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {initialLetter}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13.5px', fontWeight: isSelected ? 700 : 600, color: 'var(--ui-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {member.person_name || member.display_name}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--ui-text-muted)', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                      {roleBadge(member.role)}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* RIGHT COLUMN: CONVERSATION VIEW & INPUT */}
      <div
        className={`chat-thread${!mobileShowChat ? ' chat-thread-mobile-hidden' : ''}`}
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--ui-surface)',
          position: 'relative',
        }}
      >
        {/* Active Header */}
        <div
          style={{
            padding: '14px 16px',
            borderBottom: '1px solid var(--ui-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--ui-surface)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
            {/* Mobile Back Button */}
            <button
              type="button"
              onClick={() => setMobileShowChat(false)}
              className="chat-mobile-back-btn"
              aria-label="Сувгийн жагсаалт руу буцах"
              style={{
                background: 'var(--ui-surface-subtle)',
                border: '1px solid var(--ui-border)',
                borderRadius: '10px',
                width: '38px',
                height: '38px',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                display: 'none',
                color: 'var(--ui-text)',
                flexShrink: 0,
              }}
              title="Жагсаалт руу буцах"
            >
              <ArrowLeft size={18} />
            </button>

            <div
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '10px',
                background: activeTab === 'broadcast' ? 'var(--ui-accent-soft)' : 'var(--ui-info-bg)',
                color: activeTab === 'broadcast' ? 'var(--ui-accent-text)' : 'var(--ui-info-text)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {activeTab === 'broadcast' ? <Users size={18} /> : <User size={18} />}
            </div>

            <div>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--ui-text)' }}>
                {activeTab === 'broadcast'
                  ? 'Бүх гэр бүлийн танхим'
                  : selectedRecipient?.person_name || selectedRecipient?.display_name || 'Сонгосон гишүүн'}
              </h3>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--ui-text-muted)' }}>
                {activeTab === 'broadcast'
                  ? `Бүх гишүүд харах боломжтой нийтийн яриа • ${members.length} оролцогч`
                  : `Хоёр талын нууцлалтай хувийн яриа`}
              </p>
            </div>
          </div>
        </div>

        {/* Message Stream */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '20px 24px',
            background: 'var(--ui-bg)',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
          }}
        >
          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--ui-text-muted)', fontSize: '13px' }}>
              Зурвасуудыг ачаалж байна…
            </div>
          ) : messages.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--ui-text-muted)' }}>
              <MessageCircle size={40} style={{ margin: '0 auto 12px', opacity: 0.35 }} />
              <div style={{ fontSize: '14.5px', fontWeight: 600, color: 'var(--ui-text)', marginBottom: '6px' }}>
                Энд хараахан зурвас бичигдээгүй байна
              </div>
              <div style={{ fontSize: '12.5px', maxWidth: '340px', margin: '0 auto' }}>
                {activeTab === 'broadcast'
                  ? 'Гэр бүлийнхэндээ мэндчилгээ илгээж яриагаа эхлүүлнэ үү.'
                  : `${selectedRecipient?.person_name || selectedRecipient?.display_name}-д хувийн зурвас бичиж болно.`}
              </div>
            </div>
          ) : (
            messages.map((msg) => {
              const isMine = currentUser && msg.sender_id === currentUser.id;
              const dateObj = new Date(msg.created_at);
              const timeFormatted = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

              return (
                <div
                  key={msg.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: isMine ? 'flex-end' : 'flex-start',
                    maxWidth: '100%',
                  }}
                >
                  {!isMine && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', marginLeft: '6px' }}>
                      <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--ui-text)' }}>
                        {msg.sender_name}
                      </span>
                      {roleBadge(msg.sender_role)}
                    </div>
                  )}

                  <div
                    style={{
                      maxWidth: '70%',
                      padding: '11px 16px',
                      borderRadius: isMine ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                      background: isMine ? 'var(--ui-primary)' : 'var(--ui-surface)',
                      color: isMine ? 'var(--ui-primary-contrast)' : 'var(--ui-text)',
                      border: isMine ? '1px solid var(--brand-primary-border)' : '1px solid var(--ui-border)',
                      boxShadow: 'var(--ui-shadow-sm)',
                      fontSize: '14px',
                      lineHeight: 1.5,
                      wordBreak: 'break-word',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {msg.content}
                  </div>

                  <span
                    style={{
                      fontSize: '10.5px',
                      color: 'var(--ui-text-muted)',
                      marginTop: '4px',
                      marginRight: isMine ? '6px' : 0,
                      marginLeft: isMine ? 0 : '6px',
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

        {/* Input Bar */}
        <form
          onSubmit={handleSendMessage}
          style={{
            padding: '14px 20px',
            borderTop: '1px solid var(--ui-border)',
            background: 'var(--ui-surface)',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <input
            ref={inputRef}
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              activeTab === 'broadcast'
                ? 'Гэр бүлийнхэндээ зурвас бичих… (Enter дарж илгээнэ)'
                : `${selectedRecipient?.person_name || selectedRecipient?.display_name}-д зурвас бичих…`
            }
            disabled={sending}
            style={{
              flex: 1,
              padding: '11px 16px',
              borderRadius: '24px',
              border: '1px solid var(--ui-input-border)',
              fontSize: '14px',
              outline: 'none',
              background: 'var(--ui-input-bg)',
              color: 'var(--ui-input-text)',
            }}
          />
          <button
            type="submit"
            disabled={!inputText.trim() || sending}
            style={{
              padding: '10px 20px',
              borderRadius: '24px',
              background: !inputText.trim() || sending ? 'var(--ui-border-strong)' : 'var(--ui-primary)',
              color: 'var(--ui-primary-contrast)',
              border: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontWeight: 600,
              fontSize: '13px',
              cursor: !inputText.trim() || sending ? 'not-allowed' : 'pointer',
              transition: 'background 0.15s ease',
              flexShrink: 0,
            }}
          >
            <Send size={15} /> Илгээх
          </button>
        </form>
      </div>
    </main>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={<div style={{ padding: '40px', textAlign: 'center', color: 'var(--ui-text-muted)' }}>Ачаалж байна…</div>}>
      <ChatContent />
    </Suspense>
  );
}
