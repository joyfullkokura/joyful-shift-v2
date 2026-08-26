'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useParams } from 'next/navigation'
// Excel出力用の道具をインポート
import ExcelJS from 'exceljs'
import { saveAs } from 'file-saver'

export default function RequestsPage() {
  const params = useParams()
  const storeId = params.store_id as string
  const [staff, setStaff] = useState<any[]>([])
  const [selectedStaff, setSelectedStaff] = useState<any>(null)
  
  // 個人の入力用状態
  const [requests, setRequests] = useState<{[key: string]: {is_off: boolean, memo: string}}>({})
  const [activeDate, setActiveDate] = useState<string | null>(null) 
  const [isSaving, setIsSaving] = useState(false)

  // 全体表示用の状態
  const [allRequests, setAllRequests] = useState<any[]>([])
  const [showOverview, setShowOverview] = useState(false)

  // カレンダー計算（来月分）
  const now = new Date()
  const nextMonthDate = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  const targetYear = nextMonthDate.getFullYear()
  const targetMonth = nextMonthDate.getMonth() + 1
  const daysInMonth = new Date(targetYear, targetMonth, 0).getDate()
  const firstDayOfWeek = new Date(targetYear, targetMonth - 1, 1).getDay()
  const daysArray = Array.from({ length: daysInMonth }, (_, i) => i + 1)
  const emptySlots = Array.from({ length: firstDayOfWeek }, (_, i) => i)

  // 1. スタッフ一覧と「全員分」のデータを取得
  useEffect(() => {
    const fetchInitialData = async () => {
      if (!storeId) return
      
      // スタッフ名簿取得
      const { data: staffData } = await supabase.from('staff').select('id, name').eq('store_id', storeId).order('name')
      setStaff(staffData || [])

      // 全員の来月分リクエスト取得
      const startOfMonth = `${targetYear}-${String(targetMonth).padStart(2, '0')}-01`
      const endOfMonth = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${daysInMonth}`
      
      const { data: reqData } = await supabase
        .from('shift_requests')
        .select('*')
        .eq('store_id', storeId)
        .gte('date', startOfMonth)
        .lte('date', endOfMonth)
      
      setAllRequests(reqData || [])
    }
    fetchInitialData()
  }, [storeId])

  // 2. 個人が選ばれた時の既存データ読み込み
  useEffect(() => {
    if (selectedStaff) {
      const fetchRequests = async () => {
        const startOfMonth = `${targetYear}-${String(targetMonth).padStart(2, '0')}-01`
        const endOfMonth = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${daysInMonth}`
        
        const { data } = await supabase
          .from('shift_requests')
          .select('date, is_off, memo')
          .eq('staff_id', selectedStaff.id)
          .gte('date', startOfMonth)
          .lte('date', endOfMonth)
        
        const initialRequests: any = {}
        data?.forEach(r => {
          initialRequests[r.date] = { is_off: r.is_off, memo: r.memo || "" }
        })
        setRequests(initialRequests)
      }
      fetchRequests()
    }
  }, [selectedStaff])

  // --- タップ挙動：休み切り替え ＋ 選択状態維持 ---
  const handleDateClick = (dateStr: string) => {
    setRequests(prev => {
      const current = prev[dateStr] || { is_off: false, memo: "" }
      return { ...prev, [dateStr]: { is_off: !current.is_off, memo: current.memo } }
    })
    setActiveDate(dateStr)
  }

  const updateMemo = (dateStr: string, text: string) => {
    setRequests(prev => ({ ...prev, [dateStr]: { is_off: prev[dateStr]?.is_off || false, memo: text } }))
  }

  // 保存処理
  const handleSave = async () => {
    setIsSaving(true)
    try {
      const startOfMonth = `${targetYear}-${String(targetMonth).padStart(2, '0')}-01`
      const endOfMonth = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${daysInMonth}`
      
      await supabase.from('shift_requests').delete().eq('staff_id', selectedStaff.id).gte('date', startOfMonth).lte('date', endOfMonth)

      const insertData = Object.entries(requests)
        .filter(([_, val]) => val.is_off || val.memo.trim() !== "")
        .map(([date, val]) => ({
          staff_id: selectedStaff.id, store_id: storeId, date: date, is_off: val.is_off, memo: val.memo
        }))

      if (insertData.length > 0) {
        const { error } = await supabase.from('shift_requests').insert(insertData)
        if (error) throw error
      }
      alert('保存しました！最新の一覧を確認するにはページを更新してください。')
      window.location.reload() // 全体データを再読込するためリロード
    } catch (err: any) {
      alert('保存失敗: ' + err.message)
    } finally {
      setIsSaving(false)
    }
  }

  // --- Excel出力ロジック（V1のデザイン完全再現版） ---
  const exportToExcel = async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(`${targetMonth}月休み希望`);

    // 1. データの準備（今月のスタンス/ルールを読み込む）
    const ruleSheetName = `rules_${targetYear}_${String(targetMonth).padStart(2, '0')}`;
    const { data: ruleData } = await supabase.from(ruleSheetName).select('*');
    
    // --- 2. 印刷・ページ設定 (V1の寄せた設定) ---
    worksheet.pageSetup.orientation = 'landscape'; // 横向き
    worksheet.pageSetup.paperSize = 9;             // A4
    worksheet.pageSetup.fitToPage = true;          // 1ページに収める
    worksheet.pageSetup.fitToWidth = 1;
    worksheet.pageSetup.fitToHeight = 1;
    worksheet.pageSetup.margins = { left: 0.3, right: 0.3, top: 0.3, bottom: 0.3, header: 0, footer: 0 };
    worksheet.pageSetup.horizontalCentered = true; // ページ中央

    // --- 3. スタイル定義 ---
    const borderStyle: Partial<ExcelJS.Borders> = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' }
    };

    // 4. タイトル行の作成 (1行目)
    const titleCell = worksheet.getCell('A1');
    titleCell.value = `【${targetYear}年${targetMonth}月】 休み希望・要望 一覧表`;
    titleCell.font = { bold: true, size: 18 };
    titleCell.alignment = { horizontal: 'center' };
    worksheet.mergeCells(1, 1, 1, daysArray.length + 3); // 全体をマージ
    worksheet.getRow(1).height = 30;

    // 5. ヘッダー行の作成 (3行目)
    const headerRow = worksheet.getRow(3);
    const headers = ["名前", ...daysArray.map(d => String(d)), "今月のスタンス", "休み希望数"];
    headerRow.values = headers;
    headerRow.height = 25;

    headers.forEach((h, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.font = { bold: true };
      cell.border = borderStyle;
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      
      // 基本の背景（グレー）
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };

      // 土日の色分け
      if (i > 0 && i <= daysArray.length) {
        const day = daysArray[i - 1];
        const weekDay = new Date(targetYear, targetMonth - 1, day).getDay();
        if (weekDay === 0) { // 日
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEBEE' } }; // 薄赤
          cell.font = { color: { argb: 'FFFF0000' }, bold: true };
        } else if (weekDay === 6) { // 土
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3F2FD' } }; // 薄青
          cell.font = { color: { argb: 'FF0000FF' }, bold: true };
        }
      }
    });

    // 6. スタッフごとのデータ書き込み
    staff.forEach((person, staffIdx) => {
      const currentRow = worksheet.getRow(4 + staffIdx);
      currentRow.height = 55; // V1と同じ高さに設定

      // A列: 名前
      const nameCell = currentRow.getCell(1);
      nameCell.value = person.name;
      nameCell.font = { bold: true, size: 14 };
      nameCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
      nameCell.border = borderStyle;
      nameCell.alignment = { vertical: 'middle', horizontal: 'left' };

      let offCount = 0;

      // 日付列
      daysArray.forEach((day, dayIdx) => {
        const dateStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const req = allRequests.find(r => r.staff_id === person.id && r.date === dateStr);
        const cell = currentRow.getCell(dayIdx + 2);
        
        let cellText = "";
        if (req?.is_off) {
          cellText = "×";
          offCount++;
          cell.font = { color: { argb: 'FFFF0000' }, bold: true, size: 10 };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEBEE' } };
        } else {
          cell.font = { size: 9 };
        }
        
        if (req?.memo) cellText += (cellText ? "\n" : "") + req.memo;
        
        cell.value = cellText;
        cell.border = borderStyle;
        cell.alignment = { wrapText: true, vertical: 'top', horizontal: 'center' };
      });

      // スタンス（ルール）列
      const stanceCell = currentRow.getCell(daysArray.length + 2);
      const userRule = ruleData?.find(r => r.名前 === person.name)?.ルール || "";
      stanceCell.value = userRule;
      stanceCell.font = { size: 9 };
      stanceCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } };
      stanceCell.border = borderStyle;
      stanceCell.alignment = { wrapText: true, vertical: 'middle' };

      // 休み合計列
      const countCell = currentRow.getCell(daysArray.length + 3);
      countCell.value = `${offCount}日`;
      countCell.border = borderStyle;
      countCell.alignment = { vertical: 'middle', horizontal: 'center' };
    });

    // 7. 列幅の調整
    worksheet.getColumn(1).width = 15; // 名前
    for (let i = 2; i <= daysArray.length + 1; i++) {
      worksheet.getColumn(i).width = 10; // 日付
    }
    worksheet.getColumn(daysArray.length + 2).width = 35; // スタンス
    worksheet.getColumn(daysArray.length + 3).width = 12; // 合計

    // 8. ファイル生成・保存
    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), `${targetMonth}月休み希望一覧_${storeId}.xlsx`);
  };

  // --- A. 名前選択画面 ---
  if (!selectedStaff) {
    return (
      <div className="p-8 max-w-md mx-auto min-h-screen">
        <h1 className="text-2xl font-bold mb-8 text-orange-600 text-center font-black">📅 休み希望入力</h1>
        
        <div className="grid gap-3 mb-12">
          {staff.map((p) => (
            <button key={p.id} onClick={() => setSelectedStaff(p)} className="w-full bg-white p-5 rounded-2xl shadow-sm border border-gray-100 font-bold text-gray-700 text-lg flex justify-between items-center active:scale-95 transition-all">
              {p.name}<span className="text-orange-300">→</span>
            </button>
          ))}
        </div>

        {/* 管理者用エリア */}
        <div className="pt-10 border-t border-gray-200">
          <p className="text-[10px] text-gray-400 font-bold mb-4 text-center tracking-widest uppercase">Manager Menu</p>
          <div className="grid gap-2">
            <button onClick={() => setShowOverview(!showOverview)} className="w-full bg-gray-800 text-white py-4 rounded-2xl text-sm font-bold shadow-lg active:scale-95 transition-all">
              {showOverview ? '一覧表示を閉じる' : '🔍 全員の休み状況を画面で見る'}
            </button>
            <button onClick={exportToExcel} className="w-full bg-green-600 text-white py-4 rounded-2xl text-sm font-bold shadow-lg active:scale-95 transition-all">
              📥 休み希望一覧をExcel出力
            </button>
          </div>
        </div>

        {/* 画面上の一覧表 */}
        {showOverview && (
          <div className="mt-8 overflow-x-auto bg-white p-2 rounded-2xl shadow-inner border border-gray-100">
            <table className="w-full text-[9px] border-collapse">
              <thead>
                <tr>
                  <th className="border p-1 bg-gray-50 min-w-[40px]">名前</th>
                  {daysArray.map(d => <th key={d} className="border p-1 bg-gray-50">{d}</th>)}
                </tr>
              </thead>
              <tbody>
                {staff.map(p => (
                  <tr key={p.id}>
                    <td className="border p-1 font-bold bg-gray-50">{p.name}</td>
                    {daysArray.map(day => {
                      const dateStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                      const req = allRequests.find(r => r.staff_id === p.id && r.date === dateStr)
                      return (
                        <td key={day} className={`border p-1 text-center ${req?.is_off ? 'text-red-500 font-bold' : ''}`}>
                          {req?.is_off ? '×' : req?.memo ? '●' : ''}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  // --- B. カレンダー画面（一郎さんの理想の挙動） ---
  return (
    <div className="p-4 max-w-md mx-auto pb-20">
      <div className="bg-white p-6 rounded-[2.5rem] shadow-2xl border border-orange-50">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-black text-gray-800">{targetMonth}月 <span className="font-normal text-gray-400">希望</span></h1>
            <p className="text-orange-500 font-bold text-xs">👤 {selectedStaff.name} さん</p>
          </div>
          <button onClick={() => setSelectedStaff(null)} className="text-xs bg-gray-100 text-gray-400 px-3 py-1.5 rounded-full font-bold">名前変更</button>
        </div>

        <div className="grid grid-cols-7 gap-2 mb-6">
          {['日','月','火','水','木','金','土'].map((d, i) => (
            <div key={d} className={`text-center text-[10px] font-bold ${i===0?'text-red-300':i===6?'text-blue-300':'text-gray-300'}`}>{d}</div>
          ))}
          {emptySlots.map(i => <div key={`empty-${i}`} />)}
          {daysArray.map(day => {
            const dateStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`
            const req = requests[dateStr] || { is_off: false, memo: "" }
            const isActive = activeDate === dateStr
            const weekDay = new Date(targetYear, targetMonth - 1, day).getDay()
            
            return (
              <button
                key={day}
                onClick={() => handleDateClick(dateStr)}
                className={`h-14 rounded-2xl flex flex-col items-center justify-center relative transition-all duration-200 ${
                  req.is_off 
                    ? 'bg-red-500 text-white shadow-lg shadow-red-200 z-10 scale-105' 
                    : isActive 
                      ? 'bg-orange-100 ring-2 ring-orange-500' 
                      : 'bg-gray-50 text-gray-700'
                }`}
              >
                <span className={`text-xs font-bold ${!req.is_off && !isActive && weekDay === 0 ? 'text-red-400' : !req.is_off && !isActive && weekDay === 6 ? 'text-blue-400' : ''}`}>
                  {day}
                </span>
                {req.is_off && <span className="text-[8px] font-black">休み</span>}
                {req.memo && !req.is_off && <span className="w-1.5 h-1.5 bg-orange-500 rounded-full mt-1"></span>}
              </button>
            )
          })}
        </div>

        {/* 詳細要望入力エリア */}
        {activeDate && (
          <div className="mb-6 p-4 bg-orange-50 rounded-3xl animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="flex justify-between items-center mb-2">
              <label className="text-sm font-black text-orange-700 font-sans">
                📍 {parseInt(activeDate.split('-')[2])}日の要望
              </label>
              <button onClick={() => setActiveDate(null)} className="text-[10px] bg-white/50 px-2 py-1 rounded-lg text-orange-400 font-bold">閉じる</button>
            </div>
            <textarea
              className="w-full bg-white border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-orange-400 outline-none shadow-inner"
              placeholder="例: 18時以降なら可能 / 早番希望 など"
              rows={2}
              value={requests[activeDate]?.memo || ""}
              onChange={(e) => updateMemo(activeDate, e.target.value)}
            />
          </div>
        )}

        <button onClick={handleSave} disabled={isSaving} className="w-full bg-orange-600 text-white py-5 rounded-[1.5rem] font-black shadow-xl shadow-orange-200 active:scale-95 transition-all disabled:bg-gray-200">
          {isSaving ? '保存中...' : 'この内容で確定保存'}
        </button>
      </div>
    </div>
  )
}