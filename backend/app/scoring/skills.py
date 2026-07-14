"""A small, extensible skills taxonomy used for keyword matching.

The scorer does not depend on this list being exhaustive: any token found in
the job description is treated as a required skill. This taxonomy simply helps
recognise multi-word skills and common aliases.
"""
from __future__ import annotations

import re

# Canonical skill -> list of aliases (all lowercased).
SKILL_ALIASES: dict[str, list[str]] = {
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
    "deep learning": ["deep learning"],
    "nlp": ["nlp", "natural language processing"],
    "tensorflow": ["tensorflow"],
    "pytorch": ["pytorch"],
    "pandas": ["pandas"],
    "numpy": ["numpy"],
    "git": ["git"],
    "graphql": ["graphql"],
    "rest": ["rest", "rest api", "restful"],
    "html": ["html", "html5"],
    "css": ["css", "css3", "scss", "sass"],
}

# Reverse lookup: alias -> canonical
_ALIAS_TO_CANON: dict[str, str] = {}
for canon, aliases in SKILL_ALIASES.items():
    for a in aliases:
        _ALIAS_TO_CANON[a] = canon


def contains_term(text: str, term: str) -> bool:
    """Whole-word/phrase match that avoids substring false positives.

    e.g. "java" must not match inside "javascript".
    """
    term = term.strip().lower()
    if not term:
        return False
    escaped = re.escape(term)
    # \b works poorly for tokens containing + or #, so guard with lookarounds.
    pattern = rf"(?<![a-z0-9+#]){escaped}(?![a-z0-9+#])"
    return re.search(pattern, text.lower()) is not None


def canonical_skills_in(text: str) -> set[str]:
    """Return the set of canonical known skills present in text."""
    found: set[str] = set()
    for alias, canon in _ALIAS_TO_CANON.items():
        if contains_term(text, alias):
            found.add(canon)
    return found
