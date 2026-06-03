
import React, { useState, useEffect } from 'react';
import { INITIAL_RECORDS } from './constants';
import { TroubleshootingRecord, AIResponse } from './types';
import { getSmartSolution, loadTRRecords } from './services/geminiService';
import {
  Search,
  Database,
  Cpu,
  CheckCircle,
  Clock,
  AlertTriangle,
  ChevronRight,
  RefreshCcw,
  BookOpen,
  RefreshCw,
  Languages
} from 'lucide-react';

type Lang = 'en' | 'zh';

const T = {
  en: {
    title: 'IT Support Assistant',
    subtitle: 'BBI Clark',
    tabSearch: 'Smart Search',
    tabDB: 'Knowledge Base',
    heading: 'How can I help you today?',
    headingDesc: 'Describe the current IT issue. We\'ll cross-reference it with the "IT Routine Work" records.',
    placeholder: 'e.g. User reports that the printer in accounts is showing an error 49.38.07...',
    findBtn: 'Find Solution',
    analyzingBtn: 'Analyzing Logs...',
    recommended: 'Recommended Solution',
    confidence: (n: number) => `${n}% Confidence`,
    issueAnalysis: 'Issue Analysis',
    stepByStep: 'Step-by-Step Fix',
    referencedLogs: 'Referenced Logs',
    noMatch: 'No direct historical matches found. Applied general IT patterns.',
    dbTitle: 'Troubleshooting Records',
    dbSub: 'Synchronized from Google Sheet "IT Routine Work"',
    syncNow: 'Sync Now',
    syncing: 'Syncing...',
    dataSource: 'Data Source',
    dataSourceSub: 'Google Sheet: IT Routine Work (Troubleshooting Records)',
    lastSynced: (t: string) => `Last synced ${t}`,
    notSynced: 'Not synced yet',
    footer: 'Always verify AI suggestions before applying critical hardware fixes.',
    colId: 'ID / Date',
    colCat: 'Category',
    colIssue: 'Issue Description',
    colStatus: 'Status',
    recordsLoaded: (n: number) => `${n} records loaded`,
    langToggle: '繁體中文',
  },
  zh: {
    title: 'IT 支援助理',
    subtitle: 'BBI Clark',
    tabSearch: '智慧搜尋',
    tabDB: '知識庫',
    heading: '今天有什麼需要協助的？',
    headingDesc: '描述目前遇到的 IT 問題，系統將比對「IT Routine Work」工作表的歷史記錄提供建議。',
    placeholder: '例如：使用者反應印表機顯示錯誤 49.38.07...',
    findBtn: '分析並尋找解決方案',
    analyzingBtn: '分析記錄中...',
    recommended: '建議解決方案',
    confidence: (n: number) => `信心指數 ${n}%`,
    issueAnalysis: '問題分析',
    stepByStep: '逐步解決步驟',
    referencedLogs: '參考記錄',
    noMatch: '未找到直接相關歷史案例，已套用一般 IT 處理模式。',
    dbTitle: '故障排除記錄',
    dbSub: '同步自 Google Sheet「IT Routine Work」',
    syncNow: '立即同步',
    syncing: '同步中...',
    dataSource: '資料來源',
    dataSourceSub: 'Google Sheet：IT Routine Work（故障排除記錄）',
    lastSynced: (t: string) => `最後同步：${t}`,
    notSynced: '尚未同步',
    footer: '套用 AI 建議前請務必自行確認，尤其是硬體相關操作。',
    colId: 'ID / 日期',
    colCat: '類別',
    colIssue: '問題描述',
    colStatus: '狀態',
    recordsLoaded: (n: number) => `已載入 ${n} 筆`,
    langToggle: 'English',
  },
};

const App: React.FC = () => {
  const [lang, setLang] = useState<Lang>('en');
  const [records, setRecords] = useState<TroubleshootingRecord[]>(INITIAL_RECORDS);
  const [recordCount, setRecordCount] = useState(INITIAL_RECORDS.length);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<string>('');
  const [currentIssue, setCurrentIssue] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<AIResponse | null>(null);
  const [activeTab, setActiveTab] = useState<'search' | 'database'>('search');
  const [error, setError] = useState<string>('');

  const t = T[lang];

  const syncRecords = async () => {
    setIsSyncing(true);
    try {
      const fetched = await loadTRRecords();
      if (fetched.length > 0) {
        setRecords(fetched);
        setRecordCount(fetched.length);
        setLastSynced(new Date().toLocaleTimeString());
      }
    } catch (e) {
      console.error('Sync failed:', e);
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    syncRecords();
  }, []);

  const handleAnalyze = async () => {
    if (!currentIssue.trim()) return;
    setIsAnalyzing(true);
    setError('');
    try {
      const solution = await getSmartSolution(currentIssue, records);
      setResult(solution);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed. Please try again.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Resolved': return 'text-green-600 bg-green-50';
      case 'Pending': return 'text-yellow-600 bg-yellow-50';
      case 'Escalated': return 'text-red-600 bg-red-50';
      default: return 'text-gray-600 bg-gray-50';
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-indigo-600 p-1.5 rounded-lg">
              <Cpu className="text-white w-5 h-5" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-slate-800">{t.title}</h1>
            <span className="text-xs text-slate-400 ml-1">{t.subtitle}</span>
          </div>
          <div className="flex items-center gap-3">
            {/* Language toggle */}
            <button
              onClick={() => setLang(l => l === 'en' ? 'zh' : 'en')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:border-indigo-300 transition-all"
            >
              <Languages className="w-4 h-4" />
              {t.langToggle}
            </button>
            {/* Tab nav */}
            <nav className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
              <button
                onClick={() => setActiveTab('search')}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                  activeTab === 'search' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {t.tabSearch}
              </button>
              <button
                onClick={() => setActiveTab('database')}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                  activeTab === 'database' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {t.tabDB}
              </button>
            </nav>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-6 md:py-12">
        {activeTab === 'search' ? (
          <div className="space-y-8">
            <div className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
              <div className="p-8">
                <div className="mb-6">
                  <h2 className="text-2xl font-semibold mb-2 flex items-center gap-2">
                    <Search className="w-6 h-6 text-indigo-500" />
                    {t.heading}
                  </h2>
                  <p className="text-slate-500">{t.headingDesc}</p>
                </div>

                <div className="relative">
                  <textarea
                    value={currentIssue}
                    onChange={(e) => setCurrentIssue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && e.ctrlKey) handleAnalyze(); }}
                    placeholder={t.placeholder}
                    className="w-full min-h-[140px] p-4 text-lg border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all bg-slate-50 resize-none"
                  />
                  <div className="absolute bottom-4 right-4 flex gap-2">
                    <button
                      onClick={handleAnalyze}
                      disabled={isAnalyzing || !currentIssue.trim()}
                      className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-2 rounded-lg font-semibold shadow-lg shadow-indigo-100 flex items-center gap-2 transition-all"
                    >
                      {isAnalyzing ? (
                        <>
                          <RefreshCcw className="w-5 h-5 animate-spin" />
                          {t.analyzingBtn}
                        </>
                      ) : (
                        <>
                          {t.findBtn}
                          <ChevronRight className="w-5 h-5" />
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                    {error}
                  </div>
                )}
              </div>
            </div>

            {result && (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-6">
                <div className="grid md:grid-cols-3 gap-6">
                  <div className="md:col-span-2 bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden">
                    <div className="bg-indigo-50 px-6 py-4 border-b border-indigo-100 flex items-center justify-between">
                      <h3 className="font-bold text-indigo-900 flex items-center gap-2">
                        <CheckCircle className="w-5 h-5" />
                        {t.recommended}
                      </h3>
                      <span className="text-xs font-bold uppercase tracking-wider text-indigo-600 bg-white px-2 py-1 rounded border border-indigo-200">
                        {t.confidence(Math.round(result.confidenceScore * 100))}
                      </span>
                    </div>
                    <div className="p-6 space-y-6">
                      <section>
                        <h4 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-2">{t.issueAnalysis}</h4>
                        <p className="text-slate-700 leading-relaxed">{result.analysis}</p>
                      </section>
                      <div className="h-px bg-slate-100" />
                      <section>
                        <h4 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-2">{t.stepByStep}</h4>
                        <div className="prose prose-slate max-w-none whitespace-pre-wrap text-slate-800">
                          {result.suggestedSolution}
                        </div>
                      </section>
                    </div>
                  </div>

                  <div className="space-y-6">
                    <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-6">
                      <h4 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                        <BookOpen className="w-5 h-5 text-amber-500" />
                        {t.referencedLogs}
                      </h4>
                      <div className="space-y-3">
                        {result.relatedRecordIds.map((id) => {
                          const record = records.find(r => r.id === id);
                          return (
                            <div key={id} className="p-3 border border-slate-100 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer group">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-xs font-bold text-indigo-600">{id}</span>
                                <span className="text-[10px] text-slate-400">{record?.date}</span>
                              </div>
                              <p className="text-sm text-slate-600 line-clamp-2 group-hover:text-slate-900">
                                {record?.issue || 'Historical Reference'}
                              </p>
                            </div>
                          );
                        })}
                        {result.relatedRecordIds.length === 0 && (
                          <div className="text-sm text-slate-400 italic">{t.noMatch}</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {/* Data Source card — top */}
            <div className="bg-indigo-600 rounded-2xl p-6 text-white flex flex-col md:flex-row items-center justify-between gap-4 shadow-xl shadow-indigo-100">
              <div className="flex gap-4 items-center">
                <div className="bg-white/20 p-3 rounded-xl backdrop-blur-sm">
                  <Database className="w-7 h-7" />
                </div>
                <div>
                  <h3 className="text-lg font-bold mb-1">{t.dataSource}</h3>
                  <p className="text-indigo-100 text-sm opacity-90">① {lang === 'zh' ? '現行' : 'Current'}: IT Routine Work (Troubleshooting Records)</p>
                  <p className="text-indigo-100 text-sm opacity-90">② {lang === 'zh' ? '歸檔' : 'Archive'}: IT Routine Work Archive (Troubleshooting Records)</p>
                </div>
              </div>
              <button
                onClick={syncRecords}
                disabled={isSyncing}
                className="bg-white text-indigo-600 px-6 py-2.5 rounded-xl font-bold hover:bg-indigo-50 transition-colors disabled:opacity-60 flex items-center gap-2 shrink-0"
              >
                <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
                {isSyncing ? t.syncing : t.syncNow}
              </button>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-slate-800">{t.dbTitle}</h2>
                <p className="text-slate-500 text-sm">{t.dbSub}</p>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">{t.colId}</th>
                      <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">{t.colCat}</th>
                      <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">{t.colIssue}</th>
                      <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">{t.colStatus}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {records.map((record) => (
                      <tr key={record.id} className="hover:bg-slate-50/50 transition-colors group">
                        <td className="px-6 py-4">
                          <div className="text-sm font-bold text-slate-700">{record.id}</div>
                          <div className="text-xs text-slate-400">{record.date}</div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-xs font-medium bg-slate-100 text-slate-600 px-2 py-1 rounded">
                            {record.category}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm text-slate-800 font-medium line-clamp-1">{record.issue}</div>
                          <div className="text-xs text-slate-400 line-clamp-1 mt-0.5">{record.solution}</div>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-tighter ${getStatusColor(record.status)}`}>
                            {record.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer Info */}
      <footer className="max-w-5xl mx-auto px-6 py-8 border-t border-slate-200 mt-12 flex items-center justify-between text-slate-400 text-sm">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {lastSynced ? t.lastSynced(lastSynced) : (isSyncing ? t.syncing : t.notSynced)}
          </span>
          <span className="flex items-center gap-1"><Database className="w-3 h-3" /> {t.recordsLoaded(recordCount)}</span>
        </div>
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-500" />
          {t.footer}
        </div>
      </footer>
    </div>
  );
};

export default App;
