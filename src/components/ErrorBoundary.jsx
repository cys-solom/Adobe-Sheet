import React from 'react';
import { RefreshCw, ShieldAlert } from 'lucide-react';

export class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        console.error('ErrorBoundary caught an unhandled error:', error, errorInfo);
    }

    handleReload = () => {
        window.location.reload();
    };

    render() {
        if (this.state.hasError) {
            return (
                <div style={{
                    minHeight: '100vh',
                    backgroundColor: '#0f172a',
                    color: '#f8fafc',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '24px',
                    direction: 'rtl',
                    fontFamily: 'Tahoma, Arial, sans-serif'
                }}>
                    <div style={{
                        maxWidth: '560px',
                        width: '100%',
                        backgroundColor: '#1e293b',
                        borderRadius: '12px',
                        border: '1px solid #334155',
                        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
                        padding: '32px',
                        textAlign: 'center'
                    }}>
                        <div style={{
                            width: '64px',
                            height: '64px',
                            margin: '0 auto 20px',
                            borderRadius: '12px',
                            backgroundColor: 'rgba(239, 68, 68, 0.15)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#ef4444'
                        }}>
                            <ShieldAlert size={36} />
                        </div>

                        <h2 style={{ fontSize: '22px', fontWeight: 'bold', marginBottom: '12px', color: '#fff' }}>
                            حدث خطأ أثناء تشغيل الموقع
                        </h2>

                        <p style={{ fontSize: '14px', color: '#94a3b8', lineHeight: '1.8', marginBottom: '24px' }}>
                            تم إيقاف الواجهة مؤقتا لحماية البيانات. أعد تحميل الصفحة، ولو تكرر الخطأ افتح Console وابعت الرسالة الظاهرة.
                        </p>

                        {this.state.error && (
                            <div style={{
                                backgroundColor: '#090d16',
                                borderRadius: '8px',
                                padding: '12px 16px',
                                marginBottom: '24px',
                                textAlign: 'left',
                                direction: 'ltr',
                                fontSize: '12px',
                                color: '#f87171',
                                overflowX: 'auto',
                                fontFamily: 'Consolas, monospace'
                            }}>
                                {this.state.error.toString()}
                            </div>
                        )}

                        <button
                            onClick={this.handleReload}
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '8px',
                                padding: '12px 20px',
                                borderRadius: '8px',
                                backgroundColor: '#2563eb',
                                color: '#fff',
                                border: 'none',
                                fontWeight: 'bold',
                                cursor: 'pointer',
                                fontSize: '14px'
                            }}
                        >
                            <RefreshCw size={18} />
                            إعادة تحميل الصفحة
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
