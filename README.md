# News Intelligence Agent — Week 1: Morning Brief

## What this does
Every morning, fetches headlines from The Hindu RSS feeds, classifies each one as
Signal / Noise / Archive using GPT-4o-mini, and shows them in a clean mobile app.

## Folder structure
```
news_intelligence/
  backend/
    main.py          ← FastAPI server (the agent logic)
    requirements.txt ← Python dependencies
    .env.example     ← Copy to .env and add your API key
  frontend/
    index.html       ← The web app (open in browser or deploy to Vercel)
  README.md
```

---

## Run locally (5 steps)

### 1. Install Python dependencies
```bash
cd backend
pip install -r requirements.txt
```

### 2. Set your OpenAI API key
```bash
# Copy the example env file
cp .env.example .env

# Open .env and replace sk-your-key-here with your real key
```

### 3. Start the backend
```bash
uvicorn main:app --reload --port 8000
```
You should see: `Uvicorn running on http://127.0.0.1:8000`

### 4. Open the frontend
Open `frontend/index.html` directly in your browser.
The app will call your local backend and show today's brief.

### 5. Test the API directly
Visit http://localhost:8000/docs to see the auto-generated API docs
and test the /api/triage endpoint manually.

---

## Deploy to the web

### Backend → Railway (free tier)
1. Push your code to GitHub
2. Go to railway.app → New Project → Deploy from GitHub
3. Select your repo, point to the `backend/` folder
4. Add environment variable: OPENAI_API_KEY = your key
5. Railway gives you a URL like: https://your-app.railway.app

### Frontend → Vercel (free)
1. In `frontend/index.html`, change this line:
   `const API_BASE = "http://localhost:8000";`
   to your Railway URL:
   `const API_BASE = "https://your-app.railway.app";`
2. Go to vercel.com → New Project → Import your GitHub repo
3. Set root directory to `frontend/`
4. Deploy — Vercel gives you a public URL instantly

---

## Customise the triage logic
Edit the `USER_DOMAINS` list in `backend/main.py` to match your interests.
Edit the `TRIAGE_PROMPT` to change how the LLM classifies stories.

## Next steps (Week 2)
Add the 3-pass reading flow: paste an article link,
the agent walks you through Facts → Context → Implications.
