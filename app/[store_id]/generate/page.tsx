'use client'

import { useEffect, useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { useParams } from 'next/navigation'
import { Calendar as CalendarIcon, Save, Rocket, ChevronLeft, ChevronRight } from 'lucide-react'

// --- ユーティリティ関数 ---
const tToF = (t: string | undefined) => {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return h + m / 60;
};

const fToT = (f: number) => {
  const h = Math.floor(f);
  const m = Math.round((f % 1) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

// 役職ごとの無限ループ用色定義
const ROLE_COLORS = [
  { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', bar: 'bg-orange-500', thumb: 'border-orange-600' },
  { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', bar: 'bg-emerald-500', thumb: 'border-emerald-600' },
  { bg: 'bg-sky-50', text: 'text-sky-700', border: 'border-sky-200', bar: 'bg-sky-500', thumb: 'border-sky-600' },
  { bg: 'bg-violet-50', text: 'text-violet-700', border: 'border-violet-200', bar: 'bg-violet-500', thumb: 'border-violet-600' },
  { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200', bar: 'bg-rose-500', thumb: 'border-rose-600' },
  { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', bar: 'bg-amber-500', thumb: 'border-amber-600' },
];

// 2026年 祝日データ
const HOLIDAYS_2026: { [key: string]: string } = {
  "2026-01-01": "元日", "2026-01-12": "成人の日", "2026-02-11": "建国記念の日", "2026-02-23": "天皇誕生日",
  "2026-03-20": "春分の日", "2026-04-29": "昭和の日", "2026-05-03": "憲法記念日", "2026-05-04": "みどりの日",
  "2026-05-05": "こどもの日", "2026-05-06": "振替休日", "2026-07-20": "海の日", "2026-08-11": "山の日",
  "2026-09-21": "敬老の日", "2026-09-22": "国民の休日", "2026-09-23": "秋分の日", "2026-10-12": "スポーツの日",
  "2026-11-03": "文化の日", "2026-11-23": "勤労感謝の日"
};

export default function GeneratePage() {
  const { store_id } = useParams();
  const [storeInfo, setStoreInfo] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<string>('wd'); 
  const [selectedSpecialDays, setSelectedSpecialDays] = useState<string[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [slots, setSlots] = useState<Record<string, { start: number; end: number }>>({});

  // 🗓 今日から「来月」の年月を自動計算
  const { targetYear, targetMonth } = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    return { targetYear: d.getFullYear(), targetMonth: d.getMonth() + 1 };
  }, []);

  const minTime = useMemo(() => tToF(storeInfo?.open_time || "10:00"), [storeInfo]);
  const maxTime = useMemo(() => tToF(storeInfo?.close_time || "24:00"), [storeInfo]);
  const groups = useMemo(() => storeInfo?.group_options?.split(',') || [], [storeInfo]);

  useEffect(() => {
    const loadSettings = async () => {
      const { data } = await supabase.from('stores').select('*').eq('store_id', store_id).single();
      if (data) {
        setStoreInfo(data);
        const storeGroups = data.group_options?.split(',') || [];
        
        if (data.last_settings) {
          setCounts(data.last_settings.counts || {});
          setSlots(data.last_settings.slots || {});
          setSelectedSpecialDays(data.last_settings.specialDays || []);
        } else {
          // ★ 初期デフォルト設定：全グループ6人、10:00-18:00
          const initialCounts: any = {};
          const initialSlots: any = {};
          ['wd', 'we'].forEach(t => {
            storeGroups.forEach((g: string) => {
              initialCounts[`${t}_${g}`] = 6;
              for (let i = 0; i < 6; i++) {
                initialSlots[`${t}_${g}_${i}`] = { start: 10, end: 18 };
              }
            });
          });
          setCounts(initialCounts);
          setSlots(initialSlots);
        }
      }
    };
    loadSettings();
  }, [store_id]);

  // 新しく特定日を追加した際にデフォルトをセットする処理
  useEffect(() => {
    selectedSpecialDays.forEach(date => {
      groups.forEach((group: string) => {
        const key = `${date}_${group}`;
        if (counts[key] === undefined) {
          setCounts(prev => ({ ...prev, [key]: 6 }));
          for (let i = 0; i < 6; i++) {
            const id = `${key}_${i}`;
            if (!slots[id]) setSlots(prev => ({ ...prev, [id]: { start: 10, end: 18 } }));
          }
        }
      });
    });
  }, [selectedSpecialDays, groups]);

  const changeCount = (key: string, delta: number) => {
    setCounts((prev: any) => ({ ...prev, [key]: Math.max(0, (prev[key] || 0) + delta) }));
  };

  const updateTime = (id: string, type: 'start' | 'end', val: number) => {
    setSlots((prev: any) => {
      const current = prev[id] || { start: 10, end: 18 };
      let { start, end } = current;
      if (type === 'start') start = Math.min(val, end - 0.5);
      if (type === 'end') end = Math.max(val, start + 0.5);
      return { ...prev, [id]: { start, end } };
    });
  };

  const handleSave = async () => {
    const { error } = await supabase.from('stores').update({
      last_settings: { counts, slots, specialDays: selectedSpecialDays }
    }).eq('store_id', store_id);
    if (error) alert('保存失敗: ' + error.message);
    else alert('設定を保存しました！');
  };

  const daysInMonth = new Date(targetYear, targetMonth, 0).getDate();
  const firstDay = new Date(targetYear, targetMonth - 1, 1).getDay();

  const totalMH = useMemo(() => {
    let total = 0;
    groups.forEach((group: string) => {
      const count = counts[`${activeTab}_${group}`] || 0;
      for (let i = 0; i < count; i++) {
        const slot = slots[`${activeTab}_${group}_${i}`] || { start: 10, end: 18 };
        total += (slot.end - slot.start);
      }
    });
    return total;
  }, [activeTab, counts, slots, groups]);

  if (!storeInfo) return <div className="p-10 text-gray-400">Loading...</div>;

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-8 pb-60"> {/* 下部の余白を大きく追加 */}
      
      {/* 1. 特定日選択カレンダー */}
      <section className="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100 mb-8 overflow-hidden">
        <h3 className="text-lg font-black mb-4 flex items-center gap-2">
          <CalendarIcon className="text-orange-500" size={20} /> {targetMonth}月の特定日設定
        </h3>
        <div className="grid grid-cols-7 gap-1 md:gap-2 max-w-sm mx-auto">
          {['日','月','火','水','木','金','土'].map((d, i) => (
            <div key={d} className={`text-center text-[10px] font-black ${i===0?'text-red-400':i===6?'text-blue-400':'text-gray-300'}`}>{d}</div>
          ))}
          {Array(firstDay).fill(0).map((_, i) => <div key={`e-${i}`} />)}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const dateStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const holidayName = HOLIDAYS_2026[dateStr];
            const weekDay = new Date(targetYear, targetMonth - 1, day).getDay();
            const isSelected = selectedSpecialDays.includes(dateStr);

            return (
              <button
                key={day}
                onClick={() => setSelectedSpecialDays(prev => isSelected ? prev.filter(d => d !== dateStr) : [...prev, dateStr])}
                className={`group relative h-12 rounded-xl flex flex-col items-center justify-center transition-all ${
                  isSelected ? 'bg-orange-500 text-white shadow-lg scale-105 z-10' : 'bg-gray-50 hover:bg-orange-50'
                }`}
              >
                <span className={`text-sm font-bold ${
                    !isSelected && (weekDay === 0 || holidayName) ? 'text-red-500' : 
                    !isSelected && weekDay === 6 ? 'text-blue-500' : ''
                }`}>{day}</span>
                {holidayName && <span className={`absolute bottom-1 text-[6px] truncate w-full text-center px-0.5 font-bold ${isSelected ? 'text-orange-200' : 'text-red-400'}`}>{holidayName}</span>}
              </button>
            );
          })}
        </div>
      </section>

      {/* 2. タブ切り替え */}
      <div className="flex gap-2 overflow-x-auto pb-6 no-scrollbar sticky top-0 bg-gray-50/80 backdrop-blur-md z-30 pt-2">
        <TabBtn id="wd" label="🚃 平日" active={activeTab} onClick={setActiveTab} />
        <TabBtn id="we" label="🌞 金土日祝" active={activeTab} onClick={setActiveTab} />
        {selectedSpecialDays.sort().map(date => (
          <TabBtn key={date} id={date} label={`⭐ ${parseInt(date.split('-')[2])}日`} active={activeTab} onClick={setActiveTab} color="orange" />
        ))}
      </div>

      {/* 3. 設定メイン */}
      <div className="space-y-12 animate-in fade-in duration-500" key={activeTab}>
        
        {/* 現在の人時表示 */}
        <div className="flex justify-end px-2">
          <div className="bg-white px-6 py-3 rounded-2xl shadow-sm border border-orange-100 flex items-baseline gap-2">
            <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Selected Tab Jinji</span>
            <span className={`text-2xl font-black ${totalMH > storeInfo.target_mh_per_day ? 'text-red-500' : 'text-orange-500'}`}>{totalMH.toFixed(1)}</span>
            <span className="text-gray-300 text-sm font-bold">/ {storeInfo.target_mh_per_day}h</span>
          </div>
        </div>

        {groups.map((group: string, gIdx: number) => {
          const color = ROLE_COLORS[gIdx % ROLE_COLORS.length];
          const countKey = `${activeTab}_${group}`;
          const currentCount = counts[countKey] || 0;

          return (
            <div key={group} className="space-y-4">
              {/* グループ見出し & 人数操作 */}
              <div className={`flex items-center justify-between p-4 rounded-3xl ${color.bg} border-2 ${color.border}`}>
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-8 rounded-full ${color.bar}`}></div>
                  <h4 className={`text-lg font-black ${color.text}`}>{group}</h4>
                </div>
                <div className="flex items-center gap-4 bg-white/50 p-1 rounded-2xl">
                  <button onClick={() => changeCount(countKey, -1)} className="w-10 h-10 rounded-xl bg-white text-gray-400 hover:text-red-500 shadow-sm transition-all">－</button>
                  <span className={`text-2xl font-black w-10 text-center ${color.text}`}>{currentCount}</span>
                  <button onClick={() => changeCount(countKey, 1)} className="w-10 h-10 rounded-xl bg-white text-gray-400 hover:text-orange-600 shadow-sm transition-all">＋</button>
                </div>
              </div>

              {/* このグループのスライダー群 */}
              <div className="grid grid-cols-1 gap-3">
                {Array.from({ length: currentCount }).map((_, i) => {
                  const slotId = `${activeTab}_${group}_${i}`;
                  const { start, end } = slots[slotId] || { start: 10, end: 18 };
                  return (
                    <div key={slotId} className={`p-4 md:p-5 rounded-2xl shadow-sm border bg-white ${color.border} flex flex-col md:flex-row md:items-center gap-4 transition-all hover:shadow-md`}>
                      <div className={`w-24 font-black text-[10px] uppercase tracking-wider ${color.text}`}>{group}{i + 1}人目</div>
                      
                      <div className="flex-1 flex items-center gap-4">
                        <span className="text-[11px] font-mono font-bold text-gray-400 w-12 text-right">{fToT(start)}</span>
                        <div className="relative flex-1 h-8 flex items-center">
                          <div className="absolute w-full h-1.5 bg-gray-100 rounded-full"></div>
                          <div 
                            className={`absolute h-1.5 ${color.bar} rounded-full transition-all`}
                            style={{ 
                              left: `${((start - minTime) / (maxTime - minTime)) * 100}%`, 
                              width: `${((end - start) / (maxTime - minTime)) * 100}%` 
                            }}
                          ></div>
                          <input 
                            type="range" min={minTime} max={maxTime} step="0.5" value={start}
                            onChange={(e) => updateTime(slotId, 'start', parseFloat(e.target.value))}
                            className={`absolute w-full appearance-none bg-transparent pointer-events-none z-20 [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-4 ${color.thumb} [&::-webkit-slider-thumb]:shadow-xl`}
                          />
                          <input 
                            type="range" min={minTime} max={maxTime} step="0.5" value={end}
                            onChange={(e) => updateTime(slotId, 'end', parseFloat(e.target.value))}
                            className={`absolute w-full appearance-none bg-transparent pointer-events-none z-20 [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-4 ${color.thumb} [&::-webkit-slider-thumb]:shadow-xl`}
                          />
                        </div>
                        <span className="text-[11px] font-mono font-bold text-gray-400 w-12">{fToT(end)}</span>
                      </div>
                      <div className={`px-4 py-1.5 rounded-xl font-black text-xs min-w-[70px] text-center border-2 ${color.border} ${color.bg} ${color.text}`}>
                        {(end - start).toFixed(1)}<span className="text-[10px] ml-0.5">h</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* 固定フッター */}
      <div className="fixed bottom-0 left-0 right-0 p-6 bg-white/90 backdrop-blur-xl md:left-64 border-t border-gray-100 flex justify-center z-50 gap-4 shadow-[0_-10px_40px_rgba(0,0,0,0.05)]">
        <button onClick={handleSave} className="flex-1 max-w-[200px] bg-gray-100 text-gray-600 py-4 rounded-2xl font-bold hover:bg-gray-200 transition-all flex items-center justify-center gap-2 active:scale-95">
          <Save size={18} /> 保存
        </button>
        <button className="flex-[2] max-w-md bg-gray-900 text-white py-4 rounded-2xl font-black text-lg shadow-2xl shadow-orange-200 hover:bg-orange-600 transition-all flex items-center justify-center gap-3 active:scale-95">
          <Rocket size={20} /> シフト案を生成
        </button>
      </div>
    </div>
  );
}

function TabBtn({ id, label, active, onClick, color = "gray" }: any) {
  const isActive = active === id;
  const activeClass = color === "orange" ? "bg-orange-500 text-white" : "bg-gray-800 text-white";
  return (
    <button
      onClick={() => onClick(id)}
      className={`px-6 py-3 rounded-2xl font-bold text-xs transition-all whitespace-nowrap shadow-sm border-2 ${
        isActive ? `${activeClass} border-transparent scale-105 shadow-md` : "bg-white text-gray-400 border-gray-100 hover:border-gray-200"
      }`}
    >
      {label}
    </button>
  );
}