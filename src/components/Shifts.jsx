import { useEffect, useState, useMemo } from 'react';
import { useData } from '../context/DataContext';

export default function Shifts () {
    const { sales } = useData();

    const [selectedDate, setSelectedDate] = useState(() => {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    });

    useEffect(() => {
        window.scrollTo(0, 0);
    }, []);

    // --- Logic: تحديد الوردية ---
    const getShift = (dateObj) => {
        const h = dateObj.getHours();
        if (h >= 0 && h < 8) return 2; // 12 AM -> 8 AM
        if (h >= 8 && h < 16) return 3; // 8 AM -> 4 PM
        return 1; // 4 PM -> 12 AM
    };

    // --- Logic: تصفية وحساب البيانات ---
    const { shiftCounts, shiftStats } = useMemo(() => {
        const counts = { 1: 0, 2: 0, 3: 0 };
        const stats = {};

        let rangeStart = null;
        let rangeEnd = null;

        if (selectedDate) {
            rangeStart = new Date(selectedDate);
            rangeStart.setHours(0, 0, 0, 0);

            rangeEnd = new Date(selectedDate);
            rangeEnd.setHours(23, 59, 59, 999);
        }

        sales.forEach(s => {
            const saleDate = new Date(s.date);

            if (rangeStart && rangeEnd) {
                if (saleDate < rangeStart || saleDate > rangeEnd) return;
            }

            const shift = getShift(saleDate);
            const prod = s.productName;

            counts[shift]++;

            if (!stats[prod]) stats[prod] = { 1: 0, 2: 0, 3: 0, total: 0 };
            stats[prod][shift]++;
            stats[prod].total++;
        });

        return { shiftCounts: counts, shiftStats: stats };
    }, [sales, selectedDate]);

    return (
        <div className="space-y-8 animate-fade-in pb-20 font-sans text-slate-800">

            {/* Header & Filter */}
            <div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm sticky top-4 z-20 backdrop-blur-md bg-white/95">
                <div className="flex items-center gap-3">
                    <div className="bg-indigo-50 p-3 rounded-2xl text-indigo-600 shadow-sm border border-indigo-100">
                        <i className="fa-solid fa-clock-rotate-left text-xl"></i>
                    </div>
                    <div>
                        <h2 className="text-2xl font-extrabold text-slate-800">تحليل الورديات</h2>
                        <p className="text-slate-500 text-sm font-medium">متابعة أداء المبيعات حسب التوقيت</p>
                    </div>
                </div>

                <div className="flex items-center gap-2 bg-slate-50 p-2 rounded-xl border border-slate-200">
                    <span className="text-sm font-bold text-slate-500 px-2 hidden md:inline">التاريخ:</span>

                    <input
                        type="date"
                        value={selectedDate}
                        onChange={(e) => setSelectedDate(e.target.value)}
                        className="bg-white border border-slate-300 text-slate-800 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block p-2 outline-none font-bold shadow-sm"
                    />

                    <button
                        onClick={() => {
                            const now = new Date();
                            const year = now.getFullYear();
                            const month = String(now.getMonth() + 1).padStart(2, '0');
                            const day = String(now.getDate()).padStart(2, '0');
                            setSelectedDate(`${year}-${month}-${day}`);
                        }}
                        className={`px-3 py-2 rounded-lg text-xs font-bold transition shadow-sm ${selectedDate && new Date(selectedDate).getDate() === new Date().getDate() ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'}`}
                    >
                        اليوم
                    </button>
                    <button
                        onClick={() => setSelectedDate('')}
                        className={`px-3 py-2 rounded-lg text-xs font-bold transition shadow-sm ${selectedDate === '' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'}`}
                    >
                        الكل
                    </button>
                </div>
            </div>

            {/* Shift Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

                {/* Shift 2: 12 AM - 8 AM (Night) */}
                <div className="bg-gradient-to-br from-indigo-900 to-slate-800 p-6 rounded-3xl text-white shadow-lg shadow-slate-300 relative overflow-hidden group border border-slate-700">
                    <div className="absolute top-0 right-0 -mr-8 -mt-8 w-32 h-32 bg-white/10 rounded-full blur-3xl group-hover:scale-150 transition-transform duration-500"></div>
                    <div className="relative z-10">
                        <div className="flex justify-between items-start">
                            <div>
                                <h3 className="text-lg font-bold text-indigo-100 mb-1">Shift 2 (ليلي)</h3>
                                <p dir='ltr' className="text-xs text-indigo-300 font-mono bg-black/20 w-fit px-2 py-1 rounded">12:00 AM ➔ 08:00 AM</p>
                            </div>
                            <i className="fa-solid fa-moon text-3xl text-indigo-300/50"></i>
                        </div>
                        <div className="mt-6">
                            <span className="text-5xl font-black tracking-tight">{shiftCounts[2]}</span>
                            <span className="text-sm font-medium text-indigo-200 mr-2">أوردر</span>
                        </div>
                    </div>
                </div>

                {/* Shift 3: 8 AM - 4 PM (Morning) */}
                <div className="bg-gradient-to-br from-amber-400 to-orange-500 p-6 rounded-3xl text-white shadow-lg shadow-orange-200 relative overflow-hidden group border border-orange-400">
                    <div className="absolute top-0 right-0 -mr-8 -mt-8 w-32 h-32 bg-white/20 rounded-full blur-3xl group-hover:scale-150 transition-transform duration-500"></div>
                    <div className="relative z-10">
                        <div className="flex justify-between items-start">
                            <div>
                                <h3 className="text-lg font-bold text-amber-50 mb-1">Shift 3 (صباحي)</h3>
                                <p dir='ltr' className="text-xs text-amber-100 font-mono bg-black/10 w-fit px-2 py-1 rounded">08:00 AM ➔ 04:00 PM</p>
                            </div>
                            <i className="fa-solid fa-sun text-3xl text-amber-100/50"></i>
                        </div>
                        <div className="mt-6">
                            <span className="text-5xl font-black tracking-tight">{shiftCounts[3]}</span>
                            <span className="text-sm font-medium text-amber-100 mr-2">أوردر</span>
                        </div>
                    </div>
                </div>

                {/* Shift 1: 4 PM - 12 AM (Evening) */}
                <div className="bg-gradient-to-br from-blue-600 to-indigo-600 p-6 rounded-3xl text-white shadow-lg shadow-indigo-200 relative overflow-hidden group border border-indigo-500">
                    <div className="absolute top-0 right-0 -mr-8 -mt-8 w-32 h-32 bg-white/20 rounded-full blur-3xl group-hover:scale-150 transition-transform duration-500"></div>
                    <div className="relative z-10">
                        <div className="flex justify-between items-start">
                            <div>
                                <h3 className="text-lg font-bold text-blue-100 mb-1">Shift 1 (مسائي)</h3>
                                <p dir='ltr' className="text-xs text-blue-200 font-mono bg-black/20 w-fit px-2 py-1 rounded">04:00 PM ➔ 12:00 AM</p>
                            </div>
                            <i className="fa-solid fa-cloud-moon text-3xl text-blue-300/50"></i>
                        </div>
                        <div className="mt-6">
                            <span className="text-5xl font-black tracking-tight">{shiftCounts[1]}</span>
                            <span className="text-sm font-medium text-blue-200 mr-2">أوردر</span>
                        </div>
                    </div>
                </div>

            </div>

            {/* Detailed Table */}
            <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                    <h3 className="font-bold text-slate-800 text-lg">تفاصيل المبيعات حسب المنتج</h3>
                    <span className="text-xs font-bold bg-white border border-slate-200 px-3 py-1 rounded-full text-slate-500">
                        {selectedDate ? new Date(selectedDate).toLocaleDateString('ar-EG') : 'كل الفترات'}
                    </span>
                </div>
                <div className="overflow-x-auto custom-scrollbar">
                    <table className="w-full text-sm">
                        <thead className="bg-white text-slate-500 font-bold border-b border-slate-100 uppercase text-xs tracking-wider">
                            <tr>
                                <th className="p-5 text-right">المنتج</th>
                                <th className="p-5 text-center text-indigo-800 bg-indigo-50/20">Shift 2 (ليلي)</th>
                                <th className="p-5 text-center text-orange-600 bg-orange-50/20">Shift 3 (صباحي)</th>
                                <th className="p-5 text-center text-blue-600 bg-blue-50/20">Shift 1 (مسائي)</th>
                                <th className="p-5 text-center">الإجمالي</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {Object.entries(shiftStats).length === 0 ? (
                                <tr><td colSpan="5" className="p-12 text-center text-slate-400 font-bold">لا توجد مبيعات في هذا اليوم</td></tr>
                            ) : (
                                Object.entries(shiftStats).map(([name, counts]) => (
                                    <tr key={name} className="hover:bg-slate-50 transition duration-150">
                                        <td className="p-5 font-bold text-slate-700 flex items-center gap-3">
                                            <div className="w-2.5 h-2.5 rounded-full bg-slate-300"></div>
                                            {name}
                                        </td>
                                        <td className="p-5 text-center font-bold text-indigo-900 bg-indigo-50/10 border-x border-slate-50 text-base">{counts[2] || '-'}</td>
                                        <td className="p-5 text-center font-bold text-orange-700 bg-orange-50/10 border-l border-slate-50 text-base">{counts[3] || '-'}</td>
                                        <td className="p-5 text-center font-bold text-blue-700 bg-blue-50/10 border-l border-slate-50 text-base">{counts[1] || '-'}</td>
                                        <td className="p-5 text-center font-black text-slate-800 text-lg bg-slate-50/30">{counts.total}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                        {Object.entries(shiftStats).length > 0 && (
                            <tfoot className="bg-slate-50 font-bold text-slate-800 border-t border-slate-200">
                                <tr>
                                    <td className="p-5 text-right">الإجمالي الكلي</td>
                                    <td className="p-5 text-center text-indigo-900">{shiftCounts[2]}</td>
                                    <td className="p-5 text-center text-orange-700">{shiftCounts[3]}</td>
                                    <td className="p-5 text-center text-blue-700">{shiftCounts[1]}</td>
                                    <td className="p-5 text-center text-xl">{shiftCounts[1] + shiftCounts[2] + shiftCounts[3]}</td>
                                </tr>
                            </tfoot>
                        )}
                    </table>
                </div>
            </div>

            <style>{`
                .animate-fade-in { animation: fadeIn 0.4s ease-out forwards; }
                @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
            `}</style>
        </div>
    );
}