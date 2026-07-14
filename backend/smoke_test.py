"""Quick offline check of parsing + scoring, no server needed."""
from app.parsing.resume_parser import parse_resume
from app.scoring.engine import JobPosting, score_resume

JD_TITLE = "Senior Backend Python Engineer"
JD_DESC = """We are looking for a Senior Backend Engineer with 5+ years of
experience. Must be strong in Python, FastAPI, PostgreSQL and Docker.
Experience with AWS and Kubernetes is a plus. REST API design required."""

R1 = """Jane Doe
jane.doe@example.com | +1 (415) 555-2671
Senior Software Engineer with 7 years of experience.
Skills: Python, FastAPI, PostgreSQL, Docker, AWS, Kubernetes, REST APIs, Git.
"""

R2 = """Bob Smith
bob_smith@mail.com
+44 20 7946 0958
Frontend developer, 2 years experience. React, JavaScript, HTML, CSS.
Some Python scripting.
"""

R3 = """Carlos Ruiz
carlos@dev.io  (555) 123-4567
Backend engineer, 4 years. Python, Flask, MySQL, Docker, Git, REST.
"""

job = JobPosting(JD_TITLE, JD_DESC)
print("Required skills:", sorted(job.required_skills))
print("Required years:", job.required_years)
print("-" * 60)

for fn, txt in [("jane.txt", R1), ("bob.txt", R2), ("carlos.txt", R3)]:
    p = parse_resume(fn, txt)
    s = score_resume(p, job)
    print(f"{p.name:14} | score={s.total:5} | exp={p.experience_years} "
          f"| email={p.email} | phone={p.phone}")
    print(f"   matched={s.matched_skills}")
    print(f"   missing={s.missing_skills}")
