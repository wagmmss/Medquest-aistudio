"""Helpers de fuso horário local (padrão America/Sao_Paulo) para métricas e notificações."""
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

DEFAULT_TZ = ZoneInfo("America/Sao_Paulo")
_MIN_TZ_OFFSET_MINUTES = -840
_MAX_TZ_OFFSET_MINUTES = 840


def _offset_minutes_for_tz(now_utc: datetime, tz: ZoneInfo) -> int:
    offset = now_utc.astimezone(tz).utcoffset()
    if offset is None:
        return -180
    return round(offset.total_seconds() / 60)


def resolve_tz_offset_minutes(args, now_utc: datetime) -> int:
    """Resolve o offset em minutos a partir de `tz` (IANA) ou `tz_offset`, com fallback para DEFAULT_TZ."""
    raw_tz = args.get("tz") if args is not None else None
    if isinstance(raw_tz, str):
        tz_name = raw_tz.strip()
        if tz_name:
            try:
                tz = ZoneInfo(tz_name)
                return max(
                    _MIN_TZ_OFFSET_MINUTES,
                    min(_MAX_TZ_OFFSET_MINUTES, _offset_minutes_for_tz(now_utc, tz)),
                )
            except (ZoneInfoNotFoundError, ValueError, KeyError):
                pass

    raw_offset = args.get("tz_offset") if args is not None else None
    if raw_offset is not None and str(raw_offset).strip() != "":
        try:
            parsed = int(raw_offset)
            return max(_MIN_TZ_OFFSET_MINUTES, min(_MAX_TZ_OFFSET_MINUTES, parsed))
        except (ValueError, TypeError):
            pass

    return _offset_minutes_for_tz(now_utc, DEFAULT_TZ)


def local_day_bounds_utc(now_utc: datetime, tz: ZoneInfo = DEFAULT_TZ) -> tuple[datetime, datetime]:
    """Retorna (start_utc, end_utc) do dia local corrente em `tz`."""
    now_local = now_utc.astimezone(tz)
    start_local = datetime(now_local.year, now_local.month, now_local.day, tzinfo=tz)
    next_day = now_local.date() + timedelta(days=1)
    end_local = datetime(next_day.year, next_day.month, next_day.day, tzinfo=tz)
    return start_local.astimezone(UTC), end_local.astimezone(UTC)
