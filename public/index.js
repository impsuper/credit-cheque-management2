/**
 * IMP Super City — Push Notification Cloud Functions
 * -----------------------------------------------------
 * 1. sendQueuedPush   — fires whenever the app writes a doc to `push_events`
 *                        (new cash entry / cheque / credit bill / credit payment by a manager).
 *                        Sends a push to every saved admin token, then deletes the event.
 * 2. chequeDueReminder — runs every day at 6:00 AM Asia/Colombo. Reminds about a cheque
 *                        the morning AFTER its due date (due 12th → reminder on the 13th).
 *                        No reminders on Sat/Sun mornings — those get combined into
 *                        a single Monday morning reminder instead.
 *
 * Deploy with:
 *   cd functions
 *   npm install
 *   firebase deploy --only functions
 */

const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');

initializeApp();
const db = getFirestore();

function fmtLkr(n) {
  return 'LKR ' + Number(n || 0).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Adds/subtracts whole days from a 'YYYY-MM-DD' string, returning a 'YYYY-MM-DD' string.
// Uses noon UTC so there's no risk of the date shifting backward/forward across timezones.
function shiftDate(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function getAdminTokens() {
  const snap = await db.collection('push_tokens').get();
  return snap.docs.map(d => ({ id: d.id, token: d.data().token })).filter(t => t.token);
}

async function sendToAllAdmins(title, body, data = {}) {
  const tokenDocs = await getAdminTokens();
  if (!tokenDocs.length) {
    console.log('No push tokens registered — nothing to send.');
    return;
  }
  const tokens = tokenDocs.map(t => t.token);
  const message = {
    notification: { title, body },
    data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
    tokens
  };
  const res = await getMessaging().sendEachForMulticast(message);
  console.log(`Push sent: ${res.successCount} ok, ${res.failureCount} failed`);

  // Clean up tokens that are no longer valid (uninstalled app, revoked permission, etc.)
  const deletions = [];
  res.responses.forEach((r, i) => {
    const code = r.error && r.error.code;
    if (!r.success && (code === 'messaging/invalid-registration-token' || code === 'messaging/registration-token-not-registered')) {
      deletions.push(db.collection('push_tokens').doc(tokenDocs[i].id).delete().catch(() => {}));
    }
  });
  if (deletions.length) await Promise.all(deletions);
}

// ── 1. Action-triggered push (cash entry / cheque / credit bill / credit payment) ──
exports.sendQueuedPush = onDocumentCreated('push_events/{eventId}', async (event) => {
  const snap = event.data;
  const data = snap?.data();
  if (!data) return;
  await sendToAllAdmins(data.title || 'IMP Super City', data.body || '', { type: data.type || '' });
  await snap.ref.delete();
});

// ── 2. Cheque due-date reminder (day after due date, skipping weekend mornings) ──
exports.chequeDueReminder = onSchedule(
  { schedule: '0 6 * * *', timeZone: 'Asia/Colombo' },
  async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo' }).format(new Date()); // → YYYY-MM-DD
    const dow = new Date(today + 'T12:00:00Z').getUTCDay(); // 0 = Sunday, 6 = Saturday

    if (dow === 6 || dow === 0) {
      console.log("Weekend morning — skipping (combined into Monday's reminder instead).");
      return;
    }

    // Tue–Fri: remind about the cheque due yesterday.
    // Monday: combine Fri/Sat/Sun due dates into one reminder.
    const dueDatesToCheck = dow === 1
      ? [shiftDate(today, -3), shiftDate(today, -2), shiftDate(today, -1)]
      : [shiftDate(today, -1)];

    const usersSnap = await db.collection('cms_users').get();
    const dueCheques = [];
    usersSnap.forEach(doc => {
      const u = doc.data();
      (u.cheques || []).forEach(c => {
        if (c.status === 'pending' && dueDatesToCheck.includes(c.dueDate)) {
          dueCheques.push(c);
        }
      });
    });

    if (!dueCheques.length) {
      console.log('No cheques to remind about — skipping.');
      return;
    }

    const total = dueCheques.reduce((s, c) => s + (Number(c.amount) || 0), 0);
    const title = `🏦 ${dueCheques.length} Cheque${dueCheques.length > 1 ? 's' : ''} Due`;
    const body = dueCheques.length <= 3
      ? dueCheques.map(c => `#${c.number || c.entryId || '—'} · ${fmtLkr(c.amount)} · Due ${c.dueDate}`).join(', ')
      : `Total ${fmtLkr(total)} across ${dueCheques.length} cheques`;

    await sendToAllAdmins(title, body, { type: 'cheque-due' });
  }
);

