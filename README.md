# Bajan Showdown

A survey-style gameshow for a Bajan trivia class. Students write the questions, the teacher approves them, and the host runs the game on a projector.

| Page | Link | Who uses it |
|---|---|---|
| Gameshow (landing page) | `/` | Host, on the projector |
| Write a question | `/submit` | Students, on phones or lab computers |
| Teacher page | `/teacher` | Teacher: settings, approvals, edits |
| Host remote | `/host` | Opened from the board's **More** menu; shows the answers to the host |

Questions are saved in **Netlify Blobs**, the storage built into Netlify. There's no database account to create and nothing extra to pay for at classroom scale.

---

## 1. Put it online (about 10 minutes)

Netlify's drag-and-drop deploy **doesn't run the server code** this site needs to save questions, so use one of these two ways instead.

### Option A: GitHub + Netlify (no coding tools needed)

1. Unzip this folder.
2. On GitHub, create a new repository (it can be private). Choose **uploading an existing file** and drag in everything *inside* the unzipped folder: `netlify/`, `public/`, `netlify.toml`, `package.json`, `package-lock.json` and this README. Commit.
3. In Netlify, choose **Add new project → Import an existing project → GitHub** and pick the repository. Leave the build settings as they are (`netlify.toml` already sets them) and deploy.
4. **Set the teacher password.** In the project's settings, open **Environment variables**, add one called `TEACHER_PASSWORD` and give it a password only you know. Then open **Deploys** and choose **Trigger deploy** so the site picks it up.

### Option B: Netlify CLI (if you have Node.js installed)

```bash
cd bajan-showdown
npm install
npx netlify-cli login
npx netlify-cli deploy --prod      # first time: choose to create a new project
npx netlify-cli env:set TEACHER_PASSWORD "your-password"
npx netlify-cli deploy --prod      # deploy again so the password takes effect
```

To try it on your own computer first, run `npx netlify-cli dev` and open the address it prints.

---

## 2. Collect questions from students

1. Open `/teacher`, sign in, and open **Settings**:
   - **Number of question slots**: 20 by default.
   - **Class code**: optional, but recommended. Students must type it, which stops anyone outside the class filling your slots. Write it on the board when you're ready.
   - **Students can submit questions**: tick this to open the form, and untick it to close it.
2. Use **Copy student link** and share it (`your-site.netlify.app/submit`).
3. Each student types their name, form class, a survey question and 4–8 answers with points. The points can add up to 100 at most, as if 100 Bajans were surveyed.
4. **First come, first served:** each submission takes the lowest free slot. Two students pressing submit at the same moment can never get the same slot, because the storage refuses the second write. When every slot is taken, the form closes by itself.
5. **One question each:** a student's name and form class can hold only one slot. Capitals and spaces don't count, so "4 c" is the same as "4C". It's an honour system with no logins, so the class code and your approvals are the real safeguards.

## 3. Approve

On the teacher page, the **Waiting** tab shows new questions. For each one you can:

- **Approve** it, so it's ready for the game.
- **Edit** it to fix spelling, wording or points.
- **Delete and free the slot.** The student can submit again, and the next student can take that slot.

**Add a question** puts your own question into the first empty slot, already approved. **Print host answer sheet** prints every approved question with its answers. **Download a backup** saves everything as a file.

## 4. Run the show

1. On the projector, open the site and press **Host the game**, then enter the teacher password. Answers are never sent to anyone without the password.
2. Name the teams, choose the number of rounds and a target (300 by default), and press **Start the show**.
3. The game plays like the TV format:
   - **Face-off:** read the question. A wrong buzz-in gets **Buzz** (Z), which shows one X but doesn't count as a strike.
   - Pick the team that's **Playing**. Reveal correct answers by clicking a tile or pressing **1–8**. Their points go into the **Bank**.
   - Wrong answers get **Strike** (X). After 3 strikes the other team **can steal**. If their one answer is on the board, reveal it.
   - Give the **Bank to** whichever team won the round, then **Reveal rest** (R) to show what nobody got. Those answers score no points.
   - The last two rounds are **double** and **triple** points by default. Change any round with ×1, ×2 or ×3.
   - **Next round** (N). When a team reaches the target, or after the last round, it becomes **See the winner**.
4. **Undo** (U) takes back any mistake, even after the winner screen.
5. **Host remote:** with the projector as a second screen, open **More → Open host remote**. Keep that window on your laptop. It shows every answer and has all the controls, while the board on the projector stays hidden. With a mirrored screen instead, print the host answer sheet.
6. If the page refreshes mid-game, **Resume the game in progress** appears on the title screen.

**Keyboard:** 1–8 reveal, X strike, Z buzz, R reveal rest, N next, U undo, Q show or hide question, H hide controls, F full screen, M sound on or off.

**Practise any time:** press **Host the game**, then **Practise with sample questions**. Five made-up Bajan questions load, so nothing needs to be approved first.

---

## Starting fresh for a new class

Teacher page → **Start fresh**: type `RESET` to delete every question. Settings are kept. Download a backup first if you want to keep the old ones.

## What's inside

```
netlify/functions/api.mjs   the backend: slots, approvals, settings (Netlify Function + Blobs)
public/index.html           gameshow board (landing page) + game.js, game.css
public/submit.html          student question form
public/teacher.html         teacher page
public/host.html            host remote
public/sounds.js            sound effects, generated in the browser (no audio files)
public/marquee.js           the light-bulb frames
public/fonts/               Bungee, Bungee Inline and Atkinson Hyperlegible (SIL Open Font License)
```

The design and sounds are original. You can rename the game in the teacher page settings.
