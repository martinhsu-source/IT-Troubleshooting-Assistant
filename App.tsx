
import React, { useState, useEffect } from 'react';
import { INITIAL_RECORDS } from './constants';
import { TroubleshootingRecord, AIResponse } from './types';
import { getSmartSolution } from './services/geminiService';
import { 
  Search, 
  Database, 
  Cpu, 
  CheckCircle, 
  Clock, 
  AlertTriangle, 
  ChevronRight, 
  Plus, 
  RefreshCcw,
  BookOpen
} from 'lucide-react';

const App: React.FC = () => {
  const [records, setRecords] = useState<TroubleshootingRecord[]>(INITIAL_RECORDS);
  const [currentIssue, setCurrentIssue] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<AIResponse | null>(null);
  const [activeTab, setActiveTab] = useState<'search' | 'database'>('search');

  const handleAnalyze = async () => {
    if (!currentIssue.trim()) return;
    setIsAnalyzing(true);
    try {
      const solution = await getSmartSolution(currentIssue, records);
      setResult(solution);
    } catch (err) {
      console.error(err);
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
            <h1 className="text-xl font-bold tracking-tight text-slate-800">IT Routine Assistant</h1>
          </div>
          <nav className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
            <button
              onClick={() => setActiveTab('search')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                activeTab === 'search' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Smart Search
            </button>
            <button
              onClick={() => setActiveTab('database')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                activeTab === 'database' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Knowledge Base
            </button>
          </nav>
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
                    How can I help you today?
                  </h2>
                  <p className="text-slate-500">
                    Describe the current IT issue. We'll cross-reference it with the "IT Routine Work" records.
                  </p>
                </div>

                <div className="relative">
                  <textarea
                    value={currentIssue}
                    onChange={(e) => setCurrentIssue(e.target.value)}
                    placeholder="e.g. User reports that the printer in accounts is showing an error 49.38.07..."
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
                          Analyzing Logs...
                        </>
                      ) : (
                        <>
                          Find Solution
                          <ChevronRight className="w-5 h-5" />
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {result && (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-6">
                <div className="grid md:grid-cols-3 gap-6">
                  {/* Analysis Result */}
                  <div className="md:col-span-2 bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden">
                    <div className="bg-indigo-50 px-6 py-4 border-b border-indigo-100 flex items-center justify-between">
                      <h3 className="font-bold text-indigo-900 flex items-center gap-2">
                        <CheckCircle className="w-5 h-5" />
                        Recommended Solution
                      </h3>
                      <span className="text-xs font-bold uppercase tracking-wider text-indigo-600 bg-white px-2 py-1 rounded border border-indigo-200">
                        {Math.round(result.confidenceScore * 100)}% Confidence
                      </span>
                    </div>
                    <div className="p-6 space-y-6">
                      <section>
                        <h4 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-2">Issue Analysis</h4>
                        <p className="text-slate-700 leading-relaxed">{result.analysis}</p>
                      </section>
                      <div className="h-px bg-slate-100" />
                      <section>
                        <h4 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-2">Step-by-Step Fix</h4>
                        <div className="prose prose-slate max-w-none whitespace-pre-wrap text-slate-800">
                          {result.suggestedSolution}
                        </div>
                      </section>
                    </div>
                  </div>

                  {/* Sidebar / Related Context */}
                  <div className="space-y-6">
                    <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-6">
                      <h4 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                        <BookOpen className="w-5 h-5 text-amber-500" />
                        Referenced Logs
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
                                {record?.issue || "Historical Reference"}
                              </p>
                            </div>
                          );
                        })}
                        {result.relatedRecordIds.length === 0 && (
                          <div className="text-sm text-slate-400 italic">No direct historical matches found. Applied general IT patterns.</div>
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
            <div className="flex items-center justify-between mb-2">
              <div>
                <h2 className="text-2xl font-bold text-slate-800">Troubleshooting Records</h2>
                <p className="text-slate-500 text-sm">Synchronized from Google Sheet "IT Routine Work"</p>
              </div>
              <button className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
                <Plus className="w-4 h-4" />
                Add Record
              </button>
            </div>

            <div className="bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">ID / Date</th>
                      <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Category</th>
                      <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Issue Description</th>
                      <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
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
            
            <div className="bg-indigo-600 rounded-2xl p-8 text-white flex flex-col md:flex-row items-center justify-between gap-6 shadow-xl shadow-indigo-100">
              <div className="flex gap-4 items-center">
                <div className="bg-white/20 p-3 rounded-xl backdrop-blur-sm">
                  <Database className="w-8 h-8" />
                </div>
                <div>
                  <h3 className="text-xl font-bold">Data Management</h3>
                  <p className="text-indigo-100 opacity-80">
                    Connected to IT_Routine_Work.xlsx (Troubleshooting Records Tab)
                  </p>
                </div>
              </div>
              <button className="bg-white text-indigo-600 px-6 py-2.5 rounded-xl font-bold hover:bg-indigo-50 transition-colors">
                Sync Now
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Footer Info */}
      <footer className="max-w-5xl mx-auto px-6 py-8 border-t border-slate-200 mt-12 flex items-center justify-between text-slate-400 text-sm">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> Last synced 5 mins ago</span>
          <span className="flex items-center gap-1"><Database className="w-3 h-3" /> 154 Records available</span>
        </div>
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-500" />
          Always verify AI suggestions before applying critical hardware fixes.
        </div>
      </footer>
    </div>
  );
};

export default App;
