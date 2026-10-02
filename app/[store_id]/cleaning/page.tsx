'use client'

import { useParams } from 'next/navigation'
import { ClipboardCheck } from 'lucide-react'

export default function CleaningPage() {
	const params = useParams<{ store_id: string }>()

	return (
		<div className="mx-auto max-w-5xl p-4 md:p-8">
			<header className="mb-6 border-b border-slate-200 pb-5">
				<p className="text-[10px] font-semibold uppercase text-slate-500">Cleaning record</p>
				<h1 className="mt-1 text-2xl font-semibold text-slate-900">清掃記録・チェック</h1>
				<p className="mt-1 text-sm text-slate-600">{params.store_id}店</p>
			</header>

			<section className="rounded-lg border border-slate-200 bg-white p-6 md:p-8">
				<div className="flex items-start gap-4">
					<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600">
						<ClipboardCheck size={20} />
					</div>
					<div>
						<h2 className="text-base font-semibold text-slate-900">清掃チェック表を準備しています</h2>
						<p className="mt-2 text-sm leading-6 text-slate-600">週ごとの清掃区画と担当者を記録する機能は現在準備中です。</p>
					</div>
				</div>
				<div className="mt-6 overflow-x-auto rounded-md border border-slate-200">
					<table className="w-full min-w-[560px] border-collapse text-sm">
						<thead>
							<tr className="bg-slate-50 text-slate-600">
								<th className="border border-slate-200 px-3 py-2 text-left font-medium">週</th>
								{['①区画', '②区画', '③区画', '④区画', '⑤区画', '⑥区画', '⑦区画'].map(area => (
									<th key={area} className="border border-slate-200 px-3 py-2 text-center font-medium">{area}</th>
								))}
							</tr>
						</thead>
						<tbody>
							{[1, 2, 3, 4, 5].map(week => (
								<tr key={week} className="text-slate-500">
									<th className="border border-slate-200 bg-slate-50 px-3 py-3 text-left font-medium">{week}週目</th>
									{Array.from({ length: 7 }, (_, index) => <td key={index} className="border border-slate-200 px-3 py-3 text-center">—</td>)}
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</section>
		</div>
	)
}
