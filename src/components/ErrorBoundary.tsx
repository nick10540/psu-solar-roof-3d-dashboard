import React, { Component, ReactNode, ErrorInfo } from 'react';
import { RefreshCw, AlertTriangle } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    // Check if error is from an external browser extension (like MetaMask)
    const errorMsg = error?.message || '';
    if (
      errorMsg.includes('MetaMask') || 
      errorMsg.includes('ethereum') || 
      errorMsg.includes('wallet')
    ) {
      // Ignore extension errors
      return { hasError: false, error: null };
    }
    return { hasError: true, error };
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error in React tree:', error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  public override render() {
    if (this.state.hasError) {
      return (
        <div 
          id="error-boundary-fallback"
          className="min-h-screen w-full flex items-center justify-center bg-slate-950 text-slate-100 p-6 font-['Bai_Jamjuree',sans-serif]"
        >
          <div className="max-w-md w-full bg-slate-900/90 border border-red-500/30 rounded-3xl p-6 shadow-2xl backdrop-blur-xl text-center space-y-4">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-400">
              <AlertTriangle className="w-7 h-7" />
            </div>
            
            <h2 className="text-xl font-bold text-slate-100">
              เกิดข้อผิดพลาดในการแสดงผล
            </h2>
            
            <p className="text-sm text-slate-400 leading-relaxed">
              {this.state.error?.message || 'ระบบพบข้อผิดพลาดที่ไม่คาดคิด กรุณาลองรีเฟรชหน้าจอใหม่อีกครั้ง'}
            </p>

            <div className="flex gap-3 justify-center pt-2">
              <button
                id="btn-error-retry"
                onClick={this.handleReset}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium transition-colors cursor-pointer"
              >
                ลองใหม่อีกครั้ง
              </button>
              
              <button
                id="btn-error-reload"
                onClick={this.handleReload}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white text-sm font-semibold shadow-lg shadow-sky-500/20 flex items-center gap-2 transition-all cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                รีเฟรชหน้าจอ
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

