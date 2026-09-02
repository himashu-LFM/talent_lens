"""Generate the end-to-end test data set described in docs/TESTING.md §2.

Usage (from repo root, using the backend venv):
    backend\\venv\\Scripts\\python.exe scripts\\make_test_data.py

Creates ./test-data/ with 13 resume files + 3 job descriptions.
"""
from __future__ import annotations

import os
import random

from docx import Document
from PIL import Image, ImageDraw
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "test-data")
os.makedirs(OUT, exist_ok=True)


def pdf(name: str, lines: list[str]) -> str:
    path = os.path.join(OUT, name)
    c = canvas.Canvas(path, pagesize=A4)
    w, h = A4
    y = h - 20 * mm
    for i, ln in enumerate(lines):
        if y < 20 * mm:
            c.showPage()
            y = h - 20 * mm
        if i == 0:
            c.setFont("Helvetica-Bold", 16)
        elif ln.isupper() and len(ln) < 30:
            c.setFont("Helvetica-Bold", 11)
        else:
            c.setFont("Helvetica", 10)
        c.drawString(20 * mm, y, ln)
        y -= 6.2 * mm
    c.save()
    return path


def docx_file(name: str, lines: list[str]) -> str:
    path = os.path.join(OUT, name)
    d = Document()
    for i, ln in enumerate(lines):
        p = d.add_paragraph(ln)
        if i == 0:
            p.runs[0].bold = True
    d.save(path)
    return path


def txt(name: str, lines: list[str]) -> str:
    path = os.path.join(OUT, name)
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    return path


# --------------------------------------------------------------------------
STRONG = [
    "Priya Sharma",
    "priya.sharma@example.com | +91 98765 43210 | Bengaluru, India | linkedin.com/in/priyasharma",
    "SUMMARY",
    "Senior Machine Learning Engineer with 7+ years of experience building and shipping",
    "production AI systems: LLM applications, RAG pipelines, and AI agents on OpenAI and Claude APIs.",
    "EXPERIENCE",
    "Senior ML Engineer - Nimbus Labs, Bengaluru | Jan 2021 - Present",
    "- Designed a retrieval augmented generation platform (RAG) serving 2M queries/month.",
    "- Built AI agents with the OpenAI API and Anthropic Claude API; owned prompt engineering standards.",
    "- Trained deep learning models in TensorFlow and PyTorch; deployed with Docker on AWS.",
    "Machine Learning Engineer - DataForge | Jun 2018 - Dec 2020",
    "- Developed machine learning pipelines in Python (pandas, scikit-learn) and SQL.",
    "- Built Power BI dashboards for model monitoring.",
    "Software Engineer - Initech | Jul 2016 - May 2018",
    "- Backend services in Python and REST APIs.",
    "EDUCATION",
    "B.Tech Computer Science - IIT Delhi | 2012 - 2016",
    "SKILLS",
    "Python, Machine Learning, Deep Learning, TensorFlow, PyTorch, LLMs, Prompt Engineering, RAG,",
    "LangChain, OpenAI API, Claude API, AI Agents, NLP, Power BI, SQL, Docker, AWS, Git",
]

PARTIAL = [
    "Daniel Osei",
    "daniel.osei@example.com | +233 24 555 0199 | Accra, Ghana",
    "SUMMARY",
    "Data scientist focused on classical machine learning and model deployment.",
    "EXPERIENCE",
    "Data Scientist - Fintech Co | Mar 2020 - Present",
    "- Built churn and credit-risk models in Python with scikit-learn and PyTorch.",
    "- Deployed models with Docker; wrote SQL for feature pipelines.",
    "Analyst - RetailCorp | Feb 2018 - Feb 2020",
    "- Reporting and analytics in SQL and Excel.",
    "EDUCATION",
    "MSc Statistics - University of Ghana | 2016 - 2018",
    "SKILLS",
    "Python, Machine Learning, PyTorch, scikit-learn, Docker, SQL, Excel, Git",
]

WEAK = [
    "Mei Lin",
    "mei.lin@example.com | +65 8123 4567 | Singapore",
    "SUMMARY",
    "Enterprise sales executive with a record of exceeding quota in SaaS.",
    "EXPERIENCE",
    "Account Executive - CloudSell | Apr 2019 - Present",
    "- Managed a pipeline of 120 accounts in Salesforce; closed $4.2M ARR.",
    "- Negotiated multi-year contracts; ran QBRs with C-level stakeholders.",
    "Sales Development Rep - LeadGen Inc | Jan 2017 - Mar 2019",
    "- Outbound prospecting, Excel reporting, basic SQL for lead lists.",
    "EDUCATION",
    "BBA Marketing - NUS | 2013 - 2017",
    "SKILLS",
    "Salesforce, Negotiation, Excel, Presentations, CRM, Lead Generation",
]

ALT_A = [
    "Arjun Mehta",
    "arjun.mehta@example.com | +91 91234 56780 | Pune, India",
    "EXPERIENCE",
    "ML Engineer - VisionWorks | Aug 2019 - Present",
    "- Computer vision and deep learning models in TensorFlow and Keras; Python end to end.",
    "- Prompt engineering and RAG prototypes with the OpenAI API; built small AI agents.",
    "EDUCATION",
    "B.E. Computer Engineering - COEP | 2015 - 2019",
    "SKILLS",
    "Python, Machine Learning, TensorFlow, Keras, LLMs, Prompt Engineering, RAG, OpenAI API, SQL",
]

ALT_B = [
    "Sara Khan",
    "sara.khan@example.com | +44 7700 900123 | London, UK",
    "EXPERIENCE",
    "Applied Scientist - NLP Studio | Sep 2019 - Present",
    "- Fine-tuned transformer models in PyTorch; built LLM features with the Claude API.",
    "- Implemented retrieval augmented generation and prompt engineering guidelines; shipped AI agents.",
    "EDUCATION",
    "MSc Machine Learning - UCL | 2018 - 2019",
    "SKILLS",
    "Python, Machine Learning, PyTorch, Hugging Face, LLMs, Prompt Engineering, RAG, Claude API, SQL",
]

STUDENT = [
    "Rupesh Verma",
    "rupesh.verma@example.com | +91 88140 54933 | Jaipur, India",
    "OBJECTIVE",
    "Final-year student seeking an AI engineering internship.",
    "EDUCATION",
    "B.Tech Computer Science - Poornima Institute of Engineering & Technology | 2022 - 2026",
    "Senior Secondary (CBSE) - Kendriya Vidyalaya | 2020 - 2022",
    "INTERNSHIP",
    "AI Intern - Celebal Technologies | May 2025 - Aug 2025",
    "- Built a GenAI research assistant with the Claude API and LangChain; Python and Power BI.",
    "PROJECTS",
    "Resume screener using embeddings and prompt engineering.",
    "SKILLS",
    "Python, Generative AI, Prompt Engineering, LangChain, Claude API, Power BI, SQL",
]

TYPO = [
    "Karan Singh",
    "karan.singh@example.com | +91 99887 76655 | Delhi",
    "EXPERIENCE",
    "Backend Developer - AppWorks | Feb 2020 - Present",
    "- Services in Pyhton and Go; deployed on Kubernets with Dockr; models in Tensorflw.",
    "- Some machne learning work and LLM prompt enginering for a chatbot.",
    "EDUCATION",
    "B.Tech IT - DTU | 2016 - 2020",
    "SKILLS",
    "Pyhton, Kubernets, Tensorflw, SQL, Git, REST APIs",
]

NOTRESUME = [
    "To",
    "The Hostel Warden,",
    "GS 4, PCE",
    "Date: 30 April 2026",
    "Subject: Application for Permanent Leaving of Hostel After Completion of B.Tech",
    "Respected Sir/Madam,",
    "I am a student of B.Tech final year, residing in Room No. 011 of the hostel. I would like",
    "to inform you that I have successfully completed my course. Therefore, I kindly request",
    "you to allow me to leave the hostel permanently and process the refund of my security deposit.",
    "Thanking you,",
    "Yours sincerely,",
]

DUP = [
    "Neha Gupta",
    "neha.gupta@example.com | +91 90000 11111 | Hyderabad",
    "EXPERIENCE",
    "Data Engineer - Streamline | Oct 2019 - Present",
    "- Spark and Airflow pipelines in Python; SQL on Snowflake; Power BI reporting.",
    "EDUCATION",
    "B.Tech - JNTU | 2015 - 2019",
    "SKILLS",
    "Python, Spark, Airflow, SQL, Snowflake, Power BI, Docker",
]

SAME_PERSON = [
    "Priya Sharma",
    "priya.sharma@example.com | +91 98765 43210",
    "EXPERIENCE",
    "Senior ML Engineer - Nimbus Labs | Jan 2021 - Present",
    "- LLM applications, RAG and prompt engineering; Python, TensorFlow, PyTorch.",
    "SKILLS",
    "Python, Machine Learning, TensorFlow, PyTorch, LLMs, Prompt Engineering, RAG, OpenAI",
]

JD_GOOD = """AI Engineer

We are hiring an AI Engineer with 3+ years of experience to build and ship production AI features.

Must have: Python, machine learning, and TensorFlow or PyTorch.
Required: experience with LLMs, prompt engineering and RAG, and hands-on work with OpenAI or Claude APIs building AI agents.
Nice to have: Power BI is a plus.

You will design, build and deploy AI features end to end, own model evaluation, and collaborate
with product and data teams to deliver measurable outcomes. Strong communication skills required.
"""

JD_BAD = "We need a rockstar ninja developer who is young and energetic for a fast-paced dynamic team."

JD_NONTECH = """Marketing Manager

We're looking for a Marketing Manager with 4+ years of experience. Must have strong experience
with SEO, Salesforce and Excel, plus campaign management and content strategy. Experience with
Google Analytics and HubSpot is a plus. You will own the marketing calendar, run paid and organic
campaigns, report on performance to leadership, and manage two coordinators.
"""


def main() -> None:
    made = []
    made.append(pdf("strong.pdf", STRONG))
    made.append(pdf("partial.pdf", PARTIAL))
    made.append(docx_file("weak.docx", WEAK))
    made.append(pdf("alt-a.pdf", ALT_A))
    made.append(pdf("alt-b.pdf", ALT_B))
    made.append(pdf("student.pdf", STUDENT))
    made.append(txt("typo.txt", TYPO))
    made.append(pdf("notresume.pdf", NOTRESUME))
    made.append(pdf("dup1.pdf", DUP))
    made.append(pdf("dup2.pdf", DUP))
    made.append(pdf("same-person.pdf", SAME_PERSON))

    # scanned.pdf — image-only page (no text layer)
    img = Image.new("RGB", (1240, 1754), "white")
    d = ImageDraw.Draw(img)
    for i, ln in enumerate(STRONG[:10]):
        d.text((80, 80 + i * 40), ln, fill="black")
    img_path = os.path.join(OUT, "_scan.png")
    img.save(img_path)
    c = canvas.Canvas(os.path.join(OUT, "scanned.pdf"), pagesize=A4)
    c.drawImage(img_path, 0, 0, width=A4[0], height=A4[1])
    c.save()
    os.remove(img_path)
    made.append(os.path.join(OUT, "scanned.pdf"))

    # big.pdf — valid PDF padded past the 15 MB limit
    small = pdf("_tmp.pdf", STRONG)
    with open(small, "rb") as f:
        data = f.read()
    os.remove(small)
    with open(os.path.join(OUT, "big.pdf"), "wb") as f:
        f.write(data)
        f.write(b"\n%" + b"0" * (16 * 1024 * 1024))
    made.append(os.path.join(OUT, "big.pdf"))

    # bad.pdf — random bytes
    random.seed(7)
    with open(os.path.join(OUT, "bad.pdf"), "wb") as f:
        f.write(bytes(random.getrandbits(8) for _ in range(4096)))
    made.append(os.path.join(OUT, "bad.pdf"))

    for name, body in (("jd-good.txt", JD_GOOD), ("jd-bad.txt", JD_BAD), ("jd-nontech.txt", JD_NONTECH)):
        made.append(txt(name, body.strip().splitlines()))

    print(f"Created {len(made)} files in {OUT}:")
    for p in made:
        print("  -", os.path.basename(p), f"({os.path.getsize(p):,} bytes)")


if __name__ == "__main__":
    main()
