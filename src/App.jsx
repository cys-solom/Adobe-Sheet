import { useState, useEffect } from 'react';
import { DataProvider, useData } from './context/DataContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ConfirmProvider } from './components/ConfirmDialog';
import { ErrorBoundary } from './components/ErrorBoundary';
import Login from './components/Login';
import Sidebar from './components/Sidebar';
import CustomSheets from './components/CustomSheets';
import DashboardAlerts from './components/DashboardAlerts';
import Reports from './components/Reports';
import Users from './components/Users';
import { startSheetSync, SYNC_STATUS } from './services/sheetSync';
import './workspace.css';

const MainLayout = () => {
  const { user, hasPermission } = useAuth();
  const { activeTab, setActiveTab } = useData();
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const [syncStatus, setSyncStatus] = useState('loading');
  const permittedTabs = ['dashboard', 'alerts', 'reports', 'client_data', 'merchant_data', 'account_data', 'reminders_data', 'trash_data', 'users'].filter(tab => {
    if (!user) return false;
    if (user.role === 'admin') return true;
    if (tab === 'users') return false;
    if (tab === 'reports') return true;
    return hasPermission(tab) || hasPermission('sheet_' + tab);
  });
  const canViewActiveTab = permittedTabs.includes(activeTab);

  useEffect(() => {
    if (!user) return;
    const onStatus = (event) => setSyncStatus(event.detail);
    window.addEventListener(SYNC_STATUS, onStatus);
    const stop = startSheetSync();
    return () => { stop(); window.removeEventListener(SYNC_STATUS, onStatus); };
  }, [user]);

  // Safety fallback if the restored tab is not permitted for the logged in user
  useEffect(() => {
    if (!user) return;
    if (!canViewActiveTab && permittedTabs.length) setActiveTab(permittedTabs[0]);
  }, [user, activeTab, hasPermission, setActiveTab]);

  if (!user) return <Login />;

  return (
    <div className="service-workspace min-h-screen bg-slate-50 dark:bg-slate-950 font-sans text-slate-800 dark:text-slate-100 dir-rtl flex transition-colors duration-200" style={{ direction: 'rtl' }}>

      <Sidebar isOpen={isSidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className="flex-1 lg:mr-64 p-2.5 sm:p-4 lg:p-4 transition-all duration-300 w-full min-w-0">
        <div className="max-w-[1600px] mx-auto space-y-3 md:space-y-5">
          <div className="workspace-topbar">
            <span dir="ltr" className="workspace-brand">Service Hub</span>
            <span role="status" className={`sync-indicator sync-${syncStatus}`}>
              <i className={`fa-solid ${syncStatus === 'error' ? 'fa-cloud-exclamation' : 'fa-cloud'}`} aria-hidden="true" />
              {syncStatus === 'saved' ? 'البيانات متزامنة' : syncStatus === 'saving' ? 'جارٍ الحفظ…' : syncStatus === 'error' ? 'تعذر الاتصال بقاعدة البيانات' : 'جارٍ الاتصال…'}
            </span>
          </div>

          {/* Mobile Header */}
          <div className="flex justify-between items-center mb-4 lg:hidden bg-white dark:bg-slate-900 p-4 rounded-2xl shadow-sm border border-slate-200/80 dark:border-slate-800">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-gradient-to-br from-indigo-500 via-purple-600 to-pink-500 rounded-xl flex items-center justify-center text-white vip-logo-badge border border-white/25 shadow-md flex-shrink-0">
                <span className="text-white font-black text-xl tracking-tight select-none drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)] font-sans -mt-0.5">H</span>
                <div className="logo-shine-sweep"></div>
              </div>
              <div className="overflow-hidden">
                <h2 className="text-base font-black truncate vip-animated-text leading-tight">Service Hub</h2>
                <p className="text-[10px] text-slate-400 dark:text-indigo-300 font-bold tracking-wider uppercase block truncate">Subscription Management</p>
              </div>
            </div>
            <button
              aria-label="فتح قائمة التنقل"
              onClick={() => setSidebarOpen(true)}
              className="p-2.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
            >
              <i className="fa-solid fa-bars text-lg"></i>
            </button>
          </div>

          {/* Main View: Dashboard OR Alerts OR Users OR Custom Sheet */}
          {!canViewActiveTab ? <p role="status">لا توجد صلاحية لعرض هذا القسم.</p> : activeTab === 'dashboard' || activeTab === 'alerts' ? (
            <DashboardAlerts
              mode={activeTab === 'alerts' ? 'alerts' : 'dashboard'}
              onNavigateSheet={(sheetId) => setActiveTab(sheetId)}
            />
          ) : activeTab === 'reports' ? (
            <Reports />
          ) : activeTab === 'users' ? (
            <Users />
          ) : (
            <CustomSheets
              activeSheetId={activeTab || 'client_data'}
              setActiveSheetId={setActiveTab}
            />
          )}

        </div>
      </main>
      <nav className="mobile-navigation" aria-label="التنقل السريع">
        {[
          { id: 'dashboard', label: 'الرئيسية', icon: 'fa-house', allowed: hasPermission('dashboard') },
          { id: 'client_data', label: 'العملاء', icon: 'fa-user-group', allowed: hasPermission('sheet_client_data') || hasPermission('client_data') },
          { id: 'account_data', label: 'الحسابات', icon: 'fa-envelope', allowed: hasPermission('sheet_account_data') || hasPermission('account_data') },
        ].filter(item => user.role === 'admin' || item.allowed).map(item => (
          <button key={item.id} aria-current={activeTab === item.id ? 'page' : undefined} onClick={() => setActiveTab(item.id)}>
            <i className={`fa-solid ${item.icon}`} aria-hidden="true" /><span>{item.label}</span>
          </button>
        ))}
        <button onClick={() => setSidebarOpen(true)}><i className="fa-solid fa-bars" aria-hidden="true" /><span>المزيد</span></button>
      </nav>
    </div>
  );
};

function App () {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <DataProvider>
          <ConfirmProvider>
            <MainLayout />
          </ConfirmProvider>
        </DataProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;
