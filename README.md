# Bajan Showdown

A survey-style gameshow about everyday life in Barbados, for 2–4 teams. It comes with a bank of questions, and the host runs the game on a projector.

| Page | Link | Who uses it |
|---|---|---|
| Gameshow (landing page) | `/` | Host, on the projector |
| Teacher page | `/teacher` | Teacher: edit, add or switch off questions |
| Host remote | `/host` | Opened from the board's **More** menu; shows the answers to the host |

Questions are saved in **Netlify Blobs**, the storage built into Netlify. There's no database account to create and nothing extra to pay for at classroom scale.

**Teacher password (optional).** With no password set, anyone with the link can host the game, see the answers and change the questions on the teacher page. To lock the answers and the teacher page, set a password (step 4 below). Remove it again to unlock them.

---

## 1. Put it online (about 10 minutes)

Netlify's drag-and-drop deploy **doesn't run the server code** this site needs, so use one of these two ways instead.

### Option A: GitHub + Netlify (no coding tools needed)

1. Unzip this folder.
2. On GitHub, create a new repository (it can be private). Choose **uploading an existing file** and drag in everything *inside* the unzipped folder: `netlify/`, `public/`, `netlify.toml`, `package.json`, `package-lock.json` and this README. Commit.
3. In Netlify, choose **Add new project → Import an existing project → GitHub** and pick the repository. Leave the build settings as they are (`netlify.toml` already sets them) and deploy.
4. **Optional: set a teacher password.** In the project's settings, open **Environment variables**, add one called `TEACHER_PASSWORD` and give it a password only you know. Then open **Deploys** and choose **Trigger deploy** so the site picks it up. To remove the password later, delete the variable and trigger a deploy again.

### Option B: Netlify CLI (if you have Node.js installed)

```bash
cd bajan-showdown
npm install
npx netlify-cli login
npx netlify-cli deploy --prod      # first time: choose to create a new project
npx netlify-cli env:set TEACHER_PASSWORD "your-password"   # optional
npx netlify-cli deploy --prod      # deploy again so the password takes effect
```

To try it on your own computer first, run `npx netlify-cli dev` and open the address it prints.

---

## 2. The questions

The built-in questions load by themselves the first time you open the teacher page or host a game. On the teacher page you can:

- **Edit** any question to change the wording, answers or points. Points can add up to 100 at most, as if 100 Bajans were surveyed.
- **Leave out** a question so it isn't used in the game, and **Put in the game** to bring it back.
- **Delete** a question. Built-in questions can be brought back with **Put back missing built-in questions** under Tools.
- **Add a question** of your own. It goes straight into the game.

**Print host answer sheet** prints every question in the game with its answers. **Download a backup** saves everything as a file.

To change the built-in questions themselves, edit `netlify/lib/questions.mjs`.

## 3. Run the show

1. On the projector, open the site and press **Host the game**. If you've set a teacher password, enter it.
2. Choose **2, 3 or 4 teams**. For each team, set a name, **1–4 players** and, if you like, the players' names. Then choose the number of rounds and a target (300 by default), and press **Start the show**.
3. Each round works like this:
   - **Four-way face-off:** the next player from every team comes up. Their names show under each team's score and change every round. Read the question. A wrong buzz-in gets **Buzz** (Z), which shows one X but doesn't count as a strike.
   - Reveal face-off answers by clicking a tile or pressing **1–8**. Whichever team's answer is higher on the board wins the face-off: press that team under **Playing**.
   - That team answers one player at a time. **Up:** under their score shows whose turn it is. Correct answers go into the **Bank**. Wrong answers get **Strike** (X).
   - **Steal:** after 3 strikes, every other team can steal with one answer. Decide how they answer (first hand up, or each team writes one down). If a steal answer is on the board, reveal it and give the bank to that team. If not, give the bank to the team that was playing.
   - Give the **Bank to** whichever team won the round, then **Reveal rest** (R) to show what nobody got. Those answers score no points.
   - The last two rounds are **double** and **triple** points by default. Change any round with ×1, ×2 or ×3.
   - **Next round** (N). When a team reaches the target, or after the last round, it becomes **See the winner**.
4. **Undo** (U) takes back any mistake, even after the winner screen.
5. **Host remote:** with the projector as a second screen, open **More → Open host remote**. Keep that window on your laptop. It shows every answer and has all the controls, while the board on the projector stays hidden. With a mirrored screen instead, print the host answer sheet.
6. If the page refreshes mid-game, **Resume the game in progress** appears on the title screen. The team setup is remembered for next time on the same computer.

**Keyboard:** 1–8 reveal, X strike, Z buzz, R reveal rest, N next, U undo, Q show or hide question, H hide controls, F full screen, M sound on or off.

**Practise any time:** with a teacher password set, press **Host the game**, then **Practise with sample questions** to load a few practice questions without the password.

---

## Starting fresh

Teacher page → **Start fresh**: type `RESET` to delete every question, including ones you added or edited, and load the original built-in questions again. Settings are kept. Download a backup first if you want to keep your changes.

## What's inside

```
netlify/functions/api.mjs   the backend: questions, settings (Netlify Function + Blobs)
netlify/lib/questions.mjs   the built-in question bank
public/index.html           gameshow board (landing page) + game.js, game.css
public/teacher.html         teacher page
public/host.html            host remote
public/sounds.js            sound effects, generated in the browser (no audio files)
public/marquee.js           the light-bulb frames
public/fonts/               Bungee, Bungee Inline and Atkinson Hyperlegible (SIL Open Font License)
```

The design and sounds are original. You can rename the game in the teacher page settings.
