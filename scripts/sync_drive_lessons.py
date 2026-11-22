#!/usr/bin/env python3
"""Sincroniza catálogo de aulas do Google Drive (via rclone + Drive API v3) para o SQLite do MedQuest.

Uso:
    python3 scripts/sync_drive_lessons.py --dry-run
    python3 scripts/sync_drive_lessons.py
    python3 scripts/sync_drive_lessons.py --course medcof
"""
from __future__ import annotations

import argparse
import configparser
import json
import os
import re
import sqlite3
import subprocess
import sys
import unicodedata
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT_DIR / "app" / "backend"
DEFAULT_DB_PATH = BACKEND_DIR / "medquest.db"
DEFAULT_OVERRIDES_PATH = BACKEND_DIR / "data" / "lessons_mapping_overrides.json"
RCLONE_CONF_PATH = Path.home() / ".config" / "rclone" / "rclone.conf"

sys.path.insert(0, str(BACKEND_DIR))
from api.migrations import apply_pending_migrations  # noqa: E402
from api.services.planner import get_normalized_area  # noqa: E402

VIDEO_EXTS = {".mp4", ".mkv", ".webm", ".mov"}
IGNORED_NAME_MARKERS = (".part", ".ytdl", ".fhls-")

COURSE_SOURCES = {
    "medway": {
        "course_key": "medway_r1_2026",
        "course_name": "Extensivo R1 (Medway)",
        "is_extra": 0,
        "remote_path": "Drive:katomart-backup/courses/Medway R1 - 2026",
    },
    "medcof": {
        "course_key": "medcof_r1_2026",
        "course_name": "MedCof R1 (Extras)",
        "is_extra": 1,
        "remote_path": "Drive:katomart-backup/courses/Medcof R1 2026",
    },
    "radiologia": {
        "course_key": "radiologia_2026",
        "course_name": "Imagens Radiológicas 2026",
        "is_extra": 1,
        "remote_path": "Drive:katomart-backup/courses/Imagens Radiológicas 2026",
    },
    "pratica": {
        "course_key": "medway_pratica_2026",
        "course_name": "CRMedway Prática 2026",
        "is_extra": 1,
        "remote_path": "Drive:katomart-backup/courses/Medway Prática 2026",
    },
}

MEDCOF_IGNORED_TOPIC_PATTERNS = (
    "comece por aqui",
    "onboarding",
    "diferenca entre cofexpress",
    "dailycof",
    "cofbot",
    "tarefa minima",
    "material de apoio",
    "execucao de testes",
    "estatisticas",
    "demais funcoes qbank",
    "guia estatistico",
    "revisao nucleo",
    "provas na integra onde e como fazer",
    "colocando tudo isso em ordem",
    "introducao ao extensivo e como acertar",
    "como usar a plataforma",
    "boas vindas",
    "cronograma medcof",
    "mentoria",
)

STOPWORDS = {
    "de", "da", "do", "das", "dos", "e", "em", "na", "no", "nas", "nos",
    "a", "o", "as", "os", "com", "para", "por", "sobre", "suas", "seus",
    "uma", "um", "ao", "aos", "aulas", "aula", "revisao", "rapida", "flash",
    "como", "cai", "geral", "parte", "i", "ii", "iii", "iv", "video",
    "regravacao", "acessoria", "atualizacao", "atualizacoes", "extensivo",
    "introducao", "conceitos", "basicos", "abordagem", "manejo", "diagnostico",
    "tratamento", "principios", "aspectos", "doencas", "doenca", "afeccoes",
    "disturbios", "sindromes", "sindrome", "clinica", "medica", "cirurgia",
    "pediatria", "obstetricia", "ginecologia", "preventiva", "2026", "2025",
}

MEDICAL_SYNONYMS = {
    "has": "hipertensao arterial sistemica",
    "dm": "diabetes mellitus",
    "dm1": "diabetes mellitus",
    "dm2": "diabetes mellitus",
    "ic": "insuficiencia cardiaca",
    "icc": "insuficiencia cardiaca",
    "sca": "sindromes coronarianas agudas",
    "iam": "sindromes coronarianas agudas",
    "ira": "injuria renal aguda",
    "drc": "doenca renal cronica",
    "dii": "doenca inflamatoria intestinal",
    "dpoc": "asma doenca pulmonar obstrutiva cronica",
    "pac": "pneumonia adquirida comunidade",
    "itu": "infeccao trato urinario",
    "hda": "hemorragia digestiva alta",
    "hdb": "hemorragia digestiva baixa",
    "avc": "acidente vascular cerebral",
    "avci": "acidente vascular cerebral isquemico",
    "avch": "acidente vascular cerebral hemorragico",
    "ave": "acidente vascular cerebral",
    "tce": "trauma cranioencefalico",
    "trm": "trauma raquimedular",
    "tep": "tromboembolismo pulmonar",
    "tvp": "trombose venosa profunda",
    "les": "lupus eritematoso sistemico",
    "ar": "artrite reumatoide",
    "pcr": "parada cardiorrespiratoria suporte avancado",
    "acls": "suporte avancado taquiarritmias bradiarritmias",
    "pals": "parada cardiorrespiratoria pediatrica",
    "sua": "sangramento uterino anormal",
    "sop": "amenorreias ovarios policisticos",
    "dip": "doenca inflamatoria pelvica",
    "dpp": "hemorragias segunda metade placenta",
    "rpmo": "amniorrexe prematura corioamnionite",
    "tpp": "trabalho parto prematuro tocolise",
    "hpp": "puerperio hemorragia pos parto",
    "pni": "calendario vacinal pni imunizacoes",
    "dnpm": "puericultura marcos desenvolvimento",
    "rn": "neonatologia recem nascido",
    "sus": "legislacao diretrizes evolucao sus",
    "sinan": "vigilancia saude notificacao compulsoria sinan",
    "hpv": "rastreamento citopatologico hpv",
    "esf": "atencao primaria saude estrategia saude familia",
    "aps": "atencao primaria saude estrategia saude familia",
    "hpb": "hiperplasia prostatica benigna",
    "drge": "doenca refluxo gastroesofagico",
    "paf": "polipose adenomatosa familiar",
    "hiv": "infeccao pelo hiv tarv",
    "aids": "infeccao pelo hiv tarv",
    "tb": "tuberculose pulmonar extrapulmonar",
    "ist": "infeccoes sexualmente transmissiveis",
    "dst": "infeccoes sexualmente transmissiveis",
    "oma": "vias aereas superiores oma sinusite",
    "hac": "suprarrenal hiperplasia adrenal",
    "chc": "cirrose hepatica hipertensao portal",
    "tea": "transtornos neurodesenvolvimento tea tdah",
    "tdah": "transtornos neurodesenvolvimento tea tdah",
    "sara": "ventilacao mecanica sara insuficiencia respiratoria",
    "iva": "insuficiencia respiratoria aguda",
    "rciu": "medicina fetal rciu isoimunizacao",
    "vasculite": "vasculites sistemicas",
    "colecistite": "litiase biliar colecistite colangite",
    "colelitiase": "litiase biliar colecistite colangite",
    "apendicite": "abdome agudo inflamatorio apendicite diverticulite",
    "diverticulite": "abdome agudo inflamatorio apendicite diverticulite",
    "abortamento": "hemorragias primeira metade abortamento ectopica mola",
    "ectopica": "hemorragias primeira metade abortamento ectopica mola",
    "mola": "hemorragias primeira metade abortamento ectopica mola",
    "endometriose": "endometriose adenomiose dor pelvica",
    "endometrio": "corpo uterino endometrio sangramento",
    "mioma": "sangramento uterino anormal miomatose",
    "miomatose": "sangramento uterino anormal miomatose",
    "pre-eclampsia": "sindromes hipertensivas gravidez eclampsia",
    "eclampsia": "sindromes hipertensivas gravidez eclampsia",
    "ictericia": "ictericia neonatal doencas hematologicas",
    "bronquiolite": "disturbios obstrutivos asma bronquiolite",
    "asma": "asma doenca pulmonar obstrutiva cronica",
    "anemia": "anemias hemoglobinopatias carenciais",
    "falciforme": "diagnostico diferencial anemias hemoglobinopatias",
    "talassemia": "diagnostico diferencial anemias hemoglobinopatias",
    "ferropriva": "diagnostico diferencial anemias hemoglobinopatias",
    "leucemia": "leucemias linfomas mieloma multiplo",
    "linfoma": "leucemias linfomas mieloma multiplo",
    "mieloma": "leucemias linfomas mieloma multiplo",
    "sodio": "disturbios eletroliticos sodio potassio",
    "potassio": "disturbios eletroliticos sodio potassio",
    "gasometria": "disturbios eletroliticos equilibrio acido base",
    "tireoide": "hipotireoidismo hipertireoidismo nodulos tireoidianos",
    "hipotireoidismo": "hipotireoidismo hipertireoidismo nodulos tireoidianos",
    "hipertireoidismo": "hipotireoidismo hipertireoidismo nodulos tireoidianos",
    "adrenal": "doencas suprarrenal paratireoides calcio",
    "suprarrenal": "doencas suprarrenal paratireoides calcio",
    "paratireoide": "doencas suprarrenal paratireoides calcio",
    "pancreatite": "pancreatites aguda cronica pseudocistos",
    "acalasia": "disturbios motores esofago megaesofago disfagica",
    "disfagia": "disturbios motores esofago megaesofago disfagica",
    "hernia": "hernias parede abdominal inguinais femorais",
    "inguinal": "hernias parede abdominal inguinais femorais",
    "queimado": "atendimento paciente queimado reposicao volemica",
    "queimadura": "atendimento paciente queimado reposicao volemica",
    "queimaduras": "atendimento paciente queimado reposicao volemica",
    "melanoma": "oncologia cutanea melanoma cbc cec",
    "prostata": "uro oncologia cancer prostata rim bexiga",
    "colorretal": "neoplasias trato gastrointestinal esofago estomago colon",
    "estomago": "neoplasias trato gastrointestinal esofago estomago colon",
    "esofago": "neoplasias trato gastrointestinal esofago estomago colon",
    "pancreas": "neoplasias trato gastrointestinal esofago estomago colon",
    "dengue": "sindromes febris agudas arboviroses dengue",
    "arboviroses": "sindromes febris agudas arboviroses dengue",
    "meningite": "meningites encefalites infeccoes snc",
    "sepse": "sepse adulto choque septico ressuscitacao",
    "psoriase": "dermatologia clinica farmacodermias eczemas psoriase",
    "hanseniase": "dermatoses infecciosas hanseniase leishmanioses",
    "leishmaniose": "dermatoses infecciosas hanseniase leishmanioses",
    "gota": "artrite reumatoide espondiloartrites microcristalinas",
    "microcristalinas": "artrite reumatoide espondiloartrites microcristalinas",
    "cirrose": "cirrose hepatica hipertensao portal",
    "hepatite": "hepatites virais ictericias metabolicas",
    "hepatites": "hepatites virais ictericias metabolicas",
    "convulsao": "convulsao febril epilepsias infancia",
    "aleitamento": "aleitamento materno alimentacao complementar desnutricao",
    "desnutricao": "aleitamento materno alimentacao complementar desnutricao",
    "ovario": "massas anexiais neoplasias ovarianas",
    "mama": "cancer mama rastreamento diagnostico estadiamento",
}

AREA_ALIASES = {
    "Cirurgia": "Cirurgia",
    "Cirurgia Geral": "Cirurgia",
    "Clínica Médica": "Clínica Médica",
    "Ginecologia e Obstetrícia": "Ginecologia e Obstetrícia",
    "Medicina Preventiva": "Preventiva",
    "Medicina Preventiva e Social": "Preventiva",
    "Preventiva": "Preventiva",
    "Pediatria": "Pediatria",
}


def norm_text(text: str | None) -> str:
    if not text:
        return ""
    s = unicodedata.normalize("NFD", str(text))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^\w\s]", " ", s.lower())
    return " ".join(s.split())


def tokenize(text: str | None, expand_synonyms: bool = False) -> set[str]:
    words = norm_text(text).split()
    tokens: set[str] = set()
    for w in words:
        if expand_synonyms and w in MEDICAL_SYNONYMS:
            for sw in MEDICAL_SYNONYMS[w].split():
                if len(sw) >= 2 and sw not in STOPWORDS:
                    tokens.add(sw)
        if len(w) >= 2 and w not in STOPWORDS:
            tokens.add(w)
    return tokens


def strip_leading_num(text: str) -> tuple[int, str]:
    m = re.match(r"^\s*(\d+)\s*[\.\-\–\—]\s*(.+)$", text)
    if m:
        return int(m.group(1)), m.group(2).strip()
    m2 = re.match(r"^\s*(\d+)\s+(.+)$", text)
    if m2:
        return int(m2.group(1)), m2.group(2).strip()
    return 999, text.strip()


def fetch_drive_video_durations() -> dict[str, int]:
    """Lê durationMillis de todos os vídeos do Drive via API v3 usando o token OAuth do rclone."""
    try:
        subprocess.run(["rclone", "about", "Drive:"], capture_output=True, text=True, timeout=20, check=False)
        if not RCLONE_CONF_PATH.exists():
            return {}
        cfg = configparser.ConfigParser()
        cfg.read(RCLONE_CONF_PATH, encoding="utf-8")
        if "Drive" not in cfg or "token" not in cfg["Drive"]:
            return {}
        access_token = json.loads(cfg["Drive"]["token"]).get("access_token")
        if not access_token:
            return {}

        durations: dict[str, int] = {}
        page_token: str | None = None
        while True:
            params = {
                "q": "mimeType contains 'video/' and trashed = false",
                "fields": "nextPageToken,files(id,videoMediaMetadata/durationMillis)",
                "pageSize": "1000",
                "supportsAllDrives": "true",
                "includeItemsFromAllDrives": "true",
            }
            if page_token:
                params["pageToken"] = page_token
            url = "https://www.googleapis.com/drive/v3/files?" + urllib.parse.urlencode(params)
            req = urllib.request.Request(url, headers={"Authorization": f"Bearer {access_token}"})
            with urllib.request.urlopen(req, timeout=60) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
            for item in payload.get("files", []):
                fid = item.get("id")
                ms = (item.get("videoMediaMetadata") or {}).get("durationMillis")
                if fid and ms is not None:
                    try:
                        sec = int(round(int(ms) / 1000.0))
                        if sec > 0:
                            durations[fid] = sec
                    except (ValueError, TypeError):
                        pass
            page_token = payload.get("nextPageToken")
            if not page_token:
                break
        return durations
    except Exception as exc:
        print(f"[AVISO] Não foi possível buscar durações na Drive API v3 ({exc}); seguindo sem duração.")
        return {}


def load_canonical_catalog(overrides_path: Path):
    planner_path = BACKEND_DIR / "data" / "plannerData.json"
    katomart_path = BACKEND_DIR / "data" / "katomartCourseDurations.json"
    depara_path = BACKEND_DIR / "data" / "de_para_temas.json"

    with open(planner_path, "r", encoding="utf-8") as f:
        planner_data = json.load(f)

    canon_area: dict[str, str] = {}
    canon_order: dict[str, int] = {}
    canon_tokens: dict[str, set[str]] = {}
    exact_norm_map: dict[str, str] = {}

    idx = 0
    for area_obj in planner_data:
        area = AREA_ALIASES.get(area_obj.get("area", ""), get_normalized_area(area_obj.get("area", "")))
        for macro in area_obj.get("macroThemes", []):
            for sub in macro.get("dbSubtemas", []):
                idx += 1
                canon_area[sub] = area
                canon_order[sub] = idx
                canon_tokens[sub] = tokenize(sub, expand_synonyms=False)
                exact_norm_map[norm_text(sub)] = sub
                no_parens = re.sub(r"\([^)]*\)", "", sub).strip()
                if no_parens:
                    exact_norm_map.setdefault(norm_text(no_parens), sub)

    if katomart_path.exists():
        with open(katomart_path, "r", encoding="utf-8") as f:
            k_subs = json.load(f).get("subtemas", {})
        for sub, info in k_subs.items():
            if sub in canon_area and info.get("module"):
                exact_norm_map.setdefault(norm_text(info["module"]), sub)

    if depara_path.exists():
        with open(depara_path, "r", encoding="utf-8") as f:
            dp = json.load(f)
        for _area_key, entries in dp.get("areas", {}).items():
            for entry in entries:
                novo = entry.get("nome_novo")
                orig = entry.get("nome_original")
                if novo in canon_area and orig:
                    exact_norm_map.setdefault(norm_text(orig), novo)

    overrides: dict[str, str | None] = {}
    if overrides_path.exists():
        with open(overrides_path, "r", encoding="utf-8") as f:
            raw_ov = json.load(f)
        if isinstance(raw_ov, dict):
            for k, v in raw_ov.items():
                if not k.startswith("_"):
                    overrides[norm_text(k)] = v

    return {
        "canon_area": canon_area,
        "canon_order": canon_order,
        "canon_tokens": canon_tokens,
        "exact_norm_map": exact_norm_map,
        "overrides": overrides,
    }


def match_canonical_subtema(
    raw_name: str,
    catalog: dict,
    area_hint: str | None = None,
    min_score: float = 0.60,
    expand_synonyms: bool = True,
) -> tuple[str | None, str | None]:
    """Tenta mapear o nome do módulo/aula para um dos 170 subtemas canônicos."""
    n = norm_text(raw_name)
    if not n:
        return None, None

    overrides = catalog["overrides"]
    cleaned = re.sub(r"^como cai na [a-z]{2,6}\s+", "", n).strip()
    cleaned = re.sub(r"^(aula acessoria|atualizacao)\s+", "", cleaned).strip()
    cleaned = re.sub(r"\s+cofexpress$", "", cleaned).strip()

    for cand in (n, cleaned):
        if cand in overrides:
            sub = overrides[cand]
            if sub and sub in catalog["canon_area"]:
                return sub, catalog["canon_area"][sub]
            return None, None

    exact_map = catalog["exact_norm_map"]
    for cand in (n, cleaned):
        if cand in exact_map:
            sub = exact_map[cand]
            return sub, catalog["canon_area"][sub]

    q_tokens = tokenize(cleaned or raw_name, expand_synonyms=expand_synonyms)
    if not q_tokens:
        return None, None

    best_sub = None
    best_score = 0.0
    for sub, sub_tokens in catalog["canon_tokens"].items():
        if area_hint and area_hint != "Outros" and catalog["canon_area"][sub] != area_hint:
            continue
        if not sub_tokens:
            continue
        inter = len(q_tokens & sub_tokens)
        if inter == 0:
            continue
        precision = inter / len(q_tokens)
        recall = inter / len(sub_tokens)
        f1 = (2 * precision * recall) / (precision + recall)
        containment = max(precision, recall)
        score = 0.65 * f1 + 0.35 * containment
        if inter == 1 and min(len(q_tokens), len(sub_tokens)) > 1:
            score *= 0.78
        if score > best_score:
            best_score = score
            best_sub = sub

    if best_sub and best_score >= min_score:
        return best_sub, catalog["canon_area"][best_sub]
    return None, None


def list_drive_videos(remote_path: str) -> list[dict]:
    cmd = ["rclone", "lsjson", "--fast-list", "--files-only", "-R", remote_path]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=True)
    items = json.loads(proc.stdout)
    videos = []
    for item in items:
        name = item.get("Name", "")
        lower_name = name.lower()
        ext = os.path.splitext(lower_name)[1]
        if ext not in VIDEO_EXTS:
            continue
        if any(marker in lower_name for marker in IGNORED_NAME_MARKERS):
            continue
        if int(item.get("Size") or 0) <= 0:
            continue
        videos.append(item)
    return videos


def parse_medway_lessons(videos: list[dict], catalog: dict, durations: dict[str, int]) -> list[dict]:
    rows = []
    for item in videos:
        path = item["Path"]
        name = item["Name"]
        segs = path.split("/")
        area = get_normalized_area(segs[0] if segs else "")
        specialty = segs[1] if len(segs) >= 3 else ""
        module_name = segs[2] if len(segs) >= 4 else (segs[-2] if len(segs) >= 2 else segs[0])

        stem = os.path.splitext(name)[0]
        parent_folder = segs[-2] if len(segs) >= 2 else ""

        if len(segs) >= 5 and re.match(r"^\d+\.\s*Aula$", stem, re.IGNORECASE):
            order_num, folder_title = strip_leading_num(parent_folder)
            if "flash" in norm_text(parent_folder):
                title = f"{order_num:02d}. {module_name} (Flash)" if order_num != 999 else f"{module_name} (Flash)"
            elif folder_title.lower().startswith("vídeo aula") or folder_title.lower().startswith("video aula"):
                title = f"{order_num:02d}. {module_name}" if order_num != 999 else module_name
            else:
                title = parent_folder
        else:
            order_num, _ = strip_leading_num(stem)
            title = stem

        if order_num == 999:
            order_num, _ = strip_leading_num(parent_folder)

        mod_norm = norm_text(module_name)
        combined_norm = norm_text(f"{stem} {parent_folder}")
        if mod_norm.startswith("como cai"):
            lesson_kind = "como_cai"
            is_essential = 0
        elif "flash" in combined_norm:
            lesson_kind = "flash"
            is_essential = 0
        elif "revisao rapida" in combined_norm:
            lesson_kind = "revisao"
            is_essential = 0
        else:
            lesson_kind = "aula"
            is_essential = 1

        area_hint = None if mod_norm.startswith("como cai") else area
        subtema, canon_area = match_canonical_subtema(module_name, catalog, area_hint=area_hint, min_score=0.60)
        if canon_area:
            area = canon_area
        module_order = catalog["canon_order"].get(subtema, 900) if subtema else 900
        fid = item["ID"]

        rows.append({
            "course_key": COURSE_SOURCES["medway"]["course_key"],
            "course_name": COURSE_SOURCES["medway"]["course_name"],
            "is_extra": 0,
            "area": area,
            "specialty": specialty,
            "subtema": subtema,
            "module_name": module_name,
            "module_order": module_order,
            "title": title,
            "lesson_order": order_num,
            "lesson_kind": lesson_kind,
            "is_essential": is_essential,
            "media_type": "video",
            "provider": "gdrive",
            "drive_file_id": fid,
            "drive_path": f"Medway R1 - 2026/{path}",
            "size_bytes": int(item.get("Size") or 0),
            "duration_seconds": durations.get(fid),
        })
    return rows


def _is_medcof_noise(raw_topic: str) -> bool:
    n = norm_text(raw_topic)
    return any(pat in n for pat in MEDCOF_IGNORED_TOPIC_PATTERNS)


def parse_medcof_lessons(videos: list[dict], catalog: dict, durations: dict[str, int]) -> list[dict]:
    prelim = []
    skipped_noise = 0
    for item in videos:
        path = item["Path"]
        segs = path.split("/")
        block_seg = segs[0] if segs else "Bloco"
        topic_seg = segs[1] if len(segs) >= 2 else os.path.splitext(item["Name"])[0]

        block_num, block_clean = strip_leading_num(block_seg)
        if block_num == 999:
            m = re.search(r"(\d+)", block_seg)
            block_num = int(m.group(1)) if m else 999
        module_name = f"Bloco {block_num:02d}" if block_num != 999 else block_clean

        lesson_order, raw_topic = strip_leading_num(topic_seg)
        if lesson_order == 999:
            lesson_order, _ = strip_leading_num(os.path.splitext(item["Name"])[0])

        if _is_medcof_noise(raw_topic):
            skipped_noise += 1
            continue

        fid = item["ID"]
        dur = durations.get(fid)
        size_bytes = int(item.get("Size") or 0)
        topic_norm = norm_text(re.sub(r"\(regravacao\)", "", norm_text(raw_topic)))

        prelim.append({
            "item": item,
            "fid": fid,
            "dur": dur,
            "size_bytes": size_bytes,
            "path": path,
            "block_num": block_num,
            "module_name": module_name,
            "lesson_order": lesson_order,
            "raw_topic": raw_topic,
            "topic_key": (module_name, topic_norm),
        })

    if skipped_noise:
        print(f"  [medcof] Ignorados {skipped_noise} vídeos de onboarding/plataforma.")

    by_topic_key: dict[tuple[str, str], list[dict]] = {}
    for p in prelim:
        by_topic_key.setdefault(p["topic_key"], []).append(p)

    rows = []
    for _key, group in sorted(by_topic_key.items(), key=lambda kv: (kv[1][0]["block_num"], kv[1][0]["lesson_order"])):
        group.sort(key=lambda x: (x["lesson_order"], x["raw_topic"]))
        annotated: list[tuple[dict, str, str]] = []

        if len(group) == 2:
            a, b = group[0], group[1]
            use_dur = a["dur"] is not None and b["dur"] is not None and a["dur"] > 0 and b["dur"] > 0
            metric_a = a["dur"] if use_dur else a["size_bytes"]
            metric_b = b["dur"] if use_dur else b["size_bytes"]
            smaller, larger = (a, b) if metric_a <= metric_b else (b, a)
            s_val = min(metric_a, metric_b)
            l_val = max(metric_a, metric_b)
            is_distinct_express = (l_val > 0 and s_val <= 0.55 * l_val) or (
                use_dur and s_val <= 1800 and l_val > 2100
            )
            if is_distinct_express:
                for item in group:
                    if item is smaller:
                        annotated.append((item, "cofexpress", f"{item['raw_topic']} (CofExpress)"))
                    else:
                        annotated.append((item, "aula_extra", f"{item['raw_topic']} (Aula Completa)"))
            else:
                for idx, item in enumerate(group, start=1):
                    annotated.append((item, "aula_extra", f"{item['raw_topic']} — Parte {idx}"))
        elif len(group) > 2:
            for idx, item in enumerate(group, start=1):
                annotated.append((item, "aula_extra", f"{item['raw_topic']} — Parte {idx}"))
        else:
            item = group[0]
            dur = item["dur"]
            kind = "cofexpress" if (dur is not None and dur <= 1500) else "aula_extra"
            annotated.append((item, kind, item["raw_topic"]))

        for p, lesson_kind, title in annotated:
            subtema, canon_area = match_canonical_subtema(
                p["raw_topic"], catalog, area_hint=None, min_score=0.56, expand_synonyms=True
            )
            area = canon_area or "Extras"
            rows.append({
                "course_key": COURSE_SOURCES["medcof"]["course_key"],
                "course_name": COURSE_SOURCES["medcof"]["course_name"],
                "is_extra": 1,
                "area": area,
                "specialty": p["module_name"],
                "subtema": subtema,
                "module_name": p["module_name"],
                "module_order": p["block_num"],
                "title": title,
                "lesson_order": p["lesson_order"],
                "lesson_kind": lesson_kind,
                "is_essential": 0,
                "media_type": "video",
                "provider": "gdrive",
                "drive_file_id": p["fid"],
                "drive_path": f"Medcof R1 2026/{p['path']}",
                "size_bytes": p["size_bytes"],
                "duration_seconds": p["dur"],
            })
    return rows


RADIOLOGIA_CANONICAL_LESSONS: dict[int, tuple[int, str, str, str | None]] = {
    1: (1, "01. Fundamentos da Radiologia", "01. Introdução ao Domínio de Imagens Radiológicas", None),
    2: (1, "01. Fundamentos da Radiologia", "02. Noções Básicas de Radiologia e Métodos de Imagem", None),
    3: (2, "02. Radiologia Torácica", "03. Radiografia de Tórax: Interpretação Sistemática e Anatomia Normal", None),
    4: (2, "02. Radiologia Torácica", "04. Principais Padrões da Radiografia de Tórax", None),
    5: (2, "02. Radiologia Torácica", "05. TC de Tórax: Anatomia Normal e Sistemática de Avaliação", None),
    6: (2, "02. Radiologia Torácica", "06. Padrões de Lesões na TC de Tórax", None),
    7: (2, "02. Radiologia Torácica", "07. Emergências Clínicas no Tórax (Síndromes Aórticas, TEP, Pneumonia e Edema)", None),
    8: (2, "02. Radiologia Torácica", "08. Trauma Torácico: Além do Pneumotórax", "Trauma Torácico e Manejo de Drenos"),
    9: (2, "02. Radiologia Torácica", "09. Radiologia Torácica Pediátrica: Da Membrana Hialina ao Corpo Estranho", None),
    10: (3, "03. Neurorradiologia", "10. TC de Crânio: Comece Aprendendo o que é Normal e Anatomia", None),
    11: (3, "03. Neurorradiologia", "11. RM de Crânio: Comece Aprendendo o que é Normal e Sequências", None),
    12: (3, "03. Neurorradiologia", "12. Déficit Focal Agudo e AVC (Isquêmico e Hemorrágico)", "AVC e Doenças Cerebrovasculares"),
    13: (3, "03. Neurorradiologia", "13. Infecções do SNC: Padrões de Imagem (Neurotoxoplasmose, Abscesso e Meningite)", "Meningites e Encefalites"),
    14: (3, "03. Neurorradiologia", "14. Traumatismo Cranioencefálico (TCE) e Hematomas Intracranianos", "Traumatismo Cranioencefálico (TCE)"),
    15: (4, "04. Radiologia Abdominal", "15. TC de Abdome Normal: Anatomia Seccional (Isso é Alça ou Pâncreas?)", None),
    16: (4, "04. Radiologia Abdominal", "16. Abdome Agudo Inflamatório: Pancreatite, Apendicite e Diverticulite", "Abdome Agudo Inflamatório (Apendicite e Diverticulite Aguda)"),
    17: (4, "04. Radiologia Abdominal", "17. Vias Biliares: Colecistite Aguda, Colelitíase e Coledocolitíase", "Doenças Benignas das Vias Biliares (Colelitíase, Colecistite, Coledocolitíase e Colangite)"),
    18: (4, "04. Radiologia Abdominal", "18. Abdome Agudo Obstrutivo: Trânsito Obstruído, Bridas e Volvo", "Abdome Agudo Obstrutivo (Bridas, Neoplasias e Volvo)"),
    19: (4, "04. Radiologia Abdominal", "19. Abdome Agudo Vascular e Dissecção/Aneurisma de Aorta", "Abdome Agudo Vascular (Isquemia Mesentérica)"),
    20: (4, "04. Radiologia Abdominal", "20. Trauma Abdominal: FAST e Tomografia nas Lesões Viscerais", "Trauma Abdominal e Pélvico"),
    21: (4, "04. Radiologia Abdominal", "21. Lesões Renais e Urolitíase na Tomografia", "Litíase Urinária e Cólica Nefrética"),
    22: (4, "04. Radiologia Abdominal", "22. Lesões Focais Hepáticas e Fases do Contraste", None),
    23: (4, "04. Radiologia Abdominal", "23. Radiologia Abdominal Pediátrica (Abdome Agudo e Malformações na Criança)", "Cirurgia Pediátrica e Malformações Digestivas Neonatais"),
    24: (5, "05. Radiologia em GO e Mama", "24. Lesões Ovarianas: Essa Lesão é Benigna ou Maligna? (O-RADS / IOTA)", "Tumores Anexiais e Câncer de Ovário"),
    25: (5, "05. Radiologia em GO e Mama", "25. Lesões Uterinas: Miomatose, Adenomiose e Pólipos (Não se esqueça do útero)", "Sangramento Uterino Anormal (SUA), Miomatose e Adenomiose"),
    26: (5, "05. Radiologia em GO e Mama", "26. Mama e BI-RADS: A Classificação Obrigatória para a Prova", "Rastreamento e Diagnóstico do Câncer de Mama"),
    27: (5, "05. Radiologia em GO e Mama", "27. Avaliação Obstétrica e Vitalidade Fetal (USG e Doppler no Sofrimento Fetal)", "Avaliação da Vitalidade Fetal (Cardiotocografia, PBF e Doppler)"),
    28: (5, "05. Radiologia em GO e Mama", "28. Sangramentos Gestacionais de 1ª e 2ª Metade na Ultrassonografia", "Sangramentos da Primeira Metade da Gestação"),
    29: (6, "06. POCUS (Ultrassom Point-of-Care)", "29. POCUS: Ultrassonografia Point-of-Care na Emergência e Terapia Intensiva", None),
}


def parse_radiologia_lessons(videos: list[dict], catalog: dict, durations: dict[str, int]) -> list[dict]:
    rows = []
    for item in videos:
        path = item["Path"]
        segs = path.split("/")
        folder = segs[0] if segs else os.path.splitext(item["Name"])[0]
        order_num, rest = strip_leading_num(folder)
        clean_title = re.sub(r"^\d+\.\s*Imagens Radiológicas\s*-\s*", "", rest, flags=re.IGNORECASE).strip()
        clean_title = re.sub(r"^\d+\.\s*", "", clean_title).strip() or rest
        clean_title = clean_title.replace("_", ":")

        canonical = RADIOLOGIA_CANONICAL_LESSONS.get(order_num)
        if canonical:
            mod_order, mod_name, full_title, mapped_sub = canonical
            subtema = mapped_sub if (mapped_sub and mapped_sub in catalog["canon_area"]) else None
        else:
            mod_order = 1
            mod_name = "Imagens Radiológicas"
            full_title = f"{order_num:02d}. {clean_title}" if order_num != 999 else clean_title
            subtema, _ = match_canonical_subtema(clean_title, catalog, area_hint=None, min_score=0.72)

        fid = item["ID"]

        rows.append({
            "course_key": COURSE_SOURCES["radiologia"]["course_key"],
            "course_name": COURSE_SOURCES["radiologia"]["course_name"],
            "is_extra": 1,
            "area": "Radiologia",
            "specialty": mod_name,
            "subtema": subtema,
            "module_name": mod_name,
            "module_order": mod_order,
            "title": full_title,
            "lesson_order": order_num,
            "lesson_kind": "radiologia",
            "is_essential": 0,
            "media_type": "video",
            "provider": "gdrive",
            "drive_file_id": fid,
            "drive_path": f"Imagens Radiológicas 2026/{path}",
            "size_bytes": int(item.get("Size") or 0),
            "duration_seconds": durations.get(fid),
        })
    return rows


def parse_pratica_lessons(videos: list[dict], catalog: dict, durations: dict[str, int]) -> list[dict]:
    manifest_titles: dict[int, str] = {}
    try:
        raw_manifest = subprocess.check_output(
            ["rclone", "cat", f"{COURSE_SOURCES['pratica']['remote_path']}/manifest.json"],
            text=True,
            timeout=20,
        )
        manifest = json.loads(raw_manifest)
        for mod in manifest.get("course", {}).get("modules", []):
            oidx = mod.get("order_index")
            mtitle = mod.get("title")
            if isinstance(oidx, int) and mtitle:
                manifest_titles[oidx] = str(mtitle).strip()
    except Exception as exc:
        print(f"[AVISO] Não foi possível ler manifest.json de Medway Prática ({exc}).")

    # Ordenar colocando caminhos sem '/videos/' antes de '/videos/' para deduplicar preferindo o caminho canônico
    sorted_videos = sorted(videos, key=lambda it: ("/videos/" in it["Path"], it["Path"]))
    seen_keys: set[tuple[str, str, int]] = set()
    rows = []
    for item in sorted_videos:
        path = item["Path"]
        segs = path.split("/")
        # Esperado: modules/<idx>_<slug>/lessons/<lesson_dir>/1. Aula.mp4
        mod_folder = segs[1] if len(segs) >= 2 and segs[0] == "modules" else segs[0]
        m_idx = re.match(r"^(\d+)_(.+)$", mod_folder)
        order_idx = int(m_idx.group(1)) if m_idx else None

        full_title = manifest_titles.get(order_idx) if order_idx is not None else None
        if not full_title:
            full_title = (m_idx.group(2) if m_idx else mod_folder).replace("-", " ").strip()

        if " - " in full_title:
            mod_part, lesson_part = full_title.split(" - ", 1)
            mod_order, _ = strip_leading_num(mod_part)
            lesson_order, _ = strip_leading_num(lesson_part)
            module_name = mod_part.strip()
            title = lesson_part.strip()
        else:
            mod_order = order_idx if order_idx is not None else 999
            lesson_order = 1
            module_name = full_title
            title = full_title

        if "chegando no crmedway" in norm_text(module_name):
            continue

        size_bytes = int(item.get("Size") or 0)
        dedup_key = (norm_text(module_name), norm_text(title), size_bytes)
        if dedup_key in seen_keys:
            continue
        seen_keys.add(dedup_key)

        subtema, _ = match_canonical_subtema(title, catalog, area_hint=None, min_score=0.72)
        fid = item["ID"]

        rows.append({
            "course_key": COURSE_SOURCES["pratica"]["course_key"],
            "course_name": COURSE_SOURCES["pratica"]["course_name"],
            "is_extra": 1,
            "area": "Prática / OSCE",
            "specialty": module_name,
            "subtema": subtema,
            "module_name": module_name,
            "module_order": mod_order,
            "title": title,
            "lesson_order": lesson_order if lesson_order != 999 else (order_idx or 999),
            "lesson_kind": "pratica",
            "is_essential": 0,
            "media_type": "video",
            "provider": "gdrive",
            "drive_file_id": fid,
            "drive_path": f"Medway Prática 2026/{path}",
            "size_bytes": size_bytes,
            "duration_seconds": durations.get(fid),
        })
    return rows


def upsert_lessons(
    db_path: Path,
    rows_by_course: dict[str, list[dict]],
    dry_run: bool = False,
    allow_mass_deactivate: bool = False,
) -> None:
    now = datetime.now(timezone.utc).isoformat()
    if dry_run:
        return

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        with conn:
            apply_pending_migrations(conn)

            for course_key, rows in rows_by_course.items():
                if not rows:
                    continue
                seen_ids = set()
                for row in rows:
                    seen_ids.add(row["drive_file_id"])
                    conn.execute(
                        """
                        INSERT INTO lessons (
                            course_key, course_name, is_extra, area, specialty, subtema,
                            module_name, module_order, title, lesson_order, lesson_kind,
                            is_essential, media_type, provider, drive_file_id, drive_path,
                            size_bytes, duration_seconds, mapping_source, active, updated_at
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'auto', 1, ?)
                        ON CONFLICT(drive_file_id) DO UPDATE SET
                            course_key = excluded.course_key,
                            course_name = excluded.course_name,
                            is_extra = excluded.is_extra,
                            area = CASE WHEN lessons.mapping_source = 'manual' THEN lessons.area ELSE excluded.area END,
                            specialty = excluded.specialty,
                            subtema = CASE WHEN lessons.mapping_source = 'manual' THEN lessons.subtema ELSE excluded.subtema END,
                            module_name = excluded.module_name,
                            module_order = excluded.module_order,
                            title = excluded.title,
                            lesson_order = excluded.lesson_order,
                            lesson_kind = excluded.lesson_kind,
                            is_essential = CASE WHEN lessons.mapping_source = 'manual' THEN lessons.is_essential ELSE excluded.is_essential END,
                            media_type = excluded.media_type,
                            provider = excluded.provider,
                            drive_path = excluded.drive_path,
                            size_bytes = excluded.size_bytes,
                            duration_seconds = COALESCE(excluded.duration_seconds, lessons.duration_seconds),
                            active = 1,
                            updated_at = excluded.updated_at
                        """,
                        (
                            row["course_key"],
                            row["course_name"],
                            row["is_extra"],
                            row["area"],
                            row["specialty"],
                            row["subtema"],
                            row["module_name"],
                            row["module_order"],
                            row["title"],
                            row["lesson_order"],
                            row["lesson_kind"],
                            row["is_essential"],
                            row["media_type"],
                            row["provider"],
                            row["drive_file_id"],
                            row["drive_path"],
                            row["size_bytes"],
                            row.get("duration_seconds"),
                            now,
                        ),
                    )

                existing_ids = {
                    r["drive_file_id"]
                    for r in conn.execute(
                        "SELECT drive_file_id FROM lessons WHERE course_key = ? AND active = 1",
                        (course_key,),
                    ).fetchall()
                }
                removed_ids = list(existing_ids - seen_ids)
                if (
                    removed_ids
                    and not allow_mass_deactivate
                    and len(existing_ids) >= 10
                    and (len(seen_ids) < 0.5 * len(existing_ids) or len(removed_ids) > 0.3 * len(existing_ids))
                ):
                    raise RuntimeError(
                        f"Guardrail: '{course_key}' desativaria {len(removed_ids)}/{len(existing_ids)} aulas ativas "
                        f"(visto={len(seen_ids)}). Use --allow-mass-deactivate se for intencional."
                    )
                for rid in removed_ids:
                    conn.execute(
                        "UPDATE lessons SET active = 0, updated_at = ? WHERE drive_file_id = ?",
                        (now, rid),
                    )
    finally:
        conn.close()


def print_report(rows_by_course: dict[str, list[dict]], total_canon: int) -> None:
    covered_subtemas = set()
    for course_key, rows in rows_by_course.items():
        mapped = sum(1 for r in rows if r["subtema"])
        with_dur = sum(1 for r in rows if r.get("duration_seconds"))
        essential = sum(1 for r in rows if r["is_essential"])
        subs = {r["subtema"] for r in rows if r["subtema"]}
        covered_subtemas.update(subs)
        print(
            f"[{course_key}] vídeos={len(rows)} | c/duração={with_dur}/{len(rows)} | "
            f"essenciais={essential} | mapeados_subtema={mapped}/{len(rows)} ({len(subs)}/{total_canon} subtemas)"
        )
        if course_key == COURSE_SOURCES["medcof"]["course_key"]:
            kinds = {}
            for r in rows:
                kinds[r["lesson_kind"]] = kinds.get(r["lesson_kind"], 0) + 1
            print(f"  [medcof] tipos={kinds}")
    print(f"[TOTAL] Subtemas canônicos com pelo menos 1 aula: {len(covered_subtemas)}/{total_canon}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync de aulas do Google Drive para o MedQuest")
    parser.add_argument("--dry-run", action="store_true", help="Apenas inspeciona e imprime o relatório sem gravar no SQLite")
    parser.add_argument(
        "--course",
        choices=("all", "medway", "medcof", "radiologia", "pratica"),
        default="all",
    )
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument("--overrides", type=Path, default=DEFAULT_OVERRIDES_PATH)
    parser.add_argument(
        "--allow-mass-deactivate",
        action="store_true",
        help="Permite desativar >30%% das aulas ativas de um curso caso seja remoção intencional",
    )
    args = parser.parse_args()

    catalog = load_canonical_catalog(args.overrides)
    durations = fetch_drive_video_durations()
    print(f"[Drive API v3] Durações carregadas: {len(durations)} vídeos")

    rows_by_course: dict[str, list[dict]] = {}
    targets = list(COURSE_SOURCES.keys()) if args.course == "all" else [args.course]

    for key in targets:
        videos = list_drive_videos(COURSE_SOURCES[key]["remote_path"])
        if key == "medway":
            rows_by_course[COURSE_SOURCES[key]["course_key"]] = parse_medway_lessons(videos, catalog, durations)
        elif key == "medcof":
            rows_by_course[COURSE_SOURCES[key]["course_key"]] = parse_medcof_lessons(videos, catalog, durations)
        elif key == "radiologia":
            rows_by_course[COURSE_SOURCES[key]["course_key"]] = parse_radiologia_lessons(videos, catalog, durations)
        elif key == "pratica":
            rows_by_course[COURSE_SOURCES[key]["course_key"]] = parse_pratica_lessons(videos, catalog, durations)

    print_report(rows_by_course, len(catalog["canon_area"]))
    upsert_lessons(
        args.db,
        rows_by_course,
        dry_run=args.dry_run,
        allow_mass_deactivate=args.allow_mass_deactivate,
    )
    if args.dry_run:
        print("[DRY-RUN] Nenhuma alteração gravada no banco.")
    else:
        print(f"[OK] Banco atualizado: {args.db}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
