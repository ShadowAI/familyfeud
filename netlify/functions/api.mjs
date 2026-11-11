// Bajan Showdown — the whole backend in one Netlify Function.
// Storage: Netlify Blobs (built into Netlify, no setup or extra account).
//
// Keys in the "bajan-showdown" store:
//   settings          { title }
//   seeded            written once, when the built-in questions are first loaded
//   slot-001 … 200    one question each
//
// Every route that reveals answers needs the teacher password, so players
// can't look the answers up before the game.

import { getStore } from "@netlify/blobs";
import { createHash, timingSafeEqual } from "node:crypto";
import { BUILT_IN } from "../lib/questions.mjs";

const STORE_NAME = "bajan-showdown";
const MAX_SLOTS = 200;
const DEFAULT_SETTINGS = { title: "Bajan Showdown" };
const LIMITS = { question: 140, answer: 32, minAnswers: 4, maxAnswers: 8, maxTotal: 100 };

const store = () => getStore({ name: STORE_NAME, consistency: "strong" });

// ---------- helpers ----------
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
const fail = (status, error, extra = {}) => json({ error, ...extra }, status);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const slotKey = (n) => `slot-${String(n).padStart(3, "0")}`;

const cleanText = (v, max) =>
  String(v ?? "")
    .replace(/[\u0000-\u001f\u007f<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const squash = (v) =>
  String(v ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const env = (k) => globalThis.Netlify?.env?.get?.(k) ?? process.env[k];

async function readBody(req) {
  const text = await req.text();
  if (text.length > 20000) throw new HttpError(413, "That's too much text.");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(400, "The form data couldn't be read. Refresh the page and try again.");
  }
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function getSettings(s) {
  const saved = await s.get("settings", { type: "json" });
  return { title: saved?.title || DEFAULT_SETTINGS.title };
}

async function listSlotKeys(s) {
  const { blobs } = await s.list({ prefix: "slot-" });
  return blobs.map((b) => b.key).sort();
}

async function loadSlots(s) {
  const keys = await listSlotKeys(s);
  const records = await Promise.all(keys.map((k) => s.get(k, { type: "json" })));
  return records.filter(Boolean).sort((a, b) => a.slot - b.slot);
}

// Validates a question + answers. Returns { question, answers } or throws.
function validateQuestion(body) {
  const question = cleanText(body.question, LIMITS.question);
  if (question.length < 8) throw new HttpError(400, "Write a full survey question, like “Name something a Bajan house gets new for Christmas.”");

  const raw = Array.isArray(body.answers) ? body.answers.slice(0, 20) : [];
  const answers = raw
    .map((a) => ({ text: cleanText(a?.text, LIMITS.answer), points: Number(a?.points) }))
    .filter((a) => a.text !== "");

  if (answers.length < LIMITS.minAnswers)
    throw new HttpError(400, `Add at least ${LIMITS.minAnswers} answers.`);
  if (answers.length > LIMITS.maxAnswers)
    throw new HttpError(400, `Use ${LIMITS.maxAnswers} answers at most.`);

  const seen = new Set();
  for (const a of answers) {
    if (!Number.isInteger(a.points) || a.points < 1 || a.points > 99)
      throw new HttpError(400, `Give “${a.text}” a whole number of points from 1 to 99.`);
    const k = squash(a.text);
    if (seen.has(k)) throw new HttpError(400, `“${a.text}” is in the list twice.`);
    seen.add(k);
  }
  const total = answers.reduce((t, a) => t + a.points, 0);
  if (total > LIMITS.maxTotal)
    throw new HttpError(400, `The points add up to ${total}. They can only add up to ${LIMITS.maxTotal} (100 people surveyed).`);

  answers.sort((a, b) => b.points - a.points);
  return { question, answers };
}

function teacherCheck(req) {
  const real = env("TEACHER_PASSWORD");
  if (!real) return "unset";
  const given = req.headers.get("x-teacher-password") || "";
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(String(real)).digest();
  return timingSafeEqual(a, b) ? "ok" : "bad";
}

// ---------- built-in questions ----------
// Adds every built-in question that isn't in the store yet (matched by its
// bank id, so an edited built-in question is never added twice). Each one
// takes the lowest free number.
async function addMissingBuiltIns(s) {
  const existing = await loadSlots(s);
  const have = new Set(existing.map((r) => r.bankId).filter(Boolean));
  const taken = new Set(existing.map((r) => r.slot));
  const now = Date.now();
  let n = 1;
  let added = 0;
  for (const q of BUILT_IN) {
    if (have.has(q.id)) continue;
    const { question, answers } = validateQuestion(q);
    for (;;) {
      while (taken.has(n)) n++;
      if (n > MAX_SLOTS) return added;
      taken.add(n);
      const rec = { slot: n, bankId: q.id, question, answers, status: "approved", createdAt: now, updatedAt: now };
      const w = await s.setJSON(slotKey(n), rec, { onlyIfNew: true });
      if (w.modified) { added++; break; }
      // Another request took this number a moment ago: try the next one.
    }
  }
  return added;
}

// The first time the site is used, load the built-in questions.
async function ensureSeeded(s) {
  if (await s.get("seeded")) return;
  const r = await s.setJSON("seeded", { at: Date.now() }, { onlyIfNew: true });
  if (r.modified) await addMissingBuiltIns(s);
}

// ---------- public route ----------
async function getStatus() {
  const settings = await getSettings(store());
  return json({ title: settings.title });
}

// ---------- teacher routes ----------
async function getGame() {
  const s = store();
  await ensureSeeded(s);
  const [settings, slots] = await Promise.all([getSettings(s), loadSlots(s)]);
  const questions = slots
    .filter((r) => r.status === "approved")
    .map((r) => ({ slot: r.slot, question: r.question, answers: r.answers }));
  return json({ title: settings.title, questions });
}

async function getTeacherSlots() {
  const s = store();
  await ensureSeeded(s);
  const [settings, slots] = await Promise.all([getSettings(s), loadSlots(s)]);
  return json({
    settings,
    builtInCount: BUILT_IN.length,
    slots: slots.map(({ slot, bankId, question, answers, status, createdAt, updatedAt }) => ({
      slot, builtIn: Boolean(bankId), question, answers, status, createdAt, updatedAt,
    })),
  });
}

async function saveSettings(req) {
  const body = await readBody(req);
  const s = store();
  const next = await getSettings(s);
  if ("title" in body) {
    const t = cleanText(body.title, 40);
    if (t.length < 2) return fail(400, "Give the game a title.");
    next.title = t;
  }
  await s.setJSON("settings", next);
  return json({ ok: true, settings: next });
}

async function slotAction(req) {
  const body = await readBody(req);
  const s = store();
  const action = String(body.action || "");

  if (action === "create") {
    const { question, answers } = validateQuestion(body);
    const takenKeys = new Set(await listSlotKeys(s));
    const now = Date.now();
    for (let n = 1; n <= MAX_SLOTS; n++) {
      if (takenKeys.has(slotKey(n))) continue;
      const rec = { slot: n, bankId: null, question, answers, status: "approved", createdAt: now, updatedAt: now };
      const r = await s.setJSON(slotKey(n), rec, { onlyIfNew: true });
      if (r.modified) return json({ ok: true, slot: n });
    }
    return fail(409, `There's room for ${MAX_SLOTS} questions. Delete some first.`);
  }

  const n = Number(body.slot);
  if (!Number.isInteger(n) || n < 1 || n > MAX_SLOTS) return fail(400, "That question number isn't valid.");
  const key = slotKey(n);
  const rec = await s.get(key, { type: "json" });
  if (!rec) return fail(404, `Question ${n} isn't there any more. Refresh to see the latest list.`);

  if (action === "approve" || action === "unapprove") {
    rec.status = action === "approve" ? "approved" : "pending";
  } else if (action === "update") {
    const { question, answers } = validateQuestion(body);
    rec.question = question;
    rec.answers = answers;
  } else if (action === "delete") {
    await s.delete(key);
    return json({ ok: true, deleted: n });
  } else {
    return fail(400, "Unknown action.");
  }
  rec.updatedAt = Date.now();
  await s.setJSON(key, rec);
  return json({ ok: true });
}

async function restoreBuiltIns() {
  const s = store();
  await s.setJSON("seeded", { at: Date.now() });
  const added = await addMissingBuiltIns(s);
  return json({ ok: true, added });
}

// Deletes every question (and anything left over from the old student
// form), then loads the built-in questions again.
async function resetAll(req) {
  const body = await readBody(req);
  if (body.confirm !== "RESET") return fail(400, "Type RESET to confirm.");
  const s = store();
  const { blobs } = await s.list();
  const doomed = blobs.map((b) => b.key).filter((k) => k.startsWith("slot-") || k.startsWith("student-"));
  await Promise.all(doomed.map((k) => s.delete(k)));
  await s.setJSON("seeded", { at: Date.now() });
  const added = await addMissingBuiltIns(s);
  return json({ ok: true, deleted: doomed.filter((k) => k.startsWith("slot-")).length, added });
}

// ---------- router ----------
export default async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/?/, "").replace(/\/+$/, "");
  const m = req.method;

  try {
    if (path === "status" && m === "GET") return await getStatus();

    if (path === "game" || path.startsWith("teacher/")) {
      const auth = teacherCheck(req);
      if (auth === "unset")
        return fail(503, "The teacher password hasn't been set. In Netlify, add an environment variable called TEACHER_PASSWORD, then redeploy.");
      if (auth === "bad") {
        await sleep(800); // slows down password guessing
        return fail(401, "That password isn't right.");
      }
      if (path === "game" && m === "GET") return await getGame();
      if (path === "teacher/login" && m === "POST") return json({ ok: true });
      if (path === "teacher/slots" && m === "GET") return await getTeacherSlots();
      if (path === "teacher/settings" && m === "POST") return await saveSettings(req);
      if (path === "teacher/slot" && m === "POST") return await slotAction(req);
      if (path === "teacher/restore" && m === "POST") return await restoreBuiltIns();
      if (path === "teacher/reset" && m === "POST") return await resetAll(req);
    }
    return fail(404, "Not found.");
  } catch (err) {
    if (err instanceof HttpError) return fail(err.status, err.message);
    console.error(err);
    return fail(500, "Something went wrong on the server. Try again in a moment.");
  }
};

export const config = { path: "/api/*" };
