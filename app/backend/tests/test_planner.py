from datetime import date, timedelta

from api.services.planner import generate_annual_plan, build_plan_from_schedule


def test_intensive_plan_uses_high_yield_catalog():
    rows = [
        {"area": "Clínica Médica", "subtema": "Hipertensão Arterial Sistêmica e Crises Hipertensivas", "q_count": 12},
        {"area": "Clínica Médica", "subtema": "Tema sem prioridade cadastrada", "q_count": 12},
    ]
    start = date(2028, 1, 1)
    result = generate_annual_plan(
        rows,
        start.isoformat(),
        (start + timedelta(weeks=8)).isoformat(),
        hours_per_week=10,
        intensive=True,
    )

    topics = [topic for week in result["plan"] for topic in week["topics"]]
    topic_names = {topic["subtema"] for topic in topics}
    assert "Hipertensão Arterial Sistêmica e Crises Hipertensivas" in topic_names
    assert "Tema sem prioridade cadastrada" not in topic_names


def test_plan_uses_curriculum_theory_duration_and_two_hour_practice_block():
    rows = [
        {"area": "Clínica Médica", "subtema": "Hipertensão Arterial Sistêmica e Crises Hipertensivas", "q_count": 12},
    ]
    start = date.today()

    result = generate_annual_plan(
        rows,
        start.isoformat(),
        (start + timedelta(weeks=26)).isoformat(),
        hours_per_week=24,
    )

    topics = [topic for week in result["plan"] for topic in week["topics"]]
    topic = next(topic for topic in topics if topic["subtema"] == "Hipertensão Arterial Sistêmica e Crises Hipertensivas")
    assert topic["estimated_theory_hours"] == 1.95
    assert topic["estimated_practice_hours"] == 2.0
    assert topic["estimated_hours"] == 3.95
    assert topic["theory_source"] == "curriculum"
    assert topic["course_module"] == "Hipertensão Arterial Sistêmica e Crises Hipertensivas"


def test_plan_ignores_topics_outside_the_canonical_catalog():
    rows = [
        {"area": "Clínica Médica", "subtema": "Tema sem prioridade cadastrada", "q_count": 12},
    ]
    start = date.today()

    result = generate_annual_plan(
        rows,
        start.isoformat(),
        (start + timedelta(weeks=8)).isoformat(),
        hours_per_week=10,
    )

    topics = [topic for week in result["plan"] for topic in week["topics"]]
    assert topics
    assert result["total_required_hours"] == 563


def test_go_focos_usp_are_high_yield():
    rows = []
    start = date.today()
    result = generate_annual_plan(
        rows,
        start.isoformat(),
        (start + timedelta(weeks=20)).isoformat(),
        hours_per_week=20,
        intensive=True,
    )
    topics = [topic for week in result["plan"] for topic in week["topics"]]
    go_topics = [t for t in topics if t["area"] == "Ginecologia e Obstetrícia"]
    go_names = {t["subtema"] for t in go_topics}

    # Verify key GO Foco USP topics are present in intensive plan
    assert "Síndromes Hipertensivas na Gravidez (Pré-eclâmpsia e Eclâmpsia)" in go_names
    assert "Investigação das Amenorreias e Síndrome dos Ovários Policísticos (SOP)" in go_names
    assert "Assistência Pré-Natal de Baixo e Alto Risco" in go_names
    assert "Rastreamento Citopatológico e Conduta em Lesões Cervicais (HPV)" in go_names
    assert "Diabetes Gestacional e Pré-Gestacional" in go_names
    assert "Métodos Contraceptivos: Hormonais, DIU e Cirúrgicos" in go_names
    assert "Climatério, Menopausa e Terapia de Reposição Hormonal (TRH)" in go_names
    assert "Uroginecologia: Incontinência Urinária e Prolapso Genital" in go_names
    assert len(go_names) == 14


def test_proportional_distribution_avoids_end_concentration():
    rows = []
    start = date(2028, 1, 1)
    result = generate_annual_plan(
        rows,
        start.isoformat(),
        (start + timedelta(weeks=26)).isoformat(),
        hours_per_week=24,
        intensive=False,
    )
    plan = result["plan"]
    assert len(plan) >= 20

    # Ensure GO is well distributed across the schedule, not only at the end
    first_half_weeks = plan[:len(plan)//2]
    second_half_weeks = plan[len(plan)//2:]

    go_first_half = sum(1 for w in first_half_weeks for t in w["topics"] if t["area"] == "Ginecologia e Obstetrícia")
    go_second_half = sum(1 for w in second_half_weeks for t in w["topics"] if t["area"] == "Ginecologia e Obstetrícia")

    assert go_first_half >= 10
    assert go_second_half >= 10

    # In the final 3 weeks, no single area should occupy > 60% of total topics
    for w in plan[-3:]:
        total_w = len(w["topics"])
        for area in ["Clínica Médica", "Cirurgia", "Ginecologia e Obstetrícia", "Pediatria", "Preventiva"]:
            area_count = sum(1 for t in w["topics"] if t["area"] == area)
            assert area_count <= max(3, int(total_w * 0.65))


def test_planner_topic_progress_and_reset(client):
    # Test marking a topic as completed
    r = client.post("/api/planner/1/topic", json={"subtema": "Taquiarritmias", "completed": True})
    assert r.status_code == 200
    assert r.get_json()["completed"] is True

    # Test getting topic progress
    r = client.get("/api/planner/topics")
    assert r.status_code == 200
    assert r.get_json().get("1:Taquiarritmias") is True

    # Test stats reset clears topic progress
    r = client.delete("/api/stats/reset")
    assert r.status_code == 200

    r = client.get("/api/planner/topics")
    assert r.status_code == 200
    assert r.get_json().get("1:Taquiarritmias") is None


def test_planner_without_history_preserves_prior_behavior():
    start = date.today()
    result = generate_annual_plan(
        [],
        start.isoformat(),
        (start + timedelta(weeks=12)).isoformat(),
        hours_per_week=20,
        adaptive_signals={},
    )
    topics = [t for week in result["plan"] for t in week["topics"]]
    assert len(topics) > 0
    for t in topics:
        assert t["priority_reasons"] == []
        if t["priority"] >= 100:
            assert t["priority"] in (101.5, 102.0, 103.0)


def test_planner_adaptive_priority_boosts_theme_with_difficulty():
    start = date.today()
    theme_normal = "Hipertensão Arterial Sistêmica e Crises Hipertensivas"
    theme_struggling = "Síndromes Coronarianas Agudas (Com e Sem Supra de ST)"

    adaptive_signals = {
        theme_struggling: {
            "topic": theme_struggling,
            "attempts": 8,
            "correct": 1,
            "accuracy": 0.125,
            "priority_score": 0.75,
            "reasons": ["low_accuracy"],
            "due_count": 0,
            "retrievability": None,
        }
    }

    result = generate_annual_plan(
        [],
        start.isoformat(),
        (start + timedelta(weeks=12)).isoformat(),
        hours_per_week=20,
        adaptive_signals=adaptive_signals,
    )
    topics = [t for week in result["plan"] for t in week["topics"]]
    t_normal = next(t for t in topics if t["subtema"] == theme_normal)
    t_struggling = next(t for t in topics if t["subtema"] == theme_struggling)

    assert "low_accuracy" in t_struggling["priority_reasons"]
    assert t_normal["priority_reasons"] == []
    assert t_struggling["priority"] > t_normal["priority"]

    struggling_idx = topics.index(t_struggling)
    normal_idx = topics.index(t_normal)
    assert struggling_idx < normal_idx


def test_planner_user_isolation(client, app):
    from api.db import get_db
    with app.app_context():
        db = get_db()
        db.execute(
            """INSERT INTO questions(id, area, subtema, stem, correct_letter, missing_alts, year, institution_code, institution_label)
               VALUES (101, 'Clínica Médica', 'Hipertensão Arterial Sistêmica e Crises Hipertensivas', 'Stem HAS', 'B', 0, 2025, 'USP', 'USP'),
                      (102, 'Clínica Médica', 'Síndromes Coronarianas Agudas (Com e Sem Supra de ST)', 'Stem SCA', 'A', 0, 2025, 'USP', 'USP')"""
        )
        for _ in range(5):
            db.execute(
                """INSERT INTO attempts(question_id, selected_letter, is_correct, answered_at, user_id)
                   VALUES (101, 'A', 0, '2026-09-20T10:00:00Z', ?)""",
                ("user_alpha",)
            )
        db.commit()

    start = date.today()
    exam = (start + timedelta(weeks=12)).isoformat()
    payload = {"start_date": start.isoformat(), "exam_date": exam, "hours_per_week": 20}

    resp_alpha = client.post("/api/generate_plan", json=payload, headers={"X-User-ID": "user_alpha"})
    assert resp_alpha.status_code == 200
    topics_alpha = [t for w in resp_alpha.get_json()["plan"] for t in w["topics"]]
    has_alpha = next(t for t in topics_alpha if t["subtema"] == "Hipertensão Arterial Sistêmica e Crises Hipertensivas")
    assert "low_accuracy" in has_alpha["priority_reasons"]
    assert has_alpha["priority"] > 103.0

    resp_beta = client.post("/api/generate_plan", json=payload, headers={"X-User-ID": "user_beta"})
    assert resp_beta.status_code == 200
    topics_beta = [t for w in resp_beta.get_json()["plan"] for t in w["topics"]]
    has_beta = next(t for t in topics_beta if t["subtema"] == "Hipertensão Arterial Sistêmica e Crises Hipertensivas")
    assert has_beta["priority_reasons"] == []
    assert has_beta["priority"] == 103.0


def test_planner_supports_topic_outside_top_15(client, app):
    import json
    from api.adaptive import build_learning_profile
    from api.db import get_db
    from api.services.planner import _resolve_data_path

    with open(_resolve_data_path("plannerData.json"), "r", encoding="utf-8") as f:
        meta = json.load(f)
    canonical_subtemas = []
    for area in meta:
        for macro in area.get("macroThemes", []):
            for s in macro.get("dbSubtemas", []):
                if s not in canonical_subtemas:
                    canonical_subtemas.append(s)
                if len(canonical_subtemas) >= 20:
                    break
            if len(canonical_subtemas) >= 20:
                break
        if len(canonical_subtemas) >= 20:
            break

    assert len(canonical_subtemas) == 20

    user_id = "user_top15_test"
    with app.app_context():
        db = get_db()
        for idx, subtema in enumerate(canonical_subtemas):
            qid = 200 + idx
            db.execute(
                """INSERT INTO questions(id, area, subtema, stem, correct_letter, missing_alts, year, institution_code, institution_label)
                   VALUES (?, 'Clínica Médica', ?, 'Stem', 'B', 0, 2025, 'USP', 'USP')""",
                (qid, subtema)
            )
            attempts_count = 25 - idx
            for _ in range(attempts_count):
                db.execute(
                    """INSERT INTO attempts(question_id, selected_letter, is_correct, answered_at, user_id)
                       VALUES (?, 'A', 0, '2026-09-20T10:00:00Z', ?)""",
                    (qid, user_id)
                )
        db.commit()

        profile = build_learning_profile(db, user_id)
        top15_topics = {t["topic"] for t in profile["topics"]}
        assert len(top15_topics) == 15

        outside_topic = canonical_subtemas[19]
        assert outside_topic not in top15_topics

    start = date.today()
    exam = (start + timedelta(weeks=12)).isoformat()
    payload = {"start_date": start.isoformat(), "exam_date": exam, "hours_per_week": 20}

    resp = client.post("/api/generate_plan", json=payload, headers={"X-User-ID": user_id})
    assert resp.status_code == 200
    plan_topics = [t for w in resp.get_json()["plan"] for t in w["topics"]]
    outside_item = next(t for t in plan_topics if t["subtema"] == outside_topic)

    assert "low_accuracy" in outside_item["priority_reasons"]
    assert outside_item["priority"] > 100.0





def test_empty_adaptive_history_matches_legacy_plan_exactly():
    start = date.today()
    kwargs = dict(rows=[], start_date_str=start.isoformat(),
                  exam_date_str=(start + timedelta(weeks=52)).isoformat(), hours_per_week=40)
    assert generate_annual_plan(**kwargs, adaptive_signals={}) == generate_annual_plan(**kwargs)


def test_adaptive_signals_preserve_catalog_and_intensive_filter():
    start = date.today()
    kwargs = dict(rows=[], start_date_str=start.isoformat(),
                  exam_date_str=(start + timedelta(weeks=52)).isoformat(), hours_per_week=40)
    def topics(plan):
        return {topic['subtema']: topic for week in plan['plan'] for topic in week['topics']}
    baseline = topics(generate_annual_plan(**kwargs))
    signals = {name: {'priority_score': 0.8, 'reasons': ['memory_at_risk']} for name in baseline}
    adaptive = topics(generate_annual_plan(**kwargs, adaptive_signals=signals))
    assert len(baseline) == len(adaptive) == 170
    for name, previous in baseline.items():
        for key in ('estimated_theory_hours', 'estimated_practice_hours', 'estimated_hours'):
            assert adaptive[name][key] == previous[key]
    intensive_before = topics(generate_annual_plan(**kwargs, intensive=True))
    intensive_after = topics(generate_annual_plan(**kwargs, intensive=True, adaptive_signals=signals))
    assert intensive_before.keys() == intensive_after.keys()


def test_planner_schedule_persisted_and_frozen_across_calls(client, app):
    from api.db import get_db

    user_id = "user_freeze_test"
    start = date.today()
    exam = (start + timedelta(weeks=20)).isoformat()
    payload = {"start_date": start.isoformat(), "exam_date": exam, "hours_per_week": 20}

    # First call generates and persists
    resp1 = client.post("/api/generate_plan", json=payload, headers={"X-User-ID": user_id})
    assert resp1.status_code == 200
    plan1 = resp1.get_json()["plan"]
    weeks_order_1 = [(w["week"], [t["subtema"] for t in w["topics"]]) for w in plan1]

    # Verify rows were persisted in planner_schedule
    with app.app_context():
        db = get_db()
        count = db.execute("SELECT COUNT(*) FROM planner_schedule WHERE user_id = ?", (user_id,)).fetchone()[0]
        assert count > 0

    # Simulate answering questions with many errors in a topic that is scheduled for a later week
    later_topic = plan1[5]["topics"][0]["subtema"]
    with app.app_context():
        db = get_db()
        db.execute(
            """INSERT INTO questions(id, area, subtema, stem, correct_letter, missing_alts, year, institution_code, institution_label)
               VALUES (99901, 'Clínica Médica', ?, 'Stem Error', 'B', 0, 2025, 'USP', 'USP')""",
            (later_topic,)
        )
        for _ in range(8):
            db.execute(
                """INSERT INTO attempts(question_id, selected_letter, is_correct, answered_at, user_id)
                   VALUES (99901, 'A', 0, '2026-09-20T10:00:00Z', ?)""",
                (user_id,)
            )
        db.commit()

    # Second call must return the EXACT same weeks and topic order
    resp2 = client.post("/api/generate_plan", json=payload, headers={"X-User-ID": user_id})
    assert resp2.status_code == 200
    plan2 = resp2.get_json()["plan"]
    weeks_order_2 = [(w["week"], [t["subtema"] for t in w["topics"]]) for w in plan2]

    assert weeks_order_1 == weeks_order_2

    # But the topic itself should now reflect live adaptive signals
    topic_in_plan2 = next(t for w in plan2 for t in w["topics"] if t["subtema"] == later_topic)
    assert "low_accuracy" in topic_in_plan2["priority_reasons"]


def test_planner_schedule_cleared_on_reset_and_regenerate(client, app):
    from api.db import get_db

    user_id = "user_reset_test"
    start = date.today()
    exam = (start + timedelta(weeks=20)).isoformat()
    payload = {"start_date": start.isoformat(), "exam_date": exam, "hours_per_week": 20}

    # Generate
    resp = client.post("/api/generate_plan", json=payload, headers={"X-User-ID": user_id})
    assert resp.status_code == 200

    with app.app_context():
        db = get_db()
        assert db.execute("SELECT COUNT(*) FROM planner_schedule WHERE user_id = ?", (user_id,)).fetchone()[0] > 0

    # Reset
    resp_reset = client.post("/api/planner/config/reset", headers={"X-User-ID": user_id})
    assert resp_reset.status_code == 200

    with app.app_context():
        db = get_db()
        assert db.execute("SELECT COUNT(*) FROM planner_schedule WHERE user_id = ?", (user_id,)).fetchone()[0] == 0

    # Force regenerate via flag
    resp_gen = client.post("/api/generate_plan", json={**payload, "regenerate": True}, headers={"X-User-ID": user_id})
    assert resp_gen.status_code == 200
    with app.app_context():
        db = get_db()
        assert db.execute("SELECT COUNT(*) FROM planner_schedule WHERE user_id = ?", (user_id,)).fetchone()[0] > 0


def test_planner_topics_endpoint_returns_subtema_and_week_composite(client):
    user_id = "user_topic_progress_test"
    headers = {"X-User-ID": user_id}

    # Mark topic completed
    resp = client.post("/api/planner/3/topic", json={"subtema": "Hipertensão", "completed": True}, headers=headers)
    assert resp.status_code == 200

    # Get topics
    resp_get = client.get("/api/planner/topics", headers=headers)
    assert resp_get.status_code == 200
    data = resp_get.get_json()
    assert data.get("3:Hipertensão") is True
    assert data.get("Hipertensão") is True


def test_invalid_start_date_format_returns_error():
    result = generate_annual_plan(
        rows=[],
        start_date_str="invalid-start-date",
        exam_date_str="2025-12-31",
        hours_per_week=20,
    )
    assert result == {"error": "Formato de data inválido."}


def test_invalid_exam_date_format_returns_error():
    result = generate_annual_plan(
        rows=[],
        start_date_str="2025-01-01",
        exam_date_str="2025-13-45",
        hours_per_week=20,
    )
    assert result == {"error": "Formato de data inválido."}


def test_invalid_date_formats_api_endpoint(client):
    resp = client.post(
        "/api/generate_plan",
        json={
            "start_date": "not-a-valid-date",
            "exam_date": "2025-12-31",
            "hours_per_week": 20,
        },
    )
    assert resp.status_code == 200
    assert resp.get_json() == {"error": "Formato de data inválido."}

    resp_exam = client.post(
        "/api/generate_plan",
        json={
            "start_date": "2025-01-01",
            "exam_date": "invalid-exam-date",
            "hours_per_week": 20,
        },
    )
    assert resp_exam.status_code == 200
    assert resp_exam.get_json() == {"error": "Formato de data inválido."}


def test_no_warning_when_all_topics_fit_or_weeks_sufficient():
    start = date(2026, 9, 7)
    exam = date(2027, 11, 15)  # 62 weeks away
    # With 12 hours/week, 62 * 12 = 744 hours, curriculum needs ~610 hours (50 weeks)
    res = generate_annual_plan([], start.isoformat(), exam.isoformat(), hours_per_week=12)
    assert res.get("warning") is None
    assert len(res["plan"]) > 0

    # Simulate frozen schedule rows
    schedule_rows = []
    for w in res["plan"]:
        for order, t in enumerate(w["topics"]):
            schedule_rows.append({"week": w["week"], "subtema": t["subtema"], "display_order": order})

    # Reloading with exam_date_str must also not yield a warning
    reloaded = build_plan_from_schedule(
        schedule_rows,
        start.isoformat(),
        hours_per_week=12,
        exam_date_str=exam.isoformat(),
    )
    assert reloaded is not None
    assert reloaded.get("warning") is None
    assert reloaded.get("total_available_hours") is None


def test_warning_when_insufficient_time_and_schedule_reloaded():
    start = date(2026, 9, 7)
    exam = date(2026, 11, 16)  # 10 weeks away
    # 10 weeks * 12h = 120h, curriculum needs ~563h -> genuine deficit
    res = generate_annual_plan([], start.isoformat(), exam.isoformat(), hours_per_week=12)
    assert res.get("warning") is not None
    assert "120 horas disponíveis" in res["warning"]
    assert res.get("total_available_hours") == 120
    assert res.get("total_required_hours") == 563

    # Build schedule rows for the 10 weeks that could be planned
    schedule_rows = []
    for w in res["plan"]:
        for order, t in enumerate(w["topics"]):
            schedule_rows.append({"week": w["week"], "subtema": t["subtema"], "display_order": order})

    reloaded = build_plan_from_schedule(
        schedule_rows,
        start.isoformat(),
        hours_per_week=12,
        exam_date_str=exam.isoformat(),
    )
    assert reloaded is not None
    assert reloaded.get("warning") is not None
    assert "120 horas disponíveis" in reloaded["warning"]
    assert reloaded.get("total_available_hours") == 120
    assert reloaded.get("total_required_hours") == 563


def test_generate_plan_api_no_warning_on_reload_when_time_sufficient(client):
    user_id = "user_sufficient_time_test"
    start = date(2026, 9, 7)
    exam = date(2027, 11, 15)
    payload = {
        "start_date": start.isoformat(),
        "exam_date": exam.isoformat(),
        "hours_per_week": 12,
    }

    # First call generates and persists
    resp1 = client.post("/api/generate_plan", json=payload, headers={"X-User-ID": user_id})
    assert resp1.status_code == 200
    data1 = resp1.get_json()
    assert data1.get("warning") is None

    # Second call uses frozen schedule in database
    resp2 = client.post("/api/generate_plan", json=payload, headers={"X-User-ID": user_id})
    assert resp2.status_code == 200
    data2 = resp2.get_json()
    assert data2.get("warning") is None


def test_planner_config_returns_primary_institution_and_list(client):
    user_id = "user_primary_inst_test"
    headers = {"X-User-ID": user_id}

    # 1. Multi-institution configuration
    payload_multi = {
        "exam_date": "2026-11-15T12:00:00Z",
        "start_date": "2026-01-01T12:00:00Z",
        "target_institution": "USP-SP, USP-RP",
        "target_institutions": ["USP-SP", "USP-RP"],
    }
    resp = client.post("/api/planner/config", json=payload_multi, headers=headers)
    assert resp.status_code == 200

    cfg_resp = client.get("/api/planner/config", headers=headers)
    assert cfg_resp.status_code == 200
    cfg = cfg_resp.get_json()
    assert cfg["primary_institution"] == "USP-SP"
    assert cfg["target_institutions"] == ["USP-SP", "USP-RP"]

    # 2. National / "Todas as Bancas"
    payload_all = {
        "exam_date": "2026-11-15T12:00:00Z",
        "start_date": "2026-01-01T12:00:00Z",
        "target_institution": "Todas as Bancas",
        "target_institutions": ["TODAS"],
    }
    resp2 = client.post("/api/planner/config", json=payload_all, headers=headers)
    assert resp2.status_code == 200

    cfg_resp2 = client.get("/api/planner/config", headers=headers)
    assert cfg_resp2.status_code == 200
    cfg2 = cfg_resp2.get_json()
    assert cfg2["primary_institution"] is None
    assert cfg2["target_institution"] == "Todas as Bancas"


def test_exam_readiness_and_radar_with_composite_and_national_institutions(client, app):
    from api.db import get_db

    user_id = "user_composite_inst_test"
    headers = {"X-User-ID": user_id}

    with app.app_context():
        db = get_db()
        db.execute(
            """INSERT INTO questions(id, area, subtema, stem, correct_letter, missing_alts, year, institution_code, institution_label)
               VALUES (8801, 'Clínica Médica', 'Cardiologia', 'Stem Q', 'A', 0, 2025, 'USP-SP', 'FUVEST USP-SP'),
                      (8802, 'Cirurgia', 'Trauma', 'Stem Q2', 'B', 0, 2025, 'USP-RP', 'USP Ribeirao')"""
        )
        db.commit()

    # Composite query string in exam-readiness must not return 0 available questions
    resp_multi = client.get("/api/stats/exam-readiness?institution=USP-SP%2C+USP-RP", headers=headers)
    assert resp_multi.status_code == 200
    data_multi = resp_multi.get_json()
    # It extracts USP-SP, finding question 8801
    assert any(a["available"] > 0 for a in data_multi["areas"])

    # "Todas as Bancas" query string must evaluate nationally without filtering to literal "Todas as Bancas"
    resp_all = client.get("/api/stats/exam-readiness?institution=Todas+as+Bancas", headers=headers)
    assert resp_all.status_code == 200
    data_all = resp_all.get_json()
    assert any(a["available"] > 0 for a in data_all["areas"])

    # Institution radar with composite config
    client.post("/api/planner/config", json={
        "exam_date": "2026-11-15T12:00:00Z",
        "start_date": "2026-01-01T12:00:00Z",
        "target_institution": "USP-SP, USP-RP",
    }, headers=headers)

    resp_radar = client.get("/api/stats/institution-radar", headers=headers)
    assert resp_radar.status_code == 200
    radar_data = resp_radar.get_json()
    assert radar_data["institution"]["code"] == "USP-SP"


def test_load_catalogs_is_memoized():
    from api.services.planner import _load_catalogs

    # Ensure caching info is available and works
    assert hasattr(_load_catalogs, "cache_info")
    info_before = _load_catalogs.cache_info()
    res1 = _load_catalogs()
    res2 = _load_catalogs()
    assert res1 is res2
    info_after = _load_catalogs.cache_info()
    assert info_after.hits > info_before.hits


def test_planner_move_topic_between_weeks(client, app):
    from api.db import get_db

    user_id = "user_move_topic_test"
    headers = {"X-User-ID": user_id}
    start = date.today()
    exam = (start + timedelta(weeks=10)).isoformat()
    payload = {"start_date": start.isoformat(), "exam_date": exam, "hours_per_week": 20}

    # Gera plano inicial
    resp = client.post("/api/generate_plan", json=payload, headers=headers)
    assert resp.status_code == 200
    plan = resp.get_json()["plan"]
    assert len(plan) >= 2
    assert len(plan[0]["topics"]) > 0

    topic_to_move = plan[0]["topics"][0]["subtema"]

    # Mover da semana 1 para o final da semana 2
    move_resp = client.post("/api/planner/move-topic", json={
        "subtema": topic_to_move,
        "source_week": 1,
        "target_week": 2,
    }, headers=headers)
    assert move_resp.status_code == 200
    move_data = move_resp.get_json()
    assert move_data["success"] is True
    assert move_data["subtema"] == topic_to_move
    assert move_data["source_week"] == 1
    assert move_data["target_week"] == 2

    # Verificar se generate_plan subsequente reflete o tópico na semana 2
    resp2 = client.post("/api/generate_plan", json=payload, headers=headers)
    assert resp2.status_code == 200
    plan2 = resp2.get_json()["plan"]

    week1_subtemas = [t["subtema"] for t in plan2[0]["topics"]]
    week2_subtemas = [t["subtema"] for t in plan2[1]["topics"]]

    assert topic_to_move not in week1_subtemas
    assert topic_to_move in week2_subtemas


def test_planner_reorder_topic_within_same_week(client, app):
    user_id = "user_reorder_same_week_test"
    headers = {"X-User-ID": user_id}
    start = date.today()
    exam = (start + timedelta(weeks=10)).isoformat()
    payload = {"start_date": start.isoformat(), "exam_date": exam, "hours_per_week": 30}

    resp = client.post("/api/generate_plan", json=payload, headers=headers)
    assert resp.status_code == 200
    plan = resp.get_json()["plan"]
    week1_topics = [t["subtema"] for t in plan[0]["topics"]]
    assert len(week1_topics) >= 2

    last_topic = week1_topics[-1]

    # Mover o último tópico para a primeira posição (índice 0) da mesma semana 1
    move_resp = client.post("/api/planner/move-topic", json={
        "subtema": last_topic,
        "source_week": 1,
        "target_week": 1,
        "target_index": 0
    }, headers=headers)
    assert move_resp.status_code == 200

    resp2 = client.post("/api/generate_plan", json=payload, headers=headers)
    assert resp2.status_code == 200
    plan2 = resp2.get_json()["plan"]
    week1_topics_after = [t["subtema"] for t in plan2[0]["topics"]]

    assert week1_topics_after[0] == last_topic


def test_planner_move_topic_preserves_completion_progress(client, app):
    user_id = "user_move_topic_prog_test"
    headers = {"X-User-ID": user_id}
    start = date.today()
    exam = (start + timedelta(weeks=10)).isoformat()
    payload = {"start_date": start.isoformat(), "exam_date": exam, "hours_per_week": 20}

    resp = client.post("/api/generate_plan", json=payload, headers=headers)
    assert resp.status_code == 200
    plan = resp.get_json()["plan"]
    topic = plan[0]["topics"][0]["subtema"]

    # Marca tópico como concluído na semana 1
    resp_mark = client.post("/api/planner/1/topic", json={"subtema": topic, "completed": True}, headers=headers)
    assert resp_mark.status_code == 200

    # Confirma que está concluído
    topics_progress = client.get("/api/planner/topics", headers=headers).get_json()
    assert topics_progress.get(f"1:{topic}") is True

    # Move para a semana 3
    move_resp = client.post("/api/planner/move-topic", json={
        "subtema": topic,
        "source_week": 1,
        "target_week": 3,
    }, headers=headers)
    assert move_resp.status_code == 200

    # Confirma que o progresso agora está associado à semana 3
    topics_progress_after = client.get("/api/planner/topics", headers=headers).get_json()
    assert topics_progress_after.get(f"3:{topic}") is True


def test_build_learning_profile_fallback_sem_cache():
    from api.adaptive import _last_known_profile, _profile_cache, build_learning_profile

    class BrokenDB:
        def execute(self, *args, **kwargs):
            raise RuntimeError("DB offline")

    _profile_cache.cache.clear()
    _last_known_profile.clear()

    profile = build_learning_profile(BrokenDB(), "user_offline_test")
    assert profile["method"]["deterministic"] is True
    assert profile["method"]["fallback"] is True
    assert profile["goal"]["questions_today"] == 30
    assert profile["topics"] == []


def test_build_learning_profile_stale_fallback_em_desconexao():
    from api.adaptive import _last_known_profile, _profile_cache, build_learning_profile

    class BrokenDB:
        def execute(self, *args, **kwargs):
            raise RuntimeError("DB timeout")

    _profile_cache.cache.clear()
    cache_key = ("user_stale_test", None, 15)
    _last_known_profile[cache_key] = {
        "generated_at": "2026-11-17T12:00:00+00:00",
        "goal": {"questions_today": 45, "reviews_due": 12},
        "topics": [{"topic": "Cardiologia", "priority_score": 0.9}],
        "method": {"deterministic": True},
    }

    profile = build_learning_profile(BrokenDB(), "user_stale_test")
    assert profile["method"]["stale_fallback"] is True
    assert profile["goal"]["questions_today"] == 45
    assert profile["topics"][0]["topic"] == "Cardiologia"


def test_organization_modes_geral_vs_internato_and_completed_preservation(client):
    start_date = "2027-01-26"
    exam_date = "2027-06-26"

    # Configura planner
    r = client.post("/api/planner/config", json={
        "start_date": start_date,
        "exam_date": exam_date,
        "days_per_week": 5,
        "hours_per_day": 4,
        "organization_mode": "internato",
    })
    assert r.status_code == 200

    # Bloco customizado colocando Pediatria nas primeiras 4 semanas
    r = client.put("/api/planner/internato-blocks", json={
        "blocks": [
            {"start": "2027-01-26", "end": "2027-02-23", "area": "Pediatria"},
        ]
    })
    assert r.status_code == 200

    # Gera plano no modo internato
    r_int = client.post("/api/generate_plan", json={
        "start_date": start_date,
        "exam_date": exam_date,
        "hours_per_week": 20,
        "intensive": False,
        "organization": "internato",
    })
    assert r_int.status_code == 200
    plan_int = r_int.get_json()["plan"]
    week1_areas = [t["area"] for t in plan_int[0]["topics"]]
    assert week1_areas and week1_areas[0] == "Pediatria"
    assert sum(1 for a in week1_areas if a == "Pediatria") >= 2

    # Marca a primeira aula de Pediatria como concluída
    done_subtema = plan_int[0]["topics"][0]["subtema"]
    r_mark = client.post("/api/planner/1/topic", json={"subtema": done_subtema, "completed": True})
    assert r_mark.status_code == 200

    # Troca para modo geral -> aula concluída continua marcada e fica separada em completed_topics
    r_ger = client.post("/api/generate_plan", json={
        "start_date": start_date,
        "exam_date": exam_date,
        "hours_per_week": 20,
        "intensive": False,
        "organization": "geral",
        "regenerate": True,
    })
    assert r_ger.status_code == 200
    ger_body = r_ger.get_json()
    plan_ger = ger_body["plan"]
    all_ger_topics = [t for w in plan_ger for t in w["topics"]]
    assert all(t["subtema"] != done_subtema for t in all_ger_topics)
    matched = [t for t in ger_body.get("completed_topics", []) if t["subtema"] == done_subtema]
    assert len(matched) == 1
    assert matched[0]["completed"] is True

    # Verifica que /api/planner/topics continua com o tema marcado
    r_topics = client.get("/api/planner/topics")
    assert r_topics.status_code == 200
    assert r_topics.get_json().get(done_subtema) is True

    # Reset apenas do schedule preserva aulas feitas
    r_reset_sched = client.post("/api/planner/config/reset", json={"scope": "schedule"})
    assert r_reset_sched.status_code == 200
    assert client.get("/api/planner/topics").get_json().get(done_subtema) is True

    # Reset de progresso apaga aulas feitas, mas preserva config
    r_reset_prog = client.post("/api/planner/config/reset", json={"scope": "progress"})
    assert r_reset_prog.status_code == 200
    assert client.get("/api/planner/topics").get_json().get(done_subtema) is None
    assert client.get("/api/planner/config").get_json().get("exam_date") == exam_date


def test_switch_organization_mode_accepts_get_config_payload_with_primary_institution(client):
    user_id = "user_org_switch_roundtrip"
    headers = {"X-User-ID": user_id}

    r_init = client.post("/api/planner/config", json={
        "start_date": "2026-11-30T12:00:00Z",
        "exam_date": "2027-11-15T12:00:00Z",
        "days_per_week": 6,
        "hours_per_day": 2,
        "target_institution": "USP-SP, USP-RP",
        "target_institutions": ["USP-SP", "USP-RP"],
        "target_specialty": "Psiquiatria",
        "organization_mode": "geral",
    }, headers=headers)
    assert r_init.status_code == 200

    cfg = client.get("/api/planner/config", headers=headers).get_json()
    assert cfg["primary_institution"] == "USP-SP"
    assert cfg["organization_mode"] == "geral"

    # Reenviar o payload retornado pelo GET (incluindo primary_institution) não pode falhar com 400
    r_switch = client.post(
        "/api/planner/config",
        json={**cfg, "organization_mode": "internato"},
        headers=headers,
    )
    assert r_switch.status_code == 200

    cfg_after = client.get("/api/planner/config", headers=headers).get_json()
    assert cfg_after["organization_mode"] == "internato"
    assert cfg_after["target_institution"] == "USP-SP, USP-RP"
    assert cfg_after["target_specialty"] == "Psiquiatria"


def test_best_fit_packing_respects_13h_cap_and_avoids_short_weeks_and_hybrid_internato():
    blocks = [
        {"start": "2026-11-30", "end": "2027-01-24", "area": "Geral", "label": "Férias", "hours_per_week": 16},
        {"start": "2027-01-25", "end": "2027-02-21", "area": "Cirurgia", "label": "Cirurgia Geral", "hours_per_week": 12},
        {"start": "2027-02-22", "end": "2027-03-21", "area": "Medicina Intensiva", "label": "Anestesio / CTI"},
    ]

    # 1) Modo Geral com meta 12h: nenhuma semana > 13h e corpo sem semanas curtas (< 10.5h), intercalando áreas
    res_geral = generate_annual_plan([], "2026-11-30", "2027-11-15", hours_per_week=12, organization="geral")
    non_empty_g = [w for w in res_geral["plan"] if w["topics"]]
    assert all(w["allocated_hours"] <= 13.0 for w in non_empty_g)
    assert all(w["allocated_hours"] >= 10.5 for w in non_empty_g[:-1])
    week1_areas = {t["area"] for t in non_empty_g[0]["topics"]}
    assert len(week1_areas) >= 3

    # 2) Modo Internato Híbrido 70/30 com carga customizada por bloco
    res_int = generate_annual_plan(
        [], "2026-11-30", "2027-11-15", hours_per_week=12, organization="internato", internato_blocks=blocks
    )
    non_empty_i = [w for w in res_int["plan"] if w["topics"]]
    for w in non_empty_i:
        assert w["allocated_hours"] <= w["recommended_hours"] + 1.0
    # Semana 1 cai em Férias (16h customizadas e área Geral equilibrada)
    assert non_empty_i[0]["recommended_hours"] == 16
    assert non_empty_i[0]["internato_block_label"] == "Férias"
    assert non_empty_i[0]["allocated_hours"] >= 15.0
    # Semana 9 cai em Cirurgia Geral (12h, híbrido: maioria Cirurgia + trilha paralela)
    week_cir = next(w for w in non_empty_i if w.get("internato_block_label") == "Cirurgia Geral")
    cir_areas = [t["area"] for t in week_cir["topics"]]
    assert cir_areas.count("Cirurgia") >= 2
    assert any(a != "Cirurgia" for a in cir_areas)


def test_empirical_bank_incidence_reorders_priority_and_intensive_cutoff():
    start = date(2026, 11, 30)
    exam = date(2027, 11, 15)

    # Câncer de Mama não é highYield no catálogo estático, mas tem altíssima incidência nas bancas-alvo
    non_hy_heavy = "Câncer de Mama: Rastreamento, Diagnóstico e Estadiamento"
    hy_light = "Climatério, Menopausa e Terapia de Reposição Hormonal (TRH)"
    rows = [
        {"area": "Ginecologia e Obstetrícia", "subtema": non_hy_heavy, "q_count": 500, "target_q_count": 225},
        {"area": "Ginecologia e Obstetrícia", "subtema": hy_light, "q_count": 200, "target_q_count": 12},
    ]

    res = generate_annual_plan(
        rows,
        start.isoformat(),
        exam.isoformat(),
        hours_per_week=12,
        use_bank_incidence=True,
    )
    all_topics = [t for w in res["plan"] for t in w["topics"]]
    t_heavy = next(t for t in all_topics if t["subtema"] == non_hy_heavy)
    t_light = next(t for t in all_topics if t["subtema"] == hy_light)

    assert t_heavy["incidence_source"] == "target_banks"
    assert t_heavy["target_questions_count"] == 225
    assert "225 questões" in t_heavy["priority_explanation"]
    assert t_heavy["priority"] > t_light["priority"]

    # No modo intensivo, o subtema pesado nas bancas-alvo deve entrar no plano
    res_int = generate_annual_plan(
        rows,
        start.isoformat(),
        exam.isoformat(),
        hours_per_week=12,
        intensive=True,
        use_bank_incidence=True,
    )
    int_names = {t["subtema"] for w in res_int["plan"] for t in w["topics"]}
    assert non_hy_heavy in int_names


def test_changing_target_institution_regenerates_schedule_and_uses_db_incidence(client, app):
    from api.db import get_db

    user_id = "user_bank_incidence_e2e"
    headers = {"X-User-ID": user_id}
    non_hy_heavy = "Câncer de Mama: Rastreamento, Diagnóstico e Estadiamento"

    with app.app_context():
        db = get_db()
        for idx in range(15):
            db.execute(
                """INSERT INTO questions(id, area, subtema, stem, correct_letter, missing_alts, year, institution_code, institution_label)
                   VALUES (?, 'Ginecologia e Obstetrícia', ?, 'Stem Mama', 'A', 0, 2025, 'USP-SP', 'USP-SP')""",
                (77000 + idx, non_hy_heavy),
            )
        db.commit()

    start_iso = "2026-11-30T12:00:00Z"
    exam_iso = "2027-11-15T12:00:00Z"

    # 1) Começa com Todas as Bancas -> usa catálogo nacional
    r_cfg1 = client.post("/api/planner/config", json={
        "start_date": start_iso,
        "exam_date": exam_iso,
        "days_per_week": 6,
        "hours_per_day": 2,
        "target_institution": "Todas as Bancas",
        "target_institutions": ["TODAS"],
    }, headers=headers)
    assert r_cfg1.status_code == 200

    r_plan1 = client.post("/api/generate_plan", json={
        "start_date": start_iso,
        "exam_date": exam_iso,
        "hours_per_week": 12,
    }, headers=headers)
    assert r_plan1.status_code == 200
    t_all = [t for w in r_plan1.get_json()["plan"] for t in w["topics"]]
    mama_before = next(t for t in t_all if t["subtema"] == non_hy_heavy)
    assert mama_before["incidence_source"] == "national_catalog"
    assert mama_before["priority"] < 100

    # Marca 1 aula concluída para garantir preservação ao mudar bancas
    done_topic = t_all[0]["subtema"]
    assert client.post("/api/planner/1/topic", json={"subtema": done_topic, "completed": True}, headers=headers).status_code == 200

    # 2) Muda bancas para USP-SP -> deve limpar planner_schedule (preservando concluídos) e promover Câncer de Mama
    r_cfg2 = client.post("/api/planner/config", json={
        "start_date": start_iso,
        "exam_date": exam_iso,
        "days_per_week": 6,
        "hours_per_day": 2,
        "target_institution": "USP-SP",
        "target_institutions": ["USP-SP"],
    }, headers=headers)
    assert r_cfg2.status_code == 200

    with app.app_context():
        db = get_db()
        assert db.execute("SELECT COUNT(*) FROM planner_schedule WHERE user_id = ?", (user_id,)).fetchone()[0] == 0

    r_plan2 = client.post("/api/generate_plan", json={
        "start_date": start_iso,
        "exam_date": exam_iso,
        "hours_per_week": 12,
    }, headers=headers)
    assert r_plan2.status_code == 200
    body2 = r_plan2.get_json()
    t_after = [t for w in body2["plan"] for t in w["topics"]]
    mama_after = next(t for t in t_after if t["subtema"] == non_hy_heavy)
    assert mama_after["incidence_source"] == "target_banks"
    assert mama_after["target_questions_count"] == 15
    assert mama_after["priority"] >= 100
    assert any(t["subtema"] == done_topic for t in body2.get("completed_topics", []))







