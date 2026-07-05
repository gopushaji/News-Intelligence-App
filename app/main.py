"""
News Intelligence Agent — Full Backend
Endpoints: /api/triage · /api/read · /api/knowledge · /api/review · / (static)
"""

import os, json, uuid, feedparser
from contextlib import asynccontextmanager
from datetime import datetime
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from openai import AzureOpenAI
from pydantic import BaseModel
from dotenv import load_dotenv
import newspaper
from . import knowledge as kb

load_dotenv()


@asynccontextmanager
async def lifespan(app):
    # Pre-warm ChromaDB so the embedding model downloads at startup, not mid-request
    print("Initialising ChromaDB (may download model on first run)…")
    try:
        kb._col()
        print("ChromaDB ready.")
    except Exception as e:
        print(f"ChromaDB init warning: {e}")
    yield


app = FastAPI(title="News Intelligence Agent", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

client = AzureOpenAI(
    api_key=os.environ.get("AZURE_OPENAI_API_KEY"),
    azure_endpoint=os.environ.get("AZURE_OPENAI_ENDPOINT"),
    api_version=os.environ.get("AZURE_OPENAI_API_VERSION", "2024-02-01"),
)
DEPLOYMENT = os.environ.get("AZURE_OPENAI_DEPLOYMENT", "gpt-4o-mini")


# ── RSS ────────────────────────────────────────────────────────────────────────
HINDU_RSS_FEEDS = {
    "National":      "https://www.thehindu.com/news/national/feeder/default.rss",
    "International": "https://www.thehindu.com/news/international/feeder/default.rss",
    "Business":      "https://www.thehindu.com/business/feeder/default.rss",
    "Opinion":       "https://www.thehindu.com/opinion/feeder/default.rss",
    "Science":       "https://www.thehindu.com/sci-tech/feeder/default.rss",
    "Environment":   "https://www.thehindu.com/sci-tech/energy-and-environment/feeder/default.rss",
}

USER_DOMAINS = [
    "Geopolitics", "Economics", "Business", "History",
    "Polity / Constitution", "International Relations",
    "Environment", "Science & Technology",
]


# ── Prompts ────────────────────────────────────────────────────────────────────
TRIAGE_PROMPT = """
You are a news triage assistant for a reader who studies geopolitics, economics,
history, polity, international relations, environment, and science.

Their goal: spend 30 minutes daily on 2–3 stories that compound long-term knowledge.
They want DEPTH over volume.

Classify each headline as exactly one of:
  Signal  — Important story with long-term relevance. Worth deep reading.
  Noise   — Current event but low analytical value. Skim or skip.
  Archive — Interesting but not time-sensitive. Save for later.

Return a JSON object with a "classifications" key containing an array.
Format:
{{
  "classifications": [
    {{
      "index": 0,
      "classification": "Signal",
      "reason": "max 10 words on why",
      "domains": ["Geopolitics", "International Relations"]
    }}
  ]
}}

User's domains: {domains}
Headlines:
{headlines}
"""

DEEP_READ_PROMPT = """
You are a deep reading assistant. Analyse the article and respond with JSON:
{{
  "facts": ["fact 1 — who/what/when/where/numbers", "fact 2"],
  "context": ["background point 1 — why this matters, history/structure", "background point 2"],
  "implications": ["implication 1 — what happens next, signals to watch", "implication 2"]
}}
Rules: 4–6 bullets per section. Each bullet is one clear sentence (max 20 words).

Article title: {title}
Article text:
{text}
"""

WEEKLY_REVIEW_PROMPT = """
You are an intelligence analyst reviewing a reader's week of news reading.

Analyse the {count} notes below and return JSON with exactly these keys:
{{
  "themes": [
    {{"theme": "name", "description": "2 sentences on significance", "stories": ["title 1", "title 2"]}}
  ],
  "patterns": [
    {{"pattern": "emerging trend", "evidence": "which stories point to this"}}
  ],
  "gaps": [
    {{"topic": "gap topic", "description": "why this matters", "search": "Wikipedia: Article OR search: query"}}
  ],
  "revisits": [
    {{"title": "exact story title from notes", "reason": "why re-reading this now is valuable"}}
  ]
}}
Rules: 2–4 items per section. themes = topics across 2+ stories. gaps = sub-topics referenced but never explored.

Notes ({count} articles):
{notes}
"""


# ── Helpers ────────────────────────────────────────────────────────────────────
def fetch_headlines(max_per_feed=8):
    headlines = []
    for section, url in HINDU_RSS_FEEDS.items():
        feed = feedparser.parse(url)
        for entry in feed.entries[:max_per_feed]:
            headlines.append({
                "title":     entry.get("title", "").strip(),
                "summary":   entry.get("summary", "").strip()[:300],
                "link":      entry.get("link", ""),
                "published": entry.get("published", ""),
                "section":   section,
            })
    return headlines


def classify_headlines(headlines):
    if not headlines:
        return []
    headlines_text = "\n".join(
        f"{i}. [{h['section']}] {h['title']}" for i, h in enumerate(headlines)
    )
    raw = llm_json([
        {"role": "system", "content": "You are a news triage assistant. Always respond with valid JSON only."},
        {"role": "user",   "content": TRIAGE_PROMPT.format(
            domains=", ".join(USER_DOMAINS), headlines=headlines_text
        )},
    ], temperature=0.2)

    classifications = raw if isinstance(raw, list) else next(
        (v for v in raw.values() if isinstance(v, list)), []
    )
    enriched = []
    for item in classifications:
        idx = item.get("index", -1)
        if 0 <= idx < len(headlines):
            enriched.append({
                **headlines[idx],
                "classification": item.get("classification", "Noise"),
                "reason":         item.get("reason", ""),
                "domains":        item.get("domains", []),
            })
    return enriched


def llm_json(messages, temperature=0.3):
    resp = client.chat.completions.create(
        model=DEPLOYMENT,
        messages=messages,
        response_format={"type": "json_object"},
        temperature=temperature,
    )
    return json.loads(resp.choices[0].message.content)


# ── Pydantic models ────────────────────────────────────────────────────────────
class TriageResponse(BaseModel):
    date: str
    total: int
    signal:  list[dict]
    noise:   list[dict]
    archive: list[dict]

class DeepReadRequest(BaseModel):
    url: str

class DeepReadResponse(BaseModel):
    title: str
    url: str
    facts: list[str]
    context: list[str]
    implications: list[str]

class SaveNoteRequest(BaseModel):
    title: str
    url: str
    facts: list[str]
    context: list[str]
    implications: list[str]
    inference: str
    domains: list[str]


# ── Endpoints ──────────────────────────────────────────────────────────────────
@app.get("/api/health")
def health():
    return {"status": "ok", "time": datetime.now().isoformat()}


@app.get("/api/triage", response_model=TriageResponse)
def get_triage():
    try:
        headlines = fetch_headlines()
        if not headlines:
            raise HTTPException(503, "Could not fetch RSS feeds.")
        enriched = classify_headlines(headlines)
        return TriageResponse(
            date=datetime.now().strftime("%A, %d %B %Y"),
            total=len(enriched),
            signal  =[h for h in enriched if h["classification"] == "Signal"],
            noise   =[h for h in enriched if h["classification"] == "Noise"],
            archive =[h for h in enriched if h["classification"] == "Archive"],
        )
    except HTTPException:
        raise
    except Exception as e:
        import traceback; traceback.print_exc()
        raise HTTPException(500, str(e))


@app.post("/api/read", response_model=DeepReadResponse)
def deep_read(req: DeepReadRequest):
    try:
        article = newspaper.Article(req.url)
        article.download()
        article.parse()
        title = article.title or "Untitled"
        text  = article.text
        if not text or len(text) < 100:
            raise HTTPException(422, "Could not extract article text. The site may block scrapers.")
        words = text.split()
        if len(words) > 4000:
            text = " ".join(words[:4000]) + "…"
        result = llm_json([
            {"role": "system", "content": "You are a deep reading assistant. Always respond with valid JSON only."},
            {"role": "user",   "content": DEEP_READ_PROMPT.format(title=title, text=text)},
        ])
        return DeepReadResponse(
            title=title, url=req.url,
            facts=result.get("facts", []),
            context=result.get("context", []),
            implications=result.get("implications", []),
        )
    except HTTPException:
        raise
    except Exception as e:
        import traceback; traceback.print_exc()
        raise HTTPException(500, str(e))


@app.post("/api/knowledge")
def save_knowledge(req: SaveNoteRequest):
    try:
        note_id = str(uuid.uuid4())
        kb.save_note(
            note_id=note_id,
            title=req.title, url=req.url,
            date=datetime.now().strftime("%Y-%m-%d"),
            facts=req.facts, context=req.context, implications=req.implications,
            inference=req.inference, domains=req.domains,
        )
        return {"id": note_id, "saved": True}
    except Exception as e:
        import traceback; traceback.print_exc()
        raise HTTPException(500, str(e))


@app.get("/api/knowledge")
def get_knowledge(query: str = Query(None), domain: str = Query(None)):
    try:
        notes = kb.search_notes(query, domain=domain) if query else kb.get_all_notes(domain=domain)
        return {"notes": notes, "domains": kb.get_all_domains()}
    except Exception as e:
        import traceback; traceback.print_exc()
        raise HTTPException(500, str(e))


@app.get("/api/review")
def get_review():
    try:
        notes = kb.get_recent_notes(days=7)
        if len(notes) < 2:
            return {
                "message": f"Not enough notes — {len(notes)} saved this week. Read and save at least 2 articles first.",
                "themes": [], "patterns": [], "gaps": [], "revisits": [],
            }
        notes_text = "\n\n---\n\n".join([
            f"Title: {n['title']}\nDate: {n['date']}\nDomains: {', '.join(n['domains'])}\n"
            f"Facts: {' | '.join(n['facts'])}\n"
            f"Context: {' | '.join(n['context'])}\n"
            f"Implications: {' | '.join(n['implications'])}\n"
            f"My inference: {n['inference']}"
            for n in notes
        ])
        return llm_json([
            {"role": "system", "content": "You are an intelligence analyst. Always respond with valid JSON only."},
            {"role": "user",   "content": WEEKLY_REVIEW_PROMPT.format(count=len(notes), notes=notes_text)},
        ], temperature=0.4)
    except Exception as e:
        import traceback; traceback.print_exc()
        raise HTTPException(500, str(e))


# Static files — must be mounted LAST so API routes take priority
app.mount("/", StaticFiles(directory="static", html=True), name="static")
