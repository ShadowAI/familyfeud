// Bajan Showdown — the whole backend in one Netlify Function.
// Storage: Netlify Blobs (built into Netlify, no setup or extra account).
//
// Keys in the "bajan-showdown" store:
//   settings          { title, slotCount, open, classCode }
//   slot-001 … 100    one student's question (first come, first served)
//   student-<hash>    marks that a name + form class already has a slot
//
// Slots are claimed with conditional writes (onlyIfNew), so two students
// pressing submit at the same moment can never land in the same slot.

import { getStore } from "@netlify/blobs";
import { createHash, timingSafeEqual } from "node:crypto";

const STORE_NAME = "bajan-showdown";
const MAX_SLOTS = 100;
const DEFAULT_SETTINGS = { title: "Bajan Showdown", slotCount: 20, open: true, classCode: "" };
const LIMITS = { name: 40, formClass: 12, question: 140, answer: 32, minAnswers: 4, maxAnswers: 8, maxTotal: 100 };

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
const slotNum = (key) => parseInt(key.slice(5), 10);

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

const studentKeyFor = (name, formClass) =>
  "student-" + createHash("sha256").update(`${squash(name)}|${squash(formClass)}`).digest("hex").slice(0, 32);

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
  return { ...DEFAULT_SETTINGS, ...(saved || {}) };
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
  if (question.length < 8) throw new HttpError(400, "Write a full survey question, like “Name something you'd buy at Oistins.”");

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
    throw new HttpError(400, `Your points add up to ${total}. They can only add up to ${LIMITS.maxTotal} (100 people surveyed).`);

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

// ---------- public routes ----------
async function getStatus() {
  const s = store();
  const settings = await getSettings(s);
  const taken = (await listSlotKeys(s)).map(slotNum).filter((n) => n <= settings.slotCount);
  return json({
    title: settings.title,
    slotCount: settings.slotCount,
    taken,
    left: Math.max(0, settings.slotCount - taken.length),
    open: settings.open,
    needsCode: Boolean(settings.classCode),
  });
}

async function submit(req) {
  const body = await readBody(req);
  const s = store();
  const settings = await getSettings(s);

  if (!settings.open) return fail(403, "Submissions are closed right now. Ask your teacher when they'll open.");
  if (settings.classCode && squash(body.code) !== squash(settings.classCode))
    return fail(403, "That class code isn't right. Check the code your teacher gave you.", { field: "code" });

  const name = cleanText(body.name, LIMITS.name);
  const formClass = cleanText(body.formClass, LIMITS.formClass);
  if (name.length < 2) return fail(400, "Type your name so your teacher knows whose question it is.", { field: "name" });
  if (!formClass) return fail(400, "Type your form class, like 3B.", { field: "formClass" });

  const { question, answers } = validateQuestion(body);
  const studentKey = studentKeyFor(name, formClass);
  const now = Date.now();

  // Step 1: one slot per student. Claim the student marker atomically.
  let claimed = false;
  for (let attempt = 0; attempt < 2 && !claimed; attempt++) {
    const r = await s.setJSON(studentKey, { name, formClass, slot: null, at: now }, { onlyIfNew: true });
    if (r.modified) {
      claimed = true;
      break;
    }
    const existing = await s.get(studentKey, { type: "json" });
    // A marker with no slot that's over a minute old came from a request that
    // crashed halfway. Clear it and try again; otherwise the student already has a slot.
    if (existing && existing.slot == null && now - (existing.at || 0) > 60000) {
      await s.delete(studentKey);
      continue;
    }
    if (existing && existing.slot == null)
      return fail(409, "Your question is still being saved. Wait a few seconds, then refresh.");
    return fail(409, `${existing?.name || name} in ${existing?.formClass || formClass} already has slot ${existing?.slot}. It's one question each.`, {
      slot: existing?.slot,
    });
  }

  // Step 2: first come, first served. Take the lowest free slot.
  try {
    const takenKeys = new Set(await listSlotKeys(s));
    const record = { name, formClass, studentKey, question, answers, status: "pending", createdAt: now, updatedAt: now };
    for (let n = 1; n <= settings.slotCount; n++) {
      const key = slotKey(n);
      if (takenKeys.has(key)) continue;
      const r = await s.setJSON(key, { slot: n, ...record }, { onlyIfNew: true });
      if (r.modified) {
        await s.setJSON(studentKey, { name, formClass, slot: n, at: now });
        return json({ ok: true, slot: n, slotCount: settings.slotCount });
      }
      // Someone else got this slot a split second earlier: try the next one.
    }
    await s.delete(studentKey);
    return fail(409, "All the slots are full. Ask your teacher if they can add more.", { full: true });
  } catch (err) {
    await s.delete(studentKey).catch(() => {});
    throw err;
  }
}

// ---------- teacher routes ----------
async function getGame() {
  const s = store();
  const settings = await getSettings(s);
  const questions = (await loadSlots(s))
    .filter((r) => r.status === "approved")
    .map((r) => ({ slot: r.slot, question: r.question, answers: r.answers, author: r.name, formClass: r.formClass }));
  return json({ title: settings.title, questions });
}

async function getTeacherSlots() {
  const s = store();
  const [settings, slots] = await Promise.all([getSettings(s), loadSlots(s)]);
  return json({
    settings,
    slots: slots.map(({ studentKey, ...rest }) => rest),
  });
}

async function saveSettings(req) {
  const body = await readBody(req);
  const s = store();
  const current = await getSettings(s);
  const next = { ...current };

  if ("title" in body) {
    const t = cleanText(body.title, 40);
    if (t.length < 2) return fail(400, "Give the game a title.");
    next.title = t;
  }
  if ("slotCount" in body) {
    const n = Number(body.slotCount);
    if (!Number.isInteger(n) || n < 1 || n > MAX_SLOTS) return fail(400, `Slots must be a whole number from 1 to ${MAX_SLOTS}.`);
    const highest = Math.max(0, ...(await listSlotKeys(s)).map(slotNum));
    if (n < highest) return fail(400, `Slot ${highest} is already filled. Delete it first, or keep at least ${highest} slots.`);
    next.slotCount = n;
  }
  if ("open" in body) next.open = Boolean(body.open);
  if ("classCode" in body) next.classCode = cleanText(body.classCode, 20);

  await s.setJSON("settings", next);
  return json({ ok: true, settings: next });
}

async function slotAction(req) {
  const body = await readBody(req);
  const s = store();
  const action = String(body.action || "");

  if (action === "create") {
    const { question, answers } = validateQuestion(body);
    const settings = await getSettings(s);
    const takenKeys = new Set(await listSlotKeys(s));
    const now = Date.now();
    for (let n = 1; n <= settings.slotCount; n++) {
      if (takenKeys.has(slotKey(n))) continue;
      const rec = { slot: n, name: cleanText(body.name, LIMITS.name) || "Teacher", formClass: cleanText(body.formClass, LIMITS.formClass) || "Staff", studentKey: null, question, answers, status: "approved", createdAt: now, updatedAt: now };
      const r = await s.setJSON(slotKey(n), rec, { onlyIfNew: true });
      if (r.modified) return json({ ok: true, slot: n });
    }
    return fail(409, "Every slot is full. Add more slots in Settings first.");
  }

  const n = Number(body.slot);
  if (!Number.isInteger(n) || n < 1 || n > MAX_SLOTS) return fail(400, "That slot number isn't valid.");
  const key = slotKey(n);
  const rec = await s.get(key, { type: "json" });
  if (!rec) return fail(404, `Slot ${n} is empty. Refresh to see the latest list.`);

  if (action === "approve" || action === "unapprove") {
    rec.status = action === "approve" ? "approved" : "pending";
  } else if (action === "update") {
    const { question, answers } = validateQuestion(body);
    rec.question = question;
    rec.answers = answers;
  } else if (action === "delete") {
    await s.delete(key);
    if (rec.studentKey) {
      const marker = await s.get(rec.studentKey, { type: "json" });
      if (marker && marker.slot === n) await s.delete(rec.studentKey);
    }
    return json({ ok: true, deleted: n });
  } else {
    return fail(400, "Unknown action.");
  }
  rec.updatedAt = Date.now();
  await s.setJSON(key, rec);
  const { studentKey, ...clean } = rec;
  return json({ ok: true, slot: clean });
}

async function resetAll(req) {
  const body = await readBody(req);
  if (body.confirm !== "RESET") return fail(400, "Type RESET to confirm.");
  const s = store();
  const { blobs } = await s.list();
  const doomed = blobs.map((b) => b.key).filter((k) => k.startsWith("slot-") || k.startsWith("student-"));
  await Promise.all(doomed.map((k) => s.delete(k)));
  return json({ ok: true, deleted: doomed.filter((k) => k.startsWith("slot-")).length });
}

// ---------- router ----------
export default async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/?/, "").replace(/\/+$/, "");
  const m = req.method;

  try {
    if (path === "status" && m === "GET") return await getStatus();
    if (path === "submit" && m === "POST") return await submit(req);

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
