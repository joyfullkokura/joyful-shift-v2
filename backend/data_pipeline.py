import argparse
import os
from calendar import monthrange
from collections import defaultdict
from datetime import date
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from dotenv import load_dotenv
from supabase import Client, create_client


load_dotenv(Path(__file__).resolve().parent.parent / '.env')


def parse_time_to_float(value: Optional[str]) -> Optional[float]:
    if value in (None, '', 'null'):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    try:
        if ':' in text:
            hour_str, minute_str = text.split(':', 1)
            hour = int(hour_str)
            minute = int(minute_str)
            return hour + minute / 60.0
        return float(text)
    except (TypeError, ValueError):
        return None


def format_float_time(value: Optional[float]) -> str:
    if value is None:
        return '未設定'
    hour = int(value)
    minute = int(round((value - hour) * 60))
    if minute == 60:
        hour += 1
        minute = 0
    if hour >= 24:
        hour = 23
        minute = 59
    return f"{hour:02d}:{minute:02d}"


def get_weekday_jp(day: int, month: int, year: int) -> str:
    wd = date(year, month, day).weekday()
    return ['月', '火', '水', '木', '金', '土', '日'][wd]


def get_supabase_client() -> Client:
    url = (
        os.getenv('SUPABASE_URL')
        or os.getenv('NEXT_PUBLIC_SUPABASE_URL')
        or os.getenv('SUPABASE_PROJECT_URL')
    )
    key = (
        os.getenv('SUPABASE_ANON_KEY')
        or os.getenv('NEXT_PUBLIC_SUPABASE_ANON_KEY')
        or os.getenv('SUPABASE_SERVICE_ROLE_KEY')
    )

    if not url or not key:
        raise RuntimeError(
            'Supabase credentials are not set. Please define SUPABASE_URL / SUPABASE_ANON_KEY '
            'or NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY in the environment or .env file.'
        )

    return create_client(url, key)


def normalize_csv_text(value: Optional[str]) -> List[str]:
    if value is None:
        return []
    text = str(value).strip()
    if not text:
        return []
    return [part.strip() for part in text.split(',') if part.strip()]


def get_store_info(client: Client, store_id: str) -> Dict[str, Any]:
    response = client.table('stores').select('*').eq('store_id', store_id).limit(1).execute()
    rows = getattr(response, 'data', None) or []
    if not rows:
        raise ValueError(f"Store not found: {store_id}")
    return rows[0]


def get_staff_rows(client: Client, store_id: str) -> List[Dict[str, Any]]:
    response = client.table('staff').select('*').eq('store_id', store_id).order('name', desc=False).execute()
    rows = getattr(response, 'data', None) or []
    return rows


def get_shift_requests_for_month(client: Client, store_id: str, target_year: int, target_month: int) -> List[Dict[str, Any]]:
    start_date = f"{target_year}-{target_month:02d}-01"
    end_day = 31
    if target_month == 12:
        next_month = 1
        next_year = target_year + 1
    else:
        next_month = target_month + 1
        next_year = target_year
    end_date = f"{next_year}-{next_month:02d}-01"

    response = (
        client.table('shift_requests')
        .select('*')
        .eq('store_id', store_id)
        .gte('date', start_date)
        .lt('date', end_date)
        .execute()
    )
    rows = getattr(response, 'data', None) or []
    return rows


def build_day_record(
    date_key: str,
    target_year: int,
    target_month: int,
    day: int,
    store_open: Optional[float],
    store_close: Optional[float],
    staff_row: Dict[str, Any],
    request_row: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    weekday = get_weekday_jp(day, target_month, target_year)
    if request_row and request_row.get('is_off') is True:
        return {
            'date': date_key,
            'day': day,
            'weekday': weekday,
            'is_available': False,
            'ranges': [],
            'source': '休み希望',
            'reason': '希望提出',
            'note': request_row.get('memo') or '',
        }

    # 2. explicit request time range
    if request_row and (
        request_row.get('start_time') is not None or request_row.get('end_time') is not None
    ):
        start = parse_time_to_float(request_row.get('start_time'))
        end = parse_time_to_float(request_row.get('end_time'))
        if start is not None and end is not None and end > start:
            return {
                'date': date_key,
                'day': day,
                'weekday': weekday,
                'is_available': True,
                'ranges': [{'start': start, 'end': end}],
                'source': '個別要望',
                'reason': f"{format_float_time(start)}〜{format_float_time(end)}",
                'note': request_row.get('memo') or '',
            }

    # 3. standard schedule
    work_ranges: List[Tuple[float, float]] = []
    for slot_index in (1, 2):
        start_key = f'work_start_{slot_index}'
        end_key = f'work_end_{slot_index}'
        start_value = parse_time_to_float(staff_row.get(start_key))
        end_value = parse_time_to_float(staff_row.get(end_key))
        if start_value is not None and end_value is not None and end_value > start_value:
            work_ranges.append((start_value, end_value))

    if not work_ranges:
        if store_open is not None and store_close is not None and store_close > store_open:
            work_ranges = [(store_open, store_close)]
            source = '通常枠'
            reason = '店舗営業時間'
        else:
            return {
                'date': date_key,
                'day': day,
                'weekday': weekday,
                'is_available': False,
                'ranges': [],
                'source': '未設定',
                'reason': '営業時間データなし',
                'note': request_row.get('memo') if request_row else '',
            }
    else:
        source = '通常枠'
        reason = '勤務時間'

    return {
        'date': date_key,
        'day': day,
        'weekday': weekday,
        'is_available': True,
        'ranges': [{'start': start, 'end': end} for start, end in work_ranges],
        'source': source,
        'reason': reason,
        'note': request_row.get('memo') if request_row else '',
    }


def build_staff_availability_map(store_id: str, target_year: int, target_month: int) -> Dict[str, Any]:
    client = get_supabase_client()
    store = get_store_info(client, store_id)
    staff_rows = get_staff_rows(client, store_id)
    request_rows = get_shift_requests_for_month(client, store_id, target_year, target_month)

    store_open = parse_time_to_float(store.get('open_time'))
    store_close = parse_time_to_float(store.get('close_time'))

    requests_by_staff_date: Dict[str, Dict[str, Any]] = defaultdict(dict)
    for row in request_rows:
        staff_id = row.get('staff_id')
        date_value = row.get('date')
        if staff_id and date_value:
            requests_by_staff_date[str(staff_id)][str(date_value)] = row

    days_in_month = monthrange(target_year, target_month)[1]

    result: Dict[str, Any] = {
        'store_id': store_id,
        'store_name': store.get('name', store_id),
        'target_year': target_year,
        'target_month': target_month,
        'store_open_time': format_float_time(store_open),
        'store_close_time': format_float_time(store_close),
        'days_in_month': days_in_month,
        'staff_count': len(staff_rows),
        'staff': {},
    }

    for staff_row in staff_rows:
        staff_id = str(staff_row['id'])
        staff_type = '社員' if staff_row.get('is_employee') else 'アルバイト'
        skills = normalize_csv_text(staff_row.get('skills'))
        possible_groups = normalize_csv_text(staff_row.get('possible_groups'))
        staff_days: List[Dict[str, Any]] = []

        for day in range(1, days_in_month + 1):
            date_key = f"{target_year}-{target_month:02d}-{day:02d}"
            request_row = requests_by_staff_date.get(staff_id, {}).get(date_key)
            day_record = build_day_record(
                date_key=date_key,
                target_year=target_year,
                target_month=target_month,
                day=day,
                store_open=store_open,
                store_close=store_close,
                staff_row=staff_row,
                request_row=request_row,
            )
            staff_days.append(day_record)

        result['staff'][staff_id] = {
            'id': staff_id,
            'name': staff_row.get('name', '不明'),
            'type': staff_type,
            'rank': staff_row.get('rank') or '未設定',
            'weekly_target_days': staff_row.get('weekly_target_days') or 0,
            'main_job': staff_row.get('main_job') or '未設定',
            'possible_groups': possible_groups,
            'skills': skills,
            'days': staff_days,
        }

    return result


def print_summary(summary: Dict[str, Any]) -> None:
    print('=' * 50)
    print(f"🏪 店舗: {summary['store_id']} ({summary['store_name']})")
    print(f"🕒 営業時間: {summary['store_open_time']} - {summary['store_close_time']}")
    print(f"🗓 対象年月: {summary['target_year']}年{summary['target_month']}月 ({summary['days_in_month']}日間)")
    print(f"👥 対象スタッフ数: {summary['staff_count']}名")
    print('=' * 50)

    for staff_id, staff_data in summary['staff'].items():
        skill_label = ', '.join(f"[{skill}]" for skill in staff_data['skills']) if staff_data['skills'] else 'なし'
        print()
        print(f"👤 [{staff_data['type']}] {staff_data['name']} (ランク: {staff_data['rank']}, 週希望: {staff_data['weekly_target_days']}日, スキル: {skill_label})")

        for day_data in staff_data['days']:
            month_day = int(day_data['date'][5:7])
            day_num = int(day_data['date'][8:10])
            formatted_date = f"{month_day:02d}/{day_num:02d}"

            if not day_data['is_available']:
                print(f"  - {formatted_date} ({day_data['weekday']}): 休み ({day_data['reason']})")
                continue

            ranges = day_data.get('ranges', [])
            range_text = ', '.join(
                f"{format_float_time(r['start'])}〜{format_float_time(r['end'])}" for r in ranges
            ) if ranges else '未設定'
            label = day_data.get('source', '通常枠')
            if day_data.get('note'):
                print(f"  - {formatted_date} ({day_data['weekday']}): {range_text} ({label}: '{day_data['note']}')")
            else:
                print(f"  - {formatted_date} ({day_data['weekday']}): {range_text} ({label})")

        print('-' * 50)


def main() -> None:
    parser = argparse.ArgumentParser(description='Build a daily staffing availability map for a store.')
    parser.add_argument('--store-id', default='KOKURA', help='Store ID (default: KOKURA)')
    parser.add_argument('--year', type=int, default=2026, help='Target year (default: 2026)')
    parser.add_argument('--month', type=int, default=10, help='Target month (default: 10)')
    args = parser.parse_args()

    summary = build_staff_availability_map(args.store_id, args.year, args.month)
    print_summary(summary)

    # Also print a compact machine-readable dictionary for pipeline debugging.
    print('\n=== DEBUG: availability map (first staff only) ===')
    first_staff = next(iter(summary['staff'].values()), None)
    if first_staff:
        import json
        print(json.dumps({
            'staff_name': first_staff['name'],
            'days': first_staff['days'][:3],
        }, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
