'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useParams } from 'next/navigation'
import { Calendar as CalendarIcon, Save, Rocket, ChevronLeft, ChevronRight } from 'lucide-react'

// --- ユーティリティ ---
const tToF = (t: string | undefined) => {
  if (!t) return 10;
  const [h, m] = t.split(':').map(Number);
  return h + m / 60;
};

const fToT = (f: number) => {
  const h = Math.floor(f);
  const m = Math.round((f % 1) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

// --- 日本の祝日データ (2026年・2027年) ---
const HOLIDAYS: { [key: string]: string } = {
  // 2026年
  "2026-01-01": "元日", "2026-01-12": "成人の日", "2026-02-11": "建国記念の日", "2026-02-23": "天皇誕生日",
  "2026-03-21": "春分の日", "2026-04-29": "昭和の日", "2026-05-03": "憲法記念日", "2026-05-04": "みどりの日",
  "2026-05-05": "こどもの日", "2026-05-06": "振替休日", "2026-07-20": "海の日", "2026-08-11": "山の日",
  "2026-09-21": "敬老の日", "2026-09-22": "国民の休日", "2026-09-23": "秋分の日", "2026-10-12": "スポーツの日",
  "2026-11-03": "文化の日", "2026-11-23": "勤労感謝の日",
  // 2027年
  "2027-01-01": "元日", "2027-01-11": "成人の日", "2027-02-11": "建国記念の日", "2027-02-23": "天皇誕生日",
  "2027-03-21": "春分の日", "2027-03-22": "振替休日", "2027-04-29": "昭和の日", "2027-05-03": "憲法記念日",
  "2027-05-04": "みどりの日", "2027-05-05": "こどもの日", "2027-07-19": "海の日", "2027-08-11": "山の日",
  "2027-09-20": "敬老の日", "2027-09-23": "秋分の日", "2027-10-11": "スポーツの日", "2027-11-03": "文化の日",
  "2027-11-23": "勤労感謝の日"
};

const ROLE_COLORS = [
  { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', bar: 'bg-orange-500', thumb: 'border-orange-600' },
  { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', bar: 'bg-emerald-500', thumb: 'border-emerald-600' },
  { bg: 'bg-sky-50', text: 'text-sky-700', border: 'border-sky-200', bar: 'bg-sky-500', thumb: 'border-sky-600' },
  { bg: 'bg-violet-50', text: 'text-violet-700', border: 'border-violet-200', bar: 'bg-violet-500', thumb: 'border-violet-600' },
  { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200', bar: 'bg-rose-500', thumb: 'border-rose-600' },
];

export default function GeneratePage() {
  const { store_id } = useParams();
  const [storeInfo, setStoreInfo] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<string>('wd'); 
  
  const [viewDate, setViewDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const targetYear = viewDate.getFullYear();
  const targetMonth = viewDate.getMonth() + 1;
  const targetMonthStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}-01`;

  const [selectedSpecialDays, setSelectedSpecialDays] = useState<string[]>([]);
  const [counts, setCounts] = useState<Record<string, Record<string, number>>>({}); 
  const [slots, setSlots] = useState<Record<string, Record<string, {start: number, end: number}>>>({}); 
  const [isSaving, setIsSaving] = useState(false);

  const minTime = useMemo(() => tToF(storeInfo?.open_time), [storeInfo]);
  const maxTime = useMemo(() => tToF(storeInfo?.close_time), [storeInfo]);
  const groups = useMemo(() => storeInfo?.group_options?.split(',') || [], [storeInfo]);

// --- 1. データの読み込みロジック（過去設定の継承機能付き） ---
const loadAllSettings = useCallback(async () => {
    if (!store_id) return;
    
    // 店舗基本情報
    const { data: sInfo } = await supabase.from('stores').select('*').eq('store_id', store_id).single();
    if (sInfo) setStoreInfo(sInfo);

    const storeGroups = sInfo?.group_options?.split(',') || [];

    // ① まず、今表示している月の設定があるか確認
    const { data: currentSettings } = await supabase
      .from('generation_settings')
      .select('*')
      .eq('store_id', store_id)
      .eq('target_month', targetMonthStr);

    const newCounts: any = {};
    const newSlots: any = {};
    const specials: string[] = [];

    if (currentSettings && currentSettings.length > 0) {
      // 現在の月のデータがあればそれをそのまま使う
      currentSettings.forEach(set => {
        newCounts[set.config_type] = set.counts;
        newSlots[set.config_type] = set.slots;
        if (set.config_type !== 'wd' && set.config_type !== 'we') {
          specials.push(set.config_type);
        }
      });
    } else {
      // ② 現在の月が空なら、過去の最新設定（wd, weのみ）を探しに行く
      const { data: pastSettings } = await supabase
        .from('generation_settings')
        .select('*')
        .eq('store_id', store_id)
        .in('config_type', ['wd', 'we']) // 平日と休日のみ
        .order('target_month', { ascending: false }) // 新しい月順
        .limit(10); 

      if (pastSettings && pastSettings.length > 0) {
        // 過去データから最新の 'wd' と 'we' を見つけてセット
        const latestWd = pastSettings.find(s => s.config_type === 'wd');
        const latestWe = pastSettings.find(s => s.config_type === 'we');

        if (latestWd) {
          newCounts['wd'] = latestWd.counts;
          newSlots['wd'] = latestWd.slots;
        }
        if (latestWe) {
          newCounts['we'] = latestWe.counts;
          newSlots['we'] = latestWe.slots;
        }
        console.log("過去の設定を自動継承しました");
      } else {
        // ③ 過去にも一切データがなければ、デフォルト(6人, 10-18)を作る
        ['wd', 'we'].forEach(t => {
          newCounts[t] = {};
          newSlots[t] = {};
          storeGroups.forEach((g: string) => {
            newCounts[t][g] = 6;
            for (let i = 0; i < 6; i++) {
              newSlots[t][`${g}_${i}`] = { start: 10, end: 18 };
            }
          });
        });
      }
    }

    // 最後に画面の状態(State)を更新
    setCounts(newCounts);
    setSlots(newSlots);
    setSelectedSpecialDays(specials);
  }, [store_id, targetMonthStr]); 

  useEffect(() => {
    loadAllSettings();
  }, [loadAllSettings]);

  const changeMonth = (diff: number) => {
    setViewDate(new Date(targetYear, targetMonth - 1 + diff, 1));
  };

  const updateCount = (tab: string, group: string, delta: number) => {
    setCounts(prev => {
      const tabData = { ...(prev[tab] || {}) };
      tabData[group] = Math.max(0, (tabData[group] || 0) + delta);
      return { ...prev, [tab]: tabData };
    });
  };

  const updateTimeSlot = (tab: string, id: string, type: 'start' | 'end', val: number) => {
    setSlots(prev => {
      const tabData = { ...(prev[tab] || {}) };
      const current = tabData[id] || { start: 10, end: 18 };
      let { start, end } = current;
      if (type === 'start') start = Math.min(val, end - 0.5);
      if (type === 'end') end = Math.max(val, start + 0.5);
      tabData[id] = { start, end };
      return { ...prev, [tab]: tabData };
    });
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const payload = ['wd', 'we', ...selectedSpecialDays].map(type => ({
        store_id: store_id,
        target_month: targetMonthStr,
        config_type: type,
        counts: counts[type] || {},
        slots: slots[type] || {}
      }));
      const { error } = await supabase.from('generation_settings').upsert(payload, { onConflict: 'store_id, target_month, config_type' });
      if (error) throw error;
      alert('設定を保存しました！');
    } catch (e: any) {
      alert('保存失敗: ' + e.message);
    } finally { setIsSaving(false); }
  };

  const daysInMonth = new Date(targetYear, targetMonth, 0).getDate();
  const firstDay = new Date(targetYear, targetMonth - 1, 1).getDay();
  const currentTabCounts = counts[activeTab] || {};
  const currentTabSlots = slots[activeTab] || {};

  const currentTotalMH = useMemo(() => {
    let total = 0;
    Object.keys(currentTabCounts).forEach(g => {
      const c = currentTabCounts[g] || 0;
      for (let i = 0; i < c; i++) {
        const s = currentTabSlots[`${g}_${i}`] || { start: 10, end: 18 };
        total += (s.end - s.start);
      }
    });
    return total;
  }, [activeTab, counts, slots]);

  if (!storeInfo) return <div className="p-10 text-gray-400">Loading...</div>;

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-8">
      {/* 🌙 月選択ヘッダー */}
      <div className="flex justify-between items-center mb-8 bg-white p-6 rounded-3xl shadow-sm border border-orange-50">
        <button onClick={() => changeMonth(-1)} className="p-2 hover:bg-gray-100 rounded-full transition-all"><ChevronLeft /></button>
        <div className="text-center">
            <h1 className="text-2xl font-black text-gray-800">{targetYear}年 {targetMonth}月</h1>
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest italic">Generation Workspace</p>
        </div>
        <button onClick={() => changeMonth(1)} className="p-2 hover:bg-gray-100 rounded-full transition-all"><ChevronRight /></button>
      </div>

      {/* 🗓 特定日選択カレンダー (祝日印字版) */}
      <section className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-gray-100 mb-8">
        <h3 className="text-xs font-black mb-4 text-gray-400 uppercase tracking-widest flex items-center gap-2">
          <CalendarIcon size={14} /> Select specific dates for special staffing
        </h3>
        <div className="grid grid-cols-7 gap-1 md:gap-2 max-w-sm mx-auto">
          {['日','月','火','水','木','金','土'].map((d, i) => (
            <div key={d} className={`text-center text-[10px] font-black ${i===0?'text-red-400':i===6?'text-blue-400':'text-gray-300'}`}>{d}</div>
          ))}
          {Array(firstDay).fill(0).map((_, i) => <div key={`e-${i}`} />)}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const dateStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const holidayName = HOLIDAYS[dateStr]; // 祝日名を取得
            const isSelected = selectedSpecialDays.includes(dateStr);
            const weekDay = new Date(targetYear, targetMonth - 1, day).getDay();
            
            // 祝日または日曜日は赤、土曜日は青
            const isRedDay = weekDay === 0 || holidayName;
            const isBlueDay = weekDay === 6;

            return (
              <button
                key={day}
                onClick={() => {
                  if (isSelected) setSelectedSpecialDays(prev => prev.filter(d => d !== dateStr));
                  else {
                    setSelectedSpecialDays(prev => [...prev, dateStr]);
                    if (!counts[dateStr]) {
                      setCounts(p => ({ ...p, [dateStr]: counts['we'] || {} }));
                      setSlots(p => ({ ...p, [dateStr]: slots['we'] || {} }));
                    }
                  }
                }}
                className={`relative h-12 rounded-xl flex flex-col items-center justify-center transition-all ${
                  isSelected ? 'bg-orange-500 text-white shadow-lg scale-110 z-10' : 'bg-gray-50 hover:bg-orange-50'
                }`}
              >
                <span className={`text-xs font-bold ${
                  !isSelected && isRedDay ? 'text-red-500' : 
                  !isSelected && isBlueDay ? 'text-blue-500' : ''
                }`}>
                  {day}
                </span>
                {/* 祝日名の印字 */}
                {holidayName && (
                  <span className={`absolute bottom-0.5 text-[5px] scale-90 truncate w-full text-center px-0.5 font-bold ${
                    isSelected ? 'text-orange-100' : 'text-red-400'
                  }`}>
                    {holidayName}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* 📑 タブ */}
      <div className="flex gap-2 overflow-x-auto pb-4 no-scrollbar sticky top-0 bg-gray-50/95 backdrop-blur-md z-30 pt-2 mb-6 border-b border-gray-100">
        <TabButton id="wd" label="🚃 平日" active={activeTab} onClick={setActiveTab} />
        <TabButton id="we" label="🌞 土日祝" active={activeTab} onClick={setActiveTab} />
        {selectedSpecialDays.sort().map(date => (
          <TabButton key={date} id={date} label={`⭐ ${parseInt(date.split('-')[2])}日`} active={activeTab} onClick={setActiveTab} color="orange" />
        ))}
      </div>

      <div className="space-y-12 pb-40">
        <div className="flex justify-end">
          <div className="bg-white px-6 py-3 rounded-2xl shadow-sm border border-orange-100">
            <span className={`text-2xl font-black ${currentTotalMH > storeInfo.target_mh_per_day ? 'text-red-500' : 'text-orange-500'}`}>
              {currentTotalMH.toFixed(1)}H
            </span>
          </div>
        </div>

        {groups.map((group: string, gIdx: number) => {
          const color = ROLE_COLORS[gIdx % ROLE_COLORS.length];
          const count = currentTabCounts[group] || 0;
          return (
            <div key={group} className="space-y-6">
              <div className={`flex items-center justify-between p-6 rounded-3xl ${color.bg} border-2 ${color.border}`}>
                <h4 className={`text-xl font-black ${color.text}`}>{group}</h4>
                <div className="flex items-center gap-4 bg-white/80 p-2 rounded-2xl shadow-inner">
                  <button onClick={() => updateCount(activeTab, group, -1)} className="w-10 h-10 rounded-xl bg-white shadow-sm font-bold text-xl active:scale-90 transition-transform">－</button>
                  <span className={`text-2xl font-black w-10 text-center ${color.text}`}>{count}</span>
                  <button onClick={() => updateCount(activeTab, group, 1)} className="w-10 h-10 rounded-xl bg-white shadow-sm font-bold text-xl active:scale-90 transition-transform">＋</button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 pl-4 border-l-2 border-dashed border-gray-200">
                {Array.from({ length: count }).map((_, i) => {
                  const slotId = `${group}_${i}`;
                  const { start, end } = currentTabSlots[slotId] || { start: 10, end: 18 };
                  return (
                    <div key={slotId} className={`p-5 rounded-2xl shadow-sm border bg-white ${color.border} flex flex-col md:flex-row md:items-center gap-6 hover:shadow-md transition-all`}>
                      <div className="w-24 text-gray-400 font-bold text-[10px] uppercase tracking-tighter">{group} No.{i + 1}</div>
                      <div className="flex-1 flex items-center gap-4">
                        <span className="text-[11px] font-mono font-black text-gray-300 w-12 text-right">{fToT(start)}</span>
                        <div className="relative flex-1 h-10 flex items-center">
                          <div className="absolute w-full h-2 bg-gray-100 rounded-full shadow-inner"></div>
                          <div className={`absolute h-2 ${color.bar} rounded-full transition-all`} style={{ left: `${((start - minTime) / (maxTime - minTime)) * 100}%`, width: `${((end - start) / (maxTime - minTime)) * 100}%` }}></div>
                          <input type="range" min={minTime} max={maxTime} step="0.5" value={start} onChange={(e) => updateTimeSlot(activeTab, slotId, 'start', parseFloat(e.target.value))} className={`absolute w-full appearance-none bg-transparent pointer-events-none z-20 [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-7 [&::-webkit-slider-thumb]:h-7 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-4 ${color.thumb} [&::-webkit-slider-thumb]:shadow-xl`} />
                          <input type="range" min={minTime} max={maxTime} step="0.5" value={end} onChange={(e) => updateTimeSlot(activeTab, slotId, 'end', parseFloat(e.target.value))} className={`absolute w-full appearance-none bg-transparent pointer-events-none z-20 [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-7 [&::-webkit-slider-thumb]:h-7 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-4 ${color.thumb} [&::-webkit-slider-thumb]:shadow-xl`} />
                        </div>
                        <span className="text-[11px] font-mono font-black text-gray-300 w-12">{fToT(end)}</span>
                      </div>
                      <div className={`px-4 py-1.5 rounded-xl font-black text-sm min-w-[70px] text-center border ${color.border} ${color.bg} ${color.text}`}>{(end - start).toFixed(1)}h</div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* 🚀 固定アクションバー */}
      <div className="fixed bottom-0 left-0 right-0 p-6 pb-12 bg-white/80 backdrop-blur-3xl md:left-64 border-t border-gray-100 flex justify-center z-50 gap-4 shadow-[0_-20px_50px_rgba(0,0,0,0.1)]">
        <button onClick={handleSave} disabled={isSaving} className="flex-1 max-w-[150px] bg-gray-100 text-gray-600 py-4 rounded-3xl font-black hover:bg-gray-200 transition-all flex items-center justify-center gap-2 active:scale-95">
          <Save size={18} /> {isSaving ? '...' : '保存'}
        </button>
        <button className="flex-[2] max-w-lg bg-gray-900 text-white py-4 rounded-3xl font-black text-lg shadow-2xl shadow-orange-200 hover:bg-orange-600 transition-all flex items-center justify-center gap-3 active:scale-95 group">
          <Rocket size={22} className="group-hover:animate-bounce" /> シフトをAI生成
        </button>
      </div>
    </div>
  );
}

function TabButton({ id, label, active, onClick, color = "gray" }: any) {
  const isActive = active === id;
  const activeClass = color === "orange" ? "bg-orange-500 text-white shadow-orange-200" : "bg-gray-900 text-white shadow-gray-200";
  return (
    <button onClick={() => onClick(id)} className={`px-8 py-3 rounded-2xl font-black text-[11px] transition-all whitespace-nowrap border-2 ${isActive ? `${activeClass} border-transparent shadow-lg scale-105 z-10` : "bg-white text-gray-400 border-gray-100 hover:border-gray-300"}`}>{label}</button>
  );
}