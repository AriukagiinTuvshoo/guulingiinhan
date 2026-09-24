"""Unicode-safe normalization shared by person writes and paginated search."""

import unicodedata


def normalize_search_name(value: str | None) -> str:
    if not value:
        return ""
    return " ".join(unicodedata.normalize("NFKC", value).casefold().split())
