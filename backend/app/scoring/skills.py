"""Skills taxonomy with aliases, plus user-defined custom skills.

Custom skills live in DATA_DIR/custom_skills.json and are merged at runtime so
recruiters can add company-specific tools without touching code.
"""
from __future__ import annotations

import json
import os
import re
import threading

from app.config import DATA_DIR

_CUSTOM_FILE = os.path.join(DATA_DIR, "custom_skills.json")
_lock = threading.Lock()

# Canonical skill -> list of aliases (all lowercased).
BUILTIN_SKILLS: dict[str, list[str]] = {
    "javascript": ["javascript", "js", "es6"],
    "typescript": ["typescript", "ts"],
    "python": ["python"],
    "java": ["java"],
    "c++": ["c++", "cpp"],
    "c#": ["c#", "csharp"],
    "go": ["golang", "go"],
    "rust": ["rust"],
    "sql": ["sql", "mysql", "postgresql", "postgres"],
    "react": ["react", "reactjs", "react.js"],
    "angular": ["angular", "angularjs"],
    "vue": ["vue", "vuejs", "vue.js"],
    "node.js": ["node.js", "nodejs", "node"],
    "django": ["django"],
    "flask": ["flask"],
    "fastapi": ["fastapi"],
    "docker": ["docker"],
    "kubernetes": ["kubernetes", "k8s"],
    "aws": ["aws", "amazon web services"],
    "azure": ["azure"],
    "gcp": ["gcp", "google cloud"],
    "machine learning": ["machine learning", "ml"],
    "deep learning": ["deep learning", "neural networks", "cnn", "rnn"],
    "nlp": ["nlp", "natural language processing"],
    "generative ai": ["generative ai", "gen ai", "genai", "generative artificial intelligence"],
    "llm": ["llm", "llms", "large language model", "large language models"],
    "prompt engineering": ["prompt engineering", "prompting"],
    "rag": ["rag", "retrieval augmented generation", "retrieval-augmented"],
    "langchain": ["langchain", "llama index", "llamaindex"],
    "openai": ["openai", "openai api", "gpt", "gpt-4", "chatgpt"],
    "anthropic": ["anthropic", "claude", "claude api"],
    "hugging face": ["hugging face", "huggingface", "transformers"],
    "scikit-learn": ["scikit-learn", "sklearn", "scikit learn"],
    "computer vision": ["computer vision", "opencv", "image recognition"],
    "tensorflow": ["tensorflow", "keras"],
    "pytorch": ["pytorch"],
    "pandas": ["pandas"],
    "numpy": ["numpy"],
    "spark": ["spark", "apache spark", "pyspark"],
    "databricks": ["databricks", "delta lake"],
    "airflow": ["airflow", "apache airflow"],
    "kafka": ["kafka", "apache kafka"],
    "hadoop": ["hadoop", "hive", "mapreduce"],
    "etl": ["etl", "elt", "data pipeline", "data pipelines"],
    "power bi": ["power bi", "powerbi"],
    "tableau": ["tableau"],
    "excel": ["excel", "advanced excel", "ms excel", "spreadsheets"],
    "snowflake": ["snowflake"],
    "mongodb": ["mongodb", "mongo", "nosql"],
    "redis": ["redis"],
    "elasticsearch": ["elasticsearch", "elastic search"],
    "terraform": ["terraform"],
    "ci/cd": ["ci/cd", "ci cd", "cicd", "jenkins", "github actions", "gitlab ci"],
    "linux": ["linux", "unix", "bash", "shell scripting"],
    "git": ["git", "github", "gitlab", "bitbucket"],
    "graphql": ["graphql"],
    "rest": ["rest", "rest api", "rest apis", "restful", "restful api"],
    "spring": ["spring", "spring boot"],
    "dotnet": [".net", "dotnet", "asp.net"],
    "php": ["php", "laravel"],
    "ruby": ["ruby", "ruby on rails", "rails"],
    "swift": ["swift", "ios development"],
    "kotlin": ["kotlin", "android development"],
    "flutter": ["flutter", "dart"],
    "next.js": ["next.js", "nextjs"],
    "tailwind": ["tailwind", "tailwindcss"],
    "figma": ["figma"],
    "jira": ["jira"],
    "agile": ["agile", "scrum", "kanban"],
    "seo": ["seo", "search engine optimization"],
    "salesforce": ["salesforce"],
    "sap": ["sap"],
    "html": ["html", "html5"],
    "css": ["css", "css3", "scss", "sass"],
}

SKILL_ALIASES: dict[str, list[str]] = {}
_ALIAS_TO_CANON: dict[str, str] = {}


def _load_custom() -> dict[str, list[str]]:
    if not os.path.exists(_CUSTOM_FILE):
        return {}
    try:
        with open(_CUSTOM_FILE, encoding="utf-8") as f:
            data = json.load(f)
        return {k.lower(): [a.lower() for a in v] for k, v in data.items() if isinstance(v, list)}
    except Exception:  # noqa: BLE001
        return {}


def _save_custom(custom: dict[str, list[str]]) -> None:
    with open(_CUSTOM_FILE, "w", encoding="utf-8") as f:
        json.dump(custom, f, indent=2)


def rebuild() -> None:
    """Merge built-in + custom skills and rebuild the alias lookup."""
    with _lock:
        merged = {k: list(v) for k, v in BUILTIN_SKILLS.items()}
        for k, aliases in _load_custom().items():
            merged.setdefault(k, [])
            for a in [k] + aliases:
                if a not in merged[k]:
                    merged[k].append(a)
        SKILL_ALIASES.clear()
        SKILL_ALIASES.update(merged)
        _ALIAS_TO_CANON.clear()
        for canon, aliases in SKILL_ALIASES.items():
            for a in aliases:
                _ALIAS_TO_CANON[a] = canon


def list_custom() -> dict[str, list[str]]:
    return _load_custom()


def add_custom(name: str, aliases: list[str]) -> dict[str, list[str]]:
    name = name.strip().lower()
    if not name:
        raise ValueError("Skill name is required.")
    custom = _load_custom()
    clean = sorted({a.strip().lower() for a in aliases if a.strip()} - {name})
    custom[name] = clean
    _save_custom(custom)
    rebuild()
    return custom


def remove_custom(name: str) -> dict[str, list[str]]:
    custom = _load_custom()
    custom.pop(name.strip().lower(), None)
    _save_custom(custom)
    rebuild()
    return custom


def contains_term(text: str, term: str) -> bool:
    """Whole-word/phrase match that avoids substring false positives
    (e.g. "java" must not match inside "javascript")."""
    term = term.strip().lower()
    if not term:
        return False
    escaped = re.escape(term)
    pattern = rf"(?<![a-z0-9+#]){escaped}(?![a-z0-9+#])"
    return re.search(pattern, text.lower()) is not None


def canonical_skills_in(text: str) -> set[str]:
    """Return the set of canonical known skills present in text."""
    found: set[str] = set()
    for alias, canon in _ALIAS_TO_CANON.items():
        if contains_term(text, alias):
            found.add(canon)
    return found


rebuild()
