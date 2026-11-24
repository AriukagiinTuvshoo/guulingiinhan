"""Mongolian Oral History (Аман түүх) & Life Events NLP Extractor.

Extracts chronological milestones, locations, life events and structured
biographies from Mongolian elder narratives, interviews, and memories.
Follows Domain-Driven Design (DDD) with deterministic rule-based NLP
and optional GenAI enhancement.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date


@dataclass
class ExtractedMilestone:
    event_type: str
    title: str
    event_date: date | None = None
    date_note: str | None = None
    location: str | None = None
    description: str | None = None


# Patterns for extracting dates in Mongolian narratives
YEAR_PATTERN = re.compile(r"\b((?:18|19|20)\d{2})\s*(?:он[ыдо]?|оны|онд)?\b")
MONTH_PATTERN = re.compile(r"\b(\d{1,2})[-р\s]+сар(?:д|ын|аар)?\b")
DAY_PATTERN = re.compile(r"\b(\d{1,2})[-нныийд\s]+өдөр\b")
SEASON_PATTERN = re.compile(r"\b(хавар|зун|намар|өвөл|хаврын|зуны|намрын|өвлийн)\b", re.IGNORECASE)

# Location markers
LOCATION_PATTERN = re.compile(
    r"([А-ЯЁӨҮ][а-яёөүA-Za-z\-]+(?:\s+[А-ЯЁӨҮа-яёөүA-Za-z\-]+){0,2}\s+(?:аймаг|сум|хот|дүүрэг|баг|хороо|нутаг|голын|уулын|хөндийн|тосгон)(?:[тдн]?))",
    re.IGNORECASE,
)


def extract_location(text: str) -> str | None:
    match = LOCATION_PATTERN.search(text)
    if match:
        loc = match.group(1).strip()
        # Clean trailing inflection suffixes
        loc = re.sub(r"[тдн]$", "", loc).strip()
        return loc
    return None


def extract_date_info(text: str) -> tuple[date | None, str | None]:
    year_match = YEAR_PATTERN.search(text)
    if not year_match:
        return None, None

    year = int(year_match.group(1))
    month_match = MONTH_PATTERN.search(text)
    month = int(month_match.group(1)) if month_match and 1 <= int(month_match.group(1)) <= 12 else 1
    day_match = DAY_PATTERN.search(text)
    day = int(day_match.group(1)) if day_match and 1 <= int(day_match.group(1)) <= 28 else 1

    season_match = SEASON_PATTERN.search(text)
    date_note = f"{year} он"
    if month_match:
        date_note += f", {month_match.group(1)}-р сар"
    elif season_match:
        date_note += f", {season_match.group(1)}"

    try:
        event_date = date(year, month, day)
    except ValueError:
        event_date = date(year, 1, 1)

    return event_date, date_note


def classify_event_type(text: str) -> tuple[str, str]:
    """Classifies a sentence or clause into a LifeEvent type and Mongolian title."""
    t = text.lower()

    if any(k in t for k in ["төрсөн", "мэндэлсэн", "мэндэлжээ", "мэлмий гийсэн", "мэндэлсэн нь", "мэндэлж"]):
        return "birth", "Мэндэлсэн (Төрсөн)"

    if any(k in t for k in ["нас барсан", "нас барж", "бурхан болсон", "тэнгэрт дэвшсэн", "таалал төгссөн"]):
        return "death", "Тэнгэрт дэвшсэн"

    if any(k in t for k in ["одон", "медаль", "гавьяат", "цол", "баяр", "өргөмжлөл", "шагнал", "шагнуул", "хүрт"]):
        return "award", "Гавьяа шагнал, цол"

    if any(k in t for k in ["гэрлэ", "ханил", "хурим", "айл бол", "суусан", "гэр бүл бол"]):
        return "marriage", "Гэр бүл болсон (Хурим)"

    if any(k in t for k in ["хүүтэй", "охинтой", "хүүхэдтэй", "хүү нь", "охин нь", "хүү төр", "охин төр"]):
        return "child_birth", "Хүүхэд мэндэлсэн"

    if any(k in t for k in ["нүүж", "шилжин", "шилжиж", "суурьш", "шилжс", "нутагла"]):
        return "move", "Шилжин суурьшсан (Нүүдэл)"

    # Check school / graduation before work unless explicit work verbs like "ажилла", "томилогд"
    has_school = any(k in t for k in ["сургууль", "их сургууль", "коллеж", "техникум", "цэцэрлэг", "институт", "төгс", "дүүргэ", "суралц", "оюутан", "боловсрол"])
    has_work_verb = any(k in t for k in ["ажилла", "томилогд", "алба хаа", "цэрэгт яв"])

    if has_school and not has_work_verb:
        return "school", "Боловсрол, сургууль"

    if has_work_verb or any(k in t for k in ["ажилд ор", "алба хаа", "цэрэг", "багш", "эмч", "нягтлан", "малчин", "байлдагч", "жолооч", "инженер"]):
        return "work", "Ажил хөдөлмөр, алба"

    if has_school:
        return "school", "Боловсрол, сургууль"

    return "other", "Амьдралын дурсамж"


def parse_oral_narrative(
    narrative_text: str, person_name: str | None = None
) -> tuple[str, list[ExtractedMilestone]]:
    """Parses raw text of an oral history into structured milestones and a synthesized biography."""
    raw = narrative_text.strip()
    if not raw:
        return "", []

    # First split on primary boundaries: period, newline, semicolon, exclamation, or question mark
    primary_chunks = [
        s.strip()
        for s in re.split(r"[.\n;!?]+", raw)
        if len(s.strip()) >= 5
    ]

    # Subdivide each chunk if it contains multiple separate year mentions or conjunctions like "бөгөөд"
    raw_sentences: list[str] = []
    for chunk in primary_chunks:
        # Check if chunk has conjunctions with temporal phrases
        parts = re.split(r"(?<=\S)\s+(?:бөгөөд|мөн|улмаар|түүнчлэн|дараа нь)\s+(?=\d{4}|[А-ЯЁӨҮa-z])", chunk)
        for p in parts:
            p_strip = p.strip()
            if len(p_strip) >= 5:
                raw_sentences.append(p_strip)

    milestones: list[ExtractedMilestone] = []
    seen_keys: set[tuple[str, int | None]] = set()

    for sent in raw_sentences:
        event_date, date_note = extract_date_info(sent)
        event_type, default_title = classify_event_type(sent)
        location = extract_location(sent)

        # Generate a descriptive title
        if event_type == "birth":
            title = f"{person_name or 'Тухайн хүн'} мэндэлсэн"
            if location:
                title += f" ({location})"
        elif event_type == "death":
            title = f"{person_name or 'Тухайн хүн'} таалал төгссөн"
        elif event_type == "school":
            match = re.search(r"([^,.\n]*(?:сургууль|институт|коллеж|техникум)[^,.\n]*)", sent, re.IGNORECASE)
            title = match.group(1).strip() if match else default_title
        elif event_type == "award":
            match = re.search(r"([^,.\n]*(?:одон|медаль|өргөмжлөл|цол)[^,.\n]*)", sent, re.IGNORECASE)
            title = match.group(1).strip() if match else default_title
        elif event_type == "work":
            match = re.search(r"([^,.\n]*(?:ажилла|томилогд|алба хаа)[^,.\n]*)", sent, re.IGNORECASE)
            title = match.group(1).strip() if match else default_title
        else:
            title = sent[:120].strip()

        # Limit length
        if len(title) > 175:
            title = title[:172] + "…"

        year_val = event_date.year if event_date else None
        key = (event_type, year_val)
        if key in seen_keys and event_type not in ["work", "other"]:
            continue
        seen_keys.add(key)

        milestones.append(
            ExtractedMilestone(
                event_type=event_type,
                title=title,
                event_date=event_date,
                date_note=date_note,
                location=location,
                description=sent,
            )
        )

    # Sort milestones chronologically
    milestones.sort(
        key=lambda m: (
            m.event_date or date(9999, 12, 31),
            0 if m.event_type == "birth" else 1,
        )
    )

    # Synthesize structured biography text
    bio_lines = []
    subject = person_name or "Энэхүү эрхэм"
    bio_lines.append(f"{subject}-ийн аман түүх, товч намтар:")
    bio_lines.append("")

    for m in milestones:
        time_str = m.date_note or (m.event_date.strftime("%Y он") if m.event_date else "Огноо тодорхойгүй үед")
        loc_str = f" [{m.location}]" if m.location else ""
        bio_lines.append(f"• {time_str}{loc_str}: {m.title}. {m.description or ''}".strip())

    bio_lines.append("")
    bio_lines.append("Эх сурвалж: Гэр бүлийн аман түүх ба хууч ярианы тэмдэглэл.")
    suggested_bio = "\n".join(bio_lines).strip()

    return suggested_bio, milestones
