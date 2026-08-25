import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable, TextInput, ActivityIndicator,
  KeyboardAvoidingView, Platform, PanResponder,
} from 'react-native';
import { F } from '../constants/fonts';
import { C } from '../constants/colors';
import { CARD_W } from '../constants/layout';
import { supabase } from '../lib/supabase';
import ScreenFrame from '../components/ScreenFrame';
import PillButton from '../components/PillButton';
import {
  fetchCoachMessages, sendCoachMessage, deleteCoachMessage, purgeExpiredCoachMessages,
  CHAT_RETENTION_DAYS,
} from '../lib/community';
import { markChatRead } from '../lib/adminInbox';

// ─── Coach ⇄ player DIRECT chat (WhatsApp-style) ────────────────────────────
// A private 1-on-1 chat between ONE player and the coach (admin), distinct from
// the per-group community chat (CommunityChatScreen). The conversation is keyed
// to the player (their "channel"). Shared by both roles via `isAdmin`:
//   • Player  — opens from the COACH card at the top of the Community tab;
//     channel = their own id; the other side renders as COACH.
//   • Admin   — opens from the COACH CHAT tile on PlayerAdminScreen with the
//     `player`; channel = that player's id; posts as COACH; the other side
//     renders as the player's first name; may delete ANY message.
// Ephemeral — kept ~CHAT_RETENTION_DAYS then swept (purge runs on load).
const CHAT_POLL_MS = 3000; // live poll for the mounted life of the screen

const timeOf = (iso) => {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
};

export default function CoachChatScreen({ navigation, route }) {
  const isAdmin = !!route.params?.isAdmin;
  const player = route.params?.player ?? null; // admin only — the channel's player
  const playerFirst = ((player?.full_name || 'PLAYER').trim().split(' ')[0]) || 'PLAYER';

  const [meId, setMeId] = useState(null);
  const [channelId, setChannelId] = useState(isAdmin ? (player?.id ?? null) : null);
  const [messages, setMessages] = useState([]); // oldest→newest (as stored)
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);

  // Admin side only: the newest message this device has already marked read, so
  // the 3s poll doesn't rewrite the local read-mark on every tick.
  const markedRef = useRef(null);

  // Looking at the thread IS reading it (Chat Notes is see-only — no reply
  // required), so any message on screen clears that player's unread badge.
  const markSeen = useCallback((msgs) => {
    if (!isAdmin || !player?.id || msgs.length === 0) return;
    const newest = msgs[msgs.length - 1].created_at;
    if (markedRef.current && newest <= markedRef.current) return;
    markedRef.current = newest;
    markChatRead(player.id, newest);
  }, [isAdmin, player?.id]);

  const load = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const me = user?.id ?? null;
      setMeId(me);
      // Player side: the channel IS their own id. Admin side: the passed player.
      const cid = isAdmin ? (player?.id ?? null) : me;
      setChannelId(cid);
      if (cid) {
        const msgs = await fetchCoachMessages(cid);
        setMessages(msgs);
        markSeen(msgs);
        purgeExpiredCoachMessages(cid); // sweep expired on entry (fire-and-forget)
      }
    } catch (e) {
      console.error('[CoachChatScreen] load:', e);
    }
    setLoading(false);
  }, [isAdmin, player?.id, markSeen]);

  useEffect(() => { load(); }, [load]);

  const refreshMessages = useCallback(async () => {
    if (!channelId) return;
    try {
      const msgs = await fetchCoachMessages(channelId);
      setMessages(msgs);
      markSeen(msgs);
    }
    catch (e) { console.error('[CoachChatScreen] refreshMessages:', e); }
  }, [channelId, markSeen]);

  // Poll for the whole mounted life of the screen — makes chat feel live. NOT
  // focus-gated (same reasoning as CommunityChatScreen — see CLAUDE.md).
  useEffect(() => {
    if (!channelId) return;
    const id = setInterval(refreshMessages, CHAT_POLL_MS);
    return () => clearInterval(id);
  }, [channelId, refreshMessages]);

  async function handleSend() {
    const text = input.trim();
    if (!text || !meId || !channelId || sending) return;
    setSending(true);
    setInput('');
    try {
      await sendCoachMessage(channelId, meId, text);
      await refreshMessages();
    } catch (e) {
      console.error('[CoachChatScreen] handleSend:', e);
      setInput(text); // restore so nothing is lost
    }
    setSending(false);
  }

  // Player unsends their OWN; admin may delete ANY (both allowed by RLS).
  async function handleDelete(messageId) {
    setMessages(prev => prev.filter(msg => msg.id !== messageId)); // optimistic
    try { await deleteCoachMessage(messageId); }
    catch (e) { console.error('[CoachChatScreen] handleDelete:', e); refreshMessages(); }
  }

  // Left-bubble label: on the player's screen the other side is always the COACH;
  // on the admin's screen it's always this player.
  const otherLabel = isAdmin ? playerFirst : 'COACH';

  // Swipe RIGHT anywhere on the screen goes back — mirror of the entry navigation.
  const goBackRef = useRef(() => navigation.goBack());
  goBackRef.current = () => navigation.goBack();
  const swipe = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        g.dx > 18 && Math.abs(g.dx) > Math.abs(g.dy) * 1.6,
      onPanResponderRelease: (_, g) => {
        if (g.dx > 55 && Math.abs(g.dx) > Math.abs(g.dy)) goBackRef.current();
      },
    })
  ).current;

  // Inverted list renders bottom→up, so it wants newest-first data.
  const data = [...messages].reverse();

  const title = isAdmin ? (player?.full_name || 'PLAYER') : 'COACH';

  function renderItem({ item: msg }) {
    const isMe = msg.sender_id === meId;
    const canDelete = isMe || isAdmin;
    return (
      <View style={[styles.msgRow, isMe && styles.msgRowMe]}>
        <View style={[styles.msgBubble, isMe && styles.msgBubbleMe]}>
          {!isMe && <Text style={styles.msgSender}>{otherLabel}</Text>}
          <Text style={styles.msgBody}>{msg.body}</Text>
          <View style={styles.msgMeta}>
            <Text style={styles.msgTime}>{timeOf(msg.created_at)}</Text>
            {canDelete && (
              <Pressable onPress={() => handleDelete(msg.id)} hitSlop={8}>
                <Text style={styles.msgDelete}>{isMe ? 'unsend' : 'delete'}</Text>
              </Pressable>
            )}
          </View>
        </View>
      </View>
    );
  }

  return (
    <ScreenFrame fill maxWidth={CARD_W} ready={!loading}>
      <KeyboardAvoidingView
        style={styles.card}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        {...swipe.panHandlers}
      >
        <View style={styles.header}>
          <View style={styles.headerTopRow}>
            <PillButton label="← BACK" size="sm" tone="jade" onPress={() => navigation.goBack()} />
          </View>
          <Text style={styles.headerTitle} numberOfLines={2}>{title}</Text>
          <Text style={styles.headerSubtitle}>
            {isAdmin ? 'DIRECT CHAT' : 'CHAT WITH YOUR COACH'}
          </Text>
          <View style={styles.headerDivider} />
        </View>

        <View style={styles.body}>
          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={ACCENT} />
            </View>
          ) : data.length === 0 ? (
            <View style={styles.center}>
              <Text style={styles.empty}>
                {isAdmin ? 'No messages yet — reach out.' : 'No messages yet — say hi to your coach.'}
              </Text>
              <Text style={styles.emptyHint}>Messages are kept {CHAT_RETENTION_DAYS} days.</Text>
            </View>
          ) : (
            <FlatList
              data={data}
              inverted
              keyExtractor={(m) => m.id}
              renderItem={renderItem}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            />
          )}
        </View>

        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder={isAdmin ? `Message ${playerFirst} as COACH…` : 'Message your coach…'}
            placeholderTextColor="#4a8a72"
            multiline
            maxLength={1000}
            onSubmitEditing={handleSend}
            blurOnSubmit={false}
          />
          <PillButton
            label="SEND"
            size="sm"
            tone="jade"
            onPress={handleSend}
            loading={sending}
            disabled={!input.trim()}
          />
        </View>
      </KeyboardAvoidingView>
    </ScreenFrame>
  );
}

// Emerald-jade accent — the coach's colour. The COACH card on the Community tab
// is jade, so the direct chat carries the same identity through (title, bubbles,
// divider, input).
const ACCENT = '#1FD79A';

const styles = StyleSheet.create({
  card: { flex: 1 },

  header: { paddingHorizontal: 22, paddingTop: 22 },
  headerTopRow: { flexDirection: 'row', alignItems: 'center' },
  headerTitle: {
    fontFamily: F.heading,
    fontSize: 30,
    color: ACCENT,
    letterSpacing: 4,
    textTransform: 'uppercase',
    textAlign: 'center',
    marginTop: 18,
    textShadowColor: 'rgba(31,215,154,0.5)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 20,
  },
  headerSubtitle: {
    fontFamily: F.bodyMed,
    fontSize: 15,
    color: '#5a7a9a',
    letterSpacing: 2,
    textTransform: 'uppercase',
    textAlign: 'center',
    marginTop: 8,
  },
  headerDivider: { height: 1, backgroundColor: ACCENT, opacity: 0.3, marginTop: 16 },

  body: { flex: 1, paddingHorizontal: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 },
  empty: { fontFamily: F.bodyMed, fontSize: 15, color: '#5a7a9a', letterSpacing: 0.6, textAlign: 'center' },
  emptyHint: { fontFamily: F.bodyMed, fontSize: 12, color: '#3a5a7a', letterSpacing: 0.6 },

  listContent: { paddingVertical: 14 },
  msgRow: { flexDirection: 'row', marginBottom: 10 },
  msgRowMe: { justifyContent: 'flex-end' },
  msgBubble: {
    maxWidth: '82%',
    borderRadius: 14, borderWidth: 1, borderColor: 'rgba(31,215,154,0.25)',
    backgroundColor: C.surface, paddingHorizontal: 14, paddingVertical: 10,
  },
  msgBubbleMe: {
    borderColor: 'rgba(31,215,154,0.55)', backgroundColor: 'rgba(31,215,154,0.10)',
  },
  msgSender: {
    fontFamily: F.heading, fontSize: 12, color: ACCENT,
    letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 4,
  },
  msgBody: { fontFamily: F.bodyMed, fontSize: 15, color: C.text, letterSpacing: 0.2, lineHeight: 21 },
  msgMeta: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 5 },
  msgTime: { fontFamily: F.bodyMed, fontSize: 11, color: '#4a6a8a', letterSpacing: 0.4 },
  msgDelete: { fontFamily: F.bodyMed, fontSize: 11, color: '#5a7a9a', letterSpacing: 0.4, textDecorationLine: 'underline' },

  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 10,
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 18,
    borderTopWidth: 1, borderTopColor: 'rgba(31,215,154,0.15)',
  },
  input: {
    flex: 1, fontFamily: F.bodyMed, fontSize: 15, color: C.text,
    backgroundColor: C.surface, borderWidth: 1, borderColor: 'rgba(31,215,154,0.35)',
    borderRadius: 14, paddingHorizontal: 16, paddingVertical: 10, maxHeight: 120,
  },
});
