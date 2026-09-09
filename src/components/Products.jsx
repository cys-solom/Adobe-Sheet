import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { productsAPI, accountsAPI } from '../services/api';
import { useConfirm } from './ConfirmDialog';

export default function Products() {
    const { user, hasPermission } = useAuth();
    const { products: ctxProducts, sections: ctxSections, accounts: ctxAccounts, refreshData, reorderProducts } = useData();
    const isAdmin = user?.role === 'admin' || hasPermission('all');
    const { showConfirm, showAlert } = useConfirm();

    const [products, setProducts] = useState([]);
    const [inventorySections, setInventorySections] = useState([]);
    const [showProductModal, setShowProductModal] = useState(false);
    const [editingProduct, setEditingProduct] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('all');

    useEffect(() => {
        window.scrollTo(0, 0);
    }, []);

    useEffect(() => {
        setProducts(ctxProducts);
        setInventorySections(ctxSections);
    }, [ctxProducts, ctxSections]);

    // جمع التصنيفات
    const categories = [...new Set(products.map(p => p.category).filter(Boolean))];

    const filteredProducts = products.filter(p => {
        const matchSearch = !searchTerm || p.name.toLowerCase().includes(searchTerm.toLowerCase()) || (p.description && p.description.toLowerCase().includes(searchTerm.toLowerCase()));
        const matchCategory = categoryFilter === 'all' || p.category === categoryFilter;
        return matchSearch && matchCategory;
    });

    // المنتجات مرتبة من DataContext بالفعل
    const sortedProducts = filteredProducts;

    // حساب الإحصائيات
    const stats = {
        total: products.length,
        linked: products.filter(p => p.inventoryProduct && p.fulfillmentType === 'from_stock').length,
        categories: categories.length,
        avgPrice: products.length > 0 ? Math.round(products.reduce((sum, p) => sum + (Number(p.price) || 0), 0) / products.length) : 0,
    };

    const handleSaveProduct = async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const data = {
            name: formData.get('name').trim(),
            price: Number(formData.get('price')),
            duration: Number(formData.get('duration') || 30),
            description: formData.get('description') || '',
            category: formData.get('category') || '',
            inventoryProduct: formData.get('inventoryProduct') || '',
            fulfillmentType: formData.get('fulfillmentType') || 'client_account'
        };

        // Check for duplicate name
        const duplicate = products.find(p => p.name === data.name && (!editingProduct || p.id !== editingProduct.id));
        if (duplicate) {
            showAlert({ title: 'خطأ', message: '⚠️ يوجد منتج آخر بنفس الاسم! اختر اسم مختلف.', type: 'warning' });
            return;
        }

        try {
            if (editingProduct) {
                const oldName = editingProduct.name;
                const newName = data.name;
                await productsAPI.update(editingProduct.id, data);
                if (oldName !== newName) {
                    await productsAPI.syncNameChange(oldName, newName);
                }
            } else {
                await productsAPI.create(data);
            }
            setShowProductModal(false);
            setEditingProduct(null);
            await refreshData();
        } catch (error) {
            console.error('Product save error:', error);
            showAlert({ title: 'خطأ!', message: 'حدث خطأ أثناء الحفظ: ' + (error?.message || error?.details || 'خطأ غير معروف'), type: 'danger' });
        }
    };

    const deleteProduct = async (id) => {
        const confirmed = await showConfirm({
            title: 'حذف المنتج',
            message: 'هل أنت متأكد من حذف هذا المنتج؟',
            confirmText: 'حذف',
            cancelText: 'إلغاء',
            type: 'danger'
        });
        if (!confirmed) return;
        try {
            await productsAPI.delete(id);
            await refreshData();
        } catch (error) {
            console.error(error);
        }
    };

    const openAddProduct = () => { setEditingProduct(null); setShowProductModal(true); };
    const openEditProduct = (p) => { setEditingProduct(p); setShowProductModal(true); };

    // تحريك منتج لأعلى أو لأسفل
    const moveProduct = (productId, direction) => {
        reorderProducts(productId, direction);
    };

    // تجميع المنتجات حسب التصنيف
    const groupedProducts = sortedProducts.reduce((groups, p) => {
        const cat = p.category || 'بدون تصنيف';
        if (!groups[cat]) groups[cat] = [];
        groups[cat].push(p);
        return groups;
    }, {});

    return (
        <div className="space-y-6 animate-fade-in pb-24 font-sans text-slate-800">

            {/* Header */}
            <div className="bg-gradient-to-r from-violet-700 to-purple-600 rounded-2xl p-8 text-white relative overflow-hidden shadow-xl">
                <div className="absolute -left-10 -bottom-10 text-[150px] opacity-10"><i className="fa-solid fa-boxes-stacked"></i></div>
                <div className="relative z-10">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="bg-white/20 p-3 rounded-xl backdrop-blur-sm"><i className="fa-solid fa-boxes-stacked text-2xl"></i></div>
                        <div>
                            <h2 className="text-2xl font-extrabold">إدارة المنتجات</h2>
                            <p className="text-purple-100 text-sm font-medium">إضافة وتعديل وإدارة جميع المنتجات المتاحة</p>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-4 mt-6">
                        <div className="bg-white/15 backdrop-blur-sm rounded-2xl px-6 py-3 border border-white/20">
                            <p className="text-purple-100 text-xs font-bold mb-1">إجمالي المنتجات</p>
                            <p className="text-2xl font-black">{stats.total}</p>
                        </div>
                        <div className="bg-white/15 backdrop-blur-sm rounded-2xl px-6 py-3 border border-white/20">
                            <p className="text-purple-100 text-xs font-bold mb-1">مربوط بالمخزون</p>
                            <p className="text-2xl font-black">{stats.linked}</p>
                        </div>
                        <div className="bg-white/15 backdrop-blur-sm rounded-2xl px-6 py-3 border border-white/20">
                            <p className="text-purple-100 text-xs font-bold mb-1">التصنيفات</p>
                            <p className="text-2xl font-black">{stats.categories}</p>
                        </div>
                        <div className="bg-white/15 backdrop-blur-sm rounded-2xl px-6 py-3 border border-white/20">
                            <p className="text-purple-100 text-xs font-bold mb-1">متوسط السعر</p>
                            <p className="text-2xl font-black dir-ltr">{stats.avgPrice.toLocaleString()} <span className="text-sm opacity-80">ج.م</span></p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Toolbar */}
            <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 flex flex-col md:flex-row gap-4 items-center justify-between sticky top-2 z-30 bg-white/95 backdrop-blur-md">
                <div className="relative w-full md:w-80">
                    <i className="fa-solid fa-search absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"></i>
                    <input type="text" className="w-full bg-white border-2 border-slate-200 text-slate-900 text-sm font-semibold rounded-xl pr-10 p-3 focus:ring-4 focus:ring-purple-100 focus:border-purple-600 outline-none transition-all placeholder-slate-400" placeholder="بحث بالاسم أو الوصف..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                </div>
                <div className="flex gap-3 w-full md:w-auto">
                    {categories.length > 0 && (
                        <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className="bg-white border-2 border-slate-200 text-slate-700 text-sm font-bold rounded-xl p-3 focus:ring-4 focus:ring-purple-100 focus:border-purple-600 outline-none transition-all">
                            <option value="all">كل التصنيفات</option>
                            {categories.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    )}
                    {isAdmin && (
                        <button onClick={openAddProduct} className="bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl text-sm px-6 py-3 shadow-lg shadow-purple-200 transition-all flex items-center gap-2 whitespace-nowrap">
                            <i className="fa-solid fa-plus"></i> إضافة منتج
                        </button>
                    )}
                </div>
            </div>

            {/* Products Grid */}
            {sortedProducts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 bg-white rounded-3xl border-2 border-dashed border-slate-200 text-slate-400">
                    <i className="fa-solid fa-boxes-stacked text-5xl mb-4 opacity-30"></i>
                    <p className="font-bold text-lg">لا توجد منتجات {searchTerm ? 'تطابق البحث' : 'بعد'}</p>
                    {!searchTerm && <p className="text-sm mt-1">أضف المنتجات المتوفرة عندك ليتمكن فريقك من البيع</p>}
                </div>
            ) : (
                <div className="space-y-6">
                    {Object.entries(groupedProducts).map(([category, catProducts]) => (
                        <div key={category}>
                            {/* Category Header */}
                            <div className="flex items-center gap-3 mb-3">
                                <div className="bg-purple-100 text-purple-700 px-4 py-1.5 rounded-xl text-sm font-extrabold flex items-center gap-2 border border-purple-200">
                                    <i className="fa-solid fa-folder"></i> {category}
                                </div>
                                <span className="text-xs text-slate-400 font-bold">{catProducts.length} منتج</span>
                                <div className="flex-1 h-px bg-slate-200"></div>
                            </div>
                            {/* Products Grid */}
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                                {catProducts.map((p, idx) => (
                                    <div key={p.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all group relative overflow-hidden p-6">
                                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-purple-500 to-indigo-500 transform origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300"></div>
                                        <div className="flex justify-between items-start mb-4">
                                            <div>
                                                <h3 className="font-extrabold text-lg text-slate-800">{p.name}</h3>
                                                <div className="flex flex-wrap gap-1.5 mt-1">
                                                    {p.category && <span className="text-xs bg-purple-50 text-purple-600 px-2 py-0.5 rounded font-bold">{p.category}</span>}
                                                    <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded font-bold flex items-center gap-1">
                                                        <i className="fa-solid fa-calendar-days text-[9px]"></i> {p.duration || 30} يوم
                                                    </span>
                                                </div>
                                            </div>
                                            {isAdmin && (
                                                <div className="flex gap-1">
                                                    {/* أسهم الترتيب */}
                                                    <button onClick={() => moveProduct(p.id, 'up')} disabled={idx === 0} className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition disabled:opacity-20 disabled:cursor-not-allowed" title="تحريك لأعلى"><i className="fa-solid fa-chevron-up text-[10px]"></i></button>
                                                    <button onClick={() => moveProduct(p.id, 'down')} disabled={idx === catProducts.length - 1} className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition disabled:opacity-20 disabled:cursor-not-allowed" title="تحريك لأسفل"><i className="fa-solid fa-chevron-down text-[10px]"></i></button>
                                                    <button onClick={() => openEditProduct(p)} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition"><i className="fa-solid fa-pen text-xs"></i></button>
                                                    <button onClick={() => deleteProduct(p.id)} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition"><i className="fa-solid fa-trash text-xs"></i></button>
                                                </div>
                                            )}
                                        </div>
                                        {p.description && <p className="text-sm text-slate-500 mb-3">{p.description}</p>}
                                        <div className="mb-3">
                                            <span className="text-[10px] font-mono text-slate-400 bg-slate-50 px-2 py-0.5 rounded border border-slate-100 select-all">ID: {p.id}</span>
                                        </div>
                                        
                                        {/* Inventory link badge */}
                                        {(() => {
                                            const isLinked = p.inventoryProduct && p.fulfillmentType === 'from_stock';
                                            let stockCount = null;
                                            if (isLinked) {
                                                stockCount = ctxAccounts.filter(a => 
                                                    a.productName === p.inventoryProduct && 
                                                    a.status !== 'damaged' && a.status !== 'completed' &&
                                                    (Number(a.allowed_uses) === -1 || Number(a.current_uses) < Number(a.allowed_uses))
                                                ).length;
                                            }
                                            
                                            if (isLinked && stockCount === 0) {
                                                return (
                                                    <div className="flex items-center gap-2 mb-3 p-2.5 rounded-xl text-xs font-bold border bg-red-50 text-red-700 border-red-200">
                                                        <i className="fa-solid fa-triangle-exclamation"></i>
                                                        <span>غير متوفر بالمخزون (Out of Stock)</span>
                                                    </div>
                                                );
                                            }

                                            if (p.inventoryProduct) {
                                                return (
                                                    <div className={`flex items-center gap-2 mb-3 p-2.5 rounded-xl text-xs font-bold border ${p.fulfillmentType === 'from_stock' ? 'bg-purple-50 text-purple-700 border-purple-200' : 'bg-teal-50 text-teal-700 border-teal-200'}`}>
                                                        <i className={`fa-solid ${p.fulfillmentType === 'from_stock' ? 'fa-server' : 'fa-user-gear'}`}></i>
                                                        <span>{p.fulfillmentType === 'from_stock' ? `سحب من المخزون: ${p.inventoryProduct} (${stockCount} متاح)` : `تفعيل على حساب العميل`}</span>
                                                    </div>
                                                );
                                            }
                                            
                                            return (
                                                <div className="flex items-center gap-2 mb-3 p-2.5 rounded-xl text-xs font-bold border bg-slate-50 text-slate-400 border-slate-200">
                                                    <i className="fa-solid fa-link-slash"></i>
                                                    <span>غير مربوط بالمخزون</span>
                                                </div>
                                            );
                                        })()}

                                        <div className="flex justify-between items-center pt-3 border-t border-slate-100">
                                            <span className="text-xs text-slate-400 font-bold">السعر</span>
                                            <span className="text-2xl font-black text-slate-800 dir-ltr">{Number(p.price).toLocaleString()} <span className="text-sm text-slate-400">ج.م</span></span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* ============ PRODUCT MODAL ============ */}
            {showProductModal && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
                    <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
                        <div className="p-6 bg-gradient-to-r from-purple-600 to-indigo-700 text-white flex justify-between items-center">
                            <h3 className="text-xl font-bold flex items-center gap-2">
                                <i className={`fa-solid ${editingProduct ? 'fa-pen' : 'fa-plus-circle'}`}></i>
                                {editingProduct ? 'تعديل المنتج' : 'إضافة منتج جديد'}
                            </h3>
                            <button onClick={() => { setShowProductModal(false); setEditingProduct(null); }} className="bg-white/10 hover:bg-white/20 p-2 rounded-full transition"><i className="fa-solid fa-xmark text-lg"></i></button>
                        </div>
                        <form onSubmit={handleSaveProduct} className="p-8 space-y-5 overflow-y-auto">
                            <div>
                                <label className="block text-sm font-extrabold text-slate-800 mb-2">اسم المنتج</label>
                                <input name="name" defaultValue={editingProduct?.name} className="w-full bg-white border-2 border-slate-200 rounded-xl p-3.5 font-bold text-sm focus:ring-4 focus:ring-purple-100 focus:border-purple-600 outline-none transition-all" required placeholder="مثال: Gemini Pro" />
                            </div>
                            <div>
                                <label className="block text-sm font-extrabold text-slate-800 mb-2">السعر (ج.م)</label>
                                <input name="price" type="number" defaultValue={editingProduct?.price} className="w-full bg-white border-2 border-slate-200 rounded-xl p-3.5 font-bold text-sm focus:ring-4 focus:ring-purple-100 focus:border-purple-600 outline-none transition-all" required placeholder="0" />
                            </div>
                            <div>
                                <label className="block text-sm font-extrabold text-slate-800 mb-2">التصنيف (اختياري)</label>
                                <input name="category" defaultValue={editingProduct?.category} className="w-full bg-white border-2 border-slate-200 rounded-xl p-3.5 font-bold text-sm focus:ring-4 focus:ring-purple-100 focus:border-purple-600 outline-none transition-all" placeholder="مثال: اشتراكات AI" />
                            </div>
                            <div>
                                <label className="block text-sm font-extrabold text-slate-800 mb-2">مدة الاشتراك (بالأيام)</label>
                                <div className="grid grid-cols-4 gap-2 mb-2">
                                    {[{l:'أسبوع',v:7},{l:'شهر',v:30},{l:'3 شهور',v:90},{l:'سنة',v:365}].map(d => (
                                        <button key={d.v} type="button" onClick={(e) => { e.target.closest('form').querySelector('[name=duration]').value = d.v; }} className="py-2 px-1 rounded-xl border-2 border-slate-200 text-xs font-bold text-slate-600 hover:border-purple-400 hover:bg-purple-50 transition-all">{d.l}</button>
                                    ))}
                                </div>
                                <input name="duration" type="number" defaultValue={editingProduct?.duration || 30} className="w-full bg-white border-2 border-slate-200 rounded-xl p-3.5 font-bold text-sm focus:ring-4 focus:ring-purple-100 focus:border-purple-600 outline-none transition-all" required placeholder="30" min="1" />
                            </div>
                            <div>
                                <label className="block text-sm font-extrabold text-slate-800 mb-2">وصف (اختياري)</label>
                                <textarea name="description" defaultValue={editingProduct?.description} className="w-full bg-white border-2 border-slate-200 rounded-xl p-3.5 font-bold text-sm focus:ring-4 focus:ring-purple-100 focus:border-purple-600 outline-none transition-all h-20 resize-none" placeholder="وصف بسيط للمنتج"></textarea>
                            </div>

                            {/* ربط بالمخزون */}
                            <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200 space-y-4">
                                <div className="text-xs font-black text-purple-600 uppercase tracking-widest mb-1 flex items-center gap-1.5">
                                    <i className="fa-solid fa-link"></i> ربط بالمخزون (اختياري)
                                </div>
                                <div>
                                    <label className="block text-sm font-extrabold text-slate-800 mb-2">منتج المخزون المربوط</label>
                                    <select name="inventoryProduct" defaultValue={editingProduct?.inventoryProduct || ''} className="w-full bg-white border-2 border-slate-200 rounded-xl p-3.5 font-bold text-sm focus:ring-4 focus:ring-purple-100 focus:border-purple-600 outline-none transition-all">
                                        <option value="">بدون ربط بالمخزون</option>
                                        {inventorySections.map(sec => (
                                            <option key={sec.id} value={sec.name}>{sec.name} ({sec.type === 'codes' ? 'أكواد' : 'اكونتات'})</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-extrabold text-slate-800 mb-2">طريقة التفعيل</label>
                                    <div className="grid grid-cols-2 gap-3">
                                        <label className="flex items-center justify-center gap-2 p-3 rounded-xl border-2 cursor-pointer transition-all has-[:checked]:border-purple-500 has-[:checked]:bg-purple-50 border-slate-200 hover:border-purple-200">
                                            <input type="radio" name="fulfillmentType" value="from_stock" defaultChecked={editingProduct?.fulfillmentType === 'from_stock'} className="hidden" />
                                            <i className="fa-solid fa-server text-purple-600"></i>
                                            <span className="text-sm font-bold text-slate-700">سحب من المخزون</span>
                                        </label>
                                        <label className="flex items-center justify-center gap-2 p-3 rounded-xl border-2 cursor-pointer transition-all has-[:checked]:border-teal-500 has-[:checked]:bg-teal-50 border-slate-200 hover:border-teal-200">
                                            <input type="radio" name="fulfillmentType" value="client_account" defaultChecked={!editingProduct?.fulfillmentType || editingProduct?.fulfillmentType === 'client_account'} className="hidden" />
                                            <i className="fa-solid fa-user-gear text-teal-600"></i>
                                            <span className="text-sm font-bold text-slate-700">حساب العميل</span>
                                        </label>
                                    </div>
                                    <p className="text-[11px] text-slate-400 font-medium mt-2">
                                        <i className="fa-solid fa-circle-info ml-1"></i>
                                        سحب من المخزون = يتم تعيين حساب من المخزون تلقائياً عند البيع | حساب العميل = يتم التفعيل على حساب العميل
                                    </p>
                                </div>
                            </div>
                            <button type="submit" className="w-full bg-purple-600 text-white py-3.5 rounded-xl font-bold hover:bg-purple-700 shadow-lg shadow-purple-200 transition-all flex items-center justify-center gap-2">
                                <i className="fa-solid fa-check"></i> حفظ المنتج
                            </button>
                        </form>
                    </div>
                </div>
            )}

            <style>{`
                .animate-fade-in { animation: fadeIn 0.3s ease-out forwards; }
                @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
            `}</style>
        </div>
    );
}
