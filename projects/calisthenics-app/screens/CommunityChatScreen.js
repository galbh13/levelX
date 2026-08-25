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
  fetchGroupMembers, fetchGroupMessages, sendMessage, deleteMessage, purgeExpiredMessages,
  CHAT_RETENTION_DAYS,
} from '../lib/community';

// ─── Full-screen group chat (WhatsApp-style) ────────────────────────────────
// A dedicated screen for one group's chat so message history lives HERE, scroll-
// able on its own, instead of growing endlessly inside the group dashboard. Newest
// message sits at the bottom (inverted list); scroll UP for history. Opened from
// the CHAT bar / swipe on the group screen. Shared by player + admin (`isAdmin`
// route param): the admin posts as COACH and can delete ANY message; a player
// posts as themselves and can unsend their OWN. Messages are ephemeral — kept
// ~CHAT_RETENTION_DAYS then swept (purge runs on load).
const CHAT_POLL_MS = 3000; // live poll for the mounted life of the screen (see CommunityGroupScreen note)

const timeOf = (iso) => {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
};

export default function CommunityChatScreen({ navigation, route }) {
  const group = route.params?.group ?? null;
  const isAdmin = !!route.params?.isAdmin;

  const [meId, setMeId] = useState(null);
  const [members, setMembers] = useState([]);
  const [messages, setMessages] = useState([]); // oldest→newest (as stored)
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!group?.id) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      setMeId(user?.id ?? null);
      const [m, msgs] = await Promise.all([
        fetchGroupMembers(group.id),
        fetchGroupMessages(group.id),
      ]);
      setMembers(m);
      setMessages(msgs);
      purgeExpiredMessages(group.id); // sweep expired chat on entry (fire-and-forget)
    } catch (e) {
      console.error('[CommunityChatScreen] load:', e);
    }
    setLoading(false);
  }, [group?.id]);

  useEffect(() => { load(); }, [load]);

  // Lightweight message-only refetch — the live poll + post-send use it.
  const refreshMessages = useCallback(async () => {
    if (!group?.id) return;
    try { setMessages(await fetchGroupMessages(group.id)); }
    catch (e) { console.error('[CommunityChatScreen] refreshMessages:', e); }
  }, [group?.id]);

  // Poll for the whole mounted life of the screen — makes chat feel live without a
  // websocket. NOT focus-gated (see the note in CommunityGroupScreen): this sits
  // in the material-top-tab pager where focus tracking is unreliable.
  useEffect(() => {
    if (!group?.id) return;
    const id = setInterval(refreshMessages, CHAT_POLL_MS);
    return () => clearInterval(id);
  }, [group?.id, refreshMessages]);

  async function handleSend() {
    const text = input.trim();
    if (!text || !meId || sending) return;
    setSending(true);
    setInput('');
    try {
      await sendMessage(group.id, meId, text);
      await refreshMessages();
    } catch (e) {
      console.error('[CommunityChatScreen] handleSend:', e);
      setInput(text); // restore so nothing is lost
    }
    setSending(false);
  }

  // Player unsends their OWN; admin may delete ANY (both allowed by RLS).
  async function handleDelete(messageId) {
    setMessages(prev => prev.filter(msg => msg.id !== messageId)); // optimistic
    try { await deleteMessage(messageId); }
    catch (e) { console.error('[CommunityChatScreen] handleDelete:', e); refreshMessages(); }
  }

  // Non-member senders can only be the admin posting in → label COACH.
  const senderName = (id) => {
    const m = members.find(x => x.id === id);
    return m ? (m.full_name || '?').split(' ')[0] : 'COACH';
  };

  // Swipe RIGHT anywhere on the screen goes back to the group dashboard — the
  // mirror of the dashboard's swipe-LEFT-into-chat, so the pair swipes both ways.
  // Only claims clearly-horizontal RIGHT drags, so the message list still scrolls
  // vertically. Held in a ref so the once-created PanResponder calls the latest.
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

  function renderItem({ item: msg }) {
    const isMe = msg.player_id === meId;
    const canDelete = isMe || isAdmin;
    return (
      <View style={[styles.msgRow, isMe && styles.msgRowMe]}>
        <View style={[styles.msgBubble, isMe && styles.msgBubbleMe]}>
          {!isMe && <Text style={styles.msgSender}>{senderName(msg.player_id)}</Text>}
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
        {/* Header — IDENTICAL layout to CommunityGroupScreen (BACK on its own row,
            then the centered title + subtitle + divider) so the group↔chat swipe
            has no header jump. */}
        <View style={styles.header}>
          <View style={styles.headerTopRow}>
            <PillButton label="← BACK" size="sm" onPress={() => navigation.goBack()} />
          </View>
          <Text style={styles.headerTitle} numberOfLines={2}>{group?.name ?? 'CHAT'}</Text>
          {group?.description ? (
            <Text style={styles.headerSubtitle}>{group.description}</Text>
          ) : null}
          <View style={styles.headerDivider} />
        </View>

        {/* Message log — inverted so newest is pinned to the bottom. */}
        <View style={styles.body}>
          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={C.deepBlue} />
            </View>
          ) : data.length === 0 ? (
            <View style={styles.center}>
              <Text style={styles.empty}>No messages yet — say something.</Text>
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

        {/* Composer — pinned to the bottom. */}
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder={isAdmin ? 'Message the group as COACH…' : 'Message the squad…'}
            placeholderTextColor="#3a5a7a"
            multiline
            maxLength={1000}
            onSubmitEditing={handleSend}
            blurOnSubmit={false}
          />
          <PillButton
            label="SEND"
            size="sm"
            onPress={handleSend}
            loading={sending}
            disabled={!input.trim()}
          />
        </View>
      </KeyboardAvoidingView>
    </ScreenFrame>
  );
}

const ACCENT = '#4A9EBF';

const styles = StyleSheet.create({
  card: { flex: 1 },

  // Header — mirrors CommunityGroupScreen's exactly (same paddings, title size,
  // subtitle, divider) so the swipe between the two shows no header movement.
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
    textShadowColor: 'rgba(74,158,191,0.5)',
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
  empty: { fontFamily: F.bodyMed, fontSize: 15, color: '#5a7a9a', letterSpacing: 0.6 },
  emptyHint: { fontFamily: F.bodyMed, fontSize: 12, color: '#3a5a7a', letterSpacing: 0.6 },

  listContent: { paddingVertical: 14 },
  msgRow: { flexDirection: 'row', marginBottom: 10 },
  msgRowMe: { justifyContent: 'flex-end' },
  msgBubble: {
    maxWidth: '82%',
    borderRadius: 14, borderWidth: 1, borderColor: 'rgba(74,158,191,0.25)',
    backgroundColor: C.surface, paddingHorizontal: 14, paddingVertical: 10,
  },
  msgBubbleMe: {
    borderColor: 'rgba(74,158,191,0.55)', backgroundColor: 'rgba(74,158,191,0.10)',
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
    borderTopWidth: 1, borderTopColor: 'rgba(74,158,191,0.15)',
  },
  input: {
    flex: 1, fontFamily: F.bodyMed, fontSize: 15, color: C.text,
    backgroundColor: C.surface, borderWidth: 1, borderColor: 'rgba(74,158,191,0.35)',
    borderRadius: 14, paddingHorizontal: 16, paddingVertical: 10, maxHeight: 120,
  },
});
