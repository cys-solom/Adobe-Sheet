import { useState, useMemo, useEffect } from 'react';
import { useData } from '../context/DataContext';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    BarElement,
    ArcElement,
    Title,
    Tooltip,
    Legend,
} from 'chart.js';
import { Line, Bar, Doughnut } from 'react-chartjs-2';

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    BarElement,
    ArcElement,
    Title,
    Tooltip,
    Legend
);

export default function Reports () {
    useEffect(() => {
        window.scrollTo(0, 0);
    }, []);

    const { sales, expenses, products } = useData();

    const [selectedProduct, setSelectedProduct] = useState(null);

    // Line Chart Data
    const monthlyData = useMemo(() => {
        const dataMap = {};
        sales.forEach(sale => {
            const date = new Date(sale.date);
            const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            if (!dataMap[key]) dataMap[key] = { revenue: 0, expense: 0 };
            dataMap[key].revenue += Number(sale.finalPrice || sale.sellingPrice || 0);
        });
        expenses.forEach(exp => {
            const date = new Date(exp.date);
            const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            if (!dataMap[key]) dataMap[key] = { revenue: 0, expense: 0 };
            dataMap[key].expense += Number(exp.amount);
        });
        const sortedKeys = Object.keys(dataMap).sort();
        return {
            labels: sortedKeys,
            datasets: [
                { label: 'الدخل', data: sortedKeys.map(k => dataMap[k].revenue), borderColor: '#4f46e5', backgroundColor: 'rgba(79, 70, 229, 0.5)', tension: 0.3 },
                { label: 'المصروفات', data: sortedKeys.map(k => dataMap[k].expense), borderColor: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.5)', tension: 0.3 },
                { label: 'صافي الربح', data: sortedKeys.map(k => dataMap[k].revenue - dataMap[k].expense), borderColor: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.5)', tension: 0.3 }
            ]
        };
    }, [sales, expenses]);

    // Bar Chart Data
    const productProfitData = useMemo(() => {
        const profitMap = {};
        sales.forEach(sale => {
            const profit = Number(sale.finalPrice || sale.sellingPrice || 0);
            profitMap[sale.productName] = (profitMap[sale.productName] || 0) + profit;
        });
        const sortedProducts = Object.entries(profitMap).sort((a, b) => b[1] - a[1]).slice(0, 10);
        return {
            labels: sortedProducts.map(p => p[0]),
            datasets: [{ label: 'الإيرادات', data: sortedProducts.map(p => p[1]), backgroundColor: 'rgba(99, 102, 241, 0.8)', borderRadius: 4 }]
        };
    }, [sales]);

    // Doughnut Chart Data
    const expensesTypeData = useMemo(() => {
        const typeMap = {};
        expenses.forEach(exp => {
            const type = exp.type || 'أخرى';
            typeMap[type] = (typeMap[type] || 0) + Number(exp.amount);
        });
        return {
            labels: Object.keys(typeMap),
            datasets: [{
                data: Object.values(typeMap),
                backgroundColor: ['#ef4444', '#3b82f6', '#f59e0b', '#10b981', '#8b5cf6'],
                borderWidth: 0,
            }]
        };
    }, [expenses]);

    // تحليل البرامج للشبكة
    const productsSummary = useMemo(() => {
        if (!products || products.length === 0) return [];
        return products.map(product => {
            const productSales = sales.filter(s => s.productName === product.name);
            const revenue = productSales.reduce((sum, s) => sum + Number(s.finalPrice || s.sellingPrice || 0), 0);
            const count = productSales.length;

            return {
                id: product.id,
                name: product.name,
                count,
                revenue,
                profit: revenue
            };
        }).sort((a, b) => b.count - a.count);
    }, [products, sales]);

    return (
        <div className="space-y-8 animate-fade-in pb-20 font-sans">

            {/* --- Header --- */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                <div className="flex items-center gap-3">
                    <div className="bg-indigo-50 p-3 rounded-xl text-indigo-600 border border-indigo-100"><i className="fa-solid fa-chart-line text-xl"></i></div>
                    <div>
                        <h2 className="text-2xl font-extrabold text-slate-800">التقارير</h2>
                        <p className="text-slate-500 text-sm font-medium mt-0.5">تحليل شامل للأداء والمبيعات</p>
                    </div>
                </div>
            </div>

            {/* --- تحليل البرامج --- */}
            <div>
                <h3 className="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2">
                    <i className="fa-solid fa-layer-group text-indigo-500"></i>
                    تحليل البرامج (الأكثر طلباً)
                </h3>

                {productsSummary.length === 0 ? (
                    <div className="bg-white rounded-2xl border-2 border-dashed border-slate-200 p-16 text-center text-slate-400">
                        <i className="fa-solid fa-chart-bar text-5xl mb-4 block opacity-30"></i>
                        <p className="font-bold text-lg">لا توجد بيانات بعد</p>
                        <p className="text-sm mt-1">أضف منتجات ومبيعات لعرض التقارير</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {productsSummary.map(prod => (
                            <div
                                key={prod.id}
                                onClick={() => setSelectedProduct(prod.name)}
                                className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm hover:shadow-lg hover:border-indigo-200 hover:-translate-y-1 cursor-pointer transition-all duration-300 group relative overflow-hidden"
                            >
                                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 to-purple-500 transform origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300"></div>

                                <div className="flex justify-between items-center mb-6">
                                    <div className="flex items-center gap-4">
                                        <div className="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold text-lg border border-indigo-100 shadow-sm group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                                            {prod.name.charAt(0).toUpperCase()}
                                        </div>
                                        <h4 className="font-bold text-slate-700 text-lg group-hover:text-indigo-700 transition-colors">{prod.name}</h4>
                                    </div>
                                    <div className="bg-slate-50 w-8 h-8 rounded-full flex items-center justify-center text-slate-400 group-hover:bg-white group-hover:text-indigo-500 group-hover:shadow transition-all">
                                        <i className="fa-solid fa-arrow-left text-sm transform group-hover:-translate-x-1 transition-transform"></i>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-4 text-center">
                                    <div>
                                        <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1 tracking-wider">العمليات</span>
                                        <span className="text-xl font-black text-slate-800">{prod.count}</span>
                                    </div>
                                    <div>
                                        <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1 tracking-wider">الإيرادات</span>
                                        <span className="text-sm font-bold text-emerald-600 dir-ltr bg-emerald-50 px-2 py-0.5 rounded">{Number(prod.revenue).toLocaleString()}</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <hr className="border-slate-200 border-dashed" />

            {/* --- الرسوم البيانية --- */}
            {sales.length > 0 && (
                <>
                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-lg font-bold text-slate-800 border-r-4 border-indigo-500 pr-3">الأداء المالي الشهري</h3>
                            <div className="flex gap-2">
                                <span className="flex items-center gap-1 text-xs text-slate-500"><span className="w-2 h-2 rounded-full bg-indigo-500"></span> دخل</span>
                                <span className="flex items-center gap-1 text-xs text-slate-500"><span className="w-2 h-2 rounded-full bg-red-500"></span> صرف</span>
                            </div>
                        </div>
                        <div className="h-80"><Line data={monthlyData} options={{ responsive: true, maintainAspectRatio: false, scales: { y: { grid: { borderDash: [2, 4], color: '#f1f5f9' } }, x: { grid: { display: false } } }, plugins: { legend: { display: false } } }} /></div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
                            <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2"><i className="fa-solid fa-ranking-star text-amber-500"></i> أكثر المنتجات إيراداً</h3>
                            <div className="h-64"><Bar data={productProfitData} options={{ indexAxis: 'y', responsive: true, maintainAspectRatio: false, scales: { x: { grid: { display: false } }, y: { grid: { display: false } } }, plugins: { legend: { display: false } } }} /></div>
                        </div>
                        {expenses.length > 0 && (
                            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
                                <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2"><i className="fa-solid fa-wallet text-red-500"></i> توزيع المصروفات</h3>
                                <div className="h-64 flex justify-center relative">
                                    <Doughnut data={expensesTypeData} options={{ responsive: true, maintainAspectRatio: false, cutout: '70%', plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, font: { size: 10 } } } } }} />
                                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                        <span className="text-xs font-bold text-slate-400">المصروفات</span>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </>
            )}

            {/* --- المودال التفصيلي --- */}
            {selectedProduct && (
                <ProductAnalysisModal
                    productName={selectedProduct}
                    sales={sales}
                    onClose={() => setSelectedProduct(null)}
                />
            )}

            <style>{`
                .animate-fade-in { animation: fadeIn 0.4s ease-out forwards; }
                @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
            `}</style>
        </div>
    );
}

// --- مكون المودال (التحليل التفصيلي) ---
const ProductAnalysisModal = ({ productName, sales, onClose }) => {
    const [dateRange, setDateRange] = useState({ start: '', end: '' });

    const filteredData = useMemo(() => {
        return sales.filter(s => {
            if (s.productName !== productName) return false;
            if (dateRange.start && new Date(s.date) < new Date(dateRange.start)) return false;
            if (dateRange.end) {
                const end = new Date(dateRange.end);
                end.setHours(23, 59, 59);
                if (new Date(s.date) > end) return false;
            }
            return true;
        });
    }, [sales, productName, dateRange]);

    const stats = useMemo(() => {
        const count = filteredData.length;
        const revenue = filteredData.reduce((sum, s) => sum + Number(s.finalPrice || s.sellingPrice || 0), 0);
        const paid = filteredData.filter(s => s.isPaid).length;
        const unpaid = count - paid;
        return { count, revenue, paid, unpaid };
    }, [filteredData]);

    // تحليل المدد
    const durationStats = useMemo(() => {
        const stats = {};
        filteredData.forEach(s => {
            const duration = s.duration ? `${s.duration} يوم` : (s.subscription || 'غير محدد');
            if (!stats[duration]) stats[duration] = { name: duration, count: 0, revenue: 0 };
            stats[duration].count++;
            stats[duration].revenue += Number(s.finalPrice || s.sellingPrice || 0);
        });
        return Object.values(stats).sort((a, b) => b.count - a.count);
    }, [filteredData]);

    return (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
            <div className="bg-white rounded-3xl w-full max-w-4xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden transform transition-all scale-100">

                <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-white">
                    <div className="flex items-center gap-4">
                        <div className="bg-gradient-to-br from-indigo-500 to-purple-600 text-white w-12 h-12 rounded-xl flex items-center justify-center text-xl font-bold shadow-lg shadow-indigo-200">
                            {productName.charAt(0).toUpperCase()}
                        </div>
                        <div>
                            <h2 className="text-xl font-extrabold text-slate-800">تقرير {productName}</h2>
                            <p className="text-xs text-slate-500 font-medium">تحليل المبيعات المفصل</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="bg-slate-50 text-slate-400 hover:text-slate-600 hover:bg-slate-100 p-2 rounded-full transition"><i className="fa-solid fa-xmark text-lg"></i></button>
                </div>

                <div className="p-8 overflow-y-auto custom-scrollbar bg-slate-50/50">

                    <div className="bg-white border border-slate-200 p-5 rounded-2xl mb-6 shadow-sm flex flex-col md:flex-row gap-4 items-end">
                        <div className="flex-1 w-full"><label className="block text-xs font-bold text-slate-500 mb-1.5 ml-1">من تاريخ</label><input type="date" className="form-input w-full bg-slate-50 border-slate-200 rounded-xl p-2.5 text-sm font-bold outline-none" value={dateRange.start} onChange={e => setDateRange({ ...dateRange, start: e.target.value })} /></div>
                        <div className="flex-1 w-full"><label className="block text-xs font-bold text-slate-500 mb-1.5 ml-1">إلى تاريخ</label><input type="date" className="form-input w-full bg-slate-50 border-slate-200 rounded-xl p-2.5 text-sm font-bold outline-none" value={dateRange.end} onChange={e => setDateRange({ ...dateRange, end: e.target.value })} /></div>
                        <button onClick={() => { setDateRange({ start: '', end: '' }); }} className="bg-white border border-slate-200 text-slate-500 px-4 py-2.5 rounded-xl hover:bg-slate-50 hover:text-slate-700 transition shadow-sm h-[42px]"><i className="fa-solid fa-rotate-right"></i></button>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                        <div className="bg-white p-5 rounded-2xl border border-indigo-100 shadow-sm relative overflow-hidden group">
                            <div className="absolute top-0 right-0 w-16 h-16 bg-indigo-50 rounded-bl-full -mr-8 -mt-8 transition-transform group-hover:scale-110"></div>
                            <span className="text-xs text-indigo-500 font-bold block mb-1 uppercase tracking-wider relative z-10">العدد</span>
                            <span className="text-3xl font-black text-slate-800 relative z-10">{stats.count}</span>
                        </div>
                        <div className="bg-white p-5 rounded-2xl border border-emerald-100 shadow-sm relative overflow-hidden group">
                            <div className="absolute top-0 right-0 w-16 h-16 bg-emerald-50 rounded-bl-full -mr-8 -mt-8 transition-transform group-hover:scale-110"></div>
                            <span className="text-xs text-emerald-600 font-bold block mb-1 uppercase tracking-wider relative z-10">الإيرادات</span>
                            <span className="text-2xl font-black text-slate-800 dir-ltr relative z-10">{stats.revenue.toLocaleString()}</span>
                        </div>
                        <div className="bg-white p-5 rounded-2xl border border-blue-100 shadow-sm relative overflow-hidden group">
                            <div className="absolute top-0 right-0 w-16 h-16 bg-blue-50 rounded-bl-full -mr-8 -mt-8 transition-transform group-hover:scale-110"></div>
                            <span className="text-xs text-blue-600 font-bold block mb-1 uppercase tracking-wider relative z-10">مدفوع</span>
                            <span className="text-2xl font-black text-emerald-600 relative z-10">{stats.paid}</span>
                        </div>
                        <div className="bg-white p-5 rounded-2xl border border-red-100 shadow-sm relative overflow-hidden group">
                            <div className="absolute top-0 right-0 w-16 h-16 bg-red-50 rounded-bl-full -mr-8 -mt-8 transition-transform group-hover:scale-110"></div>
                            <span className="text-xs text-red-600 font-bold block mb-1 uppercase tracking-wider relative z-10">غير مدفوع</span>
                            <span className="text-2xl font-black text-red-600 relative z-10">{stats.unpaid}</span>
                        </div>
                    </div>

                    {/* تفاصيل مدد الاشتراكات */}
                    <div className="mb-6">
                        <h4 className="font-bold text-slate-700 mb-3 text-sm flex items-center gap-2">
                            <i className="fa-solid fa-chart-pie text-indigo-500"></i> تفاصيل مدد الاشتراكات
                        </h4>
                        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                            <table className="w-full text-xs text-right">
                                <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-100">
                                    <tr>
                                        <th className="p-3">المدة</th>
                                        <th className="p-3 text-center">العدد</th>
                                        <th className="p-3 text-center">الإيرادات</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {durationStats.map((item, idx) => (
                                        <tr key={idx} className="hover:bg-slate-50 transition-colors">
                                            <td className="p-3 font-bold text-slate-700">{item.name}</td>
                                            <td className="p-3 text-center font-bold text-indigo-700">{item.count}</td>
                                            <td className="p-3 text-center font-bold text-emerald-700">{item.revenue.toLocaleString()}</td>
                                        </tr>
                                    ))}
                                    {durationStats.length === 0 && (
                                        <tr><td colSpan="3" className="p-4 text-center text-slate-400">لا توجد بيانات</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                        <table className="w-full text-sm text-right">
                            <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-100">
                                <tr><th className="p-4">التاريخ</th><th className="p-4">العميل</th><th className="p-4">الحالة</th><th className="p-4">السعر</th></tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {filteredData.length === 0 ? (
                                    <tr><td colSpan="4" className="p-8 text-center text-slate-400">لا توجد مبيعات تطابق الفلتر</td></tr>
                                ) : (
                                    filteredData.map(s => (
                                        <tr key={s.id} className="hover:bg-slate-50/80 transition-colors">
                                            <td className="p-4 font-mono text-slate-500 text-xs">{new Date(s.date).toLocaleDateString('en-GB')}</td>
                                            <td className="p-4 font-bold text-slate-700">{s.customerEmail || s.customerName || '-'}</td>
                                            <td className="p-4"><span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold ${s.isPaid ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-500/20' : 'bg-red-50 text-red-700 ring-1 ring-red-500/20'}`}>{s.isPaid ? 'مدفوع' : 'غير مدفوع'}</span></td>
                                            <td className="p-4 font-bold dir-ltr text-slate-800">{Number(s.finalPrice || s.sellingPrice || 0).toLocaleString()}</td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>

                </div>
            </div>
        </div>
    );
}