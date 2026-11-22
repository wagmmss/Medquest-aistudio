from datetime import datetime

# Áreas reconhecidas pelo banco de dados do MedQuest
AREAS_MEDQUEST = [
    "Geral",
    "Preventiva",
    "Ginecologia e Obstetrícia",
    "Cirurgia",
    "Medicina Intensiva",
    "Clínica Médica",
    "Pediatria",
    "Especialidades",
]

# Configuração padrão — Plano Mestre 6º Ano FMRP-USP (2026/2027)
RODIZIOS_TURMA_J = [
    # Pré-Temporada / Férias (base equilibrada entre as 5 áreas)
    {"start": "2026-11-30", "end": "2027-01-24", "area": "Geral", "label": "Férias (Pré-Temporada)"},
    # 6º Ano (2027) — Rodízios
    {"start": "2027-01-25", "end": "2027-02-21", "area": "Cirurgia", "label": "Cirurgia Geral"},
    {"start": "2027-02-22", "end": "2027-03-21", "area": "Medicina Intensiva", "label": "Anestesio / CTI"},
    {"start": "2027-03-22", "end": "2027-05-02", "area": "Ginecologia e Obstetrícia", "label": "GO (6 sem)"},
    {"start": "2027-05-03", "end": "2027-05-16", "area": "Especialidades", "label": "Oftalmo / ORL / CCP"},
    {"start": "2027-05-17", "end": "2027-06-13", "area": "Preventiva", "label": "MFC / Preventiva"},
    {"start": "2027-06-14", "end": "2027-07-11", "area": "Clínica Médica", "label": "Clínica Médica"},
    {"start": "2027-07-12", "end": "2027-08-08", "area": "Pediatria", "label": "Pediatria"},
    {"start": "2027-08-09", "end": "2027-10-03", "area": "Cirurgia", "label": "Emergência & Trauma"},
]

def get_area_prioritaria_atual():
    hoje = datetime.now()
    for bloco in RODIZIOS_TURMA_J:
        inicio = datetime.strptime(bloco["start"], "%Y-%m-%d")
        fim = datetime.strptime(bloco["end"], "%Y-%m-%d")
        # Considera que o dia final vai até 23:59:59
        fim = fim.replace(hour=23, minute=59, second=59)
        
        if inicio <= hoje <= fim:
            return bloco["area"]
    return None
