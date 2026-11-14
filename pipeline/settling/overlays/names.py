"""Readable names for the places overlay: the BPE spells them in upper case, mostly without accents."""

from __future__ import annotations

import re

MAX_NAME_CHARS = 60
# BPE's "not applicable" and "undetermined" markers, and the empty string.
NO_NAME = frozenset({"", "_Z", "_U"})
SMALL_WORDS = frozenset({"de", "du", "des", "la", "le", "les", "et", "sur", "sous", "en", "au", "aux"})
# d' and l' are small words only before their apostrophe: the "D" of "2D degré" is not.
ELIDED = frozenset({"d", "l"})
APOSTROPHES = ("'", "’")
# Words of the names of the public institutions kept here that lose their accents in the source. A short list on
# purpose: whatever is not here keeps the source spelling.
ACCENTS = {
    "ecole": "école", "ecoles": "écoles", "college": "collège", "colleges": "collèges", "lycee": "lycée",
    "lycees": "lycées", "bibliotheque": "bibliothèque", "bibliotheques": "bibliothèques",
    "mediatheque": "médiathèque", "mediatheques": "médiathèques", "cinema": "cinéma", "cinemas": "cinémas",
    "hopital": "hôpital", "universite": "université", "elementaire": "élémentaire", "general": "général",
    "generale": "générale", "creche": "crèche", "theatre": "théâtre", "metiers": "métiers", "cite": "cité",
    "hotel": "hôtel", "sante": "santé", "regional": "régional", "etablissement": "établissement",
    "andre": "andré", "rene": "rené", "francois": "françois", "emile": "émile", "therese": "thérèse",
    "etienne": "étienne", "prevert": "prévert", "jaures": "jaurès", "exupery": "exupéry", "sacre": "sacré",
    "degre": "degré", "chateau": "château",
}
# Abbreviations that stay in capitals: LPO (lycée polyvalent), BP/AP/RP (bureau, agence, relais de poste), ...
ACRONYMS = frozenset({
    "AP", "BP", "RP", "RPI", "RPID", "LP", "LPO", "LPR", "LPA", "LPAC", "UFR", "IUT", "INSPE", "CH", "CHU", "CHR",
    "CHRU", "MFR", "MFREO", "SNCF", "TGV", "INSA", "SEP", "SGT", "STS", "CC", "PK",
})
_WORD = re.compile(r"[^\W\d_]+")
_ROMAN_NUMERAL = re.compile(r"[IVX]{2,5}")


def normalise_name(raw: str | None) -> str | None:
    """Title case with French small words, accents restored for ACCENTS, at most MAX_NAME_CHARS; None if no name."""
    text = " ".join((raw or "").split())
    if text in NO_NAME:
        return None
    first = _WORD.search(text)
    if first is None:
        return None
    readable = _WORD.sub(lambda match: _word(match, text, first.start()), text)
    return _cut(readable)


def _word(match: re.Match[str], text: str, first_start: int) -> str:
    word = match.group()
    lower = word.lower()
    if match.start() != first_start:
        elided = lower in ELIDED and text[match.end():match.end() + 1] in APOSTROPHES
        if lower in SMALL_WORDS or elided:
            return lower
    if word in ACRONYMS or _ROMAN_NUMERAL.fullmatch(word):
        return word
    return ACCENTS.get(lower, word).capitalize()


def _cut(text: str) -> str:
    if len(text) <= MAX_NAME_CHARS:
        return text
    head = text[:MAX_NAME_CHARS - 1]
    if text[MAX_NAME_CHARS - 1] != " " and " " in head:
        head = head.rsplit(" ", 1)[0]
    return head.rstrip(" ,;:-'") + "…"
