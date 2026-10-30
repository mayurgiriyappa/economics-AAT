# Strategy Court — Dashboard + Live Classroom Quiz

A responsive web app for the DSCE Biotechnology Engineering Economics & Management assignment “Make in India Strategy Court: Import or Manufacture Locally?” Includes the decision dashboard and a real-time classroom quiz designed for 40+ simultaneous participants on a suitable Node.js host.

## Run locally

1. Install Node.js 18 or newer.
2. Extract the ZIP and open a terminal in the project folder.
3. Run `npm install`.
4. Run `npm start`.
5. Open `http://localhost:3000`. The dashboard and live quiz now share one navigation shell; select **Live classroom quiz** in the left sidebar. The standalone quiz is also available at `http://localhost:3000/quiz.html`.

On Windows, you can run `start-local.bat`; it checks for Node.js, installs the packages if missing, and starts the server. The first install requires an internet connection.

The local development host PIN is `2468`. To change it locally, copy `.env.example` to `.env` and set `HOST_PIN` there. The server console displays a warning while the development default is in use.

## Run a live quiz in class

1. Open `http://localhost:3000/quiz.html` from the computer acting as the host.
2. Choose Host and enter the PIN.
3. Edit the 10 sample questions and click **Save question bank**. The question bank allows up to 50 questions.
4. Click **Open live room**. A six-digit room code appears.
5. Have participants open the same hosted URL on their phones/laptops and enter the room code plus a display name. The host can also copy a participant link.
6. Click **Start quiz**. Participant answers and the answer-distribution chart update live in the host screen.
7. Click **Reveal answer** to show the correct answer and explanation to participants and award points; click **Next question** to continue. Ending the quiz shows the leaderboard.

## Live behavior

- Socket.IO transports live questions, answers, participant count and score updates between browser sessions and the server.
- Host responses are shown with participant names and selected options.
- Participants may submit one answer per question per participant session. Session IDs are stored in the browser session so a refresh can reconnect without resetting the quiz score.
- Ten editable sample questions cover import cost, exchange-rate exposure, manufacturing yield, localization investments, tax treatment, quality qualification, dual sourcing, break-even demand and evidence standards.
- Up to 500 participants are permitted by default; set `MAX_PARTICIPANTS` to another limit if needed. Actual capacity depends on the host's server size and network conditions. A single modest Node.js service generally handles a 40-person classroom quiz comfortably, but run a rehearsal before relying on it for a graded event.
- Quiz questions are stored in `data/quiz-questions.json`. Live session state and answers are in memory and are cleared if the server restarts. Use a persistent disk or a database if the question bank must survive redeployments on an ephemeral host, and a database if you need durable session records.

## Deploy for participants on different devices

This is a Node.js + Socket.IO app; a static-only host such as a basic Cloudflare Pages deployment cannot run the included WebSocket server by itself. Deploy on a platform that supports a long-running Node.js server and WebSockets (for example, Render, Railway, Fly.io, or a VPS). Ensure its public URL uses HTTPS, then share that URL and the room code with participants. Use a single running server/instance for the quiz; multi-instance scaling requires a Socket.IO adapter and shared session storage.

Vercel can serve the dashboard and its serverless HTTP API, but it does not host this app's Socket.IO server. The Vercel client therefore uses HTTP polling. For reliable rooms across serverless instances, configure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in Vercel and apply `supabase-schema.sql`; without shared storage, in-memory rooms are best-effort and may not be visible to every participant. Use a long-running Node.js host for Socket.IO live updates.

Set these environment variables on the host:

- `NODE_ENV=production`
- `HOST_PIN` = a strong private PIN (required in production)
- `PORT` = typically supplied automatically by the hosting platform
- `MAX_PARTICIPANTS=500` (optional)

Never publish the host PIN. The application exposes the participant UI and does not provide individual login identity verification, so this is intended for classroom participation rather than a high-stakes secure exam. Display names alone do not prove participant identity.

## Existing dashboard

- `index.html`: BioPopcorn biopharma landing page and strategic overview.
- `dashboard.html`: Make in India Strategy Court decision dashboard with financial sensitivity models and embedded quiz view.
- `quiz.html`: host, participant, and live scoreboard interface, also usable standalone.
- `server.js`: Express static server and Socket.IO live event handler.
- `data/quiz-questions.json`: server-side editable question bank.

The financial assumptions and the 10 quiz questions are starter examples. Verify all research claims and replace illustrative numbers before using them as factual evidence.
