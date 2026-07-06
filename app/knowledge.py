try:
    __import__("pysqlite3")
    import sys
    sys.modules["sqlite3"] = sys.modules.pop("pysqlite3")
except ImportError:
    pass

import chromadb
import json
import os
from datetime import datetime, timedelta

CHROMA_PATH = os.environ.get("CHROMA_PATH", "/home/chroma_db")
_collection = None


def _col():
    global _collection
    if _collection is None:
        client = chromadb.PersistentClient(path=CHROMA_PATH)
        _collection = client.get_or_create_collection(
            name="knowledge_notes",
            metadata={"hnsw:space": "cosine"},
        )
    return _collection


def save_note(note_id, title, date, facts, context, implications, inference, domains, url):
    doc = " ".join([title, *facts, *context, *implications, f"Inference: {inference}"])
    _col().upsert(
        ids=[note_id],
        documents=[doc],
        metadatas=[{
            "title": title, "date": date,
            "inference": inference,
            "domains": json.dumps(domains),
            "url": url,
            "facts": json.dumps(facts),
            "context": json.dumps(context),
            "implications": json.dumps(implications),
        }],
    )


def search_notes(query, domain=None, n=20):
    col = _col()
    count = col.count()
    if count == 0:
        return []
    results = col.query(query_texts=[query], n_results=min(n, count))
    notes = _parse(results["ids"][0], results["metadatas"][0],
                   results.get("distances", [[]])[0])
    if domain:
        notes = [note for note in notes if domain in note["domains"]]
    return notes


def get_all_notes(domain=None):
    col = _col()
    if col.count() == 0:
        return []
    r = col.get(include=["metadatas"])
    notes = _parse(r["ids"], r["metadatas"])
    if domain:
        notes = [note for note in notes if domain in note["domains"]]
    return sorted(notes, key=lambda x: x["date"], reverse=True)


def get_recent_notes(days=7):
    cutoff = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
    return [n for n in get_all_notes() if n["date"] >= cutoff]


def get_all_domains():
    domains = set()
    for n in get_all_notes():
        domains.update(n["domains"])
    return sorted(domains)


def _parse(ids, metas, distances=None):
    notes = []
    for i, (nid, m) in enumerate(zip(ids, metas)):
        note = {
            "id": nid,
            "title": m["title"], "date": m["date"],
            "inference": m["inference"],
            "domains": json.loads(m["domains"]),
            "url": m["url"],
            "facts": json.loads(m["facts"]),
            "context": json.loads(m["context"]),
            "implications": json.loads(m["implications"]),
        }
        if distances:
            note["score"] = round(1 - distances[i], 3)
        notes.append(note)
    return notes
